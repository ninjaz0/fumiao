import { museTiming } from "./timing.js";
import type {
  ProviderPlugin,
  QueueContext,
} from "@fumiao/plugin-sdk/index.js";
import {
  healthJson,
  healthTruthy,
  healthInteger,
} from "@fumiao/plugin-sdk/health.js";
import { queueHealthSchema } from "@fumiao/plugin-sdk/queue.js";
const compare = (a: { id: string | number }, b: { id: string | number }) =>
  typeof a.id === "number" && typeof b.id === "number"
    ? a.id - b.id
    : String(a.id) < String(b.id)
      ? -1
      : String(a.id) > String(b.id)
        ? 1
        : 0;
export function museCapacity(context: Pick<QueueContext, "jobs" | "health">) {
  const status = context.health,
    ownIds = new Set(
      context.jobs
        .filter((j) => j.status === "running" && j.remoteId)
        .map((j) => j.remoteId),
    );
  const external = (status.tasks || []).filter((t) => !ownIds.has(t.id)).length;
  return Math.max(
    0,
    Math.min(16, status.capacity ?? 1) - external - (status.maintenance ?? 0),
  );
}
export const museQueue: ProviderPlugin = {
  ...museTiming,
  manifest: {
    ...museTiming.manifest,
    version: "1.3.0",
    queue: {
      version: 1,
      strategy: "capacity",
      timingVersions: ["1.2.0", "1.3.0"],
    },
  },
  async queueHealth(config, signal) {
    try {
      const ready = await healthJson(config, "readyz", signal);
      if (ready.status !== "ready" || !healthTruthy(ready.accounts))
        return { ready: false };
      const models = await healthJson(config, "v1/models", signal);
      if (!Array.isArray(models.data) || !models.data.length)
        return { ready: false };
      try {
        const queue = await healthJson(config, "v1/queue", signal);
        return queueHealthSchema.parse({
          ready: true,
          capacity: Math.max(
            0,
            Math.min(
              16,
              healthInteger(queue.capacity === undefined ? 1 : queue.capacity),
            ),
          ),
          maintenance: Math.max(
            0,
            Math.min(
              1000,
              healthInteger(
                queue.maintenance === undefined ? 0 : queue.maintenance,
              ),
            ),
          ),
          tasks: (queue.tasks === undefined ? [] : queue.tasks)
            .slice(0, 10000)
            .map((t: any) => (typeof t.id === "string" ? { id: t.id } : {})),
        });
      } catch {
        return { ready: true, capacity: 1, maintenance: 0, tasks: [] };
      }
    } catch {
      return { ready: false };
    }
  },
  requestCapacity(context) {
    return context.health.ready &&
      context.stamp - (context.health.checked ?? 0) < 90
      ? museCapacity(context)
      : 0;
  },
  queuePlan(context, tools) {
    const { health, jobs, runs, stamp } = context,
      available = health.ready && stamp - (health.checked ?? 0) < 90,
      capacity = museCapacity(context);
    const lanes = Array.from({ length: Math.max(1, capacity) }, () => ({
      low: 0 as number | null,
      median: 0 as number | null,
      high: 0 as number | null,
    }));
    const busy = jobs.filter(
      (j) => j.status === "running" && runs[j.id]?.phase !== "queued",
    );
    for (const [index, job] of busy.entries()) {
      const eta = tools.remaining(job),
        lane = lanes[Math.min(index, lanes.length - 1)];
      for (const key of ["low", "median", "high"] as const)
        lane[key] =
          eta[key] != null && !eta.overdue
            ? Math.max(lane[key] || 0, eta[key])
            : null;
    }
    const plans: Record<string, any> = {};
    let ahead = 0;
    for (const job of jobs
      .filter(
        (j) =>
          j.status === "queued" ||
          (j.status === "running" && runs[j.id]?.phase === "queued"),
      )
      .sort(compare)) {
      if (job.kind === "image" && !context.imageEnabled) {
        plans[job.id] = { source: "none", reason: "service_paused", ahead };
        continue;
      }
      const prediction = tools.supports(job)
        ? tools.estimate(tools.features(job))
        : { source: "none", samples: 0, confidence: "none", version: 4 };
      const lane = lanes.reduce((a, b) =>
        (b.median ?? Infinity) < (a.median ?? Infinity) ? b : a,
      );
      const plan =
        !available || !capacity
          ? {
              source: "none",
              reason: !available ? "waiting_muse" : "muse_busy",
              ahead,
              duration: prediction,
            }
          : {
              ...lane,
              source: lane.high !== null ? "queue" : "none",
              reason: lane.high !== null ? null : "observing",
              ahead,
              duration: prediction,
            };
      plans[job.id] =
        job.status === "running" ? { ...plan, phase: "queued" } : plan;
      for (const key of ["low", "median", "high"] as const)
        lane[key] =
          lane[key] !== null && prediction[key] != null
            ? lane[key]! + prediction[key]
            : null;
      ahead++;
    }
    return plans;
  },
};
