import { museEstimate } from "./estimate.js";
import { roundDecimal } from "@fumiao/plugin-sdk/decimal.js";
import {
  publicKeys,
  type ProviderPlugin,
} from "@fumiao/plugin-sdk/index.js";
export const museState: ProviderPlugin = {
  ...museEstimate,
  manifest: {
    ...museEstimate.manifest,
    version: "1.7.0",
    queue: {
      ...museEstimate.manifest.queue!,
      timingVersions: [...museEstimate.manifest.queue!.timingVersions, "1.7.0"],
    },
    originalState: {
      version: 1,
      fields: ["muse"],
      queueLane: "plugin",
      outputKinds: { image: "ref" },
    },
  },
  originalState: {
    configured: (c) => Boolean(c.baseUrl && c.apiKey),
    configuration: (c) => ({
      muse: {
        configured: c.connection?.configured ?? false,
        ready: Boolean(
          c.connection?.health.ready &&
          c.stamp - (c.connection.health.checked || 0) < 90,
        ),
        image_ratios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
        video_ratios: ["16:9", "9:16"],
        durations: [5, 6, 8, 10],
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
          },
        };
      if (["queued", "failed", "cancelled"].includes(j.state)) return {};
      return {
        note:
          j.state === "finalizing"
            ? "正在保存 Muse 成品"
            : !j.remoteId
              ? "正在提交 Muse"
              : j.phase === "queued"
                ? "等待 Muse 空闲账号"
                : j.phase === "preparing"
                  ? "正在准备 Muse"
                  : "Muse 生成中",
      };
    },
  },
};
