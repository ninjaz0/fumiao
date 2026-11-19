import { queuedModelPolicy } from "../../../packages/platform/src/studio-plugin-profile.js";
import { loadProgram } from "../../../packages/platform/src/plugin-program.js";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import type { ArtifactReceipt } from "../../../packages/plugin-sdk/src/preparation.js";
import type {
  QueueJob,
  QueueNode,
} from "../../../packages/plugin-sdk/src/queue.js";
import type {
  TimingContext,
  TimingReport,
} from "../../../packages/plugin-sdk/src/timing.js";
import {
  PairedAgentPlanError,
  type ExecutionPlan,
  type PairedAgentProtocol,
} from "../../../packages/plugin-sdk/src/paired-agent.js";
import { one, type Sql } from "../../../packages/platform/src/db.js";
import { Executor } from "../../../packages/platform/src/executor.js";
import { GpuGateway } from "../../../packages/platform/src/gpu.js";
import type { Platform } from "../../../packages/platform/src/platform.js";
import {
  DomainError,
  hash,
  requireValue,
  secret,
} from "../../../packages/platform/src/security.js";
import { executableJob } from "../../../packages/platform/src/retired-jobs.js";
import { JobTiming } from "../../../packages/platform/src/timing.js";

type Profile = NonNullable<NonNullable<TimingContext["node"]>["profile"]>;
export type Heartbeat = {
  stage: string;
  detail: string;
  ticket: string;
  lane_model?: string | null;
  can_accept: boolean;
  execution_plan?: Record<string, unknown> | null;
  hardware: string;
  workflow: string;
  runtime_id: string;
  profile?: Profile | null;
  model_profiles?: Record<string, Profile> | null;
  ready_models?: string[] | null;
  video_steps?: number[] | null;
} & { [K in keyof TimingReport]: TimingReport[K] | null };

type Credential = { authorization: string; ticket: string; lane: string };
type Lane = NonNullable<QueueNode["lanes"]>[number] & {
  detail: string;
  profile: Profile;
};
type NodeRow = {
  id: string;
  connection_id: string;
  plugin_id: string;
  plugin_version: string;
  models: string[];
  control: string;
  last_seen: Date;
  detail: string;
  timing_context: Omit<NonNullable<TimingContext["node"]>, "id">;
  queue_state: Pick<QueueNode, "ready_models" | "video_steps"> & {
    stage?: string;
    execution_plan?: ExecutionPlan;
    lanes?: Lane[];
  };
};
type Job = Record<string, any>;
const stamp = () => Math.floor(Date.now() / 1000);
const inactive = "该任务已由其他实例接管或已结束";
const protocolOnly = { job: null, protocol: 2 } as const;
const leaseDeadline =
  "date_trunc('second',clock_timestamp())+interval '180 seconds'";

function queueNode(node: NodeRow): QueueNode {
  return {
    ...node.timing_context,
    ...node.queue_state,
    id: node.id,
    control: node.control,
    lastseen: Math.floor(node.last_seen.getTime() / 1000),
    stage: node.queue_state.stage ?? "preparing",
    ready_models: node.queue_state.ready_models ?? [],
  };
}

function queueJob(job: Job): QueueJob {
  return {
    id: job.id,
    node: job.remote_id,
    kind: job.kind,
    status: job.state,
    model: job.provider_model,
    input: {
      ...job.input,
      references: job.input.references.map((id: string) => ({
        id,
        width: 0,
        height: 0,
      })),
    },
  };
}

export class OriginalPairedAgent {
  private timing: JobTiming;
  constructor(private p: Platform) {
    this.timing = new JobTiming(p);
  }

  private async node(
    sql: Sql,
    credential: Credential,
    lock = false,
  ): Promise<NodeRow> {
    const auth = credential.authorization;
    requireValue(auth.startsWith("Bearer "), 401, "缺少实例凭据");
    const node = await one(
      sql,
      `SELECT n.*,c.plugin_id,c.plugin_version FROM gpu_nodes n JOIN connections c ON c.id=n.connection_id
       WHERE n.token_hash=$1 AND n.enabled AND NOT n.archived AND n.control!='removed' AND NOT c.fmworker_resource_driver
       AND EXISTS (SELECT 1 FROM gpu_pairings p WHERE p.claimed_node_id=n.id)
       AND NOT EXISTS (SELECT 1 FROM fmworker_resources r WHERE r.node_id=n.id)${lock ? " FOR UPDATE OF n" : ""}`,
      [hash(auth.slice(7))],
    );
    requireValue(node, 403, "实例凭据已撤销");
    return node as NodeRow;
  }

