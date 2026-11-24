import { splitArtifactUrl } from "@fumiao/plugin-sdk/artifact-url.js";
import { pythonJsonText } from "@fumiao/plugin-sdk/json.js";
import { pythonStrip } from "@fumiao/plugin-sdk/python-text.js";
import { unobserved } from "@fumiao/plugin-sdk/request-workbench.js";
import {
  originalParent,
  OriginalSubmissionError,
} from "@fumiao/plugin-sdk/submission-errors.js";

const ALLOWED_STYLES = [
  "cinematic",
  "lofi",
  "electronic",
  "orchestral",
  "guofeng",
  "ambient",
  "suspense",
];

function normalizeBgmParams(d) {
  const raw = d.params || {};
  const rawDuration = Number(raw.duration);
  const duration = [15, 30, 60, 120].includes(rawDuration) ? rawDuration : 30;
  const style =
    typeof raw.style === "string" && ALLOWED_STYLES.includes(raw.style)
      ? raw.style
      : "cinematic";
  const rawBpm = Number(raw.bpm);
  const bpm = Number.isFinite(rawBpm)
    ? Math.max(60, Math.min(180, Math.round(rawBpm)))
    : 100;
  const instrumental = raw.instrumental !== false;
  const lyrics =
    !instrumental && typeof raw.lyrics === "string" && pythonStrip(raw.lyrics)
      ? pythonStrip(raw.lyrics).slice(0, 1000)
      : "";
  const instruction = pythonStrip(
    d.instruction || raw.instruction || "",
  ).slice(0, 300);
  return {
    style,
    duration,
    bpm,
    instrumental,
    ...(lyrics ? { lyrics } : {}),
    ...(instruction ? { instruction } : {}),
  };
}

