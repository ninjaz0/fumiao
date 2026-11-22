import { inspectModelList } from "@fumiao/plugin-sdk/index.js";
import { museCanvasRuns } from "./canvas-runs.js";
import { museOriginalText } from "./original-text.js";
import type { ProviderPlugin } from "@fumiao/plugin-sdk/index.js";
/** New immutable version; prior versions retain their original adapter. */
export const museText: ProviderPlugin = {
  ...museCanvasRuns,
  inspectService: inspectModelList,
  originalSubmission: museOriginalText.originalSubmission,
  manifest: {
    ...museCanvasRuns.manifest,
    version: "1.13.0",
    queue: {
      ...museCanvasRuns.manifest.queue!,
      timingVersions: [
        ...museCanvasRuns.manifest.queue!.timingVersions,
        "1.13.0",
      ],
    },
  },
};
