import { requestWorkbench } from "@fumiao/plugin-sdk/request-workbench.js";
import { pythonStrip } from "@fumiao/plugin-sdk/python-text.js";
import { pythonJsonText } from "@fumiao/plugin-sdk/json.js";
import { splitArtifactUrl } from "@fumiao/plugin-sdk/artifact-url.js";
import { healthInteger, healthTruthy } from "@fumiao/plugin-sdk/health.js";
import {
  submissionPolicy,
  estimatePolicy,
  statePolicy,
  timingFeatures,
} from "../src/studio-policies.ts";
import { queuePolicy } from "../src/queue-policy.ts";
import { museClockReport } from "../src/clock-report.ts";

const pending = (remoteId) => ({ state: "pending", remoteId });
const fail = (note, observations = {}) => ({
  ...observations,
  disposition: { action: "fail", note },
});
function json(reply) {
  if (reply.status < 200 || reply.status >= 300 || reply.text === null)
    return null;
  try {
    return pythonJsonText(reply.text);
  } catch {
    return null;
  }
}
function submitted(value, status) {
  if ([401, 403, 429].includes(status))
    return {
      disposition: {
        action: "retry",
        note: "等待 Muse 就绪",
        delaySeconds: 60,
      },
    };
  if ([400, 413, 422].includes(status))
    return fail("Muse 拒绝了生成参数或参考图");
  const id = healthTruthy(value?.task_id) ? value.task_id : value?.id;
  if (typeof id !== "string" || /^task_[a-f0-9]{20,64}$/.exec(id)?.[0] !== id)
    return {
      disposition: {
        action: "fail",
        note: "Muse 提交结果待确认，请联系管理员核对后再重试",
        interrupted: true,
        uncertain: true,
      },
    };
  return {
    receipt: pending(id),
    clock: museClockReport(value),
    note: "等待 Muse 空闲账号",
  };
}
function polled(value, status, id) {
  if (status === 404)
    return fail("Muse 中的任务记录已不存在，结果未确认；请检查后再重新生成");
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { disposition: { action: "poll" } };
  const obs = { clock: museClockReport(value) };
  if (["completed", "done", "succeeded", "success"].includes(value.status)) {
    obs.note = "正在保存 Muse 成品";
    const result = healthTruthy(value.result) ? value.result : {};
    if (
      !healthTruthy(value.url) &&
      (typeof result !== "object" || Array.isArray(result))
    )
      return fail("Muse 成品保存失败，请检查后重新生成", obs);
    let url = healthTruthy(value.url) ? value.url : result.url;
    if (!healthTruthy(url) && healthTruthy(value.data)) {
      const first = Array.isArray(value.data) ? value.data[0] : null;
      if (!first || typeof first !== "object" || Array.isArray(first))
        return fail("Muse 成品保存失败，请检查后重新生成", obs);
      url = first.url;
    }
    return typeof url === "string"
      ? { ...obs, receipt: { state: "completed", artifacts: [{ url }] } }
      : fail("Muse 未返回可下载的成品", obs);
  }
  if (value.status === "failed")
    return fail("Muse 生成未成功，请检查服务端任务记录后重新生成", obs);
  if (value.status === "processing") {
    if (!Object.hasOwn(value, "phase"))
      obs.timing = { job_phase: "generating" };
    obs.note = value.phase === "preparing" ? "正在准备 Muse" : "Muse 生成中";
  } else if (value.status === "queued") obs.note = "等待 Muse 空闲账号";
  return { ...obs, receipt: pending(id) };
}

function accountCapacity(accounts) {
  if (Array.isArray(accounts))
    return accounts.length > 0 ? Math.min(16, accounts.length) : 0;
  if (typeof accounts === "number")
    return Number.isInteger(accounts) && accounts > 0
      ? Math.min(16, accounts)
      : 0;
  if (typeof accounts === "boolean") return accounts ? 1 : 0;
  if (accounts && typeof accounts === "object")
    return Object.keys(accounts).length > 0 ? 1 : 0;
  return 0;
}

