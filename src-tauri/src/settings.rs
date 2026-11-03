use std::env;

use serde::{Deserialize, Serialize};

use crate::{db::Db, error::AppError};

const SETTINGS_KEY: &str = "app_settings";
/// Legacy plaintext storage key. It is read only to migrate the key into the OS
/// keychain and is deleted immediately afterwards.
pub const LEGACY_DEEPSEEK_KEY: &str = "deepseek_api_key";

/// User-facing configuration.
///
/// Environment variables are used only as first-launch defaults (except for the
/// DeepSeek key, which is resolved separately: the environment takes precedence
/// over the OS keychain and is never persisted).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub upstream_url: String,
    pub proxy_port: u16,
    pub deepseek_poll_interval_secs: u64,
    pub deepseek_base_url: String,
    pub start_minimized: bool,
    pub close_to_tray: bool,
    pub widget_always_on_top: bool,
    pub show_widget_on_start: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            upstream_url: env::var("TOKENFLOW_UPSTREAM_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:11434".to_string()),
            proxy_port: env::var("TOKENFLOW_PROXY_PORT")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(11435),
            deepseek_poll_interval_secs: env::var("TOKENFLOW_DEEPSEEK_POLL_SECS")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(900),
            deepseek_base_url: env::var("TOKENFLOW_DEEPSEEK_BASE_URL")
                .unwrap_or_else(|_| "https://api.deepseek.com".to_string()),
            start_minimized: false,
            close_to_tray: true,
            widget_always_on_top: true,
            show_widget_on_start: false,
        }
    }
}

impl Settings {
    pub fn load(db: &Db) -> Result<Self, AppError> {
        match db.get_setting(SETTINGS_KEY)? {
            Some(raw) => match serde_json::from_str::<Self>(&raw) {
                Ok(settings) => Ok(settings.normalized()),
                Err(err) => {
                    tracing::warn!(%err, "invalid settings blob; falling back to defaults");
                    Ok(Self::default().normalized())
                }
            },
            None => Ok(Self::default().normalized()),
        }
    }

    pub fn save(&self, db: &Db) -> Result<(), AppError> {
        let raw = serde_json::to_string(self)?;
        db.set_setting(SETTINGS_KEY, &raw)?;
        Ok(())
    }

    pub fn normalized(mut self) -> Self {
        self.upstream_url = self.upstream_url.trim().trim_end_matches('/').to_string();
        self.deepseek_base_url = self
            .deepseek_base_url
            .trim()
            .trim_end_matches('/')
            .to_string();
        self.deepseek_poll_interval_secs = self.deepseek_poll_interval_secs.clamp(60, 86_400);
        self
    }

    pub fn validate(&self) -> Result<(), AppError> {
        if !(1024..=65_535).contains(&self.proxy_port) {
            return Err(AppError::Config(
                "Proxy port must be between 1024 and 65535.".to_string(),
            ));
        }

        let upstream = reqwest::Url::parse(&self.upstream_url)
            .map_err(|err| AppError::Config(format!("Upstream URL is invalid: {err}")))?;

        if !matches!(upstream.scheme(), "http" | "https") {
            return Err(AppError::Config(
                "Upstream URL must use http:// or https://.".to_string(),
            ));
        }

        let upstream_host = upstream.host_str().unwrap_or_default();
        if is_loopback(upstream_host) && upstream.port_or_known_default() == Some(self.proxy_port) {
            return Err(AppError::Config(
                "The proxy port cannot be the same as the Ollama port.".to_string(),
            ));
        }

        if !(60..=86_400).contains(&self.deepseek_poll_interval_secs) {
            return Err(AppError::Config(
                "DeepSeek polling interval must be between 60 and 86400 seconds.".to_string(),
            ));
        }

        let deepseek = reqwest::Url::parse(&self.deepseek_base_url)
            .map_err(|err| AppError::Config(format!("DeepSeek base URL is invalid: {err}")))?;

        if !matches!(deepseek.scheme(), "http" | "https") {
            return Err(AppError::Config(
                "DeepSeek base URL must use http:// or https://.".to_string(),
            ));
        }

        let deepseek_host = deepseek.host_str().unwrap_or_default();
        if deepseek.scheme() != "https" && !is_loopback(deepseek_host) {
            return Err(AppError::Config(
                "DeepSeek base URL must use HTTPS (except for localhost testing).".to_string(),
            ));
        }

        Ok(())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub settings: Settings,
    pub has_deepseek_api_key: bool,
    pub deepseek_key_source: Option<String>,
    /// A keychain or migration problem that the Settings screen should show.
    pub deepseek_key_error: Option<String>,
    pub restart_required: bool,
}

fn is_loopback(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1" | "[::1]")
}
