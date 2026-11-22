import { museQueue } from "./queue.js";
import { museReceipt, submitMuse, inspectMuse } from "./index.js";
import type { ProviderPlugin, Execution } from "@fumiao/plugin-sdk/index.js";

import { museClockReport } from "./clock-report.js";
export { museClockReport };
async function observe(e: Execution, value: any, polling: boolean) {
  await e.reportProviderClock?.(museClockReport(value));
  // The original poll path marks generation only when the phase is absent.
  if (
    polling &&
    value.status === "processing" &&
    !Object.hasOwn(value, "phase")
  )
    await e.reportTiming?.({ job_phase: "generating" });
  return museReceipt(value);
}
export const museClock: ProviderPlugin = {
  ...museQueue,
  manifest: {
    ...museQueue.manifest,
    version: "1.4.0",
    timing: { ...museQueue.manifest.timing!, providerClock: true },
    queue: {
      ...museQueue.manifest.queue!,
      timingVersions: ["1.2.0", "1.3.0", "1.4.0"],
    },
  },
  async submit(e) {
    return observe(e, await submitMuse(e), false);
  },
  async inspect(e, id) {
    return observe(e, await inspectMuse(e, id), true);
  },
};
