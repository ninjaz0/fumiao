import { readFileSync } from "node:fs";
import { gpuEstimate } from "./estimate.js";
import { ratios } from "./inputs.js";
import {
  publicKeys,
  type ProviderPlugin,
} from "@fumiao/plugin-sdk/index.js";
const models = JSON.parse(
  readFileSync(new URL("../models.json", import.meta.url), "utf8"),
);
export const gpuState: ProviderPlugin = {
  ...gpuEstimate,
  manifest: {
    ...gpuEstimate.manifest,
    version: "1.8.0",
    queue: {
      ...gpuEstimate.manifest.queue!,
      timingVersions: [...gpuEstimate.manifest.queue!.timingVersions, "1.8.0"],
    },
    originalState: {
      version: 1,
      fields: ["ratios", "sizes", "gpu_models", "h3_limits"],
      queueLane: "kind",
      recovery: {
        maxAttempts: 2,
        retryNote: "实例离线，等待重新接单",
        failureNote: "实例连续中断，请重新生成",
      },
    },
  },
  originalState: {
    configured: () => true,
    configuration: () => ({
      ratios: Object.keys(ratios),
      sizes: ratios,
      gpu_models: models,
      h3_limits: {
        images: 9,
        videos: 3,
        audios: 3,
        total: 12,
        clip_seconds: 15,
      },
    }),
    project: (j) => ({
      ...(j.state === "completed"
        ? {
            actual: publicKeys(
              j.metadata,
              j.kind === "audio"
                ? ["duration", "sample_rate", "channels", "format"]
                : ["sampling_steps", "fast_mode", "h3_input_fingerprint"],
            ),
          }
        : {}),
      ...(["uploading", "validating"].includes(j.phase || "") &&
      !["completed", "failed", "cancelled"].includes(j.state)
        ? { note: "正在回传并校验成片" }
        : {}),
    }),
  },
};
