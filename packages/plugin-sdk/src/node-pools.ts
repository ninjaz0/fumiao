import { timingReportSchema } from "./timing.js";
import type { QueueJob, QueueNode } from "./queue.js";
import { z } from "zod";

export const nodePoolHooks = [
  "capabilities",
  "eligible",
  "dispatch",
  "receipt",
  "artifactRules",
] as const;
export const nodePoolSchema = z.object({ version: z.literal(1) }).strict();
export const capabilitiesSchema = z
  .object({
    ready_models: z.array(z.string().min(1).max(180)).max(20),
    loaded_model_key: z.string().max(180).optional(),
    vram_total_mb: z.number().int().positive().max(1_048_576).optional(),
    vram_free_mb: z.number().int().nonnegative().max(1_048_576).optional(),
    // Existing installed capability hooks can still return this v1 field.
    comfy_object_info_hash: z.string().max(128).optional(),
    scheduling: z
      .object({
        hardware: z.string().max(180),
        plan: z
          .object({
            mode: z.enum(["serial", "parallel"]),
            lanes: z.record(z.string(), z.unknown()).optional(),
          })
          .catchall(z.unknown())
          .optional(),
      })
      .strict()
      .optional(),
    features: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export const artifactRulesSchema = z
  .object({
    mime: z.enum([
      "image/png",
      "image/jpeg",
      "image/webp",
      "video/mp4",
      "audio/wav",
      "audio/mpeg",
    ]),
    maxBytes: z
      .number()
      .int()
      .positive()
      .max(64 * 1024 * 1024),
    width: z.number().int().positive().max(16384).optional(),
    height: z.number().int().positive().max(16384).optional(),
    videoCodec: z.enum(["h264", "hevc", "av1"]).optional(),
    audioCodec: z.enum(["aac", "pcm_s16le", "mp3"]).optional(),
    fps: z.number().positive().max(240).optional(),
    frames: z.number().int().positive().optional(),
    channels: z.number().int().positive().max(8).optional(),
    unrotated: z.boolean().optional(),
    minPeak: z.number().int().min(1).max(32768).optional(),
    sampleRate: z.number().int().positive().max(192000).optional(),
    minSeconds: z.number().nonnegative().max(7200).optional(),
    maxSeconds: z.number().positive().max(7200).optional(),
  })
  .strict();
export const receiptVerdictSchema = z.union([
  z.literal(true),
  z
    .object({
      metadata: z.record(z.string(), z.unknown()).optional(),
      timing: timingReportSchema.shape.timing,
    })
    .strict(),
]);
export type ArtifactRules = z.infer<typeof artifactRulesSchema>;

export type NodeCapabilities = z.infer<typeof capabilitiesSchema>;
export type PreparedNodeJob = {
  kind: "image" | "audio" | "video";
  view: Record<string, unknown>;
  attempts: number;
  assets: Record<string, string>;
  model: string;
  input: {
    prompt: string;
    params: Record<string, unknown>;
    references: string[];
  };
};
export interface NodePoolProgram {
  capabilities(report: unknown, selected?: string[]): NodeCapabilities;
  eligible(node: QueueNode & Partial<NodeCapabilities>, job: QueueJob): boolean;
  dispatch(
    job: PreparedNodeJob,
    node: QueueNode & Partial<NodeCapabilities>,
  ): Record<string, unknown>;
  receipt(
    job: PreparedNodeJob,
    report: unknown,
  ): boolean | z.infer<typeof receiptVerdictSchema>;
  artifactRules(job: PreparedNodeJob): ArtifactRules;
}
