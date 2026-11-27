import {
  mockBalanceHistory,
  mockCoreSnapshot,
  mockDayUsageDetail,
  mockDeleteModelData,
  mockMergeModels,
  mockModelCatalog,
  mockModelPerformance,
  mockSpeedSummary,
  mockRequestFilterOptions,
  mockCountRequests,
  mockExportRequests,
} from "./mock";
import type {
  BalanceSnapshot,
  DashboardSummary,
  DayUsageDetail,
  ModelCatalogEntry,
  ModelMutationResult,
  ModelPerformance,
  RefreshResult,
  RequestCount,
  RequestExportResult,
  RequestFilterOptions,
  RequestFilters,
  SpeedSummary,
} from "./types";

const wait = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/**
 * Website-only data adapter. It mirrors the async surface used by the
 * dashboard, but every call resolves from the local deterministic mock. There
 * is no Tauri, proxy, network, or persistence layer here.
 */
export async function getCoreSnapshot(): Promise<DashboardSummary> {
  await wait(120);
  return mockCoreSnapshot();
}

export async function refreshCore(): Promise<RefreshResult> {
  await wait(500);
  return { snapshot: mockCoreSnapshot(), deepseekError: null };
}

export async function getDayUsageDetail(date: string): Promise<DayUsageDetail> {
  await wait(120);
  return mockDayUsageDetail(date);
}

export async function getBalanceHistory({
  currency,
  since,
  until,
}: {
  currency: string;
  since: number;
  until: number;
}): Promise<BalanceSnapshot[]> {
  await wait(120);
  return mockBalanceHistory(since, until, currency);
}

export async function getModelCatalog(): Promise<ModelCatalogEntry[]> {
  await wait(80);
  return mockModelCatalog();
}

export async function getModelPerformance(): Promise<ModelPerformance> {
  await wait(120);
  return mockModelPerformance();
}

export async function getSpeedSummary(
  since: number,
  until: number,
): Promise<SpeedSummary> {
  await wait(120);
  return mockSpeedSummary(since, until);
}

export async function deleteModelData(
  models: string[],
): Promise<ModelMutationResult> {
  await wait(180);
  return mockDeleteModelData(models);
}

export async function mergeModels(
  sources: string[],
  targetModel: string,
): Promise<ModelMutationResult> {
  await wait(180);
  return mockMergeModels(sources, targetModel);
}

/** Distinct models and endpoints for the export filter dropdowns. */
export async function getRequestFilterOptions(): Promise<RequestFilterOptions> {
  await wait(80);
  return mockRequestFilterOptions();
}

/** Live match count for the export dialog, with the resolved window. */
export async function countRequests(
  filters: RequestFilters,
): Promise<RequestCount> {
  await wait(120);
  return mockCountRequests(filters);
}

/**
 * Exports the filtered request history to CSV. The demo has no backend, so
 * the CSV is built in memory and downloaded via a Blob, returning a synthetic
 * result so the success UI renders identically.
 */
export async function exportRequests(
  filters: RequestFilters,
): Promise<RequestExportResult> {
  await wait(250);
  const { csv, result } = mockExportRequests(filters);
  triggerBlobDownload(csv, result.fileName);
  return result;
}

function triggerBlobDownload(csv: string, fileName: string): void {
  // A UTF-8 BOM so spreadsheet apps read non-ASCII model names correctly.
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }
}
