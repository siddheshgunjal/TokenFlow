use tauri::{AppHandle, Manager};

#[cfg(not(target_os = "linux"))]
use tauri::menu::{Menu, MenuItem};

use crate::state::AppState;

/// The tray menu is stateless now: Windows/macOS use two fixed actions and
/// Linux uses an icon-only StatusNotifierItem.
pub struct TrayMenu {}

pub fn create(app: &AppHandle) -> tauri::Result<TrayMenu> {
    #[cfg(target_os = "linux")]
    {
        linux::create(app)
    }
    #[cfg(not(target_os = "linux"))]
    {
        desktop::create(app)
    }
}

#[cfg(not(target_os = "linux"))]
mod desktop {
    use super::*;
    use tauri::tray::TrayIconBuilder;

    pub(super) fn create(app: &AppHandle) -> tauri::Result<TrayMenu> {
        let show_widget = MenuItem::with_id(app, "widget", "Show Widget", true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "quit", "Quit TokenFlow", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&show_widget, &quit])?;

        TrayIconBuilder::with_id("tokenflow-tray")
            .icon(tauri::image::Image::from_bytes(include_bytes!(
                "../icons/128x128.png"
            ))?)
            .tooltip("TokenFlow — Ollama & DeepSeek usage")
            .menu(&menu)
            .show_menu_on_left_click(false)
            .on_menu_event(|app, event| match event.id.as_ref() {
                "widget" => open_widget(app),
                "quit" => app.exit(0),
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let tauri::tray::TrayIconEvent::Click {
                    button: tauri::tray::MouseButton::Left,
                    button_state: tauri::tray::MouseButtonState::Up,
                    position,
                    ..
                } = event
                {
                    let app = tray.app_handle();
                    let state = app.state::<AppState>();
                    if position.x != 0.0 || position.y != 0.0 {
                        state.set_tray_anchor(position.x, position.y);
                    }

                    let _ = crate::commands::toggle_widget_window(app, None);
                }
            })
            .build(app)?;

        Ok(TrayMenu {})
    }

    fn open_widget(app: &AppHandle) {
        if let Some(window) = app.get_webview_window("widget") {
            if let Ok(position) = window.cursor_position() {
                if position.x != 0.0 || position.y != 0.0 {
                    app.state::<AppState>()
                        .set_tray_anchor(position.x, position.y);
                }
            }
        }

        let _ = crate::commands::toggle_widget_window(app, Some(true));
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use std::cell::RefCell;
    use std::ffi::CString;

    use glib::prelude::*;
    use libappindicator_sys::{
        app_indicator_new, app_indicator_set_icon_full, app_indicator_set_menu,
        app_indicator_set_status, app_indicator_set_title,
        AppIndicatorCategory_APP_INDICATOR_CATEGORY_APPLICATION_STATUS,
        AppIndicatorStatus_APP_INDICATOR_STATUS_ACTIVE,
    };

    use super::*;

    thread_local! {
        static TRAY: RefCell<Option<LinuxTray>> = const { RefCell::new(None) };
    }

    struct LinuxTray {
        // Keeps the GObject alive for the lifetime of the tray service.
        #[allow(dead_code)]
        indicator: glib::Object,
        // The indicator keeps its own reference, but retaining the wrapper
        // guarantees the menu outlives the raw indicator setup.
        #[allow(dead_code)]
        menu: gtk::Menu,
    }

    impl LinuxTray {
        fn new(app: &AppHandle) -> Option<Self> {
            let icon_path = tray_icon_path(app);

            let raw = unsafe {
                app_indicator_new(
                    c"tokenflow".as_ptr(),
                    c"".as_ptr(),
                    AppIndicatorCategory_APP_INDICATOR_CATEGORY_APPLICATION_STATUS,
                )
            };
            if raw.is_null() {
                return None;
            }

            let indicator: glib::Object = unsafe { glib::translate::from_glib_full(raw.cast()) };
            let menu = gtk::Menu::new();

            unsafe {
                if let Some(path) = icon_path.as_ref() {
                    if let Ok(icon) = CString::new(path.to_string_lossy().as_bytes()) {
                        app_indicator_set_icon_full(raw, icon.as_ptr(), c"TokenFlow".as_ptr());
                    } else {
                        app_indicator_set_icon_full(
                            raw,
                            c"dialog-information".as_ptr(),
                            c"TokenFlow".as_ptr(),
                        );
                    }
                } else {
                    app_indicator_set_icon_full(
                        raw,
                        c"dialog-information".as_ptr(),
                        c"TokenFlow".as_ptr(),
                    );
                }

                app_indicator_set_title(raw, c"TokenFlow".as_ptr());

                // Set the menu last so the first check_connect sees both the
                // real icon and a menu. The menu stays empty so GNOME does not
                // show a label or any menu actions.
                app_indicator_set_menu(raw, menu.as_ptr().cast());
            }

            let app = app.clone();
            indicator.connect_local("activate", false, move |values| {
                let x = values
                    .get(1)
                    .and_then(|value| value.get::<i32>().ok())
                    .unwrap_or_default();
                let y = values
                    .get(2)
                    .and_then(|value| value.get::<i32>().ok())
                    .unwrap_or_default();

                tracing::debug!(x, y, "Linux tray activated");
                let state = app.state::<AppState>();
                state.set_tray_anchor_logical(x as f64, y as f64);

                if let Err(err) = crate::commands::toggle_widget_window(&app, Some(true)) {
                    tracing::warn!(%err, "could not open the widget from the tray");
                }
                if let Some(widget) = app.get_webview_window("widget") {
                    let _ = widget.set_focus();
                }

                None
            });

            unsafe {
                app_indicator_set_status(raw, AppIndicatorStatus_APP_INDICATOR_STATUS_ACTIVE);
            }

            Some(Self { indicator, menu })
        }
    }

    pub(super) fn create(app: &AppHandle) -> tauri::Result<TrayMenu> {
        match LinuxTray::new(app) {
            Some(tray) => {
                TRAY.with(|slot| {
                    *slot.borrow_mut() = Some(tray);
                });
            }
            None => tracing::warn!("could not initialize the Linux status notifier item"),
        }

        Ok(TrayMenu {})
    }

    fn tray_icon_path(app: &AppHandle) -> Option<std::path::PathBuf> {
        let dir = app.path().app_data_dir().ok()?;
        std::fs::create_dir_all(&dir).ok()?;
        let path = dir.join("tokenflow-tray.png");
        std::fs::write(&path, include_bytes!("../icons/128x128.png")).ok()?;
        Some(path)
    }
}
