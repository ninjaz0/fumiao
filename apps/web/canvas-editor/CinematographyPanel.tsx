import { Clapperboard, X } from "lucide-react";
import {
  CINEMATOGRAPHY_DIMENSIONS,
  buildCinematographyOptions,
  countActiveCinematography,
  updateCinematographyField,
} from "./composer-options";
import { OptionSelect } from "./OptionSelect";
import type { CinematographySpec } from "./types";

export function CinematographyPanel({
  value,
  onChange,
  compact = false,
  floating = false,
  side = "right",
  onClose,
}: {
  value?: CinematographySpec | null;
  onChange: (next: CinematographySpec | null) => void;
  compact?: boolean;
  floating?: boolean;
  side?: "right" | "left" | "top";
  onClose?: () => void;
}) {
  const current = value ?? {};
  const activeCount = countActiveCinematography(current);

  return (
    <div
      className={
        "fm-cine-panel" +
        (compact ? " fm-cine-compact" : "") +
        (floating ? ` fm-cine-popover fm-cine-side-${side}` : "")
      }
      aria-label="导演镜头参数面板"
    >
      <div className="fm-cine-head">
        <div className="fm-cine-title">
          <Clapperboard size={14} />
          <strong>导演镜头参数</strong>
          <span className="fm-cine-sub">
            {activeCount > 0 ? `已选 ${activeCount}/6 项` : "未限定"}
          </span>
        </div>
        <div className="fm-cine-head-actions">
          {activeCount > 0 && (
            <button
              type="button"
              className="secondary fm-cine-clear"
              onClick={() => onChange(null)}
            >
              清空
            </button>
          )}
          {onClose && (
            <button
              type="button"
              className="icon-button fm-cine-close"
              aria-label="关闭导演参数"
              title="关闭"
              onClick={onClose}
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>
      <div className="fm-cine-grid">
        {CINEMATOGRAPHY_DIMENSIONS.map((dim, index) => {
          const val = current[dim.key]?.trim() ?? "";
          return (
            <div key={dim.key} className="fm-cine-field">
              <OptionSelect
                variant="field"
                ariaLabel={`导演参数-${dim.label}`}
                prefixLabel={dim.label}
                value={val}
                active={Boolean(val)}
                direction={index >= 3 ? "up" : "down"}
                options={buildCinematographyOptions(dim.options, val)}
                onChange={(nextVal) =>
                  onChange(updateCinematographyField(current, dim.key, nextVal))
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
