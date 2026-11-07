use std::{
    sync::{
        atomic::{AtomicBool, AtomicI64, AtomicU32, AtomicU64, Ordering},
        Arc, Mutex, RwLock,
    },
    time::Duration,
};

use tauri::{AppHandle, Manager};
use tokio::sync::Mutex as AsyncMutex;

use crate::{
    db::Db,
    error::AppError,
    models::ProxyStatus,
    secrets::{self, KeySource, KeyringStore, Secret, SecretState},
    settings::Settings,
    snapshot::SnapshotService,
};

/// Serializes DeepSeek provider refreshes so that double-clicks and two open
/// windows produce one network call, not two. The lock and timestamp are
/// cloned through `Arc`s so the coordinator itself stays cheaply `Clone`.
#[derive(Clone)]
pub struct RefreshCoordinator {
    pub lock: Arc<AsyncMutex<()>>,
    pub last_refresh_at: Arc<AtomicI64>,
}

impl RefreshCoordinator {
    pub fn new() -> Self {
        Self {
            lock: Arc::new(AsyncMutex::new(())),
            last_refresh_at: Arc::new(AtomicI64::new(0)),
        }
    }
}

/// Where the widget should be anchored.
///
/// Windows, macOS, and Linux tray activations all report physical screen
/// coordinates. Linux uses the pointer position at activation because the
/// status-notifier hint is expressed in logical stage coordinates.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum TrayAnchor {
    Physical(f64, f64),
}

/// Per-window visibility plus the "renderer suspended" flag.
///
/// On Linux the windows and their webviews are created once and kept for the
/// app's lifetime: closing a window hides it and kills its web process, and the
/// next reveal reloads the page. That avoids the per-cycle window/webview churn
/// that leaks UI-side memory in wry/Tauri. Other platforms still destroy and
/// recreate the windows, so the suspended flag stays false there.
#[derive(Clone)]
pub struct WindowFlags {
    visible: Arc<AtomicBool>,
    suspended: Arc<AtomicBool>,
    visible_count: Arc<AtomicU32>,
}

impl WindowFlags {
    fn new(visible_count: Arc<AtomicU32>) -> Self {
        Self {
            visible: Arc::new(AtomicBool::new(false)),
            suspended: Arc::new(AtomicBool::new(false)),
            visible_count,
        }
    }

    /// Marks the window shown/hidden, keeping the shared visible-window count
    /// accurate even when this is called repeatedly with the same value.
    pub fn set_visible(&self, visible: bool) {
        let was = self.visible.swap(visible, Ordering::SeqCst);
        if was == visible {
            return;
        }

        if visible {
            self.visible_count.fetch_add(1, Ordering::SeqCst);
        } else {
            self.visible_count.fetch_sub(1, Ordering::SeqCst);
        }
    }

    pub fn set_suspended(&self, suspended: bool) {
        self.suspended.store(suspended, Ordering::SeqCst);
    }

    /// Clears the suspended flag and reports whether the window needs a reload.
    pub fn take_suspended(&self) -> bool {
        self.suspended.swap(false, Ordering::SeqCst)
    }
}

/// Shared state injected into Tauri commands and background workers.
#[derive(Clone)]
pub struct AppState {
    pub db: Db,
    /// The single core-owned snapshot path. All reads and rebuilds go through
    /// this; the UI never queries the database directly.
    pub snapshots: SnapshotService,
    /// Single-flight guard for DeepSeek provider refreshes.
    pub refresh: RefreshCoordinator,
    pub deepseek_http: reqwest::Client,
    /// Lifecycle flags for the dashboard window.
    pub main_window: WindowFlags,
    /// Lifecycle flags for the widget window.
    pub widget_window: WindowFlags,
    /// Number of windows currently shown. The snapshot bridge skips emissions
    /// when every window is hidden.
    pub visible_windows: Arc<AtomicU32>,
    proxy_status: Arc<RwLock<ProxyStatus>>,
    settings: Arc<RwLock<Settings>>,
    secrets: Arc<RwLock<SecretState>>,
    /// Last tray icon activation position.
    tray_anchor: Arc<RwLock<Option<TrayAnchor>>>,
    /// Serializes on-demand window creation so two simultaneous requests do
    /// not build the same window twice. Used by the window lifecycle module.
    pub window_lock: Arc<Mutex<()>>,
    /// Bumped on every widget show/hide so a pending eviction task can tell
    /// whether it is still the current hide generation.
    widget_hide_generation: Arc<AtomicU64>,
    app: AppHandle,
}

