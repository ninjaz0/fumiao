import { randomUUID } from "node:crypto";
import { ArtifactValidationError } from "@fumiao/plugin-sdk/preparation.js";
import { one, type Sql } from "../db.js";
import { ensureDerivativeQueued } from "../derivatives.js";
import type { Platform } from "../platform.js";
import {
  generationTransport,
  httpChunks,
  type HttpTransport,
} from "../plugin-host.js";
import { inspectProviderOutput } from "../provider-output.js";
import { DomainError, requireValue } from "../security.js";
import { resolveConnectionRevision } from "./connections.js";
import { routeScopeAllows, type FrozenModelRoute } from "./publication.js";
import {
  decodeInline,
  DefiniteImageFailure,
  maxImageBytes,
  readImageReceipt,
  type ImageOutput,
} from "./image-receipt.js";

type Transport = HttpTransport<string | Uint8Array>;

const validation = {
  version: 3 as const,
  errors: {
    imageFormat: "图片格式无效",
    imageDecode: "图片无法解码",
    video: "视频无法解码",
    failed: "成品无法验收",
  },
};
async function readBody(
  body: Buffer | ReadableStream<Uint8Array>,
  limit: number,
  signal: AbortSignal,
) {
  const chunks: Buffer[] = [];
  for await (const chunk of httpChunks(body, signal, limit)) chunks.push(chunk);
  return Buffer.concat(chunks);
}
async function discard(body: Buffer | ReadableStream<Uint8Array>) {
  if (!Buffer.isBuffer(body)) await body.cancel().catch(() => {});
}

/** One generation call on the admitted connection revision. No endpoint or
 * credential is accepted from the member or from an upstream response. */
