//! Idle core recycle (Linux).
//!
//! On Linux the `tokenflow` process is both the Rust core and the GTK/WebKit
//! UI process. The first webview permanently loads `libwebkit2gtk`,
//! JavaScriptCore, GTK, and (through Mesa) `libgallium`/`libLLVM` into that
//! process. Closing a window only releases its `WebKitWebProcess`; the UI
//! process's library working set stays for the life of the process. Re-exec is
//! the only way back to the pre-webview footprint.
//!
//! The recycle waits for every window to be hidden and for the proxy to be
//! quiet for the widget eviction window plus a five-second grace period
//! (60 + 5 = 65 seconds by default), so the renderer eviction has finished and
//! no request is interrupted. The replacement process starts headless
//! (`--recycled`) and re-binds the proxy and tray; the next window open creates
//! a fresh webview as usual.

#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

use std::time::Duration;

#[cfg(target_os = "linux")]
use std::{sync::atomic::Ordering, time::Instant};

use tauri::AppHandle;

#[cfg(target_os = "linux")]
use crate::startup;
use crate::state::AppState;

/// How often the idle conditions are evaluated. The work is a settings clone
/// plus a few atomic loads; five seconds keeps the recycle close to the
/// configured window without waking the idle core frequently.
#[cfg(target_os = "linux")]
const CHECK_INTERVAL: Duration = Duration::from_secs(5);

/// Pure decision helper, kept separate so the boundary conditions are testable
/// without a runtime or a webview.
fn recycle_due(
    has_webview: bool,
    visible_windows: u32,
    in_flight: u64,
    idle_for: Duration,
    proxy_quiet: bool,
    idle_recycle_secs: u64,
) -> bool {
    idle_recycle_secs > 0
        && has_webview
        && visible_windows == 0
        && in_flight == 0
        && proxy_quiet
        && idle_for >= Duration::from_secs(idle_recycle_secs)
}

#[cfg(target_os = "linux")]
pub fn spawn(app: AppHandle, state: AppState) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(CHECK_INTERVAL);
        ticker.tick().await;
        let mut idle_since: Option<Instant> = None;

        loop {
            ticker.tick().await;

            let idle_recycle_secs = state.settings().idle_recycle_secs();
            if idle_recycle_secs == 0 || !state.has_webview() {
                idle_since = None;
                continue;
            }

            let visible = state.visible_windows.load(Ordering::SeqCst);
            let in_flight = state.proxy_activity.in_flight();
            if visible != 0 || in_flight != 0 {
                idle_since = None;
                continue;
            }

            let now = Instant::now();
            let since = *idle_since.get_or_insert(now);
            let idle_for = now.duration_since(since);
            let last_activity = state.proxy_activity.last_activity();
            // Before the first proxied request the timestamp is 0, which is
            // treated as quiet: there is nothing to interrupt.
            let proxy_quiet = last_activity == 0
                || (chrono::Utc::now().timestamp() - last_activity).max(0) as u64
                    >= idle_recycle_secs;

            if recycle_due(
                true,
                visible,
                in_flight,
                idle_for,
                proxy_quiet,
                idle_recycle_secs,
            ) {
                tracing::info!(
                    idle_secs = idle_for.as_secs(),
                    "recycling the core to release the WebKit UI working set"
                );
                // `tauri_plugin_single_instance::destroy` releases the D-Bus
                // name through a blocking zbus connection, which starts its own
                // Tokio runtime. Calling it from this worker panics with
                // "Cannot start a runtime from within a runtime", so the
                // teardown and exec must run on a plain OS thread. The process
                // is replaced by `exec`, so this task can end here.
                let recycle_app = app.clone();
                let recycle_state = state.clone();
                std::thread::spawn(move || recycle(&recycle_app, &recycle_state));
                break;
            }
        }
    });
}

#[cfg(not(target_os = "linux"))]
pub fn spawn(_app: AppHandle, _state: AppState) {}

/// Reaps children inherited across `exec`.
///
/// The pre-recycle `WebKitNetworkProcess` is a child of this PID and exits
/// when the old image's IPC socket closes, but `exec` skipped the old image's
/// wait loop, so it can surface as a zombie. Run this before Tauri/GTK starts
/// WebKit, while every child belongs to the previous image.
#[cfg(target_os = "linux")]
pub fn reap_inherited_children() {
    extern "C" {
        fn waitpid(pid: i32, status: *mut i32, options: i32) -> i32;
    }
    const WNOHANG: i32 = 1;

    for _ in 0..20 {
        let result = unsafe { waitpid(-1, std::ptr::null_mut(), WNOHANG) };
        if result > 0 {
            tracing::debug!(pid = result, "reaped an inherited child after recycle");
            continue;
        }
        if result == 0 {
            // A child is still alive; give it a moment to notice the closed IPC
            // socket, then try again.
            std::thread::sleep(Duration::from_millis(50));
            continue;
        }
        break; // ECHILD: nothing left to reap.
    }
}

#[cfg(not(target_os = "linux"))]
pub fn reap_inherited_children() {}

/// Replaces the current process image with a headless copy.
///
/// `exec` is used instead of spawn-and-exit so the Flatpak sandbox and the
/// process identity are preserved: the `flatpak run` client keeps waiting on
/// the same PID and the sandbox is not torn down under the replacement.
#[cfg(target_os = "linux")]
fn recycle(app: &AppHandle, state: &AppState) {
    // `exec` skips destructors; fold the WAL back first.
    state.db.checkpoint();

    // Release the D-Bus single-instance name before the new image starts so it
    // can claim the name itself instead of treating itself as a second launch.
    tauri_plugin_single_instance::destroy(app);

    let Ok(executable) = std::env::current_exe() else {
        tracing::error!("could not resolve the current executable; exiting instead of recycling");
        app.exit(1);
        return;
    };

    let mut command = std::process::Command::new(executable);
    let mut already_marked = false;
    for arg in std::env::args_os().skip(1) {
        if arg == std::ffi::OsStr::new(startup::RECYCLED_ARG) {
            already_marked = true;
        }
        command.arg(arg);
    }
    if !already_marked {
        command.arg(startup::RECYCLED_ARG);
    }

    use std::os::unix::process::CommandExt;
    let error = command.exec();
    tracing::error!(%error, "could not re-exec the core; exiting instead");
    app.exit(1);
}

#[cfg(test)]
mod tests {
    use super::recycle_due;
    use std::time::Duration;

    fn due(
        has_webview: bool,
        visible: u32,
        in_flight: u64,
        idle_for_secs: u64,
        quiet: bool,
        recycle_secs: u64,
    ) -> bool {
        recycle_due(
            has_webview,
            visible,
            in_flight,
            Duration::from_secs(idle_for_secs),
            quiet,
            recycle_secs,
        )
    }

    #[test]
    fn requires_a_created_webview() {
        assert!(!due(false, 0, 0, 900, true, 900));
    }

    #[test]
    fn requires_every_window_hidden() {
        assert!(!due(true, 1, 0, 900, true, 900));
    }

    #[test]
    fn never_interrupts_an_in_flight_request() {
        assert!(!due(true, 0, 1, 900, true, 900));
    }

    #[test]
    fn waits_for_the_proxy_to_be_quiet() {
        assert!(!due(true, 0, 0, 900, false, 900));
    }

    #[test]
    fn waits_for_the_full_idle_window() {
        assert!(!due(true, 0, 0, 64, true, 65));
        assert!(due(true, 0, 0, 65, true, 65));
    }

    #[test]
    fn zero_disables_the_recycle() {
        assert!(!due(true, 0, 0, 10_000, true, 0));
    }
}
