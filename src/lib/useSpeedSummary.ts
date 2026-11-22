import { useCallback, useEffect, useState } from "react";

import { getSpeedSummary } from "./api";
import type { SpeedSummary } from "./types";

/**
 * Fetches the lazy overall-speed summary for a `[since, until)` window.
 *
 * A window change (new Day/Week/Month range or a different selected day)
 * blanks the card to a loading state so the switch feels immediate. A
 * `refreshKey` change for the same window (the snapshot's request count)
 * refetches silently and replaces the values without blanking, so the current
 * window stays live as new Ollama requests arrive. Stale requests are
 * cancelled so a rapid range switch never renders a previous window.
 */
export function useSpeedSummary(
  since: number,
  until: number,
  refreshKey: number,
): {
  summary: SpeedSummary | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
} {
  const [summary, setSummary] = useState<SpeedSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    // A new window always resets the card; a same-window refresh does not.
    // Compare against the previously fetched bounds without depending on
    // `summary` itself (so applying a result cannot re-run the effect).
    const silent = summary?.since === since && summary?.until === until;

    if (!silent) {
      setSummary(null);
      setLoading(true);
    }
    setError(null);

    let cancelled = false;
    getSpeedSummary(since, until)
      .then((next) => {
        if (cancelled) return;
        setSummary(next);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setSummary(null);
        setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // `refreshKey` is the snapshot's request count; `attempt` is manual retry.
  }, [since, until, refreshKey, attempt]);

  return { summary, loading, error, retry };
}
