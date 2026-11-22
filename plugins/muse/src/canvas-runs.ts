import { museCanvas } from "./canvas.js";
import type { ProviderPlugin } from "@fumiao/plugin-sdk/index.js";
export const museCanvasRuns: ProviderPlugin = {
  ...museCanvas,
  manifest: {
    ...museCanvas.manifest,
    version: "1.12.0",
    queue: {
      ...museCanvas.manifest.queue!,
      timingVersions: [...museCanvas.manifest.queue!.timingVersions, "1.12.0"],
    },
    canvasSubmission: {
      version: 1,
      models: [
        { model: "muse-image", kind: "image" },
        { model: "muse-video", kind: "video", fixedSamplingSteps: 20 },
      ],
    },
  },
};
