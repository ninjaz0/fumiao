// Public, serializable controls for one version of a Studio model.
export type Value = string | number | boolean;
export type FormValues = Record<string, Value>;
export type Condition = Record<string, Value[]>;
export interface DisableRule {
  when: Condition;
  values?: Value[];
  reason: string;
}
export interface ReferenceLimitRule {
  when: Condition;
  min?: number;
  max?: number;
  counts?: { image?: number; video?: number; audio?: number };
  minSeconds?: number;
  maxSeconds?: number;
  reason?: string;
}
export interface FormField {
  type: "string" | "integer" | "number" | "boolean";
  title?: string;
  enum?: Value[];
  default?: Value;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  visibleWhen?: Condition;
  disableWhen?: DisableRule[];
  optionLabels?: Record<string, string>;
  uiHint?: "slider" | "textarea" | "ratio" | "seed";
}
export interface ModelForm {
  fields: Record<string, FormField>;
  required?: string[];
  combinations?: Condition[];
  mutuallyExclusive?: { field: string; alternatives: string[]; hint: string };
  tiers: { tier: string; when: Condition }[];
  references: {
    min: number;
    max: number;
    counts?: { image: number; video: number; audio: number };
    minSeconds?: number;
    maxSeconds?: number;
    conditionalLimits?: ReferenceLimitRule[];
  };
  referenceModes?: ("reference" | "frames")[];
  nativeResolution?: boolean;
  fastSteps?: number;
  parameterObject?: boolean;
  canvas?: boolean;
}
export interface FieldConstraintState {
  visible: boolean;
  disabled: boolean;
  disabledReason?: string;
  disabledOptions: Record<string, string>;
  incompatibleOptions: Record<string, string>;
}
export interface EvaluatedReferences {
  min: number;
  max: number;
  counts?: { image: number; video: number; audio: number };
  minSeconds?: number;
  maxSeconds?: number;
  reason?: string;
}
export interface FormConstraintEvaluation {
  fields: Record<string, FieldConstraintState>;
  references: EvaluatedReferences;
}

export const displayRatios = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
export function choices(
  values: string[] | number[],
  initial = values[0],
): FormField {
  return {
    type: typeof initial === "string" ? "string" : "integer",
    enum: values,
    default: initial,
  };
}
export function matches(condition: Condition, values: FormValues) {
  return Object.entries(condition).every(([name, allowed]) =>
    allowed.includes(values[name]),
  );
}
export function validValue(field: FormField, value: unknown): value is Value {
  if (field.enum && !field.enum.includes(value as Value)) return false;
  if (field.type === "string")
    return (
      typeof value === "string" &&
      [...value].length >= (field.minLength ?? 0) &&
      [...value].length <= (field.maxLength ?? Infinity)
    );
  if (field.type === "boolean") return typeof value === "boolean";
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    (field.type !== "integer" || Number.isSafeInteger(value)) &&
    value >= (field.minimum ?? -Infinity) &&
    value <= (field.maximum ?? Infinity)
  );
}

