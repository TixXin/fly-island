mod seed;

pub(crate) use seed::before_start;

const ENV: &str = "FOCUSD_DEV_LANE";
const CENTER_ENV: &str = "FOCUSD_DEV_LANE_CENTER";

pub(crate) fn lane() -> Option<u32> {
    if !cfg!(debug_assertions) {
        return None;
    }
    std::env::var(ENV).ok()?.parse().ok().filter(|lane| (1..=999).contains(lane))
}

pub(crate) fn identifier(lane: u32) -> String {
    format!("com.tixxin.fuyu.lane-{lane}")
}

pub(crate) fn service(base: &str) -> String {
    service_in(lane(), base)
}

fn service_in(lane: Option<u32>, base: &str) -> String {
    match (lane, base.strip_prefix(crate::rename_migration::NEW_IDENTIFIER)) {
        (Some(lane), Some(rest)) if rest.starts_with('.') => format!("{}{rest}", identifier(lane)),
        _ => base.to_string(),
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn separate_webview_storage(lane: u32) {
    crate::macos::process_name::set_process_name(&format!("fuyu-lane-{lane}"));
}

fn centred_preview() -> bool {
    std::env::var(CENTER_ENV).is_ok_and(|value| value == "1")
}

pub(crate) fn stage_x(monitor_x: i32, monitor_width: i32, window_width: i32) -> i32 {
    left_edge(lane().is_some() && !centred_preview(), monitor_x, monitor_width, window_width)
}

fn left_edge(beside: bool, monitor_x: i32, monitor_width: i32, window_width: i32) -> i32 {
    if beside {
        monitor_x + (monitor_width / 4 - window_width / 2).max(0)
    } else {
        monitor_x + (monitor_width - window_width) / 2
    }
}

pub(crate) fn refuse_in_preview(action: &str) -> Result<(), String> {
    match lane() {
        Some(lane) => Err(format!("This is the preview of lane {lane}; it does not {action}. Use your own island for that.")),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::{identifier, left_edge, service_in, stage_x};

    #[test]
    fn the_installed_app_keeps_its_credential_names_and_a_lane_gets_its_own() {
        for name in ["com.tixxin.fuyu.calendar", "com.tixxin.fuyu.bark", "com.tixxin.fuyu.plan-usage", "com.tixxin.fuyu.qq-mail", "com.tixxin.fuyu.translation", "com.tixxin.fuyu.plugin.dev.focusd.tasks"] {
            assert_eq!(service_in(None, name), name);
        }
        assert_eq!(service_in(Some(1), "com.tixxin.fuyu.bark"), "com.tixxin.fuyu.lane-1.bark");
        assert_eq!(service_in(Some(12), "com.tixxin.fuyu.plugin.dev.focusd.tasks"), "com.tixxin.fuyu.lane-12.plugin.dev.focusd.tasks");
        assert_eq!(service_in(Some(1), "Claude Code-credentials"), "Claude Code-credentials");
        assert_eq!(service_in(Some(1), "com.tixxin.fuyuu.bark"), "com.tixxin.fuyuu.bark");
    }

    #[test]
    fn the_island_is_centred_on_its_monitor_outside_a_preview() {
        assert_eq!(stage_x(0, 2560, 760), 900);
        assert_eq!(stage_x(-1920, 1920, 760), -1920 + 580);
        assert_eq!(stage_x(0, 2561, 760), 900, "the same rounding as before");
    }

    #[test]
    fn a_preview_sits_on_the_left_quarter_unless_centred() {
        assert_eq!(left_edge(true, 0, 2560, 760), 260);
        assert_eq!(left_edge(true, 0, 1000, 760), 0, "never off the monitor's left edge");
        assert_eq!(left_edge(false, 0, 2560, 760), 900);
    }

    #[test]
    fn each_lane_gets_its_own_identifier() {
        assert_eq!(identifier(2), "com.tixxin.fuyu.lane-2");
        assert_ne!(identifier(2), identifier(12));
    }
}
