use std::{
    sync::{Arc, RwLock},
    time::Duration,
};

use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::broadcast;

use crate::{
    db::Db,
    error::AppError,
    models::{MetricEvent, ProxyStatus},
    settings::Settings,
};

/// Where the widget should be anchored.
///
/// Windows/macOS tray events report physical pixels. Linux StatusNotifierItem
/// activation reports GNOME stage coordinates, which are logical pixels; they
/// must be converted with the monitor scale factor before positioning an
/// XWayland window.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum TrayAnchor {
    #[cfg_attr(target_os = "linux", allow(dead_code))]
    Physical(f64, f64),
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    Logical(f64, f64),
}

/// Shared state injected into Tauri commands and background workers.
#[derive(Clone)]
pub struct AppState {
    pub db: Db,
    pub events: broadcast::Sender<MetricEvent>,
    pub deepseek_http: reqwest::Client,
    proxy_status: Arc<RwLock<ProxyStatus>>,
    settings: Arc<RwLock<Settings>>,
    /// Last tray icon activation position.
    tray_anchor: Arc<RwLock<Option<TrayAnchor>>>,
    app: AppHandle,
}

impl AppState {
    pub fn initialize(app: &AppHandle) -> Result<Self, AppError> {
        let data_dir = app.path().app_data_dir()?;
        std::fs::create_dir_all(&data_dir)?;

        let db = Db::open(&data_dir.join("tokenflow.db"))?;
        let settings = Settings::load(&db)?;
        let (events, _) = broadcast::channel(256);

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

        Ok(Self {
            db,
            events,
            deepseek_http,
            proxy_status: Arc::new(RwLock::new(ProxyStatus::default())),
            settings: Arc::new(RwLock::new(settings)),
            tray_anchor: Arc::new(RwLock::new(None)),
            app: app.clone(),
        })
    }

    pub fn settings(&self) -> Settings {
        self.settings
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    pub fn update_settings(&self, settings: Settings) -> Result<(), AppError> {
        settings.save(&self.db)?;
        *self
            .settings
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = settings;
        Ok(())
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

        if let Err(err) = self.app.emit("proxy-status", &status) {
            tracing::warn!(%err, "could not emit proxy status event");
        }
    }

    pub fn emit_metric(&self, event: MetricEvent) {
        // A send error only means there are no subscribers; that is harmless.
        let _ = self.events.send(event);
    }

    /// Store a physical-pixel anchor (Windows/macOS tray clicks).
    #[cfg_attr(target_os = "linux", allow(dead_code))]
    pub fn set_tray_anchor(&self, x: f64, y: f64) {
        *self
            .tray_anchor
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(TrayAnchor::Physical(x, y));
    }

    /// Store a logical-pixel anchor (Linux StatusNotifierItem activation).
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    pub fn set_tray_anchor_logical(&self, x: f64, y: f64) {
        *self
            .tray_anchor
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(TrayAnchor::Logical(x, y));
    }

    pub fn tray_anchor(&self) -> Option<TrayAnchor> {
        *self
            .tray_anchor
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Bridges the Tokio broadcast channel to Tauri's webview event system.
pub fn spawn_event_forwarder(app: AppHandle, mut receiver: broadcast::Receiver<MetricEvent>) {
    tauri::async_runtime::spawn(async move {
        loop {
            match receiver.recv().await {
                Ok(event) => {
                    let name = match &event {
                        MetricEvent::OllamaUsage { .. } => "ollama-usage",
                        MetricEvent::DeepSeekBalance { .. } => "deepseek-balance",
                    };

                    if let Err(err) = app.emit(name, &event) {
                        tracing::warn!(%err, event = name, "could not emit metric event");
                    }
                }
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    tracing::warn!(skipped, "metric event forwarder lagged");
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}
