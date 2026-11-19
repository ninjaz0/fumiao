import type { Platform } from "./platform.js";
import type { Sql } from "./db.js";
import { one } from "./db.js";
import { JobTiming } from "./timing.js";
import { QueueForecasts } from "./queue-snapshot.js";

export const unobservedDuration: Readonly<Record<string, unknown>> = {
  source: "none",
  samples: 0,
  confidence: "none",
  version: 4,
};

/** Freeze the submission estimate without advancing leases or contacting providers. */
export async function saveSubmissionForecast(
  p: Platform,
  sql: Sql,
  id: string,
) {
  const job = await one(sql, "SELECT * FROM jobs WHERE id=$1", [id]);
  const forecast = await submissionDuration(p, sql, job);
  await sql.query("UPDATE jobs SET submission_forecast=$2 WHERE id=$1", [
    id,
    JSON.stringify(forecast),
  ]);
  return forecast;
}

/** Also accepts a hypothetical task; never writes or requires a persisted job. */
export async function submissionDuration(
  p: Platform,
  sql: Sql,
  job: any,
  queue?: any,
  eligible?: boolean,
) {
  const timing = new JobTiming(p),
    value = await timing.features(sql, job);
  let forecast: Record<string, any> = { ...unobservedDuration };
  if (value) {
    if (!value.policy.hardware)
      forecast = (
        await timing.estimator(sql, job.plugin_id, value.policy)
      ).estimate(value.features);
    else {
      if (queue === undefined)
        queue = (await new QueueForecasts(p).read(sql, job.workspace_id)).jobs[
          job.id
        ]?.eta;
      forecast = (eligible !== false && queue?.duration) || {
        ...forecast,
        reason:
          eligible === false ||
          ["no_instance", "waiting_gpu", "worker_update"].includes(
            queue?.reason,
          )
            ? "no_instance"
            : "uncalibrated_instance",
      };
    }
  }
  return forecast;
}
