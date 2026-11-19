import { muse } from "./index.js";
import type { ProviderPlugin } from "../../../packages/plugin-sdk/src/index.js";
export const museStudio: ProviderPlugin = {
  ...muse,
  manifest: {
    ...muse.manifest,
    version: "1.1.0",
    models: muse.manifest.models.map((model) => ({
      ...model,
      studio: {
        order: model.kind === "video" ? 1 : 3,
        priceOrder: model.kind === "video" ? 10 : 30,
        descriptor: { kind: model.kind, label: "Muse" },
        prices:
          model.kind === "video"
            ? [5, 6, 8, 10].map((seconds) => ({
                tier: String(seconds),
                label: `原生 · ${seconds}s`,
                amount: null,
                match: {
                  type: "object",
                  required: ["seconds"],
                  properties: { seconds: { const: seconds } },
                },
              }))
            : [
                {
                  tier: "native",
                  label: "原生",
                  amount: null,
                  match: { type: "object" },
                },
              ],
      },
    })),
  },
};
