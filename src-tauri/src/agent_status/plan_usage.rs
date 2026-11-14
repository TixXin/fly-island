use crate::user_error::{credential, UserError};
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock, PoisonError},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use keyring::{Entry, Error as KeyringError};
use serde_json::Value;

use super::sessions::parse_timestamp_ms;
use super::usage::{AgentUsage, UsageSource, UsageWindow};
use crate::claude_usage::{UsageError, UsageErrorKind};

const CREDENTIAL_SERVICE: &str = "com.tixxin.fuyu.plan-usage";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const CACHE_MS: i64 = 60_000;
const REFRESH_GAP_MS: i64 = 10_000;
const MONTH: &str = "month";
const MCP_MONTH: &str = "mcpMonth";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(super) enum PlanProvider {
    Glm,
    Kimi,
}

impl PlanProvider {
    pub(super) fn parse(name: &str) -> Result<Self, String> {
        match name {
            "glm" => Ok(Self::Glm),
            "kimi" => Ok(Self::Kimi),
            _ => Err(format!("Unknown coding plan provider {name}.")),
        }
    }

    fn id(self) -> &'static str {
        match self {
            Self::Glm => "glm",
            Self::Kimi => "kimi",
        }
    }

    fn url(self) -> &'static str {
        match self {
            Self::Glm => "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
            Self::Kimi => "https://api.kimi.com/coding/v1/usages",
        }
    }

    fn authorization(self, key: &str) -> String {
        match self {
            Self::Glm => key.to_string(),
            Self::Kimi => format!("Bearer {key}"),
        }
    }

    fn source(self) -> UsageSource {
        match self {
            Self::Glm => UsageSource::Glm,
            Self::Kimi => UsageSource::Kimi,
        }
    }
}

#[derive(Debug, Default, PartialEq)]
pub(super) struct PlanWindows {
    pub(super) five_hour: Option<UsageWindow>,
    pub(super) seven_day: Option<UsageWindow>,
    pub(super) models: Vec<UsageWindow>,
    pub(super) plan: Option<String>,
}

fn error(kind: UsageErrorKind, message: impl Into<String>) -> UsageError {
    UsageError { kind, message: message.into() }
}

fn window(name: &str, used: f64, resets_at: Option<i64>) -> UsageWindow {
    UsageWindow { name: name.to_string(), used: used.clamp(0.0, 100.0), resets_at }
}

fn number(value: &Value) -> Option<f64> {
    value.as_f64().or_else(|| value.as_str()?.trim().parse().ok()).filter(|number| number.is_finite())
}

pub(super) fn parse_glm(text: &str) -> Result<PlanWindows, UsageError> {
    let invalid = || error(UsageErrorKind::InvalidResponse, "GLM answered with something other than its usage.");
    let answer = serde_json::from_str::<Value>(text).map_err(|_| invalid())?;
    let code = answer["code"].as_i64();
    if answer["success"] == Value::Bool(false) || code.is_some_and(|code| code != 200 && code != 0) {
        let message = answer["msg"].as_str().unwrap_or("GLM refused the request.").to_string();
        return Err(error(UsageErrorKind::Forbidden, message));
    }
    let limits = answer["data"]["limits"].as_array().ok_or_else(invalid)?;
    let mut windows = PlanWindows {
        plan: answer["data"]["level"].as_str().filter(|level| !level.is_empty()).map(|level| format!("GLM Coding {}", capitalize(level))),
        ..PlanWindows::default()
    };
    for limit in limits {
        let Some(used) = number(&limit["percentage"]) else { continue };
        let resets_at = limit["nextResetTime"].as_i64();
        match (limit["type"].as_str(), limit["unit"].as_i64(), limit["number"].as_i64()) {
            (Some("TOKENS_LIMIT"), Some(3), Some(5)) => windows.five_hour = Some(window("", used, resets_at)),
            (Some("TOKENS_LIMIT"), Some(6), Some(1)) => windows.seven_day = Some(window("", used, resets_at)),
            (Some("TIME_LIMIT"), Some(5), Some(1)) => windows.models.push(window(MCP_MONTH, used, resets_at)),
            _ => {}
        }
    }
    Ok(windows)
}

fn capitalize(word: &str) -> String {
    let mut chars = word.chars();
    chars.next().map(|first| first.to_uppercase().chain(chars).collect()).unwrap_or_default()
}

fn kimi_old_percent(detail: &Value) -> Option<f64> {
    let limit = number(&detail["limit"]).filter(|limit| *limit > 0.0)?;
    let used = number(&detail["used"]).or_else(|| Some(limit - number(&detail["remaining"])?))?;
    Some(used / limit * 100.0)
}

