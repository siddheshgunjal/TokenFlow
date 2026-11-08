import type { ReactNode } from "react";
import { motion } from "framer-motion";

import { classNames } from "../lib/format";

const accents = {
  teal: "bg-accent/10 text-accent ring-accent/20",
  violet: "bg-accent-strong/10 text-accent-strong ring-accent-strong/20",
  amber: "bg-warning/10 text-warning ring-warning/20",
  sky: "bg-accent-blue/10 text-accent-blue ring-accent-blue/20",
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
      className="card min-w-0 p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="label min-w-0 break-words">{label}</p>
        <span
          className={classNames(
            "grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-1",
            accents[accent],
          )}
        >
          {icon}
        </span>
      </div>
      <p className="mt-3 whitespace-nowrap text-[20px] font-semibold leading-none tracking-tight text-white tabular-nums xl:text-[22px]">
        {value}
      </p>
      {hint ? (
        <p
          className="mt-2 break-words text-[12px] leading-4 text-muted"
          title={hint}
        >
          {hint}
        </p>
      ) : null}
    </motion.div>
  );
}
