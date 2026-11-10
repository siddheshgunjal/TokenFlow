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
    /// Re-exec the Linux core after every window has been hidden and the proxy
    /// has been quiet for this many seconds. The widget renderer is killed
    /// immediately on hide; this window releases the UI-process library working
    /// set. `0` disables the recycle.
    pub idle_recycle_secs: u64,
    pub launch_at_login: bool,
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
            idle_recycle_secs: env::var("TOKENFLOW_IDLE_RECYCLE_SECS")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(60),
            launch_at_login: false,
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
        self.idle_recycle_secs = self.idle_recycle_secs.min(86_400);
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

        if self.idle_recycle_secs > 86_400 {
            return Err(AppError::Config(
                "Idle recycle must be 0 (disabled) or at most 86400 seconds.".to_string(),
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
    /// Whether this build can manage an OS login item.
    pub launch_at_login_supported: bool,
    /// A portal or platform error the Settings screen should show next to the
    /// launch-at-login toggle.
    pub launch_at_login_error: Option<String>,
}

fn is_loopback(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1" | "[::1]")
}

#[cfg(test)]
mod tests {
    use super::Settings;

    #[test]
    fn old_settings_blob_without_launch_at_login_defaults_to_false() {
        let raw = r#"{
            "upstreamUrl": "http://127.0.0.1:11434",
            "proxyPort": 11435,
            "deepseekPollIntervalSecs": 900,
            "deepseekBaseUrl": "https://api.deepseek.com",
            "startMinimized": true,
            "closeToTray": false,
            "widgetAlwaysOnTop": false,
            "showWidgetOnStart": true
        }"#;

        let settings: Settings = serde_json::from_str(raw).expect("old settings blob deserializes");
        assert!(!settings.launch_at_login);
        assert!(settings.start_minimized);
        // A settings blob written before the idle recycle existed inherits the
        // current default via `#[serde(default)]`.
        assert_eq!(
            settings.idle_recycle_secs,
            Settings::default().idle_recycle_secs
        );
    }

    #[test]
    fn idle_recycle_serializes_as_camel_case() {
        let settings = Settings {
            idle_recycle_secs: 90,
            ..Settings::default()
        };

        let raw = serde_json::to_string(&settings).expect("settings serialize");
        assert!(raw.contains("\"idleRecycleSecs\":90"));
    }

    #[test]
    fn idle_recycle_is_clamped_to_a_day() {
        let settings = Settings {
            idle_recycle_secs: u64::MAX,
            ..Settings::default()
        }
        .normalized();
        assert_eq!(settings.idle_recycle_secs, 86_400);
    }

    #[test]
    fn launch_at_login_serializes_as_camel_case() {
        let settings = Settings {
            launch_at_login: true,
            ..Settings::default()
        };

        let raw = serde_json::to_string(&settings).expect("settings serialize");
        assert!(raw.contains("\"launchAtLogin\":true"));
    }
}
