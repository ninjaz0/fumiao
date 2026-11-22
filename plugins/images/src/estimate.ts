import { readFileSync } from "node:fs";
import { imagesOriginal } from "./original.js";
import {
  OriginalSubmissionError,
  type ProviderPlugin,
} from "@fumiao/plugin-sdk/index.js";
const sizes: Record<string, number[]> = JSON.parse(
  readFileSync(new URL("../sizes.json", import.meta.url), "utf8"),
);
const fail = (message: string): never => {
  throw new OriginalSubmissionError(message);
};
export const imagesEstimate: ProviderPlugin = {
  ...imagesOriginal,
  manifest: {
    ...imagesOriginal.manifest,
    version: "1.5.0",
    originalEstimate: { version: 1 },
    queue: {
      ...imagesOriginal.manifest.queue!,
      timingVersions: [
        ...imagesOriginal.manifest.queue!.timingVersions,
        "1.5.0",
      ],
    },
  },
  originalEstimate: {
    async prepare(d, r) {
      if (
        !["video", "image"].includes(d.kind) ||
        !Object.hasOwn(sizes, d.ratio)
      )
        fail("未知生成参数");
      if (
        d.kind !== "image" ||
        !["", "gpt-image-2.6-sunburst"].includes(d.model)
      )
        fail("未知生成模型");
      if (
        !["1K", "2K"].includes(d.resolution) ||
        !["low", "medium", "high"].includes(d.image_quality)
      )
        fail("未知生成参数");
      const offset = d.resolution === "1K" ? 0 : 2,
        [width, height] = sizes[d.ratio].slice(offset, offset + 2);
      const refs = await r.references(d.refs);
      return {
        model: "gpt-image-2.6-sunburst",
        kind: "image",
        references: refs.map((a) => a.id),
        params: { size: width + "x" + height, quality: d.image_quality },
      };
    },
  },
};
