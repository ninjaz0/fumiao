import { pythonStrip } from "@fumiao/plugin-sdk/python-text.js";
import { unobserved } from "@fumiao/plugin-sdk/request-workbench.js";
import {
  originalParent,
  OriginalSubmissionError,
} from "@fumiao/plugin-sdk/submission-errors.js";

const MODELS = Object.keys(MODEL_FORMS);

export default {
  modelForm(model) {
    return MODEL_FORMS[model.id] || MODEL_FORMS["tts-1"];
  },
  namespace(d) {
    return "-tts-commercial-" + d.kind;
  },
  validate(d, phase) {
    if (d.kind !== "audio") {
      throw new OriginalSubmissionError("TTS 模型仅支持语音生成", 400);
    }
    if (
      phase === "before-packs" ||
      phase === "before-retry" ||
      phase === "prepare"
    ) {
      const text = pythonStrip(d.prompt || "");
      if (!text) throw new OriginalSubmissionError("请输入要合成的配音台词", 400);
      if ([...text].length > 2000) {
        throw new OriginalSubmissionError("单段台词最多 2000 字", 400);
      }
    }
  },
  plan(d) {
    return {
      namespace: "-tts-commercial-" + d.kind,
      refs: [],
      roles: ["ref"],
      missing: { status: 404, message: "内容不存在或无权访问" },
      parentKind: "audio",
      requireConfigured: "TTS 服务尚未配置，请联系管理员",
      admission: {
        models: MODELS,
        owner: 12,
        global: 60,
        message: "当前配音任务较多，请稍后再试",
      },
    };
  },
  async prepare(d, r, host) {
    originalParent(d, r?.parent, "audio");
    await host.task.admit();
    await host.task.capacity();
    const raw = d.params || {};
    const rawSpeed = Number(d.speed ?? raw.speed ?? 1.0);
    const speed = Number.isFinite(rawSpeed)
      ? Math.max(0.5, Math.min(2.0, rawSpeed))
      : 1.0;
    const response_format =
      (d.response_format || raw.response_format) === "wav" ? "wav" : "mp3";
    const voice = String(d.voice || raw.voice || "nova").slice(0, 120);
    const instruction = pythonStrip(
      d.instruction || raw.instruction || "",
    ).slice(0, 300);
    const params = {
      voice,
      speed,
      response_format,
      ...(instruction ? { instruction } : {}),
    };
    return {
      params,
      references: [],
      view: {
        ratio: "",
        quality: null,
        seconds: null,
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
    return {
      model: d.model || "tts-1",
      kind: "audio",
      references: [],
      params: {},
    };
  },
  configuration({ connection }) {
    return {
      configured: Boolean(connection?.configured),
      ready: Boolean(connection?.configured),
    };
  },
  project(job) {
    return {
      note: job.request_note || "",
    };
  },
  timingFeatures(d) {
    return { kind: d.kind, model: d.model, length: "short" };
  },
  requestCapacity() {
    return null;
  },
  queuePlan() {
    return { wait: unobserved(), queue: [] };
  },
  request({ model, prompt, params }) {
    const body = {
      model: model === "local-tts-compat" ? "tts-1" : model,
      input: String(prompt || ""),
      voice: String(params?.voice || "nova"),
      speed: Math.max(0.5, Math.min(2.0, Number(params?.speed || 1.0))),
      response_format: params?.response_format === "wav" ? "wav" : "mp3",
    };
    if (params?.instruction) body.instructions = String(params.instruction);
    return {
      path: "/v1/audio/speech",
      body,
      responseFormat: "binary",
      timeoutMs: 60000,
    };
  },
  result(reply) {
    if ([429, 502, 503, 504].includes(reply.status)) {
      return {
        disposition: {
          action: "retry",
          note: "TTS 服务限流或繁忙，稍后自动重试",
          delaySeconds: 15,
        },
      };
    }
    if ([400, 401, 403, 422].includes(reply.status)) {
      return {
        disposition: {
          action: "fail",
          note: "TTS 网关拒绝了合成请求，请检查密钥或音色配置",
        },
      };
    }
    return {
      disposition: {
        action: "fail",
        note: "TTS 语音合成失败，请重试",
      },
    };
  },
  async serviceProbe(host) {
    const res = await host.service.read("/v1/models");
    return { ready: res.status >= 200 && res.status < 300 };
  },
  async queueHealth() {
    return { ready: true, checked: Math.floor(Date.now() / 1000) };
  },
  artifact() {
    return { error: "TTS 音频为直出产物，无需外链下载" };
  },
  downloadError() {
    return { note: "TTS 音频下载失败", disposition: "failed" };
  },
};
