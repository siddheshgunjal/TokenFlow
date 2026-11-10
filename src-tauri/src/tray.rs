use tauri::{AppHandle, Manager};

#[cfg(not(target_os = "linux"))]
use tauri::menu::{Menu, MenuItem};

use crate::state::AppState;

/// The tray menu is stateless now: Windows/macOS use two fixed actions and
/// Linux uses a status notifier item.
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
                "../icons/tray-64.png"
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
    use std::sync::LazyLock;

    use ksni::blocking::{Handle, TrayMethods};
    use ksni::menu::{MenuItem, StandardItem};
    use ksni::{Category, Icon, Status, ToolTip, Tray};

    use image::GenericImageView;

    use super::*;

    /// Embedded so the host panel never has to resolve an icon name inside the
    /// Flatpak sandbox. `Icon` expects ARGB32 in network byte order.
    static ICON: LazyLock<Icon> = LazyLock::new(|| {
        let image = image::load_from_memory_with_format(
            include_bytes!("../icons/tray-128.png"),
            image::ImageFormat::Png,
        )
        .expect("embedded tray icon is a valid PNG");
        let (width, height) = image.dimensions();
        let mut data = image.into_rgba8().into_vec();
        for pixel in data.as_chunks_mut::<4>().0 {
            pixel.rotate_right(1); // RGBA -> ARGB
        }
        Icon {
            width: width as i32,
            height: height as i32,
            data,
        }
    });

    thread_local! {
        // Dropping the handle stops the tray service.
        static TRAY: RefCell<Option<Handle<TokenFlowTray>>> = const { RefCell::new(None) };
    }

    struct TokenFlowTray {
        app: AppHandle,
        last_anchor: Option<(i32, i32)>,
    }

    impl Tray for TokenFlowTray {
        fn id(&self) -> String {
            "tokenflow".into()
        }

        fn title(&self) -> String {
            "TokenFlow".into()
        }

        fn category(&self) -> Category {
            Category::ApplicationStatus
        }

        fn status(&self) -> Status {
            Status::Active
        }

        fn icon_pixmap(&self) -> Vec<Icon> {
            vec![ICON.clone()]
        }

        fn tool_tip(&self) -> ToolTip {
            ToolTip {
                title: "TokenFlow".into(),
                description: "Local token usage analytics for Ollama and DeepSeek".into(),
                ..Default::default()
            }
        }

        fn activate(&mut self, x: i32, y: i32) {
            self.last_anchor = Some((x, y));
            open_widget(&self.app, self.last_anchor);
        }

        fn secondary_activate(&mut self, x: i32, y: i32) {
            self.last_anchor = Some((x, y));
            open_widget(&self.app, self.last_anchor);
        }

        fn menu(&self) -> Vec<MenuItem<Self>> {
            vec![
                MenuItem::Standard(StandardItem {
                    label: "Open TokenFlow".into(),
                    activate: Box::new(|tray| open_widget(&tray.app, tray.last_anchor)),
                    ..Default::default()
                }),
                MenuItem::Separator,
                MenuItem::Standard(StandardItem {
                    label: "Quit TokenFlow".into(),
                    activate: Box::new(|tray| tray.app.exit(0)),
                    ..Default::default()
                }),
            ]
        }
    }

    pub(super) fn create(app: &AppHandle) -> tauri::Result<TrayMenu> {
        let flatpak = crate::platform::is_flatpak();

        let service = TokenFlowTray {
            app: app.clone(),
            last_anchor: None,
        }
        // A sandbox cannot own the process-derived well-known name. Falling
        // back to the unique connection name is the supported Flatpak path.
        .disable_dbus_name(flatpak)
        // Start even if the AppIndicator extension is not running yet; the
        // service reconnects when the watcher appears.
        .assume_sni_available(true)
        .spawn();

        match service {
            Ok(handle) => {
                TRAY.with(|slot| {
                    *slot.borrow_mut() = Some(handle);
                });
            }
            Err(err) => tracing::warn!(%err, "could not initialize the Linux status notifier item"),
        }

        Ok(TrayMenu {})
    }

    /// Open the widget using the activation hint from the status notifier.
    ///
    /// The hint is in the host's logical stage coordinates. On this app's
    /// target layouts (both monitors at scale 1) that is the physical position
    /// of the tray icon. Do not read `cursor_position()` here: while the
    /// pointer is over a Wayland panel, XWayland can report a stale position
    /// from the last X11 window, which made repeated opens drift toward the
    /// previous widget location.
    fn open_widget(app: &AppHandle, anchor: Option<(i32, i32)>) {
        let app = app.clone();
        let task_app = app.clone();
        let _ = app.run_on_main_thread(move || {
            let state = task_app.state::<AppState>();
            match anchor {
                Some((x, y)) if x != 0 || y != 0 => {
                    state.set_tray_anchor(x as f64, y as f64);
                }
                _ => {
                    // Menu activation without a prior hint. This is a best-effort
                    // fallback; normal tray activation always supplies a hint.
                    if let Ok(position) = task_app.cursor_position() {
                        state.set_tray_anchor(position.x, position.y);
                    }
                }
            }

            if let Err(err) = crate::commands::toggle_widget_window(&task_app, Some(true)) {
                tracing::warn!(%err, "could not open the widget from the tray");
            }
            if let Some(widget) = task_app.get_webview_window("widget") {
                // Do not focus a hidden widget: reveal_widget focuses it once
                // the frontend reports readiness. Focusing here can map the
                // window before the page has content and cause a flash.
                if widget.is_visible().unwrap_or(false) {
                    let _ = widget.set_focus();
                }
            }
        });
    }
}
