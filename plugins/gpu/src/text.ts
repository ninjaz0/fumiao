import { gpuCanvasRuns } from "./canvas-runs.js";
import { gpuOriginalText } from "./original-text.js";
import type { ProviderPlugin } from "../../../packages/plugin-sdk/src/index.js";
/** New immutable version; prior versions retain their original adapter. */
export const gpuText: ProviderPlugin = {
  ...gpuCanvasRuns,
  originalSubmission: gpuOriginalText.originalSubmission,
  manifest: {
    ...gpuCanvasRuns.manifest,
    version: "1.11.0",
    queue: {
      ...gpuCanvasRuns.manifest.queue!,
      timingVersions: [
        ...gpuCanvasRuns.manifest.queue!.timingVersions,
        "1.11.0",
      ],
    },
  },
};
