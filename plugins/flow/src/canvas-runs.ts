import { flowCanvas } from "./canvas.js";
import type { ProviderPlugin } from "@fumiao/plugin-sdk/index.js";
export const flowCanvasRuns: ProviderPlugin = {
  ...flowCanvas,
  manifest: {
    ...flowCanvas.manifest,
    version: "1.11.0",
    queue: {
      ...flowCanvas.manifest.queue!,
      timingVersions: [...flowCanvas.manifest.queue!.timingVersions, "1.11.0"],
    },
    canvasSubmission: {
      version: 1,
      models: flowCanvas.manifest.models.map((model) => ({
        model: model.id,
        kind: model.kind as "image" | "video",
        showModelLabel: true,
      })),
    },
  },
};
