import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-shell";

import {
  mockBalanceHistory,
  mockDashboard,
  mockDeepSeekStatus,
  mockSettingsView,
} from "./mock";
import type {
  BalanceSnapshot,
  ClearDataResult,
  DashboardSummary,
  DeepSeekStatus,
  Settings,
  SettingsView,
} from "./types";

export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const delay = (milliseconds: number) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds));

export async function getDashboard(days = 30): Promise<DashboardSummary> {
  if (!isTauri) {
    await delay(120);
    return mockDashboard(days);
  }
  return invoke<DashboardSummary>("get_dashboard", { days });
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

export async function refreshDeepSeekBalance(): Promise<BalanceSnapshot[]> {
  if (!isTauri) {
    await delay(500);
    return mockDeepSeekStatus.balances;
  }
  return invoke<BalanceSnapshot[]>("refresh_deepseek_balance");
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

export async function subscribeToUpdates(
  handler: () => void,
): Promise<() => void> {
  if (!isTauri) return () => undefined;

  const unlisteners = await Promise.all([
    listen("ollama-usage", handler),
    listen("deepseek-balance", handler),
    listen("proxy-status", handler),
  ]);

  return () => {
    for (const unlisten of unlisteners) unlisten();
  };
}
