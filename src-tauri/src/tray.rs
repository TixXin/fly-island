use std::sync::{Mutex, PoisonError};

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager, Wry,
};

use crate::{island, settings_window, translation};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TrayLanguage {
    Chinese,
    English,
}

impl TrayLanguage {
    pub(crate) fn from_locale(locale: &str) -> Self {
        if locale.to_ascii_lowercase().starts_with("en") {
            Self::English
        } else {
            Self::Chinese
        }
    }
}

pub(crate) fn labels(language: TrayLanguage, island_visible: bool) -> [&'static str; 3] {
    match (language, island_visible) {
        (TrayLanguage::Chinese, true) => ["隐藏岛屿", "设置", "退出"],
        (TrayLanguage::Chinese, false) => ["显示岛屿", "设置", "退出"],
        (TrayLanguage::English, true) => ["Hide Island", "Settings", "Quit"],
        (TrayLanguage::English, false) => ["Show Island", "Settings", "Quit"],
    }
}

pub(crate) fn translate_label(language: TrayLanguage) -> &'static str {
    match language {
        TrayLanguage::Chinese => "快捷翻译",
        TrayLanguage::English => "Quick Translate",
    }
}

pub(crate) fn screenshot_label(language: TrayLanguage) -> &'static str {
    match language {
        TrayLanguage::Chinese => "截图",
        TrayLanguage::English => "Screenshot",
    }
}

pub(crate) fn clipboard_label(language: TrayLanguage, paused: bool) -> &'static str {
    match (language, paused) {
        (TrayLanguage::Chinese, false) => "暂停剪贴板记录",
        (TrayLanguage::Chinese, true) => "恢复剪贴板记录",
        (TrayLanguage::English, false) => "Pause Clipboard History",
        (TrayLanguage::English, true) => "Resume Clipboard History",
    }
}

pub(crate) fn tooltip(language: TrayLanguage, development: bool) -> &'static str {
    match (development, language) {
        (false, _) => "Fuyu",
        (true, TrayLanguage::Chinese) => "Fuyu 开发版",
        (true, TrayLanguage::English) => "Fuyu Dev",
    }
}

const TRAY_ID: &str = "main";

struct TrayMenu {
    toggle: MenuItem<Wry>,
    translate: MenuItem<Wry>,
    screenshot: MenuItem<Wry>,
    clipboard: MenuItem<Wry>,
    settings: MenuItem<Wry>,
    quit: MenuItem<Wry>,
    shown: Mutex<(TrayLanguage, bool, bool, bool, bool)>,
}

fn island_visible(app: &AppHandle) -> bool {
    island::main_window(app)
        .and_then(|window| window.is_visible().map_err(|error| error.to_string()))
        .unwrap_or(true)
}

fn refresh(app: &AppHandle, language: Option<TrayLanguage>) {
    let Some(menu) = app.try_state::<TrayMenu>() else { return };
    let visible = island_visible(app);
    let mut shown = menu.shown.lock().unwrap_or_else(PoisonError::into_inner);
    let next = (language.unwrap_or(shown.0), visible, translation::is_enabled(), crate::clipboard_history::clipboard_capture_paused(), crate::screenshot::is_enabled());
    if *shown == next {
        return;
    }
    let [toggle, settings, quit] = labels(next.0, next.1);
    let _ = menu.toggle.set_text(toggle);
    let _ = menu.translate.set_text(translate_label(next.0));
    let _ = menu.translate.set_enabled(next.2);
    let _ = menu.screenshot.set_text(screenshot_label(next.0));
    let _ = menu.screenshot.set_enabled(next.4);
    let _ = menu.clipboard.set_text(clipboard_label(next.0, next.3));
    let _ = menu.settings.set_text(settings);
    let _ = menu.quit.set_text(quit);
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(tooltip(next.0, crate::dev_lane::lane().is_some())));
    }
    *shown = next;
}

#[tauri::command]
pub fn set_tray_language(app: AppHandle, locale: String) {
    refresh(&app, Some(TrayLanguage::from_locale(&locale)));
}

