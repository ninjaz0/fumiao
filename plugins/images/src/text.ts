import { imagesCanvasRuns } from "./canvas-runs.js";
import { imagesOriginalText } from "./original-text.js";
import type { ProviderPlugin } from "@fumiao/plugin-sdk/index.js";
/** New immutable version; prior versions retain their original adapter. */
export const imagesText: ProviderPlugin = {
  ...imagesCanvasRuns,
  originalSubmission: imagesOriginalText.originalSubmission,
  manifest: {
    ...imagesCanvasRuns.manifest,
    version: "1.12.0",
    queue: {
      ...imagesCanvasRuns.manifest.queue!,
      timingVersions: [
        ...imagesCanvasRuns.manifest.queue!.timingVersions,
        "1.12.0",
      ],
    },
  },
};
