import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  classNames,
  formatNumber,
  parseDateKey,
  toDateKey,
} from "../lib/format";
import {
  copyText,
  countRequests,
  exportRequests,
  getRequestFilterOptions,
} from "../lib/api";
import type {
  RequestExportResult,
  RequestFilterOptions,
  RequestFilters,
  RequestPeriod,
} from "../lib/types";
import { Icon } from "./Icons";
import { MultiSelectDropdown } from "./MultiSelectDropdown";

const PERIODS: { value: RequestPeriod; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "date", label: "Date" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

/** A read-only, human label for the resolved window. */
function windowLabel(period: RequestPeriod, anchor: string | null): string {
  if (period === "all" || !anchor) return "All recorded requests";

  const date = parseDateKey(anchor);
  if (period === "date") {
    return date.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }
  if (period === "month") {
    return date.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
  }
  // week: Sunday start through the following Saturday.
  const daysFromSunday = date.getDay();
  const start = new Date(date);
  start.setDate(date.getDate() - daysFromSunday);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return `${start.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  })} – ${end.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  })}${end.getFullYear() !== start.getFullYear() ? ` ${end.getFullYear()}` : ""}`;
}

export function ExportRequestsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [period, setPeriod] = useState<RequestPeriod>("date");
  const [anchor, setAnchor] = useState<string>(toDateKey(new Date()));
  const [models, setModels] = useState<string[]>([]);
  const [endpoints, setEndpoints] = useState<string[]>([]);
  const [options, setOptions] = useState<RequestFilterOptions>({
    models: [],
    endpoints: [],
  });
  const [count, setCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RequestExportResult | null>(null);
  const [copied, setCopied] = useState(false);

  const requestSeq = useRef(0);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  const todayKey = toDateKey(new Date());
  const normalizedAnchor = period === "all" ? null : anchor;

  // The filters actually sent to the backend. A fully-selected model/endpoint
  // list is normalized to empty so "all selected" and "All" behave identically.
  const filters: RequestFilters = useMemo(() => {
    const normalize = (selected: string[], all: string[]) =>
      selected.length === all.length ? [] : selected;
    return {
      period,
      date: normalizedAnchor,
      models: normalize(models, options.models),
      endpoints: normalize(endpoints, options.endpoints),
    };
  }, [
    period,
    normalizedAnchor,
    models,
    endpoints,
    options.models,
    options.endpoints,
  ]);

  // Reset to the defaults and fetch the filter options each time the dialog
  // opens.
  useEffect(() => {
    if (!open) return;
    setPeriod("date");
    setAnchor(toDateKey(new Date()));
    setModels([]);
    setEndpoints([]);
    setCount(null);
    setCounting(false);
    setExporting(false);
    setError(null);
    setResult(null);
    setCopied(false);

    let cancelled = false;
    getRequestFilterOptions()
      .then((options) => {
        if (!cancelled) setOptions(options);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Focus the first field when the dialog opens.
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => firstFieldRef.current?.focus());
    }
  }, [open]);

  // Debounced live count; stale responses are discarded by sequence number.
  useEffect(() => {
    if (!open) return;
    setCounting(true);
    const sequence = ++requestSeq.current;
    const timer = window.setTimeout(() => {
      countRequests(filters)
        .then((response) => {
          if (sequence === requestSeq.current) {
            setCount(response.count);
            setCounting(false);
          }
        })
        .catch((err: unknown) => {
          if (sequence === requestSeq.current) {
            setError(errorMessage(err));
            setCounting(false);
          }
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      if (sequence === requestSeq.current) {
        requestSeq.current += 1;
      }
    };
  }, [open, filters]);

  const handleClose = useCallback(() => {
    if (!exporting) onClose();
  }, [exporting, onClose]);

  // Close on Escape, but never while an export is in flight.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !exporting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, exporting, onClose]);

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    try {
      const response = await exportRequests(filters);
      setResult(response);
    } catch (err: unknown) {
      setError(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  const handleCopy = async () => {
    if (!result) return;
    const ok = await copyText(result.path);
    setCopied(ok);
    window.setTimeout(() => setCopied(false), 1500);
  };

  if (!open) return null;

  const disabledByCount = count === 0;
  const disabled = exporting || counting || disabledByCount;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-requests-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(event) => event.target === event.currentTarget && handleClose()}
    >
      <div className="card w-full max-w-xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 p-4">
          <div>
            <h2 id="export-requests-title" className="text-lg font-semibold">
              Export request history
            </h2>
            <p className="text-sm text-white/50">
              Save every matching request as a CSV file.
            </p>
          </div>
          <button
            onClick={handleClose}
            disabled={exporting}
            className="rounded-full p-1 hover:bg-white/10 disabled:opacity-50"
            aria-label="Close"
          >
            <Icon name="x" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/20 p-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {result ? (
            <div className="rounded-md border border-accent/30 bg-accent/10 p-4">
              <div className="flex items-center gap-2 text-accent">
                <Icon name="check" className="h-4 w-4" />
                <span className="text-sm font-semibold">
                  Exported {formatNumber(result.rows)} request
                  {result.rows === 1 ? "" : "s"}
                </span>
              </div>
              <dl className="mt-3 space-y-1.5 text-sm">
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 text-muted">File</dt>
                  <dd className="break-all font-mono text-[12px] text-ink">
                    {result.fileName}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 text-muted">Saved to</dt>
                  <dd className="break-all font-mono text-[12px] text-ink">
                    {result.path}
                  </dd>
                </div>
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-white/10"
                >
                  <Icon name="copy" className="h-3.5 w-3.5" />
                  {copied ? "Copied" : "Copy path"}
                </button>
                <button
                  onClick={handleExport}
                  disabled={exporting}
                  className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-white/10 disabled:opacity-50"
                >
                  <Icon name="download" className="h-3.5 w-3.5" />
                  Export again
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Period segmented control */}
              <div className="mb-4">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                  Period
                </p>
                <div
                  role="group"
                  className="inline-flex overflow-hidden rounded-md border border-white/10"
                >
                  {PERIODS.map((option, index) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setPeriod(option.value)}
                      disabled={exporting}
                      aria-pressed={period === option.value}
                      className={classNames(
                        "px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50",
                        index > 0 && "border-l border-white/10",
                        period === option.value
                          ? "bg-accent/20 text-accent"
                          : "text-muted hover:bg-white/[0.04] hover:text-ink",
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Anchor date */}
              <div className="mb-4">
                <label
                  htmlFor="export-anchor"
                  className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-muted"
                >
                  Date
                </label>
                <input
                  ref={firstFieldRef}
                  id="export-anchor"
                  type="date"
                  value={anchor}
                  max={todayKey}
                  disabled={period === "all" || exporting}
                  onChange={(event) => setAnchor(event.target.value)}
                  className={classNames(
                    "rounded-md border border-white/10 bg-[#0b1220] px-3 py-2 text-[13px] text-ink outline-none focus:border-accent/50",
                    period === "all" && "cursor-not-allowed opacity-50",
                  )}
                />
                <p className="mt-2 text-[12px] text-muted">
                  {windowLabel(period, normalizedAnchor)}
                </p>
              </div>

              {/* Multi-select filters */}
              <div className="mb-4 flex flex-wrap gap-3">
                <MultiSelectDropdown
                  ariaLabel="Filter by model"
                  emptyLabel="All models"
                  options={options.models}
                  values={models}
                  onChange={setModels}
                />
                <MultiSelectDropdown
                  ariaLabel="Filter by endpoint"
                  emptyLabel="All endpoints"
                  options={options.endpoints}
                  values={endpoints}
                  onChange={setEndpoints}
                />
              </div>

              {/* Live count */}
              <div className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
                <span className="text-[12px] text-muted">
                  {counting
                    ? "Counting…"
                    : `${formatNumber(count ?? 0)} request${(count ?? 0) === 1 ? "" : "s"} match`}
                </span>
                <button
                  onClick={handleExport}
                  disabled={disabled}
                  className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Icon name="download" className="h-3.5 w-3.5" />
                  {exporting ? "Exporting…" : "Export CSV"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Something went wrong. Please try again.";
}
