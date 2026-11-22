import { imagesTiming } from "./timing.js";
import type {
  ProviderPlugin,
  QueueSlot,
} from "@fumiao/plugin-sdk/index.js";
export const imagesQueue: ProviderPlugin = {
  ...imagesTiming,
  manifest: {
    ...imagesTiming.manifest,
    version: "1.3.0",
    queue: {
      version: 1,
      strategy: "slots",
      timingVersions: ["1.2.0", "1.3.0"],
    },
  },
  queuePlan(context, tools) {
    const running = context.jobs.find((j) => j.status === "running"),
      eta = running
        ? tools.remaining(running)
        : { low: 0, median: 0, high: 0, overdue: false };
    const bounded = eta.high != null && !eta.overdue;
    const slots: QueueSlot[] = context.imageEnabled
      ? [
          {
            low: bounded ? (eta.low ?? 0) : 0,
            median: bounded ? (eta.median ?? 0) : null,
            high: bounded ? eta.high : null,
            modes: [null],
          },
        ]
      : [];
    return tools.schedule({
      waiting: context.jobs.filter((j) => j.status === "queued"),
      slots,
      mode: (job) =>
        job.input.references.length > 1
          ? "r2v"
          : job.input.references.length
            ? "i2v"
            : "t2v",
      eligible: () => true,
      unavailable: () => "service_paused",
      predict: (job) =>
        tools.supports(job)
          ? tools.planning(
              tools.features(job),
              undefined,
              context.jobs
                .filter((j) => j.status === "running")
                .map((j) => j.id),
            )
          : { source: "none", samples: 0, confidence: "none", version: 4 },
    });
  },
};
