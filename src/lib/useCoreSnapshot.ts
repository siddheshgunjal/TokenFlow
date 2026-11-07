import { useCallback, useEffect, useRef, useState } from "react";

import {
  getCoreSnapshot,
  refreshCore,
  subscribeToCoreSnapshot,
  subscribeToWidgetHidden,
  subscribeToWidgetShown,
} from "./api";
import type { DashboardSummary } from "./types";

/**
 * Consumes the core-owned snapshot for a single window.
 *
 * This is the only data path for both the dashboard and the widget. It
 * registers the `core-snapshot` listener before the initial fetch, applies
 * only snapshots whose `revision` is at least the current one, and buffers
 * updates while the window is hidden so a reveal is instant and current.
 *
 * There are no `setInterval` calls anywhere: freshness comes entirely from
 * core-pushed events plus a `sync()` catch-up on reveal.
 */
export function useCoreSnapshot(): {
  snapshot: DashboardSummary | null;
  error: string | null;
  refreshing: boolean;
  refresh: () => Promise<void>;
  sync: () => Promise<void>;
} {
  const [snapshot, setSnapshot] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Mirrors the last applied revision so the event handler can discard stale
  // out-of-order events without touching React state.
  const revisionRef = useRef<number>(0);
  // A snapshot that arrived while the window was hidden, waiting to be
  // applied on the next reveal.
  const bufferedRef = useRef<DashboardSummary | null>(null);
  // Tracks visibility so the event handler knows whether to apply or buffer.
  const visibleRef = useRef<boolean>(
    typeof document !== "undefined"
      ? document.visibilityState === "visible"
      : true,
  );
  // Guards against duplicate refreshes from rapid manual clicks.
  const refreshingRef = useRef<boolean>(false);

  const isHidden = useCallback((): boolean => {
    return !visibleRef.current;
  }, []);

  const apply = useCallback((next: DashboardSummary) => {
    if (next.revision < revisionRef.current) {
      // A stale event that arrived out of order; the newer snapshot already
      // won. Discard it.
      return;
    }
    revisionRef.current = next.revision;
    bufferedRef.current = null;
    setSnapshot(next);
  }, []);

  const handleEvent = useCallback(
    (next: DashboardSummary) => {
      if (isHidden()) {
        // Do not render a hidden window; hold the latest value so the reveal
        // is instant. Keep the revision guard so a later stale event is
        // dropped on reveal.
        if (
          !bufferedRef.current ||
          next.revision >= bufferedRef.current.revision
        ) {
          bufferedRef.current = next;
        }
        return;
      }
      apply(next);
    },
    [apply, isHidden],
  );

  const sync = useCallback(async () => {
    // Catch any events missed while hidden. The core snapshot is the source
    // of truth; we only need to reconcile if we are behind.
    try {
      const fresh = await getCoreSnapshot();
      if (fresh.revision >= revisionRef.current) {
        apply(fresh);
      }
    } catch (err) {
      // A sync failure is not fatal; the next event will reconcile.
      setError(String(err));
    }
  }, [apply]);

  const refresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      const result = await refreshCore();
      // Apply unconditionally: a manual refresh always represents the newest
      // core state the user asked for.
      revisionRef.current = result.snapshot.revision;
      bufferedRef.current = null;
      setSnapshot(result.snapshot);
      setError(result.deepseekError);
    } catch (err) {
      setError(String(err));
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, []);

  // Buffer an update if we become hidden, and flush it on reveal.
  const setVisible = useCallback(
    (visible: boolean) => {
      visibleRef.current = visible;
      if (visible) {
        // Apply the buffered snapshot immediately, then sync to catch any
        // events that arrived after the buffer was set.
        if (bufferedRef.current) {
          apply(bufferedRef.current);
        }
        void sync();
      }
    },
    [apply, sync],
  );

  useEffect(() => {
    let disposed = false;
    let unsubscribeCore: (() => void) | undefined;
    let unsubscribeShown: (() => void) | undefined;
    let unsubscribeHidden: (() => void) | undefined;

    // Register the core listener BEFORE the initial fetch so an event that
    // fires during the fetch is not lost.
    subscribeToCoreSnapshot(handleEvent)
      .then((cleanup) => {
        if (disposed) cleanup();
        else unsubscribeCore = cleanup;
      })
      .catch(() => undefined);

    subscribeToWidgetShown(() => setVisible(true))
      .then((cleanup) => {
        if (disposed) cleanup();
        else unsubscribeShown = cleanup;
      })
      .catch(() => undefined);

    subscribeToWidgetHidden(() => setVisible(false))
      .then((cleanup) => {
        if (disposed) cleanup();
        else unsubscribeHidden = cleanup;
      })
      .catch(() => undefined);

    // The browser preview and Tauri both rely on `visibilitychange`; this
    // covers a dashboard that loses OS focus without a widget-shown event.
    const onVisibility = () => {
      setVisible(document.visibilityState === "visible");
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Initial fetch. Apply even if hidden so a hidden widget has content
    // ready on its first reveal.
    void (async () => {
      try {
        const initial = await getCoreSnapshot();
        if (!disposed) {
          revisionRef.current = initial.revision;
          setSnapshot(initial);
        }
      } catch (err) {
        if (!disposed) setError(String(err));
      }
    })();

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      unsubscribeCore?.();
      unsubscribeShown?.();
      unsubscribeHidden?.();
    };
  }, [handleEvent, setVisible]);

  return { snapshot, error, refreshing, refresh, sync };
}
