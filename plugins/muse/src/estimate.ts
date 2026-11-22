import { museOriginal } from "./original.js";
import type { ProviderPlugin } from "@fumiao/plugin-sdk/index.js";
import { estimatePolicy } from "./studio-policies.js";
export const museEstimate: ProviderPlugin = {
  ...museOriginal,
  manifest: {
    ...museOriginal.manifest,
    version: "1.6.0",
    originalEstimate: { version: 1 },
    queue: {
      ...museOriginal.manifest.queue!,
      timingVersions: [...museOriginal.manifest.queue!.timingVersions, "1.6.0"],
    },
  },
  originalEstimate: estimatePolicy,
};
