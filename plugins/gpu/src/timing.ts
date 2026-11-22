import { gpuStudio } from "./studio.js";
import type { ProviderPlugin } from "@fumiao/plugin-sdk/index.js";
import { timingFeatures, standard, oldFast, fast } from "./timing-policy.js";
export { hardwareSignature, pipeline } from "./timing-policy.js";
export const gpuTiming: ProviderPlugin = {
  ...gpuStudio,
  manifest: {
    ...gpuStudio.manifest,
    version: "1.2.0",
    timing: {
      version: 1,
      geometry: "pixels",
      hardware: true,
      scaleSteps: true,
      workflowAliases: Object.fromEntries(
        [standard, "h3-v4-rocm-qkv-safe-configurable", oldFast, fast].map(
          (w) => [w, "h3-native-qkv-safe"],
        ),
      ),
    },
  },
  timingFeatures,
};
