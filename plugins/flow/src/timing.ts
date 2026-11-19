import { flowStudio } from "./studio.js";
import type { ProviderPlugin } from "../../../packages/plugin-sdk/src/index.js";
export const flowTiming: ProviderPlugin = {
  ...flowStudio,
  manifest: {
    ...flowStudio.manifest,
    version: "1.2.0",
    timing: {
      version: 1,
      geometry: "native",
      hardware: false,
      scaleSteps: false,
    },
  },
  timingFeatures({ model, kind, input }) {
    const spec = flowStudio.manifest.models.find((m) => m.id === model)?.studio
      ?.descriptor;
    if (!spec) throw new Error("Unknown Flow model");
    return {
      kind,
      model,
      executor: "flow-api",
      workflow: "flow2api-v1",
      width: 0,
      height: 0,
      native_ratio: String(spec.ratio),
      seconds: Number(spec.seconds),
      steps: 0,
      video_mode: String(spec.mode),
      quality: String(spec.resolution),
      refs: input.references.length,
      ref_pixels: input.references.reduce((n, r) => n + r.width * r.height, 0),
      hardware: "flow-api",
      profile: {},
      runtime_id: "",
      cold: null,
    };
  },
};
