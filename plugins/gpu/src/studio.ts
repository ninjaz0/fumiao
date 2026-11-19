import { readFileSync } from "node:fs";
import { gpu } from "./index.js";
import type { ProviderPlugin } from "../../../packages/plugin-sdk/src/index.js";
const runtime = JSON.parse(
  readFileSync(new URL("../models.json", import.meta.url), "utf8"),
);
export const gpuStudio: ProviderPlugin = {
  ...gpu,
  manifest: {
    ...gpu.manifest,
    version: "1.1.0",
    models: gpu.manifest.models.map((model) => ({
      ...model,
      studio: {
        order: model.kind === "video" ? 0 : 4,
        priceOrder: model.kind === "video" ? 0 : 40,
        descriptor: { kind: model.kind, label: model.label },
        runtime: runtime[model.id],
        prices:
          model.kind === "video"
            ? [480, 768].flatMap((quality) =>
                [5, 10, 15].map((seconds) => ({
                  tier: `${quality}|${seconds}`,
                  label: `${quality}P · ${seconds}s`,
                  amount: null,
                  match: {
                    type: "object",
                    required: ["quality", "seconds"],
                    properties: {
                      quality: { const: quality },
                      seconds: { const: seconds },
                    },
                  },
                })),
              )
            : [
                {
                  tier: "standard",
                  label: "语音生成",
                  amount: 1,
                  match: { type: "object" },
                },
              ],
      },
    })),
  },
};
