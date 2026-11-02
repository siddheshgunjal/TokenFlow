mod commands;
mod db;
mod deepseek;
mod error;
mod models;
mod proxy;
mod settings;
mod state;
mod tray;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    configure_linux_backend();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
                tracing_subscriber::EnvFilter::new("tokenflow=info,tower_http=warn")
            }),
        )
        .with_target(false)
        .compact()
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let state = state::AppState::initialize(&handle)?;
            let _ = app.manage(state.clone());

            tray::create(&handle)?;
            state::spawn_event_forwarder(handle.clone(), state.events.subscribe());

            let settings = state.settings();

            if settings.show_widget_on_start {
                let _ = commands::toggle_widget_window(&handle, Some(true));
            } else if let Some(widget) = app.get_webview_window("widget") {
                let _ = widget.set_always_on_top(settings.widget_always_on_top);
            }

            if settings.start_minimized {
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.hide();
                }
            }

            proxy::spawn(state.clone());
            deepseek::spawn_worker(state.clone());

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let state = window.state::<state::AppState>();
                    if state.settings().close_to_tray {
                        api.prevent_close();
                        let _ = window.hide();
                    } else {
                        window.app_handle().exit(0);
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_dashboard,
            commands::get_settings,
            commands::save_settings,
            commands::save_deepseek_api_key,
            commands::get_deepseek_status,
            commands::refresh_deepseek_balance,
            commands::clear_usage_data,
            commands::get_proxy_status,
            commands::show_main_window,
            commands::toggle_widget,
            commands::quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running TokenFlow");
}

/// GNOME (and other Wayland compositors) do not let a client position a regular
/// toplevel window. Running through XWayland restores `set_position`, which is
/// required to anchor the widget to the tray icon. This is Linux-only and can
/// be disabled with `TOKENFLOW_NO_XWAYLAND=1`.
#[cfg(target_os = "linux")]
fn configure_linux_backend() {
    if std::env::var_os("TOKENFLOW_NO_XWAYLAND").is_some()
        || std::env::var_os("GDK_BACKEND").is_some()
    {
        return;
    }

    let session = std::env::var("XDG_SESSION_TYPE").unwrap_or_default();
    let wayland =
        session.eq_ignore_ascii_case("wayland") || std::env::var_os("WAYLAND_DISPLAY").is_some();
    let has_x11 = local_x11_socket_available();

    if wayland && has_x11 {
        // Prefer XWayland, but let GTK fall back to Wayland if X11 is
        // unavailable (for example inside a restricted sandbox).
        std::env::set_var("GDK_BACKEND", "x11,wayland");
        eprintln!("TokenFlow: preferring XWayland for exact widget placement");
    }
}

#[cfg(target_os = "linux")]
fn local_x11_socket_available() -> bool {
    let Ok(display) = std::env::var("DISPLAY") else {
        return false;
    };

    // Remote/TCP displays do not use the local socket directory.
    if !display.starts_with(':') && !display.starts_with("unix:") {
        return true;
    }

    let Some(number) = display
        .rsplit(':')
        .next()
        .and_then(|value| value.split('.').next())
    else {
        return false;
    };

    std::path::Path::new(&format!("/tmp/.X11-unix/X{number}")).exists()
}

#[cfg(not(target_os = "linux"))]
fn configure_linux_backend() {}
