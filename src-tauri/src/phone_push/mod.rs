use std::time::Duration;

use keyring::{Entry, Error as KeyringError};
use serde_json::{json, Value};

use crate::user_error::{credential, UserError};
#[cfg(windows)]
use crate::win32::session_notifications;

const CREDENTIAL_SERVICE: &str = "com.tixxin.fuyu.bark";
const CREDENTIAL_USER: &str = "device-key";
const DEFAULT_SERVER: &str = "https://api.day.app";
const MAX_FIELD_CHARS: usize = 300;

fn entry() -> Result<Entry, UserError> {
    Entry::new(&crate::dev_lane::service(CREDENTIAL_SERVICE), CREDENTIAL_USER).map_err(credential::open)
}

fn read_key() -> Result<Option<String>, UserError> {
    match entry()?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(credential::read(error)),
    }
}

pub(crate) fn push_url(server: &str) -> Result<reqwest::Url, UserError> {
    let server = server.trim().trim_end_matches('/');
    let server = if server.is_empty() { DEFAULT_SERVER } else { server };
    let url = reqwest::Url::parse(&format!("{server}/push"))
        .map_err(|_| UserError::new("bark.server", "The Bark server address is not valid."))?;
    if !matches!(url.scheme(), "https" | "http") || url.host_str().is_none() {
        return Err(UserError::new("bark.scheme", "The Bark server address must start with https:// or http://."));
    }
    Ok(url)
}

pub(crate) fn push_body(key: &str, title: &str, body: &str, group: &str) -> Value {
    let cut = |text: &str| text.chars().take(MAX_FIELD_CHARS).collect::<String>();
    json!({ "device_key": key, "title": cut(title), "body": cut(body), "group": cut(group) })
}

pub(crate) fn normalize_key(input: &str) -> Option<String> {
    let input = input.trim();
    let candidate = match input.split_once("://") {
        Some((_, rest)) => rest.split('/').nth(1).unwrap_or_default(),
        None => input,
    };
    let key = candidate.trim();
    (!key.is_empty() && key.len() <= 128 && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'))
        .then(|| key.to_string())
}

#[tauri::command]
pub fn has_bark_key() -> Result<bool, UserError> {
    Ok(read_key()?.is_some())
}

#[tauri::command]
pub fn save_bark_key(key: String) -> Result<(), UserError> {
    let key = normalize_key(&key).ok_or_else(|| {
        UserError::new("bark.key", "That does not look like a Bark device key: copy the push URL in Bark, or the letters and digits in it.")
    })?;
    entry()?.set_password(&key).map_err(credential::save)
}

#[tauri::command]
pub fn delete_bark_key() -> Result<(), UserError> {
    match entry()?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(credential::delete(error)),
    }
}

#[tauri::command]
pub async fn send_bark_push(server: String, title: String, body: String, group: String) -> Result<(), UserError> {
    let key = read_key()?.ok_or_else(|| UserError::new("bark.noKey", "No Bark device key yet."))?;
    let url = push_url(&server)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent(concat!("Fuyu/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| UserError::new("http.client", "Could not set up the connection.").detail(error))?;
    let response = client
        .post(url)
        .json(&push_body(&key, &title, &body, &group))
        .send()
        .await
        .map_err(|error| UserError::new("bark.unreachable", "Could not reach the Bark server.").detail(error))?;
    let status = response.status().as_u16();
    if (200..300).contains(&status) {
        return Ok(());
    }
    let reply: Value = response.json().await.unwrap_or(Value::Null);
    let message = reply["message"].as_str().unwrap_or_default();
    Err(match status {
        400 if message.contains("device") => UserError::new("bark.unknownKey", "Bark does not know this device key; copy it again."),
        _ => UserError::new("bark.status", format!("Bark answered {status}.")).arg("status", status).detail(message),
    })
}

#[cfg(windows)]
#[tauri::command]
pub fn get_user_idle_seconds() -> Option<u32> {
    session_notifications::idle_millis().map(|millis| millis / 1000)
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn get_user_idle_seconds() -> Option<u32> {
    crate::macos::session::idle_seconds()
}

#[cfg(windows)]
#[tauri::command]
pub fn is_session_locked() -> bool {
    session_notifications::is_locked()
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn is_session_locked() -> bool {
    crate::macos::session::is_locked()
}

macro_rules! tauri_commands {
    ($next:ident [$($done:tt)*] $($rest:tt)*) => {
        $next!([$($done)*
            crate::phone_push::has_bark_key,
            crate::phone_push::save_bark_key,
            crate::phone_push::delete_bark_key,
            crate::phone_push::send_bark_push,
            crate::phone_push::is_session_locked,
            crate::phone_push::get_user_idle_seconds,
        ] $($rest)*)
    };
}
pub(crate) use tauri_commands;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_defaults_to_bark_and_takes_self_hosted_ones() {
        assert_eq!(push_url("").unwrap().as_str(), "https://api.day.app/push");
        assert_eq!(push_url("http://192.168.1.5:8080/ ").unwrap().as_str(), "http://192.168.1.5:8080/push");
        assert_eq!(push_url("ftp://x").unwrap_err().code(), "bark.scheme");
        assert_eq!(push_url("not a url").unwrap_err().code(), "bark.server");
    }

    #[test]
    fn keys_are_taken_bare_or_from_the_apps_url() {
        assert_eq!(normalize_key(" abcDEF123 ").as_deref(), Some("abcDEF123"));
        assert_eq!(normalize_key("https://api.day.app/abcDEF123/这里改成你自己的推送内容").as_deref(), Some("abcDEF123"));
        assert_eq!(normalize_key("https://api.day.app/"), None);
        assert_eq!(normalize_key("has space"), None);
    }

    #[test]
    fn long_text_is_cut_and_the_group_kept() {
        let body = push_body("k", &"标".repeat(500), "b", "fly-island");
        assert_eq!(body["title"].as_str().unwrap().chars().count(), MAX_FIELD_CHARS);
        assert_eq!(body["device_key"], "k");
        assert_eq!(body["group"], "fly-island");
    }
}
