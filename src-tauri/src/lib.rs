mod agent_approval;
mod agent_status;
mod calendar;
#[cfg_attr(not(windows), path = "cc_connect/unsupported.rs")]
mod cc_connect;
mod claude_usage;
mod clipboard_history;
mod dev_lane;
mod device_events;
#[cfg_attr(target_os = "macos", path = "device_use/macos.rs")]
mod device_use;
mod file_shelf;
mod fs_write;
mod home_dir;
mod island;
mod local_api;
mod lyrics;
mod media_control;
#[cfg(windows)]
mod messenger_activation;
mod notification_diagnostics;
mod onboarding_window;
mod pets;
mod phone_push;
mod plugin_host;
mod mail;
#[cfg_attr(target_os = "macos", path = "qq_notifications/macos.rs")]
mod qq_notifications;
#[cfg_attr(not(windows), path = "recording/unsupported.rs")]
mod recording;
#[cfg_attr(not(windows), path = "rename_migration/unsupported.rs")]
mod rename_migration;
mod screenshot;
mod settings_file;
mod settings_window;
mod shortcut_capture;
#[cfg_attr(not(windows), path = "ssh_tunnel/unsupported.rs")]
mod ssh_tunnel;
mod system;
mod system_levels;
mod todos;
mod translation;
mod tray;
#[cfg(target_os = "macos")]
mod tray_mark;
mod user_error;
#[cfg_attr(target_os = "macos", path = "wechat_reminders/macos.rs")]
mod wechat_reminders;
#[cfg(target_os = "macos")]
mod macos;
mod platform;
mod platform_support;
#[cfg(windows)]
mod win32;

use tauri::{Manager, WindowEvent};

