import { sha } from "./policy-crypto.js";
import models from "../models.json" with { type: "json" };

import type {
  ProviderPlugin,
  TimingFeatures,
} from "@fumiao/plugin-sdk/index.js";
export const standard = "h3-v3-rocm-qkv-safe-standard20",
  oldFast = "h3-v5-rocm-qkv-safe-turbo4",
  fast = "h3-v6-native-inputs-turbo4";
const ratios: Record<string, number[]> = {
  "16:9": [864, 480, 1344, 768],
  "9:16": [480, 864, 768, 1344],
  "1:1": [480, 480, 768, 768],
  "4:3": [640, 480, 1024, 768],
  "3:4": [480, 640, 768, 1024],
  "21:9": [1120, 480, 1568, 672],
};

function pythonString(value: unknown) {
  return value === true
    ? "True"
    : value === false
      ? "False"
      : value === null
        ? "None"
        : String(value);
}
// The original worker protocol validates VRAM as float, including integral GB.
function pythonFloat(value: number) {
  if (value !== 0 && Math.abs(value) < 1e-4)
    return value.toExponential().replace(/e([+-])(\d)$/, "e$10$2");
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}
export function hardwareSignature(profile: TimingFeatures["profile"]) {
  if (!String(profile.gpu_name || "").trim()) return "";
  const keys = [
    "backend",
    "gpu_name",
    "vram_gib",
    "used_gpus",
    "runtime",
    "driver",
    "torch_version",
    "precision",
    "attention",
    "memory_mode",
  ].sort();
  const encode = (s: string) =>
    JSON.stringify(s).replace(
      /[\u007f-\uffff]/g,
      (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
    );
  return sha(
    "{" +
      keys
        .map(
          (k) =>
            encode(k) +
            ": " +
            encode(
              (k === "vram_gib" && profile.vram_gib !== undefined
                ? pythonFloat(profile.vram_gib)
                : pythonString((profile as any)[k] ?? "")
              )
                .trim()
                .toLowerCase(),
            ),
        )
        .join(", ") +
      "}",
  ).slice(0, 32);
}
function preset(p: Record<string, any>, refs: number) {
  const meta = p.h3_inputs || {},
    reference = Object.keys(meta).length
      ? meta.mode === "reference" && refs > 0
      : refs > 1;
  return reference
    ? "ref2v-v01"
    : Number(p.quality ?? 480) === 768
      ? "fl2v-768-v10"
      : "fl2v-low-v10";
}
export function pipeline(p: Record<string, any>, refs: number) {
  const meta = p.h3_inputs || {};
  let mode: string;
  if (meta.mode === "frames")
    mode =
      meta.first_frame && meta.last_frame
        ? "fl2v"
        : meta.last_frame
          ? "l2v"
          : meta.first_frame
            ? "i2v"
            : "t2v";
  else if (meta.mode === "reference") {
    mode = refs ? "r2v" : "t2v";
    for (const kind of ["video", "audio"])
      if ((meta.files || []).some((f: any) => f.kind === kind))
        mode += "+" + kind;
  } else mode = p.video_mode || (refs > 1 ? "r2v" : refs ? "i2v" : "t2v");
  if ((p.sampling_steps ?? p.steps ?? 20) !== 4) return mode;
  const workflow = p.workflow || "",
    variant = workflow.startsWith("h3-turbo4-")
      ? workflow
      : ["", oldFast, fast].includes(workflow)
        ? "h3-turbo4-" + preset(p, refs)
        : "legacy-fast4:" + workflow;
  return mode + "|" + variant;
}
export const timingFeatures: NonNullable<ProviderPlugin["timingFeatures"]> = ({
  model,
  kind,
  input,
  node,
  previous,
  stage,
}) => {
  const p = input.params,
    profile = node?.model_profiles?.[model] || node?.profile || {},
    refs = input.references.length;
  const hardware = Object.keys(profile).length
      ? hardwareSignature(profile)
      : node?.hardware || "",
    runtime_id = node?.runtime_id || "";
  const spec = models[model as keyof typeof models];
  if (!spec) throw new Error("Unknown GPU model");
  if (kind === "audio") {
    const length = p.text_chars || Math.max(1, [...input.prompt].length),
      language =
        p.language || (/[\u4e00-\u9fff]/.test(input.prompt) ? "zh" : "en"),
      voice = p.audio_settings?.instruction ?? p.instruction ?? "";
    return {
      kind,
      model,
      executor: "gpu",
      workflow: String(spec.workflow),
      width: length,
      height: 1,
      seconds: 0,
      steps: 0,
      video_mode: "tts",
      quality: language + "|" + sha(voice).slice(0, 12),
      refs: 0,
      ref_pixels: 0,
      hardware,
      profile,
      runtime_id,
      cold:
        stage === "start" && runtime_id
          ? !(
              previous?.runtime_id === runtime_id &&
              previous.video_mode === "tts"
            )
          : null,
    };
  }
  const size = ratios[p.ratio || "16:9"];
  if (!size) throw new Error("Invalid GPU ratio");
  const offset = Number(p.quality ?? 480) === 768 ? 2 : 0,
    mode = pipeline(p, refs).split("|")[0];
  return {
    kind,
    model,
    executor: "gpu",
    workflow:
      p.sampling_steps === 4
        ? "h3-turbo4-" + preset(p, refs)
        : node?.workflow || standard,
    width: p.width ?? size[offset],
    height: p.height ?? size[offset + 1],
    seconds: p.seconds ?? 5,
    steps:
      p.sampling_steps ??
      (refs === 1 &&
      Number(p.quality) === 768 &&
      node?.workflow === "h3-v3-rocm-qkv-safe-fast4-i2v768"
        ? 4
        : 20),
    video_mode: mode,
    quality: String(p.quality ?? 480),
    refs,
    ref_pixels: input.references.reduce((n, r) => n + r.width * r.height, 0),
    hardware,
    profile,
    runtime_id,
    cold: runtime_id
      ? !(
          previous?.runtime_id === runtime_id &&
          pipeline(previous, previous.refs) === pipeline(p, refs)
        )
      : null,
  };
};
