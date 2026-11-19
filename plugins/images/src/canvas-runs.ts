import { imagesCanvas } from "./canvas.js";
import type { ProviderPlugin } from "../../../packages/plugin-sdk/src/index.js";
export const imagesCanvasRuns: ProviderPlugin = {
  ...imagesCanvas,
  manifest: {
    ...imagesCanvas.manifest,
    version: "1.10.0",
    queue: {
      ...imagesCanvas.manifest.queue!,
      timingVersions: [
        ...imagesCanvas.manifest.queue!.timingVersions,
        "1.10.0",
      ],
    },
    canvasSubmission: {
      version: 1,
      models: [
        {
          model: "gpt-image-2.6-sunburst",
          kind: "image",
          defaultForKind: true,
        },
      ],
    },
  },
};