macro_rules! collect_commands {
    ([$($done:tt)*]) => {
        tauri::generate_handler![$($done)*]
    };
    ([$($done:tt)*] $module:ident $(; $rest:ident)*) => {
        $module::tauri_commands!(collect_commands [$($done)*] $($rest);*)
    };
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut context = tauri::generate_context!();
    if let Some(identifier) = notification_diagnostics::verification_identifier() {
        context.config_mut().identifier = identifier;
    }
    if let Some(lane) = dev_lane::lane() {
        context.config_mut().identifier = dev_lane::identifier(lane);
        dev_lane::before_start(lane);
        #[cfg(target_os = "macos")]
        dev_lane::separate_webview_storage(lane);
    }
    let migrate = context.config().identifier == rename_migration::NEW_IDENTIFIER;
    if migrate {
        rename_migration::before_start();
    }
    home_dir::init(&context.config().identifier);
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());
    let result = builder
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let _ = island::show_island(app);
            if let Some(link) = plugin_host::find_link(&args) {
                plugin_host::open_link(app, link, false);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .register_asynchronous_uri_scheme_protocol(clipboard_history::image_protocol::SCHEME, |_context, request, responder| {
            tauri::async_runtime::spawn_blocking(move || responder.respond(clipboard_history::image_protocol::respond(&request)));
        })
        .on_window_event(|window, event| {
            if window.label() == translation::WINDOW_LABEL
                || window.label() == clipboard_history::POPUP_WINDOW_LABEL
                || window.label() == clipboard_history::preview_window::WINDOW_LABEL
            {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
                return;
            }
            if window.label().starts_with(screenshot::WINDOW_PREFIX) {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    screenshot::cancel(window.app_handle());
                }
                return;
            }
            if window.label().starts_with(screenshot::PIN_PREFIX) {
                if let WindowEvent::Destroyed = event {
                    screenshot::forget_pin(window.label());
                }
                return;
            }
            if window.label() != island::WINDOW_LABEL {
                return;
            }

            if let WindowEvent::Moved(position) = event {
                island::record_dragged_position(*position);
            }

        })
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            tray::build_tray(app)?;
            if let Err(error) = clipboard_history::init(app.handle()) {
                eprintln!("failed to initialize clipboard history: {error}");
            }
            translation::init(app.handle());
            screenshot::init(app.handle());
            if let Err(error) = file_shelf::init(app.handle()) {
                eprintln!("failed to initialize the file shelf: {error}");
            }
            if let Err(error) = todos::init(app.handle()) {
                eprintln!("failed to initialize the todo store: {error}");
            }
            if let Err(error) = agent_approval::init(app.handle()) {
                eprintln!("failed to start the agent approval endpoint: {error}");
            }
            if migrate {
                rename_migration::after_start(app.handle().clone());
            }
            home_dir::after_start(app.handle().clone());
            if let Err(error) = local_api::init(app.handle()) {
                eprintln!("failed to initialize the local API: {error}");
            }
            if let Err(error) = ssh_tunnel::init(app.handle()) {
                eprintln!("failed to initialize the SSH proxy tunnel: {error}");
            }
            if let Err(error) = cc_connect::init(app.handle()) {
                eprintln!("failed to initialize cc-connect: {error}");
            }
            if let Err(error) = plugin_host::init(app.handle()) {
                eprintln!("failed to initialize plugins: {error}");
            }
            let args: Vec<String> = std::env::args().collect();
            if let Some(link) = plugin_host::find_link(&args) {
                plugin_host::open_link(app.handle(), link, true);
            }
            if let Err(error) = mail::init(app.handle()) {
                eprintln!("failed to initialize QQ mail: {error}");
            }
            if let Err(error) = qq_notifications::init(app.handle()) {
                eprintln!("failed to initialize QQ notifications: {error}");
            }
            if let Err(error) = wechat_reminders::init(app.handle()) {
                eprintln!("failed to initialize WeChat reminders: {error}");
            }
            if let Err(error) = notification_diagnostics::start(app.handle()) {
                eprintln!("failed to initialize notification diagnostics: {error}");
            }
            #[cfg(target_os = "macos")]
            for label in [clipboard_history::POPUP_WINDOW_LABEL, clipboard_history::preview_window::WINDOW_LABEL, translation::WINDOW_LABEL] {
                if let Some(window) = app.get_webview_window(label) {
                    if let Err(error) = macos::island_panel::make_popup_panel(&window) {
                        eprintln!("failed to make the {label} window a panel: {error}");
                    }
                }
            }
            if let Ok(window) = island::main_window(app.handle()) {
                #[cfg(target_os = "macos")]
                if let Err(error) = macos::island_panel::make_panel(&window) {
                    eprintln!("failed to make the island a panel: {error}");
                }
                let stage = window.clone();
                let sized = app.handle().run_on_main_thread(move || {
                    if let Err(error) = island::apply_stage_geometry(&stage, island::IslandWindowState::default(), false) {
                        eprintln!("failed to size and position island window: {error}");
                    }
                });
                if let Err(error) = sized {
                    eprintln!("failed to size and position island window: {error}");
                }
                island::start_monitor_follow_loop(window.clone());
                island::start_notch_watch(window.clone());
                island::start_cursor_passthrough_loop(window);
            }
            system::fullscreen::start(app.handle());
            media_control::start_session_events(app.handle());
            system_levels::init(app.handle());
            agent_status::init();
            device_events::init(app.handle());
            Ok(())
        })
        .invoke_handler(collect_commands!([]
            file_shelf;
            local_api;
            plugin_host;
            mail;
            wechat_reminders;
            qq_notifications;
            island;
            todos;
            system;
            system_levels;
            device_events;
            agent_status;
            calendar;
            agent_approval;
            claude_usage;
            device_use;
            media_control;
            lyrics;
            clipboard_history;
            translation;
            screenshot;
            recording;
            settings_window;
            settings_file;
            shortcut_capture;
            home_dir;
            onboarding_window;
            ssh_tunnel;
            phone_push;
            cc_connect;
            pets;
            platform_support;
            tray
        ))
        .build(context)
        .map(|app| {
            app.run(|_app, event| match event {
                tauri::RunEvent::Exit => {
                    agent_approval::shutdown();
                    home_dir::before_exit();
                    wechat_reminders::shutdown();
                }
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Opened { urls } => plugin_host::open_opened_links(_app, &urls),
                _ => {}
            })
        });
    if let Err(error) = result {
        eprintln!("error while running Fuyu: {error}");
        std::process::exit(1);
    }
}
