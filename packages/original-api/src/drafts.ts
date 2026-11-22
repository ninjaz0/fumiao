import { parseBody, type Fields, type Field } from "./validation.js";
import type { OriginalDraft } from "@fumiao/plugin-sdk/original.js";

const media: Field = { kind: "string", pattern: "^[a-f0-9]{32}$" };
const packs: Field = {
  kind: "list",
  max: 9,
  default: [],
  item: {
    kind: "object",
    extra: true,
    fields: {
      id: media,
      revision: { kind: "integer", min: 1 },
    },
  },
};
const price: Field = { kind: "integer", nullable: true, default: null, min: 1 };
const parent: Field = { kind: "integer", nullable: true, default: null };
const uid: Field = { kind: "uuid" };
const seed = (max: number): Field => ({
  kind: "integer",
  nullable: true,
  default: null,
  min: 0,
  max,
});
export const h3Field: Field = {
  kind: "object",
  nullable: true,
  default: null,
  extra: true,
  fields: {
    mode: { kind: "literal", values: ["reference", "frames"] },
    first_frame: { ...media, nullable: true, default: null },
    last_frame: { ...media, nullable: true, default: null },
    video_audio: { kind: "list", item: media, max: 3, default: [] },
  },
};
export function parseDraft(
  kind: OriginalDraft["kind"],
  value: unknown,
  models: Record<string, { kind: string }>,
): OriginalDraft {
  const model = (fallback: string, max = 180): Field => ({
    kind: "string",
    default: fallback,
    max,
    ...(kind !== "audio"
      ? {
          accepted: Object.keys(models).filter(
            (id) => models[id].kind === kind,
          ),
          valueError: `未知${kind}模型`,
        }
      : {}),
  });
  const fields: Fields =
    kind === "audio"
      ? {
          uid,
          model: model("breeze-tts-2", 80),
          prompt: { kind: "string", min: 1, max: 300 },
          instruction: { kind: "string", max: 300, default: "" },
          seed: seed(4294967295),
          parent,
          price_revision: price,
        }
      : kind === "image"
        ? {
            asset_packs: packs,
            price_revision: price,
            uid,
            prompt: { kind: "string", min: 1, max: 12000 },
            refs: { kind: "strings", max: 9, default: [] },
            ratio: { kind: "string", default: "16:9" },
            resolution: {
              kind: "literal",
              values: ["1K", "2K", "4K"],
              default: "1K",
            },
            image_quality: {
              kind: "literal",
              values: ["low", "medium", "high"],
              default: "medium",
            },
            model: model("gpt-image-2.6-sunburst"),
            parent,
          }
        : {
            asset_packs: packs,
            price_revision: price,
            model: model("MiniMax H3"),
            flow_source_job: {
              kind: "integer",
              nullable: true,
              default: null,
              gt: 0,
            },
            prompt: { kind: "string", min: 1, max: 12000 },
            refs: { kind: "strings", max: 12, default: [] },
            h3: h3Field,
            ratio: { kind: "string", default: "16:9" },
            quality: { kind: "integer", default: 480 },
            seconds: { kind: "integer", default: 5 },
            sampling_steps: {
              kind: "literal",
              values: [4, 16, 20, 32, 50],
              default: 20,
            },
            seed: seed(9007199254740991),
            parent,
            uid,
          };
  const parsed = parseBody(value, {
    ...fields,
    params: { kind: "dictionary", optional: true },
  });
  return {
    refs: [],
    asset_packs: [],
    ...parsed,
    kind,
    provided: Object.keys(value as object),
  } as unknown as OriginalDraft;
}
