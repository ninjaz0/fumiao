import type { Platform, Actor } from "./platform.js";
import type { Sql } from "./db.js";
import { one } from "./db.js";
import { forecastQueue } from "./queue.js";
import {
  Estimator,
  elapsedDetail,
  remaining,
  type Run,
} from "./timing-math.js";
import type {
  QueueContext,
  QueueJob,
  QueueNode,
  QueueRun,
} from "@fumiao/plugin-sdk/index.js";

export type ForecastCandidate = {
  job: {
    id: string;
    public_id: number;
    workspace_id: string;
    connection_id: string;
    plugin_id: string;
    plugin_version: string;
    provider_model: string;
    kind: string;
    state: "queued";
    remote_id: null;
    allowed: boolean;
    input: {
      prompt: string;
      params: Record<string, unknown>;
      references: string[];
    };
  };
  connection: {
    id: string;
    plugin_id: string;
    plugin_version: string;
    enabled: boolean;
    revision: number;
    queue_health: Record<string, unknown>;
    queue_health_revision: number | null;
  };
};

/** Read one consistent global queue, then project only the authorized workspace.
 * No polling, lease recovery or provider calls are allowed inside this read. */
export class QueueForecasts {
  constructor(readonly p: Platform) {}
  async forWorkspace(
    actor: Actor,
    wid: string,
    options: { imageEnabled?: boolean } = {},
  ) {
    return this.p.db.transaction(async (sql) => {
      await sql.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      await this.p.workspace(sql, actor, wid);
      return this.read(sql, wid, options);
    });
  }
  async read(
    sql: Sql,
    wid: string,
    options: { imageEnabled?: boolean; candidate?: ForecastCandidate } = {},
  ) {
    const stamp = Number(
      (
        await one(
          sql,
          "SELECT extract(epoch FROM transaction_timestamp())::double precision AS stamp",
        )
      ).stamp,
    );
    const jobs = (
      await sql.query(`SELECT j.*,c.enabled AS connection_enabled,
   (COALESCE(mp.enabled,true) AND (m.catalog_id IS NOT NULL OR m.enabled) AND studio_model_allowed(COALESCE(j.catalog_id,m.catalog_id),j.workspace_id) AND u.active) AS allowed
   FROM jobs j JOIN connections c ON c.id=j.connection_id JOIN models m ON m.id=j.model_id JOIN users u ON u.id=j.owner_id
   LEFT JOIN model_permissions mp ON mp.model_id=j.model_id AND mp.workspace_id=j.workspace_id
   WHERE j.deleted_at IS NULL AND j.state IN ('queued','dispatching','running','finalizing','uncertain') ORDER BY j.public_id`)
    ).rows;
    if (options.candidate) jobs.push(options.candidate.job);
    const connections = (
      await sql.query(
        "SELECT id,plugin_id,plugin_version,enabled,revision,queue_health,queue_health_revision FROM connections WHERE id=ANY($1::uuid[])",
        [[...new Set(jobs.map((j) => j.connection_id))]],
      )
    ).rows;
    if (
      options.candidate &&
      !connections.some((c) => c.id === options.candidate!.connection.id)
    )
      connections.push(options.candidate.connection);
    const nodes = (
      await sql.query(
        "SELECT id,public_id,connection_id,enabled,last_seen,models,control,timing_context,queue_state FROM gpu_nodes WHERE connection_id=ANY($1::uuid[])",
        [connections.map((c) => c.id)],
      )
    ).rows;
    const nodePublic = new Map(nodes.map((n) => [n.id, Number(n.public_id)]));
    const publicNode = (id: string | null) =>
      id === null ? null : (nodePublic.get(id) ?? id);
    const jobPublic = new Map(jobs.map((j) => [j.id, Number(j.public_id)]));
    const normalizeRun = (r: any): Run => ({
      ...r,
      node: r.node === null ? null : String(publicNode(r.node)),
    });
    const latest = (
      await sql.query(
        "SELECT DISTINCT ON (job) * FROM job_runs WHERE job=ANY($1::uuid[]) ORDER BY job,id DESC",
        [jobs.map((j) => j.id)],
      )
    ).rows;
    const current = Object.fromEntries(
      latest.map((r) => [jobPublic.get(r.job)!, normalizeRun(r)]),
    );
    const contextRuns = Object.fromEntries(
      latest.map((r) => [
        jobPublic.get(r.job)!,
        { ...r, node: publicNode(r.node) } as QueueRun,
      ]),
    );
    const history = (
      await sql.query(
        "SELECT DISTINCT ON (node,model) * FROM job_runs WHERE node=ANY($1::text[]) AND status='done' ORDER BY node,model,id DESC",
        [nodes.map((n) => n.id)],
      )
    ).rows.sort((a, b) => Number(b.id) - Number(a.id));
    const samples = (
      await sql.query(
        "SELECT * FROM job_runs WHERE status='legacy' OR (status='done' AND valid AND started IS NOT NULL) ORDER BY id DESC LIMIT 500",
      )
    ).rows;
    const refs = [...new Set(jobs.flatMap((j) => j.input.references))];
    const assets = new Map(
      (
        await sql.query(
          "SELECT id,metadata FROM assets WHERE id=ANY($1::uuid[])",
          [refs],
        )
      ).rows.map((a) => [a.id, a.metadata]),
    );
    const plans: Record<string, any> = {};
    let candidateEligible: boolean | undefined;
    for (const connection of connections) {
      const version = await one(
        sql,
        "SELECT manifest FROM plugin_versions WHERE id=$1 AND version=$2",
        [connection.plugin_id, connection.plugin_version],
      );
      const owned = jobs.filter((j) => j.connection_id === connection.id);
      if (!version?.manifest.queue) {
        for (const j of owned)
          if (j.state === "queued")
            plans[j.public_id] = { source: "none", reason: "unknown" };
        continue;
      }
      const plugin = await this.p.registry.resolve(
          sql,
          connection.plugin_id,
          connection.plugin_version,
        ),
        policy = plugin.manifest.timing!;
      const estimator = new Estimator(
        samples
          .filter(
            (r) =>
              r.plugin_id === connection.plugin_id &&
              plugin.manifest.queue!.timingVersions.includes(
                r.plugin_version,
              ) &&
              r.policy?.geometry === policy.geometry &&
              r.policy?.hardware === policy.hardware &&
              r.policy?.scaleSteps === policy.scaleSteps,
          )
          .map(normalizeRun),
        policy,
      );
      const queueJobs: QueueJob[] = owned.map((j) => ({
        id: Number(j.public_id),
        node: nodePublic.get(j.remote_id) ?? null,
        remoteId: j.remote_id,
        model: j.provider_model,
        kind: j.kind,
        status: j.state === "queued" ? "queued" : "running",
        pluginVersion: j.plugin_version,
        enabled: j.allowed,
        input: {
          ...j.input,
          references: j.input.references.map((id: string) => ({
            id,
            width: Number(assets.get(id)?.width || assets.get(id)?.w || 0),
            height: Number(assets.get(id)?.height || assets.get(id)?.h || 0),
          })),
        },
      }));
      const queueNodes: QueueNode[] = nodes
        .filter((n) => n.connection_id === connection.id)
        .map((n) => ({
          ...n.timing_context,
          ...n.queue_state,
          id: Number(n.public_id),
          control: connection.enabled && n.enabled ? n.control : "paused",
          lastseen: new Date(n.last_seen).getTime() / 1000,
          stage: n.queue_state.stage ?? "preparing",
          ready_models: n.queue_state.ready_models ?? [],
        }));
      const context: QueueContext = {
        jobs: queueJobs,
        nodes: queueNodes,
        runs: contextRuns,
        history: history
          .filter(
            (r) =>
              r.plugin_id === connection.plugin_id &&
              plugin.manifest.queue!.timingVersions.includes(r.plugin_version),
          )
          .map((r) => ({ ...r, node: publicNode(r.node) }) as QueueRun),
        stamp,
        health:
          connection.enabled &&
          connection.queue_health_revision === connection.revision
            ? connection.queue_health
            : {},
        imageEnabled: (options.imageEnabled ?? true) && connection.enabled,
      };
      if (
        options.candidate?.connection.id === connection.id &&
        plugin.originalEstimate?.eligible
      ) {
        const job = queueJobs.find(
          (j) => j.id === options.candidate!.job.public_id,
        )!;
        candidateEligible = queueNodes.some((node) =>
          plugin.originalEstimate!.eligible!(node, job, stamp),
        );
      }
      Object.assign(plans, forecastQueue(plugin, context, current, estimator));
    }
    return {
      serverTime: stamp,
      ...(options.candidate ? { candidateEligible } : {}),
      jobs: Object.fromEntries(
        jobs
          .filter((j) => j.workspace_id === wid)
          .map((j) => {
            const run = current[Number(j.public_id)];
            return [
              j.id,
              {
                id: Number(j.public_id),
                timing: elapsedDetail(run, stamp),
                eta:
                  j.state === "queued"
                    ? (plans[j.public_id] ?? {
                        source: "none",
                        reason: "unknown",
                      })
                    : run?.phase === "queued"
                      ? (plans[j.public_id] ?? {
                          source: "none",
                          phase: "queued",
                        })
                      : remaining(run, stamp),
              },
            ];
          }),
      ),
    };
  }
}
