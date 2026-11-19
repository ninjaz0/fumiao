import { z } from "zod";
/** Legacy image-settings transport is separate from provider credentials. */
export const originalImageSettingsSchema = z
  .object({
    version: z.literal(1),
    namespace: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    defaultModel: z.string().min(1).max(180),
    controlledModels: z.array(z.string().min(1).max(180)).min(1).max(100),
  })
  .strict();
export type OriginalImageSettingsPolicy = z.infer<
  typeof originalImageSettingsSchema
>;
export class OriginalProviderCheckError extends Error {
  constructor(
    message: string,
    readonly status: 500 | 502 = 502,
  ) {
    super(message);
  }
}
