import { gpu, videoSeconds, videoQualities } from "./index.js";
import { referenceLimits } from "./reference-limits.js";
import {
  choices,
  displayRatios,
  type FormField,
  type ModelForm,
} from "@fumiao/plugin-sdk/model-form.js";
import { readFileSync } from "node:fs";

import type { ProviderPlugin } from "@fumiao/plugin-sdk/index.js";
const runtime = JSON.parse(
  readFileSync(new URL("../models.json", import.meta.url), "utf8"),
);
export const gpuStudio: ProviderPlugin = {
  ...gpu,
  modelForm(model): ModelForm {
    const fields = model.inputSchema.properties as Record<string, FormField>;
    const video = model.kind === "video";
    const native = video && !!fields.h3;
    return {
      fields: video
        ? {
            ratio: choices(displayRatios, "16:9"),
            quality: fields.quality,
            seconds: fields.seconds,
            sampling_steps: fields.sampling_steps,
            seed: fields.seed,
          }
        : { instruction: fields.instruction, seed: fields.seed },
      references: native
        ? referenceLimits
        : {
            min: 0,
            max: Number(
              (model.inputSchema["x-references"] as { max: number }).max,
            ),
          },
      ...(native ? { referenceModes: ["reference", "frames"] } : {}),
      ...(video ? { fastSteps: 4 } : {}),
      tiers: model.studio!.prices.map(({ tier, match }) => ({
        tier,
        when: Object.fromEntries(
          Object.entries(match.properties ?? {}).map(([k, v]) => [
            k,
            [(v as { const: number }).const],
          ]),
        ),
      })),
    };
  },
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
            ? videoQualities.flatMap((quality) =>
                videoSeconds.map((seconds) => ({
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