export default {
  ...requestWorkbench(
    submissionPolicy(pythonStrip),
    estimatePolicy,
    statePolicy,
    queuePolicy,
    timingFeatures,
    MODEL_FORMS,
  ),
  request({ kind, model, remoteId, prompt, params, references }) {
    const path = kind === "video" ? "/v1/videos" : "/v1/images/tasks";
    if (remoteId) return { path: path + "/" + remoteId, timeoutMs: 5000 };
    return {
      path,
      timeoutMs: 120000,
      idempotency: "compact",
      body: {
        model,
        prompt: prompt.replace(/<Picture (\p{Nd}+)>/gu, "[图$1]"),
        aspect_ratio: params.ratio,
        images: references.map((r) => r.value),
        timeout: 600,
        ...(kind === "video"
          ? { duration: params.seconds }
          : { response_format: "url" }),
      },
    };
  },
  result(reply, id) {
    return id
      ? polled(json(reply), reply.status, id)
      : submitted(json(reply), reply.status);
  },
  async serviceProbe(host) {
    const reply = await host.service.read("/v1/models");
    if (reply.status < 200 || reply.status >= 300) return { ready: false };
    try {
      const data = JSON.parse(reply.text).data;
      if (Array.isArray(data) && data.every((m) => typeof m?.id === "string"))
        return { ready: true, models: data.map((m) => m.id) };
    } catch {}
    return { ready: true };
  },
  async queueHealth(host) {
    async function read(path) {
      const reply = await host.service.read(path);
      if (reply.status < 200 || reply.status >= 300 || reply.text === null)
        throw Error();
      return JSON.parse(reply.text);
    }
    try {
      const ready = await read("/readyz");
      const fallbackCapacity = accountCapacity(ready.accounts);
      if (ready.status !== "ready" || fallbackCapacity <= 0)
        return { ready: false };
      const models = await read("/v1/models");
      if (!Array.isArray(models.data) || !models.data.length)
        return { ready: false };
      const queueReply = await host.service.read("/v1/queue");
      if (queueReply.status < 200 || queueReply.status >= 300)
        return {
          ready: true,
          capacity: fallbackCapacity,
          maintenance: 0,
          tasks: [],
        };
      try {
        if (queueReply.text === null) throw Error();
        const q = JSON.parse(queueReply.text);
        if (!q || typeof q !== "object" || Array.isArray(q)) throw Error();
        const tasks = (q.tasks === undefined ? [] : q.tasks)
          .slice(0, 10000)
          .map((t) => (typeof t.id === "string" ? { id: t.id } : {}));
        if (tasks.some((t) => t.id?.length > 500)) throw Error();
        return {
          ready: true,
          capacity: Math.max(
            0,
            Math.min(
              16,
              q.capacity === undefined
                ? fallbackCapacity
                : healthInteger(q.capacity),
            ),
          ),
          maintenance: Math.max(
            0,
            Math.min(
              1000,
              healthInteger(q.maintenance === undefined ? 0 : q.maintenance),
            ),
          ),
          tasks,
        };
      } catch {
        return { ready: true, capacity: 1, maintenance: 0, tasks: [] };
      }
    } catch {
      return { ready: false };
    }
  },
  artifact(url, base, alias) {
    const parsed = splitArtifactUrl(url);
    if (!parsed.query && !parsed.fragment)
      for (const origin of [
        base,
        alias ?? { netloc: "backend.nvmes.com", path: "/muse" },
        { netloc: "muse.nvmes.com", path: "" },
      ]) {
        const prefix = origin.path + "/v1/media/";
        if (
          (parsed.netloc && parsed.netloc !== origin.netloc) ||
          !parsed.path.startsWith(prefix)
        )
          continue;
        const name = parsed.path.slice(prefix.length);
        if (/^[A-Za-z0-9_.-]{1,200}$/.test(name) && !name.includes(".."))
          return { path: "/v1/media/" + name };
      }
    return { error: "Muse 返回了无效的成品地址" };
  },
  downloadError(reason) {
    return reason === "oversized"
      ? { note: "Muse 成品超过 64 MB，未保存", disposition: "failed" }
      : { note: "", disposition: "retry" };
  },
};
