import { z } from "zod";

const id = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
const title = z.string().trim().min(1).max(60);
const port = z
  .object({
    id,
    title,
    kind: z.enum(["text", "image", "video", "audio"]),
  })
  .strict();
const field = z.discriminatedUnion("type", [
  z
    .object({
      id,
      title,
      type: z.literal("text"),
      default: z.string().max(2000),
    })
    .strict(),
  z
    .object({ id, title, type: z.literal("number"), default: z.number() })
    .strict(),
  z
    .object({ id, title, type: z.literal("checkbox"), default: z.boolean() })
    .strict(),
  z
    .object({
      id,
      title,
      type: z.literal("select"),
      options: z.array(title).min(1).max(32),
      default: title,
    })
    .strict()
    .refine(
      (f) =>
        new Set(f.options).size === f.options.length &&
        f.options.includes(f.default),
    ),
]);
const unique = (items: { id: string }[]) =>
  new Set(items.map((item) => item.id)).size === items.length;
const definition = z
  .object({
    id,
    title,
    inputs: z.array(port).max(8).refine(unique),
    outputs: z.array(port).min(1).max(8).refine(unique),
    fields: z.array(field).max(16).refine(unique),
  })
  .strict();
export const canvasNodeSchema = definition.extend({
  program: z.string().min(1).max(65536),
});
const entry = definition.extend({
  plugin: z.string().min(1).max(100),
  version: z.string().min(1).max(32),
});
export type CanvasNodeEntry = z.infer<typeof entry>;
export type CanvasPort = z.infer<typeof port>;
export const canvasResultSchema = z
  .record(id, z.string().max(12000))
  .refine((r) => Object.keys(r).length <= 8);
export const canvasExtensionSchema = z
  .object({
    definition: entry,
    values: z.record(
      id,
      z.union([z.string().max(2000), z.number(), z.boolean()]),
    ),
    result: canvasResultSchema.optional(),
  })
  .strict()
  .refine(
    ({ definition: d, values }) =>
      Object.keys(values).length === d.fields.length &&
      d.fields.every(
        (f) =>
          Object.hasOwn(values, f.id) &&
          typeof values[f.id] === typeof f.default &&
          (f.type !== "select" || f.options.includes(String(values[f.id]))),
      ),
  );
export type CanvasExtension = z.infer<typeof canvasExtensionSchema>;
export function validCanvasResult(
  ports: CanvasPort[],
  result: Record<string, string>,
) {
  return (
    ports.length === Object.keys(result).length &&
    ports.every(
      (p) =>
        Object.hasOwn(result, p.id) &&
        (p.kind === "text" || /^[a-f0-9]{32}$/.test(result[p.id])),
    )
  );
}
