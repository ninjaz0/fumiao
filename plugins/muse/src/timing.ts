import { museStudio } from "./studio.js";
import type { ProviderPlugin } from "@fumiao/plugin-sdk/index.js";
export const museTiming: ProviderPlugin = {
  ...museStudio,
  manifest: {
    ...museStudio.manifest,
    version: "1.2.0",
    timing: {
      version: 1,
      geometry: "native",
      hardware: false,
      scaleSteps: false,
    },
  },
  timingFeatures({ model, kind, input }) {
    return {
      kind,
      model,
      executor: "muse-api",
      workflow: "muse2api-native-v1",
      width: 0,
      height: 0,
      native_ratio: String(input.params.ratio || "16:9"),
      seconds: kind === "video" ? (input.params.seconds ?? 5) : 0,
      steps: 0,
      video_mode:
        kind === "video" ? (input.references.length ? "i2v" : "t2v") : "image",
      quality: "native",
      refs: input.references.length,
      ref_pixels: input.references.reduce((n, r) => n + r.width * r.height, 0),
      hardware: "muse-api",
      profile: {},
      runtime_id: "",
      cold: null,
    };
  },
};