export function evaluateFormConstraints(
  form: ModelForm,
  values: FormValues,
): FormConstraintEvaluation {
  const fields: Record<string, FieldConstraintState> = {};
  for (const [name, field] of Object.entries(form.fields)) {
    const visible = !field.visibleWhen || matches(field.visibleWhen, values);
    let disabled = false;
    let disabledReason: string | undefined;
    const disabledOptions: Record<string, string> = {};
    const incompatibleOptions: Record<string, string> = {};

    for (const rule of field.disableWhen ?? []) {
      if (!matches(rule.when, values)) continue;
      if (!rule.values || rule.values.length === 0) {
        disabled = true;
        disabledReason ??= rule.reason;
      } else {
        for (const v of rule.values) {
          const key = JSON.stringify(v);
          disabledOptions[key] ??= rule.reason;
        }
      }
    }

    const exclusive = form.mutuallyExclusive;
    if (exclusive) {
      const peers =
        name === exclusive.field
          ? exclusive.alternatives
          : exclusive.alternatives.includes(name)
            ? [exclusive.field]
            : [];
      if (peers.some((peer) => values[peer] !== undefined)) {
        disabledReason = exclusive.hint;
        // A restored conflict must still let the creator clear either side.
        if (values[name] === undefined) disabled = true;
        for (const option of field.enum ?? [])
          disabledOptions[JSON.stringify(option)] = exclusive.hint;
      }
    }

    if (field.enum && form.combinations?.length) {
      for (const option of field.enum) {
        const key = JSON.stringify(option);
        const everSupported = form.combinations.some(
          (c) => !c[name] || c[name].includes(option),
        );
        if (!everSupported) {
          disabledOptions[key] ??= "当前模型不支持此选项";
          continue;
        }
        const compatibleWithPeers = form.combinations.some((c) => {
          if (c[name] && !c[name].includes(option)) return false;
          return Object.entries(c).every(([peer, allowed]) => {
            if (peer === name) return true;
            const current = values[peer];
            return current === undefined || allowed.includes(current);
          });
        });
        if (!compatibleWithPeers) {
          incompatibleOptions[key] = "切换该项将自动调整关联参数";
        }
      }
    }

    fields[name] = {
      visible,
      disabled,
      ...(disabledReason ? { disabledReason } : {}),
      disabledOptions,
      incompatibleOptions,
    };
  }

  let references: EvaluatedReferences = {
    min: form.references.min,
    max: form.references.max,
    ...(form.references.counts ? { counts: { ...form.references.counts } } : {}),
    ...(form.references.minSeconds !== undefined
      ? { minSeconds: form.references.minSeconds }
      : {}),
    ...(form.references.maxSeconds !== undefined
      ? { maxSeconds: form.references.maxSeconds }
      : {}),
  };
  for (const rule of form.references.conditionalLimits ?? []) {
    if (!matches(rule.when, values)) continue;
    references = {
      ...references,
      ...(rule.min !== undefined ? { min: rule.min } : {}),
      ...(rule.max !== undefined ? { max: rule.max } : {}),
      ...(rule.counts
        ? {
            counts: {
              image: rule.counts.image ?? references.counts?.image ?? 0,
              video: rule.counts.video ?? references.counts?.video ?? 0,
              audio: rule.counts.audio ?? references.counts?.audio ?? 0,
            },
          }
        : {}),
      ...(rule.minSeconds !== undefined ? { minSeconds: rule.minSeconds } : {}),
      ...(rule.maxSeconds !== undefined ? { maxSeconds: rule.maxSeconds } : {}),
      ...(rule.reason ? { reason: rule.reason } : {}),
    };
  }

  return { fields, references };
}

// Select the legal combination retaining the most values. An explicitly edited
// field takes precedence over the rest of the draft.
export function normalizeForm(
  form: ModelForm,
  values: FormValues,
  edited?: string,
): FormValues {
  const candidates = (form.combinations ?? [{}]).filter(
    (rule) => !edited || !rule[edited] || rule[edited].includes(values[edited]),
  );
  const preferred = {
    ...Object.fromEntries(
      Object.entries(form.fields).map(([name, field]) => [name, field.default]),
    ),
    ...values,
  };
  const score = (rule: Condition) =>
    Object.entries(rule).filter(
      ([k, allowed]) => !allowed.includes(preferred[k]!),
    ).length;
  const rule = candidates.sort((a, b) => score(a) - score(b))[0] ?? {};
  const draft: FormValues = Object.fromEntries(
    Object.entries(form.fields).flatMap(([key, field]) => {
      const allowed = rule[key] ?? field.enum;
      const old = values[key];
      if (validValue(field, old) && (!allowed || allowed.includes(old)))
        return [[key, old]];
      const initial = field.default;
      let value: Value | undefined;
      if (initial !== undefined && (!allowed || allowed.includes(initial)))
        value = initial;
      else if (rule[key] || form.required?.includes(key))
        value = allowed?.[0] ?? (field.type === "boolean" ? false : undefined);
      return value === undefined ? [] : [[key, value]];
    }),
  );

  // Enforce conditional visibility and option-level disableWhen rules cleanly.
  const evaluated = evaluateFormConstraints(form, draft);
  for (const [key, field] of Object.entries(form.fields)) {
    const state = evaluated.fields[key];
    if (!state.visible) {
      delete draft[key];
      continue;
    }
    const cur = draft[key];
    if (cur !== undefined && state.disabledOptions[JSON.stringify(cur)]) {
      const allowed = (rule[key] ?? field.enum ?? []).filter(
        (v) => !state.disabledOptions[JSON.stringify(v)],
      );
      if (allowed.length) draft[key] = allowed[0];
      else delete draft[key];
    }
  }
  return draft;
}

export function formError(form: ModelForm, values: FormValues): string {
  const evaluated = evaluateFormConstraints(form, values);
  for (const [name, field] of Object.entries(form.fields)) {
    const state = evaluated.fields[name];
    if (!state.visible) continue;
    const label = field.title ?? name;
    if (!Object.hasOwn(values, name)) {
      if (form.required?.includes(name) && !state.disabled)
        return "请填写" + label;
    } else if (!validValue(field, values[name])) {
      return label + "的值无效";
    } else {
      const optReason = state.disabledOptions[JSON.stringify(values[name])];
      if (optReason) return `${label}：${optReason}`;
    }
  }
  return form.combinations &&
    !form.combinations.some((rule) => matches(rule, values))
    ? "模型不支持这组参数"
    : "";
}
