import {
  pairedPluginAvailable,
  queuedModelPolicy,
} from "./studio-plugin-profile.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Platform, type Actor, uuid } from "./platform.js";
import { one, type Sql } from "./db.js";
import { hash, secret, requireValue, DomainError } from "./security.js";
import {
  ArtifactValidationError,
  type ArtifactJob,
  type ArtifactReceipt,
} from "@fumiao/plugin-sdk/preparation.js";
import { inspectMedia } from "./media.js";
import { artifactCapacity } from "./capacity.js";
import { JobTiming } from "./timing.js";
import {
  nodeTimingContextSchema,
  timingReportSchema,
  type TimingReport,
} from "@fumiao/plugin-sdk/timing.js";
import {
  nodeQueueStateSchema,
  type QueueJob,
} from "@fumiao/plugin-sdk/queue.js";
import { executableJob } from "./retired-jobs.js";
class Delivered extends Error {
  constructor(readonly result: any) {
    super("Already delivered");
  }
}
export class GpuGateway {
  constructor(private p: Platform) {}
  async pair(user: Actor, value: unknown) {
    this.p.admin(user);
    const input = z.object({ connectionId: uuid }).parse(value);
    const c = await one(
      this.p.db,
      "SELECT c.id FROM connections c JOIN plugin_versions v ON v.id=c.plugin_id AND v.version=c.plugin_version WHERE c.id=$1 AND NOT c.fmworker_resource_driver AND v.manifest->>'mode'='pull' AND coalesce(v.manifest->'originalSubmission'->>'version','') NOT IN ('3','4')",
      [input.connectionId],
    );
    requireValue(c, 404, "GPU 连接不存在");
    const { code } = await this.createPairing(this.p.db, user.id, c.id);
    return { code };
  }
  async createPairing(
    sql: Sql,
    owner: string,
    connection: string,
    original?: { label: string; models: string[] },
  ) {
    const code = secret();
    const row = await one(
      sql,
      "INSERT INTO gpu_pairings(token,connection_id,expires_at,owner_id,label,models) VALUES($1,$2,CASE WHEN $5::text IS NULL THEN now() ELSE date_trunc('second',clock_timestamp()) END+interval '30 minutes',$3,$5,$4) RETURNING floor(extract(epoch FROM expires_at)) AS expires",
      [
        hash(code),
        connection,
        owner,
        original ? JSON.stringify(original.models) : null,
        original?.label ?? null,
      ],
    );
    return { code, expires: Number(row.expires) };
  }
  async addNode(
    sql: Sql,
    connection: string,
    owner: string | null,
    name: string,
    models: string[],
    tokenHash: string,
  ) {
    const id = randomUUID();
    await sql.query(
      "INSERT INTO gpu_nodes(id,connection_id,name,token_hash,models,owner_id) VALUES($1,$2,$3,$4,$5,$6)",
      [id, connection, name, tokenHash, JSON.stringify(models), owner],
    );
    return id;
  }
  async enroll(value: unknown) {
    requireValue(
      await pairedPluginAvailable(this.p.db),
      404,
      "尚未安装实例接入插件",
    );
    const input = z
      .object({
        code: z.string().min(1),
        name: z.string().min(1).max(80),
        models: z.array(z.string()).min(1).max(20),
      })
      .parse(value);
    return this.p.db.transaction(async (sql) => {
      const pair = await one(
        sql,
        "SELECT * FROM gpu_pairings WHERE token=$1 AND expires_at>now() AND claimed=false AND label IS NULL FOR UPDATE",
        [hash(input.code)],
      );
      requireValue(pair, 403, "接入码无效");
      const connection = await one(
        sql,
        "SELECT plugin_id,plugin_version FROM connections WHERE id=$1 FOR SHARE",
        [pair.connection_id],
      );
      const plugin = await this.p.registry.resolve(
        sql,
        connection.plugin_id,
        connection.plugin_version,
      );
      requireValue(
        !plugin.retired &&
          plugin.manifest.mode === "pull" &&
          ![3, 4].includes(plugin.manifest.originalSubmission?.version ?? 0),
        409,
        "连接已不再支持节点领取",
      );
      requireValue(
        input.models.every((id) =>
          plugin.manifest.models.some((m) => m.id === id),
        ),
        400,
        "节点模型无效",
      );
      const token = secret();
      const id = await this.addNode(
        sql,
        pair.connection_id,
        pair.owner_id,
        input.name,
        input.models,
        hash(token),
      );
      await sql.query("UPDATE gpu_pairings SET claimed=true WHERE token=$1", [
        hash(input.code),
      ]);
      return { id, token };
    });
  }
  async node(token: string, sql: Sql = this.p.db, lock = false) {
    const n = await one(
      sql,
      "SELECT n.* FROM gpu_nodes n JOIN connections c ON c.id=n.connection_id WHERE n.token_hash=$1 AND n.enabled AND NOT n.archived AND NOT c.fmworker_resource_driver AND NOT EXISTS (SELECT 1 FROM gpu_pairings p WHERE p.claimed_node_id=n.id) AND NOT EXISTS (SELECT 1 FROM fmworker_resources r WHERE r.node_id=n.id)" +
        (lock ? " FOR UPDATE OF n" : ""),
      [hash(token)],
    );
    requireValue(n, 401, "节点凭据失效");
    return n;
  }
  async heartbeat(token: string, value: unknown) {
    const input = z
      .object({
        jobId: uuid.optional(),
        lease: uuid.optional(),
        context: nodeTimingContextSchema.optional(),
        report: timingReportSchema.optional(),
        queue: nodeQueueStateSchema.optional(),
        detail: z.string().max(300).optional(),
      })
      .refine(
        (v) =>
          Boolean(v.jobId) === Boolean(v.lease) &&
          (!v.report || Boolean(v.jobId)),
        "任务进度必须携带完整租约",
      )
      .parse(value);
    return this.p.db.transaction(async (sql) => {
      // Node controls and claims acquire the same row before touching its jobs.
      const node = await this.node(token, sql, true);
      requireValue(
        !input.context?.model_profiles ||
          Object.keys(input.context.model_profiles).every((m) =>
            node.models.includes(m),
          ),
        400,
        "节点模型无效",
      );
      requireValue(
        !input.queue ||
          input.queue.ready_models.every((m) => node.models.includes(m)),
        400,
        "节点模型无效",
      );
      if (input.jobId && input.lease) {
        const job = await one(
          sql,
          `UPDATE jobs j SET lease_until=now()+interval '180 seconds' WHERE id=$1 AND lease_token=$2 AND remote_id=$3 AND state='running' AND lease_until>now() AND ${executableJob} RETURNING cancel_requested`,
          [input.jobId, input.lease, node.id],
        );
        requireValue(job, 409, "任务租约已失效");
        if (input.report)
          await new JobTiming(this.p).observe(sql, input.jobId, input.report);
        await sql.query(
          "UPDATE gpu_nodes SET last_seen=now(),timing_context=COALESCE($2::jsonb,timing_context),queue_state=COALESCE($3::jsonb,queue_state),detail=COALESCE($4,detail) WHERE id=$1",
          [
            node.id,
            input.context ? JSON.stringify(input.context) : null,
            input.queue ? JSON.stringify(input.queue) : null,
            input.detail ?? null,
          ],
        );
        return { cancelRequested: job.cancel_requested };
      }
      await sql.query(
        "UPDATE gpu_nodes SET last_seen=now(),timing_context=COALESCE($2::jsonb,timing_context),queue_state=COALESCE($3::jsonb,queue_state),detail=COALESCE($4,detail) WHERE id=$1",
        [
          node.id,
          input.context ? JSON.stringify(input.context) : null,
          input.queue ? JSON.stringify(input.queue) : null,
          input.detail ?? null,
        ],
      );
      return { ok: true };
    });
  }
  async claim(token: string) {
    const node = await this.node(token);
    return this.p.db.transaction(async (sql) => {
      const connection = await one(
        sql,
        "SELECT concurrency FROM connections WHERE id=$1 FOR UPDATE",
        [node.connection_id],
      );
      const currentNode = await this.node(token, sql, true);
      if (currentNode.control !== "active") return { job: null };
      const count = await one(
        sql,
        `SELECT count(*) AS n FROM jobs j WHERE connection_id=$1 AND state IN ('running','uncertain','finalizing') AND ${executableJob}`,
        [node.connection_id],
      );
      if (Number(count.n) >= connection.concurrency) return { job: null };
      const held = await one(
        sql,
        `SELECT id FROM jobs j WHERE remote_id=$1 AND state IN ('dispatching','running','finalizing','uncertain') AND ${executableJob}`,
        [node.id],
      );
      if (held) return { job: null };
      const candidates = `SELECT j.* FROM jobs j JOIN connections c ON c.id=j.connection_id JOIN models m ON m.id=j.model_id JOIN users u ON u.id=j.owner_id
        LEFT JOIN model_permissions mp ON mp.model_id=m.id AND mp.workspace_id=j.workspace_id WHERE j.connection_id=$1 AND j.state='queued' AND c.enabled=true AND ${await queuedModelPolicy(sql)} AND COALESCE(mp.enabled,true) AND u.active=true
        AND NOT EXISTS (SELECT 1 FROM plugin_versions v WHERE (v.id,v.version)=(j.plugin_id,j.plugin_version) AND v.manifest->'originalSubmission'->>'version' IN ('3','4')) AND j.provider_model=ANY($2::text[]) AND ${executableJob}`;
      // Scan FIFO without locking ineligible jobs. A plugin may reject the first
      // hundred jobs while accepting a later model; never starve that model.
      let job: any,
        cursor = 0;
      const queueNode = {
        ...currentNode.timing_context,
        ...currentNode.queue_state,
        id: node.id,
        stage: currentNode.queue_state.stage ?? "preparing",
        control: currentNode.control,
        lastseen: new Date(currentNode.last_seen).getTime() / 1000,
        ready_models: currentNode.queue_state.ready_models ?? [],
      };
      for (;;) {
        const batch = (
          await sql.query(
            candidates + " AND j.public_id>$3 ORDER BY j.public_id LIMIT 100",
            [node.connection_id, currentNode.models, cursor],
          )
        ).rows;
        if (!batch.length) break;
        for (const candidate of batch) {
          cursor = Number(candidate.public_id);
          const plugin = await this.p.registry.resolve(
            sql,
            candidate.plugin_id,
            candidate.plugin_version,
          );
          if (plugin.retired) continue;
          const input: QueueJob = {
            id: candidate.id,
            node: null,
            model: candidate.provider_model,
            kind: candidate.kind,
            status: "queued",
            input: {
              ...candidate.input,
              references: candidate.input.references.map((id: string) => ({
                id,
                width: 0,
                height: 0,
              })),
            },
          };
          if (
            plugin.claimEligible &&
            !plugin.claimEligible(queueNode, input, Date.now() / 1000)
          )
            continue;
          job = await one(
            sql,
            candidates + " AND j.id=$3 FOR UPDATE OF j SKIP LOCKED",
            [node.connection_id, currentNode.models, candidate.id],
          );
          if (job) break;
        }
        if (job) break;
      }
      if (!job) return { job: null };
      const lease = randomUUID();
      const originalState = (
        await this.p.registry.resolve(sql, job.plugin_id, job.plugin_version)
      ).manifest.originalState;
      await sql.query(
        "UPDATE jobs SET state='running',lease_token=$2,lease_until=now()+interval '180 seconds',remote_id=$3,original_gpu_ticket=NULL,attempts=attempts+1,updated_at=now(),error=CASE WHEN $4 THEN NULL ELSE error END WHERE id=$1",
        [job.id, lease, node.id, Boolean(originalState)],
      );
      await new JobTiming(this.p).start(
        sql,
        { ...job, lease_token: lease },
        true,
        { ...currentNode.timing_context, id: node.id },
      );
      return {
        job: {
          id: job.id,
          lease,
          model: job.provider_model,
          pluginId: job.plugin_id,
          pluginVersion: job.plugin_version,
          kind: job.kind,
          ...job.input,
        },
      };
    });
  }
  async fail(token: string, id: string, value: unknown) {
    const node = await this.node(token);
    uuid.parse(id);
    const input = z
      .object({
        lease: uuid,
        cancelled: z.boolean().default(false),
        error: z.string().max(300).default("GPU 执行失败"),
      })
      .parse(value);
    return this.p.db.transaction(async (sql) => {
      const job = await one(
        sql,
        `SELECT j.* FROM jobs j WHERE id=$1 AND ${executableJob} FOR UPDATE OF j`,
        [id],
      );
      requireValue(
        job &&
          job.remote_id === node.id &&
          job.lease_token === input.lease &&
          job.state === "running" &&
          new Date(job.lease_until).getTime() > Date.now(),
        409,
        "任务租约已失效",
      );
      requireValue(
        !input.cancelled || job.cancel_requested,
        409,
        "任务未申请取消",
      );
      await this.p.settle(
        sql,
        job,
        input.cancelled ? "cancelled" : "failed",
        undefined,
        input.error,
      );
      return { ok: true };
    });
  }
  async input(token: string, id: string, lease: string, assetId: string) {
    const node = await this.node(token);
    uuid.parse(id);
    uuid.parse(assetId);
    uuid.parse(lease);
    const job = await one(
      this.p.db,
      `SELECT j.* FROM jobs j WHERE id=$1 AND remote_id=$2 AND lease_token=$3 AND state='running' AND lease_until>now() AND ${executableJob}`,
      [id, node.id, lease],
    );
    requireValue(
      job && job.input.references.includes(assetId),
      403,
      "任务素材不可访问",
    );
    const asset = await one(
      this.p.db,
      "SELECT * FROM assets WHERE id=$1 AND workspace_id=$2",
      [assetId, job.workspace_id],
    );
    requireValue(asset, 404, "素材不存在");
    return {
      bytes: await this.p.storage.read(asset.object_key),
      mime: asset.mime,
    };
  }
  async complete(
    token: string,
    id: string,
    lease: string,
    data: Buffer,
    receipt: ArtifactReceipt = {},
  ) {
    const node = await this.node(token);
    uuid.parse(id);
    uuid.parse(lease);
    return this.deliver(
      lease,
      async (sql, initial) => {
        const job = await one(
          sql,
          `SELECT j.* FROM jobs j WHERE id=$1 AND remote_id=$2 AND ${executableJob} FOR UPDATE OF j`,
          [id, node.id],
        );
        if (initial) requireValue(job, 404, "任务不存在");
        if (job?.state === "completed" && job.result?.lease === lease)
          return job;
        requireValue(
          job?.state === "running" &&
            job.lease_token === lease &&
            new Date(job.lease_until).getTime() > Date.now(),
          409,
          "任务租约失效",
        );
        return job;
      },
      async () => data,
      receipt,
    );
  }

