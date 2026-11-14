use crate::user_error::{credential, UserError};
use std::{fs, path::Path};

use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};

pub(super) const FILE_NAME: &str = "calendar-sources.json";
const CREDENTIAL_SERVICE: &str = "com.tixxin.fuyu.calendar";
pub(super) const MAX_SOURCES: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SourceKind {
    Ics,
    Caldav,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarSource {
    pub(super) id: String,
    pub(super) kind: SourceKind,
    pub(super) name: String,
    #[serde(default)]
    pub(super) url: String,
    pub(super) host: String,
    #[serde(default)]
    pub(super) username: String,
}

pub(super) fn read(app_dir: &Path) -> Vec<CalendarSource> {
    fs::read_to_string(app_dir.join(FILE_NAME))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub(super) fn write(app_dir: &Path, sources: &[CalendarSource]) -> Result<(), UserError> {
    let save = |error: std::io::Error| UserError::new("calendar.save", "Could not save the calendar settings.").detail(error);
    fs::create_dir_all(app_dir).map_err(save)?;
    let text = serde_json::to_string_pretty(sources).map_err(|error| UserError::new("internal", "Something went wrong inside the island.").detail(error))?;
    crate::fs_write::replace_file(&app_dir.join(FILE_NAME), text.as_bytes()).map_err(save)
}

fn entry(id: &str) -> Result<Entry, UserError> {
    Entry::new(&crate::dev_lane::service(CREDENTIAL_SERVICE), id).map_err(credential::open)
}

pub(super) fn read_secret(id: &str) -> Result<Option<String>, UserError> {
    match entry(id)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(credential::read(error)),
    }
}

pub(super) fn save_secret(id: &str, secret: &str) -> Result<(), UserError> {
    entry(id)?.set_password(secret).map_err(credential::save)
}

pub(super) fn delete_secret(id: &str) -> Result<(), UserError> {
    match entry(id)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(credential::delete(error)),
    }
}

pub(super) fn ics_url(link: &str) -> Result<reqwest::Url, UserError> {
    let link = link.trim();
    let link = match link.strip_prefix("webcal://") {
        Some(rest) => format!("https://{rest}"),
        None => link.to_string(),
    };
    let url = reqwest::Url::parse(&link).map_err(|_| UserError::new("calendar.link", "The subscription link is not valid."))?;
    if url.scheme() != "https" || url.host_str().is_none() {
        return Err(UserError::new("calendar.linkScheme", "The subscription link must start with https:// or webcal://."));
    }
    Ok(url)
}

pub(super) fn host_of(url: &str) -> String {
    reqwest::Url::parse(url.trim()).ok().and_then(|url| url.host_str().map(str::to_string)).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ics_links_must_be_https_and_webcal_becomes_https() {
        assert_eq!(ics_url(" webcal://p01-caldav.icloud.com/published/2/abc ").unwrap().as_str(), "https://p01-caldav.icloud.com/published/2/abc");
        assert!(ics_url("https://calendar.google.com/calendar/ical/x/private-y/basic.ics").is_ok());
        assert_eq!(ics_url("http://example.com/a.ics").unwrap_err().code(), "calendar.linkScheme");
        assert_eq!(ics_url("not a link").unwrap_err().code(), "calendar.link");
        assert_eq!(host_of("https://caldav.feishu.cn/abc"), "caldav.feishu.cn");
        assert_eq!(host_of("nonsense"), "");
    }

    #[test]
    fn sources_are_saved_without_secrets() {
        let dir = std::env::temp_dir().join(format!("focusd-calendar-{}", std::process::id()));
        assert!(read(&dir).is_empty());
        let source = CalendarSource {
            id: "c1".into(),
            kind: SourceKind::Caldav,
            name: "飞书".into(),
            url: "https://caldav.feishu.cn".into(),
            host: "caldav.feishu.cn".into(),
            username: "u_abc".into(),
        };
        write(&dir, std::slice::from_ref(&source)).unwrap();
        assert_eq!(read(&dir), [source]);
        let saved = fs::read_to_string(dir.join(FILE_NAME)).unwrap();
        assert!(saved.contains("\"kind\": \"caldav\"") && !saved.contains("password"));
        fs::remove_dir_all(&dir).unwrap();
    }
}
