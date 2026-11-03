use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State};
use zeroize::Zeroize;

use crate::{
    error::AppError,
    models::{BalanceSnapshot, ClearDataResult, DashboardSummary, DeepSeekStatus, ProxyStatus},
    secrets::{self, KeyringStore, SecretStore},
    settings::{Settings, SettingsView},
    state::{AppState, TrayAnchor},
};

#[tauri::command]
pub async fn get_dashboard(
    state: State<'_, AppState>,
    days: Option<u32>,
) -> Result<DashboardSummary, String> {
    let state = state.inner().clone();
    let days = days.unwrap_or(30).clamp(1, 3650);

    tokio::task::spawn_blocking(move || {
        let mut dashboard = state.db.dashboard(days)?;
        dashboard.proxy = state.proxy_status();
        Ok::<_, AppError>(dashboard)
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<SettingsView, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || settings_view(&state))
        .await
        .map_err(|err| err.to_string())?
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn save_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: Settings,
) -> Result<SettingsView, String> {
    let state = state.inner().clone();
    let settings = settings.normalized();
    let widget_always_on_top = settings.widget_always_on_top;

    let view = tokio::task::spawn_blocking(move || {
        settings.validate()?;
        state.update_settings(settings)?;
        settings_view(&state)
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(|err| err.to_string())?;

    if let Some(window) = app.get_webview_window("widget") {
        if let Err(err) = window.set_always_on_top(widget_always_on_top) {
            tracing::warn!(%err, "could not apply the widget always-on-top setting");
        }
    }

    Ok(view)
}

#[tauri::command]
pub async fn save_deepseek_api_key(
    state: State<'_, AppState>,
    api_key: Option<String>,
) -> Result<SettingsView, String> {
    let state = state.inner().clone();
    let key = api_key
        .map(|mut value| {
            let trimmed = value.trim().to_string();
            value.zeroize();
            zeroize::Zeroizing::new(trimmed)
        })
        .filter(|value| !value.is_empty());

    let view = tokio::task::spawn_blocking({
        let state = state.clone();
        move || {
            let store = KeyringStore::new();
            let mut delete_error = None;
            match key.as_ref() {
                Some(key) => store
                    .set(secrets::DEEPSEEK_ACCOUNT, key.as_str())
                    .map_err(secret_error)?,
                None => {
                    secrets::remove_legacy_key(&state.db).map_err(|err| {
                        AppError::Secret(format!(
                            "The legacy SQLite key could not be removed: {err}"
                        ))
                    })?;
                    delete_error = store.delete(secrets::DEEPSEEK_ACCOUNT).err();
                }
            }

            let resolution = secrets::resolve(&state.db, &store);
            state.replace_secret_state(resolution);
            if let Some(err) = delete_error {
                return Err(secret_error(err));
            }
            settings_view(&state)
        }
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(|err| err.to_string())?;

    if view.has_deepseek_api_key {
        let state = state.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(err) = crate::deepseek::refresh(&state).await {
                tracing::warn!(%err, "immediate DeepSeek refresh failed");
            }
        });
    }

    Ok(view)
}

/// Re-reads the OS keychain and retries a pending legacy migration. This is
/// exposed so users can recover from a transiently locked/unavailable keyring
/// without restarting the app.
#[tauri::command]
pub async fn retry_deepseek_keychain(state: State<'_, AppState>) -> Result<SettingsView, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        let resolution = secrets::resolve(&state.db, &KeyringStore::new());
        state.replace_secret_state(resolution);
        settings_view(&state)
    })
    .await
    .map_err(|err| err.to_string())?
    .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn get_deepseek_status(state: State<'_, AppState>) -> Result<DeepSeekStatus, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || build_deepseek_status(&state))
        .await
        .map_err(|err| err.to_string())?
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn refresh_deepseek_balance(
    state: State<'_, AppState>,
) -> Result<Vec<BalanceSnapshot>, String> {
    let state = state.inner().clone();
    crate::deepseek::refresh(&state)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn get_balance_history(
    state: State<'_, AppState>,
    currency: String,
    since: i64,
    until: i64,
) -> Result<Vec<BalanceSnapshot>, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || state.db.balance_history(&currency, since, until))
        .await
        .map_err(|err| err.to_string())?
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn clear_usage_data(state: State<'_, AppState>) -> Result<ClearDataResult, String> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || state.db.clear_usage_data())
        .await
        .map_err(|err| err.to_string())?
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn get_proxy_status(state: State<'_, AppState>) -> ProxyStatus {
    state.proxy_status()
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window is not available".to_string())?;

    window.show().map_err(|err| err.to_string())?;
    window.unminimize().map_err(|err| err.to_string())?;
    window.set_focus().map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn toggle_widget(app: AppHandle, visible: Option<bool>) -> Result<bool, String> {
    toggle_widget_window(&app, visible)
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Shared by the tray menu and the `toggle_widget` command.
pub fn toggle_widget_window(app: &AppHandle, visible: Option<bool>) -> Result<bool, String> {
    let window = app
        .get_webview_window("widget")
        .ok_or_else(|| "Widget window is not available".to_string())?;
    let state = app.state::<AppState>();
    let target = visible.unwrap_or_else(|| !window.is_visible().unwrap_or(false));

    if target {
        let always_on_top = state.settings().widget_always_on_top;
        if let Err(err) = window.set_always_on_top(always_on_top) {
            tracing::warn!(%err, "could not set widget always-on-top");
        }

        // Position before showing to avoid a flash at the OS default location,
        // then position again after the window is mapped so the tray anchor is
        // honored on every platform.
        position_widget(&window, state.inner());
        window.show().map_err(|err| err.to_string())?;
        position_widget(&window, state.inner());

        // Hidden webviews throttle their timers, so the widget explicitly
        // refreshes whenever it is revealed from the tray (or on launch).
        if let Err(err) = app.emit("widget-shown", ()) {
            tracing::warn!(%err, "could not emit widget-shown");
        }
    } else {
        window.hide().map_err(|err| err.to_string())?;
    }

    Ok(target)
}

/// Widget size from `tauri.conf.json`. `outer_size()` returns zero until the
/// window is mapped, so this is used for the first reveal.
const WIDGET_LOGICAL_WIDTH: f64 = 390.0;
const WIDGET_LOGICAL_HEIGHT: f64 = 320.0;

/// Anchors the panel to the last tray activation. Falls back to the top-right
/// corner of the current monitor when no tray anchor is available (for example
/// when the widget is shown on launch).
fn position_widget(window: &tauri::WebviewWindow, state: &AppState) {
    let anchor = state.tray_anchor();
    let monitor = match anchor {
        Some(TrayAnchor::Physical(x, y)) => window.monitor_from_point(x, y).ok().flatten(),
        None => window.current_monitor().ok().flatten(),
    };
    let Some(monitor) = monitor else {
        return;
    };

    let scale = monitor.scale_factor();
    let size = window
        .outer_size()
        .ok()
        .filter(|size| size.width > 0 && size.height > 0)
        .unwrap_or_else(|| {
            PhysicalSize::new(
                (WIDGET_LOGICAL_WIDTH * scale).round() as u32,
                (WIDGET_LOGICAL_HEIGHT * scale).round() as u32,
            )
        });
    let gap = (10.0 * scale).round() as i32;
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();

    let min_x = monitor_position.x + gap;
    let max_x =
        (monitor_position.x + monitor_size.width as i32 - size.width as i32 - gap).max(min_x);
    let min_y = monitor_position.y + gap;
    let max_y =
        (monitor_position.y + monitor_size.height as i32 - size.height as i32 - gap).max(min_y);

    let (x, y) = match anchor {
        Some(TrayAnchor::Physical(anchor_x, anchor_y)) => {
            let anchor_x = anchor_x.round() as i32;
            let anchor_y = anchor_y.round() as i32;
            let x = (anchor_x - size.width as i32 / 2).clamp(min_x, max_x);

            let panel_zone = (80.0 * scale).round() as i32;
            let top_panel = anchor_y < monitor_position.y + panel_zone;
            let bottom_panel =
                anchor_y > monitor_position.y + monitor_size.height as i32 - panel_zone;

            let y = if top_panel {
                // Clear the top panel instead of hiding behind it. The minimum
                // covers GNOME's default 32 px bar plus a small gap.
                let panel_top = monitor_position.y + (40.0 * scale).round() as i32;
                (anchor_y + (24.0 * scale).round() as i32).max(panel_top)
            } else if bottom_panel {
                anchor_y - size.height as i32 - gap
            } else {
                anchor_y + gap
            };
            (x, y.clamp(min_y, max_y))
        }
        None => (max_x, min_y),
    };

    tracing::debug!(x, y, anchor = ?state.tray_anchor(), "positioned widget window");
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

fn secret_error(err: secrets::SecretError) -> AppError {
    AppError::Secret(secrets::user_message(&err))
}

fn settings_view(state: &AppState) -> Result<SettingsView, AppError> {
    let settings = state.settings();
    let key_source = state.deepseek_key_source();
    let proxy = state.proxy_status();
    let expected_bind = format!("127.0.0.1:{}", settings.proxy_port);
    let restart_required = (proxy.running || proxy.error.is_some())
        && (proxy.bind_address != expected_bind || proxy.upstream_url != settings.upstream_url);

    Ok(SettingsView {
        settings,
        has_deepseek_api_key: state.has_deepseek_key(),
        deepseek_key_source: key_source.map(|source| source.as_str().to_string()),
        deepseek_key_error: state.deepseek_key_error(),
        restart_required,
    })
}

fn build_deepseek_status(state: &AppState) -> Result<DeepSeekStatus, AppError> {
    let key_source = state.deepseek_key_source();
    let sync = state.db.deepseek_sync_status()?;
    let balances = state.db.latest_balances()?;

    Ok(DeepSeekStatus {
        has_api_key: state.has_deepseek_key(),
        key_source: key_source.map(|source| source.as_str().to_string()),
        last_success_at: sync.last_success_at,
        last_error: sync.last_error,
        last_error_at: sync.last_error_at,
        balances,
        poll_interval_secs: state.settings().deepseek_poll_interval_secs,
    })
}
