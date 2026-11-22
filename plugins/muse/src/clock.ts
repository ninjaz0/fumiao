import { museQueue } from "./queue.js";
import { museReceipt, submitMuse, inspectMuse } from "./index.js";
import { healthTruthy } from "@fumiao/plugin-sdk/health.js";
import type {
  ProviderPlugin,
  ProviderClockReport,
  Execution,
} from "@fumiao/plugin-sdk/index.js";

/** Keep only finite timing values; upstream bodies, prompts and keys never enter
 * execution records. Invalid timestamps are omitted, not coerced from strings. */
export function museClockReport(
  value: Record<string, unknown>,
): ProviderClockReport {
  const report: ProviderClockReport = {
    state:
      value.status === "processing"
        ? "running"
        : typeof value.status === "string" &&
            ["queued", "completed", "failed"].includes(value.status)
          ? (value.status as "queued" | "completed" | "failed")
          : "unknown",
  };
  if (typeof value.phase === "string") report.phase = value.phase.slice(0, 80);
  else if (healthTruthy(value.phase)) report.phase = "unknown";
  for (const key of [
    "created_at",
    "accepted_at",
    "started_at",
    "generating_at",
    "finished_at",
    "updated_at",
    "elapsed",
  ] as const) {
    if (typeof value[key] === "number" && Number.isFinite(value[key]))
      report[key] = value[key];
  }
  for (const key of ["started_at", "generating_at"] as const) {
    if (report[key] === undefined && healthTruthy(value[key]))
      report[`${key}_reported`] = true;
  }
  return report;
}
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
