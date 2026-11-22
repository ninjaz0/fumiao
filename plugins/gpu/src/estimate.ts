import { gpuOriginal } from "./original.js";
import { estimatePolicy } from "./estimate-policy.js";
import type { ProviderPlugin } from "@fumiao/plugin-sdk/index.js";
export const gpuEstimate: ProviderPlugin = {
  ...gpuOriginal,
  manifest: {
    ...gpuOriginal.manifest,
    version: "1.7.0",
    originalEstimate: { version: 1 },
    queue: {
      ...gpuOriginal.manifest.queue!,
      timingVersions: [...gpuOriginal.manifest.queue!.timingVersions, "1.7.0"],
    },
  },
  originalEstimate: estimatePolicy,
};
