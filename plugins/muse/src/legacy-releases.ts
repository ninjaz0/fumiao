import { muse } from "./index.js";
import { museStudio } from "./studio.js";
import { museTiming } from "./timing.js";
import { museQueue } from "./queue.js";
import { museClock } from "./clock.js";
import { museOriginal } from "./original.js";
import { museEstimate } from "./estimate.js";
import { museState } from "./state.js";
import { museDownload } from "./download.js";
import { museArtifacts } from "./artifacts.js";
import { museLifecycle } from "./lifecycle.js";
import { museCanvas } from "./canvas.js";
import { museCanvasRuns } from "./canvas-runs.js";
import { museText } from "./text.js";

// Published versions referenced by existing databases and frozen jobs.
export const releases = [
  muse,
  museStudio,
  museTiming,
  museQueue,
  museClock,
  museOriginal,
  museEstimate,
  museState,
  museDownload,
  museArtifacts,
  museLifecycle,
  museCanvas,
  museCanvasRuns,
  museText,
] as const;
export const studio = [museStudio, museText, "Muse2API"] as const;
