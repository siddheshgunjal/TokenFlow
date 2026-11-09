import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-shell";

import {
  mockBalanceHistory,
  mockCoreSnapshot,
  mockDayUsageDetail,
  mockDeepSeekStatus,
  mockSettingsView,
  mockModelCatalog,
  mockDeleteModelData,
  mockMergeModels,
} from "./mock";
import type {
  BalanceSnapshot,
  ClearDataResult,
  DayUsageDetail,
  DashboardSummary,
  DeepSeekStatus,
  ModelCatalogEntry,
  ModelMutationResult,
  RefreshResult,
  Settings,
  SettingsView,
} from "./types";

export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const delay = (milliseconds: number) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds));

/**
 * Returns the core-owned snapshot, building it if absent. This is the single
 * data path for both windows; there is no per-window range parameter.
 */
export async function getCoreSnapshot(): Promise<DashboardSummary> {
  if (!isTauri) {
    await delay(120);
    return mockCoreSnapshot();
  }
  return invoke<DashboardSummary>("get_core_snapshot");
}

/**
 * Unified manual refresh. Produces at most one DeepSeek network call and
 * returns the fresh snapshot plus any non-fatal DeepSeek error.
 */
export async function refreshCore(): Promise<RefreshResult> {
  if (!isTauri) {
    await delay(500);
    return { snapshot: mockCoreSnapshot(), deepseekError: null };
  }
  return invoke<RefreshResult>("refresh_core");
}

/**
 * Subscribes to core snapshot events. The handler receives the full
 * `DashboardSummary` payload. Returns an unsubscribe function.
 */
export async function subscribeToCoreSnapshot(
  handler: (snapshot: DashboardSummary) => void,
): Promise<() => void> {
  if (!isTauri) return () => undefined;
  return listen<DashboardSummary>("core-snapshot", (event) => {
    handler(event.payload);
  });
}

/**
 * @deprecated Use `getCoreSnapshot`. Kept for one release so older UI builds
 * keep working; it ignores `days` and always returns the core-owned range.
 */
export async function getDashboard(_days = 30): Promise<DashboardSummary> {
  return getCoreSnapshot();
}

export async function getSettings(): Promise<SettingsView> {
  if (!isTauri) {
    await delay(80);
    return mockSettingsView;
  }
  return invoke<SettingsView>("get_settings");
}

export async function saveSettings(settings: Settings): Promise<SettingsView> {
  if (!isTauri) {
    await delay(220);
    return {
      settings,
      hasDeepseekApiKey: true,
      deepseekKeySource: "keychain",
      deepseekKeyError: null,
      restartRequired: false,
      launchAtLoginSupported: true,
      launchAtLoginError: null,
    };
  }
  return invoke<SettingsView>("save_settings", { settings });
}

export async function saveDeepSeekApiKey(
  apiKey: string | null,
): Promise<SettingsView> {
  if (!isTauri) {
    await delay(180);
    return {
      ...mockSettingsView,
      hasDeepseekApiKey: Boolean(apiKey),
      deepseekKeySource: apiKey ? "keychain" : null,
      deepseekKeyError: null,
    };
  }
  return invoke<SettingsView>("save_deepseek_api_key", { apiKey });
}

export async function retryDeepSeekKeychain(): Promise<SettingsView> {
  if (!isTauri) {
    await delay(180);
    return { ...mockSettingsView, deepseekKeyError: null };
  }
  return invoke<SettingsView>("retry_deepseek_keychain");
}

export async function getDeepSeekStatus(): Promise<DeepSeekStatus> {
  if (!isTauri) {
    await delay(80);
    return mockDeepSeekStatus;
  }
  return invoke<DeepSeekStatus>("get_deepseek_status");
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
  if (!isTauri) {
    await delay(120);
    return mockBalanceHistory(since, until, currency);
  }
  return invoke<BalanceSnapshot[]>("get_balance_history", {
    currency,
    since,
    until,
  });
}

export async function clearUsageData(): Promise<ClearDataResult> {
  if (!isTauri) {
    await delay(250);
    return { ollamaLogs: 1284, deepseekBalances: 96 };
  }
  return invoke<ClearDataResult>("clear_usage_data");
}

/**
 * Lazy, read-only per-hour breakdown for one local calendar day. Not part of
 * the core snapshot; computed on demand for the day drill-down panel.
 */
export async function getDayUsageDetail(date: string): Promise<DayUsageDetail> {
  if (!isTauri) {
    await delay(120);
    return mockDayUsageDetail(date);
  }
  return invoke<DayUsageDetail>("get_day_usage_detail", { date });
}

export async function getModelCatalog(): Promise<ModelCatalogEntry[]> {
  if (!isTauri) {
    await delay(80);
    return mockModelCatalog();
  }
  return invoke<ModelCatalogEntry[]>("get_model_catalog");
}

export async function deleteModelData(
  models: string[],
): Promise<ModelMutationResult> {
  if (!isTauri) {
    await delay(180);
    return mockDeleteModelData(models);
  }
  return invoke<ModelMutationResult>("delete_model_data", { models });
}

export async function mergeModels(
  sources: string[],
  targetModel: string,
): Promise<ModelMutationResult> {
  if (!isTauri) {
    await delay(180);
    return mockMergeModels(sources, targetModel);
  }
  return invoke<ModelMutationResult>("merge_models", {
    sources,
    targetModel,
  });
}

export async function showMainWindow(): Promise<void> {
  if (!isTauri) return;
  await invoke("show_main_window");
}

export async function toggleWidget(visible?: boolean): Promise<boolean> {
  if (!isTauri) return Boolean(visible);
  return invoke<boolean>("toggle_widget", { visible });
}

export async function quitApp(): Promise<void> {
  if (!isTauri) return;
  await invoke("quit_app");
}

export async function openExternal(url: string): Promise<void> {
  if (!isTauri) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  await open(url);
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

export async function subscribeToWidgetShown(
  handler: () => void,
): Promise<() => void> {
  if (!isTauri) return () => undefined;
  return listen("widget-shown", handler);
}

export async function subscribeToWidgetHidden(
  handler: () => void,
): Promise<() => void> {
  if (!isTauri) return () => undefined;
  return listen("widget-hidden", handler);
}
