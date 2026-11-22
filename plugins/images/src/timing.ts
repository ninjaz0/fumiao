import { imagesStudio } from "./studio.js";
import type { ProviderPlugin } from "@fumiao/plugin-sdk/index.js";
export const imagesTiming: ProviderPlugin = {
  ...imagesStudio,
  manifest: {
    ...imagesStudio.manifest,
    version: "1.2.0",
    timing: {
      version: 1,
      geometry: "pixels",
      hardware: false,
      scaleSteps: false,
    },
  },
  async submit(execution) {
    await execution.reportTiming?.({ job_phase: "generating" });
    return imagesStudio.submit(execution);
  },
  timingFeatures({ model, kind, input, node }) {
    const p = input.params,
      [w, h] = String(p.size || "1024x1024")
        .split("x")
        .map(Number);
    return {
      kind,
      model,
      executor: "openai-api",
      workflow: "openai-images-png-v1",
      width: p.width ?? w,
      height: p.height ?? h,
      seconds: p.seconds ?? 0,
      steps: 0,
      video_mode: "image",
      quality: String(p.image_quality ?? p.quality ?? "medium"),
      refs: input.references.length,
      ref_pixels: input.references.reduce((n, r) => n + r.width * r.height, 0),
      hardware: "openai-api",
      profile: node?.model_profiles?.[model] || node?.profile || {},
      runtime_id: node?.runtime_id || "",
      cold: null,
    };
  },
};
