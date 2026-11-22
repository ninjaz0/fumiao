import { inspectModelList } from "@fumiao/plugin-sdk/index.js";
import { flowCanvasRuns } from "./canvas-runs.js";
import { flowOriginalText } from "./original-text.js";
import type { ProviderPlugin } from "@fumiao/plugin-sdk/index.js";
/** New immutable version; prior versions retain their original adapter. */
export const flowText: ProviderPlugin = {
  ...flowCanvasRuns,
  inspectService: inspectModelList,
  originalSubmission: flowOriginalText.originalSubmission,
  manifest: {
    ...flowCanvasRuns.manifest,
    version: "1.12.0",
    queue: {
      ...flowCanvasRuns.manifest.queue!,
      timingVersions: [
        ...flowCanvasRuns.manifest.queue!.timingVersions,
        "1.12.0",
      ],
    },
  },
};