impl AppState {
    pub fn initialize(app: &AppHandle) -> Result<Self, AppError> {
        let data_dir = app.path().app_data_dir()?;
        std::fs::create_dir_all(&data_dir)?;

        let db = Db::open(&data_dir.join("tokenflow.db"))?;
        let settings = Settings::load(&db)?;
        let secret_state = secrets::resolve(&db, &KeyringStore::new());
        if let Some(error) = secret_state.error() {
            tracing::warn!(%error, "DeepSeek key storage is degraded");
        }

        let proxy_status = Arc::new(RwLock::new(ProxyStatus::default()));
        let snapshots = SnapshotService::new(db.clone(), proxy_status.clone());

        let deepseek_http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .user_agent(concat!("TokenFlow/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|err| AppError::Config(format!("Could not create HTTP client: {err}")))?;

        tracing::info!(
            path = %data_dir.display(),
            "TokenFlow storage initialized"
        );

        let visible_windows = Arc::new(AtomicU32::new(0));

        Ok(Self {
            db,
            snapshots,
            refresh: RefreshCoordinator::new(),
            deepseek_http,
            main_window: WindowFlags::new(visible_windows.clone()),
            widget_window: WindowFlags::new(visible_windows.clone()),
            visible_windows,
            proxy_status,
            settings: Arc::new(RwLock::new(settings)),
            secrets: Arc::new(RwLock::new(secret_state)),
            tray_anchor: Arc::new(RwLock::new(None)),
            window_lock: Arc::new(Mutex::new(())),
            widget_hide_generation: Arc::new(AtomicU64::new(0)),
            app: app.clone(),
        })
    }

    pub fn settings(&self) -> Settings {
        self.settings
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    pub fn app_handle(&self) -> AppHandle {
        self.app.clone()
    }

    pub fn update_settings(&self, settings: Settings) -> Result<(), AppError> {
        settings.save(&self.db)?;
        *self
            .settings
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = settings;
        Ok(())
    }

    /// The active DeepSeek key. Cloning creates a new zeroizing allocation; the
    /// original copy in state remains until it is replaced or the app exits.
    pub fn deepseek_secret(&self) -> Option<Secret> {
        self.secrets
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .key()
    }

    pub fn has_deepseek_key(&self) -> bool {
        self.secrets
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .has_key()
    }

    pub fn deepseek_key_source(&self) -> Option<KeySource> {
        self.secrets
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .source()
    }

    pub fn deepseek_key_error(&self) -> Option<String> {
        self.secrets
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .error()
            .map(str::to_string)
    }

    pub fn replace_secret_state(&self, state: SecretState) {
        *self
            .secrets
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = state;
    }

    pub fn proxy_status(&self) -> ProxyStatus {
        self.proxy_status
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    pub fn update_proxy_status(&self, status: ProxyStatus) {
        *self
            .proxy_status
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = status.clone();

        // The proxy status is part of the core snapshot; a change means the
        // next rebuild (and the next `core-snapshot` event) carries it.
        self.snapshots.mark_dirty();
    }

    /// Store a physical-pixel anchor from a tray activation.
    pub fn set_tray_anchor(&self, x: f64, y: f64) {
        *self
            .tray_anchor
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(TrayAnchor::Physical(x, y));
    }

    pub fn tray_anchor(&self) -> Option<TrayAnchor> {
        *self
            .tray_anchor
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Invalidates any pending widget eviction. Called whenever the widget is
    /// shown so a stale timer can never destroy a visible window.
    pub fn cancel_widget_eviction(&self) {
        self.widget_hide_generation.fetch_add(1, Ordering::SeqCst);
    }

    /// Schedules suspension of the warm widget once it has been hidden for
    /// `widget_eviction_secs`. On Linux this kills the widget's web process and
    /// keeps the (hidden) window for a leak-free reload on the next open; other
    /// platforms destroy the window. A value of `0` disables eviction.
    ///
    /// The hide generation guards against races: showing or re-hiding the
    /// widget bumps it, so only the latest timer acts.
    pub fn schedule_widget_eviction(&self) {
        let seconds = self.settings().widget_eviction_secs;
        if seconds == 0 {
            return;
        }

        let generation = self.widget_hide_generation.fetch_add(1, Ordering::SeqCst) + 1;
        let state = self.clone();
        let flags = self.widget_window.clone();
        let app = self.app.clone();

        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_secs(seconds)).await;

            // A newer show/hide superseded this timer.
            if state.widget_hide_generation.load(Ordering::SeqCst) != generation {
                return;
            }

            // Do the check and the teardown in one main-thread turn so WebKit
            // cannot respawn the process between them.
            let app_for_task = app.clone();
            let _ = app.run_on_main_thread(move || {
                let Some(window) = app_for_task.get_webview_window("widget") else {
                    return;
                };
                if window.is_visible().unwrap_or(false) {
                    return;
                }

                tracing::debug!(seconds, "suspending the idle widget renderer");

                #[cfg(target_os = "linux")]
                {
                    // Kill the renderer but keep the window and webview so the
                    // next open reloads instead of rebuilding the whole widget
                    // (which leaks UI-side memory per cycle in wry/Tauri).
                    crate::windows::terminate_web_process(&window);
                    flags.set_suspended(true);
                }

                #[cfg(not(target_os = "linux"))]
                {
                    let _ = flags;
                    let _ = window.destroy();
                }
            });
        });
    }
}
