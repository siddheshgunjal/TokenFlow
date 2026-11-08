import { useCallback, useEffect, useRef, useState } from "react";

import {
  getCoreSnapshot,
  refreshCore,
  subscribeToCoreSnapshot,
  subscribeToWidgetHidden,
  subscribeToWidgetShown,
} from "./api";
import type { BalanceSnapshot, DashboardSummary } from "./types";

/** Shallow-compares two flat records (every field is a primitive). */
function shallowEqual<T extends object>(left: T, right: T): boolean {
  if (left === right) return true;
  const leftKeys = Object.keys(left) as Array<keyof T>;
  const rightKeys = Object.keys(right) as Array<keyof T>;
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => left[key] === right[key]);
}

/** Element-wise shallow comparison for the snapshot's flat record arrays. */
function sameEntries<T extends object>(left: T[], right: T[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (!shallowEqual(left[index], right[index])) return false;
  }
  return true;
}

function sameBalance(
  left: BalanceSnapshot | null,
  right: BalanceSnapshot | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return shallowEqual(left, right);
}

/**
 * Reuses the previous references for slices whose content did not change.
 *
 * The core sends a fresh object on every rebuild, but most rebuilds only
 * change one slice (a DeepSeek poll updates `latestBalance`; a proxy record
 * updates `totals`, `models`, `daily`, and `recent`). Keeping the old
 * references for unchanged slices lets `React.memo` on the dashboard cards
 * skip their renders, which keeps the renderer's JS heap from churning on
 * every refresh.
 */
function reconcileSnapshot(
  previous: DashboardSummary | null,
  next: DashboardSummary,
): DashboardSummary {
  if (!previous || previous.revision === next.revision) {
    return next;
  }

  return {
    ...next,
    totals: shallowEqual(previous.totals, next.totals)
      ? previous.totals
      : next.totals,
    models: sameEntries(previous.models, next.models)
      ? previous.models
      : next.models,
    daily: sameEntries(previous.daily, next.daily)
      ? previous.daily
      : next.daily,
    recent: sameEntries(previous.recent, next.recent)
      ? previous.recent
      : next.recent,
    latestBalance: sameBalance(previous.latestBalance, next.latestBalance)
      ? previous.latestBalance
      : next.latestBalance,
    proxy: shallowEqual(previous.proxy, next.proxy)
      ? previous.proxy
      : next.proxy,
  };
}

/**
 * Consumes the core-owned snapshot for a single window.
 *
 * This is the only data path for both the dashboard and the widget. It
 * registers the `core-snapshot` listener before the initial fetch, applies
 * only snapshots whose `revision` is strictly newer than the current one, and
 * buffers updates while the window is hidden so a reveal is instant and
 * current.
 *
 * There are no `setInterval` calls anywhere: freshness comes entirely from
 * core-pushed events plus a `sync()` catch-up on reveal or focus. The focus
 * catch-up matters for a minimized window: the core bridge skips minimized
 * windows (they cannot paint), so the window re-syncs when it is restored.
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

  // The last applied revision. The core increments it on every rebuild, so an
  // event and an invoke response that carry the same revision carry the same
  // data; only the first one is applied.
  const revisionRef = useRef<number>(0);
  // The last snapshot handed to React, kept for slice reconciliation.
  const appliedRef = useRef<DashboardSummary | null>(null);
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
    if (next.revision <= revisionRef.current) {
      // A duplicate (same revision delivered by both the event and the invoke
      // response) or a stale out-of-order event; the applied snapshot wins.
      return;
    }
    revisionRef.current = next.revision;
    bufferedRef.current = null;
    const reconciled = reconcileSnapshot(appliedRef.current, next);
    appliedRef.current = reconciled;
    setSnapshot(reconciled);
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
    // Catch any events missed while hidden, minimized, or unfocused. The core
    // snapshot is the source of truth; we only need to reconcile if we are
    // behind.
    try {
      apply(await getCoreSnapshot());
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
      // Apply through the revision guard: the core-snapshot event for this
      // same rebuild may already have landed, in which case this is a no-op.
      apply(result.snapshot);
      setError(result.deepseekError);
    } catch (err) {
      setError(String(err));
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, [apply]);

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

    // A minimized window is skipped by the core bridge, so restore/focus is
    // where it catches up on anything it missed.
    const onFocus = () => {
      visibleRef.current = true;
      void sync();
    };
    window.addEventListener("focus", onFocus);

    // Initial fetch. Apply even if hidden so a hidden widget has content
    // ready on its first reveal.
    void (async () => {
      try {
        const initial = await getCoreSnapshot();
        if (!disposed) {
          apply(initial);
        }
      } catch (err) {
        if (!disposed) setError(String(err));
      }
    })();

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      unsubscribeCore?.();
      unsubscribeShown?.();
      unsubscribeHidden?.();
    };
  }, [apply, handleEvent, setVisible, sync]);

  return { snapshot, error, refreshing, refresh, sync };
}
