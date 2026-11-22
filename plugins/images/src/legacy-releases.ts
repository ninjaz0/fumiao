import { images } from "./index.js";
import { imagesStudio } from "./studio.js";
import { imagesTiming } from "./timing.js";
import { imagesQueue } from "./queue.js";
import { imagesOriginal } from "./original.js";
import { imagesEstimate } from "./estimate.js";
import { imagesState } from "./state.js";
import { imagesLifecycle } from "./lifecycle.js";
import { imagesSettings } from "./settings.js";
import { imagesCanvas } from "./canvas.js";
import { imagesCanvasRuns } from "./canvas-runs.js";
import { imagesText } from "./text.js";

// Published versions referenced by existing databases and frozen jobs.
export const releases = [
  images,
  imagesStudio,
  imagesTiming,
  imagesQueue,
  imagesOriginal,
  imagesEstimate,
  imagesState,
  imagesLifecycle,
  imagesSettings,
  imagesCanvas,
  imagesCanvasRuns,
  imagesText,
] as const;
export const studio = [imagesStudio, imagesText, "OpenAI 兼容图片"] as const;
