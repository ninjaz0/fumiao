import type { QueueJob, QueueNode } from "./queue.js";
import type { ArtifactJob, ArtifactReceipt } from "./preparation.js";
import type { TimingContext } from "./timing.js";

export type ExecutionPlan = {
  mode: "serial" | "parallel";
  lanes?: Record<string, unknown>;
} & Record<string, unknown>;

export type PairedAgentProtocol = {
  provider: string;
  version: 2;
  legacyModel: string;
  models: Record<string, { label: string }>;
  plan(value: Record<string, unknown>, selected: string[]): ExecutionPlan;
  canRun(node: QueueNode, job: QueueJob): boolean;
  preflight(job: ArtifactJob, receipt: ArtifactReceipt): void;
  hardware(
    profile: NonNullable<NonNullable<TimingContext["node"]>["profile"]>,
  ): string;
};

export class PairedAgentPlanError extends Error {}
