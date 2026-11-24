import { pythonStrip } from "@fumiao/plugin-sdk/python-text.js";
import { unobserved } from "@fumiao/plugin-sdk/request-workbench.js";

const MODELS = Object.keys(MODEL_FORMS);

export default {
  modelForm(model) {
    return MODEL_FORMS[model.id] || MODEL_FORMS["tts-1"];
  },
  namespace(d) {
    return "-tts-commercial-" + d.kind;
  },
  validate(d) {
    if (!pythonStrip(d.prompt || "")) return "请输入要合成的配音台词";
    if ([...String(d.prompt || "")].length > 2000) return "单段台词最多 2000 字";
    return "";
  },
  plan(d) {
    return {
      refs: [],
      params: {
        voice: d.voice || d.params?.voice || "nova",
        speed: Number(d.speed || d.params?.speed || 1.0),
        response_format: d.response_format || d.params?.response_format || "mp3",
        instruction: pythonStrip(d.instruction || d.params?.instruction || ""),
      },
      requireConfigured: "TTS 服务尚未配置，请联系管理员",
      admission: {
        models: MODELS,
        owner: 12,
        global: 60,
        message: "当前配音任务较多，请稍后再试",
      },
    };
  },
  async prepare(d, _r, host) {
    await host.task.admit();
    return { params: d.params ?? {}, references: [] };
  },
  async estimate() {
    return { tier: "standard", params: {} };
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
