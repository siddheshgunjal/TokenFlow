import { classNames } from "../lib/format";
import logoMark from "../assets/logo-mark.png";

export function Logo({ className }: { className?: string }) {
  return (
    <img
      src={logoMark}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={classNames("shrink-0 object-contain", className ?? "h-9 w-9")}
    />
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={classNames(
        "font-sans font-bold tracking-tight text-white",
        className ?? "text-base",
      )}
    >
      TokenFlow
    </span>
  );
}

export function BrandLockup({
  markClassName,
  wordmarkClassName,
}: {
  markClassName?: string;
  wordmarkClassName?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Logo className={markClassName} />
      <Wordmark className={wordmarkClassName} />
    </div>
  );
}
