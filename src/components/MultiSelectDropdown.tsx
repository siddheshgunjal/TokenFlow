import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { createPortal } from "react-dom";

import { classNames } from "../lib/format";
import { Icon } from "./Icons";

/**
 * A styled, keyboard-accessible multi-select dropdown.
 *
 * Like `SelectDropdown`, it renders in a portal above every card and closes on
 * outside click, Escape, and Tab. Unlike `SelectDropdown`, each row toggles a
 * checkbox and an empty selection means "All". An explicit "All" row clears the
 * selection, a search field appears when the list is long, and a Clear action
 * resets it. Arrow keys move, Space/Enter toggle, and the menu repositions on
 * scroll/resize.
 */
export function MultiSelectDropdown({
  values,
  onChange,
  options,
  ariaLabel,
  emptyLabel,
  menuSide = "down",
  minWidth = "10rem",
  maxHeight = "240px",
}: {
  /** Currently selected values; an empty array means "All". */
  values: string[];
  onChange: (values: string[]) => void;
  /** Distinct selectable values, in display order. */
  options: string[];
  ariaLabel: string;
  /** Label shown for an empty selection, e.g. "All models". */
  emptyLabel: string;
  menuSide?: "down" | "up";
  minWidth?: string;
  maxHeight?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLSpanElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});

  const selected = useMemo(() => new Set(values), [values]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return options;
    return options.filter((option) => option.toLowerCase().includes(query));
  }, [options, search]);

  // The trigger label: empty -> "All …", one -> that value, many -> "N …".
  const triggerLabel = useMemo(() => {
    if (values.length === 0) return emptyLabel;
    if (values.length === 1) return values[0];
    return `${values.length} ${emptyLabel.slice("All ".length).toLowerCase()}`;
  }, [values, emptyLabel]);

  const focusOption = useCallback((index: number) => {
    if (filtered.length === 0) return;
    const safe = (index + filtered.length) % filtered.length;
    menuRef.current
      ?.querySelector<HTMLButtonElement>(`[data-option-index="${safe}"]`)
      ?.focus();
  }, [filtered.length]);

  const closeAndRefocus = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const toggle = useCallback(
    (value: string) => {
      const next = new Set(values);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      onChange(Array.from(next));
    },
    [values, onChange],
  );

  // Close when clicking anywhere outside the component.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        !containerRef.current?.contains(event.target as Node) &&
        !menuRef.current?.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Move focus to the search field (or first option) as the menu opens.
  useLayoutEffect(() => {
    if (!open) return;
    if (searchRef.current) {
      searchRef.current.focus();
      return;
    }
    focusOption(0);
  }, [open, focusOption]);

  // The open menu is rendered in a portal above every card, so it is positioned
  // against the viewport and re-checks on scroll/resize.
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (!trigger) return;
    const tr = trigger.getBoundingClientRect();

    const right = Math.max(8 * 4, window.innerWidth - tr.right - 4);
    const maxWidth = Math.max(8 * 4, tr.right - 4);

    setMenuStyle({
      position: "fixed",
      zIndex: 1000,
      right: `${right}px`,
      ...(menuSide === "down"
        ? { top: tr.bottom + 4 }
        : { bottom: tr.top - 4 }),
      minWidth,
      maxHeight,
      maxWidth: `${maxWidth}px`,
    });

    const reposition = () => {
      if (!triggerRef.current) return;
      const tr = triggerRef.current.getBoundingClientRect();
      const maxWidth = Math.max(8 * 4, tr.right - 4);
      setMenuStyle((current) => ({
        ...current,
        right: `${Math.max(8 * 4, window.innerWidth - tr.right - 4)}px`,
        ...(menuSide === "down"
          ? { top: tr.bottom + 4 }
          : { bottom: tr.top - 4 }),
        ...(maxWidth ? { maxWidth: `${maxWidth}px` } : null),
      }));
    };

    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, menuSide, minWidth, maxHeight]);

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

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLSpanElement>) => {
    const index = filtered.findIndex((option) => option === values[0]);
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusOption(index >= 0 ? index + 1 : 0);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusOption(index >= 0 ? index - 1 : 0);
        break;
      case "Home":
        event.preventDefault();
        focusOption(0);
        break;
      case "End":
        event.preventDefault();
        focusOption(filtered.length - 1);
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

  const showSearch = options.length > 8;

  const renderOption = (value: string, index: number) => {
    const checked = selected.has(value);
    return (
      <button
        key={value}
        type="button"
        role="option"
        aria-selected={checked}
        data-option-index={index}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => toggle(value)}
        onKeyDown={(event) => {
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            toggle(value);
          }
        }}
        className={classNames(
          "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] transition-colors focus:outline-none focus-visible:bg-white/[0.05]",
          checked ? "text-ink" : "text-muted hover:text-ink",
        )}
      >
        <span
          aria-hidden="true"
          className={classNames(
            "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
            checked
              ? "border-accent bg-accent text-white"
              : "border-white/25 bg-transparent",
          )}
        >
          {checked ? <Icon name="check" className="h-2.5 w-2.5" /> : null}
        </span>
        <span className="truncate">{value}</span>
      </button>
    );
  };

  return (
    <span ref={containerRef} className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => {
          setSearch("");
          setOpen((value) => !value);
        }}
        onKeyDown={handleTriggerKeyDown}
        className={classNames(
          "flex items-center gap-1 rounded-md border py-1 pl-2.5 pr-7 text-[12px] font-medium outline-none transition-colors",
          open
            ? "border-accent/50 bg-white/[0.05] text-ink"
            : "border-white/10 bg-[#0b1220] text-white hover:bg-white/[0.05] hover:text-ink focus-visible:border-accent/50",
        )}
        style={{ minWidth }}
      >
        <span className="max-w-[12rem] truncate">{triggerLabel}</span>
        <Icon
          name="chevron-right"
          className={classNames(
            "pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 rotate-90 text-muted transition-transform duration-150",
            open && "rotate-[270deg]",
          )}
        />
      </button>

      {open
        ? createPortal(
            <span
              ref={menuRef}
              role="listbox"
              aria-label={ariaLabel}
              tabIndex={-1}
              onKeyDown={handleMenuKeyDown}
              className="flex flex-col gap-0.5 overflow-y-auto rounded-lg border border-white/10 bg-[#0b1220] p-1 shadow-lg outline-none"
              style={menuStyle}
            >
              {showSearch ? (
                <span className="px-1 pb-1">
                  <input
                    ref={searchRef}
                    type="text"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={`Search ${emptyLabel}…`}
                    className="w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-[12px] text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/40"
                  />
                </span>
              ) : null}

              <button
                type="button"
                role="option"
                aria-selected={values.length === 0}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onChange([])}
                className={classNames(
                  "flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-[12px] font-medium transition-colors focus:outline-none focus-visible:bg-white/[0.05]",
                  values.length === 0
                    ? "bg-white/[0.06] text-ink"
                    : "text-muted hover:bg-white/[0.05] hover:text-ink",
                )}
              >
                {emptyLabel}
              </button>

              <span className="my-0.5 block h-px bg-white/10" />

              {filtered.length === 0 ? (
                <span className="px-2.5 py-1.5 text-[12px] text-muted">
                  No matches
                </span>
              ) : (
                filtered.map((value, index) => renderOption(value, index))
              )}

              {values.length > 0 ? (
                <>
                  <span className="my-0.5 block h-px bg-white/10" />
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      onChange([]);
                      closeAndRefocus();
                    }}
                    className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-left text-[12px] text-muted transition-colors hover:bg-white/[0.05] hover:text-ink focus:outline-none focus-visible:bg-white/[0.05]"
                  >
                    <Icon name="x" className="h-3 w-3" />
                    Clear
                  </button>
                </>
              ) : null}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
