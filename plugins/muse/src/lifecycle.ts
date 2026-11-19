import { museArtifacts } from "./artifacts.js";
import { museClockReport } from "./clock.js";
import { museJson } from "./json.js";
import {
  RequestLifecycleError,
  type Execution,
  type ProviderPlugin,
  type Receipt,
} from "../../../packages/plugin-sdk/src/index.js";
class TransportFailure extends Error {
  constructor(readonly status = 0) {
    super("Muse transport");
  }
}
export function musePayload(e: Pick<Execution, "model" | "kind" | "input">) {
  return {
    model: e.model,
    prompt: e.input.prompt.replace(/<Picture (\p{Nd}+)>/gu, "[图$1]"),
    aspect_ratio: e.input.params.ratio,
    images: e.input.references.map((r) => r.url),
    timeout: 600,
    ...(e.kind === "video"
      ? { duration: e.input.params.seconds }
      : { response_format: "url" }),
  };
}
async function request(e: Execution, path: string, body?: unknown) {
  const idle = new AbortController(),
    timer = setTimeout(() => idle.abort(), body === undefined ? 5000 : 120000);
  try {
    const response = await fetch(
      String(e.config.baseUrl).replace(/\/+$/, "") + path,
      {
        method: body === undefined ? "GET" : "POST",
        redirect: "error",
        signal: AbortSignal.any([e.signal, idle.signal]),
        headers: {
          Authorization: "Bearer " + e.config.apiKey,
          ...(body === undefined
            ? {}
            : {
                "Content-Type": "application/json",
                "Idempotency-Key": e.idempotencyKey.replaceAll("-", ""),
              }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new TransportFailure(response.status);
    }
    if (!response.body) throw new TransportFailure();
    const chunks: Uint8Array[] = [];
    let size = 0;
    timer.refresh();
    for await (const chunk of response.body as any) {
      timer.refresh();
      size += chunk.length;
      if (size > 2 * 1024 ** 2) throw new TransportFailure();
      chunks.push(chunk);
    }
    return museJson(Buffer.concat(chunks));
  } catch (error) {
    if (error instanceof TransportFailure) throw error;
    throw new TransportFailure();
  } finally {
    clearTimeout(timer);
  }
}
const unknown = () =>
  new RequestLifecycleError({
    action: "fail",
    note: "Muse 提交结果待确认，请联系管理员核对后再重试",
    interrupted: true,
    uncertain: true,
  });
const truthy = (v: any): boolean =>
  v !== null &&
  v !== undefined &&
  v !== false &&
  v !== 0 &&
  v !== "" &&
  (!Array.isArray(v) || v.length > 0) &&
  (typeof v !== "object" || Array.isArray(v) || Object.keys(v).length > 0);
export function museCompleted(value: any): Receipt {
  const result = truthy(value.result) ? value.result : {};
  if (
    !truthy(value.url) &&
    (typeof result !== "object" || Array.isArray(result))
  )
    throw new Error("Invalid result object");
  let url = truthy(value.url) ? value.url : result.url;
  if (!truthy(url) && truthy(value.data)) {
    const first = Array.isArray(value.data) ? value.data[0] : null;
    if (!first || typeof first !== "object" || Array.isArray(first))
      throw new Error("Invalid result data");
    url = first.url;
  }
  if (typeof url !== "string")
    throw new RequestLifecycleError({
      action: "fail",
      note: "Muse 未返回可下载的成品",
    });
  return { state: "completed", artifacts: [{ url }] };
}
export const museLifecycle: ProviderPlugin = {
  ...museArtifacts,
  manifest: {
    ...museArtifacts.manifest,
    version: "1.10.0",
    queue: {
      ...museArtifacts.manifest.queue!,
      timingVersions: [
        ...museArtifacts.manifest.queue!.timingVersions,
        "1.10.0",
      ],
    },
    requestLifecycle: {
      version: 1,
      honorImageEnabled: true,
      cancelDisabled: true,
      notes: {
        submitting: "正在提交 Muse",
        unavailable: "等待 Muse 就绪",
        inputFailed: "参考图读取失败，请检查素材后重新生成",
        saveFailed: "Muse 成品保存失败，请检查后重新生成",
        unknownSubmission: "Muse 提交结果待确认，请联系管理员核对后再重试",
        disabled: "账户已停用",
      },
    },
  },
  async submit(e) {
    let remote: any, id: any;
    try {
      remote = await request(
        e,
        e.mappedRequest?.path ?? (e.kind === "image" ? "/v1/images/tasks" : "/v1/videos"),
        e.mappedRequest?.body ?? musePayload(e),
      );
      id = truthy(remote.task_id) ? remote.task_id : remote.id;
      if (
        typeof id !== "string" ||
        /^task_[a-f0-9]{20,64}$/.exec(id)?.[0] !== id
      )
        throw new TransportFailure();
    } catch (error) {
      if (
        error instanceof TransportFailure &&
        [401, 403, 429].includes(error.status)
      )
        throw new RequestLifecycleError({
          action: "retry",
          note: "等待 Muse 就绪",
          delaySeconds: 60,
        });
      if (
        error instanceof TransportFailure &&
        [400, 413, 422].includes(error.status)
      )
        throw new RequestLifecycleError({
          action: "fail",
          note: "Muse 拒绝了生成参数或参考图",
        });
      throw unknown();
    }
    await e.reportProviderNote?.("等待 Muse 空闲账号");
    await e.reportProviderClock?.(museClockReport(remote));
    return { state: "pending", remoteId: id };
  },
  async inspect(e, id) {
    let remote: any;
    try {
      remote = await request(
        e,
        e.mappedRequest?.path ?? ((e.kind === "image" ? "/v1/images/tasks/" : "/v1/videos/") + id),
      );
    } catch (error) {
      if (error instanceof TransportFailure && error.status === 404)
        throw new RequestLifecycleError({
          action: "fail",
          note: "Muse 中的任务记录已不存在，结果未确认；请检查后再重新生成",
        });
      throw new RequestLifecycleError({ action: "poll" });
    }
    if (!remote || typeof remote !== "object" || Array.isArray(remote))
      throw new RequestLifecycleError({ action: "poll" });
    await e.reportProviderClock?.(museClockReport(remote));
    if (["completed", "done", "succeeded", "success"].includes(remote.status)) {
      await e.reportProviderNote?.("正在保存 Muse 成品");
      try {
        return museCompleted(remote);
      } catch (error) {
        if (error instanceof RequestLifecycleError) throw error;
        throw new RequestLifecycleError({
          action: "fail",
          note: "Muse 成品保存失败，请检查后重新生成",
        });
      }
    }
    if (remote.status === "failed")
      throw new RequestLifecycleError({
        action: "fail",
        note: "Muse 生成未成功，请检查服务端任务记录后重新生成",
      });
    if (remote.status === "processing") {
      if (!Object.hasOwn(remote, "phase"))
        await e.reportTiming?.({ job_phase: "generating" });
      await e.reportProviderNote?.(
        remote.phase === "preparing" ? "正在准备 Muse" : "Muse 生成中",
      );
    } else if (remote.status === "queued")
      await e.reportProviderNote?.("等待 Muse 空闲账号");
    return { state: "pending", remoteId: id };
  },
};
