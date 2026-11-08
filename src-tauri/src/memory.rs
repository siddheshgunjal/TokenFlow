//! Main-process memory hygiene that is not tied to the snapshot pipeline.
//!
//! The WebKit UI process keeps its resource caches (compiled CSS, script
//! caches, image atlases) for the life of the app. On Linux the window shells
//! and webviews are kept for the app's lifetime and only their renderers are
//! suspended, so those caches have no natural teardown point. An idle-gated
//! trim bounds them without ever touching a window the user is looking at.
//!
//! The same idle tick releases allocator pages that are already free. glibc
//! keeps freed arenas resident after transient spikes (IPC serialization,
//! JSON payloads), which otherwise shows up as a permanent RSS high-water
//! mark in a long-lived process.
//!
//! Other platforms destroy the windows (and their caches) on close, so the
//! WebKit part of the loop is a no-op there.

use std::{
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc,
    },
    time::Duration,
};

use tauri::AppHandle;
#[cfg(target_os = "linux")]
use tauri::Manager;

#[cfg(all(target_os = "linux", target_env = "gnu"))]
extern "C" {
    fn malloc_trim(pad: usize) -> i32;
}

/// How often the idle trim is allowed to run. The work is cheap and only
/// happens while every window is hidden; 15 minutes keeps the RSS
/// high-water mark from surviving a whole session without touching a window
/// the user can see.
const TRIM_INTERVAL: Duration = Duration::from_secs(15 * 60);

/// Starts the idle cache trim loop.
///
/// The trim only runs while every window is hidden: clearing the network cache
/// while a window is on screen would force it to re-fetch resources it is
/// still using. The work is dispatched to the main thread, where the GTK loop
/// and the webview objects live.
pub fn spawn_idle_cache_trim(app: AppHandle, visible_windows: Arc<AtomicU32>) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(TRIM_INTERVAL);
        // The first tick completes immediately; skip it so the first trim
        // happens a full interval after launch.
        ticker.tick().await;

        loop {
            ticker.tick().await;

            if visible_windows.load(Ordering::SeqCst) != 0 {
                continue;
            }

            trim_allocator();

            let app_for_task = app.clone();
            if let Err(err) = app.run_on_main_thread(move || trim_cached_resources(&app_for_task)) {
                tracing::debug!(%err, "could not dispatch the WebKit cache trim");
            }
        }
    });
}

/// Releases allocator pages that are already free back to the OS.
///
/// glibc keeps freed arenas resident after transient spikes (IPC
/// serialization, JSON payloads). `malloc_trim(0)` walks the arenas and
/// returns the free pages to the kernel; it is thread-safe and safe to call
/// with no arguments beyond the retention pad.
#[cfg(all(target_os = "linux", target_env = "gnu"))]
fn trim_allocator() {
    // SAFETY: `malloc_trim` takes only an integer pad and has no pointer
    // arguments; glibc documents it as thread-safe.
    let released = unsafe { malloc_trim(0) };
    tracing::debug!(released, "trimmed the allocator free pages");
}

#[cfg(not(all(target_os = "linux", target_env = "gnu")))]
fn trim_allocator() {}

#[cfg(target_os = "linux")]
fn trim_cached_resources(app: &AppHandle) {
    use webkit2gtk::{WebContextExt, WebViewExt};

    // Any live webview exposes the app-wide `WebContext`. On Linux a hidden
    // window keeps its webview object after its renderer is terminated, so
    // one of the two roles is normally available.
    let Some(window) = app
        .get_webview_window("main")
        .or_else(|| app.get_webview_window("widget"))
    else {
        return;
    };

    let result = window.with_webview(|webview| {
        if let Some(context) = webview.inner().context() {
            context.clear_cache();
        }
    });

    match result {
        Ok(()) => tracing::debug!("trimmed the idle WebKit cache"),
        Err(err) => tracing::debug!(%err, "could not trim the WebKit cache"),
    }
}

#[cfg(not(target_os = "linux"))]
fn trim_cached_resources(_app: &AppHandle) {}
