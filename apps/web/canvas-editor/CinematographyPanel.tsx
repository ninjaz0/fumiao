import { Clapperboard } from "lucide-react";
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
}: {
  value?: CinematographySpec | null;
  onChange: (next: CinematographySpec | null) => void;
  compact?: boolean;
}) {
  const current = value ?? {};
  const activeCount = countActiveCinematography(current);

  return (
    <div
      className={"fm-cine-panel" + (compact ? " fm-cine-compact" : "")}
      aria-label="导演镜头参数面板"
    >
      <div className="fm-cine-head">
        <div className="fm-cine-title">
          <Clapperboard size={14} />
          <strong>导演镜头参数</strong>
          <span className="fm-cine-sub">
            {activeCount > 0 ? `已选 ${activeCount}/6 项` : "未限定，按提示词自由发挥"}
          </span>
        </div>
        {activeCount > 0 && (
          <button
            type="button"
            className="fm-cine-clear"
            onClick={() => onChange(null)}
          >
            清空
          </button>
        )}
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
