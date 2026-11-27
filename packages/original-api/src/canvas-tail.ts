import { one, type Sql } from "@fumiao/platform/db.js";
import { nativeOutputIndex } from "./library.js";

export const activeCanvasJobStates = [
  "queued",
  "dispatching",
  "running",
  "finalizing",
  "uncertain",
];

type Tail =
  | { state: "pending"; job: string }
  | {
      state: "completed";
      source: { id: string; public_id: string; object_key: string };
      frame: string | null;
    };

/** Inspect an inherited frame without extracting bytes or scheduling work. */
export async function readCanvasTail(
  sql: Sql,
  project: string,
  workspace: string,
  parent: string,
  refs: string[],
  packs: string[] = [],
): Promise<Tail | null> {
  const job = await one(
    sql,
    `SELECT j.id, j.state, output.id AS asset_id, output.public_id, output.object_key
    FROM canvas_job_links l JOIN jobs j ON j.id=l.job_id
    LEFT JOIN LATERAL (SELECT a.id,a.public_id,a.object_key FROM job_assets ja JOIN assets a ON a.id=ja.asset_id
      WHERE ja.job_id=j.id AND ja.role='output' AND a.state='ready'
      ORDER BY ${nativeOutputIndex},a.created_at,a.public_id LIMIT 1) output ON TRUE
    WHERE l.project_id=$1 AND l.node=$2 AND j.kind='video' AND j.deleted_at IS NULL
    ORDER BY l.id DESC LIMIT 1`,
    [project, parent],
  );
  if (!job) return null;
  if (activeCanvasJobStates.includes(job.state))
    return { state: "pending", job: job.id };
  if (job.state !== "completed" || !job.asset_id) return null;
  const frame = await one(
    sql,
    `SELECT public_id FROM assets a WHERE workspace_id=$1 AND state='ready'
    AND metadata->>'derivation'='tail_frame' AND metadata->>'derived_from'=$2
    ORDER BY (public_id=ANY($3::text[]) OR EXISTS (
      SELECT 1 FROM documents d WHERE d.public_id=ANY($4::text[]) AND d.kind='pack' AND NOT d.deleted
        AND (d.body->'assets') ? a.id::text)) DESC,created_at DESC,id DESC LIMIT 1`,
    [workspace, job.public_id, refs, packs],
  );
  return {
    state: "completed",
    source: {
      id: job.asset_id,
      public_id: job.public_id,
      object_key: job.object_key,
    },
    frame: frame?.public_id ?? null,
  };
}

export function withTailCount(refs: Set<string>, tail: Tail | null) {
  if (!tail) return refs.size;
  return (
    refs.size +
    Number(tail.state === "pending" || !tail.frame || !refs.has(tail.frame))
  );
}
