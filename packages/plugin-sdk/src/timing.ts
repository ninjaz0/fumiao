import { z } from "zod";
import type { Kind } from "./index.js";

/** Optional capability of an immutable provider version. No provider names or
 * model lists belong in the platform's statistical engine. */
export const timingPolicySchema = z
  .object({
    version: z.literal(1),
    geometry: z.enum(["pixels", "native"]),
    hardware: z.boolean(),
    scaleSteps: z.boolean(),
    providerClock: z.literal(true).optional(),
    workflowAliases: z
      .record(z.string().max(200), z.string().max(200))
      .optional(),
  })
  .strict();
export type TimingPolicy = z.infer<typeof timingPolicySchema>;
const text = z.string().max(200);
const number = z.number().finite().nonnegative();
export const hardwareProfileSchema = z
  .object({
    backend: z.enum(["rocm", "cuda", "cpu", "other"]).optional(),
    gpu_name: z.string().max(120).optional(),
    vram_gib: number.max(2048).optional(),
    available_gpus: number.int().max(128).optional(),
    used_gpus: number.int().min(1).max(128).optional(),
    runtime: z.string().max(80).optional(),
    driver: z.string().max(120).optional(),
    torch_version: z.string().max(80).optional(),
    precision: z.string().max(80).optional(),
    attention: z.string().max(80).optional(),
    memory_mode: z.string().max(80).optional(),
    cpu_cores: number.int().max(4096).optional(),
    ram_gib: number.max(65536).optional(),
  })
  .strict();
export const nodeTimingContextSchema = z
  .object({
    hardware: z.string().max(180).optional(),
    workflow: text.optional(),
    runtime_id: z.string().max(128).optional(),
    profile: hardwareProfileSchema.optional(),
    model_profiles: z
      .record(z.string().max(180), hardwareProfileSchema)
      .refine((p) => Object.keys(p).length <= 20)
      .optional(),
  })
  .strict();
export const timingFeaturesSchema = z
  .object({
    kind: z.enum(["image", "video", "audio", "chat"]),
    executor: text,
    model: text,
    workflow: text,
    width: number,
    height: number,
    seconds: number,
    steps: number.max(100),
    video_mode: text,
    quality: text,
    refs: number.int().max(12),
    ref_pixels: number,
    hardware: text,
    runtime_id: text,
    cold: z.boolean().nullable(),
    native_ratio: text.optional(),
    // Only bounded machine descriptors may enter calibration samples.
    profile: hardwareProfileSchema,
  })
  .strict();
export type TimingFeatures = z.infer<typeof timingFeaturesSchema>;
export type TimingContext = {
  stage?: "start";
  model: string;
  kind: Kind;
  input: {
    prompt: string;
    params: Record<string, any>;
    references: { id: string; width: number; height: number }[];
  };
  node?: {
    id: string;
    hardware?: string;
    workflow?: string;
    runtime_id?: string;
    lane_model?: string;
    profile?: TimingFeatures["profile"];
    model_profiles?: Record<string, TimingFeatures["profile"]>;
  };
  previous?: TimingFeatures;
};
export const timingReportSchema = z
  .object({
    job_phase: z
      .enum([
        "preparing",
        "generating",
        "finalizing",
        "uploading",
        "validating",
      ])
      .optional(),
    step: number.int().max(100).optional(),
    steps: number.int().max(100).optional(),
    uploading: z.boolean().optional(),
    timing: z
      .object({
        prepare_s: number.max(172800).optional(),
        generate_s: number.max(172800).optional(),
        finalize_s: number.max(172800).optional(),
        peak_vram_bytes: number
          .int()
          .max(2 ** 50)
          .optional(),
        peak_allocated_vram_bytes: number
          .int()
          .max(2 ** 50)
          .optional(),
        cold: z.boolean().optional(),
        recovered: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type TimingReport = z.infer<typeof timingReportSchema>;

/** Absolute provider timestamps are distinct from worker monotonic intervals. */
export const providerClockReportSchema = z
  .object({
    state: z.enum(["queued", "running", "completed", "failed", "unknown"]),
    phase: z.string().max(80).optional(),
    created_at: z.number().finite().optional(),
    accepted_at: z.number().finite().optional(),
    started_at: z.number().finite().optional(),
    generating_at: z.number().finite().optional(),
    finished_at: z.number().finite().optional(),
    updated_at: z.number().finite().optional(),
    elapsed: z.number().finite().optional(),
    // A provider may claim a timestamp using an invalid value. Preserve that
    // distinction without storing the invalid value or treating it as a clock.
    started_at_reported: z.literal(true).optional(),
    generating_at_reported: z.literal(true).optional(),
  })
  .strict();
export type ProviderClockReport = z.infer<typeof providerClockReportSchema>;
