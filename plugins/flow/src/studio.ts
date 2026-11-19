import { readFileSync } from "node:fs";
import { flow } from "./index.js";
import type { ProviderPlugin } from "../../../packages/plugin-sdk/src/index.js";
const catalog = JSON.parse(
  readFileSync(new URL("../models.json", import.meta.url), "utf8"),
);
export const flowStudio: ProviderPlugin = {
  ...flow,
  manifest: {
    ...flow.manifest,
    version: "1.1.0",
    models: flow.manifest.models.map((model, index) => ({
      ...model,
      studio: {
        order: 100 + index,
        priceOrder: 100 + index,
        descriptor: { ...catalog[model.id], hidden: !!model.hidden },
        prices: [
          {
            tier: "native",
            label: model.label,
            amount: 1,
            match: { type: "object" },
          },
        ],
      },
    })),
  },
};
