import {
  hasStudioPackages,
  queuedModelPolicy,
} from "./studio-plugin-profile.js";
import { loadProgram } from "./plugin-program.js";
import { randomUUID } from "node:crypto";
import { one, type Sql } from "./db.js";
import { Platform } from "./platform.js";
import {
  ProviderError,
  ArtifactDownloadError,
  ArtifactValidationError,
  RequestLifecycleError,
  requestDispositionSchema,
  type RequestDisposition,
  type RequestLifecycle,
  receiptSchema,
  type Execution,
  type Receipt,
} from "@fumiao/plugin-sdk/index.js";
import { requireValue } from "./security.js";
import { inspectProviderOutput } from "./provider-output.js";
import { inspectMedia } from "./media.js";
import { artifactCapacity } from "./capacity.js";
import { JobTiming } from "./timing.js";
import { FrozenQueueHealth } from "./queue-health.js";
import type { QueueHealth, QueueJob } from "@fumiao/plugin-sdk/queue.js";
import { executableJob } from "./retired-jobs.js";
import { hasTailChainTable, wakeTailFrameChildren } from "./tail-frame.js";
import { ensureDerivativeQueued } from "./derivatives.js";
import {
  isModerationRejectionMessage,
  recordCompletedJobCost,
  tryModerationEquivalentFallback,
  tryModerationRewrite,
} from "./moderation-rewrite.js";
class ReferenceUnavailable extends Error {}