  /** Both wire protocols share immutable artifact validation and atomic spend.
   * The caller fences each phase and the final commit using its own assignment. */
  async deliver(
    lease: string | undefined,
    assignment: (sql: Sql, initial?: boolean) => Promise<Record<string, any>>,
    load: () => Promise<Buffer>,
    receipt: ArtifactReceipt,
    options: {
      verify?: (
        job: Record<string, any>,
        bytes: Buffer,
      ) => Promise<{
        metadata: Record<string, any> & { mime: string };
        timing?: TimingReport["timing"];
      }>;
      params?: (job: Record<string, any>) => Record<string, any>;
      preflight?: (
        id: string,
        job: ArtifactJob,
        receipt: ArtifactReceipt,
        sql: Sql,
        version: string,
      ) => Promise<void> | void;
      settled?: (sql: Sql, job: Record<string, any>) => Promise<void>;
    } = {},
  ) {
    const artifactJob = (job: Record<string, any>): ArtifactJob => ({
      model: job.provider_model,
      kind: job.kind,
      params: options.params?.(job) ?? job.input.params,
      references: job.input.references,
    });
    const initial = await this.p.db.transaction<Record<string, any>>(
      async (sql) => {
        const job = await assignment(sql, true);
        if (job.state === "completed")
          return { ...job, validateArtifact: false };
        const version = await one(
          sql,
          "SELECT manifest FROM plugin_versions WHERE id=$1 AND version=$2",
          [job.plugin_id, job.plugin_version],
        );
        const validateArtifact = !!version?.manifest.artifactValidation;
        if (options.preflight) {
          try {
            await options.preflight(
              job.plugin_id,
              artifactJob(job),
              receipt,
              sql,
              job.plugin_version,
            );
          } catch (error) {
            if (error instanceof ArtifactValidationError)
              throw new DomainError(error.status, error.message);
            throw error;
          }
          await new JobTiming(this.p).phase(sql, job.id, "uploading");
        } else if (!validateArtifact)
          await new JobTiming(this.p).phase(sql, job.id, "validating");
        return { ...job, validateArtifact };
      },
    );
    if (initial.state === "completed") return initial.result;
    const id = initial.id;
    const data = await load();
    let metadata: Record<string, any> & { mime: string },
      completionTiming: TimingReport["timing"];
    if (options.verify) {
      const verified = await options.verify(initial, data);
      metadata = verified.metadata;
      completionTiming = verified.timing;
    } else if (initial.validateArtifact) {
      const plugin = await this.p.registry.resolve(
        this.p.db,
        initial.plugin_id,
        initial.plugin_version,
      );
      requireValue(plugin.validateArtifact, 503, "成片验收适配器不可用");
      try {
        const verified = await plugin.validateArtifact(
          artifactJob(initial),
          data,
          receipt,
          AbortSignal.timeout(110000),
          (phase) =>
            this.p.db.transaction(async (sql) => {
              const current = await assignment(sql);
              if (current.state === "completed")
                throw new Delivered(current.result);
              await new JobTiming(this.p).phase(sql, id, phase);
            }),
        );
        metadata = verified.metadata;
        if (verified.timing)
          completionTiming = timingReportSchema.parse({
            timing: verified.timing,
          }).timing;
      } catch (error) {
        if (error instanceof Delivered) return error.result;
        if (error instanceof ArtifactValidationError)
          throw new DomainError(error.status, error.message);
        throw error;
      }
      requireValue(
        typeof metadata.mime === "string" &&
          metadata.mime.startsWith(initial.kind + "/"),
        500,
        "插件成片验收结果无效",
      );
    } else metadata = await inspectMedia(data, initial.kind);
    try {
      await artifactCapacity(this.p.db, this.p.storage, id, data.length);
    } catch (error) {
      const job = await this.p.db.transaction(assignment);
      if (job.state === "completed") return job.result;
      throw error;
    }
    const aid = randomUUID(),
      key = id + "-gpu-" + aid;
    let result;
    try {
      await this.p.storage.put(key, data, metadata.mime);
      result = await this.p.db.transaction(async (sql) => {
        const job = await assignment(sql);
        if (job.state === "completed") return job.result;
        await sql.query(
          "INSERT INTO assets(id,workspace_id,owner_id,object_key,mime,size,state,metadata,original_kind) VALUES($1,$2,$3,$4,$5,$6,'ready',$7,$8)",
          [
            aid,
            job.workspace_id,
            job.owner_id,
            key,
            metadata.mime,
            data.length,
            JSON.stringify(metadata),
            metadata.mime.split("/")[0],
          ],
        );
        await sql.query(
          "INSERT INTO job_assets(job_id,asset_id,role) VALUES($1,$2,'output')",
          [id, aid],
        );
        const result = { assets: [aid], ...(lease ? { lease } : {}) };
        await this.p.settle(
          sql,
          job,
          "completed",
          result,
          undefined,
          completionTiming,
        );
        await options.settled?.(sql, job);
        return result;
      });
    } catch (error) {
      // A dropped COMMIT acknowledgement may leave a valid result. Check the
      // committed output before removing its private object.
      const saved = await one(
        this.p.db,
        "SELECT j.result FROM jobs j JOIN job_assets a ON a.job_id=j.id WHERE j.id=$1 AND a.asset_id=$2 AND a.role='output' AND j.state='completed'",
        [id, aid],
      );
      if (saved) return saved.result;
      await this.p.storage.remove(key);
      throw error;
    }
    if (!result.assets.includes(aid)) await this.p.storage.remove(key);
    return result;
  }
}
