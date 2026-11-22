import { flowArtifacts } from "./artifacts.js";
import { collectFlowEvent, flowResult, flowSafeError, FlowFailure, record, truthy } from "./stream-policy.js";
export { flowResult, flowSafeError } from "./stream-policy.js";
import { pythonJson } from "@fumiao/plugin-sdk/json.js";
import {
  splitArtifactUrl,
  RequestLifecycleError,
  type Execution,
  type ProviderPlugin,
  type Receipt,
} from "@fumiao/plugin-sdk/index.js";
class FlowConnectionFailure extends Error {}
type Body = AsyncIterable<Uint8Array> | ReadableStream<Uint8Array> | null;
async function* readBody(
  body: ReadableStream<Uint8Array> | null,
  activity: () => void,
) {
  if (!body) return;
  const reader = body.getReader();
  try {
    for (;;) {
      let next: ReadableStreamReadResult<Uint8Array>;
      try {
        next = await reader.read();
      } catch {
        throw new FlowConnectionFailure();
      }
      if (next.done) return;
      activity();
      yield next.value;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export function flowPayload(e: Execution) {
  const spec = flowArtifacts.manifest.models.find((m) => m.id === e.model)
    ?.studio?.descriptor;
  if (!spec) throw new Error("Invalid Flow model");
  const content: any[] = [
    { type: "text", text: e.input.prompt },
    ...e.input.references.map((r) => ({
      type: "image_url",
      image_url: { url: r.url },
    })),
  ];
  if (e.input.params.source_media_id)
    content.push({
      type: "image_url",
      image_url: { url: "extend://" + e.input.params.source_media_id },
    });
  return {
    model: spec.upstream,
    messages: [{ role: "user", content }],
    stream: true,
  };
}
async function prefix(body: Body, limit: number) {
  if (!body) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body as any) {
    const part = chunk.subarray(0, limit - total);
    chunks.push(part);
    total += part.length;
    if (total === limit) break;
  }
  return Buffer.concat(chunks);
}
export async function flowStream(
  body: Body,
  e: Pick<Execution, "kind" | "reportProviderNote">,
  now = () => Number(process.hrtime.bigint()) / 1e9,
): Promise<Receipt> {
  let pending: Buffer[] = [],
    pendingSize = 0,
    total = 0,
    lastProgress = 0,
    done = false;
  const chunks: string[] = [],
    diagnostics: string[] = [];
  async function line(raw: Buffer) {
    total += raw.length;
    if (total > 8 * 1024 ** 2)
      throw new FlowFailure("Flow 返回内容过大，未保存结果");
    if (!raw.subarray(0, 5).equals(Buffer.from("data:"))) return;
    // bytes.strip() removes ASCII whitespace only; Unicode trimming changes JSON validity.
    let value = raw.subarray(5),
      a = 0,
      b = value.length;
    const space = (x: number) => x === 32 || (x >= 9 && x <= 13);
    while (a < b && space(value[a])) a++;
    while (b > a && space(value[b - 1])) b--;
    value = value.subarray(a, b);
    if (value.equals(Buffer.from("[DONE]"))) {
      done = true;
      return;
    }
    let data: any;
    try {
      data = pythonJson(value);
    } catch {
      return;
    }
    collectFlowEvent(data, chunks, diagnostics);
    const stamp = now();
    if (stamp - lastProgress > 8) {
      lastProgress = stamp;
      await e.reportProviderNote?.("Flow 正在生成");
    }
  }
  if (body)
    for await (const bytes of body as any) {
      const chunk = Buffer.from(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      );
      let offset = 0,
        end: number;
      while ((end = chunk.indexOf(10, offset)) >= 0) {
        const part = chunk.subarray(offset, end + 1);
        await line(
          pendingSize
            ? Buffer.concat([...pending, part], pendingSize + part.length)
            : part,
        );
        pending = [];
        pendingSize = 0;
        offset = end + 1;
        if (done) break;
      }
      if (done) break;
      if (offset < chunk.length) {
        pending.push(chunk.subarray(offset));
        pendingSize += chunk.length - offset;
      }
      if (total + pendingSize > 8 * 1024 ** 2)
        throw new FlowFailure("Flow 返回内容过大，未保存结果");
    }
  if (!done && pendingSize) await line(Buffer.concat(pending, pendingSize));
  return flowResult(e.kind, chunks.join(""), diagnostics);
}
export const flowLifecycle: ProviderPlugin = {
  ...flowArtifacts,
  manifest: {
    ...flowArtifacts.manifest,
    version: "1.9.0",
    queue: {
      ...flowArtifacts.manifest.queue!,
      timingVersions: [
        ...flowArtifacts.manifest.queue!.timingVersions,
        "1.9.0",
      ],
    },
    requestLifecycle: {
      version: 2,
      honorImageEnabled: false,
      cancelDisabled: true,
      referenceKinds: ["ref"],
      queueOrder: "fifo",
      progressUpdatesHealth: true,
      recordCancelledRun: false,
      preferFinalizing: true,
      notes: {
        submitting: "Flow 正在生成",
        unavailable: null,
        inputUnavailable: "参考图片已不存在，请重新选择",
        inputFailed: "Flow 生成或保存失败，请从后台检查结果后重试",
        submitFailed: "Flow 生成或保存失败，请从后台检查结果后重试",
        saveFailed: "Flow 生成或保存失败，请从后台检查结果后重试",
        recoverySaveFailed: "Flow 成品保存失败，请从后台检查生成结果",
        unknownSubmission:
          "服务重启，Flow 生成结果未确认；请核对后台记录后再重新生成",
        disabled: "账户已停用",
      },
    },
  },
  requestCapacity({ health, stamp }) {
    return health.ready && stamp - (health.checked ?? 0) < 90 ? 1 : 0;
  },
  async queueHealth(config, signal) {
    if (!config.baseUrl || !config.apiKey) return { ready: false };
    const get = async (path: string, limit: number) => {
      const controller = new AbortController(),
        timer = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(
          String(config.baseUrl).replace(/\/+$/, "") + path,
          {
            redirect: "manual",
            signal: AbortSignal.any([signal, controller.signal]),
            headers: { Authorization: "Bearer " + config.apiKey },
          },
        );
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error("Unavailable");
        }
        return record(
          pythonJson(
            await prefix(
              readBody(response.body, () => timer.refresh()),
              limit,
            ),
          ),
        );
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      const catalog = await get("/v1/models", 256 * 1024),
        health = await get("/health", 65536);
      return {
        ready:
          truthy(catalog.data) &&
          truthy(health.backend_running) &&
          truthy(health.has_active_tokens),
      };
    } catch {
      return { ready: false };
    }
  },
  async submit(e) {
    const payload = e.mappedRequest?.body ?? flowPayload(e),
      controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 600000);
    let errorResponse = false;
    try {
      const publicUrl = splitArtifactUrl(
          String(e.config.publicUrl || "https://backend.nvmes.com/flow"),
        ),
        response = await fetch(
          String(e.config.baseUrl).replace(/\/+$/, "") + (e.mappedRequest?.path ?? "/v1/chat/completions"),
          {
            method: "POST",
            redirect: "manual",
            signal: AbortSignal.any([e.signal, controller.signal]),
            headers: {
              Authorization: "Bearer " + e.config.apiKey,
              "Content-Type": "application/json",
              "X-Forwarded-Host": publicUrl.netloc,
              "X-Forwarded-Proto": publicUrl.scheme,
            },
            body: JSON.stringify(payload),
          },
        );
      if (!response.ok) {
        errorResponse = true;
        throw new FlowFailure(
          flowSafeError(
            response.status,
            (
              await prefix(
                readBody(response.body, () => timer.refresh()),
                65536,
              )
            ).toString("utf8"),
          ),
        );
      }
      timer.refresh();
      return await flowStream(
        readBody(response.body, () => timer.refresh()),
        e,
      );
    } catch (error) {
      if (error instanceof FlowFailure)
        throw new RequestLifecycleError({
          action: "fail",
          note: error.message,
        });
      if (
        !errorResponse &&
        (error instanceof FlowConnectionFailure ||
          (error instanceof TypeError && error.message === "fetch failed") ||
          controller.signal.aborted ||
          e.signal.aborted)
      )
        throw new RequestLifecycleError({
          action: "fail",
          note: "与 Flow 的连接中断，生成结果未确认；请核对后台记录后再重新生成",
        });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  },
};