export class Executor {
  private readonly frozenHealth = new FrozenQueueHealth();
  constructor(private platform: Platform) {}
  async queueReady() {
    const tailGuard = (await hasTailChainTable(this.platform.db))
      ? "AND NOT EXISTS (SELECT 1 FROM job_tail_chains tc WHERE tc.child_job_id=j.id)"
      : "";
    return (
      await this.platform.db
        .query(`SELECT j.id FROM jobs j LEFT JOIN outbox o ON o.job_id=j.id
      JOIN connections c ON c.id=j.connection_id JOIN models m ON m.id=j.model_id JOIN users u ON u.id=j.owner_id
      JOIN plugin_versions v ON v.id=j.plugin_id AND v.version=j.plugin_version
      LEFT JOIN model_permissions mp ON mp.model_id=m.id AND mp.workspace_id=j.workspace_id
      WHERE (j.state IN ('running','finalizing') OR (j.state='queued' AND c.enabled=true AND u.active=true
        AND COALESCE(mp.enabled,true) AND ${await queuedModelPolicy(this.platform.db)} AND v.manifest->>'mode'='request'))
      AND NOT c.fmworker_resource_driver AND NOT (v.manifest ? 'fmworkerResources')
      AND ${executableJob}
      AND j.lease_token IS NULL AND (o.available_at IS NULL OR o.available_at<=now())
      ${tailGuard}
      AND (j.request_retry_at IS NULL OR j.request_retry_at<=now())
      AND NOT (j.state='queued' AND j.kind='image' AND COALESCE((v.manifest->'requestLifecycle'->>'honorImageEnabled')::boolean,false) AND NOT (SELECT image_enabled FROM original_state_settings))
      ORDER BY COALESCE(o.available_at,j.created_at),j.id LIMIT 100`)
    ).rows;
  }
  async recover() {
    return this.platform.db.transaction((sql) => this.recoverOn(sql));
  }
  async recoverOn(sql: Sql, originalOnly = false) {
    const p = this.platform;
    if (!originalOnly) {
      const disabled = (
        await sql.query(`SELECT j.*,v.manifest
        FROM jobs j JOIN users u ON u.id=j.owner_id
        JOIN plugin_versions v ON v.id=j.plugin_id AND v.version=j.plugin_version
        WHERE j.state='queued' AND NOT u.active AND ${executableJob} AND v.manifest->'requestLifecycle'->>'cancelDisabled'='true'
        AND (COALESCE(v.manifest->'requestLifecycle'->>'preferFinalizing','false')!='true' OR NOT EXISTS(
          SELECT 1 FROM jobs pending WHERE pending.connection_id=j.connection_id AND pending.state IN ('dispatching','running','finalizing') AND pending.receipt IS NOT NULL))
        ORDER BY j.workspace_id,j.id FOR UPDATE OF j SKIP LOCKED`)
      ).rows;
      for (const job of disabled) {
        const policy = job.manifest.requestLifecycle as RequestLifecycle;
        if (policy.version === 3 && policy.cancelOnlyWhenAvailable) {
          const plugin = await p.registry.resolve(
            sql,
            job.plugin_id,
            job.plugin_version,
          );
          const available = await one(
            sql,
            `SELECT c.enabled,s.image_enabled FROM connections c JOIN models m ON m.id=$3 CROSS JOIN original_state_settings s
            WHERE c.id=$1 AND (m.catalog_id IS NOT NULL OR m.enabled) AND studio_model_allowed(COALESCE($2,m.catalog_id),NULL)`,
            [job.connection_id, job.catalog_id, job.model_id],
          );
          if (
            !available?.enabled ||
            (policy.honorImageEnabled && !available.image_enabled) ||
            (policy.requireConfigured &&
              !plugin.originalState?.configured(
                p.vault.open(job.config_snapshot),
              ))
          )
            continue;
        }
        await p.settle(
          sql,
          job,
          "cancelled",
          undefined,
          job.manifest.requestLifecycle.notes.disabled,
          undefined,
          {
            preserveTiming:
              job.manifest.requestLifecycle.version !== 1 &&
              !job.manifest.requestLifecycle.recordCancelledRun,
          },
        );
      }
      // Queue-wide notes use one set update. Do not rewrite unchanged rows or
      // serialize active claims behind a per-job health-maintenance loop.
      await sql.query(`WITH unavailable AS (
        SELECT j.id,v.manifest->'requestLifecycle'->'notes'->>'unavailable' AS note
        FROM jobs j JOIN connections c ON c.id=j.connection_id
        JOIN plugin_versions v ON v.id=j.plugin_id AND v.version=j.plugin_version
        WHERE j.state='queued' AND c.plugin_version=j.plugin_version AND ${executableJob} AND v.manifest->'requestLifecycle' IS NOT NULL
        AND v.manifest->'requestLifecycle'->'notes'->>'unavailable' IS NOT NULL
        AND j.request_note IS DISTINCT FROM v.manifest->'requestLifecycle'->'notes'->>'unavailable'
        AND (c.queue_health_revision IS DISTINCT FROM c.revision OR NOT COALESCE((c.queue_health->>'ready')::boolean,false)
          OR extract(epoch FROM now())-COALESCE((c.queue_health->>'checked')::double precision,0)>=90)
        FOR UPDATE OF j SKIP LOCKED)
        UPDATE jobs j SET request_note=u.note FROM unavailable u WHERE j.id=u.id`);
    }
    const stale = (
      await sql.query(
        `SELECT j.*,v.manifest
            FROM jobs j JOIN plugin_versions v ON v.id=j.plugin_id AND v.version=j.plugin_version
            JOIN connections c ON c.id=j.connection_id
            WHERE j.lease_until < CASE WHEN j.original_gpu_ticket IS NOT NULL THEN date_trunc('second',now()) ELSE now() END
            AND j.state IN ('dispatching','running','finalizing')
            AND NOT c.fmworker_resource_driver AND NOT (v.manifest ? 'fmworkerResources')
            AND ${executableJob}
            AND ($1=false OR v.manifest->'originalState'->'recovery' IS NOT NULL OR (v.manifest->>'mode'='pull' AND v.manifest->'originalSubmission'->>'version'='3'))
            ORDER BY j.workspace_id,j.id FOR UPDATE OF j SKIP LOCKED`,
        [originalOnly],
      )
    ).rows;
    for (const job of stale) {
      const { manifest } = job;
      const recovery =
        manifest.originalState?.recovery ??
        (manifest.mode === "pull" && manifest.originalSubmission?.version === 3
          ? {
              maxAttempts: 2,
              retryNote: "节点租约过期，等待重新领取",
              failureNote: "节点任务多次中断",
            }
          : undefined);
      if (manifest.requestLifecycle) {
        if (
          (job.receipt || job.remote_id) &&
          !(
            manifest.requestLifecycle.version === 3 &&
            !manifest.requestLifecycle.resumeAccepted
          )
        )
          await sql.query(
            "UPDATE jobs SET state=$2,lease_token=NULL,lease_until=NULL WHERE id=$1",
            [job.id, job.receipt ? "finalizing" : "running"],
          );
        else
          await this.requestOutcome(sql, job, {
            action: "fail",
            note: manifest.requestLifecycle.notes.unknownSubmission,
            interrupted: true,
            uncertain: true,
          });
        continue;
      }
      await new JobTiming(p).end(
        sql,
        job,
        "interrupted",
        recovery ? Math.floor(Date.now() / 1000) : undefined,
      );
      if (recovery && !job.receipt) {
        requireValue(job.attempts !== null, 503, "任务执行次数尚未完成迁移");
        if (job.attempts < recovery.maxAttempts)
          await sql.query(
            "UPDATE jobs SET state='queued',lease_token=NULL,lease_until=NULL,error=$2,updated_at=now() WHERE id=$1",
            [job.id, recovery.retryNote],
          );
        else
          await p.settle(
            sql,
            job,
            "failed",
            undefined,
            recovery.failureNote,
            undefined,
            { preserveTiming: true },
          );
        continue;
      }
      const state = job.receipt
        ? "finalizing"
        : job.remote_id && manifest.mode === "request"
          ? "running"
          : "uncertain";
      await sql.query(
        "UPDATE jobs SET state=$2,lease_token=NULL,lease_until=NULL,error=$3 WHERE id=$1",
        [
          job.id,
          state,
          state === "uncertain" ? "执行连接中断，需核对上游结果" : null,
        ],
      );
    }
    // Recovery already holds job locks. A node control may hold the node lock
    // while waiting for those jobs, so leave locked nodes to that transaction.
    await sql.query(`WITH drained AS (
        SELECT n.id FROM gpu_nodes n JOIN connections c ON c.id=n.connection_id
        JOIN plugin_versions v ON v.id=c.plugin_id AND v.version=c.plugin_version
        WHERE NOT c.fmworker_resource_driver AND (v.manifest->'originalState'->'recovery' IS NOT NULL OR (v.manifest->>'mode'='pull' AND v.manifest->'originalSubmission'->>'version'='3'))
        AND NOT EXISTS (SELECT 1 FROM fmworker_resources r WHERE r.node_id=n.id)
        AND n.control='draining'
        AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.remote_id=n.id::text AND j.state IN ('dispatching','running','finalizing','uncertain') AND ${executableJob})
        FOR UPDATE OF n SKIP LOCKED
      ) UPDATE gpu_nodes n SET control='paused' FROM drained WHERE n.id=drained.id`);
  }
  async claim(id: string): Promise<Record<string, any> | undefined> {
    const attempt = await this.claimWithHealth(id);
    if (typeof attempt !== "function") return attempt;
    // Network I/O runs after the transaction released the job and connection.
    // Reacquire both locks and recheck all limits before starting the task.
    const health = await attempt();
    const retry = await this.claimWithHealth(id, health);
    return typeof retry === "function" ? undefined : retry;
  }
  private async claimWithHealth(id: string, frozenHealth?: QueueHealth) {
    const p = this.platform;
    return p.db.transaction(async (sql) => {
      const job = await one(
        sql,
        `SELECT j.* FROM jobs j WHERE j.id=$1 AND j.state IN ('queued','running','finalizing') AND j.lease_token IS NULL
        AND (j.request_retry_at IS NULL OR j.request_retry_at<=now()) AND ${executableJob} FOR UPDATE OF j`,
        [id],
      );
      if (!job) return;
      const connection = await one(
        sql,
        "SELECT * FROM connections WHERE id=$1 FOR UPDATE",
        [job.connection_id],
      );
      if (connection.fmworker_resource_driver) return;
      const plugin = await p.registry.resolve(
        sql,
        job.plugin_id,
        job.plugin_version,
      );
      if (
        plugin.retired ||
        (plugin.manifest.mode === "pull" && job.state === "queued")
      )
        return;
      const policy = plugin.manifest.requestLifecycle;
      if (
        job.state !== "queued" &&
        policy?.version === 3 &&
        !policy.resumeAccepted
      ) {
        await this.requestOutcome(sql, job, {
          action: "fail",
          note: policy.notes.unknownSubmission,
          interrupted: true,
          uncertain: true,
        });
        return;
      }
      let referenceAssets;
      if (job.state === "queued") {
        if (
          (await hasTailChainTable(sql)) &&
          (await one(
            sql,
            "SELECT 1 FROM job_tail_chains WHERE child_job_id=$1",
            [job.id],
          ))
        )
          return;
        if (!connection.enabled) return;
        if (
          policy?.version === 3 &&
          policy.requireConfigured &&
          !plugin.originalState?.configured(p.vault.open(job.config_snapshot))
        )
          return;
        if (
          plugin.manifest.requestLifecycle?.honorImageEnabled &&
          job.kind === "image" &&
          !(await one(sql, "SELECT image_enabled FROM original_state_settings"))
            .image_enabled
        )
          return;
        const model = await one(
          sql,
          `SELECT m.id FROM models m LEFT JOIN model_permissions mp ON mp.model_id=m.id AND mp.workspace_id=$2
          JOIN users u ON u.id=$3 WHERE m.id=$1 AND ($5::boolean OR ((m.catalog_id IS NOT NULL OR m.enabled) AND studio_model_allowed(COALESCE($4,m.catalog_id),$2))) AND COALESCE(mp.enabled,true) AND u.active=true`,
          [
            job.model_id,
            job.workspace_id,
            job.owner_id,
            job.catalog_id,
            !!job.package_version,
          ],
        );
        if (!model) return;
        if (
          plugin.manifest.requestLifecycle &&
          plugin.manifest.requestLifecycle.version !== 1 &&
          plugin.manifest.requestLifecycle.queueOrder === "fifo"
        ) {
          const older = await one(
            sql,
            `SELECT j.id FROM jobs j JOIN models m ON m.id=j.model_id
            JOIN users u ON u.id=j.owner_id LEFT JOIN model_permissions mp ON mp.model_id=m.id AND mp.workspace_id=j.workspace_id
            WHERE j.connection_id=$1 AND j.state='queued' AND j.public_id<$2 AND u.active
            AND COALESCE(mp.enabled,true) AND ${await queuedModelPolicy(sql)}
            AND (j.request_retry_at IS NULL OR j.request_retry_at<=now()) AND ${executableJob} LIMIT 1`,
            [connection.id, job.public_id],
          );
          if (older) return;
        }
        const count = await one(
          sql,
          `SELECT count(*) AS total FROM jobs j WHERE connection_id=$1 AND state IN ('dispatching','running','finalizing','uncertain') AND ${executableJob}`,
          [connection.id],
        );
        if (Number(count.total) >= connection.concurrency) return;
        if (plugin.requestCapacity) {
          const superseded =
            plugin.queueHealth &&
            connection.plugin_version !== job.plugin_version;
          if (superseded && !frozenHealth)
            return () =>
              this.frozenHealth.read(
                p,
                plugin,
                connection.id,
                job.config_snapshot,
              );
          const active = (
            await sql.query(
              `SELECT id,provider_model,kind,remote_id,input FROM jobs j WHERE connection_id=$1 AND state IN ('dispatching','running','finalizing','uncertain') AND ${executableJob}`,
              [connection.id],
            )
          ).rows;
          const capacity = plugin.requestCapacity({
            stamp: Date.now() / 1000,
            health: superseded
              ? frozenHealth!
              : connection.queue_health_revision === connection.revision
                ? connection.queue_health
                : {},
            jobs: active.map(
              (j) =>
                ({
                  id: j.id,
                  node: null,
                  model: j.provider_model,
                  kind: j.kind,
                  status: "running",
                  remoteId: j.remote_id,
                  input: j.input,
                }) as QueueJob,
            ),
          });
          requireValue(
            capacity === null || (Number.isInteger(capacity) && capacity >= 0),
            500,
            "插件容量无效",
          );
          if (capacity !== null && Number(count.total) >= capacity) {
            const waiting = policy?.notes.unavailable;
            if (
              superseded &&
              !frozenHealth?.ready &&
              waiting &&
              job.request_note !== waiting
            )
              await sql.query("UPDATE jobs SET request_note=$2 WHERE id=$1", [
                id,
                waiting,
              ]);
            return;
          }
        }
      }
      if (
        job.state === "queued" &&
        policy?.version === 3 &&
        policy.atomicReferences
      ) {
        referenceAssets = [];
        for (const ref of job.input.references) {
          const asset = await one(
            sql,
            "SELECT * FROM assets WHERE id=$1 AND workspace_id=$2 AND state='ready'",
            [ref, job.workspace_id],
          );
          // The original transaction rolls back the claim if reference metadata vanished.
          // Keep the authorized metadata from that same snapshot for the file read.
          if (!asset || !policy.referenceKinds.includes(asset.original_kind))
            return;
          referenceAssets.push(asset);
        }
      }
      const token = randomUUID();
      const state = job.state === "queued" ? "dispatching" : job.state;
      await sql.query(
        "UPDATE jobs SET state=$2,lease_token=$3,lease_until=now()+interval '60 seconds',updated_at=CASE WHEN $5 AND state!='queued' THEN updated_at ELSE now() END,attempts=attempts+$4,request_note=CASE WHEN $5 AND state='queued' THEN $6 ELSE request_note END,request_retry_at=NULL,error=CASE WHEN $5 THEN NULL ELSE error END WHERE id=$1",
        [
          id,
          state,
          token,
          job.state === "queued" ? 1 : 0,
          Boolean(plugin.manifest.requestLifecycle),
          plugin.manifest.requestLifecycle?.notes.submitting ?? null,
        ],
      );
      await new JobTiming(p).start(
        sql,
        { ...job, lease_token: token },
        job.state === "queued",
      );
      return {
        ...job,
        state,
        lease_token: token,
        requestLifecycle: plugin.manifest.requestLifecycle,
        referenceAssets,
      };
    });
  }
  async execution(
    job: any,
    signal: AbortSignal,
    readReferences = true,
  ): Promise<Execution> {
    const references = [];
    for (const id of readReferences ? job.input.references : []) {
      const asset =
        job.referenceAssets?.find((a: any) => a.id === id) ??
        (await one(
          this.platform.db,
          "SELECT * FROM assets WHERE id=$1 AND workspace_id=$2 AND state='ready'",
          [id, job.workspace_id],
        ));
      const lifecycle: RequestLifecycle | undefined = job.requestLifecycle;
      if (
        lifecycle &&
        lifecycle.version !== 1 &&
        (!asset || !lifecycle.referenceKinds.includes(asset.original_kind))
      )
        throw new ReferenceUnavailable();
      requireValue(asset, 400, "任务素材不可用");
      const bytes = await this.platform.storage.read(asset.object_key);
      references.push({
        id,
        mime: asset.mime,
        url: `data:${asset.mime};base64,${Buffer.from(bytes).toString("base64")}`,
      });
    }
    return {
      jobId: job.id,
      idempotencyKey: job.id,
      model: job.provider_model,
      kind: job.kind,
      input: { prompt: job.input.prompt, params: job.input.params, references },
      config: this.platform.vault.open(job.config_snapshot),
      signal,
      reportProviderNote: async (note) => {
        requireValue(
          typeof note === "string" && note.length <= 500,
          500,
          "插件任务说明无效",
        );
        await this.platform.db.transaction(async (sql) => {
          const current = await one(
            sql,
            `UPDATE jobs j SET request_note=$3,updated_at=CASE WHEN v.manifest->'requestLifecycle'->>'progressUpdatesHealth'='true' THEN now() ELSE j.updated_at END FROM plugin_versions v
          WHERE j.id=$1 AND j.lease_token=$2 AND j.lease_until>now() AND j.state IN ('dispatching','running','finalizing')
          AND v.id=j.plugin_id AND v.version=j.plugin_version AND v.manifest->'requestLifecycle' IS NOT NULL RETURNING j.*,v.manifest`,
            [job.id, job.lease_token, note],
          );
          requireValue(current, 409, "任务租约已失效");
          if (
            current.manifest.requestLifecycle.version !== 1 &&
            current.manifest.requestLifecycle.progressUpdatesHealth
          )
            await sql.query(
              `UPDATE connections SET queue_health=queue_health || jsonb_build_object('ready',true,'checked',extract(epoch FROM now())),queue_health_revision=revision,queue_refresh_token=NULL,queue_refresh_until=now()+interval '15 seconds'
            WHERE id=$1 AND config=$2 AND plugin_id=$3 AND plugin_version=$4 AND enabled`,
              [
                current.connection_id,
                current.config_snapshot,
                current.plugin_id,
                current.plugin_version,
              ],
            );
        });
      },
      reportProviderClock: async (report) =>
        this.platform.db.transaction(async (sql) => {
          const current = await one(
            sql,
            "SELECT id FROM jobs WHERE id=$1 AND lease_token=$2 AND lease_until>now() AND state IN ('dispatching','running','finalizing') FOR UPDATE",
            [job.id, job.lease_token],
          );
          requireValue(current, 409, "任务租约已失效");
          await new JobTiming(this.platform).providerClock(sql, job.id, report);
        }),
      reportTiming: async (report) =>
        this.platform.db.transaction(async (sql) => {
          const current = await one(
            sql,
            "SELECT id FROM jobs WHERE id=$1 AND lease_token=$2 AND lease_until>now() AND state IN ('dispatching','running','finalizing') FOR UPDATE",
            [job.id, job.lease_token],
          );
          requireValue(current, 409, "任务租约已失效");
          await new JobTiming(this.platform).observe(sql, job.id, report);
        }),
    };
  }
  async execute(id: string) {
    const p = this.platform;
    const job = await this.claim(id);
    if (!job) return;
    const lifecycle: RequestLifecycle | undefined = job.requestLifecycle;
    let stage: "input" | "submit" | "inspect" | "save" = "input";
    const controller = new AbortController();
    const deadlineMs =
      lifecycle?.version === 3 ? lifecycle.executionDeadlineMs : 15 * 60 * 1000;
    const deadline =
      deadlineMs === null
        ? undefined
        : setTimeout(() => controller.abort(), deadlineMs);
    const renew = setInterval(() => {
      void p.db
        .query(
          "UPDATE jobs SET lease_until=now()+interval '60 seconds' WHERE id=$1 AND lease_token=$2",
          [id, job.lease_token],
        )
        .catch(() => controller.abort());
    }, 15000);
    try {
      const plugin = await p.registry.resolve(
        p.db,
        job.plugin_id,
        job.plugin_version,
      );
      const execution =
        job.receipt && lifecycle
          ? undefined
          : await this.execution(
              job,
              controller.signal,
              !(lifecycle && job.remote_id),
            );
      if (execution && job.package_version) {
        const release = await one(
          p.db,
          "SELECT package->>'program' AS program FROM studio_package_releases WHERE id=$1 AND version=$2",
          [job.plugin_id, job.package_version],
        );
        if (release?.program) {
          const run = await loadProgram(release.program);
          const descriptor = plugin.manifest.models.find(
            (m) => m.id === execution.model,
          )?.studio?.descriptor;
          const mapped = run("request", {
            model: execution.model,
            kind: execution.kind,
            input: execution.input,
            descriptor,
            remoteId: job.remote_id,
          });
          requireValue(
            mapped &&
              typeof mapped.path === "string" &&
              /^\/(?!\/)[A-Za-z0-9/_-]+$/.test(mapped.path),
            400,
            "插件请求路径无效",
          );
          execution.mappedRequest = mapped;
          execution.mapResult = (raw) =>
            run("result", {
              raw,
              model: execution.model,
              kind: execution.kind,
              remoteId: job.remote_id,
            });
        }
      }
      let receipt: Receipt = job.receipt;
      if (!receipt) {
        if (job.remote_id) {
          stage = "inspect";
          requireValue(plugin.inspect, 503, "插件不支持查询任务");
          receipt = await plugin.inspect(execution!, job.remote_id);
        } else {
          stage = "submit";
          receipt = await plugin.submit(execution!);
        }
      }
      receipt = receiptSchema.parse(receipt);
      if (receipt.state === "pending") {
        await p.db.query(
          "UPDATE jobs SET state='running',remote_id=$3,lease_token=NULL,lease_until=NULL,updated_at=CASE WHEN $4 THEN updated_at ELSE now() END WHERE id=$1 AND lease_token=$2",
          [id, job.lease_token, receipt.remoteId, Boolean(lifecycle)],
        );
        return;
      }
      if (receipt.state === "failed") {
        await this.finish(job, "failed", undefined, receipt.error);
        return;
      }
      stage = "save";
      const saved = await p.db.transaction(async (sql) => {
        const row = await one(
          sql,
          "UPDATE jobs SET state='finalizing',receipt=$3 WHERE id=$1 AND lease_token=$2 RETURNING id",
          [id, job.lease_token, JSON.stringify(receipt)],
        );
        if (row) await new JobTiming(p).phase(sql, id, "finalizing");
        return row;
      });
      if (!saved) return;
      const result = await this.saveArtifacts(job, receipt, controller.signal);
      await this.finish(job, "completed", result);
    } catch (error) {
      if (error instanceof ArtifactValidationError) {
        if (error.status === 503)
          await p.db.query(
            "UPDATE jobs SET state='finalizing',lease_token=NULL,lease_until=NULL,error=NULL WHERE id=$1 AND lease_token=$2 AND receipt IS NOT NULL",
            [id, job.lease_token],
          );
        else await this.finish(job, "failed", undefined, error.message);
        return;
      }
      if (error instanceof ArtifactDownloadError) {
        if (error.disposition === "failed")
          await this.finish(job, "failed", undefined, error.message);
        else
          // Retain the accepted receipt and finalizing clock. A download outage
          // must neither resubmit generation nor turn its run into interrupted.
          await p.db.query(
            "UPDATE jobs SET state='finalizing',lease_token=NULL,lease_until=NULL,error=NULL WHERE id=$1 AND lease_token=$2 AND receipt IS NOT NULL",
            [id, job.lease_token],
          );
        return;
      }
      if (lifecycle) {
        const outcome: RequestDisposition =
          error instanceof RequestLifecycleError
            ? error.disposition
            : stage === "inspect"
              ? { action: "poll" }
              : {
                  action: "fail",
                  note:
                    stage === "input"
                      ? lifecycle.version !== 1 &&
                        error instanceof ReferenceUnavailable
                        ? lifecycle.notes.inputUnavailable
                        : lifecycle.notes.inputFailed
                      : stage === "save"
                        ? lifecycle.version !== 1 && job.receipt
                          ? lifecycle.notes.recoverySaveFailed
                          : lifecycle.notes.saveFailed
                        : lifecycle.version !== 1
                          ? lifecycle.notes.submitFailed
                          : lifecycle.notes.unknownSubmission,
                  interrupted: stage === "submit" && lifecycle.version === 1,
                  uncertain: stage === "submit" && lifecycle.version === 1,
                };
        let settledFailed = false;
        await p.db.transaction(async (sql) => {
          const current = await one(
            sql,
            "SELECT * FROM jobs WHERE id=$1 AND lease_token=$2 FOR UPDATE",
            [id, job.lease_token],
          );
          if (current) {
            settledFailed = await this.requestOutcome(sql, current, outcome);
          }
        });
        if (settledFailed) {
          await wakeTailFrameChildren(
            p,
            {
              id: String(job.id),
              workspace_id: String(job.workspace_id),
              owner_id: String(job.owner_id),
              kind: String(job.kind),
            },
            "failed",
            undefined,
            AbortSignal.timeout(30_000),
          ).catch(() => {});
        }
        return;
      }
      if (
        error instanceof ProviderError &&
        error.certainty === "rejected" &&
        !job.remote_id &&
        !job.receipt
      ) {
        const recovered = await p.db.transaction(async (sql) => {
          const current = await one(
            sql,
            "SELECT * FROM jobs WHERE id=$1 AND lease_token=$2 FOR UPDATE",
            [id, job.lease_token],
          );
          if (!current) return false;
          if (await this.tryAudioFallbackToEdgeTts(sql, current, error.message)) {
            return true;
          }
          if (isModerationRejectionMessage(error.message)) {
            const modOutcome: RequestDisposition = {
              action: "fail",
              reason: "moderation_blocked",
              certainty: "rejected",
              billable: false,
              note: error.message,
            };
            if (await tryModerationRewrite(sql, current as any, modOutcome)) {
              await new JobTiming(p).end(sql, current, "interrupted");
              return true;
            }
            let preferredFallback: string | undefined;
            try {
              const cfg = p.vault.open(current.config_snapshot) as Record<string, unknown>;
              if (typeof cfg?.fallbackModel === "string") preferredFallback = cfg.fallbackModel;
            } catch {}
            if (
              await tryModerationEquivalentFallback(
                sql,
                current as any,
                modOutcome,
                preferredFallback,
              )
            ) {
              await new JobTiming(p).end(sql, current, "interrupted");
              return true;
            }
          }
          return false;
        });
        if (!recovered) await this.finish(job, "failed", undefined, error.message);
      } else
        await p.db.transaction(async (sql) => {
          const current = await one(
            sql,
            "SELECT * FROM jobs WHERE id=$1 AND lease_token=$2 FOR UPDATE",
            [id, job.lease_token],
          );
          if (!current) return;
          // Never auto-fallback paid commercial providers on ambiguous/generic errors:
          // lack of remote_id/receipt does not prove the upstream did not accept or bill.
          await new JobTiming(p).end(sql, current, "interrupted");
          await sql.query(
            `UPDATE jobs SET state=CASE WHEN receipt IS NOT NULL THEN 'finalizing' WHEN remote_id IS NOT NULL THEN 'running' ELSE 'uncertain' END,
        error=$3,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2`,
            [id, job.lease_token, "执行未完成，等待恢复或核对"],
          );
        });
    } finally {
      clearInterval(renew);
      clearTimeout(deadline);
    }
  }
  /**
   * F029 + Q3: Real runtime audio failure fallback to free built-in Edge TTS.
   * Only fires before upstream acceptance/artifacts (`!remote_id && !receipt`),
   * releases any commercial credit hold atomically (zero double charge), and
   * switches the job to enabled `edge-tts` at 0 credits.
   */
  private async tryAudioFallbackToEdgeTts(
    sql: Sql,
    job: any,
    reason: string,
  ): Promise<boolean> {
    if (
      job.kind !== "audio" ||
      job.provider_model === "edge-tts" ||
      job.plugin_id === "bgm-generator" ||
      ["bgm-v1", "suno-v4", "udio-v1.5", "musicgen-large"].includes(
        String(job.provider_model || ""),
      ) ||
      job.remote_id ||
      job.receipt
    ) {
      return false;
    }
    const existingParams = (job.input?.params ?? {}) as Record<string, unknown>;
    if (existingParams._fallback_from) return false;

    const hasPackages = await hasStudioPackages(sql);
    const allowed = await one(
      sql,
      `SELECT ${hasPackages ? "studio_plugin_accepts('edge-tts') AND " : ""}studio_model_allowed('edge-tts', $1) AS ok`,
      [job.workspace_id],
    );
    if (!allowed?.ok) return false;

    const edgeModel = await one(
      sql,
      `SELECT m.id, m.connection_id, c.plugin_id, c.plugin_version, c.config
         FROM models m
         JOIN connections c ON c.id = m.connection_id
        WHERE m.catalog_id = 'edge-tts'
          AND c.plugin_id = 'edge-tts'
          AND c.enabled = TRUE
          AND NOT c.removed
          AND m.enabled
          ${hasPackages ? "AND studio_service_selected(m.catalog_id, c.id)" : ""}
        ORDER BY c.id ASC
        LIMIT 1`,
    );
    if (!edgeModel) return false;

    // Release commercial credit hold atomically before switching to 0-credit Edge TTS
    const originalPrice = Number(job.price ?? 0);
    if (originalPrice > 0) {
      const released = await one(
        sql,
        "UPDATE wallets SET held = held - $2 WHERE workspace_id = $1 AND held >= $2 RETURNING balance, held",
        [job.workspace_id, originalPrice],
      );
      if (!released) return false;
      await sql.query(
        `INSERT INTO ledger(id, workspace_id, job_id, key, action, amount, actor_id, balance_snapshot, held_snapshot, note)
         VALUES ($1, $2, $3, $4, 'refund', $5, $6, $7, $8, $9)
         ON CONFLICT (key) DO NOTHING`,
        [
          randomUUID(),
          job.workspace_id,
          job.id,
          `refund-fallback:${job.id}`,
          originalPrice,
          job.owner_id,
          released.balance,
          released.held,
          `语音引擎 ${job.provider_model} 失败，自动切换免费 Edge TTS 退回冻结`,
        ],
      );
    }

    const nextInput = {
      ...(job.input ?? {}),
      modelId: edgeModel.id,
      params: {
        ...existingParams,
        _fallback_from: String(job.provider_model),
      },
    };
    const note = `语音引擎 ${job.provider_model} 不可用（${reason.slice(0, 80)}），已自动切换免费 Edge TTS 兜底`;
    await new JobTiming(this.platform).end(sql, job, "interrupted");
    await sql.query(
      `UPDATE jobs
          SET model_id = $2,
              connection_id = $3,
              plugin_id = $4,
              plugin_version = $5,
              config_snapshot = $6,
              provider_model = 'edge-tts',
              catalog_id = 'edge-tts',
              price = 0,
              price_key = 'edge-tts|free',
              input = $7::jsonb,
              state = 'queued',
              error = NULL,
              request_note = $8,
              request_retry_at = NULL,
              lease_token = NULL,
              lease_until = NULL,
              updated_at = now()
        WHERE id = $1`,
      [
        job.id,
        edgeModel.id,
        edgeModel.connection_id,
        edgeModel.plugin_id,
        edgeModel.plugin_version,
        edgeModel.config,
        JSON.stringify(nextInput),
        note,
      ],
    );
    await sql.query(
      "INSERT INTO job_events(job_id, state, detail) VALUES ($1, 'queued', $2::jsonb)",
      [job.id, JSON.stringify({ fallback: "edge-tts", from: job.provider_model })],
    );
    await sql.query(
      `INSERT INTO outbox(job_id, available_at, sent_at)
       VALUES ($1, now(), NULL)
       ON CONFLICT (job_id) DO UPDATE SET available_at = now(), sent_at = NULL`,
      [job.id],
    );
    return true;
  }
  private async requestOutcome(
    sql: Sql,
    job: any,
    value: RequestDisposition,
  ): Promise<boolean> {
    const outcome = requestDispositionSchema.parse(value),
      timing = new JobTiming(this.platform);
    if (outcome.action === "poll") {
      requireValue(job.remote_id && !job.receipt, 500, "插件轮询状态无效");
      await sql.query(
        "UPDATE jobs SET state='running',lease_token=NULL,lease_until=NULL WHERE id=$1",
        [job.id],
      );
      return false;
    } else if (outcome.action === "retry") {
      requireValue(
        !job.remote_id && !job.receipt,
        500,
        "已接受任务不能重新提交",
      );
      await timing.end(sql, job, "interrupted");
      await sql.query(
        "UPDATE jobs SET state='queued',request_note=$2,request_retry_at=now()+($3*interval '1 second'),error=NULL,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1",
        [job.id, outcome.note, outcome.delaySeconds],
      );
      return false;
    } else {
      // F029: Non-billable audio failure automatically falls back to enabled free Edge TTS
      if (
        job.kind === "audio" &&
        !outcome.uncertain &&
        !outcome.interrupted &&
        !job.remote_id &&
        !job.receipt &&
        (await this.tryAudioFallbackToEdgeTts(sql, job, outcome.note || "上游语音失败"))
      ) {
        return false;
      }
      // F024: Moderation-blocked rejected/non-billable jobs may neutralize & retry
      // reusing the exact same hold:<job.id> reservation (zero double-billing),
      // and fall back to an equivalent model once rewrites are exhausted.
      const effectiveOutcome: RequestDisposition =
        outcome.reason !== "moderation_blocked" &&
        !outcome.uncertain &&
        !outcome.interrupted &&
        outcome.certainty === "rejected" &&
        outcome.billable === false &&
        isModerationRejectionMessage(outcome.note)
          ? { ...outcome, reason: "moderation_blocked" }
          : outcome;
      if (await tryModerationRewrite(sql, job, effectiveOutcome)) {
        await timing.end(sql, job, "interrupted");
        return false;
      }
      let preferredFallback: string | undefined;
      try {
        const cfg = this.platform.vault.open(job.config_snapshot) as Record<string, unknown>;
        if (typeof cfg?.fallbackModel === "string") preferredFallback = cfg.fallbackModel;
      } catch {}
      if (
        await tryModerationEquivalentFallback(
          sql,
          job,
          effectiveOutcome,
          preferredFallback,
        )
      ) {
        await timing.end(sql, job, "interrupted");
        return false;
      }
      if (outcome.interrupted) await timing.end(sql, job, "interrupted");
      if (outcome.uncertain)
        await sql.query("UPDATE jobs SET request_uncertain=true WHERE id=$1", [
          job.id,
        ]);
      await this.platform.settle(
        sql,
        job,
        "failed",
        undefined,
        outcome.note,
        undefined,
        { preserveTiming: !!outcome.interrupted },
      );
      return true;
    }
  }
  async saveArtifacts(
    job: any,
    receipt: Extract<Receipt, { state: "completed" }>,
    signal: AbortSignal,
  ) {
    const p = this.platform;
    const version = await one(
      p.db,
      "SELECT manifest FROM plugin_versions WHERE id=$1 AND version=$2",
      [job.plugin_id, job.plugin_version],
    );
    const outputPolicy = version?.manifest.originalState;
    const remoteStudio =
      job.original_uid &&
      (version?.manifest.originalSubmission?.version ?? 0) >= 2;
    const lifecycle: RequestLifecycle | undefined =
      version?.manifest.requestLifecycle;
    const atomic = lifecycle?.version === 3 && !lifecycle.resumeAccepted;
    const result = (assets: string[]) => ({
      assets,
      text: receipt.text || null,
      usage: receipt.usage || {},
      ...(receipt.providerResponse
        ? { providerResponse: receipt.providerResponse }
        : {}),
    });
    // Synchronous, non-resumable providers must commit their single output and
    // settlement together. A crash cannot leave a visible image on a failed job.
    if (atomic)
      requireValue(receipt.artifacts.length === 1, 500, "单次结果契约无效");
    requireValue(
      Array.isArray(receipt.artifacts) && receipt.artifacts.length <= 8,
      400,
      "插件产物数量无效",
    );
    requireValue(
      receipt.text === undefined ||
        (typeof receipt.text === "string" && receipt.text.length <= 1000000),
      400,
      "文本结果过长",
    );
    if (job.kind !== "chat")
      requireValue(receipt.artifacts.length, 400, "生成结果缺少媒体");
    const ids: string[] = [];
    for (let index = 0; index < receipt.artifacts.length; index++) {
      const item = receipt.artifacts[index];
      const old = await one(
        p.db,
        `SELECT a.id FROM assets a JOIN job_assets ja ON ja.asset_id=a.id WHERE ja.job_id=$1 AND ja.role='output' AND a.metadata->>'outputIndex'=$2`,
        [job.id, String(index)],
      );
      if (old) {
        ids.push(old.id);
        continue;
      }
      let bytes: Buffer;
      if (item.url.startsWith("data:")) {
        requireValue(
          /^data:(image\/(png|jpeg|webp)|video\/mp4|audio\/(wav|mpeg));base64,[a-zA-Z0-9+/=]+$/.test(
            item.url,
          ),
          400,
          "插件内联媒体无效",
        );
        bytes = Buffer.from(item.url.split(",")[1], "base64");
        requireValue(
          bytes.length <= (job.kind === "image" ? 32 : 128) * 1024 * 1024,
          413,
          "图片过大",
        );
      } else if (version?.manifest.artifactDownload) {
        const plugin = await p.registry.resolve(
          p.db,
          job.plugin_id,
          job.plugin_version,
        );
        requireValue(plugin.downloadArtifact, 503, "产物下载适配器不可用");
        bytes = Buffer.from(
          await plugin.downloadArtifact(
            {
              url: item.url,
              config: p.vault.open(job.config_snapshot),
              recovering: Boolean(job.receipt),
            },
            signal,
          ),
        );
      } else {
        const config = p.vault.open(job.config_snapshot);
        const url = new URL(item.url);
        const origin = config.baseUrl ? new URL(config.baseUrl).origin : "";
        const allowedGoogle =
          job.plugin_id === "flow" &&
          url.protocol === "https:" &&
          ["storage.googleapis.com", "lh3.googleusercontent.com"].includes(
            url.hostname,
          );
        const allowedConfigured =
          url.protocol === "https:" &&
          Array.isArray(config.artifactOrigins) &&
          config.artifactOrigins.includes(url.origin);
        requireValue(
          url.origin === origin || allowedGoogle || allowedConfigured,
          400,
          "插件返回的媒体地址超出配置范围",
        );
        const response = await fetch(url, { signal, redirect: "error" });
        requireValue(response.ok && response.body, 502, "产物下载失败");
        const chunks: Uint8Array[] = [];
        let size = 0;
        for await (const chunk of response.body as any) {
          size += chunk.length;
          requireValue(size <= 128 * 1024 * 1024, 413, "产物超过大小限制");
          chunks.push(chunk);
        }
        bytes = Buffer.concat(chunks);
      }
      let metadata: Record<string, any> & { mime: string };
      const validation = version?.manifest.artifactValidation;
      if (validation?.version === 3) {
        metadata = await inspectProviderOutput(
          validation,
          bytes,
          job.kind,
          Boolean(job.receipt),
          signal,
        );
      } else if (validation?.version === 2) {
        const plugin = await p.registry.resolve(
          p.db,
          job.plugin_id,
          job.plugin_version,
        );
        requireValue(plugin.validateArtifact, 503, "成片验收适配器不可用");
        const verified = await plugin.validateArtifact(
          {
            model: job.provider_model,
            kind: job.kind,
            params: job.input.params,
            references: job.input.references,
            recovering: Boolean(job.receipt),
          },
          bytes,
          {},
          signal,
          async () => {},
        );
        metadata = verified.metadata;
      } else
        metadata = await inspectMedia(bytes, job.kind, Boolean(outputPolicy));
      metadata.outputIndex = index;
      await artifactCapacity(p.db, p.storage, job.id, bytes.length);
      const id = randomUUID(),
        key = `${job.id}-${index}-${id}`;
      try {
        await p.storage.put(key, bytes, metadata.mime);
        const saved = await p.db.transaction(async (sql) => {
          const current = await one(
            sql,
            "SELECT * FROM jobs WHERE id=$1 AND lease_token=$2 FOR UPDATE",
            [job.id, job.lease_token],
          );
          requireValue(current, 409, "任务租约已过期");
          // A second delivery may have passed the initial read before the first
          // committed. Recheck under the lease lock and discard only our own object.
          const existing = await one(
            sql,
            `SELECT a.id FROM assets a JOIN job_assets r ON r.asset_id=a.id
          WHERE r.job_id=$1 AND r.role='output' AND a.metadata->>'outputIndex'=$2`,
            [job.id, String(index)],
          );
          if (existing) return existing.id as string;
          await sql.query(
            "INSERT INTO assets(id,workspace_id,owner_id,object_key,mime,size,state,metadata,original_kind) VALUES($1,$2,$3,$4,$5,$6,'ready',$7,$8)",
            [
              id,
              job.workspace_id,
              job.owner_id,
              key,
              metadata.mime,
              bytes.length,
              JSON.stringify(metadata),
              outputPolicy?.outputKinds?.[job.kind] ||
                (remoteStudio && job.kind === "image"
                  ? "ref"
                  : metadata.mime.split("/")[0]),
            ],
          );
          await sql.query(
            "INSERT INTO job_assets(job_id,asset_id,role) VALUES($1,$2,'output')",
            [job.id, id],
          );
          await ensureDerivativeQueued(sql, id, metadata.mime);
          if (atomic) {
            const finalRes = result([id]);
            await p.settle(sql, current, "completed", finalRes);
            await recordCompletedJobCost(sql, p, current as any, finalRes);
          }
          return id;
        });
        if (saved !== id) await p.storage.remove(key);
        ids.push(saved);
      } catch (error) {
        await p.storage.remove(key);
        throw error;
      }
    }
    return result(ids);
  }
  async finish(
    job: any,
    state: "completed" | "failed" | "cancelled",
    result?: unknown,
    error?: string,
  ) {
    await this.platform.db.transaction(async (sql) => {
      const current = await one(
        sql,
        "SELECT * FROM jobs WHERE id=$1 AND lease_token=$2 FOR UPDATE",
        [job.id, job.lease_token],
      );
      if (current) {
        await this.platform.settle(sql, current, state, result, error);
        if (state === "completed") {
          await recordCompletedJobCost(sql, this.platform, current as any, result);
        }
      }
    });
    const firstAsset =
      result &&
      typeof result === "object" &&
      Array.isArray((result as { assets?: unknown }).assets)
        ? String((result as { assets: unknown[] }).assets[0] ?? "")
        : undefined;
    await wakeTailFrameChildren(
      this.platform,
      job,
      state,
      firstAsset || undefined,
      AbortSignal.timeout(45_000),
    ).catch(() => {});
  }
}
