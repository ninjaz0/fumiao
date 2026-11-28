/** Original FastAPI request shapes. Failures keep its status and detail envelope. */
import { creditUnits, formatCredits } from "@fumiao/platform/credit-amount.js";
import { DomainError } from "@fumiao/platform/security.js";
type Issue = {
  type: string;
  loc: (string | number)[];
  msg: string;
  input?: unknown;
  ctx?: Record<string, unknown>;
};
export class ValidationError extends DomainError {
  constructor(readonly detail: Issue[]) {
    super(422, "输入参数无效");
  }
}
export type Field = {
  kind:
    | "string"
    | "credits"
    | "integer"
    | "float"
    | "boolean"
    | "integers"
    | "strings"
    | "uuid"
    | "literal"
    | "prices"
    | "dictionary"
    | "object"
    | "list";
  values?: (string | number)[];
  fields?: Fields;
  item?: Field;
  extra?: boolean;
  pattern?: string;
  accepted?: string[];
  valueError?: string;
  gt?: number;
  min?: number;
  max?: number;
  default?: unknown;
  nullable?: boolean;
  optional?: boolean;
  strict?: boolean;
  finite?: boolean;
  pythonLiteral?: boolean;
  strictPattern?: boolean;
  allowLargeInteger?: boolean;
  exactInteger?: boolean;
};
export type Fields = Record<string, Field>;
export function parseBody(
  input: unknown,
  fields: Record<string, Field>,
  extra = false,
): Record<string, any> {
  if (input === undefined)
    throw new ValidationError([
      { type: "missing", loc: ["body"], msg: "Field required", input: null },
    ]);
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ValidationError([
      {
        type: "model_attributes_type",
        loc: ["body"],
        msg: "Input should be a valid dictionary or object to extract fields from",
        input,
      },
    ]);
  const body = input as Record<string, unknown>,
    out: Record<string, any> = {},
    issues: Issue[] = [];
  const issue = (
    key: string,
    type: string,
    msg: string,
    value: unknown,
    ctx?: Issue["ctx"],
    index?: number,
  ) =>
    issues.push({
      type,
      loc: ["body", key, ...(index === undefined ? [] : [index])],
      msg,
      input: value,
      ...(ctx ? { ctx } : {}),
    });
  for (const [key, field] of Object.entries(fields)) {
    let value = body[key];
    if (!Object.hasOwn(body, key)) {
      if ("default" in field) {
        out[key] = structuredClone(field.default);
        continue;
      }
      if (field.optional) continue;
      issue(key, "missing", "Field required", body);
      continue;
    }
    if (value === null && field.nullable) {
      out[key] = null;
      continue;
    }
    if (field.kind === "dictionary") {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        issue(key, "dict_type", "Input should be a valid dictionary", value);
        continue;
      }
      if (!field.item) {
        out[key] = value;
        continue;
      }
      const values: [string, unknown][] = [];
      for (const [name, member] of Object.entries(value)) {
        try {
          values.push([name, parseBody({ item: member }, { item: field.item }).item]);
        } catch (error) {
          if (!(error instanceof ValidationError)) throw error;
          issues.push(...error.detail.map((i) => ({
            ...i, loc: ["body", key, name, ...i.loc.slice(2)],
          })));
        }
      }
      out[key] = Object.fromEntries(values);
    } else if (field.kind === "object") {
      try {
        out[key] = parseBody(value, field.fields!, field.extra);
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
        issues.push(
          ...error.detail.map((i) => ({
            ...i,
            loc: ["body", key, ...i.loc.slice(1)],
          })),
        );
      }
    } else if (field.kind === "list") {
      if (!Array.isArray(value)) {
        issue(key, "list_type", "Input should be a valid list", value);
        continue;
      }
      if (field.min !== undefined && value.length < field.min) {
        issue(
          key,
          "too_short",
          `List should have at least ${field.min} item${field.min === 1 ? "" : "s"} after validation, not ${value.length}`,
          value,
          { field_type: "List", min_length: field.min, actual_length: value.length },
        );
        continue;
      }
      if (field.max !== undefined && value.length > field.max) {
        issue(
          key,
          "too_long",
          `List should have at most ${field.max} items after validation, not ${value.length}`,
          value,
          {
            field_type: "List",
            max_length: field.max,
            actual_length: value.length,
          },
        );
        continue;
      }
      out[key] = [];
      for (let i = 0; i < value.length; i++) {
        try {
          out[key].push(
            parseBody({ item: value[i] }, { item: field.item! }).item,
          );
        } catch (error) {
          if (!(error instanceof ValidationError)) throw error;
          issues.push(
            ...error.detail.map((e) => ({
              ...e,
              loc: ["body", key, i, ...e.loc.slice(2)],
            })),
          );
        }
      }
    } else if (
      field.kind === "credits" &&
      ((typeof value === "string" && value.includes(".")) ||
        (typeof value === "number" &&
          Number.isFinite(value) &&
          !Number.isInteger(value)))
    ) {
      const text = typeof value === "number" ? String(value) : value;
      if (/[eE]/.test(text)) {
        issue(key, "value_error", "积分必须为至多十二位小数的十进制数", value);
      } else {
        try {
          const units = creditUnits(text);
          if (
            (field.min !== undefined && units < creditUnits(String(field.min))) ||
            (field.max !== undefined && units > creditUnits(String(field.max)))
          ) {
            issue(key, "value_error", "积分金额超出允许范围", value);
          } else out[key] = formatCredits(units);
        } catch {
          issue(key, "value_error", "积分必须为至多十二位小数的十进制数", value);
        }
      }
    } else if (field.kind === "literal") {
      const choices = field.values!;
      const render = (v: string | number) =>
        typeof v === "string" ? `'${v}'` : String(v);
      const expected =
        choices.length === 1
          ? render(choices[0])
          : choices.slice(0, -1).map(render).join(", ") +
            ` or ${render(choices.at(-1)!)}`;
      if (
        field.pythonLiteral &&
        typeof value === "boolean" &&
        choices.includes(Number(value))
      )
        value = Number(value);
      if (!choices.includes(value as string))
        issue(key, "literal_error", "Input should be " + expected, value, {
          expected,
        });
      else out[key] = value;
    } else if (field.kind === "uuid") {
      if (typeof value !== "string") {
        issue(
          key,
          "uuid_type",
          "UUID input should be a string, bytes or UUID object",
          value,
        );
        continue;
      }
      const parsed = originalUuid(value);
      if (parsed.value) out[key] = parsed.value;
      else {
        const error = parsed.error!;
        issue(
          key,
          "uuid_parsing",
          "Input should be a valid UUID, " + error,
          value,
          { error },
        );
      }
    } else if (field.kind === "string") {
      if (typeof value !== "string") {
        issue(key, "string_type", "Input should be a valid string", value);
        continue;
      }
      // Pydantic's constrained strings require Unicode scalar values, even
      // though JSON itself can carry escaped lone UTF-16 surrogates.
      if (
        (field.min !== undefined || field.max !== undefined || field.pattern) &&
        /[\uD800-\uDFFF]/u.test(value)
      ) {
        issue(
          key,
          "string_unicode",
          "Input should be a valid string, unable to parse raw data as a unicode string",
          value,
        );
        continue;
      }
      const length = [...value].length;
      if (field.min !== undefined && length < field.min)
        issue(
          key,
          "string_too_short",
          `String should have at least ${field.min} character${field.min === 1 ? "" : "s"}`,
          value,
          { min_length: field.min },
        );
      else if (field.max !== undefined && length > field.max)
        issue(
          key,
          "string_too_long",
          `String should have at most ${field.max} character${field.max === 1 ? "" : "s"}`,
          value,
          { max_length: field.max },
        );
      else if (
        field.pattern &&
        !new RegExp(
          field.strictPattern
            ? field.pattern.replace(/\$$/, "$(?![\\s\\S])")
            : field.pattern,
        ).test(value)
      )
        issue(
          key,
          "string_pattern_mismatch",
          `String should match pattern '${field.pattern}'`,
          value,
          { pattern: field.pattern },
        );
      else if (field.accepted && !field.accepted.includes(value))
        issue(key, "value_error", "Value error, " + field.valueError, value, {
          error: {},
        });
      else out[key] = value;
    } else if (field.kind === "prices") {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        issue(key, "dict_type", "Input should be a valid dictionary", value);
        continue;
      }
      const values: Record<string, number | null> = Object.create(null);
      for (const [name, v] of Object.entries(value)) {
        if (v === null || (typeof v === "number" && Number.isSafeInteger(v)))
          values[name] = v;
        else
          issues.push({
            type: "int_type",
            loc: ["body", key, name],
            msg: "Input should be a valid integer",
            input: v,
          });
      }
      out[key] = values;
    } else if (field.kind === "boolean") {
      if (field.strict === false && typeof value !== "boolean") {
        const v = typeof value === "string" ? value.toLowerCase() : value;
        if ([1, "1", "on", "t", "true", "y", "yes"].includes(v as any))
          value = true;
        else if ([0, "0", "off", "f", "false", "n", "no"].includes(v as any))
          value = false;
      }
      if (
        field.strict === false &&
        typeof value !== "boolean" &&
        (typeof value === "string" || typeof value === "number")
      )
        issue(
          key,
          "bool_parsing",
          "Input should be a valid boolean, unable to interpret input",
          body[key],
        );
      else if (typeof value !== "boolean")
        issue(key, "bool_type", "Input should be a valid boolean", value);
      else out[key] = value;
    } else if (field.kind === "integers" || field.kind === "strings") {
      if (!Array.isArray(value)) {
        issue(key, "list_type", "Input should be a valid list", value);
        continue;
      }
      if (field.max !== undefined && value.length > field.max) {
        issue(
          key,
          "too_long",
          `List should have at most ${field.max} items after validation, not ${value.length}`,
          value,
          {
            field_type: "List",
            max_length: field.max,
            actual_length: value.length,
          },
        );
        continue;
      }
      if (field.min !== undefined && value.length < field.min) {
        issue(
          key,
          "too_short",
          `List should have at least ${field.min} item${field.min === 1 ? "" : "s"} after validation, not ${value.length}`,
          value,
          {
            field_type: "List",
            min_length: field.min,
            actual_length: value.length,
          },
        );
        continue;
      }
      out[key] = value.map((v, i) => {
        if (field.kind === "strings") {
          if (typeof v !== "string")
            issue(
              key,
              "string_type",
              "Input should be a valid string",
              v,
              undefined,
              i,
            );
          return v;
        }
        const n = integer(v, false);
        if (n === null) issue(key, ...integerIssue(v, false), v, undefined, i);
        return n;
      });
    } else {
      if (field.kind === "float") {
        const n = floating(value);
        if (n === null)
          issue(
            key,
            typeof value === "string" ? "float_parsing" : "float_type",
            typeof value === "string"
              ? "Input should be a valid number, unable to parse string as a number"
              : "Input should be a valid number",
            value,
          );
        else if (!Number.isFinite(n))
          issue(key, "finite_number", "Input should be a finite number", value);
        else if (field.min !== undefined && n < field.min)
          issue(
            key,
            "greater_than_equal",
            `Input should be greater than or equal to ${field.min}`,
            value,
            { ge: field.min },
          );
        else if (field.max !== undefined && n > field.max)
          issue(
            key,
            "less_than_equal",
            `Input should be less than or equal to ${field.max}`,
            value,
            { le: field.max },
          );
        else out[key] = n;
        continue;
      }
      if (
        field.finite &&
        typeof value === "number" &&
        !Number.isFinite(value)
      ) {
        issue(key, "finite_number", "Input should be a finite number", value);
        continue;
      }
      if (
        field.exactInteger &&
        typeof value === "number" &&
        Number.isInteger(value) &&
        (value >= 2 ** 63 || value < -(2 ** 63))
      ) {
        issue(
          key,
          "int_parsing_size",
          "Unable to parse input string as an integer, exceeded maximum size",
          value,
        );
        continue;
      }
      const n = field.exactInteger
        ? field.strict && typeof value !== "number" && typeof value !== "bigint"
          ? null
          : exactInteger(value)
        : integer(value, !!field.strict, field.allowLargeInteger);
      if (n === null) issue(key, ...integerIssue(value, !!field.strict), value);
      else if (field.gt !== undefined && n <= field.gt)
        issue(
          key,
          "greater_than",
          `Input should be greater than ${field.gt}`,
          value,
          { gt: field.gt },
        );
      else if (field.min !== undefined && n < field.min)
        issue(
          key,
          "greater_than_equal",
          `Input should be greater than or equal to ${field.min}`,
          value,
          { ge: field.min },
        );
      else if (field.max !== undefined && n > field.max)
        issue(
          key,
          "less_than_equal",
          `Input should be less than or equal to ${field.max}`,
          value,
          { le: field.max },
        );
      else out[key] = n;
    }
  }
  if (extra)
    for (const key of Object.keys(body))
      if (!Object.hasOwn(fields, key))
        issue(
          key,
          "extra_forbidden",
          "Extra inputs are not permitted",
          body[key],
        );
  if (issues.length) throw new ValidationError(issues);
  return out;
}
function floating(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return Number(value);
  if (typeof value !== "string") return null;
  const text = value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
  if (/^[+-]?(?:inf(?:inity)?|nan)$/i.test(text))
    return /nan/i.test(text)
      ? NaN
      : text.startsWith("-")
        ? -Infinity
        : Infinity;
  if (
    !/^[+-]?(?:(?:\d(?:_?\d)*)(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?$/.test(
      text,
    )
  )
    return null;
  return Number(text.replaceAll("_", ""));
}
function originalUuid(value: string): { value?: string; error?: string } {
  if (Buffer.byteLength(value) > 45)
    return { error: `invalid length: found ${Buffer.byteLength(value)}` };
  const wrapped = value.startsWith("{") && value.endsWith("}"),
    prefixed = value.startsWith("urn:uuid:");
  const raw = prefixed ? value.slice(9) : wrapped ? value.slice(1, -1) : value;
  for (const [index, char] of [...raw].entries())
    if (!/[a-f0-9-]/i.test(char))
      return { error: `invalid character: found \`${char}\` at ${index}` };
  if (wrapped || prefixed || raw.includes("-") || raw.length === 36) {
    const groups = raw.split("-"),
      sizes = [8, 4, 4, 4, 12];
    if (groups.length !== 5)
      return {
        error: `invalid group count: expected 5, found ${groups.length}`,
      };
    for (let index = 0; index < 5; index++)
      if (groups[index].length !== sizes[index])
        return {
          error: `invalid group length in group ${index}: expected ${sizes[index]}, found ${groups[index].length}`,
        };
  } else if (raw.length !== 32)
    return { error: `invalid length: found ${Buffer.byteLength(value)}` };
  const compact = raw.replaceAll("-", "").toLowerCase();
  return {
    value: `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`,
  };
}
function integerIssue(value: unknown, strict: boolean): [string, string] {
  if (!strict && typeof value === "number" && !Number.isInteger(value))
    return [
      "int_from_float",
      "Input should be a valid integer, got a number with a fractional part",
    ];
  if (!strict && typeof value === "string")
    return [
      "int_parsing",
      "Input should be a valid integer, unable to parse string as an integer",
    ];
  return ["int_type", "Input should be a valid integer"];
}
const integerText =
  /^[\p{White_Space}]*[+-]?\d(?:_?\d)*(?:\.0+)?[\p{White_Space}]*$/u;

function exactInteger(value: unknown): number | bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "string" && integerText.test(value)) {
    const n = BigInt(
      value
        .replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "")
        .replaceAll("_", "")
        .split(".")[0],
    );
    return Number.isSafeInteger(Number(n)) ? Number(n) : n;
  }
  if (typeof value === "number" && Number.isInteger(value))
    return Number.isSafeInteger(value) ? value : BigInt(value);
  return integer(value, false);
}
function integer(
  value: unknown,
  strict: boolean,
  allowLarge = false,
): number | null {
  if (!strict && typeof value === "string" && integerText.test(value))
    value = Number(
      value
        .replaceAll("_", "")
        .replace(/^\p{White_Space}+|\p{White_Space}+$/gu, ""),
    );
  if (!strict && typeof value === "boolean") value = Number(value);
  return typeof value === "number" &&
    (allowLarge ? Number.isInteger(value) : Number.isSafeInteger(value))
    ? value
    : null;
}
export function pathId(value: string, name: string) {
  const parsed = integer(value, false);
  if (parsed === null)
    throw new ValidationError([
      {
        type: "int_parsing",
        loc: ["path", name],
        msg: "Input should be a valid integer, unable to parse string as an integer",
        input: value,
      },
    ]);
  return parsed;
}
export function queryId(value: string | undefined, name: string) {
  if (value === undefined) return undefined;
  try {
    return pathId(value, name);
  } catch (e) {
    if (e instanceof ValidationError)
      throw new ValidationError(
        e.detail.map((issue) => ({ ...issue, loc: ["query", name] })),
      );
    throw e;
  }
}
export function queryBoolean(value: string | undefined, name: string) {
  if (value === undefined) return false;
  try {
    return parseBody(
      { [name]: value },
      { [name]: { kind: "boolean", strict: false } },
    )[name] as boolean;
  } catch (error) {
    if (error instanceof ValidationError)
      throw new ValidationError(
        error.detail.map((i) => ({ ...i, loc: ["query", name] })),
      );
    throw error;
  }
}
export function queryChoice(
  value: string | undefined,
  name: string,
  choices: string[],
) {
  try {
    return parseBody(value === undefined ? {} : { [name]: value }, {
      [name]: { kind: "literal", values: choices },
    })[name] as string;
  } catch (error) {
    if (error instanceof ValidationError)
      throw new ValidationError(
        error.detail.map((i) => ({
          ...i,
          loc: ["query", name],
          ...(i.type === "missing" ? { input: null } : {}),
        })),
      );
    throw error;
  }
}
export const loginFields: Record<string, Field> = {
  name: { kind: "string", min: 1, max: 40 },
  password: { kind: "string", min: 1, max: 200 },
  code: { kind: "string", max: 128, default: "" },
};
export const teamFields: Record<string, Field> = {
  name: { kind: "string", max: 40 },
  members: { kind: "integers", max: 500, default: [] },
};
export const inviteFields: Record<string, Field> = {
  name: { kind: "string", max: 40 },
  expires: {
    kind: "integer",
    min: 1,
    max: 253402300799,
    strict: true,
    nullable: true,
    default: null,
  },
  grant_credits: { kind: "boolean", default: false },
  initial_credits: {
    kind: "integer",
    min: 0,
    max: 1000000000,
    strict: true,
    default: 0,
  },
  team_id: {
    kind: "integer",
    min: 1,
    strict: true,
    nullable: true,
    default: null,
  },
};
