export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

export function formatCompact(value: number): string {
  if (Math.abs(value) < 1000) {
    return formatNumber(value);
  }
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function uncachedInputTokens(
  inputTokens: number,
  cachedInputTokens: number,
): number {
  return Math.max(0, inputTokens - cachedInputTokens);
}

export function formatDateTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatPercent(rate: number): string {
  const clamped = Math.min(1, Math.max(0, rate));
  return `${Math.round(clamped * 100)}%`;
}

export function formatRelative(unixSeconds: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds));
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d ago`;
  return formatDateTime(unixSeconds);
}

export function formatDayLabel(isoDate: string): string {
  const date = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function formatMoney(value: string, currency: string): string {
  const numeric = Number.parseFloat(value);
  const symbols: Record<string, string> = {
    USD: "$",
    CNY: "¥",
    EUR: "€",
    GBP: "£",
    JPY: "¥",
    INR: "₹",
  };

  if (!Number.isFinite(numeric)) {
    return `${value} ${currency}`;
  }

  const symbol = symbols[currency.toUpperCase()];
  return symbol
    ? `${symbol}${numeric.toFixed(2)}`
    : `${numeric.toFixed(2)} ${currency}`;
}

export function todayKey(): string {
  return toDateKey(new Date());
}

export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Parses a `YYYY-MM-DD` key into a local `Date` at noon. Noon is used so the
 * value is never ambiguous across a DST transition when it is later re-read
 * by `getFullYear` / `getMonth` / `getDate`.
 */
export function parseDateKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

/** Long, human-readable label for the selected day (e.g. "Wednesday, November 5, 2026"). */
export function formatSelectedDay(key: string): string {
  return parseDateKey(key).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Re-anchors a selected `YYYY-MM-DD` key to the month `offset` months before
 * today. The day-of-month is preserved and clamped to the target month's last
 * day; at `offset === 0` it is also clamped to today so no future date is
 * ever selected. Returns a `YYYY-MM-DD` key.
 */
export function dateKeyForMonthOffset(
  currentKey: string,
  offset: number,
  today = new Date(),
): string {
  const target = new Date(
    today.getFullYear(),
    today.getMonth() - offset,
    1,
    12,
  );

  const current = parseDateKey(currentKey);
  const sameMonth =
    current.getFullYear() === target.getFullYear() &&
    current.getMonth() === target.getMonth();

  if (sameMonth) {
    // Keep the selection, but never let it drift into the future this month.
    if (offset === 0 && current.getTime() > today.getTime()) {
      return toDateKey(today);
    }
    return currentKey;
  }

  const lastDay = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0,
  ).getDate();
  const day = Math.min(current.getDate(), lastDay);
  const next = new Date(target.getFullYear(), target.getMonth(), day, 12);

  // Never select a future day when landing in the current month.
  if (offset === 0 && next.getTime() > today.getTime()) {
    return toDateKey(today);
  }
  return toDateKey(next);
}

export function classNames(
  ...values: Array<string | false | null | undefined>
): string {
  return values.filter(Boolean).join(" ");
}
