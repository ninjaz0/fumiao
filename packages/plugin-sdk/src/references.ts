import { z } from "zod";
export const referenceImportSchema = z
  .object({
    version: z.literal(1),
    id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    kinds: z
      .array(z.enum(["video", "audio"]))
      .min(1)
      .max(2),
    maxBytes: z
      .number()
      .int()
      .positive()
      .max(1 << 30),
  })
  .strict();
export type ReferenceImport = z.infer<typeof referenceImportSchema>;
export type ReferenceKind = "video" | "audio";
export const referenceResultSchema = z
  .object({
    seconds: z.number().finite().nonnegative(),
    fps: z.number().finite().nonnegative(),
    has_audio: z.boolean(),
    w: z.number().int().nonnegative(),
    h: z.number().int().nonnegative(),
    mime: z.enum(["video/mp4", "audio/wav"]),
    size: z
      .number()
      .int()
      .positive()
      .max(64 << 20),
  })
  .strict();
export type ReferenceResult = z.infer<typeof referenceResultSchema>;
export class ReferenceImportError extends Error {}
export class ReferenceImportBusyError extends Error {}
