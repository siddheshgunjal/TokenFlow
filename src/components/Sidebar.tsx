import { motion } from "framer-motion";

import { classNames } from "../lib/format";
import type { ProxyStatus } from "../lib/types";
import { Icon, type IconName } from "./Icons";
import { Logo } from "./Logo";

export type Page = "dashboard" | "settings";

const NAV_ITEMS: Array<{ id: Page; label: string; icon: IconName }> = [
  { id: "dashboard", label: "Dashboard", icon: "grid" },
  { id: "settings", label: "Settings", icon: "settings" },
];

export function Sidebar({
  page,
  onNavigate,
  proxy,
}: {
  page: Page;
  onNavigate: (page: Page) => void;
  proxy: ProxyStatus;
}) {
  return (
    <aside className="flex w-[228px] shrink-0 flex-col border-r border-white/[0.06] bg-[#080d16]/70">
      <div className="flex items-center gap-2.5 px-5 pb-6 pt-6">
        <Logo className="h-9 w-9" />
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-tight text-white">
            TokenFlow
          </p>
          <p className="truncate text-[10px] text-slate-500">
            Ollama + DeepSeek usage
          </p>
        </div>
      </div>

      <nav className="space-y-1 px-3" aria-label="Primary">
        {NAV_ITEMS.map((item) => {
          const active = page === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={classNames("nav-item", active && "text-white")}
              aria-current={active ? "page" : undefined}
            >
              {active ? (
                <motion.span
                  layoutId="sidebar-active"
                  className="absolute inset-0 rounded-xl border border-teal-400/15 bg-teal-400/[0.08]"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              ) : null}
              <Icon name={item.icon} className="relative h-4 w-4" />
              <span className="relative">{item.label}</span>
              {active ? (
                <Icon
                  name="chevron-right"
                  className="relative ml-auto h-3.5 w-3.5 text-teal-300/70"
                />
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto p-3">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <span
              className={classNames(
                "h-1.5 w-1.5 rounded-full",
                proxy.running
                  ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]"
                  : "bg-rose-400",
              )}
            />
            Proxy {proxy.running ? "online" : "offline"}
          </div>
          <p
            className="mt-1.5 truncate font-mono text-[10px] text-slate-600"
            title={proxy.error ?? proxy.bindAddress}
          >
            {proxy.running
              ? proxy.bindAddress
              : (proxy.error ?? "Starting…")}
          </p>
          <div className="mt-3 flex items-center gap-1.5 text-[10px] text-slate-600">
            <Icon name="shield" className="h-3 w-3" />
            Stored on this device
          </div>
        </div>
      </div>
    </aside>
  );
}
