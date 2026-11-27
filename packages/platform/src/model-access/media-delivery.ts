import { DefiniteSubmissionFailure } from "./submission-failure.js";
import { randomUUID } from "node:crypto";

import { one, type Sql } from "../db.js";
import { ensureDerivativeQueued } from "../derivatives.js";
import type { Platform } from "../platform.js";
import { httpChunks, type HttpTransport } from "../plugin-host.js";

import { requireValue } from "../security.js";
import { resolveConnectionRevision } from "./connections.js";
import type { FrozenModelRoute } from "./publication.js";
export type Transport = HttpTransport<string | Uint8Array>;

export const validation = {
  version: 3 as const,
  errors: {
    imageFormat: "图片格式无效",
    imageDecode: "图片无法解码",
    video: "视频无法解码",
    failed: "成品无法验收",
  },
};
export async function readBody(
  body: Buffer | ReadableStream<Uint8Array>,
  limit: number,
  signal: AbortSignal,
) {
  const chunks: Buffer[] = [];
  for await (const chunk of httpChunks(body, signal, limit)) chunks.push(chunk);
  return Buffer.concat(chunks);
}
export async function discard(body: Buffer | ReadableStream<Uint8Array>) {
  if (!Buffer.isBuffer(body)) await body.cancel().catch(() => {});
}

export function submissionClient(
  p: Platform,
  job: Record<string, any>,
  route: FrozenModelRoute,
  http: Transport,
) {
  return resolveConnectionRevision(
    p.db,
    p,
    route.connectionRevisionId,
    async (url, init, signal) => {
      if (init.method !== "POST") return http(url, init, signal);
      signal.throwIfAborted();
      await p.db.transaction(async (sql) => {
        requireValue(await leased(sql, job), 409, "生成租约已移交");
        requireValue(
          await one(
            sql,
            "INSERT INTO model_access_submissions(job_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING job_id",
            [job.id],
          ),
          409,
          "请求已开始发送",
        );
      });
      try {
        return await http(url, init, signal);
      } catch (error) {
        // DNS rejection or a refused TCP connection cannot have sent a POST.
        if (
          [
            "ENOTFOUND",
            "EAI_AGAIN",
            "EINTERNAL",
            "ECONNREFUSED",
            "ENETUNREACH",
            "EHOSTUNREACH",
          ].includes((error as NodeJS.ErrnoException).code ?? "")
        )
          throw new DefiniteSubmissionFailure();
        throw error;
      }
    },
  );
}

export async function readReferences(p: Platform, job: Record<string, any>) {
  const references: { bytes: Uint8Array<ArrayBuffer>; mime: string }[] = [];
  let total = 0;
  for (const id of job.input.references) {
    const asset = await one(
      p.db,
      `SELECT a.object_key,a.mime,a.size FROM assets a JOIN job_assets ja ON a.id=ja.asset_id
      WHERE a.id=$1 AND ja.job_id=$2 AND ja.role='input' AND a.workspace_id=$3 AND a.state='ready'`,
      [id, job.id, job.workspace_id],
    );
    requireValue(
      asset && asset.mime.startsWith("image/"),
      404,
      "参考图片不可用",
    );
    total += Number(asset.size);
    requireValue(total <= 64 * 1024 * 1024, 413, "参考图片合计过大");
    const bytes = await p.storage.read(asset.object_key);
    requireValue(bytes.length === Number(asset.size), 409, "参考图片已变化");
    references.push({ bytes: new Uint8Array(bytes), mime: asset.mime });
  }
  return references;
}

export async function leased(sql: Sql, job: Record<string, any>) {
  return one(
    sql,
    "SELECT id,state,kind,remote_id,price,workspace_id,owner_id,source_kind,native_snapshot,meter,receipt IS NOT NULL AS has_receipt FROM jobs WHERE id=$1 AND lease_token=$2 FOR UPDATE",
    [job.id, job.lease_token],
  );
}

/** This job can use its own hold once across the complete delivery. Recheck
 * inside publication; a concurrent writer may still win at deferred COMMIT. */
async function remainingStorage(sql: Sql, job: Record<string, any>) {
  const row = await one(
    sql,
    `SELECT LEAST(w.storage_limit-w.storage_used,
    c.quota-c.used-c.reserved+GREATEST(0,COALESCE(h.budget-h.materialized,0))) AS bytes
    FROM workspaces w CROSS JOIN storage_capacity c LEFT JOIN storage_holds h ON h.job_id=$1
    WHERE w.id=$2 AND c.singleton`,
    [job.id, job.workspace_id],
  );
  return Number(row.bytes);
}

export async function interruptedMediaSubmission(
  p: Platform,
  sql: Sql,
  job: Record<string, any>,
  definite = false,
) {
  if (
    !definite &&
    (await one(sql, "SELECT 1 FROM model_access_submissions WHERE job_id=$1", [
      job.id,
    ]))
  ) {
    const note =
      (job.kind === "video" ? "视频" : "图片") +
      "请求已开始发送，提交结果未知，请核对上游记录";
    await sql.query(
      `UPDATE jobs SET state='uncertain',request_uncertain=true,lease_token=NULL,lease_until=NULL,
      error=$2,request_note=$2,updated_at=now() WHERE id=$1`,
      [job.id, note],
    );
    await sql.query(
      "INSERT INTO job_events(job_id,state) VALUES($1,'uncertain')",
      [job.id],
    );
  } else
    await p.settle(
      sql,
      job,
      "failed",
      undefined,
      job.kind === "video"
        ? "视频生成未取得有效回执"
        : "图片生成未取得有效回执",
    );
}

