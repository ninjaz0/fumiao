import {
  choices,
  type Condition,
  type FormField,
} from "@fumiao/plugin-sdk/model-form.js";
import { muse } from "./index.js";
import type { ProviderPlugin } from "@fumiao/plugin-sdk/index.js";
export const studioRatios = {
  image: ["1:1", "16:9", "9:16", "4:3", "3:4"],
  video: ["16:9", "9:16"],
};
export const studioSeconds = [5, 6, 8, 10];
export const museStudio: ProviderPlugin = {
  ...muse,
  modelForm(model) {
    const video = model.kind === "video";
    const fields: Record<string, FormField> = {
      ratio: choices(video ? studioRatios.video : studioRatios.image, "16:9"),
    };
    if (video) fields.seconds = choices(studioSeconds, 6);
    return {
      fields,
      nativeResolution: true,
      references: { min: 0, max: 9 },
      tiers: model.studio!.prices.map(({ tier }) => ({
        tier,
        when: video ? { seconds: [Number(tier)] } : ({} as Condition),
      })),
    };
  },
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
            ? studioSeconds.map((seconds) => ({
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