  private async protocol(sql: Sql, node: NodeRow) {
    const protocol = await this.p.registry.pairedAgent(
      sql,
      node.plugin_id,
      node.plugin_version,
    );
    requireValue(protocol, 503, "GPU 接入暂不可用");
    return protocol;
  }

  private async running(sql: Sql, node: NodeRow, lane = "", lock = false) {
    return (
      await sql.query(
        `SELECT j.* FROM jobs j WHERE remote_id=$1 AND state='running' AND original_gpu_ticket IS NOT NULL AND ($2='' OR provider_model=$2) AND ${executableJob} ORDER BY public_id` +
          (lock ? " FOR UPDATE" : ""),
        [node.id, lane],
      )
    ).rows;
  }

  private summarize(
    node: NodeRow,
    protocol: PairedAgentProtocol,
    running: Job[],
    now: number,
  ) {
    const rows = node.queue_state.lanes ?? [];
    const alive = rows.filter((lane) => lane.lastseen > now - 75);
    if (!alive.length && !running.length) return;
    const ready = alive.filter((lane) =>
      ["ready", "busy"].includes(lane.stage),
    );
    const errors = alive.filter((lane) => lane.stage === "error");
    const blocked = alive.filter(
      (lane) => lane.stage === "ready" && !lane.can_accept,
    );
    const notices = errors.length ? errors : blocked;
    node.queue_state.stage = running.length
      ? "busy"
      : ready.length
        ? "ready"
        : errors.length
          ? "error"
          : "preparing";
    node.queue_state.ready_models = ready.map((lane) => lane.model);
    node.detail = notices.length
      ? [
          ...notices
            .map(
              (lane) => protocol.models[lane.model].label + "：" + lane.detail,
            )
            .join("；"),
        ]
          .slice(0, 300)
          .join("")
      : running.length > 1
        ? "视频与语音生成中"
        : running.length
          ? running[0].kind === "audio"
            ? "正在生成语音"
            : "正在生成视频"
          : ready.length
            ? "就绪"
            : "正在准备模型";
  }

