import type { ProviderClockReport } from "@fumiao/plugin-sdk/timing.js";
import { healthTruthy } from "@fumiao/plugin-sdk/health.js";
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
