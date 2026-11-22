import { useCallback, useEffect, useRef, useState } from "react";

import { getModelPerformance } from "./api";
import type { ModelPerformance } from "./types";

/**
 * Fetches the lazy all-model performance payload for the Speed tab.
 *
 * When `active` is `false` nothing is requested, so the tab switch is free
 * until the user actually opens Speed. The first activation loads with a
 * visible spinner; later changes to `refreshKey` (the core request count) or
 * `invalidationKey` (model mutations) refetch silently so the data stays fresh
 * without flashing. Stale requests are cancelled so a rapid tab switch never
 * renders a previous fetch.
 *
 * This hook deliberately does not subscribe to the snapshot revision: the
 * request count and the mutation key are the only invalidation signals, which
 * keeps the lazy payload out of the snapshot pipeline.
 */
export function useModelPerformance(
  active: boolean,
  refreshKey: number,
  invalidationKey: number,
): {
  performance: ModelPerformance | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
} {
  const [performance, setPerformance] = useState<ModelPerformance | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Tracks whether we have loaded at least once so subsequent refetches are
  // silent (no spinner) and a failed refetch keeps the last good data.
  const loadedRef = useRef(false);

  const retry = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!active) return;

    const silent = loadedRef.current;
    if (!silent) {
      setLoading(true);
    }
    setError(null);

    let cancelled = false;
    getModelPerformance()
      .then((next) => {
        if (cancelled) return;
        setPerformance(next);
        setError(null);
        loadedRef.current = true;
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err));
        // A first-load failure shows no data; a later failure keeps the last
        // good payload so the tab doesn't blank out.
        if (!loadedRef.current) setPerformance(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // `refreshKey` and `attempt` are the manual/silent triggers.
  }, [active, refreshKey, invalidationKey, attempt]);

  return { performance, loading, error, retry };
}
