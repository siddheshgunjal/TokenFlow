import { classNames } from "../lib/format";

export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={classNames(
        "grid shrink-0 place-items-center rounded-xl bg-gradient-to-br from-teal-300 via-cyan-400 to-sky-500 text-slate-950 shadow-glow",
        className ?? "h-9 w-9",
      )}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        className="h-[58%] w-[58%]"
      >
        <path d="M5 7.5h8.5a3.5 3.5 0 0 1 0 7H8" />
        <path d="M5 12h9" />
        <path d="M5 16.5h6a3 3 0 0 0 0-6" />
      </svg>
    </span>
  );
}
