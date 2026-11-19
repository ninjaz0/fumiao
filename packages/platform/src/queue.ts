import type {
  ProviderPlugin,
  QueueContext,
  QueuePlans,
  QueueTools,
  QueueId,
} from "../../plugin-sdk/src/index.js";
import {
  timingFeaturesSchema,
  queueHealthSchema,
} from "../../plugin-sdk/src/index.js";
import {
  Estimator,
  planningPrediction,
  remaining,
  type Run,
} from "./timing-math.js";
import { scheduleSlots } from "./queue-math.js";
import { requireValue } from "./security.js";

/** One immutable plugin/version and one connection snapshot. No network or
 * mutation during a state read. The caller filters the returned IDs by tenant. */
export function forecastQueue(
  plugin: ProviderPlugin,
  context: QueueContext,
  runs: Record<string, Run>,
  estimator: Pick<Estimator, "estimate" | "policy">,
): QueuePlans {
  requireValue(
    plugin.manifest.queue && plugin.queuePlan && plugin.timingFeatures,
    503,
    "插件尚未提供队列契约",
  );
  queueHealthSchema.parse(context.health);
  const paused = context.jobs.filter(
      (j) => j.status === "queued" && j.enabled === false,
    ),
    active = {
      ...context,
      jobs: context.jobs.filter((j) => !paused.includes(j)),
    };
  const tools: QueueTools = {
    supports: (job) =>
      plugin.manifest.queue!.timingVersions.includes(
        job.pluginVersion ?? plugin.manifest.version,
      ),
    schedule: scheduleSlots,
    features: (job, node) => {
      const f = timingFeaturesSchema.parse(
        plugin.timingFeatures!({
          model: job.model,
          kind: job.kind,
          input: job.input,
          node: node ? { ...node, id: String(node.id) } : undefined,
        }),
      );
      requireValue(
        f.model === job.model && f.kind === job.kind,
        500,
        "插件计时特征与任务不一致",
      );
      return f;
    },
    estimate: (f, node) =>
      estimator.estimate(f, node === undefined ? null : String(node)),
    planning: (f, node, liveJobs: QueueId[]) =>
      planningPrediction(
        estimator as Estimator,
        f,
        node === undefined ? null : String(node),
        liveJobs.map((id) => runs[id]).filter(Boolean),
        context.stamp,
      ),
    remaining: (job) => remaining(runs[job.id], context.stamp),
  };
  const plans = plugin.queuePlan!(active, tools);
  for (const j of paused)
    plans[j.id] = { source: "none", reason: "model_paused", ahead: 0 };
  requireValue(
    Object.keys(plans).every((id) =>
      context.jobs.some((j) => String(j.id) === id),
    ),
    500,
    "插件返回了未知任务预测",
  );
  return plans;
}
