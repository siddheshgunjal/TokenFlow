use std::env;

use serde::{Deserialize, Serialize};

use crate::{db::Db, error::AppError};

const SETTINGS_KEY: &str = "app_settings";
pub const DEEPSEEK_KEY: &str = "deepseek_api_key";
pub const DEEPSEEK_KEY_ENV: &str = "DEEPSEEK_API_KEY";

/// User-facing configuration.
///
/// Environment variables are used only as first-launch defaults (except for the
/// DeepSeek key, where the environment intentionally takes precedence so a key
/// never has to be written to disk).
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
    pub restart_required: bool,
}

/// The environment wins over the locally stored key so users can avoid writing
/// secrets to disk. This precedence is surfaced in the settings UI.
pub fn deepseek_api_key(db: &Db) -> Option<String> {
    match env::var(DEEPSEEK_KEY_ENV) {
        Ok(value) if !value.trim().is_empty() => return Some(value.trim().to_string()),
        _ => {}
    }

    match db.get_setting(DEEPSEEK_KEY) {
        Ok(Some(value)) if !value.trim().is_empty() => Some(value.trim().to_string()),
        Ok(_) => None,
        Err(err) => {
            tracing::warn!(%err, "could not read the DeepSeek API key from settings");
            None
        }
    }
}

pub fn deepseek_key_source(db: &Db) -> Option<&'static str> {
    if let Ok(value) = env::var(DEEPSEEK_KEY_ENV) {
        if !value.trim().is_empty() {
            return Some("environment");
        }
    }

    match db.get_setting(DEEPSEEK_KEY) {
        Ok(Some(value)) if !value.trim().is_empty() => Some("settings"),
        Ok(_) => None,
        Err(err) => {
            tracing::warn!(%err, "could not determine the DeepSeek API key source");
            None
        }
    }
}

fn is_loopback(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1" | "[::1]")
}
