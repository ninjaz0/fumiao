import { flow } from "./index.js";
import { flowStudio } from "./studio.js";
import { flowTiming } from "./timing.js";
import { flowQueue } from "./queue.js";
import { flowOriginal } from "./original.js";
import { flowEstimate } from "./estimate.js";
import { flowState } from "./state.js";
import { flowDownload } from "./download.js";
import { flowArtifacts } from "./artifacts.js";
import { flowLifecycle } from "./lifecycle.js";
import { flowCanvas } from "./canvas.js";
import { flowCanvasRuns } from "./canvas-runs.js";
import { flowText } from "./text.js";

// Published versions referenced by existing databases and frozen jobs.
export const releases = [
  flow,
  flowStudio,
  flowTiming,
  flowQueue,
  flowOriginal,
  flowEstimate,
  flowState,
  flowDownload,
  flowArtifacts,
  flowLifecycle,
  flowCanvas,
  flowCanvasRuns,
  flowText,
] as const;
export const studio = [flowStudio, flowText, "Flow2API"] as const;
