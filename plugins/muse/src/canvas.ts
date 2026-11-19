import { studioRatios, studioSeconds } from "./studio.js";
import { museLifecycle } from "./lifecycle.js";
import type { ProviderPlugin } from "../../../packages/plugin-sdk/src/index.js";
export const museCanvas: ProviderPlugin = {
  ...museLifecycle,
  manifest: {
    ...museLifecycle.manifest,
    version: "1.11.0",
    queue: {
      ...museLifecycle.manifest.queue!,
      timingVersions: [
        ...museLifecycle.manifest.queue!.timingVersions,
        "1.11.0",
      ],
    },
    canvas: {
      version: 1,
      models: [
        {
          model: "muse-image",
          kind: "image",
          ratios: {
            values: studioRatios.image,
            error: "Muse 画幅选项无效",
          },
        },
        {
          model: "muse-video",
          kind: "video",
          templatePriority: 1,
          ratios: { values: studioRatios.video, error: "Muse 画幅选项无效" },
          durations: { values: studioSeconds, error: "Muse 时长选项无效" },
        },
      ],
    },
  },
};
