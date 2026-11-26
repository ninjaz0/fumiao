import { z } from "zod";
import type { Kind } from "./index.js";
import type { TimingContext, TimingFeatures } from "./timing.js";

export const queuePolicySchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]),
    strategy: z.enum(["slots", "capacity", "opaque"]),
    timingVersions: z
      .array(z.string().regex(/^\d+\.\d+\.\d+$/))
      .min(1)
      .max(100),
  })
  .strict();
export type QueuePolicy = z.infer<typeof queuePolicySchema>;
export type QueueId = string | number;
export type QueueEstimate = { source: string; [key: string]: any };
export type QueuePlans = Record<string, QueueEstimate>;
export type QueueJob = {
  id: QueueId;
  node: QueueId | null;
  model: string;
  kind: Kind;
  status: string;
  remoteId?: string | null;
  pluginVersion?: string;
  input: TimingContext["input"];
  enabled?: boolean;
};
export type QueueNode = Omit<NonNullable<TimingContext["node"]>, "id"> & {
  id: QueueId;
  stage: string;
  control: string;
  lastseen: number;
  ready_models?: string[];
  video_steps?: number[];
  features?: Record<string, unknown>;
  execution_plan?: { mode?: string };
  lanes?: {
    model: string;
    stage: string;
    lastseen: number;
    runtime_id: string;
    can_accept: boolean;
  }[];
  lane_model?: string;
  can_accept?: boolean;
};
export type QueueRun = {
  id: QueueId;
  node: QueueId | null;
  features: TimingFeatures;
  phase: string;
  finished: number | null;
};
// Parallel execution plans require a separate budget/lane admission contract;
// the existing v2 worker may report only its single physical execution slot.
export const nodeQueueStateSchema = z
  .object({
    stage: z.enum(["preparing", "ready", "busy", "failed", "offline"]),
    ready_models: z.array(z.string().max(180)).max(20),
    video_steps: z.array(z.number().int().min(1).max(100)).max(100).optional(),
    can_accept: z.boolean().optional(),
  })
  .strict();
export const queueHealthSchema = z
  .object({
    ready: z.boolean().optional(),
    checked: z.number().finite().optional(),
    capacity: z.number().finite().int().nonnegative().max(1000).optional(),
    maintenance: z.number().finite().int().nonnegative().max(1000).optional(),
    tasks: z
      .array(
        z
          .object({
            id: z.string().max(500).optional(),
            kind: z.enum(["image", "video", "audio", "chat"]).optional(),
          })
          .strict(),
      )
      .max(10000)
      .optional(),
    model_count: z.number().int().nonnegative().max(10000).optional(),
  })
  .strict();
export type QueueHealth = z.infer<typeof queueHealthSchema>;
export type QueueAdmission = {
  health: QueueHealth;
  jobs: QueueJob[];
  job?: Pick<QueueJob, "kind" | "model">;
  stamp: number;
};
export type QueueContext = {
  jobs: QueueJob[];
  nodes: QueueNode[];
  runs: Record<string, QueueRun>;
  history: QueueRun[];
  stamp: number;
  health: z.infer<typeof queueHealthSchema>;
  imageEnabled: boolean;
};
export type QueueSlot = {
  node?: QueueNode;
  low: number;
  median: number | null;
  high: number | null;
  modes: (string | null)[];
};
export type SlotSchedule = {
  waiting: QueueJob[];
  slots: QueueSlot[];
  mode(job: QueueJob): string;
  eligible(slot: QueueSlot, job: QueueJob): boolean;
  unavailable(job: QueueJob): string;
  predict(job: QueueJob, slot: QueueSlot, mode: string | null): QueueEstimate;
};
export type QueueTools = {
  supports(job: QueueJob): boolean;
  features(job: QueueJob, node?: QueueNode): TimingFeatures;
  estimate(features: TimingFeatures, node?: QueueId): QueueEstimate;
  planning(
    features: TimingFeatures,
    node: QueueId | undefined,
    liveJobs: QueueId[],
  ): QueueEstimate;
  remaining(job: QueueJob): QueueEstimate;
  schedule(input: SlotSchedule): QueuePlans;
};
export type QueuePlanner = (
  context: QueueContext,
  tools: QueueTools,
) => QueuePlans;
