import { build } from "esbuild";
import { createHash } from "node:crypto";

const version = process.argv[2] || "1.0.0";

const voiceLabels = {
  alloy: "Alloy（中性自然）",
  ash: "Ash（沉稳男声）",
  coral: "Coral（温暖女声）",
  echo: "Echo（叙事男声）",
  nova: "Nova（明快女声）",
  onyx: "Onyx（低沉磁性）",
  sage: "Sage（知性柔和）",
  shimmer: "Shimmer（清澈女声）",
  "zh-CN-XiaoxiaoNeural": "晓晓（中文女声）",
  "zh-CN-YunxiNeural": "云希（中文男声）",
};

const commonVoices = Object.keys(voiceLabels);

const modelForms = {
  "tts-1": {
    parameterObject: true,
    fields: {
      voice: {
        type: "string",
        title: "音色",
        enum: commonVoices,
        default: "nova",
        optionLabels: voiceLabels,
      },
      speed: {
        type: "number",
        title: "语速倍率",
        minimum: 0.5,
        maximum: 2.0,
        default: 1.0,
        uiHint: "slider",
      },
      response_format: {
        type: "string",
        title: "输出格式",
        enum: ["mp3", "wav"],
        default: "mp3",
      },
      instruction: {
        type: "string",
        title: "风格备注",
        maxLength: 300,
      },
    },
    tiers: [{ tier: "standard", when: {} }],
    references: { min: 0, max: 0 },
  },
  "gpt-4o-mini-tts": {
    parameterObject: true,
    fields: {
      voice: {
        type: "string",
        title: "音色",
        enum: commonVoices,
        default: "coral",
        optionLabels: voiceLabels,
      },
      speed: {
        type: "number",
        title: "语速倍率",
        minimum: 0.5,
        maximum: 2.0,
        default: 1.0,
        uiHint: "slider",
      },
      response_format: {
        type: "string",
        title: "输出格式",
        enum: ["mp3", "wav"],
        default: "mp3",
      },
      instruction: {
        type: "string",
        title: "情绪与语气指令",
        maxLength: 300,
        uiHint: "textarea",
      },
    },
    tiers: [{ tier: "expressive", when: {} }],
    references: { min: 0, max: 0 },
  },
  "local-tts-compat": {
    parameterObject: true,
    fields: {
      voice: {
        type: "string",
        title: "本地音色 ID（Piper / CosyVoice）",
        enum: commonVoices,
        default: "zh-CN-XiaoxiaoNeural",
        optionLabels: voiceLabels,
      },
      speed: {
        type: "number",
        title: "语速倍率",
        minimum: 0.5,
        maximum: 2.0,
        default: 1.0,
        uiHint: "slider",
      },
      response_format: {
        type: "string",
        title: "输出格式",
        enum: ["wav", "mp3"],
        default: "wav",
      },
      instruction: {
        type: "string",
        title: "语气指令",
        maxLength: 300,
      },
    },
    tiers: [{ tier: "local", when: {} }],
    references: { min: 0, max: 0 },
  },
};

const compiled = await build({
  entryPoints: ["plugins/tts-commercial/package/policy.js"],
  bundle: true,
  platform: "browser",
  format: "iife",
  globalName: "policy",
  target: "es2022",
  minify: true,
  write: false,
  legalComments: "none",
  define: {
    MODEL_FORMS: JSON.stringify(modelForms),
  },
});

const studioProgram =
  "(()=>{" + compiled.outputFiles[0].text + ";return policy.default})()";

const manifest = {
  id: "tts-commercial",
  label: "多引擎 TTS 配音路由（OpenAI / CosyVoice / Piper）",
  version,
  contractVersion: 1,
  mode: "request",
  configSchema: {
    type: "object",
    required: ["baseUrl", "apiKey"],
    additionalProperties: false,
    properties: {
      baseUrl: {
        type: "string",
        pattern: "^https://",
        title: "TTS 网关地址（OpenAI 兼容）",
      },
      apiKey: {
        type: "string",
        writeOnly: true,
        title: "API 密钥",
      },
    },
  },
  models: [
    {
      id: "tts-1",
      label: "OpenAI TTS-1（标准语音）",
      kind: "audio",
      inputSchema: { type: "object", additionalProperties: true, properties: {} },
      studio: {
        order: 70,
        priceOrder: 700,
        descriptor: { kind: "audio", label: "OpenAI TTS-1", provider: "tts-commercial" },
        prices: [
          {
            tier: "standard",
            label: "单段配音合成",
            amount: 2,
            match: { type: "object", properties: {} },
          },
        ],
      },
    },
    {
      id: "gpt-4o-mini-tts",
      label: "GPT-4o Mini TTS（情绪可控）",
      kind: "audio",
      inputSchema: { type: "object", additionalProperties: true, properties: {} },
      studio: {
        order: 71,
        priceOrder: 701,
        descriptor: {
          kind: "audio",
          label: "GPT-4o Mini TTS",
          provider: "tts-commercial",
        },
        prices: [
          {
            tier: "expressive",
            label: "情绪可控配音",
            amount: 3,
            match: { type: "object", properties: {} },
          },
        ],
      },
    },
    {
      id: "local-tts-compat",
      label: "本地/自建 TTS（Piper / CosyVoice）",
      kind: "audio",
      inputSchema: { type: "object", additionalProperties: true, properties: {} },
      studio: {
        order: 72,
        priceOrder: 702,
        descriptor: {
          kind: "audio",
          label: "本地 TTS（Piper / CosyVoice）",
          provider: "tts-commercial",
        },
        prices: [
          {
            tier: "local",
            label: "自建节点配音",
            amount: 0,
            match: { type: "object", properties: {} },
          },
        ],
      },
    },
  ],
  canvasSubmission: {
    version: 1,
    models: [
      { model: "tts-1", kind: "audio", defaultForKind: false },
      { model: "gpt-4o-mini-tts", kind: "audio", defaultForKind: false },
      { model: "local-tts-compat", kind: "audio", defaultForKind: false },
    ],
  },
  artifactDownload: { version: 1 },
  artifactValidation: {
    version: 3,
    errors: {
      imageFormat: "TTS 服务返回格式无效",
      imageDecode: "TTS 服务返回格式无效",
      video: "TTS 服务返回格式无效",
      audio: "TTS 返回的音频无法解码或时长超出限制",
      failed: "TTS 配音保存失败，请重试",
    },
  },
  requestLifecycle: {
    version: 3,
    honorImageEnabled: false,
    cancelDisabled: true,
    referenceKinds: ["ref"],
    queueOrder: "fifo",
    progressUpdatesHealth: false,
    recordCancelledRun: false,
    preferFinalizing: false,
    requireConfigured: true,
    atomicReferences: false,
    resumeAccepted: false,
    cancelOnlyWhenAvailable: false,
    executionDeadlineMs: 120000,
    notes: {
      submitting: "正在合成语音",
      unavailable: "等待 TTS 服务就绪",
      inputUnavailable: "输入不可用",
      inputFailed: "输入准备失败",
      saveFailed: "语音保存失败",
      recoverySaveFailed: "语音恢复保存失败",
      submitFailed: "语音合成提交失败",
      unknownSubmission: "语音合成状态未确认",
      disabled: "账号已停用",
    },
  },
  originalSubmission: {
    version: 5,
    studioDigest: createHash("sha256").update(studioProgram).digest("hex"),
  },
};

process.stdout.write(
  JSON.stringify({
    manifest,
    studioProgram,
    contributes: {
      version: 1,
      hostCapabilities: ["http", "secrets", "media"],
      http: { origins: [], connection: true },
    },
  }),
);
