import { useCallback, useEffect, useState } from "react";

import { getDayUsageDetail } from "./api";
import type { DayUsageDetail } from "./types";

/**
 * Fetches the lazy per-hour breakdown for a selected day.
 *
 * The `date` change blanks the panel to a loading state so a day click feels
 * immediate. A `refreshKey` change for the same date (the core `revision`)
 * refetches silently and replaces the data without blanking, so today's panel
 * updates as new Ollama requests arrive. Stale requests are cancelled so a
 * rapid day click never renders a previous date.
 */
export function useDayUsageDetail(
  date: string,
  refreshKey: number,
): {
  detail: DayUsageDetail | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
} {
  const [detail, setDetail] = useState<DayUsageDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    // A new date always resets the panel; a same-date refresh does not. Read
    // the *previous* detail here: `detail` is deliberately kept out of the
    // dependency list so applying a fetched result does not re-run the effect.
    const silent = detail?.date === date;

    if (!silent) {
      setDetail(null);
      setLoading(true);
    }
    setError(null);

    let cancelled = false;
    getDayUsageDetail(date)
      .then((next) => {
        if (cancelled) return;
        setDetail(next);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setDetail(null);
        setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // `refreshKey` is the core revision; `attempt` is the manual retry count.
  }, [date, refreshKey, attempt]);

  return { detail, loading, error, retry };
}
