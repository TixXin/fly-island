use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PlatformSupport {
    os: &'static str,
    unsupported: &'static [&'static str],
    #[serde(rename = "devBuild")]
    dev_build: bool,
}

#[cfg(target_os = "macos")]
const SUPPORT: PlatformSupport = PlatformSupport {
    os: "macos",
    unsupported: &["agentConnect", "agentRemote"],
    dev_build: false,
};

#[cfg(not(target_os = "macos"))]
const SUPPORT: PlatformSupport = PlatformSupport { os: "windows", unsupported: &[], dev_build: false };

#[tauri::command]
pub fn get_platform_support() -> PlatformSupport {
    PlatformSupport { dev_build: crate::dev_lane::lane().is_some(), ..SUPPORT }
}

macro_rules! tauri_commands {
    ($next:ident [$($done:tt)*] $($rest:tt)*) => {
        $next!([$($done)*
            crate::platform_support::get_platform_support,
        ] $($rest)*)
    };
}
pub(crate) use tauri_commands;

#[cfg(test)]
mod tests {
    use super::get_platform_support;

    #[test]
    fn each_build_names_its_own_system() {
        let support = get_platform_support();
        if cfg!(target_os = "macos") {
            assert_eq!(support.os, "macos");
            assert!(!support.unsupported.contains(&"screenshot"));
        } else {
            assert_eq!(support.os, "windows");
            assert!(support.unsupported.is_empty());
        }
    }

    #[test]
    fn the_development_flag_reaches_the_frontend_as_dev_build() {
        let support = serde_json::to_value(get_platform_support()).unwrap();
        assert_eq!(support["devBuild"], crate::dev_lane::lane().is_some());
        assert!(support.get("dev_build").is_none());
    }
}
