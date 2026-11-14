#[cfg(windows)]
const STATE_FILE: &str = "dev-copy.json";

#[cfg(windows)]
#[derive(Debug, Default, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
struct State {
    credentials: bool,
}

#[cfg(any(windows, test))]
pub(crate) fn lane_credential(target: &str, lane: u32) -> Option<String> {
    let real = format!(".{}.", crate::rename_migration::NEW_IDENTIFIER);
    let at = target.find(&real)?;
    let rest = &target[at + real.len()..];
    if rest.is_empty() || rest.starts_with("lane-") || rest.starts_with("verification.") {
        return None;
    }
    Some(format!("{}.{}.{rest}", &target[..at], super::identifier(lane)))
}

#[cfg(windows)]
pub(crate) fn before_start(lane: u32) {
    let Some(dir) = crate::home_dir::app_data_dir(&super::identifier(lane)) else {
        return;
    };
    let path = dir.join(STATE_FILE);
    let mut state: State = std::fs::read_to_string(&path).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default();
    if state.credentials {
        return;
    }
    match crate::win32::credentials::copy_generic_credentials(|target| lane_credential(target, lane)) {
        Ok(count) => {
            eprintln!("copied {count} credentials for the development build");
            state.credentials = true;
        }
        Err(error) => {
            eprintln!("could not copy the credentials for the development build: {error}");
            return;
        }
    }
    if let Ok(text) = serde_json::to_string_pretty(&state) {
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(&path, text);
    }
}

#[cfg(not(windows))]
pub(crate) fn before_start(_lane: u32) {}

#[cfg(test)]
mod tests {
    use super::lane_credential;

    #[test]
    fn the_installed_apps_credentials_get_the_lane_after_the_identifier() {
        assert_eq!(lane_credential("device-key.com.tixxin.fuyu.bark", 1).as_deref(), Some("device-key.com.tixxin.fuyu.lane-1.bark"));
        assert_eq!(lane_credential("deepl.com.tixxin.fuyu.translation", 7).as_deref(), Some("deepl.com.tixxin.fuyu.lane-7.translation"));
        assert_eq!(lane_credential("me@qq.com.com.tixxin.fuyu.qq-mail", 1).as_deref(), Some("me@qq.com.com.tixxin.fuyu.lane-1.qq-mail"));
        assert_eq!(
            lane_credential("token.com.tixxin.fuyu.plugin.dev.focusd.github-issues", 1).as_deref(),
            Some("token.com.tixxin.fuyu.lane-1.plugin.dev.focusd.github-issues")
        );
    }

    #[test]
    fn other_credentials_and_ones_that_are_a_lanes_already_are_left_alone() {
        for other in [
            "device-key.com.tixxin.fuyu.lane-1.bark",
            "device-key.com.tixxin.fuyu.lane-20.bark",
            "x.com.tixxin.fuyu.verification.abc.bark",
            "x.com.tixxin.fuyu",
            "x.com.tixxin.fuyu.",
            "x.com.tixxin.fuyuu.bark",
            "x.com.focusd.island.bark",
            "git:https://github.com",
        ] {
            assert_eq!(lane_credential(other, 1), None, "{other}");
        }
    }
}
