import { ChatReplyError } from "./chat.js";
import { z } from "zod";

const key = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]{0,47}$/)
  .refine((k) => !Object.hasOwn(Object.prototype, k) && k !== "prototype");
const description = z.string().trim().min(1).max(500);
const scalar = z
  .object({
    type: z.enum(["string", "number", "integer", "boolean"]),
    description: description.optional(),
    enum: z.array(z.string().max(256)).min(1).max(32).optional(),
  })
  .strict()
  .refine(
    (p) =>
      !p.enum ||
      (p.type === "string" && new Set(p.enum).size === p.enum.length),
  );

export const toolParameters = z
  .object({
    type: z.literal("object"),
    properties: z.record(
      key,
      z.union([
        scalar,
        z
          .object({
            type: z.literal("array"),
            items: scalar,
            description: description.optional(),
          })
          .strict(),
      ]),
    ),
    required: z.array(key).max(24).optional(),
    additionalProperties: z.literal(false),
  })
  .strict()
  .refine(
    (p) =>
      Object.keys(p.properties).length <= 24 &&
      new Set(p.required).size === (p.required?.length ?? 0) &&
      (p.required ?? []).every((k) => Object.hasOwn(p.properties, k)),
  );

export const chatToolSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
    title: z.string().trim().min(1).max(60),
    description,
    audience: z.enum(["member", "admin"]).default("member"),
    parameters: toolParameters,
    program: z
      .string()
      .min(1)
      .max(64 * 1024),
  })
  .strict();
function scalarValue(p: z.infer<typeof scalar>, value: unknown) {
  if (p.type === "integer") return Number.isSafeInteger(value);
  if (p.type === "number")
    return typeof value === "number" && Number.isFinite(value);
  if (p.type === "boolean") return typeof value === "boolean";
  return typeof value === "string" && (!p.enum || p.enum.includes(value));
}
export function toolArguments(
  parameters: z.infer<typeof toolParameters>,
  input: unknown,
): Record<string, unknown> {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    parameters.required?.some((k) => !Object.hasOwn(input, k))
  )
    throw Error("Invalid tool arguments");
  for (const [key, value] of Object.entries(input)) {
    const p =
      Object.hasOwn(parameters.properties, key) && parameters.properties[key];
    if (
      !p ||
      !(p.type === "array"
        ? Array.isArray(value) && value.every((v) => scalarValue(p.items, v))
        : scalarValue(p, value))
    )
      throw Error("Invalid tool argument");
  }
  return input as Record<string, unknown>;
}
export type ChatTool = z.infer<typeof chatToolSchema>;
export type ModelTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: ChatTool["parameters"];
  };
};
export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export const toolFragmentSchema = z
  .object({
    index: z.number().int().min(0).max(7),
    id: z.string().max(128).optional(),
    type: z.literal("function").optional(),
    function: z
      .object({
        name: z.string().max(64).optional(),
        arguments: z.string().max(16384).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ToolFragment = z.infer<typeof toolFragmentSchema>;

export function appendToolFragments(
  calls: Map<number, ToolCall>,
  fragments: ToolFragment[],
) {
  for (const fragment of fragments) {
    const call = calls.get(fragment.index) ?? {
      id: "",
      type: "function",
      function: { name: "", arguments: "" },
    };
    call.id += fragment.id ?? "";
    call.function.name += fragment.function?.name ?? "";
    call.function.arguments += fragment.function?.arguments ?? "";
    if (
      call.id.length > 128 ||
      call.function.name.length > 64 ||
      Buffer.byteLength(call.function.arguments) > 16384
    )
      throw new ChatReplyError("模型返回的工具调用过长");
    calls.set(fragment.index, call);
  }
}
