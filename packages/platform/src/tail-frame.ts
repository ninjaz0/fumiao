import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import sharp from "sharp";
import type { Actor, Platform } from "./platform.js";
import { one, type Sql } from "./db.js";
import { capacity } from "./capacity.js";
import { requireValue } from "./security.js";

const exec = promisify(execFile);

export interface TailFrameResult {
  bytes: Buffer;
  width: number;
  height: number;
}

/** Extract the final video frame via server-side FFmpeg as crisp high-quality JPEG. */
export async function extractTailFrame(
  videoPath: string,
  signal: AbortSignal,
): Promise<TailFrameResult> {
  signal.throwIfAborted();
  const dir = await mkdtemp(join(tmpdir(), "fumiao-tail-frame-"));
  const outPath = join(dir, "tail.jpg");
  try {
    const run = (seekArgs: string[]) =>
      exec(
        "ffmpeg",
        [
          "-v",
          "error",
          "-nostdin",
          "-y",
          "-protocol_whitelist",
          "file,pipe",
          ...seekArgs,
          "-i",
          videoPath,
          "-update",
          "1",
          "-frames:v",
          "1",
          "-q:v",
          "2",
          outPath,
        ],
        { signal, timeout: 30_000, maxBuffer: 2 << 20 },
      );

    try {
      await run(["-sseof", "-0.15"]);
    } catch {
      signal.throwIfAborted();
      await run([]);
    }
    const bytes = await readFile(outPath);
    const meta = await sharp(bytes, {
      limitInputPixels: 64_000_000,
    }).metadata();
    requireValue(
      meta.width && meta.height && bytes.length > 0,
      422,
      "无法提取视频尾帧",
    );
    return { bytes, width: meta.width, height: meta.height };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

class MissingTailSource extends Error {}

async function materializeStorageObject(
  p: Platform,
  objectKey: string,
  destPath: string,
  signal: AbortSignal,
) {
  const src = await p.storage
    .stream(objectKey, undefined, undefined, signal)
    .catch((error: unknown) => {
      const fault = error as NodeJS.ErrnoException;
      // GetObject may also return HTTP 404 for an unavailable bucket or route.
      if (
        fault.code === "ENOENT" ||
        fault.code === "NoSuchKey" ||
        fault.name === "NoSuchKey"
      )
        throw new MissingTailSource();
      throw error;
    });
  await pipeline(src, createWriteStream(destPath, { mode: 0o600 }), { signal });
}

/** Extract tail frame from a stored video asset and persist it as a ready `ref` asset. */
export async function createTailFrameAsset(
  p: Platform,
  sql: Sql,
  ownerId: string,
  workspaceId: string,
  sourceAsset: { id: string; public_id: string; object_key: string },
  signal: AbortSignal,
): Promise<{ id: string; public_id: string; width: number; height: number }> {
  const dir = await mkdtemp(join(tmpdir(), "fumiao-tail-src-"));
  const videoPath = join(dir, "source.mp4");
  let frame: TailFrameResult;
  try {
    await materializeStorageObject(
      p,
      sourceAsset.object_key,
      videoPath,
      signal,
    );
    frame = await extractTailFrame(videoPath, signal);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  await capacity(sql, p.storage, frame.bytes.length);
  const id = randomUUID();
  const publicId = id.replaceAll("-", "");
  const objectKey = `tail-${id}`;
  await p.storage.put(objectKey, frame.bytes, "image/jpeg");
  try {
    const row = await one(
      sql,
      `INSERT INTO assets(id,public_id,workspace_id,owner_id,object_key,mime,size,state,original_kind,metadata)
       VALUES($1,$2,$3,$4,$5,'image/jpeg',$6,'ready','ref',$7)
       RETURNING id,public_id`,
      [
        id,
        publicId,
        workspaceId,
        ownerId,
        objectKey,
        frame.bytes.length,
        JSON.stringify({
          width: frame.width,
          height: frame.height,
          derived_from: sourceAsset.public_id,
          derivation: "tail_frame",
        }),
      ],
    );
    return {
      id: row.id as string,
      public_id: row.public_id as string,
      width: frame.width,
      height: frame.height,
    };
  } catch (error) {
    await p.storage.remove(objectKey).catch(() => {});
    throw error;
  }
}

/** Check whether migration 044 (`job_tail_chains`) has been applied on this database. */
export async function hasTailChainTable(sql: Sql): Promise<boolean> {
  const row = await one(sql, "SELECT to_regclass('job_tail_chains') AS name");
  return Boolean(row?.name);
}

/**
 * Wake or fail queued child video jobs chained via `job_tail_chains` (F028).
 * - When parent completes: extracts tail frame once, injects it into each child's
 *   first_frame/references, removes chain row, and inserts outbox wakeups.
 * - When parent fails/cancels: fails waiting children via platform.settle (full refund).
 */
export async function wakeTailFrameChildren(
  p: Platform,
  parentJob: {
    id: string;
    workspace_id: string;
    owner_id: string;
    kind: string;
  },
  parentState: "completed" | "failed" | "cancelled",
  parentVideoAssetId: string | undefined,
  signal: AbortSignal,
): Promise<number> {
  if (parentJob.kind !== "video") return 0;
  if (!(await hasTailChainTable(p.db))) return 0;
  return p.db.transaction(async (sql) => {
    const children = (
      await sql.query(
        `SELECT j.* FROM job_tail_chains c JOIN jobs j ON j.id=c.child_job_id
       WHERE c.parent_job_id=$1 AND j.state='queued' AND j.deleted_at IS NULL
       ORDER BY j.id FOR UPDATE OF c,j`,
        [parentJob.id],
      )
    ).rows;
    if (!children.length) return 0;
    const videoAsset =
      parentState === "completed" && parentVideoAssetId
        ? await one(
            sql,
            "SELECT id, public_id, object_key FROM assets WHERE id=$1 AND workspace_id=$2 AND state='ready' FOR SHARE",
            [parentVideoAssetId, parentJob.workspace_id],
          )
        : undefined;
    let tail: Awaited<ReturnType<typeof createTailFrameAsset>> | undefined;
    if (videoAsset) {
      try {
        tail = await createTailFrameAsset(
          p,
          sql,
          parentJob.owner_id,
          parentJob.workspace_id,
          {
            id: videoAsset.id,
            public_id: videoAsset.public_id,
            object_key: videoAsset.object_key,
          },
          signal,
        );
      } catch (error) {
        if (!(error instanceof MissingTailSource)) throw error;
      }
    }
    if (!tail) {
      for (const child of children) {
        await sql.query("DELETE FROM job_tail_chains WHERE child_job_id=$1", [
          child.id,
        ]);
        await p.settle(
          sql,
          child,
          "failed",
          undefined,
          parentState === "completed"
            ? "前置镜头成片已不可用，已退回后续镜头的冻结积分"
            : "前置镜头生成失败，已自动取消后续串联镜头并退回积分",
        );
      }
      return children.length;
    }
    for (const child of children) {
      const input = structuredClone(child.input ?? {}) as Record<string, any>;
      const refs: string[] = Array.isArray(input.references)
        ? input.references.filter((r: unknown) => typeof r === "string")
        : [];
      if (!refs.includes(tail.id)) refs.unshift(tail.id);
      input.references = refs;
      input.params = { ...(input.params ?? {}) };
      if (
        input.params.h3_inputs &&
        typeof input.params.h3_inputs === "object"
      ) {
        input.params.h3_inputs = {
          ...input.params.h3_inputs,
          mode: "frames",
          first_frame: tail.id,
        };
      }
      let updatedView: Record<string, any> | undefined;
      if (child.source_kind !== "builtin")
        input.params.tail_inherited_from = videoAsset!.public_id;
      else if (child.original_view && typeof child.original_view === "object") {
        updatedView = structuredClone(child.original_view) as Record<string, any>;
        const viewRefs: string[] = Array.isArray(updatedView.refs)
          ? updatedView.refs.filter((r: unknown) => typeof r === "string")
          : [];
        if (!viewRefs.includes(tail.public_id)) viewRefs.unshift(tail.public_id);
        updatedView.refs = viewRefs;
      }
      if (updatedView) {
        await sql.query(
          "UPDATE jobs SET input=$2,original_view=$3,request_retry_at=NULL,request_note=NULL,updated_at=now() WHERE id=$1",
          [child.id, JSON.stringify(input), JSON.stringify(updatedView)],
        );
      } else {
        await sql.query(
          "UPDATE jobs SET input=$2,request_retry_at=NULL,request_note=NULL,updated_at=now() WHERE id=$1",
          [child.id, JSON.stringify(input)],
        );
      }
      await sql.query("DELETE FROM job_tail_chains WHERE child_job_id=$1", [
        child.id,
      ]);
      await sql.query(
        "INSERT INTO job_assets(job_id,asset_id,role) VALUES($1,$2,'input') ON CONFLICT DO NOTHING",
        [child.id, tail.id],
      );
      await sql.query(
        "INSERT INTO outbox(job_id,available_at) VALUES($1,now()) ON CONFLICT (job_id) DO UPDATE SET available_at=now(),sent_at=NULL",
        [child.id],
      );
    }
    return children.length;
  });
}

export type TailFrameActor = Actor;
