import { build } from "esbuild";
import { createHash } from "node:crypto";

const version = process.argv[2] || "1.0.0";

const modelForms = {
  "bgm-v1": {
    parameterObject: true,
    fields: {
      style: {
        type: "string",
        title: "音乐风格",
        enum: [
          "cinematic",
          "lofi",
          "electronic",
          "orchestral",
          "guofeng",
          "ambient",
          "suspense",
        ],
        default: "cinematic",
        optionLabels: {
          cinematic: "电影史诗",
          lofi: "Lo-Fi 舒缓",
          electronic: "电子赛博",
          orchestral: "交响弦乐",
          guofeng: "国风古韵",
          ambient: "环境氛围",
          suspense: "悬疑紧张",
        },
      },
      duration: {
        type: "integer",
        title: "曲目时长（秒）",
        enum: [15, 30, 60, 120],
        default: 30,
        optionLabels: {
          "15": "15 秒（短视频）",
          "30": "30 秒（标准片头）",
          "60": "60 秒（单集配乐）",
          "120": "120 秒（长配乐）",
        },
      },
      bpm: {
        type: "integer",
        title: "节拍 (BPM)",
        minimum: 60,
        maximum: 180,
        default: 100,
        uiHint: "slider",
      },
      instrumental: {
        type: "boolean",
        title: "纯音乐（无人声）",
        default: true,
      },
      lyrics: {
        type: "string",
        title: "自定义歌词",
        maxLength: 1000,
        uiHint: "textarea",
        visibleWhen: { instrumental: [false] },
      },
    },
    tiers: [
      { tier: "short", when: { duration: [15, 30] } },
      { tier: "long", when: { duration: [60, 120] } },
    ],
    references: { min: 0, max: 0 },
  },
};

const compiled = await build({
  entryPoints: ["plugins/bgm-generator/package/policy.js"],
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
  id: "bgm-generator",
  label: "AI 背景音乐（BGM）生成",
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
        title: "BGM 生成网关地址（Suno / ACE-Step 兼容）",
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
      id: "bgm-v1",
      label: "AI 配乐生成 BGM v1",
      kind: "audio",
      inputSchema: { type: "object", additionalProperties: true, properties: {} },
      studio: {
        order: 75,
        priceOrder: 750,
        descriptor: {
          kind: "audio",
          label: "AI 配乐 BGM v1",
          provider: "bgm-generator",
        },
        prices: [
          {
            tier: "short",
            label: "15–30 秒配乐",
            amount: 10,
            match: { type: "object", properties: { duration: { enum: [15, 30] } } },
          },
          {
            tier: "long",
            label: "60–120 秒配乐",
            amount: 20,
            match: { type: "object", properties: { duration: { enum: [60, 120] } } },
          },
        ],
      },
    },
  ],
  canvasSubmission: {
    version: 1,
    models: [{ model: "bgm-v1", kind: "audio", defaultForKind: false }],
  },
  artifactDownload: { version: 1 },
  artifactValidation: {
    version: 3,
    errors: {
      imageFormat: "配乐返回格式无效",
      imageDecode: "配乐返回格式无效",
      video: "配乐返回格式无效",
      audio: "生成的 BGM 音频无法解码或时长无效",
      failed: "BGM 成品保存失败，请重试",
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
    resumeAccepted: true,
    cancelOnlyWhenAvailable: false,
    executionDeadlineMs: 300000,
    notes: {
      submitting: "正在提交配乐生成",
      unavailable: "等待 BGM 服务就绪",
      inputUnavailable: "输入不可用",
      inputFailed: "输入准备失败",
      saveFailed: "配乐保存失败",
      recoverySaveFailed: "配乐恢复保存失败",
      submitFailed: "配乐提交失败",
      unknownSubmission: "配乐任务状态未确认",
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
