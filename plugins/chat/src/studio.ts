import { chat } from "./index.js";
import type { ProviderPlugin } from "@fumiao/plugin-sdk/index.js";
export const chatStudio: ProviderPlugin = {
  ...chat,
  modelForm: (model) => ({
    fields: {},
    references: { min: 0, max: 0 },
    tiers: model.studio!.prices.map(({ tier }) => ({ tier, when: {} })),
  }),
  manifest: {
    ...chat.manifest,
    version: "1.1.0",
    models: chat.manifest.models.map((model) => ({
      ...model,
      studio: {
        order: model.id === "deepseek-flash" ? 5 : 6,
        priceOrder: model.id === "deepseek-flash" ? 50 : 51,
        descriptor: {
          kind: model.kind,
          label: model.id === "deepseek-flash" ? "DeepSeek Flash" : "GPT-4.1",
          provider: model.id === "deepseek-flash" ? "deepseek" : "openai",
        },
        prices: [
          {
            tier: "reply",
            label: "每条完整回复",
            amount: 1,
            match: { type: "object" },
          },
        ],
      },
    })),
  },
};
