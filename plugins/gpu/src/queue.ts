import { gpuTiming } from "./timing.js";
import type { ProviderPlugin } from "@fumiao/plugin-sdk/index.js";
import {
  claimEligible,
  poolSlots,
  canRunQueueJob,
  queueWorkload,
  unavailable,
} from "./queue-policy.js";
export { canRunQueueJob, queueWorkload, readyModels } from "./queue-policy.js";
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
  claimEligible,
  queuePlan(context, tools) {
    const { slots, liveJobs, active } = poolSlots(context, tools.remaining);
    const { jobs } = context;
    return tools.schedule({
      waiting: jobs.filter((j) => j.status === "queued"),
      slots,
      mode: queueWorkload,
      eligible: (slot, job) => canRunQueueJob(slot.node!, job),
      unavailable: (job) => unavailable(job, active),
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
