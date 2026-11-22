import type { Sql } from "@fumiao/platform/db.js";
import { one } from "@fumiao/platform/db.js";
import { requireValue } from "@fumiao/platform/security.js";
import { elapsedDetail, type Run } from "@fumiao/platform/timing-math.js";
import type { OriginalActor } from "./identity.js";

const epoch = (v: Date | string) => Math.floor(new Date(v).getTime() / 1000);
const number = (v: unknown) => {
  const n = Number(v);
  requireValue(
    v !== null && Number.isSafeInteger(n),
    503,
    "原状态数据尚未完整迁移",
  );
  return n;
};

/** Read task JSON as a whole value: PostgreSQL JSON field operators also decode
 * unrelated strings, so a NUL in provider text/usage must not break state reads.
 * Keep the first result's ordering and the caller's transaction snapshot. */
export async function attachJobResults(sql: Sql, jobs: Record<string, any>[]) {
  const first = (job: Record<string, any>): string | undefined => {
    const value = Array.isArray(job.result?.assets)
      ? job.result.assets[0]
      : undefined;
    return typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        value,
      )
      ? value
      : undefined;
  };
  const ids = [
    ...new Set(jobs.map(first).filter((id): id is string => id !== undefined)),
  ];
  const assets = ids.length
    ? (
        await sql.query(
          "SELECT id,public_id,metadata FROM assets WHERE id=ANY($1::uuid[])",
          [ids],
        )
      ).rows
    : [];
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  for (const job of jobs) {
    const asset = byId.get(first(job));
    job.result_public_id = asset?.public_id ?? null;
    job.result_metadata = asset?.metadata ?? null;
  }
}

/** Building blocks for the full state response, not an alternate /api/state.
 * The caller must authorize the workspace and hold one consistent SQL snapshot.
 * Missing historical facts are a migration error; never synthesize their values. */
export class OriginalStateRecords {
  async nodes(sql: Sql, user: OriginalActor, stamp: number) {
    if (user.role !== "admin") return [];
    requireValue(
      !(await one(
        sql,
        "SELECT id FROM gpu_nodes WHERE owner_id IS NULL AND archived=false LIMIT 1",
      )),
      503,
      "旧 GPU 节点缺少归属，请先完成节点迁移",
    );
    const nodes = (
      await sql.query(
        `SELECT n.*,u.public_id AS owner_public_id,COALESCE(NULLIF(u.nickname,''),u.name) AS contributor
      FROM gpu_nodes n JOIN users u ON u.id=n.owner_id JOIN connections c ON c.id=n.connection_id
      WHERE n.control!='removed' AND NOT c.fmworker_resource_driver AND ($1='admin' OR n.owner_id=$2)
        AND NOT EXISTS (SELECT 1 FROM fmworker_resources r WHERE r.node_id=n.id) ORDER BY n.public_id DESC`,
        [user.role, user.id],
      )
    ).rows;
    return nodes.map((n) => ({
      id: number(n.public_id),
      name: n.name,
      stage:
        Math.floor(stamp) - epoch(n.last_seen) > 75
          ? "offline"
          : (n.queue_state.stage ?? "preparing"),
      lastseen: epoch(n.last_seen),
      control: n.control,
      detail: n.detail,
      owner: number(n.owner_public_id),
      models: n.models,
      ready_models: n.queue_state.ready_models || [],
      profile: n.timing_context.profile || {},
      contributor: n.contributor,
    }));
  }
  async assets(sql: Sql, workspace: string) {
    const rows = (
      await sql.query(
        `SELECT a.*,u.public_id AS owner_public_id,w.public_id AS workspace_public_id,
      COALESCE(r.seconds,0) AS seconds,COALESCE(r.has_audio,false) AS has_audio,COALESCE(r.name,'') AS name
      FROM assets a JOIN users u ON u.id=a.owner_id JOIN workspaces w ON w.id=a.workspace_id
      LEFT JOIN asset_reference_media r ON r.asset_id=a.id
      WHERE a.workspace_id=$1 AND a.state='ready' AND a.original_kind IN ('ref','ref_video','ref_audio') ORDER BY a.original_order DESC`,
        [workspace],
      )
    ).rows;
    requireValue(
      rows.every((r) => r.original_order !== null),
      503,
      "旧素材缺少排序信息，请重新导出迁移",
    );
    return rows.map((a) => ({
      id: a.public_id,
      kind: a.original_kind,
      mime: a.mime,
      w: Object.hasOwn(a.metadata, "width")
        ? a.metadata.width
        : (a.metadata.w ?? 0),
      h: Object.hasOwn(a.metadata, "height")
        ? a.metadata.height
        : (a.metadata.h ?? 0),
      size: number(a.size),
      owner: number(a.owner_public_id),
      workspace: number(a.workspace_public_id),
      seconds: a.seconds,
      has_audio: Number(a.has_audio),
      name: a.name,
    }));
  }
  async archivedJobs(
    sql: Sql,
    workspace: string,
    stamp: number,
  ): Promise<Record<string, any>[]> {
    const jobs = (
      await sql.query(
        `SELECT j.*,u.public_id AS owner_public_id,w.public_id AS workspace_public_id,
      COALESCE(NULLIF(u.nickname,''),u.name) AS author
      FROM jobs j JOIN users u ON u.id=j.owner_id JOIN workspaces w ON w.id=j.workspace_id
      WHERE j.workspace_id=$1 AND j.plugin_id='legacy-archive' AND j.deleted_at IS NULL ORDER BY j.public_id DESC`,
        [workspace],
      )
    ).rows;
    await attachJobResults(sql, jobs);
    const runs = (
      await sql.query(
        "SELECT DISTINCT ON(job) * FROM job_runs WHERE job=ANY($1::uuid[]) ORDER BY job,id DESC",
        [jobs.map((j) => j.id)],
      )
    ).rows;
    const byJob = new Map(runs.map((r) => [r.job, r]));
    const fields = [
      "ratio",
      "quality",
      "seconds",
      "sampling_steps",
      "seed",
      "width",
      "height",
      "image_quality",
      "audio_settings",
      "h3_inputs",
      "actual",
      "refs",
    ];
    return jobs.map((j) => {
      requireValue(
        fields.every((k) => Object.hasOwn(j.original_view, k)) &&
          j.attempts !== null,
        503,
        "历史任务缺少原状态字段，请重新导出迁移",
      );
      return {
        id: number(j.public_id),
        workspace: number(j.workspace_public_id),
        owner: number(j.owner_public_id),
        author: j.author,
        prompt: j.input.prompt,
        ...Object.fromEntries(fields.map((k) => [k, j.original_view[k]])),
        parent: j.original_parent === null ? null : number(j.original_parent),
        status: j.state === "completed" ? "done" : j.state,
        created: Object.hasOwn(j.original_view, "created")
          ? j.original_view.created
          : epoch(j.created_at),
        result: Object.hasOwn(j.original_view, "result")
          ? j.original_view.result
          : (j.result_public_id ?? null),
        note: Object.hasOwn(j.original_view, "note")
          ? j.original_view.note
          : j.error || "",
        node: j.original_node === null ? null : number(j.original_node),
        kind: j.kind,
        model: j.provider_model,
        updated: Object.hasOwn(j.original_view, "updated")
          ? j.original_view.updated
          : epoch(j.updated_at),
        attempts: number(j.attempts),
        timing: elapsedDetail(byJob.get(j.id) as Run | undefined, stamp),
      };
    });
  }
}
