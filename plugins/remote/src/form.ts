import { z } from "zod";
import type { ModelSpec } from "../../../packages/plugin-sdk/src/index.js";
import {
  choices,
  displayRatios,
  validValue,
  type Condition,
  type FormField,
  type ModelForm,
} from "../../../packages/plugin-sdk/src/model-form.js";

const scalar = z.union([z.string(), z.number(), z.boolean()]);
const name = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/)
  .refine((k) => !Object.hasOwn(Object.prototype, k));
const field = z.strictObject({
  type: z.enum(["string", "integer", "number", "boolean"]),
  title: z.string().min(1).max(100).optional(),
  enum: z.array(scalar).min(1).max(200).optional(),
  default: scalar.optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().nonnegative().optional(),
});
const clause = z.strictObject({
  type: z.literal("object"),
  required: z.array(name).optional(),
  properties: z
    .record(
      name,
      z.union([
        z.strictObject({ const: scalar }),
        z.strictObject({ enum: z.array(scalar).min(1) }),
      ]),
    )
    .optional(),
});
const schema = z.strictObject({
  type: z.literal("object"),
  additionalProperties: z.literal(false),
  properties: z.record(name, field),
  required: z.array(name).optional(),
  anyOf: z.array(clause).min(1).max(200).optional(),
  "x-references": z
    .strictObject({
      min: z.number().int().min(0).max(9).optional(),
      max: z.number().int().min(0).max(9).optional(),
      types: z.tuple([z.literal("image")]).optional(),
    })
    .optional(),
});
function condition(
  value: unknown,
  fields: Record<string, FormField>,
): Condition {
  const c = clause.parse(value),
    entries = Object.entries(c.properties ?? {});
  if (
    entries.length !== new Set(c.required).size ||
    entries.some(([key]) => !c.required?.includes(key))
  )
    throw Error("条件必须包含所有匹配字段");
  return Object.fromEntries(
    entries.map(([key, test]) => {
      const options = "const" in test ? [test.const] : test.enum;
      if (
        !Object.hasOwn(fields, key) ||
        options.some((v) => !validValue(fields[key], v))
      )
        throw Error("无效的参数匹配条件");
      return [key, options];
    }),
  );
}
export function remoteForm(model: ModelSpec, dynamic: boolean): ModelForm {
  const video = model.kind === "video",
    audio = model.kind === "audio";
  const limits = model.inputSchema["x-references"] as
    { min?: number; max?: number } | undefined;
  const references = {
    min: limits?.min ?? 0,
    max: audio ? 0 : (limits?.max ?? 9),
  };
  const prices = model.studio!.prices;
  if (!dynamic) {
    const fields: Record<string, FormField> = audio
      ? {
          instruction: { type: "string", maxLength: 300 },
          seed: { type: "integer" },
        }
      : { ratio: choices(displayRatios, "16:9") };
    if (video)
      Object.assign(fields, {
        quality: choices([480, 768]),
        seconds: choices([5, 10, 15]),
        seed: { type: "integer" },
      });
    if (model.kind === "image")
      Object.assign(fields, {
        resolution: choices(["1K", "2K"]),
        image_quality: choices(["low", "medium", "high"], "medium"),
      });
    const spec = model.inputSchema.properties as
      Record<string, FormField> | undefined;
    for (const [key, f] of Object.entries(fields)) {
      if (f.enum && spec?.[key]?.enum) {
        const values = f.enum.filter((v) => spec[key].enum!.includes(v));
        if (values.length) {
          f.enum = values;
          if (!values.includes(f.default!)) f.default = values[0];
        }
      }
    }
    return {
      fields,
      references,
      tiers: prices.map(({ tier, match }) => ({
        tier,
        when: Object.fromEntries(
          Object.entries(match.properties ?? {}).map(([k, v]) => [
            k,
            [(v as { const: string | number }).const],
          ]),
        ),
      })),
    };
  }
  const parsed = schema.parse(model.inputSchema);
  const fields = parsed.properties;
  if (
    Object.keys(fields).length > 40 ||
    parsed.required?.some((k) => !Object.hasOwn(fields, k)) ||
    references.min > references.max
  )
    throw Error("无效的表单字段");
  for (const f of Object.values(fields)) {
    if (
      (f.enum ?? []).some((v) => !validValue(f, v)) ||
      (f.default !== undefined && !validValue(f, f.default)) ||
      (f.minimum ?? -Infinity) > (f.maximum ?? Infinity) ||
      (f.minLength ?? 0) > (f.maxLength ?? Infinity)
    )
      throw Error("无效的字段选项或默认值");
  }
  const combinations = parsed.anyOf?.map((c) => condition(c, fields));
  if (combinations?.some((c) => Object.keys(c).some((k) => !fields[k].enum)))
    throw Error("联动条件需要枚举字段");
  return {
    parameterObject: true,
    fields,
    required: parsed.required,
    references,
    combinations,
    tiers: prices.map(({ tier, match }) => ({
      tier,
      when: condition(match, fields),
    })),
  };
}
