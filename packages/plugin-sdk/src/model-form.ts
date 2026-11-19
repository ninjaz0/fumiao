// Public, serializable controls for one version of a Studio model.
export type Value = string | number | boolean;
export type FormValues = Record<string, Value>;
export interface FormField {
  type: "string" | "integer" | "number" | "boolean";
  title?: string;
  enum?: Value[];
  default?: Value;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
}
export type Condition = Record<string, Value[]>;
export interface ModelForm {
  fields: Record<string, FormField>;
  required?: string[];
  combinations?: Condition[];
  tiers: { tier: string; when: Condition }[];
  references: {
    min: number;
    max: number;
    counts?: { image: number; video: number; audio: number };
    minSeconds?: number;
    maxSeconds?: number;
  };
  referenceModes?: ("reference" | "frames")[];
  nativeResolution?: boolean;
  fastSteps?: number;
  parameterObject?: boolean;
  canvas?: boolean;
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
  return Object.fromEntries(
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
}

export function formError(form: ModelForm, values: FormValues): string {
  for (const [name, field] of Object.entries(form.fields)) {
    const label = field.title ?? name;
    if (!Object.hasOwn(values, name)) {
      if (form.required?.includes(name)) return "请填写" + label;
    } else if (!validValue(field, values[name])) return label + "的值无效";
  }
  return form.combinations &&
    !form.combinations.some((rule) => matches(rule, values))
    ? "模型不支持这组参数"
    : "";
}
