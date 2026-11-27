import { DefiniteSubmissionFailure } from "./submission-failure.js";
import { ArtifactValidationError } from "@fumiao/plugin-sdk/preparation.js";
import { one, type Sql } from "../db.js";
import type { Platform } from "../platform.js";
import { generationTransport, requirePublicHttps } from "../plugin-host.js";
import { inspectProviderOutput } from "../provider-output.js";
import { DomainError, requireValue } from "../security.js";
import { resolveConnectionRevision } from "./connections.js";
import { prepareVideoParameters } from "./video-parameters.js";
import { routeScopeAllows, type FrozenModelRoute } from "./publication.js";
import {
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

type Client = Awaited<ReturnType<typeof submissionClient>>;
type VideoReceipt = { id: string; index?: number; signed?: string };
type Job = Record<string, any>;
const terminalFailure = ["failed", "cancelled", "canceled", "expired"];
class InvalidVideo extends Error {}

/** Authorized GETs are reconstructed from these two identities; never pass a
 * provider-supplied URL to a transport holding a credential. */
export function videoPollingUrl(
  client: Pick<Client, "base_url" | "containsCredential">,
  id: unknown,
) {
  requireValue(
    typeof id === "string" &&
      id !== "models" &&
      /^[a-zA-Z0-9_-][a-zA-Z0-9_.:-]{0,499}$/.test(id) &&
      !client.containsCredential(id),
    400,
    "视频任务编号无效",
  );
  return client.base_url + "/videos/" + encodeURIComponent(id);
}

/** Older OpenRouter workers kept the ID when they rejected a poll URL.
 * Its source is the sealed connection revision, including after key rotation.
 * As an owner gains a canonical URL, the unique index takes over without a gap. */
export async function bindVideoRemote(
  sql: Sql,
  p: Platform,
  job: Job,
  client: Client,
  id: unknown,
) {
  const location = videoPollingUrl(client, id);
  const legacy = await sql.query<{ revision_id: string }>(
    `SELECT DISTINCT native_snapshot->>'connectionRevisionId' AS revision_id FROM jobs
     WHERE source_kind='builtin' AND kind='video' AND native_polling_url IS NULL
       AND connection_id=$1 AND remote_id=$2 AND id<>$3`,
    [job.connection_id, id, job.id],
  );
  for (const owner of legacy.rows) {
    const frozen = await resolveConnectionRevision(sql, p, owner.revision_id);
    requireValue(
      frozen.base_url !== client.base_url,
      409,
      "上游编号已关联其他任务",
    );
  }
  try {
    await sql.query(
      "UPDATE jobs SET remote_id=$2,native_polling_url=$3 WHERE id=$1",
      [job.id, id, location],
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "23505")
      throw new DomainError(409, "上游编号已关联其他任务");
    throw error;
  }
  return location;
}

async function jsonResponse(
  response: Awaited<ReturnType<Transport>>,
  signal: AbortSignal,
  submitting = false,
) {
  if (response.status < 200 || response.status >= 300) {
    await discard(response.body);
    if (
      response.status >= 500 ||
      (submitting && response.status >= 300 && response.status < 400) ||
      response.status === 408 ||
      (!submitting && [425, 429].includes(response.status))
    )
      throw new Error("上游暂不可用");
    if (submitting) throw new DefiniteSubmissionFailure();
    throw new InvalidVideo();
  }
  const bytes = await readBody(response.body, 256 * 1024, signal);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    // A lost create response may represent a paid order. A completed GET with
    // no protocol document cannot identify any deliverable on this job.
    if (submitting) throw error;
    throw new InvalidVideo();
  }
}

function matchesPolling(raw: unknown, expected: string) {
  if (typeof raw !== "string" || !raw || raw.length > 8192) return false;
  try {
    return new URL(raw, expected).href === expected;
  } catch {
    return false;
  }
}