  async heartbeat(credential: Credential, beat: Heartbeat) {
    requireValue(
      ["preparing", "ready", "busy", "error"].includes(beat.stage),
      400,
      "状态无效",
    );
    return this.p.db.transaction(async (sql) => {
      const node = await this.node(sql, credential, true);
      const protocol = await this.protocol(sql, node),
        state = node.queue_state,
        context = node.timing_context;
      const lane = beat.lane_model,
        model = protocol.legacyModel,
        now = stamp();
      if (beat.video_steps) {
        requireValue(node.models.includes(model), 400, "实例没有接入视频模型");
        requireValue(!lane || lane === model, 400, "通道不能修改视频能力");
        state.video_steps = [...new Set(beat.video_steps)].sort(
          (a, b) => a - b,
        );
      } else if (!lane && node.models.includes(model)) state.video_steps = [20];
      if (!lane && beat.runtime_id && beat.runtime_id !== context.runtime_id)
        state.lanes = [];
      if (beat.execution_plan) {
        let plan;
        try {
          plan = protocol.plan(beat.execution_plan, node.models);
        } catch (error) {
          if (error instanceof PairedAgentPlanError)
            throw new DomainError(400, error.message);
          throw error;
        }
        const prior = state.execution_plan;
        if (!isDeepStrictEqual(plan, prior)) {
          requireValue(
            (plan.mode === "serial" && prior?.mode !== "parallel") ||
              !(await this.running(sql, node)).length,
            409,
            "请先等待实例任务完成后更改执行方式",
          );
          state.execution_plan = plan;
          state.lanes = [];
        }
      }
      const plan = state.execution_plan;
      requireValue(
        !lane ||
          (plan?.mode === "parallel" && Object.hasOwn(plan.lanes!, lane)),
        400,
        "实例没有这个并发执行通道",
      );
      if (beat.ready_models) {
        requireValue(
          beat.ready_models.every((id) => node.models.includes(id)),
          400,
          "实例没有接入这些模型",
        );
        if (!lane) state.ready_models = [...new Set(beat.ready_models)];
      } else if (
        !lane &&
        beat.stage === "ready" &&
        node.models.length === 1 &&
        node.models[0] === model
      )
        state.ready_models = [model];
      if (beat.model_profiles) {
        const models = Object.keys(beat.model_profiles);
        requireValue(
          models.every((id) => node.models.includes(id)),
          400,
          "模型运行环境与接入配置不符",
        );
        requireValue(
          !lane || (models.length === 1 && models[0] === lane),
          400,
          "并发通道只能上报自己的模型环境",
        );
        context.model_profiles = {
          ...(lane ? context.model_profiles : {}),
          ...beat.model_profiles,
        };
      }
      state.stage = beat.stage;
      node.detail = beat.detail;
      if (!lane) {
        if (beat.hardware) context.hardware = beat.hardware;
        if (beat.workflow) context.workflow = beat.workflow;
        if (beat.runtime_id) context.runtime_id = beat.runtime_id;
        if (beat.profile) {
          context.profile = beat.profile;
          context.hardware = protocol.hardware(beat.profile);
        }
      }
      const held = beat.ticket ? await this.renew(sql, node, beat, now) : false;
      if (lane) {
        const lanes = new Map(
          (state.lanes ?? []).map((item) => [item.model, item]),
        );
        const value: Lane = {
          model: lane,
          lastseen: now,
          stage:
            !beat.ready_models || beat.ready_models.includes(lane)
              ? beat.stage
              : "preparing",
          detail: beat.detail,
          runtime_id: beat.runtime_id,
          can_accept: beat.can_accept,
          profile: beat.profile ?? {},
        };
        lanes.set(lane, value);
        state.lanes = [...lanes.values()];
      }
      if (plan?.mode === "parallel")
        this.summarize(node, protocol, await this.running(sql, node), now);
      await sql.query(
        "UPDATE gpu_nodes SET last_seen=to_timestamp($2),timing_context=$3,queue_state=$4,detail=$5 WHERE id=$1",
        [
          node.id,
          now,
          JSON.stringify(context),
          JSON.stringify(state),
          node.detail,
        ],
      );
      return {
        control: node.control,
        held,
        protocol: protocol.version,
        execution_mode: plan?.mode ?? "serial",
      };
    });
  }

  private async renew(sql: Sql, node: NodeRow, beat: Heartbeat, now: number) {
    const job = await one(
      sql,
      `SELECT j.* FROM jobs j WHERE remote_id=$1 AND original_gpu_ticket=$2 AND state IN ('running','queued') AND ${executableJob} FOR UPDATE OF j`,
      [node.id, beat.ticket],
    );
    if (!job || (beat.lane_model && beat.lane_model !== job.provider_model))
      return false;
    if (
      job.state === "queued" &&
      (node.control !== "active" ||
        (
          await this.running(
            sql,
            node,
            node.queue_state.execution_plan?.mode === "parallel"
              ? job.provider_model
              : "",
          )
        ).length)
    )
      return false;
    const { step, steps, uploading, job_phase, timing } = beat;
    const note = uploading
      ? "正在回传并校验成片"
      : step != null && steps != null && step <= steps
        ? `采样 ${step} / ${steps} 步`
        : null;
    await sql.query(
      `UPDATE jobs SET state='running',lease_token=COALESCE(lease_token,$2),lease_until=${leaseDeadline},error=$3 WHERE id=$1`,
      [job.id, randomUUID(), note],
    );
    const report: TimingReport = {
      step: step ?? undefined,
      steps: steps ?? undefined,
      uploading: uploading ?? undefined,
      job_phase: job_phase ?? undefined,
      timing: timing ?? undefined,
    };
    await this.timing.observe(sql, job.id, report, now);
    return true;
  }

  private async eligible(
    sql: Sql,
    protocol: PairedAgentProtocol,
    node: QueueNode,
    job: Job,
  ) {
    if (!job.package_version) return protocol.canRun(node, queueJob(job));
    const release = await one(
      sql,
      "SELECT package->>'program' AS program FROM studio_package_releases WHERE id=$1 AND version=$2",
      [job.plugin_id, job.package_version],
    );
    if (!release?.program) return protocol.canRun(node, queueJob(job));
    const run = await loadProgram(release.program);
    return run("eligible", node, queueJob(job)) === true;
  }

