import { pythonJsonText } from "@fumiao/plugin-sdk/json.js";
import { pythonStrip } from "@fumiao/plugin-sdk/python-text.js";
import { unobserved } from "@fumiao/plugin-sdk/request-workbench.js";

const MODELS = Object.keys(MODEL_FORMS);

function upstreamModel(model) {
  if (typeof model === "string" && model.startsWith("newapi/")) {
    return model.slice("newapi/".length);
  }
  return model;
}

function isModerationRejection(text) {
  const lower = String(text || "").toLowerCase();
  return (
    lower.includes("content_policy_violation") ||
    lower.includes("moderation_blocked") ||
    lower.includes("safety_blocked") ||
    lower.includes("content_filter") ||
    lower.includes("安全审核") ||
    lower.includes("违规")
  );
}

export default {
  modelForm(model) {
    return MODEL_FORMS[model.id] || MODEL_FORMS["openrouter/flux-1.1-pro"];
  },
  namespace(d) {
    return "-openrouter-gateway-" + d.kind;
  },
  validate(d) {
    if (!pythonStrip(d.prompt || "")) return "请输入提示词";
    if ([...String(d.prompt || "")].length > 12000) return "提示词最多 12000 字";
    return "";
  },
  plan(d) {
    const form = MODEL_FORMS[d.model] || MODEL_FORMS["openrouter/flux-1.1-pro"];
    const maxRefs = form.references?.max ?? 4;
    const refs = Array.isArray(d.refs) ? d.refs.slice(0, maxRefs) : [];
    return {
      namespace: "-openrouter-gateway-" + d.kind,
      parentKind: "any",
      refs,
      roles: refs.map(() => "ref"),
      missing: { status: 400, message: "参考图不可用" },
      requireConfigured: "OpenRouter / New API 媒体服务尚未配置，请联系管理员",
      admission: {
        models: MODELS,
        owner: 12,
        global: 60,
        message: "当前聚合网关任务较多，请稍后再试",
      },
    };
  },
  async prepare(d, ctx, host) {
    await host.task.admit();
    const form = MODEL_FORMS[d.model] || MODEL_FORMS["openrouter/flux-1.1-pro"];
    const merged = { ...(d.params || {}) };
    if (d.ratio !== undefined && merged.ratio === undefined) merged.ratio = d.ratio;
    if (d.resolution !== undefined && merged.resolution === undefined)
      merged.resolution = d.resolution;
    if (d.image_quality !== undefined && merged.image_quality === undefined)
      merged.image_quality = d.image_quality;
    if (d.seconds !== undefined && merged.seconds === undefined)
      merged.seconds = d.seconds;

    // Preserve declared custom ModelForm fields + defaults cleanly
    const params = {};
    for (const [key, field] of Object.entries(form.fields || {})) {
      if (merged[key] !== undefined && merged[key] !== null) {
        params[key] = merged[key];
      } else if (field.default !== undefined) {
        params[key] = field.default;
      }
    }
    const rawRefs = Array.isArray(ctx) ? ctx : (ctx && Array.isArray(ctx.references) ? ctx.references : []);
    const refIds = rawRefs.map((r) => (typeof r === "string" ? r : r.id));
    return {
      params,
      references: refIds,
      view: {
        ratio: String(params.ratio || "16:9"),
        quality: null,
        seconds: typeof params.seconds === "number" ? params.seconds : null,
        sampling_steps: null,
        seed: null,
        width: null,
        height: null,
        image_quality: typeof params.image_quality === "string" ? params.image_quality : null,
        audio_settings: null,
        h3_inputs: null,
        refs: refIds,
      },
    };
  },
  async estimate(d) {
    return { tier: d.kind === "video" ? "video" : "standard", params: d.params ?? {} };
  },
  configuration({ connection }) {
    return {
      configured: Boolean(connection?.configured),
      ready: Boolean(connection?.configured),
    };
  },
  project(job) {
    return { note: job.request_note || "" };
  },
  timingFeatures(d) {
    return { kind: d.kind, model: d.model, length: d.kind === "video" ? "medium" : "short" };
  },
  requestCapacity() {
    return null;
  },
  queuePlan() {
    return { wait: unobserved(), queue: [] };
  },
  request({ kind, model, prompt, params, references, remoteId }) {
    if (remoteId) {
      return {
        path: `/videos/generations/${encodeURIComponent(remoteId)}`,
        method: "GET",
        timeoutMs: 30000,
      };
    }
    const upModel = upstreamModel(model);
    const body = {
      model: upModel,
      prompt: String(prompt || ""),
      ...(params || {}),
    };
    if (Array.isArray(references) && references.length > 0) {
      body.references = references;
    }
    return {
      path: kind === "video" ? "/videos/generations" : "/images/generations",
      body,
      timeoutMs: kind === "video" ? 180000 : 120000,
    };
  },
  result(reply, remoteId, ctx) {
    let data = null;
    if (reply.text) {
      try {
        data = pythonJsonText(reply.text);
      } catch {
        data = null;
      }
    }
    const kind = ctx?.kind || "image";
    const defaultMime = kind === "video" ? "video/mp4" : "image/png";

    if (!remoteId) {
      if ([429, 502, 503, 504].includes(reply.status)) {
        return {
          disposition: {
            action: "retry",
            note: "聚合网关限流或繁忙，稍后自动重试",
            delaySeconds: 15,
          },
        };
      }
      if ([400, 422].includes(reply.status) && isModerationRejection(reply.text)) {
        return {
          disposition: {
            action: "fail",
            reason: "moderation_blocked",
            certainty: "rejected",
            billable: false,
            note: "提示词触发内容安全审核拦截（未计费）",
          },
        };
      }
      if ([400, 401, 403, 422].includes(reply.status)) {
        return {
          disposition: {
            action: "fail",
            certainty: "rejected",
            billable: false,
            note: "聚合网关拒绝了生成请求，请检查模型参数或 API Key",
          },
        };
      }
      const first = Array.isArray(data?.data) ? data.data[0] : data;
      if (first?.b64_json && typeof first.b64_json === "string") {
        return {
          receipt: {
            state: "completed",
            artifacts: [
              {
                url: `data:${first.mime || defaultMime};base64,${first.b64_json}`,
                mime: first.mime || defaultMime,
              },
            ],
            ...(data?.usage ? { usage: data.usage } : {}),
          },
        };
      }
      const url = first?.url || data?.video_url || data?.image_url || data?.url;
      if (typeof url === "string" && url) {
        return {
          receipt: {
            state: "completed",
            artifacts: [{ url, mime: first?.mime || defaultMime }],
            ...(data?.usage ? { usage: data.usage } : {}),
          },
        };
      }
      const taskId = data?.task_id || data?.id;
      if (typeof taskId === "string" && /^[A-Za-z0-9_-]{4,128}$/.test(taskId)) {
        return {
          receipt: { state: "pending", remoteId: taskId },
          note: "聚合网关正在生成媒体",
        };
      }
      return {
        disposition: {
          action: "fail",
          note: "聚合网关响应未确认",
          interrupted: true,
          uncertain: true,
        },
      };
    }

    if (reply.status === 404) {
      return { disposition: { action: "fail", note: "上游媒体任务不存在" } };
    }
    if (!data || typeof data !== "object") {
      return { disposition: { action: "poll" } };
    }
    if (["completed", "done", "succeeded", "success"].includes(data.status)) {
      const first = Array.isArray(data.data) ? data.data[0] : data;
      const url = first?.url || data.video_url || data.image_url || data.url;
      const b64 = first?.b64_json;
      if (typeof b64 === "string" && b64) {
        return {
          receipt: {
            state: "completed",
            artifacts: [{ url: `data:${defaultMime};base64,${b64}`, mime: defaultMime }],
          },
        };
      }
      return typeof url === "string" && url
        ? {
            receipt: {
              state: "completed",
              artifacts: [{ url, mime: defaultMime }],
            },
          }
        : { disposition: { action: "fail", note: "上游已完成但缺少成品地址" } };
    }
    if (data.status === "failed") {
      return {
        disposition: {
          action: "fail",
          note: String(data.error || "上游媒体生成失败"),
        },
      };
    }
    return { receipt: { state: "pending", remoteId }, note: "聚合网关生成中" };
  },
  async serviceProbe(host) {
    const res = await host.service.read("/models");
    return { ready: res.status >= 200 && res.status < 300 };
  },
  async queueHealth() {
    return { ready: true, checked: Math.floor(Date.now() / 1000) };
  },
  artifact(url) {
    return { url };
  },
  downloadError() {
    return { note: "媒体成品下载失败，请稍后重试", disposition: "retry" };
  },
};
