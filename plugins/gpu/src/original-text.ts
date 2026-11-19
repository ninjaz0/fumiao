import { pythonStrip } from "../../../packages/plugin-sdk/src/python-text.js";
import { createGpuOriginal } from "./original.js";
export const gpuOriginalText = createGpuOriginal(pythonStrip);
