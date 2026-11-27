import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Check, ChevronDown, type LucideIcon } from "lucide-react";
import type { SelectChoice } from "./composer-options";
import { resolveOptionMenuFloatingRect } from "./types";

export function OptionSelect<T extends string = string>({
  ariaLabel,
  value,
  options,
  onChange,
  icon: Icon,
  prefixLabel,
  active = false,
  disabled = false,
  direction = "down",
  variant = "chip",
}: {
  ariaLabel: string;
  value: T;
  options: readonly SelectChoice<T>[];
  onChange: (value: T) => void;
  icon?: LucideIcon;
  prefixLabel?: string;
  active?: boolean;
  disabled?: boolean;
  direction?: "down" | "up";
  variant?: "chip" | "field";
}) {
  const [open, setOpen] = useState(false);
  const [floatingStyle, setFloatingStyle] = useState<React.CSSProperties>({});
  const [resolvedDir, setResolvedDir] = useState<"down" | "up">(direction);
  const listboxId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const keyboardOpen = useRef(false);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const updateFloatingPosition = useCallback(() => {
    const trigger = buttonRef.current;
    if (!trigger || typeof window === "undefined") return;
    const rect = trigger.getBoundingClientRect();
    const menuEl = menuRef.current;
    const measuredWidth =
      menuEl && menuEl.offsetWidth > 0 ? menuEl.offsetWidth : undefined;
    const floating = resolveOptionMenuFloatingRect({
      triggerRect: rect,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      preferredDirection: direction,
      menuWidth: measuredWidth,
    });
    setResolvedDir(floating.direction);
    setFloatingStyle({
      position: "fixed",
      left: floating.left,
      right: "auto",
      top: floating.top ?? "auto",
      bottom: floating.bottom ?? "auto",
      minWidth: floating.minWidth,
      maxHeight: floating.maxHeight,
    });
  }, [direction]);

  useLayoutEffect(() => {
    if (!open) return;
    updateFloatingPosition();
    // Re-measure once menu width is laid out (and adjust if an ancestor sets a transformed containing block)
    const menuEl = menuRef.current;
    const trigger = buttonRef.current;
    if (menuEl && trigger && typeof window !== "undefined") {
      const floating = resolveOptionMenuFloatingRect({
        triggerRect: trigger.getBoundingClientRect(),
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight,
        preferredDirection: direction,
        menuWidth: menuEl.offsetWidth || undefined,
      });
      menuEl.style.left = `${floating.left}px`;
      menuEl.style.right = "auto";
      menuEl.style.minWidth = `${floating.minWidth}px`;
      menuEl.style.maxHeight = `${floating.maxHeight}px`;
      if (floating.direction === "up") {
        menuEl.style.top = "auto";
        menuEl.style.bottom = `${floating.bottom!}px`;
      } else {
        menuEl.style.bottom = "auto";
        menuEl.style.top = `${floating.top!}px`;
      }
      const actual = menuEl.getBoundingClientRect();
      const dx = actual.left - floating.left;
      if (Math.abs(dx) > 1) {
        menuEl.style.left = `${Math.round(floating.left - dx)}px`;
      }
      if (floating.direction === "down" && floating.top !== undefined) {
        const dy = actual.top - floating.top;
        if (Math.abs(dy) > 1) {
          menuEl.style.top = `${Math.round(floating.top - dy)}px`;
        }
      } else if (floating.direction === "up" && floating.bottom !== undefined) {
        const expectedBottomEdge = window.innerHeight - floating.bottom;
        const dy = actual.bottom - expectedBottomEdge;
        if (Math.abs(dy) > 1) {
          menuEl.style.bottom = `${Math.round(floating.bottom + dy)}px`;
        }
      }
    }
  }, [open, options.length, direction, updateFloatingPosition]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        (wrapRef.current?.contains(target) || menuRef.current?.contains(target))
      ) {
        return;
      }
      setOpen(false);
    };
    const handleScroll = (event: Event) => {
      const target = event.target as Node | null;
      if (target && menuRef.current?.contains(target)) return;
      updateFloatingPosition();
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("resize", updateFloatingPosition);
    window.addEventListener("scroll", handleScroll, true);
    const menu = menuRef.current;
    if (keyboardOpen.current) {
      (
        menu?.querySelector<HTMLButtonElement>(
          '[aria-selected="true"]:not(:disabled)',
        ) ??
        menu?.querySelector<HTMLButtonElement>('[role="option"]:not(:disabled)') ??
        menu
      )?.focus();
    } else {
      menu?.focus({ preventScroll: true });
    }
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("resize", updateFloatingPosition);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [open, updateFloatingPosition]);

  const handleBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    const nextFocused = event.relatedTarget as Node | null;
    if (nextFocused && event.currentTarget.contains(nextFocused)) {
      return;
    }
    setOpen(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!open) {
      if (
        event.target === buttonRef.current &&
        (event.key === "ArrowDown" || event.key === "ArrowUp")
      ) {
        event.preventDefault();
        event.stopPropagation();
        keyboardOpen.current = true;
        setOpen(true);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      const items = [
        ...(menuRef.current?.querySelectorAll<HTMLButtonElement>(
          '[role="option"]:not(:disabled)',
        ) || []),
      ];
      if (!items.length) return;
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const down = event.key === "ArrowDown";
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : current < 0
              ? down ? 0 : items.length - 1
              : (current + (down ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }
  };

  const toggleMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    keyboardOpen.current = event.detail === 0;
    setOpen((previous) => !previous);
  };

  const selected = options.find((opt) => opt.value === value);
  const displayLabel = selected?.label ?? (value || "不限定");
  const triggerAriaLabel = `${ariaLabel}：${displayLabel}`;

  const menuClass = [
    "cv-menu",
    "fm-option-menu",
    "fm-option-fixed",
    "fm-choice-menu",
    resolvedDir === "up" ? "fm-option-up" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={wrapRef}
      className={
        "fm-option-wrap" + (variant === "field" ? " fm-option-field-wrap" : "")
      }
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      {variant === "field" ? (
        <button
          ref={buttonRef}
          type="button"
          className={"fm-cine-trigger" + (open ? " open" : "")}
          data-filled={active ? "true" : "false"}
          aria-label={triggerAriaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          tabIndex={open ? -1 : undefined}
          disabled={disabled}
          onClick={toggleMenu}
        >
          {prefixLabel && <span className="fm-cine-label">{prefixLabel}</span>}
          <span className="fm-cine-val">{displayLabel}</span>
          <ChevronDown size={12} className="fm-ui-chevron" />
        </button>
      ) : (
        <button
          ref={buttonRef}
          type="button"
          className={"fm-ui-chip" + (active || open ? " active" : "")}
          aria-label={triggerAriaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          tabIndex={open ? -1 : undefined}
          disabled={disabled}
          onClick={toggleMenu}
        >
          {Icon && <Icon size={14} />}
          <span>{displayLabel}</span>
          <ChevronDown size={13} className="fm-ui-chevron" />
        </button>
      )}
      {open && (
        <div
          id={listboxId}
          ref={menuRef}
          className={menuClass}
          style={floatingStyle}
          role="listbox"
          aria-label={ariaLabel}
          tabIndex={-1}
        >
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value || "__empty__"}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={opt.disabled}
                title={opt.title}
                tabIndex={-1}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                  buttonRef.current?.focus();
                }}
              >
                <span>{opt.label}</span>
                {isSelected && <Check size={14} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SegmentedOptions<T extends string = string>({
  ariaLabel,
  value,
  options,
  onChange,
  disabled = false,
}: {
  ariaLabel: string;
  value: T;
  options: readonly SelectChoice<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="fm-grid-seg" role="group" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={opt.value === value}
          disabled={disabled || opt.disabled}
          title={opt.title}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
