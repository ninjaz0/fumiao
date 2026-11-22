import { timingFeatures } from "./studio-policies.js";
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
  timingFeatures,
};
