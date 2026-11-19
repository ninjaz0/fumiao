import { gpuState } from "./state.js";
import type { ProviderPlugin } from "../../../packages/plugin-sdk/src/index.js";
export const gpuCanvas: ProviderPlugin = {
  ...gpuState,
  manifest: {
    ...gpuState.manifest,
    version: "1.9.0",
    queue: {
      ...gpuState.manifest.queue!,
      timingVersions: [...gpuState.manifest.queue!.timingVersions, "1.9.0"],
    },
    canvas: {
      version: 1,
      models: [
        {
          model: "MiniMax H3",
          kind: "video",
          defaultForKind: true,
          templatePriority: 0,
          durations: { values: [5, 10, 15], error: "MiniMax H3 时长选项无效" },
        },
      ],
    },
  },
};
