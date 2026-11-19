import { gpuTiming, pipeline } from "./timing.js";
import type {
  ProviderPlugin,
  QueueJob,
  QueueNode,
  QueueSlot,
  TimingFeatures,
} from "../../../packages/plugin-sdk/src/index.js";
const standard = "MiniMax H3",
  native = "h3-v6-native-inputs-turbo4",
  fast = ["h3-v5-rocm-qkv-safe-turbo4", native];
export const readyModels = (node: QueueNode) => node.ready_models ?? [standard];
export function canRunQueueJob(node: QueueNode, job: QueueJob) {
  if (!readyModels(node).includes(job.model)) return false;
  if (job.model !== standard) return true;
  const p = job.input.params;
  if (
    p.h3_inputs &&
    Object.keys(p.h3_inputs).length &&
    node.workflow !== native
  )
    return false;
  if (node.workflow === "h3-v3-rocm-qkv-safe-fast4-i2v768") return false;
  if ((p.sampling_steps ?? 20) === 4 && !fast.includes(node.workflow || ""))
    return false;
  return (node.video_steps ?? [20]).includes(p.sampling_steps ?? 20);
}
export const queueWorkload = (job: QueueJob) =>
  job.kind === "audio"
    ? "tts"
    : pipeline(job.input.params, job.input.references.length);
const priorWorkload = (f: TimingFeatures) =>
  f.kind === "audio" ? "tts" : pipeline(f, f.refs);
export const gpuQueue: ProviderPlugin = {
  ...gpuTiming,
  manifest: {
    ...gpuTiming.manifest,
    version: "1.3.0",
    queue: {
      version: 1,
      strategy: "slots",
      timingVersions: ["1.2.0", "1.3.0"],
    },
  },
  claimEligible(node, job, stamp) {
    return (
      node.execution_plan?.mode !== "parallel" &&
      node.control === "active" &&
      ["ready", "busy"].includes(node.stage) &&
      stamp - node.lastseen <= 75 &&
      node.can_accept !== false &&
      canRunQueueJob(node, job)
    );
  },
  queuePlan(context, tools) {
    const { jobs, stamp } = context;
    const expanded = context.nodes.flatMap((n) =>
      n.execution_plan?.mode === "parallel"
        ? (n.lanes || [])
            .filter(
              (l) =>
                ["ready", "busy"].includes(l.stage) && stamp - l.lastseen <= 75,
            )
            .map((l) => ({
              ...n,
              stage: l.stage,
              lastseen: l.lastseen,
              runtime_id: l.runtime_id,
              ready_models: [l.model],
              lane_model: l.model,
              can_accept: l.can_accept,
            }))
        : [n],
    );
    const alive = expanded.filter(
        (n) => ["ready", "busy"].includes(n.stage) && stamp - n.lastseen <= 75,
      ),
      active = alive.filter((n) => n.control === "active");
    const liveJobs = jobs
      .filter(
        (j) =>
          j.status === "running" &&
          (j.kind === "image" || alive.some((n) => n.id === j.node)),
      )
      .map((j) => j.id);
    const slots: QueueSlot[] = active.map((node) => {
      const previous = context.history.find(
        (r) =>
          r.node === node.id &&
          (!node.lane_model || r.features.model === node.lane_model),
      );
      let mode =
        previous && previous.features.runtime_id === node.runtime_id
          ? priorWorkload(previous.features)
          : null;
      const running = jobs.find(
        (j) =>
          j.node === node.id &&
          j.status === "running" &&
          (!node.lane_model || j.model === node.lane_model),
      );
      let low = 0,
        median: number | null = null,
        high: number | null = null;
      if (running) {
        const row = context.runs[running.id];
        mode = row?.features
          ? priorWorkload(row.features)
          : queueWorkload(running);
        const eta = tools.remaining(running);
        if (eta.high != null && !eta.overdue) {
          low = eta.low ?? 0;
          median = eta.median ?? 0;
          high = eta.high;
        }
      } else if (node.stage === "ready") {
        if (node.can_accept !== false) median = high = 0;
      } else if (
        previous?.finished != null &&
        previous.finished >= node.lastseen
      ) {
        median = 0;
        high = 5;
      }
      return { node, low, median, high, modes: [mode] };
    });
    return tools.schedule({
      waiting: jobs.filter((j) => j.status === "queued"),
      slots,
      mode: queueWorkload,
      eligible: (slot, job) => canRunQueueJob(slot.node!, job),
      unavailable: (job) =>
        job.model === standard &&
        active.some((n) => readyModels(n).includes(job.model))
          ? "worker_update"
          : "waiting_gpu",
      predict: (job, slot, mode) => {
        if (!tools.supports(job))
          return { source: "none", samples: 0, confidence: "none", version: 4 };
        const f = tools.features(job, slot.node);
        if (slot.node?.runtime_id) f.cold = mode !== queueWorkload(job);
        return tools.planning(f, slot.node?.id, liveJobs);
      },
    });
  },
};
