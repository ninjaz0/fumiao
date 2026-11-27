import { ArtifactValidationError } from "@fumiao/plugin-sdk/preparation.js";
import { one } from "../db.js";
import type { Platform } from "../platform.js";
import { generationTransport } from "../plugin-host.js";
import { inspectProviderOutput } from "../provider-output.js";
import { DomainError, requireValue } from "../security.js";
import { routeScopeAllows, type FrozenModelRoute } from "./publication.js";
import {
  decodeInline,
  DefiniteImageFailure,
  maxImageBytes,
  readImageReceipt,
  type ImageOutput,
} from "./image-receipt.js";
import {
  DefiniteSubmissionFailure,
  discard,
  interruptedMediaSubmission,
  leased,
  publishMedia,
  readBody,
  readReferences,
  stage,
  submissionClient,
  type Transport,
  validation,
} from "./media-delivery.js";
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
  const client = await submissionClient(p, job, route, http);
  requireValue(
    routeScopeAllows(client.scope, route.protocol, route.upstreamId),
    403,
    "凭据未授权此模型",
  );
  const references = await readReferences(p, job);
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
    response.status === 202,
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
    await publishMedia(p, job, receipt.outputs.length);
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
        await interruptedMediaSubmission(
          p,
          sql,
          current,
          error instanceof DefiniteSubmissionFailure,
        );
    });
  }
}