pub(crate) fn build_tray(app: &App) -> tauri::Result<()> {
    let [toggle_text, settings_text, quit_text] = labels(TrayLanguage::Chinese, true);
    let toggle = MenuItem::with_id(app, "toggle", toggle_text, true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", settings_text, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", quit_text, true, None::<&str>)?;
    let translate = MenuItem::with_id(app, "translate", translate_label(TrayLanguage::Chinese), true, None::<&str>)?;
    let clipboard = MenuItem::with_id(app, "clipboard_pause", clipboard_label(TrayLanguage::Chinese, false), true, None::<&str>)?;
    let screenshot = MenuItem::with_id(app, "screenshot", screenshot_label(TrayLanguage::Chinese), false, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &translate, &screenshot, &clipboard, &settings, &quit])?;
    app.manage(TrayMenu { toggle, translate, screenshot, clipboard, settings, quit, shown: Mutex::new((TrayLanguage::Chinese, true, true, false, false)) });

    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip(tooltip(TrayLanguage::Chinese, crate::dev_lane::lane().is_some()))
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => {
                if island_visible(app) {
                    island::hide_island(app);
                } else {
                    let _ = island::show_island(app);
                }
                refresh(app, None);
            }
            "translate" => translation::open_translator(app),
            "screenshot" => crate::screenshot::start_from_tray(app),
            "clipboard_pause" => {
                crate::clipboard_history::actions::toggle_capture_pause();
                refresh(app, None);
            }
            "settings" => {
                if let Err(error) = settings_window::open(app) {
                    eprintln!("failed to open settings window: {error}");
                }
            }
            "quit" => {
                settings_window::remember_bounds(app);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Enter { .. } | TrayIconEvent::Move { .. } => refresh(tray.app_handle(), None),
            TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } => {
                let _ = island::show_island(tray.app_handle());
                refresh(tray.app_handle(), None);
            }
            _ => {}
        });

    #[cfg(target_os = "macos")]
    {
        tray = tray.icon(crate::tray_mark::image()).icon_as_template(true);
    }
    #[cfg(not(target_os = "macos"))]
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }

    tray.build(app)?;
    Ok(())
}

macro_rules! tauri_commands {
    ($next:ident [$($done:tt)*] $($rest:tt)*) => {
        $next!([$($done)*
            crate::tray::set_tray_language,
        ] $($rest)*)
    };
}
pub(crate) use tauri_commands;

#[cfg(test)]
mod tests {
    use super::{labels, translate_label, TrayLanguage};

    #[test]
    fn the_menu_follows_the_language_and_names_what_the_toggle_will_do() {
        assert_eq!(TrayLanguage::from_locale("en"), TrayLanguage::English);
        assert_eq!(TrayLanguage::from_locale("en-US"), TrayLanguage::English);
        assert_eq!(TrayLanguage::from_locale("zh-CN"), TrayLanguage::Chinese);
        assert_eq!(TrayLanguage::from_locale("ja"), TrayLanguage::Chinese);
        assert_eq!(labels(TrayLanguage::Chinese, false), ["显示岛屿", "设置", "退出"]);
        assert_eq!(labels(TrayLanguage::Chinese, true)[0], "隐藏岛屿");
        assert_eq!(labels(TrayLanguage::English, false), ["Show Island", "Settings", "Quit"]);
        assert_eq!(labels(TrayLanguage::English, true)[0], "Hide Island");
        assert_eq!(translate_label(TrayLanguage::Chinese), "快捷翻译");
        assert_eq!(translate_label(TrayLanguage::English), "Quick Translate");
        assert_eq!(super::clipboard_label(TrayLanguage::Chinese, true), "恢复剪贴板记录");
        assert_eq!(super::screenshot_label(TrayLanguage::English), "Screenshot");
    }

    #[test]
    fn only_a_development_build_says_so_in_the_tooltip() {
        assert_eq!(super::tooltip(TrayLanguage::Chinese, false), "Fuyu");
        assert_eq!(super::tooltip(TrayLanguage::English, false), "Fuyu");
        assert_eq!(super::tooltip(TrayLanguage::Chinese, true), "Fuyu 开发版");
        assert_eq!(super::tooltip(TrayLanguage::English, true), "Fuyu Dev");
    }
}
