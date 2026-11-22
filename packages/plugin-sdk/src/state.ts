import { z } from "zod";
import type { Kind, StudioModel } from "./index.js";
import type { QueueHealth } from "./queue.js";
export const originalStatePolicySchema = z
  .object({
    version: z.literal(1),
    fields: z
      .array(
        z.enum([
          "ratios",
          "sizes",
          "gpu_models",
          "h3_limits",
          "images",
          "muse",
          "flow",
        ]),
      )
      .max(7),
    queueLane: z.enum(["kind", "plugin"]),
    requiresImageEnabled: z.literal(true).optional(),
    outputKinds: z
      .partialRecord(
        z.enum(["image", "video", "audio", "chat"]),
        z.enum(["ref", "video", "audio"]),
      )
      .optional(),
    recovery: z
      .object({
        maxAttempts: z.number().int().min(1).max(10),
        retryNote: z.string().max(300),
        failureNote: z.string().max(300),
      })
      .strict()
      .optional(),
  })
  .strict();
export type OriginalStatePolicy = z.infer<typeof originalStatePolicySchema>;
export type OriginalStateContext = {
  stamp: number;
  catalog: Record<string, StudioModel["descriptor"]>;
  imageEnabled: boolean;
  connection?: { configured: boolean; enabled: boolean; health: QueueHealth };
};
export type OriginalStateJob = {
  state: string;
  kind: Kind;
  model: string;
  phase?: string;
  remoteId: string | null;
  view: Record<string, any>;
  metadata: Record<string, any>;
  usage: Record<string, any>;
};
export const stateJobProjectionSchema = z
  .object({
    note: z.string().max(500).optional(),
    width: z.number().finite().nonnegative().optional(),
    height: z.number().finite().nonnegative().optional(),
    actual: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export interface OriginalState {
  /** Pure predicate, called only in-process; no configuration is passed to public projection. */
  configured(config: Record<string, unknown>): boolean;
  configuration(context: OriginalStateContext): Record<string, unknown>;
  project(job: OriginalStateJob): z.infer<typeof stateJobProjectionSchema>;
}
const sizes = z.record(
  z.string(),
  z.array(z.number().int().nonnegative()).length(4),
);
export const stateProviderFieldsSchema = z
  .object({
    ratios: z.array(z.string()),
    sizes,
    gpu_models: z.record(z.string(), z.record(z.string(), z.unknown())),
    h3_limits: z
      .object({
        images: z.number(),
        videos: z.number(),
        audios: z.number(),
        total: z.number(),
        clip_seconds: z.number(),
      })
      .strict(),
    images: z
      .object({
        configured: z.boolean(),
        enabled: z.boolean(),
        default_model: z.string(),
        models: z.record(z.string(), z.string()),
        sizes,
      })
      .strict(),
    muse: z
      .object({
        configured: z.boolean(),
        ready: z.boolean(),
        image_ratios: z.array(z.string()),
        video_ratios: z.array(z.string()),
        durations: z.array(z.number()),
      })
      .strict(),
    flow: z
      .object({
        configured: z.boolean(),
        ready: z.boolean(),
        model_count: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export { publicKeys } from "./public-keys.js";