export default {
  modelForm(model) {
    return MODEL_FORMS[model.id] || MODEL_FORMS["bgm-v1"];
  },
  namespace(d) {
    return "-bgm-generator-" + d.kind;
  },
  validate(d, phase) {
    if (d.kind !== "audio") {
      throw new OriginalSubmissionError("BGM 生成模型仅支持音频类型", 400);
    }
    if (
      (phase === "before-packs" || phase === "before-retry" || phase === "prepare") &&
      !pythonStrip(d.prompt || "")
    ) {
      throw new OriginalSubmissionError("请描述背景音乐的场景与氛围", 400);
    }
  },
  plan(d) {
    return {
      namespace: "-bgm-generator-" + d.kind,
      refs: [],
      roles: ["ref"],
      missing: { status: 404, message: "内容不存在或无权访问" },
      parentKind: "audio",
      requireConfigured: "BGM 生成服务尚未配置，请联系管理员",
      admission: {
        models: ["bgm-v1"],
        owner: 6,
        global: 30,
        message: "当前配乐任务较多，请稍后再试",
      },
    };
  },
  async prepare(d, r, host) {
    originalParent(d, r?.parent, "audio");
    await host.task.admit();
    await host.task.capacity();
    const params = normalizeBgmParams(d);
    return {
      params,
      references: [],
      view: {
        ratio: "",
        quality: null,
        seconds: params.duration,
        sampling_steps: null,
        seed: d.seed ?? null,
        width: null,
        height: null,
        image_quality: null,
        audio_settings: params,
        h3_inputs: null,
        refs: [],
      },
    };
  },
  async estimate(d) {
    const dur = [15, 30, 60, 120].includes(Number(d.params?.duration))
      ? Number(d.params.duration)
      : 30;
    return {
      model: d.model || "bgm-v1",
      kind: "audio",
      references: [],
      params: { duration: dur },
    };
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
    return {
      kind: d.kind,
      model: d.model,
      duration: Number(d.input?.params?.duration || 30),
    };
  },
  requestCapacity() {
    return null;
  },
  queuePlan() {
    return { wait: unobserved(), queue: [] };
  },
  request({ remoteId, prompt, params }) {
    if (remoteId) {
      return {
        path: `/v1/audio/music/${encodeURIComponent(remoteId)}`,
        timeoutMs: 15000,
      };
    }
    return {
      path: "/v1/audio/music",
      body: {
        prompt: String(prompt || ""),
        style: String(params?.style || "cinematic"),
        duration: Number(params?.duration || 30),
        bpm: Number(params?.bpm || 100),
        instrumental: params?.instrumental !== false,
        ...(params?.lyrics ? { lyrics: String(params.lyrics) } : {}),
        ...(params?.instruction ? { instruction: String(params.instruction) } : {}),
      },
      idempotency: "standard",
      timeoutMs: 30000,
    };
  },
  result(reply, remoteId) {
    let data = null;
    if (reply.status >= 200 && reply.status < 300 && reply.text) {
      try {
        data = pythonJsonText(reply.text);
      } catch {
        data = null;
      }
    }
    if (!remoteId) {
      if ([429, 502, 503, 504].includes(reply.status)) {
        return {
          disposition: {
            action: "retry",
            note: "BGM 服务繁忙，稍后自动重试",
            delaySeconds: 20,
          },
        };
      }
      if ([400, 401, 403, 422].includes(reply.status)) {
        return {
          disposition: {
            action: "fail",
            note: "BGM 参数或密钥无效",
            certainty: "rejected",
            billable: false,
          },
        };
      }
      const audioUrl = data?.audio_url || data?.url;
      if (typeof audioUrl === "string" && audioUrl) {
        return {
          receipt: {
            state: "completed",
            artifacts: [{ url: audioUrl, mime: "audio/mpeg" }],
          },
        };
      }
      const id = data?.task_id || data?.id;
      if (typeof id === "string" && /^[A-Za-z0-9_-]{4,128}$/.test(id)) {
        return {
          receipt: { state: "pending", remoteId: id },
          note: "正在谱曲与混音",
        };
      }
      return {
        disposition: {
          action: "fail",
          note: "BGM 任务状态未确认",
          interrupted: true,
          uncertain: true,
        },
      };
    }
    if (reply.status === 404) {
      return { disposition: { action: "fail", note: "BGM 任务记录不存在" } };
    }
    if (!data || typeof data !== "object") {
      return { disposition: { action: "poll" } };
    }
    if (["completed", "done", "succeeded", "success"].includes(data.status)) {
      const audioUrl = data.audio_url || data.url || data.result?.url;
      return typeof audioUrl === "string" && audioUrl
        ? {
            receipt: {
              state: "completed",
              artifacts: [{ url: audioUrl, mime: "audio/mpeg" }],
            },
            note: "正在保存配乐成品",
          }
        : { disposition: { action: "fail", note: "BGM 成品缺少音频地址" } };
    }
    if (data.status === "failed") {
      return { disposition: { action: "fail", note: "BGM 生成失败，请重试" } };
    }
    return {
      receipt: { state: "pending", remoteId },
      note: "BGM 正在生成中",
    };
  },
  async serviceProbe(host) {
    const res = await host.service.read("/v1/models");
    return { ready: res.status >= 200 && res.status < 300 };
  },
  async queueHealth() {
    return { ready: true, checked: Math.floor(Date.now() / 1000) };
  },
  artifact(url, base, alias) {
    try {
      const parsed = splitArtifactUrl(url);
      if (parsed.scheme !== "https") {
        return { error: "BGM 音频地址必须是 HTTPS" };
      }
      if (parsed.query || parsed.fragment) {
        return { error: "BGM 音频地址包含不受支持的参数" };
      }
      for (const origin of [base, alias].filter(Boolean)) {
        if (parsed.netloc !== origin.netloc) continue;
        const prefix = (origin.path || "").replace(/\/+$/, "");
        if (prefix && !parsed.path.startsWith(prefix + "/")) continue;
        const rel = prefix ? parsed.path.slice(prefix.length) : parsed.path;
        if (
          !rel ||
          !/^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(rel) ||
          rel.split("/").some((part) => part === "." || part === "..")
        ) {
          return { error: "BGM 音频路径无效" };
        }
        return { path: rel, timeoutMs: 45000 };
      }
      return { error: "BGM 音频域名超出服务地址范围" };
    } catch {
      return { error: "BGM 音频地址无效" };
    }
  },
  downloadError() {
    return { note: "BGM 音频下载失败，请重试", disposition: "retry" };
  },
};
