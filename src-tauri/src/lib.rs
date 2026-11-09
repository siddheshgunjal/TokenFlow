mod autostart;
mod commands;
mod db;
mod deepseek;
mod error;
#[cfg(feature = "heap-stats")]
mod heap_stats;
mod memory;
#[cfg(test)]
mod memory_stress;
mod models;
mod platform;
mod proxy;
mod secrets;
mod settings;
mod snapshot;
mod startup;
mod state;
mod tray;
mod windows;

use tauri::{Manager, RunEvent};

/// Optional allocation accounting for long-running memory captures. The
/// feature is off by default; the allocator is a plain `System` delegate with
/// counters, so it changes nothing else about the process.
#[cfg(feature = "heap-stats")]
#[global_allocator]
static GLOBAL_ALLOCATOR: heap_stats::CountingAllocator = heap_stats::CountingAllocator;

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
        // The single-instance plugin must be registered before every other
        // plugin so a second launch exits before any worker or tray starts.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if startup::has_autostart_arg(&argv) {
                return;
            }

            focus_dashboard(app);
        }))
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("TokenFlow")
                .arg(startup::AUTOSTART_ARG)
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let state = state::AppState::initialize(&handle)?;
            let _ = app.manage(state.clone());

            tray::create(&handle)?;
            // The core owns all snapshot building and refresh coordination.
            // The scheduler seeds an initial rebuild and coalesces dirty
            // signals; the bridge forwards `core-snapshot` to open windows.
            snapshot::spawn_scheduler(state.snapshots.clone());
            snapshot::spawn_bridge(
                handle.clone(),
                state.snapshots.subscribe(),
                state.visible_windows.clone(),
            );

            // Keep the UI-process caches bounded while no window is visible.
            memory::spawn_idle_cache_trim(handle.clone(), state.visible_windows.clone());
            #[cfg(feature = "heap-stats")]
            heap_stats::spawn_reporter();

            let settings = state.settings();
            if startup::is_autostart_launch() {
                // An autostart launch creates no windows at all. The core, tray,
                // and proxy run headless; the user opens the dashboard or
                // widget explicitly from the tray.
                tracing::debug!("started by the login item; no windows created");
            } else {
                // Manual launch: create and show the dashboard unless the user
                // prefers to start minimized.
                if !settings.start_minimized {
                    let _ = commands::show_main_window(handle.clone());
                }

                if settings.show_widget_on_start {
                    let _ = commands::toggle_widget_window(&handle, Some(true));
                }
            }

            proxy::spawn(state.clone());
            deepseek::spawn_worker(state.clone());

            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                if window.label() == "main" {
                    let state = window.state::<state::AppState>();
                    if !state.settings().close_to_tray {
                        // Explicit quit: `exit(0)` produces an `ExitRequested`
                        // with `code: Some(0)`, which the run handler lets
                        // through.
                        window.app_handle().exit(0);
                        return;
                    }

                    api.prevent_close();
                    state.main_window.set_visible(false);

                    #[cfg(target_os = "linux")]
                    {
                        // Keep the core and the window (hidden) alive, but kill
                        // the dashboard renderer so its ~100 MB web process is
                        // released. The next open reloads the page. Rebuilding
                        // the window/webview per open/close leaks UI-side memory
                        // in wry/Tauri, so Linux never destroys them.
                        let _ = window.hide();
                        if let Some(webview) = window.app_handle().get_webview_window("main") {
                            crate::windows::terminate_web_process(&webview);
                        }
                        state.main_window.set_suspended(true);
                    }

                    #[cfg(not(target_os = "linux"))]
                    {
                        let _ = window.destroy();
                    }
                }
            }
            tauri::WindowEvent::Destroyed => {
                // Debug-level so the window lifecycle can be verified with
                // `RUST_LOG=tokenflow=debug` without normal-run noise.
                tracing::debug!(label = window.label(), "window destroyed");
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_core_snapshot,
            commands::refresh_core,
            commands::get_dashboard,
            commands::get_settings,
            commands::save_settings,
            commands::save_deepseek_api_key,
            commands::retry_deepseek_keychain,
            commands::get_deepseek_status,
            commands::get_balance_history,
            commands::refresh_deepseek_balance,
            commands::clear_usage_data,
            commands::get_day_usage_detail,
            commands::get_model_catalog,
            commands::delete_model_data,
            commands::merge_models,
            commands::get_proxy_status,
            commands::show_main_window,
            commands::toggle_widget,
            commands::quit_app,
        ])
        .build(tauri::generate_context!())
        .expect("error while building TokenFlow")
        .run(|app_handle, event| {
            // The last window was destroyed. Keep the core and tray alive; only
            // an explicit quit (code `Some`) may exit the process.
            if let RunEvent::ExitRequested {
                code: None, api, ..
            } = event
            {
                api.prevent_exit();
                return;
            }

            #[cfg(target_os = "macos")]
            if let RunEvent::Reopen { .. } = event {
                // Dock reactivation recreates the dashboard.
                focus_dashboard(app_handle);
            }

            #[cfg(not(target_os = "macos"))]
            {
                let _ = app_handle;
            }
        });
}

/// Brings the dashboard forward for a second launch or a macOS dock reactivation.
///
/// The single-instance listener can run before Tauri has created the windows
/// from the configuration, so retry briefly instead of dropping the request.
fn focus_dashboard(app: &tauri::AppHandle) {
    if commands::show_main_window(app.clone()).is_ok() {
        return;
    }

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        for _ in 0..40 {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            if commands::show_main_window(app.clone()).is_ok() {
                return;
            }
        }

        tracing::warn!("could not focus the dashboard");
    });
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
