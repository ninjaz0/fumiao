import { pythonStrip } from "@fumiao/plugin-sdk/python-text.js";
import { createGpuOriginal } from "./original.js";
export const gpuOriginalText = createGpuOriginal(pythonStrip);
