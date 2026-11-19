import type { Platform } from "./platform.js";
import { one, type Sql } from "./db.js";
import { hash, requireValue } from "./security.js";
import {
  timingFeaturesSchema,
  timingReportSchema,
  providerClockReportSchema,
  type TimingContext,
  type TimingPolicy,
  type TimingReport,
} from "../../plugin-sdk/src/timing.js";
import {
  Estimator,
  remaining,
  phases,
  compensatedSum,
  type Run,
} from "./timing-math.js";

export class JobTiming {
  constructor(readonly p: Platform) {}
  async current(sql: Sql, job: string): Promise<Run | undefined> {
    return one(
      sql,
      "SELECT * FROM job_runs WHERE job=$1 ORDER BY id DESC LIMIT 1 FOR UPDATE",
      [job],
    ) as Promise<Run | undefined>;
  }
  async estimator(sql: Sql, plugin: string, policy: TimingPolicy) {
    const rows = (
      await sql.query(
        `SELECT * FROM (
      SELECT * FROM job_runs WHERE status='legacy' OR (status='done' AND valid AND started IS NOT NULL) ORDER BY id DESC LIMIT 500
      ) recent WHERE plugin_id=$1
      AND policy->>'geometry'=$2 AND policy->>'hardware'=$3 AND policy->>'scaleSteps'=$4
      ORDER BY id DESC`,
        [
          plugin,
          policy.geometry,
          String(policy.hardware),
          String(policy.scaleSteps),
        ],
      )
    ).rows;
    return new Estimator(rows as Run[], policy);
  }
  async features(
    sql: Sql,
    job: any,
    node?: TimingContext["node"],
    previous?: Run,
  ) {
    // Old versions never depended on a timing hook, including cancellation
    // after their executable adapter has been removed from the runtime.
    const version = await one(
      sql,
      "SELECT manifest FROM plugin_versions WHERE id=$1 AND version=$2",
      [job.plugin_id, job.plugin_version],
    );
    if (!version?.manifest.timing) return undefined;
    const plugin = await this.p.registry.resolve(
      sql,
      job.plugin_id,
      job.plugin_version,
    );
    if (!plugin.manifest.timing || !plugin.timingFeatures) return undefined;
    const assets = (
      await sql.query(
        "SELECT id,metadata FROM assets WHERE id=ANY($1::uuid[])",
        [job.input.references],
      )
    ).rows;
    const byId = new Map(assets.map((a) => [a.id, a.metadata]));
    const references = job.input.references.map((id: string) => ({
      id,
      width: Number(byId.get(id)?.width || byId.get(id)?.w || 0),
      height: Number(byId.get(id)?.height || byId.get(id)?.h || 0),
    }));
    const features = timingFeaturesSchema.parse(
      plugin.timingFeatures({
        stage: "start",
        model: job.provider_model,
        kind: job.kind,
        input: { ...job.input, references },
        node,
        previous: previous?.features,
      }),
    );
    requireValue(
      features.model === job.provider_model && features.kind === job.kind,
      500,
      "插件计时特征与任务不一致",
    );
    return { features, policy: plugin.manifest.timing };
  }
  /** Caller holds the job row lock; a polling lease is not a new execution. */
  async start(
    sql: Sql,
    job: any,
    newAttempt: boolean,
    node?: TimingContext["node"],
    stamp = Date.now() / 1000,
  ) {
    const current = await this.current(sql, job.id);
    if (current && !newAttempt) {
      if (current.status === "interrupted") {
        await sql.query(
          "UPDATE job_runs SET status='running',finished=NULL,valid=false WHERE id=$1",
          [current.id],
        );
        return { ...current, status: "running", finished: null, valid: false };
      }
      return current;
    }
    const previous = node?.id
      ? await one(
          sql,
          "SELECT * FROM job_runs WHERE node=$1 AND status='done' AND ($2::text IS NULL OR model=$2) ORDER BY id DESC LIMIT 1",
          [node.id, node.lane_model ?? null],
        )
      : undefined;
    const value = await this.features(
      sql,
      job,
      node,
      previous as Run | undefined,
    );
    if (!value) return;
    const prediction = (
      await this.estimator(sql, job.plugin_id, value.policy)
    ).estimate(value.features, node?.id || null);
    const created = new Date(job.created_at).getTime() / 1000;
    await sql.query(
      `INSERT INTO job_runs(job,run_key,attempt,node,plugin_id,plugin_version,policy,kind,model,features,created,queued,started,status,phase,predicted,steps)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'running','preparing',$14,$15) ON CONFLICT(run_key) DO NOTHING`,
      [
        job.id,
        hash(job.id + ":" + job.lease_token),
        (current?.attempt || 0) + 1,
        node?.id || null,
        job.plugin_id,
        job.plugin_version,
        JSON.stringify(value.policy),
        job.kind,
        job.provider_model,
        JSON.stringify(value.features),
        created,
        Math.max(created, current?.finished || created),
        stamp,
        JSON.stringify(prediction),
        value.features.steps,
      ],
    );
    return this.current(sql, job.id);
  }
  async phase(sql: Sql, job: string, phase: string, stamp = Date.now() / 1000) {
    if (!phases.includes(phase as any)) return;
    const row = await this.current(sql, job);
    if (
      !row ||
      !["running", "interrupted"].includes(row.status) ||
      row.started === null
    )
      return;
    const chosen =
      phases[
        Math.max(phases.indexOf(row.phase as any), phases.indexOf(phase as any))
      ];
    if (chosen !== "preparing")
      await sql.query(
        `UPDATE job_runs SET ${chosen}=COALESCE(${chosen},$2),phase=$3 WHERE id=$1`,
        [row.id, Math.max(stamp, row.started), chosen],
      );
  }
  /** Caller holds the live job lease. A provider acceptance is not a start. */
  async providerClock(
    sql: Sql,
    job: string,
    value: unknown,
    stamp = Date.now() / 1000,
  ) {
    const report = providerClockReportSchema.parse(value),
      row = await this.current(sql, job);
    if (!row) return;
    requireValue(row.policy?.providerClock, 400, "插件未声明提供方计时能力");
    const details = { ...row.details };
    const valid = (time: unknown): time is number =>
      typeof time === "number" &&
      Number.isFinite(time) &&
      time >= row.created - 2 &&
      time <= stamp + 2;
    let start = report.started_at;
    if (
      !valid(start) &&
      report.state === "completed" &&
      valid(report.updated_at) &&
      report.elapsed !== undefined &&
      report.elapsed > 0
    ) {
      start = Math.max(
        report.created_at ?? row.created,
        report.updated_at - report.elapsed,
      );
      details.source = "observed";
      details.provider_elapsed = report.elapsed;
    }
    if (valid(start)) {
      start = Math.max(row.created, start);
      if (!Object.hasOwn(details, "admitted_at"))
        details.admitted_at =
          (row.started || report.accepted_at) ?? row.created;
      if (report.started_at || report.started_at_reported)
        details.source = "provider";
      let phase =
        report.phase || (report.state === "running" ? "generating" : row.phase);
      if (["completed", "failed"].includes(phase)) phase = "finalizing";
      if (!phases.includes(phase as any)) phase = "preparing";
      if (["done", "failed", "cancelled"].includes(row.status))
        phase = row.phase;
      let generating = row.generating,
        finalizing = row.finalizing;
      if (valid(report.generating_at))
        generating = Math.max(start, report.generating_at);
      if (valid(report.finished_at))
        finalizing = Math.max(start, report.finished_at);
      if (
        !report.generating_at &&
        !report.generating_at_reported &&
        row.generating !== null &&
        row.generating < start
      )
        generating = null;
      await sql.query(
        "UPDATE job_runs SET started=$2,phase=$3,details=$4,generating=$5,finalizing=$6 WHERE id=$1",
        [row.id, start, phase, JSON.stringify(details), generating, finalizing],
      );
    } else if (report.state === "queued" && report.phase === "queued") {
      if (!Object.hasOwn(details, "admitted_at"))
        details.admitted_at = row.started || stamp;
      await sql.query(
        "UPDATE job_runs SET started=NULL,phase='queued',details=$2 WHERE id=$1",
        [row.id, JSON.stringify(details)],
      );
    }
  }
  async telemetry(
    sql: Sql,
    row: Run,
    telemetry: NonNullable<TimingReport["timing"]>,
    stamp: number,
  ) {
    const details = { ...row.details },
      features = { ...row.features };
    for (const key of ["peak_vram_bytes", "peak_allocated_vram_bytes"] as const)
      if (telemetry[key] !== undefined) details[key] = telemetry[key];
    const values = Object.fromEntries(
      (["prepare_s", "generate_s", "finalize_s"] as const)
        .filter((k) => telemetry[k] !== undefined)
        .map((k) => [k, telemetry[k]!]),
    );
    if (
      compensatedSum(Object.values(values)) <=
      Math.max(0, stamp - row.started!) + 45
    ) {
      Object.assign(details, values);
      if (Object.keys(values).length) details.source = "worker";
    }
    if (telemetry.cold !== undefined) features.cold = telemetry.cold;
    await sql.query(
      "UPDATE job_runs SET details=$2,features=$3,valid=$4 WHERE id=$1",
      [
        row.id,
        JSON.stringify(details),
        JSON.stringify(features),
        row.valid && !telemetry.recovered,
      ],
    );
  }
  /** The transport must first validate and lock the current job lease. */
  async observe(
    sql: Sql,
    job: string,
    value: unknown,
    stamp = Date.now() / 1000,
  ) {
    const beat = timingReportSchema.parse(value),
      row = await this.current(sql, job);
    if (
      !row ||
      !["running", "interrupted"].includes(row.status) ||
      row.started === null
    )
      return;
    if (row.status === "interrupted") {
      await sql.query(
        "UPDATE job_runs SET status='running',finished=NULL,valid=false WHERE id=$1",
        [row.id],
      );
      row.status = "running";
      row.finished = null;
      row.valid = false;
    }
    let phase: string | undefined =
        beat.job_phase || (beat.uploading ? "uploading" : undefined),
      advanced = false;
    const { step, steps } = beat;
    if (step !== undefined && steps === row.features.steps && step <= steps) {
      const progress = [...row.progress];
      if (!progress.length || step > progress.at(-1)![0]) {
        advanced = true;
        progress.push([step, stamp]);
        await sql.query(
          "UPDATE job_runs SET step=$2,steps=$3,progress=$4 WHERE id=$1",
          [row.id, step, steps, JSON.stringify(progress.slice(-16))],
        );
      }
      phase ||= step < steps ? "generating" : "finalizing";
    }
    if (phase) await this.phase(sql, job, phase, stamp);
    if (beat.timing) await this.telemetry(sql, row, beat.timing, stamp);
    if (advanced) {
      const updated = (await this.current(sql, job))!,
        eta = remaining(updated, stamp);
      if (eta.high != null) {
        const details = { ...updated.details },
          history = [
            ...(details.eta_history || []),
            {
              at: stamp,
              low: eta.low,
              median: eta.median,
              high: eta.high,
              source: eta.source,
            },
          ];
        details.eta_history = history.slice(-32);
        await sql.query("UPDATE job_runs SET details=$2 WHERE id=$1", [
          updated.id,
          JSON.stringify(details),
        ]);
      }
    }
  }
  async end(
    sql: Sql,
    job: any,
    status: "done" | "failed" | "cancelled" | "interrupted",
    stamp = Date.now() / 1000,
    report?: TimingReport["timing"],
  ) {
    const row = await this.current(sql, job.id);
    if (row?.status === "done") return;
    if (
      !row ||
      (status === "cancelled" &&
        job.state === "queued" &&
        row.finished !== null)
    ) {
      if (status !== "cancelled") return;
      const value = await this.features(sql, job);
      if (!value) return;
      await sql.query(
        `INSERT INTO job_runs(job,run_key,attempt,plugin_id,plugin_version,policy,kind,model,features,created,finished,status,phase,valid)
      VALUES($1,$2,0,$3,$4,$5,$6,$7,$8,$9,$10,'cancelled','queued',false) ON CONFLICT(run_key) DO NOTHING`,
        [
          job.id,
          "cancel:" + job.id,
          job.plugin_id,
          job.plugin_version,
          JSON.stringify(value.policy),
          job.kind,
          job.provider_model,
          JSON.stringify(value.features),
          new Date(job.created_at).getTime() / 1000,
          stamp,
        ],
      );
      return;
    }
    if (report)
      await this.telemetry(
        sql,
        row,
        timingReportSchema.parse({ timing: report }).timing!,
        stamp,
      );
    if (row.status === "interrupted" && status === "done")
      await sql.query("UPDATE job_runs SET valid=false WHERE id=$1", [row.id]);
    await sql.query(
      "UPDATE job_runs SET finished=$2,status=$3,phase=$4 WHERE id=$1",
      [row.id, stamp, status, status === "done" ? "done" : row.phase],
    );
  }
}
