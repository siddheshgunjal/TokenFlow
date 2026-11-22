import { parseDateKey } from "./format";

/**
 * The Day/Week/Month window shared by the DeepSeek balance chart and the
 * Model speed card. Ranges are anchored to a selected day (`YYYY-MM-DD`) rather
 * than "now", so both cards agree when the activity calendar selection moves.
 */
export type ChartRange = "month" | "week" | "day";

export interface RangeOption {
  value: ChartRange;
  label: string;
}

/** Dropdown order; the default selection is `day` (see the components). */
export const RANGE_OPTIONS: RangeOption[] = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
];

export interface RangeBounds {
  since: Date;
  until: Date;
  label: string;
  /** Three short tick labels for the chart x-axis. */
  axis: string[];
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date: Date): Date {
  const start = startOfDay(date);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

function shortDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/**
 * Resolves the inclusive-started, exclusive-ended window for a range anchored
 * to the selected day. The window is `[since, until)` in local time.
 */
export function rangeFor(range: ChartRange, selectedDate: string): RangeBounds {
  // Anchor to the selected day at local midnight so DST edges are unambiguous.
  const anchor = parseDateKey(selectedDate);

  if (range === "month") {
    const since = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const until = new Date(since.getFullYear(), since.getMonth() + 1, 1);
    const lastDay = new Date(since.getFullYear(), since.getMonth() + 1, 0);
    const mid = new Date((since.getTime() + lastDay.getTime()) / 2);

    return {
      since,
      until,
      label: since.toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      }),
      axis: [shortDate(since), shortDate(mid), shortDate(lastDay)],
    };
  }

  if (range === "week") {
    const since = startOfWeek(anchor);
    const until = new Date(since);
    until.setDate(until.getDate() + 7);
    const mid = new Date(since);
    mid.setDate(mid.getDate() + 3);
    const end = new Date(since);
    end.setDate(end.getDate() + 6);

    return {
      since,
      until,
      label: `Week of ${shortDate(since)}`,
      axis: [shortDate(since), shortDate(mid), shortDate(end)],
    };
  }

  const since = startOfDay(anchor);
  const until = new Date(since);
  until.setDate(until.getDate() + 1);

  return {
    since,
    until,
    label: anchor.toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
    }),
    axis: ["12am", "6am", "12pm", "6pm", "11:59pm"],
  };
}

/** Unix-seconds bounds for a resolved window. */
export function toUnixBounds(bounds: RangeBounds): {
  since: number;
  until: number;
} {
  return {
    since: Math.floor(bounds.since.getTime() / 1000),
    until: Math.floor(bounds.until.getTime() / 1000),
  };
}
