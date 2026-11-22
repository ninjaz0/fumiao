import { flowEstimate } from "./estimate.js";
import type { ProviderPlugin } from "@fumiao/plugin-sdk/index.js";
import { statePolicy } from "./studio-policies.js";
export const flowState: ProviderPlugin = {
  ...flowEstimate,
  manifest: {
    ...flowEstimate.manifest,
    version: "1.6.0",
    queue: {
      ...flowEstimate.manifest.queue!,
      timingVersions: [...flowEstimate.manifest.queue!.timingVersions, "1.6.0"],
    },
    originalState: {
      version: 1,
      fields: ["flow"],
      queueLane: "plugin",
      outputKinds: { image: "ref" },
    },
  },
  originalState: statePolicy,
};
