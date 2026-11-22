import { gpuReferences } from "./references.js";
import { referenceIds, prepareInput } from "./inputs.js";
import { validateArtifact } from "./artifacts.js";
import type { ProviderPlugin } from "@fumiao/plugin-sdk/index.js";
const uuid = {
  type: "string",
  pattern:
    "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$",
};
const h3 = {
  type: ["object", "null"],
  additionalProperties: false,
  required: ["mode"],
  properties: {
    mode: { enum: ["reference", "frames"] },
    first_frame: { ...uuid, type: ["string", "null"], default: null },
    last_frame: { ...uuid, type: ["string", "null"], default: null },
    video_audio: { type: "array", maxItems: 3, items: uuid, default: [] },
  },
};
const h3Inputs = {
  type: "object",
  additionalProperties: false,
  required: [
    "version",
    "mode",
    "first_frame",
    "last_frame",
    "video_audio",
    "files",
  ],
  properties: {
    ...h3.properties,
    version: { const: 1 },
    files: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "kind", "mime", "w", "h", "suffix"],
        properties: {
          id: uuid,
          kind: { enum: ["image", "video", "audio"] },
          mime: { type: "string" },
          w: { type: "integer", minimum: 0 },
          h: { type: "integer", minimum: 0 },
          suffix: { enum: ["png", "mp4", "wav"] },
          seconds: { type: "number", minimum: 0 },
          fps: { type: "number", minimum: 0 },
          has_audio: { type: "boolean" },
          name: { type: "string", maxLength: 120 },
        },
      },
    },
  },
};
export const gpuNative: ProviderPlugin = {
  ...gpuReferences,
  manifest: {
    ...gpuReferences.manifest,
    version: "1.5.0",
    inputPreparation: { version: 1 },
    artifactValidation: { version: 1 },
    queue: {
      ...gpuReferences.manifest.queue!,
      timingVersions: ["1.2.0", "1.3.0", "1.4.0", "1.5.0"],
    },
    models: gpuReferences.manifest.models.map((m) => {
      if (m.id !== "MiniMax H3") return { ...m, preparedSchema: m.inputSchema };
      const properties = m.inputSchema.properties as Record<string, any>,
        base = {
          ...properties,
          ratio: {
            ...properties.ratio,
            enum: [...properties.ratio.enum, "auto"],
          },
        };
      return {
        ...m,
        inputSchema: {
          ...m.inputSchema,
          "x-references": { types: ["image", "video", "audio"], max: 12 },
          properties: { ...base, h3 },
        },
        preparedSchema: {
          type: "object",
          additionalProperties: false,
          required: [
            "ratio",
            "quality",
            "seconds",
            "sampling_steps",
            "seed",
            "width",
            "height",
          ],
          properties: {
            ...properties,
            width: { type: "integer", minimum: 1 },
            height: { type: "integer", minimum: 1 },
            h3_inputs: h3Inputs,
          },
        },
      };
    }),
  },
  referenceIds,
  prepareInput,
  validateArtifact,
};
