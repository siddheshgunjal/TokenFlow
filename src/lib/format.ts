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

export function inferenceTokens(
  inputTokens: number,
  cachedInputTokens: number,
  outputTokens: number,
): number {
  return uncachedInputTokens(inputTokens, cachedInputTokens) + outputTokens;
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

export function classNames(
  ...values: Array<string | false | null | undefined>
): string {
  return values.filter(Boolean).join(" ");
}
