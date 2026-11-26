import React, { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, type LucideIcon } from "lucide-react";
import type { SelectChoice } from "./composer-options";

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
  align = "left",
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
  align?: "left" | "right";
  variant?: "chip" | "field";
}) {
  const [open, setOpen] = useState(false);
  const listboxId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    (
      menuRef.current?.querySelector<HTMLButtonElement>(
        '[aria-selected="true"]:not(:disabled)',
      ) ||
      menuRef.current?.querySelector<HTMLButtonElement>(
        '[role="option"]:not(:disabled)',
      ) ||
      menuRef.current
    )?.focus();
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [open]);

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
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
              items.length;
      items[next]?.focus();
    }
  };

  const selected = options.find((opt) => opt.value === value);
  const displayLabel = selected?.label ?? (value || "不限定");
  const triggerAriaLabel = `${ariaLabel}：${displayLabel}`;

  const menuClass = [
    "cv-menu",
    "fm-option-menu",
    direction === "up" ? "fm-option-up" : "",
    align === "right" ? "fm-option-right" : "",
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
          onClick={() => setOpen((prev) => !prev)}
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
          onClick={() => setOpen((prev) => !prev)}
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
                {isSelected && <Check size={14} />}
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
