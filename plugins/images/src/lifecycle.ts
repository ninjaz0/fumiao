import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { imagesState } from "./state.js";
import { museJson as pythonJson } from "../../muse/src/json.js";
import {
  imageImporter,
  ProviderImageError,
} from "../../../packages/image-import/src/index.js";
import {
  RequestLifecycleError,
  ArtifactDownloadError,
  ArtifactValidationError,
  type Execution,
  type ProviderPlugin,
} from "../../../packages/plugin-sdk/src/index.js";
export const imageProcessingFailure =
  "图片处理失败，结果未保存；请检查平台记录后再重新生成";
const record = (value: any): Record<string, any> => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid image response");
  return value;
};
const truthy = (v: any): boolean =>
  v != null &&
  v !== false &&
  v !== 0 &&
  v !== "" &&
  (!Array.isArray(v) || v.length > 0) &&
  (typeof v !== "object" || Array.isArray(v) || Object.keys(v).length > 0);
// Keep non-finite usage values in their original JSON text, outside PostgreSQL JSONB numbers.
function usageJson(v: any): string {
  if (typeof v === "number" && !Number.isFinite(v))
    return Number.isNaN(v) ? "NaN" : v > 0 ? "Infinity" : "-Infinity";
  if (Array.isArray(v)) return "[" + v.map(usageJson).join(",") + "]";
  if (v !== null && typeof v === "object")
    return (
      "{" +
      Object.entries(v)
        .map(([k, x]) => JSON.stringify(k) + ":" + usageJson(x))
        .join(",") +
      "}"
    );
  return JSON.stringify(v);
}
const fail = (note: string): never => {
  throw new RequestLifecycleError({ action: "fail", note });
};
export function imageSafeError(status: number, bytes: Buffer) {
  let value: any;
  try {
    value = pythonJson(bytes);
  } catch {
    value = {};
  }
  const root = record(value),
    error = record(Object.hasOwn(root, "error") ? root.error : {}),
    code = truthy(error.code) ? String(error.code) : "",
    message = (
      truthy(error.message)
        ? typeof error.message === "object"
          ? usageJson(error.message)
          : String(error.message)
        : ""
    ).toLowerCase();
  if (code === "insufficient_quota")
    return "OpenAI API 额度不足，请管理员检查额度";
  if (status === 401) return "OpenAI 密钥无效，请管理员检查配置";
  if (message.includes("verif"))
    return "OpenAI 要求完成组织验证，请管理员在平台处理";
  if (
    [
      "content_policy_violation",
      "moderation_blocked",
      "image_generation_user_error",
    ].includes(code) ||
    message.includes("safety")
  )
    return "这次请求未通过 OpenAI 内容审核，请调整提示词或参考图";
  if (status === 429) return "OpenAI 请求频率受限，请稍后重新生成";
  if ([403, 404].includes(status))
    return "当前 OpenAI 项目没有该模型的调用权限";
  if (status === 400) return "OpenAI 未接受这次图片请求，请调整参数或参考图";
  return "OpenAI 服务暂时不可用，请稍后重新生成";
}
const strip = (v: string) =>
  v.replace(
    /^[\t-\r\x1c-\x20\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\t-\r\x1c-\x20\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g,
    "",
  );
export function apiKey(config: Record<string, unknown>) {
  const key = typeof config.apiKey === "string" ? strip(config.apiKey) : "";
  return /^sk-[A-Za-z0-9_-]+$(?![\s\S])/.test(key) ? key : "";
}
export function imagePayload(e: Execution) {
  return {
    model: e.model,
    prompt: e.input.prompt.replace(
      /<Picture (\p{Decimal_Number}+)>/gu,
      "参考图片$1",
    ),
    size: e.input.params.size || "1536x864",
    quality: e.input.params.quality || "medium",
    n: 1,
    output_format: "png",
    safety_identifier: e.input.params.safety_identifier ?? "",
  };
}
export class ConnectionFailure extends Error {}
export async function readPrefix(
  response: Response,
  limit: number,
  activity: () => void,
) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < limit) {
      let next: ReadableStreamReadResult<Uint8Array>;
      try {
        next = await reader.read();
      } catch {
        throw new ConnectionFailure();
      }
      if (next.done) break;
      activity();
      const part = next.value.subarray(0, limit - size);
      size += part.length;
      chunks.push(part);
    }
    return Buffer.concat(chunks, size);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function imageResponse(
  url: URL,
  method: string,
  headers: Record<string, string>,
  body: string | Buffer<ArrayBuffer> | undefined,
  signal: AbortSignal,
  activity: () => void,
) {
  let response: Response;
  const visited = new Map<string, number>();
  for (;;) {
    response = await fetch(url, {
      method,
      body: method === "POST" ? body : undefined,
      headers,
      redirect: "manual",
      signal,
    });
    activity();
    const location =
      response.headers.get("location") ?? response.headers.get("uri");
    if (
      !location ||
      ![301, 302, 303, 307, 308].includes(response.status) ||
      (method === "POST" && [307, 308].includes(response.status))
    )
      break;
    const target = new URL(location, url),
      seen = visited.get(target.href) ?? 0;
    if (
      !["http:", "https:"].includes(target.protocol) ||
      visited.size >= 10 ||
      seen >= 4
    )
      break;
    visited.set(target.href, seen + 1);
    await response.body?.cancel();
    url = target;
    method = "GET";
    delete headers["Content-Type"];
  }
  return response;
}
export const imagesLifecycle: ProviderPlugin = {
  ...imagesState,
  manifest: {
    ...imagesState.manifest,
    version: "1.7.0",
    queue: {
      ...imagesState.manifest.queue!,
      timingVersions: [...imagesState.manifest.queue!.timingVersions, "1.7.0"],
    },
    artifactDownload: { version: 1 },
    artifactValidation: { version: 2 },
    requestLifecycle: {
      version: 3,
      honorImageEnabled: true,
      cancelDisabled: true,
      referenceKinds: ["ref"],
      queueOrder: "fifo",
      progressUpdatesHealth: false,
      recordCancelledRun: true,
      preferFinalizing: false,
      requireConfigured: true,
      atomicReferences: true,
      resumeAccepted: false,
      cancelOnlyWhenAvailable: true,
      executionDeadlineMs: null,
      notes: {
        submitting: "正在生成图片",
        unavailable: null,
        inputUnavailable: imageProcessingFailure,
        inputFailed: imageProcessingFailure,
        submitFailed: imageProcessingFailure,
        saveFailed: imageProcessingFailure,
        recoverySaveFailed: imageProcessingFailure,
        disabled: "账户已停用",
        unknownSubmission:
          "服务重启，生成结果未确认；请检查 OpenAI 平台记录后再重新生成",
      },
    },
  },
  originalState: {
    ...imagesState.originalState!,
    configured: (c) => Boolean(apiKey(c)),
  },
  requestCapacity: () => 1,
  async submit(e) {
    const payload = imagePayload(e);
    await e.reportTiming?.({ job_phase: "generating" });
    const key = apiKey(e.config);
    if (!key) fail("图片生成尚未配置，请联系管理员");
    const headers: Record<string, string> = { Authorization: "Bearer " + key };
    let body: string | Buffer<ArrayBuffer> = JSON.stringify(payload);
    if (e.input.references.length) {
      const boundary = "fumiao-" + randomUUID().replaceAll("-", ""),
        parts: Buffer[] = [];
      for (const [name, value] of Object.entries(payload))
        parts.push(
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
          ),
        );
      for (const [i, ref] of e.input.references.entries()) {
        const suffix = (
          {
            "image/png": "png",
            "image/jpeg": "jpg",
            "image/webp": "webp",
          } as Record<string, string>
        )[ref.mime];
        if (!suffix) throw new Error("Invalid reference MIME");
        parts.push(
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="image[]"; filename="reference-${i + 1}.${suffix}"\r\nContent-Type: ${ref.mime}\r\n\r\n`,
          ),
          Buffer.from(ref.url.slice(ref.url.indexOf(",") + 1), "base64"),
          Buffer.from("\r\n"),
        );
      }
      parts.push(Buffer.from(`--${boundary}--\r\n`));
      body = Buffer.concat(parts);
      headers["Content-Type"] = "multipart/form-data; boundary=" + boundary;
    } else headers["Content-Type"] = "application/json";
    const idle = new AbortController(),
      timer = setTimeout(() => idle.abort(), 600000);
    let errorResponse = false;
    try {
      let url = new URL(
          "v1/images/" + (e.input.references.length ? "edits" : "generations"),
          String(e.config.baseUrl).replace(/\/+$/, "") + "/",
        ),
        method = "POST",
        response: Response;
      response = await imageResponse(
        url,
        method,
        headers,
        body,
        AbortSignal.any([e.signal, idle.signal]),
        () => timer.refresh(),
      );
      if (!response.ok) {
        errorResponse = true;
        fail(
          imageSafeError(
            response.status,
            await readPrefix(response, 65536, () => timer.refresh()),
          ),
        );
      }
      const bytes = await readPrefix(response, 64 * 1024 ** 2 + 1, () =>
        timer.refresh(),
      );
      if (bytes.length > 64 * 1024 ** 2) fail("生成结果过大，未保存");
      const result = pythonJson(bytes);
      await e.reportTiming?.({ job_phase: "finalizing" });
      const root = record(result),
        data = Object.hasOwn(root, "data") ? root.data : [];
      if (data === null || !["string", "object"].includes(typeof data))
        throw new Error("Invalid image data");
      const length =
        typeof data === "string"
          ? [...data].length
          : Array.isArray(data)
            ? data.length
            : Object.keys(data).length;
      if (length !== 1) fail("OpenAI 没有返回有效图片");
      if (!Array.isArray(data)) throw new Error("Invalid image data index");
      const image = record(data[0]);
      if (typeof image.b64_json !== "string") fail("OpenAI 没有返回有效图片");
      return {
        state: "completed",
        artifacts: [{ url: "data:image/png;base64," + image.b64_json }],
        providerResponse: {
          version: 1,
          requestId: response.headers.get("x-request-id") ?? "",
          usageJson: usageJson(Object.hasOwn(root, "usage") ? root.usage : {}),
        },
      };
    } catch (error) {
      if (error instanceof RequestLifecycleError) throw error;
      if (
        !errorResponse &&
        (error instanceof ConnectionFailure ||
          (error instanceof TypeError && error.message === "fetch failed") ||
          idle.signal.aborted ||
          e.signal.aborted)
      )
        fail("与 OpenAI 的连接中断，结果未确认；请检查平台记录后再重新生成");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  },
  async downloadArtifact({ url }) {
    const prefix = "data:image/png;base64,",
      value = url.slice(prefix.length);
    // Python b64decode(validate=True): require padding but do not require zero pad bits.
    const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
    if (
      !url.startsWith(prefix) ||
      value.length % 4 !== 0 ||
      /[^A-Za-z0-9+/]/.test(value.slice(0, value.length - padding)) ||
      (padding > 0 && value.length < 4)
    )
      throw new ArtifactDownloadError(imageProcessingFailure, "failed");
    const bytes = Buffer.from(value, "base64");
    if (bytes.length > 32 * 1024 ** 2)
      throw new ArtifactDownloadError("生成图片超过 32 MB，未保存", "failed");
    return bytes;
  },
  async validateArtifact(_job, bytes, _receipt, signal) {
    const directory = await mkdtemp(join(tmpdir(), "fumiao-generated-png-"));
    try {
      const path = join(directory, "input");
      await writeFile(path, bytes, { mode: 0o600 });
      return {
        metadata: await imageImporter.inspectGeneratedPng(path, signal),
      };
    } catch (error) {
      throw new ArtifactValidationError(
        error instanceof ProviderImageError && error.kind === "format"
          ? "生成图片格式无效"
          : imageProcessingFailure,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
};
