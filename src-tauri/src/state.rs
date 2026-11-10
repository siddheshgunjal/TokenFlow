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

/// Tracks proxy traffic for the idle re-exec.
///
/// The recycle may only run when no request is being forwarded. A guard is
/// held for the whole lifetime of a proxied request, including its streaming
/// response, so a long Ollama generation can never be interrupted. The last
/// activity timestamp is touched on both start and finish, so the idle window
/// also starts after the final stream ends.
#[derive(Default)]
pub struct ProxyActivity {
    in_flight: AtomicU64,
    last_activity: AtomicI64,
}

pub struct ProxyActivityGuard {
    activity: Arc<ProxyActivity>,
}

impl ProxyActivity {
    pub fn begin(self: &Arc<Self>) -> ProxyActivityGuard {
        self.in_flight.fetch_add(1, Ordering::SeqCst);
        self.touch();
        ProxyActivityGuard {
            activity: Arc::clone(self),
        }
    }

    fn touch(&self) {
        self.last_activity
            .store(chrono::Utc::now().timestamp(), Ordering::SeqCst);
    }

    pub fn in_flight(&self) -> u64 {
        self.in_flight.load(Ordering::SeqCst)
    }

    /// Unix timestamp of the last request start or finish; `0` before any
    /// request has been proxied.
    pub fn last_activity(&self) -> i64 {
        self.last_activity.load(Ordering::SeqCst)
    }
}

impl Drop for ProxyActivityGuard {
    fn drop(&mut self) {
        self.activity.in_flight.fetch_sub(1, Ordering::SeqCst);
        self.activity.touch();
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
    /// Proxy request accounting for the idle re-exec.
    pub proxy_activity: Arc<ProxyActivity>,
    /// Set once any webview has been created in this process. Only then can an
    /// idle re-exec release meaningful UI-process memory.
    pub webview_created: Arc<AtomicBool>,
    proxy_status: Arc<RwLock<ProxyStatus>>,
    settings: Arc<RwLock<Settings>>,
    secrets: Arc<RwLock<SecretState>>,
    /// Last tray icon activation position.
    tray_anchor: Arc<RwLock<Option<TrayAnchor>>>,
    /// Serializes on-demand window creation so two simultaneous requests do
    /// not build the same window twice. Used by the window lifecycle module.
    pub window_lock: Arc<Mutex<()>>,
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
            // The poller is sequential, so one warm connection covers it.
            // Without a cap reqwest keeps idle connections per host without
            // limit; a desktop process that lives for days should never
            // accumulate them.
            .pool_max_idle_per_host(2)
            .pool_idle_timeout(Duration::from_secs(30))
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
            proxy_activity: Arc::new(ProxyActivity::default()),
            webview_created: Arc::new(AtomicBool::new(false)),
            proxy_status,
            settings: Arc::new(RwLock::new(settings)),
            secrets: Arc::new(RwLock::new(secret_state)),
            tray_anchor: Arc::new(RwLock::new(None)),
            window_lock: Arc::new(Mutex::new(())),
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

    pub fn mark_webview_created(&self) {
        self.webview_created.store(true, Ordering::SeqCst);
    }

    pub fn has_webview(&self) -> bool {
        self.webview_created.load(Ordering::SeqCst)
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
}
