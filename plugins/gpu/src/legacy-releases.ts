import { gpu } from "./index.js";
import { gpuStudio } from "./studio.js";
import { gpuTiming } from "./timing.js";
import { gpuQueue } from "./queue.js";
import { gpuReferences } from "./references.js";
import { gpuNative } from "./native.js";
import { gpuOriginal } from "./original.js";
import { gpuEstimate } from "./estimate.js";
import { gpuState } from "./state.js";
import { gpuCanvas } from "./canvas.js";
import { gpuCanvasRuns } from "./canvas-runs.js";
import { gpuText } from "./text.js";

// Published versions referenced by existing databases and frozen jobs.
export const releases = [
  gpu,
  gpuStudio,
  gpuTiming,
  gpuQueue,
  gpuReferences,
  gpuNative,
  gpuOriginal,
  gpuEstimate,
  gpuState,
  gpuCanvas,
  gpuCanvasRuns,
  gpuText,
] as const;
export const studio = [gpuStudio, gpuText, "本地实例接入"] as const;
