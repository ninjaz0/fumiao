import { museEstimate } from "./estimate.js";
import type { ProviderPlugin } from "@fumiao/plugin-sdk/index.js";
import { statePolicy } from "./studio-policies.js";
export const museState: ProviderPlugin = {
  ...museEstimate,
  manifest: {
    ...museEstimate.manifest,
    version: "1.7.0",
    queue: {
      ...museEstimate.manifest.queue!,
      timingVersions: [...museEstimate.manifest.queue!.timingVersions, "1.7.0"],
    },
    originalState: {
      version: 1,
      fields: ["muse"],
      queueLane: "plugin",
      outputKinds: { image: "ref" },
    },
  },
  originalState: statePolicy,
};
