import { requireValue } from "../security.js";
import type { DeclaredParameters } from "./discovery.js";

type Capabilities = DeclaredParameters & {
  duration_range?: { min: number; max: number };
  requires_first_frame?: boolean;
};

export function videoCapabilities(
  protocol: string,
  declared: Capabilities,
): Capabilities {
  const router = protocol === "openrouter-videos";
  const durations = declared.durations?.filter(
    (n) => Number.isSafeInteger(n) && n > 0 && n <= 120,
  );
  const range = declared.duration_range;
  const dimensions = (size: string) => {
    const parts = /^([1-9]\d{0,3})x([1-9]\d{0,3})$/.exec(size);
    return parts && Number(parts[1]) <= 8192 && Number(parts[2]) <= 8192;
  };
  return {
    durations,
    duration_range:
      range && range.min <= 120
        ? { min: range.min, max: Math.min(range.max, 120) }
        : undefined,
    automatic_duration: router && declared.automatic_duration === true,
    frame_images: declared.frame_images?.filter((f) => f === "first_frame"),
    requires_first_frame:
      declared.requires_first_frame ??
      (declared.input_modalities?.length === 1 &&
        declared.input_modalities[0] === "image"),
    sizes: declared.sizes?.filter(dimensions),
    resolutions: router ? declared.resolutions : undefined,
    aspect_ratios: router ? declared.aspect_ratios : undefined,
    upscale_only: declared.upscale_only,
  };
}

export function prepareVideoParameters(
  route: { protocol: string; capabilities: Capabilities },
  raw: Record<string, unknown>,
  refs: number,
) {
  const caps = videoCapabilities(route.protocol, route.capabilities);
  const durations = caps.durations ?? [];
  const range = caps.duration_range;
  const upper = Math.max(0, ...durations, range?.max ?? 0);
  requireValue(upper && !caps.upscale_only, 409, "线路缺少可用的视频时长");
  const seconds = Object.hasOwn(raw, "seconds")
    ? raw.seconds
    : (durations[0] ?? range?.min);
  const auto = seconds === -1 && caps.automatic_duration;
  requireValue(
    typeof seconds === "number" &&
      Number.isInteger(seconds) &&
      (auto ||
        durations.includes(seconds) ||
        (range && seconds >= range.min && seconds <= range.max)),
    400,
    "视频时长超出线路范围",
  );
  requireValue(
    refs <= (caps.frame_images?.includes("first_frame") ? 1 : 0) &&
      refs >= (caps.requires_first_frame ? 1 : 0),
    400,
    "首帧数量不符合线路要求",
  );
  const params: Record<string, unknown> = { seconds };
  const choices: Record<string, string[] | undefined> = {
    size: caps.sizes,
    resolution: caps.resolutions,
    aspect_ratio: caps.aspect_ratios,
  };
  for (const [key, value] of Object.entries(raw)) {
    if (key === "seconds") continue;
    requireValue(
      Object.hasOwn(choices, key) &&
        typeof value === "string" &&
        choices[key]?.includes(value),
      400,
      "线路不支持此视频参数",
    );
    params[key] = value;
  }
  requireValue(
    !params.size || (!params.resolution && !params.aspect_ratio),
    400,
    "请使用尺寸或分辨率与画幅",
  );
  return { params, count: auto ? upper : seconds };
}
