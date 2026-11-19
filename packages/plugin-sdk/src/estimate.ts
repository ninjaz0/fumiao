import { z } from "zod";
import type { OriginalReference } from "./original.js";
import type { QueueJob, QueueNode } from "./queue.js";

export const estimatePolicySchema = z
  .object({ version: z.literal(1) })
  .strict();
export type EstimatePolicy = z.infer<typeof estimatePolicySchema>;
export type EstimateDraft = {
  model: string;
  kind: string;
  ratio: string;
  quality: number;
  seconds: number;
  sampling_steps: number;
  resolution: string;
  image_quality: string;
  refs: string[];
  h3: {
    mode: "reference" | "frames";
    first_frame: string | null;
    last_frame: string | null;
    video_audio: string[];
  } | null;
  text_chars: number;
  language: string;
  audio_instruction: string;
};
export const estimateInputSchema = z
  .object({
    model: z.string().min(1).max(180),
    kind: z.enum(["video", "image", "audio"]),
    params: z.record(z.string(), z.unknown()),
    references: z.array(z.string().uuid()).max(12),
  })
  .strict();
export type EstimateInput = z.infer<typeof estimateInputSchema>;
export type EstimateResources = {
  authorize(): Promise<void>;
  references(
    ids: string[],
    roles?: string[],
    missing?: { status: 400 | 404; message: string },
  ): Promise<OriginalReference[]>;
};
export interface OriginalEstimate {
  prepare(
    draft: EstimateDraft,
    resources: EstimateResources,
  ): Promise<EstimateInput>;
  /** Eligibility for a forecast includes a busy worker, unlike claim admission. */
  eligible?(node: QueueNode, job: QueueJob, stamp: number): boolean;
}
