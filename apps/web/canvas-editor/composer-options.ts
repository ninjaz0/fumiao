import type { CanvasGenerationMode, CinematographySpec } from "./types.js";

export type SelectChoice<T extends string = string> = {
  value: T;
  label: string;
  disabled?: boolean;
  title?: string;
};

export const GENERATION_MODE_OPTIONS: readonly SelectChoice<CanvasGenerationMode>[] =
  [
    { value: "first_frame", label: "标准首帧" },
    { value: "first_last_frame", label: "经典首尾帧" },
    { value: "omni_ref", label: "全能 @图N 多参考" },
    { value: "grid_preview", label: "宫格构图预览" },
  ];

export const GRID_LAYOUT_OPTIONS: readonly SelectChoice<"2x2" | "3x3">[] = [
  { value: "2x2", label: "2×2" },
  { value: "3x3", label: "3×3" },
];

export const TURNAROUND_VIEW_OPTIONS: readonly SelectChoice<
  "sheet" | "front" | "side" | "back"
>[] = [
  { value: "sheet", label: "三视图总表" },
  { value: "front", label: "正面定妆" },
  { value: "side", label: "侧面定妆" },
  { value: "back", label: "背面定妆" },
];

export const CINEMATOGRAPHY_DIMENSIONS: readonly {
  key: keyof CinematographySpec;
  label: string;
  options: readonly string[];
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

export function resolveEffectiveGenerationMode(
  node: { type: string; generation_mode?: CanvasGenerationMode },
  h3Native: boolean,
  h3Frames: boolean,
): CanvasGenerationMode {
  if (node.generation_mode) return node.generation_mode;
  if (h3Native) return h3Frames ? "first_last_frame" : "omni_ref";
  return node.type === "video" ? "first_last_frame" : "first_frame";
}

export function countActiveCinematography(
  spec?: CinematographySpec | null,
): number {
  if (!spec) return 0;
  let count = 0;
  for (const dim of CINEMATOGRAPHY_DIMENSIONS) {
    const raw = spec[dim.key];
    if (typeof raw === "string" && raw.trim().length > 0) count += 1;
  }
  return count;
}

export function updateCinematographyField(
  spec: CinematographySpec | null | undefined,
  key: keyof CinematographySpec,
  nextVal: string,
): CinematographySpec | null {
  const merged: CinematographySpec = {};
  for (const dim of CINEMATOGRAPHY_DIMENSIONS) {
    const existing = spec?.[dim.key];
    if (typeof existing === "string" && existing.trim().length > 0) {
      merged[dim.key] = existing.trim();
    }
  }
  const trimmed = nextVal.trim();
  if (!trimmed) delete merged[key];
  else merged[key] = trimmed;
  return Object.keys(merged).length > 0 ? merged : null;
}

export function buildCinematographyOptions(
  defaultOptions: readonly string[],
  currentValue?: string | null,
): SelectChoice[] {
  const trimmed = typeof currentValue === "string" ? currentValue.trim() : "";
  const base: SelectChoice[] = [
    { value: "", label: "不限定" },
    ...defaultOptions.map((opt) => ({ value: opt, label: opt })),
  ];
  if (trimmed && !defaultOptions.includes(trimmed)) {
    base.push({ value: trimmed, label: trimmed });
  }
  return base;
}
