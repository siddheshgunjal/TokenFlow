import type { ReactNode } from "react";
import { motion } from "framer-motion";

import { classNames } from "../lib/format";

const accents = {
  teal: "bg-accent/10 text-accent ring-accent/20",
  violet: "bg-violet-400/10 text-violet-300 ring-violet-400/20",
  amber: "bg-amber-400/10 text-amber-300 ring-amber-400/20",
  sky: "bg-sky-400/10 text-sky-300 ring-sky-400/20",
} as const;

export function StatCard({
  label,
  value,
  hint,
  icon,
  accent = "teal",
  delay = 0,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: ReactNode;
  accent?: keyof typeof accents;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: [0.22, 1, 0.36, 1] }}
      className="card p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="label">{label}</p>
          <p className="mt-2.5 whitespace-nowrap text-[27px] font-semibold leading-none tracking-tight text-white tabular-nums">
            {value}
          </p>
          {hint ? (
            <p className="mt-2 break-words text-xs leading-4 text-slate-500">
              {hint}
            </p>
          ) : null}
        </div>
        <span
          className={classNames(
            "grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-1",
            accents[accent],
          )}
        >
          {icon}
        </span>
      </div>
    </motion.div>
  );
}
