import { useCallback, useEffect, useRef, useState } from "react";

import { getCoreSnapshot, refreshCore } from "./api";
import type { DashboardSummary } from "./types";

/**
 * A deliberately small stand-in for the app's `useCoreSnapshot`. The website
 * needs the same loading/refresh behavior, but no event subscriptions, widget
 * visibility buffering, or Tauri plumbing.
 */
export function useDemoSnapshot(): {
  snapshot: DashboardSummary | null;
  error: string | null;
  refreshing: boolean;
  refresh: () => Promise<void>;
} {
  const [snapshot, setSnapshot] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    getCoreSnapshot()
      .then((next) => {
        if (!cancelled) setSnapshot(next);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);

    try {
      const result = await refreshCore();
      setSnapshot(result.snapshot);
      setError(result.deepseekError);
    } catch (err) {
      setError(String(err));
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, []);

  return { snapshot, error, refreshing, refresh };
}
