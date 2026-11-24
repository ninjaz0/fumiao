import { z } from "zod";
import type { ModelSpec } from "@fumiao/plugin-sdk/index.js";
import {
  choices,
  displayRatios,
  validValue,
  type Condition,
  type DisableRule,
  type FormField,
  type ModelForm,
  type ReferenceLimitRule,
} from "@fumiao/plugin-sdk/model-form.js";

const scalar = z.union([z.string(), z.number(), z.boolean()]);
const name = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/)
  .refine((k) => !Object.hasOwn(Object.prototype, k));
const conditionMap = z.record(name, z.array(scalar).min(1).max(200));
const disableRuleSchema = z.strictObject({
  when: conditionMap,
  values: z.array(scalar).min(1).max(200).optional(),
  reason: z.string().min(1).max(120),
});
const referenceLimitRuleSchema = z.strictObject({
  when: conditionMap,
  min: z.number().int().min(0).max(12).optional(),
  max: z.number().int().min(0).max(12).optional(),
  counts: z
    .strictObject({
      image: z.number().int().min(0).max(12).optional(),
      video: z.number().int().min(0).max(12).optional(),
      audio: z.number().int().min(0).max(12).optional(),
    })
    .optional(),
  minSeconds: z.number().min(0).max(600).optional(),
  maxSeconds: z.number().min(0).max(600).optional(),
  reason: z.string().min(1).max(120).optional(),
});
const field = z.strictObject({
  type: z.enum(["string", "integer", "number", "boolean"]),
  title: z.string().min(1).max(100).optional(),
  enum: z.array(scalar).min(1).max(200).optional(),
  default: scalar.optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().nonnegative().optional(),
  "x-visibleWhen": conditionMap.optional(),
  "x-disableWhen": z.array(disableRuleSchema).max(32).optional(),
  "x-optionLabels": z.record(z.string().max(120), z.string().min(1).max(80)).optional(),
  "x-uiHint": z.enum(["slider", "textarea", "ratio", "seed"]).optional(),
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
      min: z.number().int().min(0).max(12).optional(),
      max: z.number().int().min(0).max(12).optional(),
      types: z.array(z.enum(["image", "video", "audio"])).min(1).max(3).optional(),
      counts: z
        .strictObject({
          image: z.number().int().min(0).max(12),
          video: z.number().int().min(0).max(12),
          audio: z.number().int().min(0).max(12),
        })
        .optional(),
      minSeconds: z.number().min(0).max(600).optional(),
      maxSeconds: z.number().min(0).max(600).optional(),
      conditionalLimits: z.array(referenceLimitRuleSchema).max(32).optional(),
    })
    .optional(),
});

function validateConditionMap(
  cond: Condition,
  fields: Record<string, FormField>,
) {
  for (const [key, allowed] of Object.entries(cond)) {
    if (
      !Object.hasOwn(fields, key) ||
      allowed.some((v) => !validValue(fields[key], v))
    )
      throw Error("无效的参数匹配条件");
  }
}

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
    | {
        min?: number;
        max?: number;
        counts?: { image: number; video: number; audio: number };
        minSeconds?: number;
        maxSeconds?: number;
        conditionalLimits?: ReferenceLimitRule[];
      }
    | undefined;
  const references: ModelForm["references"] = {
    min: limits?.min ?? 0,
    max: audio ? (limits?.max ?? 0) : (limits?.max ?? 9),
    ...(limits?.counts ? { counts: limits.counts } : {}),
    ...(limits?.minSeconds !== undefined
      ? { minSeconds: limits.minSeconds }
      : {}),
    ...(limits?.maxSeconds !== undefined
      ? { maxSeconds: limits.maxSeconds }
      : {}),
    ...(limits?.conditionalLimits?.length
      ? { conditionalLimits: limits.conditionalLimits }
      : {}),
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
      | Record<string, FormField>
      | undefined;
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
  const fields: Record<string, FormField> = Object.fromEntries(
    Object.entries(parsed.properties).map(([k, raw]) => {
      const f: FormField = {
        type: raw.type,
        ...(raw.title !== undefined ? { title: raw.title } : {}),
        ...(raw.enum !== undefined ? { enum: raw.enum } : {}),
        ...(raw.default !== undefined ? { default: raw.default } : {}),
        ...(raw.minimum !== undefined ? { minimum: raw.minimum } : {}),
        ...(raw.maximum !== undefined ? { maximum: raw.maximum } : {}),
        ...(raw.minLength !== undefined ? { minLength: raw.minLength } : {}),
        ...(raw.maxLength !== undefined ? { maxLength: raw.maxLength } : {}),
        ...(raw["x-visibleWhen"] !== undefined
          ? { visibleWhen: raw["x-visibleWhen"] }
          : {}),
        ...(raw["x-disableWhen"] !== undefined
          ? { disableWhen: raw["x-disableWhen"] as DisableRule[] }
          : {}),
        ...(raw["x-optionLabels"] !== undefined
          ? { optionLabels: raw["x-optionLabels"] }
          : {}),
        ...(raw["x-uiHint"] !== undefined ? { uiHint: raw["x-uiHint"] } : {}),
      };
      return [k, f];
    }),
  );
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
    if (f.visibleWhen) validateConditionMap(f.visibleWhen, fields);
    for (const rule of f.disableWhen ?? []) {
      validateConditionMap(rule.when, fields);
      if (rule.values?.some((v) => !validValue(f, v)))
        throw Error("无效的禁用条件选项");
    }
  }
  for (const rule of references.conditionalLimits ?? []) {
    validateConditionMap(rule.when, fields);
    if (
      (rule.min !== undefined && rule.max !== undefined && rule.min > rule.max) ||
      (rule.minSeconds !== undefined &&
        rule.maxSeconds !== undefined &&
        rule.minSeconds > rule.maxSeconds)
    )
      throw Error("无效的参考约束范围");
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
