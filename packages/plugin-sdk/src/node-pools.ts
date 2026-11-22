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
    ]),
    maxBytes: z
      .number()
      .int()
      .positive()
      .max(64 * 1024 * 1024),
    width: z.number().int().positive().max(16384).optional(),
    height: z.number().int().positive().max(16384).optional(),
    videoCodec: z.enum(["h264", "hevc", "av1"]).optional(),
    audioCodec: z.enum(["aac", "pcm_s16le"]).optional(),
    fps: z.number().positive().max(240).optional(),
    frames: z.number().int().positive().optional(),
    channels: z.number().int().positive().max(8).optional(),
    sampleRate: z.number().int().positive().max(192000).optional(),
    minSeconds: z.number().nonnegative().max(7200).optional(),
    maxSeconds: z.number().positive().max(7200).optional(),
  })
  .strict();
export type ArtifactRules = z.infer<typeof artifactRulesSchema>;

export type NodeCapabilities = z.infer<typeof capabilitiesSchema>;
export type PreparedNodeJob = {
  kind: "image" | "audio" | "video";
  model: string;
  input: {
    prompt: string;
    params: Record<string, unknown>;
    references: string[];
  };
};
export interface NodePoolProgram {
  capabilities(report: unknown): NodeCapabilities;
  eligible(node: QueueNode & Partial<NodeCapabilities>, job: QueueJob): boolean;
  dispatch(
    job: PreparedNodeJob,
    node: QueueNode & Partial<NodeCapabilities>,
  ): Record<string, unknown>;
  receipt(job: PreparedNodeJob, report: unknown): boolean;
  artifactRules(job: PreparedNodeJob): ArtifactRules;
}
