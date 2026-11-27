import { randomUUID } from "node:crypto";
import { ArtifactValidationError } from "@fumiao/plugin-sdk/preparation.js";
import { artifactCapacity } from "../capacity.js";
import { one, type Sql } from "../db.js";
import { ensureDerivativeQueued } from "../derivatives.js";
import type { Platform } from "../platform.js";
import {
  generationTransport,
  httpChunks,
  requirePublicHttps,
  type HttpTransport,
} from "../plugin-host.js";
import { inspectProviderOutput } from "../provider-output.js";
import { DomainError, requireValue } from "../security.js";
import { resolveConnectionRevision } from "./connections.js";
import { routeScopeAllows, type FrozenModelRoute } from "./publication.js";

type Transport = HttpTransport<string | Uint8Array>;
type Output = { b64: string } | { url: string } | null;
const maxMediaBytes = 64 * 1024 * 1024;
const maxReceiptBytes = Math.ceil(maxMediaBytes / 3) * 4 + 1024 * 1024;
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
    http,
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
    requireValue(total <= maxMediaBytes, 413, "参考图片合计过大");
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
    throw new DomainError(502, "上游未返回图片");
  }
  const json = JSON.parse(
    (await readBody(response.body, maxReceiptBytes, signal)).toString("utf8"),
  );
  requireValue(Array.isArray(json?.data), 502, "上游图片回执无效");
  const count = Number(job.input.params.n ?? 1);
  const outputs: Output[] = json.data.slice(0, count).map((item: any) => {
    if (
      typeof item?.b64_json === "string" &&
      item.b64_json.length &&
      item.b64_json.length <= 4 * Math.ceil(maxMediaBytes / 3) &&
      !client.containsCredential(item.b64_json)
    )
      return { b64: item.b64_json };
    if (
      typeof item?.url === "string" &&
      item.url.length <= 8192 &&
      !client.containsCredential(item.url)
    ) {
      try {
        const url = new URL(item.url);
        requirePublicHttps(url);
        if (!client.containsCredential(decodeURIComponent(url.href)))
          return { url: url.href };
      } catch {
        /* Discard just this invalid output. */
      }
    }
    return null;
  });
  return { outputs };
}
async function outputBytes(
  output: NonNullable<Output>,
  http: Transport,
  signal: AbortSignal,
) {
  if ("b64" in output) {
    if (
      !/^[A-Za-z0-9+/]+={0,2}$/.test(output.b64) ||
      output.b64.length % 4 === 1
    )
      return null;
    const bytes = Buffer.from(output.b64, "base64");
    return bytes.length <= maxMediaBytes ? bytes : null;
  }
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
    return await readBody(response.body, maxMediaBytes, signal);
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
    await artifactCapacity(sql, p.storage, job.id, bytes.length);
    await p.storage.put(slot.object_key, bytes, metadata.mime);
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
  let receipt: { outputs: Output[] } | null = job.receipt;
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
        bytes = await outputBytes(output, http, signal);
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
      for (const r of rows) {
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
        "DELETE FROM model_access_staging WHERE job_id=$1 AND metadata IS NOT NULL",
        [job.id],
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
        await p.settle(sql, current, "failed", undefined, "没有通过验收的图片");
    });
  } catch {
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
        await p.settle(
          sql,
          current,
          "failed",
          undefined,
          "图片生成未取得有效回执",
        );
    });
  }
}
