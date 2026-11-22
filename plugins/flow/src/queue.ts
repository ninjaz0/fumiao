import { requestQueueTools } from "@fumiao/plugin-sdk/request-workbench.js";
import { queuePolicy } from "./queue-policy.js";
import { flowTiming } from "./timing.js";
import type { ProviderPlugin } from "@fumiao/plugin-sdk/index.js";
import { healthJson, healthTruthy } from "@fumiao/plugin-sdk/health.js";
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
  requestCapacity: queuePolicy.requestCapacity,
  queuePlan: (ctx, tools) =>
    queuePolicy.queuePlan(ctx, requestQueueTools(tools)),
};
