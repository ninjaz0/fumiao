import { readFileSync } from "node:fs";
import { flowOriginal } from "./original.js";
import {
  OriginalSubmissionError,
  type ProviderPlugin,
} from "@fumiao/plugin-sdk/index.js";
const models: Record<string, any> = JSON.parse(
  readFileSync(new URL("../models.json", import.meta.url), "utf8"),
);
export const flowEstimate: ProviderPlugin = {
  ...flowOriginal,
  manifest: {
    ...flowOriginal.manifest,
    version: "1.5.0",
    originalEstimate: { version: 1 },
    queue: {
      ...flowOriginal.manifest.queue!,
      timingVersions: [...flowOriginal.manifest.queue!.timingVersions, "1.5.0"],
    },
  },
  originalEstimate: {
    async prepare(d, r) {
      if (models[d.model]?.kind !== d.kind)
        throw new OriginalSubmissionError("模型与生成类型不匹配");
      const refs = await r.references(d.refs);
      return {
        model: d.model,
        kind: d.kind as "image" | "video",
        references: refs.map((a) => a.id),
        params: {},
      };
    },
  },
};
