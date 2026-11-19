import { gpuCanvas } from "./canvas.js";
import type { ProviderPlugin } from "../../../packages/plugin-sdk/src/index.js";
export const gpuCanvasRuns: ProviderPlugin = {
  ...gpuCanvas,
  manifest: {
    ...gpuCanvas.manifest,
    version: "1.10.0",
    queue: {
      ...gpuCanvas.manifest.queue!,
      timingVersions: [...gpuCanvas.manifest.queue!.timingVersions, "1.10.0"],
    },
    canvasSubmission: {
      version: 1,
      models: [
        {
          model: "MiniMax H3",
          kind: "video",
          defaultForKind: true,
          nativeH3: true,
        },
        { model: "breeze-tts-2", kind: "audio", defaultForKind: true },
      ],
    },
  },
};
