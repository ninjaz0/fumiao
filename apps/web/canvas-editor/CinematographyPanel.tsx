import type { CinematographySpec } from "./types";

const DIMENSIONS: {
  key: keyof CinematographySpec;
  label: string;
  options: string[];
}[] = [
  {
    key: "shot_size",
    label: "景别",
    options: ["特写", "近景", "中景", "全景", "大远景", "过肩镜头"],
  },
  {
    key: "camera_angle",
    label: "机位",
    options: ["平视", "低角度仰拍", "高角度俯拍", "鸟瞰航拍", "荷兰斜角"],
  },
  {
    key: "camera_movement",
    label: "运镜",
    options: [
      "固定机位",
      "缓慢推进",
      "镜头拉远",
      "水平跟拍",
      "环绕运镜",
      "手持晃动",
      "升降起幅",
    ],
  },
  {
    key: "lighting",
    label: "光影",
    options: [
      "自然日光",
      "黄金时刻",
      "赛博霓虹",
      "逆光轮廓",
      "高对比顶光",
      "柔和室内光",
    ],
  },
  {
    key: "lens",
    label: "焦段",
    options: ["24mm广角", "35mm人文", "50mm标准", "85mm人像", "135mm长焦"],
  },
  {
    key: "mood",
    label: "氛围",
    options: [
      "电影写实",
      "悬疑紧张",
      "温馨治愈",
      "史诗震撼",
      "赛博科幻",
      "复古胶片",
    ],
  },
];

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
  const setField = (key: keyof CinematographySpec, nextVal: string) => {
    const merged: CinematographySpec = { ...current };
    const trimmed = nextVal.trim();
    if (!trimmed) delete merged[key];
    else merged[key] = trimmed;
    onChange(Object.keys(merged).length ? merged : null);
  };
  const activeCount = Object.values(current).filter(Boolean).length;

  return (
    <div
      className={
        "fm-cine-panel" + (compact ? " fm-cine-compact" : "")
      }
      aria-label="导演镜头参数面板"
    >
      <div className="fm-cine-head">
        <strong>导演镜头参数 {activeCount > 0 ? `(${activeCount}/6)` : ""}</strong>
        {activeCount > 0 && (
          <button
            type="button"
            className="secondary fm-cine-clear"
            onClick={() => onChange(null)}
          >
            清空
          </button>
        )}
      </div>
      <div className="fm-cine-grid">
        {DIMENSIONS.map((dim) => {
          const val = current[dim.key] ?? "";
          return (
            <label key={dim.key} className="fm-cine-field">
              <span>{dim.label}</span>
              <select
                aria-label={`导演参数-${dim.label}`}
                value={dim.options.includes(val) ? val : val ? "__custom__" : ""}
                onChange={(e) => {
                  if (e.target.value === "__custom__") return;
                  setField(dim.key, e.target.value);
                }}
              >
                <option value="">不限定</option>
                {dim.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
                {val && !dim.options.includes(val) && (
                  <option value="__custom__">{val}</option>
                )}
              </select>
            </label>
          );
        })}
      </div>
    </div>
  );
}
