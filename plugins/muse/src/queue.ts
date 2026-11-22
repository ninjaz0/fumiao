import { requestQueueTools } from "@fumiao/plugin-sdk/request-workbench.js";
import { queuePolicy } from "./queue-policy.js";
import { museTiming } from "./timing.js";
import type { ProviderPlugin } from "@fumiao/plugin-sdk/index.js";
import {
  healthJson,
  healthTruthy,
  healthInteger,
} from "@fumiao/plugin-sdk/health.js";
import { queueHealthSchema } from "@fumiao/plugin-sdk/queue.js";
export { museCapacity } from "./queue-policy.js";
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
  requestCapacity: queuePolicy.requestCapacity,
  queuePlan: (ctx, tools) =>
    queuePolicy.queuePlan(ctx, requestQueueTools(tools)),
};