pub(super) fn parse_kimi(text: &str) -> Result<PlanWindows, UsageError> {
    let invalid = || error(UsageErrorKind::InvalidResponse, "Kimi answered with something other than its usage.");
    let answer = serde_json::from_str::<Value>(text).map_err(|_| invalid())?;
    let mut windows = PlanWindows::default();
    let usages = &answer["usages"];
    if usages.is_object() {
        let quota = |key: &str, name: &str| {
            let ratio = number(&usages[key]["used_ratio"])?;
            let used = (ratio * 100.0).ceil();
            Some(window(name, used, usages[key]["reset_time"].as_str().and_then(parse_timestamp_ms)))
        };
        windows.five_hour = quota("limit_5h", "");
        windows.seven_day = quota("limit_7d", "");
        windows.models.extend(quota("limit_month_total", MONTH));
    } else {
        let reset = |detail: &Value| detail["resetTime"].as_str().and_then(parse_timestamp_ms);
        if let Some(used) = kimi_old_percent(&answer["usage"]) {
            windows.seven_day = Some(window("", used, reset(&answer["usage"])));
        }
        for limit in answer["limits"].as_array().into_iter().flatten() {
            let minutes = number(&limit["window"]["duration"]).filter(|_| limit["window"]["timeUnit"] == "TIME_UNIT_MINUTE");
            if minutes == Some(300.0) {
                if let Some(used) = kimi_old_percent(&limit["detail"]) {
                    windows.five_hour = Some(window("", used, reset(&limit["detail"])));
                }
            }
        }
    }
    if windows.five_hour.is_none() && windows.seven_day.is_none() && windows.models.is_empty() {
        return Err(invalid());
    }
    Ok(windows)
}

pub(super) fn status_error(provider: PlanProvider, status: u16) -> Option<UsageError> {
    let name = if provider == PlanProvider::Glm { "GLM" } else { "Kimi" };
    match status {
        200..=299 => None,
        401 => Some(error(UsageErrorKind::LoginRequired, format!("{name} did not accept the API key."))),
        403 | 404 => Some(error(UsageErrorKind::Forbidden, format!("{name} found no coding plan for this API key (HTTP {status})."))),
        429 => Some(error(UsageErrorKind::RateLimited, format!("{name} asked to slow down."))),
        _ => Some(error(UsageErrorKind::Http, format!("{name} answered HTTP {status}."))),
    }
}

async fn fetch(provider: PlanProvider, key: &str) -> Result<PlanWindows, UsageError> {
    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|failure| error(UsageErrorKind::Network, format!("Could not set up the request: {failure}")))?;
    let response = client
        .get(provider.url())
        .header(reqwest::header::AUTHORIZATION, provider.authorization(key))
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|failure| error(UsageErrorKind::Network, format!("The request to {} failed: {failure}", provider.url())))?;
    if let Some(failure) = status_error(provider, response.status().as_u16()) {
        return Err(failure);
    }
    let text = response.text().await.map_err(|failure| error(UsageErrorKind::Network, format!("Reading the answer failed: {failure}")))?;
    match provider {
        PlanProvider::Glm => parse_glm(&text),
        PlanProvider::Kimi => parse_kimi(&text),
    }
}

fn entry(provider: PlanProvider) -> Result<Entry, UserError> {
    Entry::new(&crate::dev_lane::service(CREDENTIAL_SERVICE), provider.id()).map_err(credential::open)
}

fn read_key(provider: PlanProvider) -> Result<Option<String>, UserError> {
    match entry(provider)?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(credential::read(error)),
    }
}

pub(super) fn save_key(provider: PlanProvider, key: &str) -> Result<bool, UserError> {
    let key = key.trim();
    let entry = entry(provider)?;
    if key.is_empty() {
        match entry.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => {}
            Err(error) => return Err(credential::delete(error)),
        }
    } else {
        if key.chars().any(char::is_whitespace) || key.len() > 512 {
            return Err(UserError::new("planUsage.key", "That does not look like an API key."));
        }
        entry.set_password(key).map_err(credential::save)?;
    }
    cache().lock().unwrap_or_else(PoisonError::into_inner).remove(&provider);
    Ok(!key.is_empty())
}

pub(super) fn has_key(provider: PlanProvider) -> Result<bool, UserError> {
    read_key(provider).map(|key| key.is_some())
}

fn cache() -> &'static Mutex<HashMap<PlanProvider, (i64, AgentUsage)>> {
    static CACHE: OnceLock<Mutex<HashMap<PlanProvider, (i64, AgentUsage)>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |since| i64::try_from(since.as_millis()).unwrap_or(i64::MAX))
}

fn empty(provider: PlanProvider) -> AgentUsage {
    AgentUsage { updated_at: None, five_hour: None, seven_day: None, models: Vec::new(), plan: None, source: provider.source(), error: None }
}