async function submitImages(
  p: Platform,
  job: Record<string, any>,
  http: Transport,
  signal: AbortSignal,
) {
  const route: FrozenModelRoute = job.native_snapshot;
  requireValue(
    route.executorVersion === 1 &&
      route.purpose === "image" &&
      (route.protocol === "openrouter-images" ||
        route.protocol === "openai-images"),
    409,
    "图片线路版本不支持",
  );
  const client = await resolveConnectionRevision(
    p.db,
    p,
    route.connectionRevisionId,
    async (url, init, signal) => {
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
          throw new DefiniteImageFailure();
        throw error;
      }
    },
  );
  requireValue(
    routeScopeAllows(client.scope, route.protocol, route.upstreamId),
    403,
    "凭据未授权此模型",
  );
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
    requireValue(total <= maxImageBytes, 413, "参考图片合计过大");
    const bytes = await p.storage.read(asset.object_key);
    requireValue(bytes.length === Number(asset.size), 409, "参考图片已变化");
    references.push({ bytes: new Uint8Array(bytes), mime: asset.mime });
  }
  const fields = {
    ...job.input.params,
    model: route.upstreamId,
    prompt: job.input.prompt,
  };
  let body: string | Uint8Array;
  let contentType = "application/json";
  const router = route.protocol === "openrouter-images";
  const endpoint = router
    ? "images"
    : references.length
      ? "images/edits"
      : "images/generations";
  if (endpoint === "images/edits") {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields))
      form.set(key, String(value));
    for (const [index, ref] of references.entries())
      form.append(
        references.length === 1 ? "image" : "image[]",
        new Blob([ref.bytes], { type: ref.mime }),
        `image-${index}.${ref.mime.split("/")[1]}`,
      );
    const encoded = new Response(form);
    contentType = encoded.headers.get("content-type")!;
    body = new Uint8Array(await encoded.arrayBuffer());
  } else {
    if (references.length)
      fields.input_references = references.map((ref) => ({
        type: "image_url",
        image_url: {
          url: `data:${ref.mime};base64,${Buffer.from(ref.bytes).toString("base64")}`,
        },
      }));
    body = JSON.stringify(fields);
  }
  const response = await client.request(
    {
      endpoint,
      method: "POST",
      model: route.upstreamId,
      body,
      content_type: contentType,
    },
    signal,
  );
  if (response.status < 200 || response.status >= 300) {
    await discard(response.body);
    if (response.status >= 500 || response.status === 408)
      throw new Error("提交结果待核查");
    throw new DefiniteImageFailure();
  }
  return readImageReceipt(
    response.body,
    Number(job.input.params.n ?? 1),
    signal,
    client.containsCredential,
    async (index, bytes) => {
      await p.db.transaction(async (sql) => {
        requireValue(await leased(sql, job), 409, "生成租约已移交");
        await sql.query(
          "INSERT INTO model_access_image_parts(job_id,output_index,bytes) VALUES($1,$2,$3)",
          [job.id, index, bytes],
        );
      });
    },
  );
}
async function outputBytes(
  p: Platform,
  jobId: string,
  index: number,
  output: NonNullable<ImageOutput>,
  http: Transport,
  signal: AbortSignal,
) {
  if ("inline" in output) {
    const part = await one(
      p.db,
      "SELECT bytes FROM model_access_image_parts WHERE job_id=$1 AND output_index=$2",
      [jobId, index],
    );
    return part
      ? Buffer.from(
          part.bytes.buffer,
          part.bytes.byteOffset,
          part.bytes.byteLength,
        )
      : null;
  }
  if ("b64" in output) return decodeInline(output.b64); // Version 060 persisted inline JSON.
  let response;
  try {
    response = await http(
      new URL(output.url),
      { method: "GET", headers: {} },
      signal,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EINTERNAL") return null;
    throw error;
  }
  if (response.status !== 200) {
    await discard(response.body);
    if (response.status >= 500 || [408, 425, 429].includes(response.status))
      throw new Error("图片下载暂不可用");
    return null;
  }
  try {
    return await readBody(response.body, maxImageBytes, signal);
  } catch (error) {
    if (error instanceof DomainError && error.status === 413) return null;
    throw error;
  }
}

async function leased(sql: Sql, job: Record<string, any>) {
  return one(
    sql,
    "SELECT id,state,price,workspace_id,owner_id,source_kind,native_snapshot,meter,receipt IS NOT NULL AS has_receipt FROM jobs WHERE id=$1 AND lease_token=$2 FOR UPDATE",
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

export async function interruptedImageSubmission(
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
    const note = "图片请求已开始发送，提交结果未知，请核对上游记录";
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
    await p.settle(sql, job, "failed", undefined, "图片生成未取得有效回执");
}

/** Reserve the key durably before the put. Reacquire the same job lock while
 * writing, so recovery cannot publish or remove a key that is still in flight. */
async function stage(
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

export async function executeNativeImages(
  p: Platform,
  job: Record<string, any>,
  signal: AbortSignal,
  http: Transport = generationTransport,
) {
  let receipt: { outputs: ImageOutput[] } | null = job.receipt;
  try {
    if (!receipt) {
      receipt = await submitImages(p, job, http, signal);
      if (
        !(await one(
          p.db,
          "UPDATE jobs SET receipt=$3,state='finalizing' WHERE id=$1 AND lease_token=$2 RETURNING id",
          [job.id, job.lease_token, JSON.stringify(receipt)],
        ))
      )
        return;
    }
    let retryDownload = false;
    for (const [index, output] of receipt.outputs.entries()) {
      if (
        !output ||
        (await one(
          p.db,
          "SELECT 1 FROM model_access_staging WHERE job_id=$1 AND output_index=$2 AND metadata IS NOT NULL",
          [job.id, index],
        ))
      )
        continue;
      let bytes: Buffer | null;
      try {
        bytes = await outputBytes(p, job.id, index, output, http, signal);
      } catch {
        signal.throwIfAborted();
        retryDownload = true;
        continue;
      }
      if (!bytes) continue;
      let metadata;
      try {
        metadata = await inspectProviderOutput(
          validation,
          bytes,
          "image",
          false,
          signal,
        );
      } catch (error) {
        if (error instanceof ArtifactValidationError && error.status !== 503)
          continue;
        throw error;
      }
      await stage(p, job, index, bytes, metadata);
    }
    if (retryDownload) throw new Error("图片下载暂不可用");
    await publishImages(p, job, receipt.outputs.length);
  } catch (error) {
    // A durable receipt can be consumed again without a new generation request.
    await p.db.transaction(async (sql) => {
      const current = await leased(sql, job);
      if (!current) return;
      if (current.has_receipt)
        await sql.query(
          `UPDATE jobs SET state='finalizing',lease_token=NULL,lease_until=NULL,
        request_retry_at=now()+interval '5 seconds',request_note='等待重试图片验收' WHERE id=$1`,
          [job.id],
        );
      else
        await interruptedImageSubmission(
          p,
          sql,
          current,
          error instanceof DefiniteImageFailure,
        );
    });
  }
}

async function publishImages(
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
        let remaining = await remainingStorage(sql, job);
        for (const r of rows) {
          if (assets.length >= limit || Number(r.size) > remaining) continue;
          remaining -= Number(r.size);
          attempted++;
          await sql.query(
            `INSERT INTO assets(id,workspace_id,owner_id,object_key,mime,size,state,metadata,original_kind)
          VALUES($1,$2,$3,$4,$5,$6,'ready',$7,'ref')`,
            [
              r.asset_id,
              job.workspace_id,
              job.owner_id,
              r.object_key,
              r.metadata.mime,
              r.size,
              JSON.stringify(r.metadata),
            ],
          );
          await sql.query(
            "INSERT INTO job_assets(job_id,asset_id,role) VALUES($1,$2,'output')",
            [job.id, r.asset_id],
          );
          await ensureDerivativeQueued(sql, r.asset_id, r.metadata.mime);
          assets.push(r.asset_id);
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
            { delivered: { images: assets.length } },
          );
        else
          await p.settle(
            sql,
            current,
            "failed",
            undefined,
            "没有通过验收的图片",
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
