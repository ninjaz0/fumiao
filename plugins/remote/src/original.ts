import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  originalParent,
  OriginalSubmissionError,
  type Manifest,
  type OriginalDraft,
  type OriginalSubmission,
} from "../../../packages/plugin-sdk/src/index.js";
import { pythonStrip } from "../../../packages/plugin-sdk/src/python-text.js";
import { validator } from "../../../packages/platform/src/schema.js";

const ratios = z.enum(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]);
const image = z.object({
  ratio: ratios,
  resolution: z.enum(["1K", "2K"]),
  image_quality: z.enum(["low", "medium", "high"]),
});
const video = z.object({
  ratio: ratios,
  quality: z.union([z.literal(480), z.literal(768)]),
  seconds: z.union([z.literal(5), z.literal(10), z.literal(15)]),
  seed: z.number().int().nonnegative().nullable(),
});
const audio = z.object({
  instruction: z.string().max(300),
  seed: z.number().int().min(0).max(4294967295).nullable(),
});
const references = z
  .object({
    min: z.number().int().min(0).max(9).default(0),
    max: z.number().int().min(0).max(9).default(9),
    types: z.tuple([z.literal("image")]).optional(),
  })
  .strict()
  .refine(({ min, max }) => min <= max);

function priceMatch(kind: string, tier: string) {
  if (kind === "audio") return tier === "standard" ? { type: "object" } : null;
  const [level, option, ...extra] = tier.split("|");
  if (extra.length) return null;
  const fields =
    kind === "image"
      ? image.pick({ resolution: true, image_quality: true }).safeParse({
          resolution: level,
          image_quality: option,
        })
      : video.pick({ quality: true, seconds: true }).safeParse({
          quality: Number(level),
          seconds: Number(option),
        });
  if (!fields.success || Object.values(fields.data).join("|") !== tier)
    return null;
  return {
    type: "object",
    required: Object.keys(fields.data),
    properties: Object.fromEntries(
      Object.entries(fields.data).map(([key, value]) => [
        key,
        { const: value },
      ]),
    ),
  };
}

export function validOriginalRemoteModels(manifest: Manifest) {
  return manifest.models.every((model) => {
    const { studio, kind, inputSchema } = model;
    const limits = inputSchema["x-references"];
    return (
      studio &&
      kind !== "chat" &&
      /^[a-z0-9][a-z0-9._-]{0,79}$/.test(model.id) &&
      !model.preparedSchema &&
      Object.keys(studio.descriptor).every((key) =>
        ["kind", "label", "hidden"].includes(key),
      ) &&
      !studio.runtime &&
      (kind === "audio"
        ? limits === undefined
        : references.safeParse(limits ?? {}).success) &&
      studio.prices.every(({ tier, match }) =>
        isDeepStrictEqual(match, priceMatch(kind, tier)),
      )
    );
  });
}

export function originalRemoteSubmission(
  manifest: Manifest,
): OriginalSubmission {
  const models = new Map(manifest.models.map((model) => [model.id, model]));
  const namespace = (d: OriginalDraft) => `-plugin-${manifest.id}-${d.kind}`;
  return {
    namespace,
    validate(d, phase) {
      if (phase !== "prepare") return;
      if (!pythonStrip(d.prompt))
        throw new OriginalSubmissionError("请输入提示词");
      if (
        d.h3 != null ||
        d.flow_source_job != null ||
        (d.kind === "video" && d.sampling_steps !== 20)
      )
        throw new OriginalSubmissionError("这个模型不支持该生成选项");
      const { min, max } =
        d.kind === "audio"
          ? { min: 0, max: 0 }
          : references.parse(
              models.get(d.model)!.inputSchema["x-references"] ?? {},
            );
      if (
        d.refs.length < min ||
        d.refs.length > max ||
        new Set(d.refs).size !== d.refs.length
      )
        throw new OriginalSubmissionError(
          "参考素材数量不符合模型要求或存在重复",
        );
    },
    plan: (d) => ({
      namespace: namespace(d),
      refs: d.refs,
      roles: ["ref"],
      missing: { status: 404, message: "内容不存在或无权访问" },
      parentKind: d.kind,
    }),
    async prepare(d, resources) {
      originalParent(d, resources.parent, d.kind);
      const options = { image, video, audio }[d.kind].safeParse(d);
      if (!options.success) throw new OriginalSubmissionError("模型参数无效");
      const params = options.data;
      if (!validator.validate(models.get(d.model)!.inputSchema, params))
        throw new OriginalSubmissionError("模型参数无效");
      return {
        params,
        references: resources.references.map((ref) => ref.id),
        view: {
          ratio: d.ratio ?? "16:9",
          quality:
            d.kind === "image"
              ? d.resolution === "2K"
                ? 2048
                : 1024
              : (d.quality ?? 0),
          seconds: d.seconds ?? 0,
          sampling_steps: 20,
          seed: d.seed ?? 0,
          width: 0,
          height: 0,
          image_quality: d.image_quality ?? "standard",
          audio_settings:
            d.kind === "audio" ? { instruction: d.instruction } : {},
          h3_inputs: {},
        },
      };
    },
  };
}