async function createVideo(
  p: Platform,
  job: Job,
  client: Client,
  router: boolean,
  signal: AbortSignal,
) {
  const [frame] = await readReferences(p, job);
  const { seconds, ...params } = prepareVideoParameters(
    job.native_snapshot,
    job.input.params,
    job.input.references.length,
  ).params;
  const fields = {
    model: job.native_snapshot.upstreamId,
    prompt: job.input.prompt,
    ...params,
  };
  let body: string | Uint8Array, contentType: string;
  if (router) {
    body = JSON.stringify({
      ...fields,
      duration: seconds,
      ...(frame
        ? {
            frame_images: [
              {
                frame_type: "first_frame",
                type: "image_url",
                image_url: {
                  url: `data:${frame.mime};base64,${Buffer.from(frame.bytes).toString("base64")}`,
                },
              },
            ],
          }
        : {}),
    });
    contentType = "application/json";
  } else {
    const form = new FormData();
    for (const [key, value] of Object.entries({ ...fields, seconds }))
      form.set(key, String(value));
    if (frame)
      form.set(
        "input_reference",
        new Blob([frame.bytes], { type: frame.mime }),
        "first-frame." + frame.mime.split("/")[1],
      );
    const encoded = new Response(form);
    body = new Uint8Array(await encoded.arrayBuffer());
    contentType = encoded.headers.get("content-type")!;
  }
  const response = await client.request(
    {
      endpoint: "videos",
      method: "POST",
      model: job.native_snapshot.upstreamId,
      body,
      content_type: contentType,
    },
    signal,
  );
  const result = await jsonResponse(response, signal, true);
  if (terminalFailure.includes(result?.status))
    throw new DefiniteSubmissionFailure();
  await p.db.transaction(async (sql) => {
    const current = await leased(sql, job);
    if (!current) return;
    const location = await bindVideoRemote(sql, p, job, client, result?.id);
    if (router && !matchesPolling(result.polling_url, location)) {
      await interruptedMediaSubmission(p, sql, current);
      return;
    }
    await sql.query(
      `UPDATE jobs SET state='running',lease_token=NULL,lease_until=NULL,
      updated_at=now(),request_retry_at=now()+interval '30 seconds' WHERE id=$1`,
      [job.id],
    );
  });
}

function outputLocation(
  client: Client,
  id: string,
  result: Record<string, unknown>,
): VideoReceipt {
  const expected = videoPollingUrl(client, id) + "/content";
  if (Array.isArray(result.unsigned_urls) && result.unsigned_urls.length) {
    const raw = result.unsigned_urls[0];
    if (typeof raw !== "string" || !raw.trim() || raw.length > 8192)
      throw new InvalidVideo();
    let url: URL;
    try {
      url = new URL(raw, expected);
    } catch {
      throw new InvalidVideo();
    }
    if (url.href === expected) return { id };
    const index = url.searchParams.get("index");
    if (
      !index ||
      !/^(0|[1-9]\d{0,8})$/.test(index) ||
      url.href !== expected + "?index=" + index
    )
      throw new InvalidVideo();
    return { id, index: Number(index) };
  }
  if (Array.isArray(result.urls)) {
    const raw = result.urls[0];
    if (typeof raw === "string" && raw.length <= 8192) {
      try {
        const url = new URL(raw);
        requirePublicHttps(url);
        if (
          !url.hash &&
          !client.containsCredential(url.href) &&
          !client.containsCredential(decodeURIComponent(url.href))
        )
          return { id, signed: url.href };
      } catch {
        /* reject unusable output */
      }
    }
  }
  throw new InvalidVideo();
}

async function pollVideo(
  client: Client,
  job: Job,
  router: boolean,
  signal: AbortSignal,
) {
  const id = job.remote_id;
  if (job.native_polling_url !== videoPollingUrl(client, id))
    throw new InvalidVideo();
  const response = await client.request(
    { endpoint: "videos", method: "GET", video_resource: { id } },
    signal,
  );
  const result = await jsonResponse(response, signal);
  if (
    result?.id !== id ||
    (result.polling_url !== undefined &&
      !matchesPolling(result.polling_url, job.native_polling_url))
  )
    throw new InvalidVideo();
  if (
    ["pending", "queued", "in_progress"].includes(result.status) ||
    (!router && result.status === "processing")
  )
    return null;
  if (
    result.status === "completed" ||
    (!router && result.status === "succeeded")
  )
    return router ? outputLocation(client, id, result) : { id };
  throw new InvalidVideo();
}