/** Reserve the key durably before the put. Reacquire the same job lock while
 * writing, so recovery cannot publish or remove a key that is still in flight. */
export async function stage(
  p: Platform,
  job: Record<string, any>,
  index: number,
  bytes: Buffer,
  metadata: Record<string, unknown> & { mime: string },
) {
  const slot = await p.db.transaction(async (sql) => {
    if (!(await leased(sql, job))) return;
    const id = randomUUID();
    return one(
      sql,
      `INSERT INTO model_access_staging(job_id,output_index,asset_id,object_key) VALUES($1,$2,$3,$4)
      ON CONFLICT(job_id,output_index) DO UPDATE SET output_index=excluded.output_index RETURNING *`,
      [job.id, index, id, "output-" + id],
    );
  });
  if (!slot || slot.metadata) return;
  await p.db.transaction(async (sql) => {
    if (!(await leased(sql, job))) return;
    const staged = await one(
      sql,
      "SELECT COALESCE(sum(size),0) AS bytes FROM model_access_staging WHERE job_id=$1",
      [job.id],
    );
    const total = Number(staged.bytes) + bytes.length;
    if (total > (await remainingStorage(sql, job))) return;
    if (
      p.storage.availableBytes &&
      (await p.storage.availableBytes()) < bytes.length + (1 << 30)
    )
      return;
    try {
      await p.storage.put(slot.object_key, bytes, metadata.mime);
    } catch (error) {
      if (
        ["ENOSPC", "EDQUOT"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        return;
      throw error;
    }
    await sql.query(
      "UPDATE model_access_staging SET metadata=$3,size=$4 WHERE job_id=$1 AND output_index=$2",
      [
        job.id,
        index,
        JSON.stringify({ ...metadata, outputIndex: index }),
        bytes.length,
      ],
    );
  });
}
export async function cleanupNativeStaging(p: Platform, sql: Sql) {
  const rows =
    await sql.query(`SELECT s.* FROM model_access_staging s JOIN jobs j ON j.id=s.job_id
    WHERE j.state IN ('failed','cancelled','completed') ORDER BY s.job_id,s.output_index LIMIT 32 FOR UPDATE OF s SKIP LOCKED`);
  for (const row of rows.rows) {
    try {
      await p.storage.remove(row.object_key, AbortSignal.timeout(10_000));
    } catch {
      // Keep the durable cleanup marker for the next worker sweep.
      continue;
    }
    await sql.query(
      "DELETE FROM model_access_staging WHERE job_id=$1 AND output_index=$2",
      [row.job_id, row.output_index],
    );
  }
}

export async function publishMedia(
  p: Platform,
  job: Record<string, any>,
  limit: number,
) {
  // PG checks workspace capacity during INSERT and global capacity at COMMIT.
  // Re-read quotas after the first rollback: a smaller later image may now
  // fit. Further conflicts reduce the candidate count to guarantee settlement.
  let firstConflict = true;
  for (;;) {
    let attempted = 0;
    try {
      await p.db.transaction(async (sql) => {
        const current = await leased(sql, job);
        if (!current) return;
        const rows = (
          await sql.query(
            "SELECT * FROM model_access_staging WHERE job_id=$1 AND metadata IS NOT NULL ORDER BY output_index",
            [job.id],
          )
        ).rows;
        const assets: string[] = [];
        let milliseconds = 0;
        let remaining = await remainingStorage(sql, job);
        for (const r of rows) {
          if (assets.length >= limit || Number(r.size) > remaining) continue;
          remaining -= Number(r.size);
          attempted++;
          await sql.query(
            `INSERT INTO assets(id,workspace_id,owner_id,object_key,mime,size,state,metadata,original_kind)
          VALUES($1,$2,$3,$4,$5,$6,'ready',$7,$8)`,
            [
              r.asset_id,
              job.workspace_id,
              job.owner_id,
              r.object_key,
              r.metadata.mime,
              r.size,
              JSON.stringify(r.metadata),
              job.kind === "video" ? "video" : "ref",
            ],
          );
          await sql.query(
            "INSERT INTO job_assets(job_id,asset_id,role) VALUES($1,$2,'output')",
            [job.id, r.asset_id],
          );
          await ensureDerivativeQueued(sql, r.asset_id, r.metadata.mime);
          assets.push(r.asset_id);
          if (job.kind === "video") milliseconds += r.metadata.milliseconds;
        }
        await sql.query(
          "DELETE FROM model_access_staging WHERE job_id=$1 AND asset_id=ANY($2::uuid[])",
          [job.id, assets],
        );
        if (assets.length)
          await p.settle(
            sql,
            current,
            "completed",
            { assets },
            undefined,
            undefined,
            {
              delivered:
                job.kind === "video"
                  ? { milliseconds }
                  : { images: assets.length },
            },
          );
        else
          await p.settle(
            sql,
            current,
            "failed",
            undefined,
            job.kind === "video" ? "没有通过验收的视频" : "没有通过验收的图片",
          );
      });
      return;
    } catch (error) {
      if (
        !attempted ||
        !["P1001", "P1002"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        throw error;
      if (!firstConflict) limit--;
      firstConflict = false;
    }
  }
}