pub(super) async fn read(provider: PlanProvider, refresh: bool) -> AgentUsage {
    let now = now_ms();
    let previous = cache().lock().unwrap_or_else(PoisonError::into_inner).get(&provider).cloned();
    if let Some((asked_at, usage)) = &previous {
        if now - asked_at < if refresh { REFRESH_GAP_MS } else { CACHE_MS } {
            return usage.clone();
        }
    }
    let usage = match read_key(provider) {
        Ok(None) => AgentUsage { error: Some(error(UsageErrorKind::NoCredentials, "No API key saved.")), ..empty(provider) },
        Err(message) => AgentUsage { error: Some(error(UsageErrorKind::NoCredentials, message.to_string())), ..empty(provider) },
        Ok(Some(key)) => match fetch(provider, &key).await {
            Ok(windows) => AgentUsage {
                updated_at: Some(now),
                five_hour: windows.five_hour,
                seven_day: windows.seven_day,
                models: windows.models,
                plan: windows.plan,
                ..empty(provider)
            },
            Err(failure) => AgentUsage { error: Some(failure), ..previous.map(|(_, usage)| usage).unwrap_or_else(|| empty(provider)) },
        },
    };
    cache().lock().unwrap_or_else(PoisonError::into_inner).insert(provider, (now, usage.clone()));
    usage
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn glm_windows_are_told_apart_by_type_unit_and_number() {
        let text = r#"{"code":200,"success":true,"data":{"level":"pro","limits":[
            {"type":"TIME_LIMIT","unit":5,"number":1,"usage":100,"currentValue":12,"percentage":12,"nextResetTime":1781345721976},
            {"type":"TOKENS_LIMIT","unit":3,"number":5,"percentage":41,"nextResetTime":1778753640304},
            {"type":"TOKENS_LIMIT","unit":6,"number":1,"percentage":7}]}}"#;
        let windows = parse_glm(text).expect("usage");
        assert_eq!(windows.five_hour, Some(window("", 41.0, Some(1_778_753_640_304))));
        assert_eq!(windows.seven_day, Some(window("", 7.0, None)));
        assert_eq!(windows.models, vec![window(MCP_MONTH, 12.0, Some(1_781_345_721_976))]);
        assert_eq!(windows.plan.as_deref(), Some("GLM Coding Pro"));
    }

    #[test]
    fn glm_without_a_coding_plan_says_so() {
        let failure = parse_glm(r#"{"code":500,"msg":"当前用户不存在coding plan","success":false}"#).expect_err("refused");
        assert_eq!(failure.kind, UsageErrorKind::Forbidden);
        assert_eq!(failure.message, "当前用户不存在coding plan");
        assert_eq!(parse_glm("<html>").expect_err("not json").kind, UsageErrorKind::InvalidResponse);
    }

    #[test]
    fn kimi_quota_answers_round_up_and_read_string_ratios() {
        let text = r#"{"goods_version":2,"usages":{
            "limit_5h":{"used_ratio":0.301,"reset_time":"2026-09-11T18:00:00Z"},
            "limit_month_total":{"used_ratio":"0.4","reset_time":"2026-10-01T00:00:00Z"}}}"#;
        let windows = parse_kimi(text).expect("usage");
        assert_eq!(windows.five_hour.as_ref().map(|window| window.used), Some(31.0));
        assert!(windows.five_hour.as_ref().is_some_and(|window| window.resets_at.is_some()));
        assert_eq!(windows.seven_day, None);
        assert_eq!(windows.models.iter().map(|window| (window.name.as_str(), window.used)).collect::<Vec<_>>(), vec![(MONTH, 40.0)]);
    }

    #[test]
    fn kimi_older_answers_use_used_or_remaining_against_the_limit() {
        let text = r#"{"usage":{"used":"40","limit":"1000","resetTime":"2026-09-17T00:00:00Z"},
            "limits":[{"window":{"duration":300,"timeUnit":"TIME_UNIT_MINUTE"},"detail":{"remaining":"75","limit":"100"}}]}"#;
        let windows = parse_kimi(text).expect("usage");
        assert_eq!(windows.seven_day.as_ref().map(|window| window.used), Some(4.0));
        assert_eq!(windows.five_hour.as_ref().map(|window| window.used), Some(25.0));
        assert_eq!(parse_kimi(r#"{"usage":{"limit":"0"}}"#).expect_err("nothing").kind, UsageErrorKind::InvalidResponse);
    }

    #[test]
    fn statuses_name_what_is_wrong_with_the_key() {
        assert!(status_error(PlanProvider::Kimi, 200).is_none());
        assert_eq!(status_error(PlanProvider::Kimi, 401).map(|failure| failure.kind), Some(UsageErrorKind::LoginRequired));
        assert_eq!(status_error(PlanProvider::Kimi, 404).map(|failure| failure.kind), Some(UsageErrorKind::Forbidden));
        assert_eq!(status_error(PlanProvider::Glm, 429).map(|failure| failure.kind), Some(UsageErrorKind::RateLimited));
        assert_eq!(status_error(PlanProvider::Glm, 502).map(|failure| failure.kind), Some(UsageErrorKind::Http));
        assert_eq!(PlanProvider::Glm.authorization("id.secret"), "id.secret");
        assert_eq!(PlanProvider::Kimi.authorization("sk-kimi"), "Bearer sk-kimi");
        assert!(PlanProvider::parse("qwen").is_err());
    }
}
