import { flowEstimate } from "./estimate.js";
import { roundDecimal } from "@fumiao/plugin-sdk/decimal.js";
import {
  publicKeys,
  type ProviderPlugin,
} from "@fumiao/plugin-sdk/index.js";
export const flowState: ProviderPlugin = {
  ...flowEstimate,
  manifest: {
    ...flowEstimate.manifest,
    version: "1.6.0",
    queue: {
      ...flowEstimate.manifest.queue!,
      timingVersions: [...flowEstimate.manifest.queue!.timingVersions, "1.6.0"],
    },
    originalState: {
      version: 1,
      fields: ["flow"],
      queueLane: "plugin",
      outputKinds: { image: "ref" },
    },
  },
  originalState: {
    configured: (c) => Boolean(c.baseUrl && c.apiKey),
    configuration: (c) => ({
      flow: {
        configured: c.connection?.configured ?? false,
        ready: Boolean(
          c.connection?.health.ready &&
          c.stamp - (c.connection.health.checked || 0) < 90,
        ),
        model_count: flowEstimate.manifest.models.length,
      },
    }),
    project: (j) => {
      if (j.state === "completed")
        return {
          width: j.metadata.width,
          height: j.metadata.height,
          actual: {
            ...publicKeys(j.metadata, ["width", "height"]),
            ...(j.kind === "video"
              ? {
                  duration: roundDecimal(j.metadata.duration, 3),
                  fps: j.metadata.fps ?? null,
                }
              : {}),
            ...publicKeys(j.view.actual || {}, ["flow_source_job"]),
            ...publicKeys(j.usage, ["flow_media_id"]),
          },
        };
      return ["queued", "failed", "cancelled"].includes(j.state)
        ? {}
        : { note: "Flow 正在生成" };
    },
  },
};
