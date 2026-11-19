import { readFileSync } from "node:fs";
import { images } from "./index.js";
import type { ProviderPlugin } from "../../../packages/plugin-sdk/src/index.js";
const sizes: Record<string, number[]> = JSON.parse(
  readFileSync(new URL("../sizes.json", import.meta.url), "utf8"),
);
const dimensions = (resolution: number) =>
  Object.values(sizes).map((v) => v[resolution] + "x" + v[resolution + 1]);
export const imagesStudio: ProviderPlugin = {
  ...images,
  manifest: {
    ...images.manifest,
    version: "1.1.0",
    models: images.manifest.models.map((model) => ({
      ...model,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        "x-references": { types: ["image"], max: 9 },
        properties: {
          size: {
            type: "string",
            enum: [...dimensions(0), ...dimensions(2)],
            default: "1536x864",
          },
          quality: {
            type: "string",
            enum: ["low", "medium", "high"],
            default: "medium",
          },
        },
      },
      studio: {
        order: 2,
        priceOrder: 20,
        descriptor: { kind: model.kind, label: "gpt-image-2.6" },
        runtime: { sizes },
        prices: ["1K", "2K"].flatMap((resolution, index) =>
          [
            ["low", "草稿"],
            ["medium", "标准"],
            ["high", "高清"],
          ].map(([quality, label]) => ({
            tier: resolution + "|" + quality,
            label: resolution + " · " + label,
            amount: null,
            match: {
              type: "object",
              required: ["size", "quality"],
              properties: {
                size: { enum: dimensions(index * 2) },
                quality: { const: quality },
              },
            },
          })),
        ),
      },
    })),
  },
};
