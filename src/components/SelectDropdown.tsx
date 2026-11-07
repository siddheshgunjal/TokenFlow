import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { classNames } from "../lib/format";
import { Icon } from "./Icons";

export interface SelectOption {
  /** Stable key; defaults to `value`. */
  id?: string;
  /** The value passed to `onChange`. */
  value: string;
  /** Visible label. */
  label: string;
}

export interface SelectGroup {
  /** Section header shown above the group's options; `""` hides the header. */
  label: string;
  options: SelectOption[];
}

/**
 * A styled, keyboard-accessible replacement for the native `<select>`.
 *
 * The native control renders differently across browser engines (and inside
 * the Tauri webview), so every dropdown in the UI goes through this single
 * component to keep the look and behavior consistent. It takes a list of
 * groups (a group with an empty `label` is a flat list), closes on outside
 * click, Escape, Tab, and selection, and navigates with the arrow keys.
 */
export function SelectDropdown({
  value,
  onChange,
  ariaLabel,
  groups,
  menuSide = "down",
  minWidth = "8rem",
  maxHeight = "240px",
}: {
  /** The currently selected value (matched against each option's `value`). */
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  /**
   * Ordered sections. A group whose `label` is `""` renders as a flat list
   * with no header, so a single-section list is just a plain dropdown.
   */
  groups: SelectGroup[];
  /** Which side of the trigger the menu opens on. */
  menuSide?: "down" | "up";
  /** Minimum width of the trigger and menu. */
  minWidth?: string;
  /** Maximum height of the scrollable menu. */
  maxHeight?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLSpanElement | null>(null);
  const [menuMaxWidth, setMenuMaxWidth] = useState<string | undefined>(
    undefined,
  );

  // Flatten the sections into one list for keyboard navigation and lookups.
  const flat = useMemo(
    () => groups.flatMap((group) => group.options),
    [groups],
  );

  const current = useMemo(
    () => flat.find((option) => option.value === value),
    [flat, value],
  );

  const focusOption = useCallback(
    (index: number) => {
      if (flat.length === 0) return;
      const safe = (index + flat.length) % flat.length;
      menuRef.current
        ?.querySelector<HTMLButtonElement>(`[data-option-index="${safe}"]`)
        ?.focus();
    },
    [flat.length],
  );

  const closeAndRefocus = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const select = useCallback(
    (next: string) => {
      if (next === value) {
        closeAndRefocus();
        return;
      }
      setOpen(false);
      onChange(next);
      requestAnimationFrame(() => triggerRef.current?.focus());
    },
    [onChange, value, closeAndRefocus],
  );

  // Close when clicking anywhere outside the component.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Move focus to the selected option (or the first) as the menu opens.
  useLayoutEffect(() => {
    if (!open) return;
    const index = flat.findIndex((option) => option.value === value);
    focusOption(index >= 0 ? index : 0);
  }, [open, flat, value, focusOption]);

  // Clamp the menu width to the space available to the left of the trigger so
  // it never overflows the window (the menu is right-aligned to the trigger).
  useLayoutEffect(() => {
    if (!open) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuMaxWidth(`${Math.max(8 * 4, rect.right - 4)}px`);
  }, [open]);

  // The trigger opens on any activating key while closed.
  const handleTriggerKeyDown = (event: ReactKeyboardEvent) => {
    if (open) return;
    if (
      event.key === "ArrowDown" ||
      event.key === "ArrowUp" ||
      event.key === "Enter" ||
      event.key === " "
    ) {
      event.preventDefault();
      setOpen(true);
    }
  };

  // While open, focus lives on an option button inside the menu.
  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLSpanElement>) => {
    const index = flat.findIndex((option) => option.value === value);
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusOption(index + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusOption(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusOption(0);
        break;
      case "End":
        event.preventDefault();
        focusOption(flat.length - 1);
        break;
      case "Escape":
      case "Tab":
        event.preventDefault();
        closeAndRefocus();
        break;
      default:
        break;
    }
  };

  const renderOption = (option: SelectOption, index: number) => {
    const key = option.id ?? option.value;
    const selected = option.value === value;
    return (
      <button
        key={key}
        type="button"
        role="option"
        data-option-index={index}
        aria-selected={selected}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => select(option.value)}
        className={classNames(
          "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] transition-colors focus:outline-none",
          selected
            ? "bg-white/[0.06] text-ink"
            : "text-muted hover:bg-white/[0.05] hover:text-ink focus-visible:bg-white/[0.05] focus-visible:text-ink",
        )}
      >
        <span className="truncate">{option.label}</span>
        {selected ? (
          <Icon name="check" className="h-3 w-3 shrink-0 text-accent" />
        ) : null}
      </button>
    );
  };

  let cursor = 0;

  return (
    <span ref={containerRef} className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={handleTriggerKeyDown}
        className={classNames(
          "flex items-center gap-1 rounded-md border py-1 pl-2.5 pr-7 text-[12px] font-medium outline-none transition-colors",
          open
            ? "border-accent/50 bg-white/[0.05] text-ink"
            : "border-white/10 bg-[#0b1220] text-white hover:bg-white/[0.05] hover:text-ink focus-visible:border-accent/50",
        )}
        style={{ minWidth }}
      >
        <span className="max-w-[10rem] truncate">
          {current?.label ?? value}
        </span>
        <Icon
          name="chevron-right"
          className={classNames(
            "pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 rotate-90 text-muted transition-transform duration-150",
            open && "rotate-[270deg]",
          )}
        />
      </button>

      {open ? (
        <span
          ref={menuRef}
          role="listbox"
          aria-label={ariaLabel}
          tabIndex={-1}
          onKeyDown={handleMenuKeyDown}
          className={classNames(
            "absolute right-0 z-30 flex flex-col gap-0.5 overflow-y-auto rounded-lg border border-white/10 bg-[#0b1220] p-1 shadow-lg outline-none",
            menuSide === "down" ? "top-full" : "bottom-full",
          )}
          style={{
            minWidth,
            maxHeight,
            ...(menuMaxWidth ? { maxWidth: menuMaxWidth } : null),
          }}
        >
          {groups.map((group) => {
            const offset = cursor;
            cursor += group.options.length;
            return (
              <span key={group.label || "options"} className="block">
                {group.label ? (
                  <span className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/80">
                    {group.label}
                  </span>
                ) : null}
                {group.options.map((option, index) =>
                  renderOption(option, offset + index),
                )}
              </span>
            );
          })}
        </span>
      ) : null}
    </span>
  );
}
