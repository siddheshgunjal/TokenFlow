//! Optional heap accounting for the core process (feature `heap-stats`).
//!
//! The refresh-path probe showed that the core does not retain memory per
//! refresh, but the Tauri/GTK/WebKit UI process shares the core's address
//! space on Linux. These counters let a long capture distinguish "the core's
//! own heap grew" from "GTK/WebKit retained something".
//!
//! Enable with `cargo run --features heap-stats` (or `cargo tauri dev --
//! --features heap-stats`) and watch `RUST_LOG=tokenflow=debug`. It is off by
//! default because it adds two atomic operations to every allocation.

use std::{
    alloc::{GlobalAlloc, Layout, System},
    sync::atomic::{AtomicUsize, Ordering},
    time::Duration,
};

static LIVE_BYTES: AtomicUsize = AtomicUsize::new(0);
static PEAK_BYTES: AtomicUsize = AtomicUsize::new(0);
static ALLOCATIONS: AtomicUsize = AtomicUsize::new(0);

/// A thin `System` wrapper that tracks live bytes, peak bytes, and the number
/// of allocation calls. Do not use it outside the `heap-stats` feature: the
/// extra atomics are pure overhead in a release build.
pub struct CountingAllocator;

unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let ptr = System.alloc(layout);
        if !ptr.is_null() {
            let live = LIVE_BYTES.fetch_add(layout.size(), Ordering::Relaxed) + layout.size();
            PEAK_BYTES.fetch_max(live, Ordering::Relaxed);
            ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
        }
        ptr
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        LIVE_BYTES.fetch_sub(layout.size(), Ordering::Relaxed);
        System.dealloc(ptr, layout);
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        let new_ptr = System.realloc(ptr, layout, new_size);
        if !new_ptr.is_null() {
            if new_size >= layout.size() {
                let grow = new_size - layout.size();
                let live = LIVE_BYTES.fetch_add(grow, Ordering::Relaxed) + grow;
                PEAK_BYTES.fetch_max(live, Ordering::Relaxed);
            } else {
                LIVE_BYTES.fetch_sub(layout.size() - new_size, Ordering::Relaxed);
            }
        }
        new_ptr
    }
}

/// A point-in-time view of the core's heap counters.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HeapStats {
    pub live_bytes: usize,
    pub peak_bytes: usize,
    pub allocations: usize,
}

pub fn snapshot() -> HeapStats {
    HeapStats {
        live_bytes: LIVE_BYTES.load(Ordering::Relaxed),
        peak_bytes: PEAK_BYTES.load(Ordering::Relaxed),
        allocations: ALLOCATIONS.load(Ordering::Relaxed),
    }
}

/// Logs the heap counters once a minute so a debug capture shows whether the
/// core's own allocations grow over a long run.
pub fn spawn_reporter() {
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(60));
        ticker.tick().await;

        loop {
            ticker.tick().await;
            let stats = snapshot();
            tracing::debug!(
                live_bytes = stats.live_bytes,
                peak_bytes = stats.peak_bytes,
                allocations = stats.allocations,
                "core heap stats"
            );
        }
    });
}

#[cfg(test)]
mod tests {
    use super::snapshot;

    #[test]
    fn counters_expose_consistent_invariants() {
        let stats = snapshot();
        assert!(
            stats.allocations > 0,
            "the test process has allocated by now"
        );
        assert!(
            stats.peak_bytes >= stats.live_bytes,
            "peak live bytes can never be below the current live bytes"
        );
    }
}
