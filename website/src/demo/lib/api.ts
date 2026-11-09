import {
  mockBalanceHistory,
  mockCoreSnapshot,
  mockDayUsageDetail,
  mockDeleteModelData,
  mockMergeModels,
  mockModelCatalog,
} from "./mock";
import type {
  BalanceSnapshot,
  DashboardSummary,
  DayUsageDetail,
  ModelCatalogEntry,
  ModelMutationResult,
  RefreshResult,
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