  async claim(credential: Credential) {
    await this.node(this.p.db, credential);
    // The same recovery runs from the BullMQ dispatcher. A claim also reaps
    // expired jobs immediately, as the original polling clients expect.
    await this.p.db.transaction((sql) =>
      new Executor(this.p).recoverOn(sql, true),
    );
    return this.p.db.transaction(async (sql) => {
      const node = await this.node(sql, credential, true);
      const protocol = await this.protocol(sql, node),
        lane = credential.lane,
        state = node.queue_state;
      const plan = state.execution_plan;
      const parallel = plan?.mode === "parallel",
        now = stamp();
      if (parallel && !lane) return protocolOnly;
      if (parallel)
        requireValue(Object.hasOwn(plan.lanes!, lane), 400, "执行通道未授权");
      else requireValue(!lane, 409, "服务器当前只允许单通道执行");
      const current = (await this.running(sql, node, lane, true))[0];
      const view = queueNode(node);
      if (current)
        return {
          job: (await this.eligible(sql, protocol, view, current))
            ? await this.payload(sql, current)
            : null,
          protocol: protocol.version,
        };
      const slot = state.lanes?.find((item) => item.model === lane);
      const fresh = parallel
        ? slot?.stage === "ready" &&
          slot.lastseen >= now - 75 &&
          slot.can_accept
        : view.stage === "ready" && view.lastseen >= now - 75;
      const installed = (view.ready_models ?? []).filter(
        (id) => node.models.includes(id) && (!lane || id === lane),
      );
      const pauseFile = process.env.ORIGINAL_GPU_DISPATCH_PAUSE_FILE;
      if (
        !fresh ||
        !installed.length ||
        node.control !== "active" ||
        (pauseFile && existsSync(pauseFile))
      )
        return protocolOnly;
      const job = await this.next(sql, node, installed, view, protocol);
      if (!job) return { job: null };
      requireValue(job.attempts !== null, 503, "任务执行次数尚未完成迁移");
      const lease = randomUUID();
      job.original_gpu_ticket = secret();
      job.attempts += 1;
      await sql.query(
        `UPDATE jobs SET state='running',lease_token=$2,lease_until=${leaseDeadline},remote_id=$3,
          original_gpu_ticket=$4,attempts=$5,error=NULL,updated_at=now() WHERE id=$1`,
        [job.id, lease, node.id, job.original_gpu_ticket, job.attempts],
      );
      await this.timing.start(sql, { ...job, lease_token: lease }, true, {
        ...node.timing_context,
        id: node.id,
        ...(lane ? { lane_model: lane } : {}),
      });
      if (slot) {
        slot.stage = "busy";
        this.summarize(node, protocol, await this.running(sql, node), now);
        await sql.query(
          "UPDATE gpu_nodes SET queue_state=$2,detail=$3 WHERE id=$1",
          [node.id, JSON.stringify(state), node.detail],
        );
      }
      return { job: await this.payload(sql, job) };
    });
  }

  private async next(
    sql: Sql,
    node: NodeRow,
    models: string[],
    view: QueueNode,
    protocol: PairedAgentProtocol,
  ) {
    const candidates = `SELECT j.* FROM jobs j JOIN connections c ON c.id=j.connection_id
      JOIN models m ON m.id=j.model_id
      JOIN plugin_versions v ON v.id=j.plugin_id AND v.version=j.plugin_version
      LEFT JOIN model_permissions mp ON mp.model_id=m.id AND mp.workspace_id=j.workspace_id
      WHERE j.connection_id=$1 AND c.enabled AND j.state='queued' AND j.original_uid IS NOT NULL AND j.deleted_at IS NULL
      AND v.manifest->>'mode'='pull' AND NOT (v.manifest ? 'fmworkerResources') AND v.manifest->'artifactValidation' IS NOT NULL AND v.manifest->'originalState'->'recovery' IS NOT NULL
      AND j.provider_model=ANY($2::text[]) AND ${await queuedModelPolicy(sql)} AND COALESCE(mp.enabled,true) AND ${executableJob}`;
    let cursor = 0;
    // Jobs are dispatched across workspaces. Access to private inputs comes
    // only from the assignment and its frozen workspace-scoped asset links.
    for (;;) {
      const rows = (
        await sql.query(
          candidates + " AND j.public_id>$3 ORDER BY j.public_id LIMIT 100",
          [node.connection_id, models, cursor],
        )
      ).rows;
      if (!rows.length) return undefined;
      for (const job of rows) {
        cursor = Number(job.public_id);
        if (!(await this.eligible(sql, protocol, view, job))) continue;
        const locked = await one(
          sql,
          candidates + " AND j.id=$3 FOR UPDATE OF j SKIP LOCKED",
          [node.connection_id, models, job.id],
        );
        if (locked) return locked;
      }
    }
  }

