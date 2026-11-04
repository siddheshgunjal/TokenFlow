use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

use crate::{error::AppError, platform};

#[cfg(target_os = "linux")]
use std::time::Duration;

/// A portal request can show a confirmation dialog. Keep a generous bound so a
/// broken portal cannot leave the Settings save pending forever.
#[cfg(target_os = "linux")]
const PORTAL_TIMEOUT: Duration = Duration::from_secs(120);

/// Whether the OS autostart entry exists, plus an error message if it could
/// not be read.
///
/// Native builds query the autostart manager. Flatpak has no query API in the
/// Background portal, so the persisted preference is returned instead.
pub fn status(app: &AppHandle, stored: bool) -> (bool, Option<String>) {
    if portal_backend() {
        return (stored, None);
    }

    match app.autolaunch().is_enabled() {
        Ok(enabled) => (enabled, None),
        Err(err) => (
            stored,
            Some(format!(
                "Could not read the current launch-at-login state: {err}"
            )),
        ),
    }
}

/// Applies the desired state.
///
/// Native builds reconcile with the actual OS state, which also repairs an
/// entry the user removed outside TokenFlow. Flatpak calls the Background
/// portal only when the saved preference changes.
pub async fn apply(app: &AppHandle, stored: bool, desired: bool) -> Result<(), AppError> {
    if portal_backend() {
        if desired == stored {
            return Ok(());
        }
        return apply_portal(desired).await;
    }

    apply_native(app, desired)
}

fn portal_backend() -> bool {
    cfg!(target_os = "linux") && platform::is_flatpak()
}

fn apply_native(app: &AppHandle, enabled: bool) -> Result<(), AppError> {
    let manager = app.autolaunch();
    let current = manager
        .is_enabled()
        .map_err(|err| AppError::Autostart(format!("Could not read the login item: {err}")))?;

    if current == enabled {
        return Ok(());
    }

    if enabled {
        manager
            .enable()
            .map_err(|err| AppError::Autostart(format!("Could not enable launch at login: {err}")))
    } else {
        manager
            .disable()
            .map_err(|err| AppError::Autostart(format!("Could not disable launch at login: {err}")))
    }
}

#[cfg(target_os = "linux")]
async fn apply_portal(enabled: bool) -> Result<(), AppError> {
    tokio::time::timeout(PORTAL_TIMEOUT, request_portal_background(enabled))
        .await
        .map_err(|_| {
            AppError::Autostart(
                "The desktop did not answer the background permission request in time.".to_string(),
            )
        })?
}

#[cfg(target_os = "linux")]
async fn request_portal_background(enabled: bool) -> Result<(), AppError> {
    use ashpd::desktop::background::Background;

    let request = Background::request()
        .reason(
            "TokenFlow records local Ollama usage and needs to start with your desktop session.",
        )
        .auto_start(enabled)
        .dbus_activatable(false)
        .command(vec![
            env!("CARGO_PKG_NAME").to_string(),
            crate::startup::AUTOSTART_ARG.to_string(),
        ])
        .send()
        .await
        .map_err(|err| {
            AppError::Autostart(format!(
                "The desktop background portal is unavailable: {err}"
            ))
        })?;

    let response = request.response().map_err(|err| {
        AppError::Autostart(format!(
            "The desktop did not grant the background request: {err}"
        ))
    })?;

    if response.auto_start() != enabled {
        return Err(AppError::Autostart(if enabled {
            "The desktop did not enable the login item.".to_string()
        } else {
            "The desktop did not disable the login item.".to_string()
        }));
    }

    Ok(())
}

#[cfg(not(target_os = "linux"))]
async fn apply_portal(_enabled: bool) -> Result<(), AppError> {
    Ok(())
}
