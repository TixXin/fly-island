use tauri::AppHandle;
#[cfg(windows)]
use windows::Win32::System::Registry::HKEY_CURRENT_USER;

#[cfg(windows)]
const INTERNET_SETTINGS_SUBKEY: &str =
    r"Software\Microsoft\Windows\CurrentVersion\Internet Settings";

pub(super) fn normalize_proxy(raw: &str) -> String {
    let entries: Vec<&str> = raw
        .split(';')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .collect();
    let server = ["https=", "http="]
        .iter()
        .find_map(|prefix| entries.iter().find_map(|entry| entry.strip_prefix(prefix)))
        .unwrap_or_else(|| entries.first().copied().unwrap_or(""));

    if server.contains("://") {
        server.to_string()
    } else {
        format!("http://{server}")
    }
}

#[tauri::command]
pub fn get_updater_proxy() -> Option<String> {
    for key in ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"] {
        if let Ok(value) = std::env::var(key) {
            let value = value.trim();
            if !value.is_empty() {
                return Some(normalize_proxy(value));
            }
        }
    }

    system_proxy()
}

#[cfg(windows)]
fn system_proxy() -> Option<String> {
    if crate::win32::registry::read_u32(HKEY_CURRENT_USER, INTERNET_SETTINGS_SUBKEY, "ProxyEnable")?
        == 0
    {
        return None;
    }

    let server =
        crate::win32::registry::read_string(HKEY_CURRENT_USER, INTERNET_SETTINGS_SUBKEY, "ProxyServer")?;
    if server.trim().is_empty() {
        return None;
    }

    Some(normalize_proxy(&server))
}

#[cfg(not(windows))]
fn system_proxy() -> Option<String> {
    None
}

#[tauri::command]
pub fn updater_configured(app: AppHandle) -> bool {
    if crate::dev_lane::lane().is_some() {
        return false;
    }
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|config| config.get("pubkey"))
        .and_then(|value| value.as_str())
        .is_some_and(|key| !key.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    fn shipped_updater_config() -> Value {
        let config: Value = serde_json::from_str(include_str!("../../tauri.conf.json"))
            .expect("tauri.conf.json must be valid JSON");
        config
            .pointer("/plugins/updater")
            .cloned()
            .expect("tauri.conf.json must define plugins.updater")
    }

    #[test]
    fn shipped_updater_config_carries_a_minisign_public_key() {
        let parsed: tauri_plugin_updater::Config = serde_json::from_value(shipped_updater_config())
            .expect("plugins.updater must deserialize or the app aborts at startup");

        assert!(parsed.pubkey.starts_with("dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6"));
        assert!(!parsed.endpoints.is_empty());
    }

    #[test]
    fn release_overlay_replaces_the_pubkey_placeholder() {
        let mut update_config = shipped_updater_config();
        update_config["pubkey"] = json!("RWQtest-only-release-public-key");

        let parsed: tauri_plugin_updater::Config = serde_json::from_value(update_config)
            .expect("a release config carrying a real pubkey must deserialize");

        assert_eq!(parsed.pubkey, "RWQtest-only-release-public-key");
        assert!(!parsed.endpoints.is_empty());
    }
}
