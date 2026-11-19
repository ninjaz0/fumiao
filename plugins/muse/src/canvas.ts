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
            values: ["1:1", "16:9", "9:16", "4:3", "3:4"],
            error: "Muse 画幅选项无效",
          },
        },
        {
          model: "muse-video",
          kind: "video",
          templatePriority: 1,
          ratios: { values: ["16:9", "9:16"], error: "Muse 画幅选项无效" },
          durations: { values: [5, 6, 8, 10], error: "Muse 时长选项无效" },
        },
      ],
    },
  },
};
