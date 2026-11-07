use tauri::{AppHandle, Manager, WebviewWindow, WebviewWindowBuilder};

use crate::state::AppState;

/// Terminates the WebKit web process backing `window` while keeping the (hidden)
/// window and its webview object alive.
///
/// wry's IPC handler keeps the webview's GObject alive through a reference
/// cycle, so destroying the window does not reliably reclaim it and repeated
/// create/destroy cycles leak UI-side memory. Instead, Linux keeps one window
/// per role for the app's lifetime and only kills the renderer process; the
/// next reveal reloads the page. This releases the expensive web process and JS
/// heap without churning windows.
///
/// Must be called while the window still exists. `with_webview` executes
/// inline on the main thread, which is where callers run it.
#[cfg(target_os = "linux")]
pub fn terminate_web_process(window: &WebviewWindow) {
    use webkit2gtk::WebViewExt;

    if let Err(err) = window.with_webview(|webview| {
        webview.inner().terminate_web_process();
    }) {
        tracing::warn!(
            %err,
            label = window.label(),
            "could not terminate the window's web process"
        );
    }
}

#[cfg(not(target_os = "linux"))]
pub fn terminate_web_process(_window: &WebviewWindow) {}

/// Reloads a window whose renderer was terminated while hidden.
///
/// WebKit cannot reload a crashed page without a URL if it lost the last
/// committed one, so prefer `load_uri` with the remembered URI and fall back to
/// `reload`.
#[cfg(target_os = "linux")]
pub fn reload_window(window: &WebviewWindow) {
    use webkit2gtk::WebViewExt;

    if let Err(err) = window.with_webview(|webview| {
        let view = webview.inner();
        match view.uri() {
            Some(uri) if !uri.is_empty() => view.load_uri(&uri),
            _ => view.reload(),
        }
    }) {
        tracing::warn!(%err, label = window.label(), "could not reload the window webview");
    }
}

#[cfg(not(target_os = "linux"))]
pub fn reload_window(_window: &WebviewWindow) {}

/// Ensures a window with the given label exists, creating it from the
/// `tauri.conf.json` window config if it does not.
///
/// The `window_lock` serializes creation so two simultaneous requests (for
/// example a tray click and a second-launch focus) do not build the same
/// window twice. Returns the existing window if one is already open.
///
/// If the core state has not been initialized yet (the single-instance
/// callback can race setup), returns an error so the caller can retry.
pub fn ensure_window(app: &AppHandle, label: &str) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(label) {
        return Ok(window);
    }

    let state = app
        .try_state::<AppState>()
        .ok_or_else(|| "core is not ready".to_string())?;

    let _guard = state.window_lock.lock().unwrap_or_else(|e| e.into_inner());

    // Re-check after acquiring the lock: another thread may have created the
    // window while we were waiting.
    if let Some(window) = app.get_webview_window(label) {
        return Ok(window);
    }

    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == label)
        .ok_or_else(|| format!("missing window config: {label}"))?
        .clone();

    let window = WebviewWindowBuilder::from_config(app, &config)
        .map_err(|err| err.to_string())?
        .build()
        .map_err(|err| err.to_string())?;

    tracing::debug!(label, "created window on demand");

    // Apply the always-on-top setting to the widget at creation time so the
    // first reveal is correct without a follow-up call.
    if label == "widget" {
        let settings = state.settings();
        let _ = window.set_always_on_top(settings.widget_always_on_top);
    }

    Ok(window)
}
