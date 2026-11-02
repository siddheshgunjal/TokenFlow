import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";

import { Icon } from "./components/Icons";
import { Sidebar, type Page } from "./components/Sidebar";
import {
  getDashboard,
  isTauri,
  subscribeToUpdates,
  toggleWidget,
} from "./lib/api";
import type { DashboardSummary } from "./lib/types";
import { Dashboard } from "./pages/Dashboard";
import { SettingsPage } from "./pages/Settings";

export default function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);

    try {
      const summary = await getDashboard(30);
      setDashboard(summary);
      setLastUpdated(Date.now());
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      if (!quiet) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh(true);
  }, [refresh]);

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    let unsubscribe: (() => void) | undefined;

    subscribeToUpdates(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void refresh(true);
      }, 300);
    })
      .then((cleanup) => {
        if (disposed) cleanup();
        else unsubscribe = cleanup;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      unsubscribe?.();
    };
  }, [refresh]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refresh(true);
    }, 60_000);

    return () => window.clearInterval(interval);
  }, [refresh]);

  const handleNavigate = useCallback(
    (next: Page) => {
      setPage(next);
      setError(null);
      if (next === "dashboard") {
        void refresh(true);
      }
    },
    [refresh],
  );

  async function handleOpenWidget() {
    try {
      await toggleWidget(true);
    } catch (err) {
      setError(String(err));
    }
  }

  const proxy = dashboard?.proxy ?? {
    running: false,
    bindAddress: "",
    upstreamUrl: "",
    error: null,
  };

  return (
    <div className="app-surface flex h-screen overflow-hidden">
      <Sidebar page={page} onNavigate={handleNavigate} proxy={proxy} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-6 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold tracking-tight text-white">
                {page === "dashboard" ? "Usage overview" : "Settings"}
              </h1>
              {!isTauri ? (
                <span className="chip border-amber-400/20 bg-amber-400/[0.06] text-amber-300">
                  Browser preview
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              {page === "dashboard"
                ? "Local-first telemetry from your Ollama proxy."
                : "Configure the proxy, DeepSeek account, and desktop behavior."}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {lastUpdated ? (
              <span className="mr-1 hidden text-[11px] text-slate-600 sm:inline">
                Updated{" "}
                {new Date(lastUpdated).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => void handleOpenWidget()}
              className="btn-secondary"
            >
              <Icon name="monitor" className="h-3.5 w-3.5" />
              Widget
            </button>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={refreshing}
              className="btn-primary"
            >
              <Icon
                name="refresh"
                className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
              />
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {error ? (
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-rose-500/20 bg-rose-500/[0.06] px-4 py-3">
              <Icon name="alert" className="h-4 w-4 shrink-0 text-rose-300" />
              <p className="min-w-0 flex-1 text-xs leading-relaxed text-rose-200/80">
                {error}
              </p>
              <button
                type="button"
                onClick={() => void refresh()}
                className="btn-secondary border-rose-400/20 text-rose-200 hover:bg-rose-500/10"
              >
                Retry
              </button>
            </div>
          ) : null}

          <AnimatePresence mode="wait">
            {page === "dashboard" ? (
              <motion.div
                key="dashboard"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
              >
                {dashboard ? (
                  <Dashboard
                    data={dashboard}
                    onOpenSettings={() => handleNavigate("settings")}
                    onRefresh={() => void refresh(true)}
                  />
                ) : (
                  <DashboardSkeleton />
                )}
              </motion.div>
            ) : (
              <motion.div
                key="settings"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
              >
                <SettingsPage onSaved={() => void refresh(true)} />
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="card h-[112px] p-5">
            <div className="h-2.5 w-24 rounded bg-white/[0.06]" />
            <div className="mt-4 h-6 w-20 rounded bg-white/[0.07]" />
            <div className="mt-3 h-2 w-32 rounded bg-white/[0.04]" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="card h-64 lg:col-span-3" />
        <div className="card h-64 lg:col-span-2" />
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="card h-72 lg:col-span-2" />
        <div className="card h-72 lg:col-span-3" />
      </div>
    </div>
  );
}
