import { flowTiming } from "./timing.js";
import type { ProviderPlugin } from "@fumiao/plugin-sdk/index.js";
import {
  healthJson,
  healthTruthy,
} from "@fumiao/plugin-sdk/health.js";
export const flowQueue: ProviderPlugin = {
  ...flowTiming,
  manifest: {
    ...flowTiming.manifest,
    version: "1.3.0",
    queue: {
      version: 1,
      strategy: "opaque",
      timingVersions: ["1.2.0", "1.3.0"],
    },
  },
  async queueHealth(config, signal) {
    try {
      const catalog = await healthJson(config, "v1/models", signal),
        health = await healthJson(config, "health", signal);
      return {
        ready: !!(
          Array.isArray(catalog.data) &&
          catalog.data.length &&
          healthTruthy(health.backend_running) &&
          healthTruthy(health.has_active_tokens)
        ),
      };
    } catch {
      return { ready: false };
    }
  },
  requestCapacity({ health, stamp }) {
    return health.ready && stamp - (health.checked ?? 0) < 90 ? null : 0;
  },
  queuePlan(context, tools) {
    const running = context.jobs.filter((j) => j.status === "running").length,
      available =
        context.health.ready &&
        context.stamp - (context.health.checked ?? 0) < 90;
    const plans: Record<string, any> = {};
    let ahead = running;
    for (const job of context.jobs
      .filter((j) => j.status === "queued")
      .sort((a, b) =>
        typeof a.id === "number" && typeof b.id === "number"
          ? a.id - b.id
          : String(a.id) < String(b.id)
            ? -1
            : 1,
      )) {
      plans[job.id] = {
        source: "none",
        reason: running
          ? "flow_busy"
          : available
            ? "observing"
            : "waiting_flow",
        ahead: ahead++,
        duration: tools.supports(job)
          ? tools.estimate(tools.features(job))
          : { source: "none", samples: 0, confidence: "none", version: 4 },
      };
    }
    return plans;
  },
};