async function finalize(
  p: Platform,
  job: Job,
  client: Client,
  receipt: VideoReceipt,
  http: Transport,
  signal: AbortSignal,
) {
  if (receipt.id !== job.remote_id) throw new InvalidVideo();
  const staged = await one(
    p.db,
    "SELECT 1 FROM model_access_staging WHERE job_id=$1 AND output_index=0 AND metadata IS NOT NULL",
    [job.id],
  );
  if (!staged) {
    const response = receipt.signed
      ? await http(
          new URL(receipt.signed),
          { method: "GET", headers: {} },
          signal,
        )
      : await client.request(
          {
            endpoint: "videos",
            method: "GET",
            video_resource: {
              id: receipt.id,
              content: true,
              index: receipt.index,
            },
          },
          signal,
        );
    if (response.status !== 200) {
      await discard(response.body);
      if (response.status >= 500 || [408, 425, 429].includes(response.status))
        throw new Error("取片暂不可用");
      throw new InvalidVideo();
    }
    const bytes = await readBody(response.body, 64 << 20, signal);
    const metadata = await inspectProviderOutput(
      validation,
      bytes,
      "video",
      false,
      signal,
      true,
    );
    await stage(p, job, 0, bytes, metadata);
  }
  await publishMedia(p, job, 1);
}

async function retry(sql: Sql, current: Job) {
  const finalizing = current.has_receipt;
  await sql.query(
    `UPDATE jobs SET state=$2,lease_token=NULL,lease_until=NULL,
    request_note=$3,request_retry_at=now()+$4::interval WHERE id=$1`,
    [
      current.id,
      finalizing ? "finalizing" : "running",
      finalizing ? "等待重试视频验收" : "等待查询上游视频",
      finalizing ? "5 seconds" : "30 seconds",
    ],
  );
}

export async function executeNativeVideos(
  p: Platform,
  job: Job,
  signal: AbortSignal,
  http: Transport = generationTransport,
) {
  try {
    const route: FrozenModelRoute = job.native_snapshot;
    const router = route.protocol === "openrouter-videos";
    requireValue(
      route.executorVersion === 1 &&
        route.purpose === "video" &&
        (router || route.protocol === "new-api-videos"),
      409,
      "视频线路版本不支持",
    );
    const client = await submissionClient(p, job, route, http);
    requireValue(
      routeScopeAllows(client.scope, route.protocol, route.upstreamId),
      403,
      "凭据未授权此视频模型",
    );
    if (!job.remote_id) {
      requireValue(
        job.state === "dispatching" && !job.receipt,
        409,
        "视频任务缺少上游编号",
      );
      await createVideo(p, job, client, router, signal);
      return;
    }
    let receipt: VideoReceipt | null = job.receipt;
    if (!receipt) {
      receipt = await pollVideo(client, job, router, signal);
      if (!receipt) {
        await p.db.transaction(async (sql) => {
          const current = await leased(sql, job);
          if (current) await retry(sql, current);
        });
        return;
      }
      if (
        !(await one(
          p.db,
          "UPDATE jobs SET receipt=$3,state='finalizing' WHERE id=$1 AND lease_token=$2 RETURNING id",
          [job.id, job.lease_token, JSON.stringify(receipt)],
        ))
      )
        return;
    }
    await finalize(p, job, client, receipt, http, signal);
  } catch (error) {
    await p.db.transaction(async (sql) => {
      const current = await leased(sql, job);
      if (!current) return;
      if (!current.remote_id)
        await interruptedMediaSubmission(
          p,
          sql,
          current,
          error instanceof DefiniteSubmissionFailure,
        );
      else if (
        error instanceof InvalidVideo ||
        (error instanceof ArtifactValidationError && error.status !== 503) ||
        (error instanceof DomainError &&
          [400, 403, 404, 413].includes(error.status)) ||
        (error as NodeJS.ErrnoException).code === "EINTERNAL"
      )
        await p.settle(
          sql,
          current,
          "failed",
          undefined,
          "视频生成失败或没有可验收的成片",
        );
      else await retry(sql, current);
    });
  }
}
