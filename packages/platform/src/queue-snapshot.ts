import type { Platform, Actor } from "./platform.js";
import type { Sql } from "./db.js";
import { one } from "./db.js";
import { forecastQueue } from "./queue.js";
import { sealedConfigKey, submissionEndpointKey } from "./queue-health.js";
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
    config_snapshot?: string;
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
    config?: string;
    enabled: boolean;
    revision: number;
    concurrency?: number;
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
        "SELECT id,plugin_id,plugin_version,config,enabled,revision,concurrency,queue_health,queue_health_revision FROM connections WHERE id=ANY($1::uuid[])",
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
      const owned = jobs.filter((j) => j.connection_id === connection.id);
      const currentConfigKey = sealedConfigKey(this.p, connection.config);
      const currentEndpointKey = submissionEndpointKey(
        this.p,
        connection.config,
      );
      const jobConfigKey = (j: any) =>
        j.config_snapshot !== undefined
          ? sealedConfigKey(this.p, j.config_snapshot)
          : currentConfigKey;
      const jobEndpointKey = (j: any) =>
        j.config_snapshot !== undefined
          ? submissionEndpointKey(this.p, j.config_snapshot)
          : currentEndpointKey;
      const toQueueJob = (j: any): QueueJob => ({
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
      });
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
      const cohortMap = new Map<
        string,
        { version: string; configKey: string; endpointKey: string }
      >();
      for (const j of owned) {
        if (
          j.state !== "queued" &&
          current[Number(j.public_id)]?.phase !== "queued"
        )
          continue;
        const version = String(j.plugin_version);
        const configKey = jobConfigKey(j);
        const endpointKey = jobEndpointKey(j);
        const key = JSON.stringify([version, configKey]);
        if (!cohortMap.has(key))
          cohortMap.set(key, { version, configKey, endpointKey });
      }
      for (const {
        version: targetVersion,
        configKey: targetConfigKey,
        endpointKey: targetEndpointKey,
      } of cohortMap.values()) {
        const version = await one(
          sql,
          "SELECT manifest FROM plugin_versions WHERE id=$1 AND version=$2",
          [connection.plugin_id, targetVersion],
        );
        const inCohort = (j: any) =>
          String(j.plugin_version) === targetVersion &&
          jobConfigKey(j) === targetConfigKey;
        if (!version?.manifest.queue) {
          for (const j of owned)
            if (inCohort(j) && j.state === "queued")
              plans[j.public_id] = { source: "none", reason: "unknown" };
          continue;
        }
        const plugin = await this.p.registry.resolve(
          sql,
          connection.plugin_id,
          targetVersion,
        );
        if (plugin.retired) {
          for (const j of owned)
            if (inCohort(j) && j.state === "queued")
              plans[j.public_id] = { source: "none", reason: "unknown" };
          continue;
        }
        const policy = plugin.manifest.timing!;
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
        const usesQueueHealth = Boolean(plugin.queueHealth);
        const superseded =
          usesQueueHealth &&
          (targetVersion !== String(connection.plugin_version) ||
            targetConfigKey !== currentConfigKey);
        let cohortRawJobs: any[];
        let otherEndpointActiveCount = 0;
        if (usesQueueHealth) {
          const sameEndpointActive = owned.filter(
            (j) =>
              j.state !== "queued" && jobEndpointKey(j) === targetEndpointKey,
          );
          otherEndpointActiveCount = owned.filter(
            (j) =>
              j.state !== "queued" && jobEndpointKey(j) !== targetEndpointKey,
          ).length;
          const cohortWaiting = owned.filter(
            (j) => j.state === "queued" && inCohort(j),
          );
          cohortRawJobs = [...sameEndpointActive, ...cohortWaiting].sort(
            (a, b) => Number(a.public_id) - Number(b.public_id),
          );
        } else {
          const activeAll = owned.filter((j) => j.state !== "queued");
          const eligibleWaiting: any[] = [];
          for (const j of owned) {
            if (j.state !== "queued") continue;
            if (inCohort(j)) {
              eligibleWaiting.push(j);
              continue;
            }
            const otherPlugin = await this.p.registry.resolve(
              sql,
              connection.plugin_id,
              String(j.plugin_version),
            );
            if (otherPlugin.retired) continue;
            const qj = toQueueJob(j);
            const canAccept = otherPlugin.originalEstimate?.eligible
              ? queueNodes.some((n) =>
                  otherPlugin.originalEstimate!.eligible!(n, qj, stamp),
                )
              : true;
            if (canAccept) eligibleWaiting.push(j);
          }
          cohortRawJobs = [...activeAll, ...eligibleWaiting].sort(
            (a, b) => Number(a.public_id) - Number(b.public_id),
          );
        }
        const cohortQueueJobs = cohortRawJobs.map(toQueueJob);
        const ownIds = new Set(
          cohortQueueJobs
            .filter((j) => j.status === "running" && j.remoteId)
            .map((j) => j.remoteId),
        );
        const rawHealth =
          !superseded &&
          connection.enabled &&
          connection.queue_health_revision === connection.revision
            ? connection.queue_health
            : {};
        const external = Array.isArray(rawHealth.tasks)
          ? rawHealth.tasks.filter((t: any) => !ownIds.has(t?.id)).length
          : 0;
        const maintenance =
          typeof rawHealth.maintenance === "number" &&
          Number.isFinite(rawHealth.maintenance)
            ? rawHealth.maintenance
            : 0;
        const availableConcurrency =
          typeof connection.concurrency === "number"
            ? Math.max(0, connection.concurrency - otherEndpointActiveCount)
            : undefined;
        const health =
          typeof rawHealth.capacity === "number" &&
          Number.isFinite(rawHealth.capacity) &&
          typeof availableConcurrency === "number"
            ? {
                ...rawHealth,
                capacity: Math.min(
                  rawHealth.capacity,
                  availableConcurrency + external + maintenance,
                ),
              }
            : rawHealth;
        const context: QueueContext = {
          jobs: cohortQueueJobs,
          nodes: queueNodes,
          runs: contextRuns,
          history: history
            .filter(
              (r) =>
                r.plugin_id === connection.plugin_id &&
                plugin.manifest.queue!.timingVersions.includes(
                  r.plugin_version,
                ),
            )
            .map((r) => ({ ...r, node: publicNode(r.node) }) as QueueRun),
          stamp,
          health,
          imageEnabled: (options.imageEnabled ?? true) && connection.enabled,
        };
        if (
          options.candidate &&
          options.candidate.connection.id === connection.id &&
          inCohort(options.candidate.job) &&
          plugin.originalEstimate?.eligible
        ) {
          const job = cohortQueueJobs.find(
            (j) => j.id === options.candidate!.job.public_id,
          )!;
          candidateEligible = queueNodes.some((node) =>
            plugin.originalEstimate!.eligible!(node, job, stamp),
          );
        }
        const versionPlans = forecastQueue(
          plugin,
          context,
          current,
          estimator,
        );
        for (const j of owned) {
          if (!inCohort(j)) continue;
          const plan = versionPlans[j.public_id];
          if (!plan) continue;
          plans[j.public_id] =
            superseded &&
            connection.enabled &&
            plan.source === "none" &&
            typeof plan.reason === "string" &&
            plan.reason.startsWith("waiting_")
              ? { ...plan, reason: "observing" }
              : plan;
        }
      }
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