  private async payload(sql: Sql, job: Job) {
    const refs = (
      await sql.query(
        "SELECT a.public_id FROM unnest($1::uuid[]) WITH ORDINALITY AS r(id,i) JOIN assets a ON a.id=r.id AND a.workspace_id=$2 ORDER BY r.i",
        [job.input.references, job.workspace_id],
      )
    ).rows.map((row) => row.public_id);
    requireValue(
      refs.length === job.input.references.length,
      503,
      "任务素材尚未完整迁移",
    );
    const {
      seed,
      width,
      height,
      seconds,
      sampling_steps,
      quality,
      audio_settings,
      h3_inputs,
    } = job.original_view;
    return {
      id: Number(job.public_id),
      ticket: job.original_gpu_ticket,
      prompt: job.input.prompt,
      seed,
      width,
      height,
      seconds,
      sampling_steps,
      quality,
      attempts: job.attempts,
      refs,
      model: job.provider_model,
      kind: job.kind,
      audio_settings,
      h3_inputs,
    };
  }

  private async assignment(
    sql: Sql,
    credential: Credential,
    id: number,
    completed = false,
  ) {
    const node = await this.node(sql, credential, true);
    const job = await one(
      sql,
      `SELECT j.* FROM jobs j WHERE public_id=$1 AND remote_id=$2 AND original_gpu_ticket=$3 AND deleted_at IS NULL AND ${executableJob} FOR UPDATE OF j`,
      [id, node.id, credential.ticket],
    );
    requireValue(
      !job || !credential.lane || credential.lane === job.provider_model,
      409,
      "任务不属于这个执行通道",
    );
    requireValue(
      job?.state === "running" || (completed && job?.state === "completed"),
      409,
      inactive,
    );
    return job;
  }

  async receipt(credential: Credential, id: number) {
    return this.p.db.transaction(async (sql) => ({
      delivered:
        (await this.assignment(sql, credential, id, true)).state ===
        "completed",
    }));
  }

  async reference(credential: Credential, id: number, key: string) {
    return this.p.db.transaction(async (sql) => {
      const job = await this.assignment(sql, credential, id);
      const asset = await one(
        sql,
        "SELECT * FROM assets WHERE public_id=$1 AND workspace_id=$2 AND id=ANY($3::uuid[]) AND state='ready'",
        [key, job.workspace_id, job.input.references],
      );
      requireValue(asset, 403, "素材不属于本任务");
      return asset;
    });
  }

  async error(credential: Credential, id: number, detail: string) {
    return this.p.db.transaction(async (sql) => {
      const job = await this.assignment(sql, credential, id);
      await this.p.settle(
        sql,
        job,
        "failed",
        undefined,
        [...detail].slice(0, 220).join("") || "生成失败",
      );
      return { ok: true };
    });
  }

  async complete(
    credential: Credential,
    id: number,
    load: () => Promise<Buffer>,
    receipt: ArtifactReceipt,
  ) {
    const result = await new GpuGateway(this.p).deliver(
      undefined,
      (sql) => this.assignment(sql, credential, id, true),
      load,
      receipt,
      {
        params: (job) => ({
          ...job.input.params,
          h3_inputs: job.original_view.h3_inputs,
        }),
        preflight: async (provider, job, headers, sql, version) => {
          const protocol = await this.p.registry.pairedAgent(
            sql,
            provider,
            version,
          );
          requireValue(protocol, 503, "GPU 接入暂不可用");
          protocol.preflight(job, headers);
        },
        settled: async (sql, job) => {
          await sql.query(
            `UPDATE gpu_nodes n SET control='paused' WHERE n.control='draining'
              AND n.id=$1
              AND NOT EXISTS (SELECT 1 FROM jobs WHERE remote_id=n.id::text AND state='running')`,
            [job.remote_id],
          );
        },
      },
    );
    const asset = await one(
      this.p.db,
      "SELECT public_id FROM assets WHERE id=$1",
      [result.assets[0]],
    );
    requireValue(asset, 503, "成片尚未完整迁移");
    return { ok: true, id: asset.public_id };
  }
}
