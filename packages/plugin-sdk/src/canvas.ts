import { z } from "zod";

/** Save-time rules only. Submission, pricing and availability remain separate contracts. */
export const canvasModelSchema = z.object({
  model: z.string().min(1).max(180),
  kind: z.enum(["image", "video"]),
  defaultForKind: z.boolean().optional(),
  templatePriority: z.number().int().nonnegative().optional(),
  ratios: z
    .object({
      values: z.array(z.string().min(1)).min(1),
      error: z.string().min(1),
    })
    .optional(),
  durations: z
    .object({
      values: z.array(z.number().int().nonnegative()).min(1),
      error: z.string().min(1),
    })
    .optional(),
});
export const canvasPolicySchema = z.object({
  version: z.literal(1),
  models: z.array(canvasModelSchema).min(1).max(500),
});
export type CanvasPolicy = z.infer<typeof canvasPolicySchema>;
export type CanvasModelRule = z.infer<typeof canvasModelSchema>;

/** Canvas-to-submission bindings. Pure data, independent of save-time validation. */
export const canvasSubmissionPolicySchema = z
  .object({
    version: z.literal(1),
    models: z
      .array(
        z
          .object({
            model: z.string().min(1).max(180),
            kind: z.enum(["image", "video", "audio"]),
            defaultForKind: z.boolean().optional(),
            nativeH3: z.literal(true).optional(),
            fixedSamplingSteps: z.number().int().positive().optional(),
            showModelLabel: z.literal(true).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();
export type CanvasSubmissionPolicy = z.infer<
  typeof canvasSubmissionPolicySchema
>;
export type CanvasSubmissionRule = CanvasSubmissionPolicy["models"][number];
