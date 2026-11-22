import { flowOriginal } from "./original.js";
import type { ProviderPlugin } from "@fumiao/plugin-sdk/index.js";
import { estimatePolicy } from "./studio-policies.js";
export const flowEstimate: ProviderPlugin = {
  ...flowOriginal,
  manifest: {
    ...flowOriginal.manifest,
    version: "1.5.0",
    originalEstimate: { version: 1 },
    queue: {
      ...flowOriginal.manifest.queue!,
      timingVersions: [...flowOriginal.manifest.queue!.timingVersions, "1.5.0"],
    },
  },
  originalEstimate: estimatePolicy,
};
