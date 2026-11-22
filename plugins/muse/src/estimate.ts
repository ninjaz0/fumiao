import { museOriginal } from "./original.js";
import {
  OriginalSubmissionError,
  type ProviderPlugin,
} from "@fumiao/plugin-sdk/index.js";
const fail = (message: string): never => {
  throw new OriginalSubmissionError(message);
};
export const museEstimate: ProviderPlugin = {
  ...museOriginal,
  manifest: {
    ...museOriginal.manifest,
    version: "1.6.0",
    originalEstimate: { version: 1 },
    queue: {
      ...museOriginal.manifest.queue!,
      timingVersions: [...museOriginal.manifest.queue!.timingVersions, "1.6.0"],
    },
  },
  originalEstimate: {
    async prepare(d, r) {
      if (d.model !== "muse-" + d.kind) fail("模型与生成类型不匹配");
      if (
        !["video", "image"].includes(d.kind) ||
        !["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"].includes(d.ratio)
      )
        fail("未知生成参数");
      if (d.sampling_steps !== 20) fail("Muse 不支持采样步数设置");
      if (
        !(
          d.kind === "image"
            ? ["1:1", "16:9", "9:16", "4:3", "3:4"]
            : ["16:9", "9:16"]
        ).includes(d.ratio) ||
        (d.kind === "video" && ![5, 6, 8, 10].includes(d.seconds))
      )
        fail("未知 Muse 参数");
      const refs = await r.references(d.refs);
      return {
        model: d.model,
        kind: d.kind as "image" | "video",
        references: refs.map((a) => a.id),
        params: { ratio: d.ratio, seconds: d.kind === "video" ? d.seconds : 0 },
      };
    },
  },
};
