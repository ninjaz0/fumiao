import { build } from "esbuild";
import { createHash } from "node:crypto";

const version = process.argv[2] || "1.1.0";
const openrouterModels = [
  { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4 (OpenRouter)", order: 20, priceOrder: 200 },
  { id: "openai/gpt-4.1", label: "GPT-4.1 (OpenRouter)", order: 21, priceOrder: 201 },
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro (OpenRouter)", order: 22, priceOrder: 202 },
  { id: "deepseek/deepseek-chat-v3-0324", label: "DeepSeek V3 (OpenRouter)", order: 23, priceOrder: 203 },
  { id: "qwen/qwen3-235b-a22b", label: "Qwen3 235B (OpenRouter)", order: 24, priceOrder: 204 },
];
const newapiModels = [
  { id: "newapi/gpt-4.1", label: "GPT-4.1 (New API)", order: 30, priceOrder: 210 },
  { id: "newapi/claude-sonnet-4", label: "Claude Sonnet 4 (New API)", order: 31, priceOrder: 211 },
  { id: "newapi/gemini-2.5-pro", label: "Gemini 2.5 Pro (New API)", order: 32, priceOrder: 212 },
  { id: "newapi/deepseek-chat", label: "DeepSeek Chat (New API)", order: 33, priceOrder: 213 },
];

const mediaModelForms = {
  "openrouter/flux-1.1-pro": {
    parameterObject: true,
    canvas: true,
    fields: {
      ratio: {
        type: "string",
        title: "画幅比例",
        enum: ["16:9", "9:16", "1:1", "4:3", "3:4"],
        default: "16:9",
      },
      resolution: {
        type: "string",
        title: "分辨率",
        enum: ["1K", "2K"],
        default: "1K",
      },
      style_preset: {
        type: "string",
        title: "画面风格预设",
        enum: ["cinematic", "photorealistic", "anime", "watercolor"],
        default: "cinematic",
        optionLabels: {
          cinematic: "电影质感",
          photorealistic: "写实摄影",
          anime: "日系动画",
          watercolor: "水彩插画",
        },
      },
      guidance_scale: {
        type: "number",
        title: "提示词引导强度 (CFG)",
        minimum: 1,
        maximum: 15,
        default: 3.5,
        uiHint: "slider",
      },
      use_reference_blend: {
        type: "boolean",
        title: "启用参考图融合",
        default: false,
      },
    },
    tiers: [{ tier: "standard", when: {} }],
    references: {
      min: 0,
      max: 4,
      conditionalLimits: [
        {
          when: { use_reference_blend: [true] },
          min: 1,
          max: 4,
          reason: "开启参考图融合时需提供 1–4 张参考图",
        },
      ],
    },
  },
  "newapi/gpt-image-1": {
    parameterObject: true,
    canvas: true,
    fields: {
      ratio: {
        type: "string",
        title: "画幅比例",
        enum: ["16:9", "9:16", "1:1"],
        default: "1:1",
      },
      image_quality: {
        type: "string",
        title: "画质档位",
        enum: ["low", "medium", "high"],
        default: "medium",
      },
      background: {
        type: "string",
        title: "背景透明度",
        enum: ["auto", "opaque", "transparent"],
        default: "auto",
        optionLabels: {
          auto: "自动",
          opaque: "不透明",
          transparent: "透明 PNG",
        },
      },
    },
    tiers: [{ tier: "standard", when: {} }],
    references: { min: 0, max: 4 },
  },
  "newapi/sora-2": {
    parameterObject: true,
    canvas: true,
    fields: {
      ratio: {
        type: "string",
        title: "画幅比例",
        enum: ["16:9", "9:16", "1:1"],
        default: "16:9",
      },
      seconds: {
        type: "integer",
        title: "视频时长（秒）",
        enum: [4, 8, 12],
        default: 4,
      },
      motion_strength: {
        type: "number",
        title: "运动幅度",
        minimum: 0.1,
        maximum: 1.0,
        default: 0.6,
        uiHint: "slider",
      },
    },
    tiers: [{ tier: "video", when: {} }],
    references: { min: 0, max: 2 },
  },
};

const providers = [
  {
    id: "openrouter",
    label: "OpenRouter 统一网关",
    models: openrouterModels.map((m) => m.id),
    defaultConfig: {
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1/",
      apiKey: "",
    },
  },
  {
    id: "newapi",
    label: "New API / One API 中转站",
    models: newapiModels.map((m) => m.id),
    defaultConfig: {
      provider: "newapi",
      baseUrl: "https://api.openai.com/v1/",
      apiKey: "",
    },
  },
];

const origins = ["https://openrouter.ai", "https://api.openai.com"];
const allowedHeaders = ["HTTP-Referer", "X-Title"];

const compiledChat = await build({
  entryPoints: ["plugins/openrouter-gateway/package/policy.js"],
  bundle: true,
  platform: "browser",
  format: "iife",
  globalName: "policy",
  target: "es2022",
  minify: true,
  write: false,
  legalComments: "none",
});

const compiledMedia = await build({
  entryPoints: ["plugins/openrouter-gateway/package/media-policy.js"],
  bundle: true,
  platform: "browser",
  format: "iife",
  globalName: "mediaPolicy",
  target: "es2022",
  minify: true,
  write: false,
  legalComments: "none",
  define: {
    MODEL_FORMS: JSON.stringify(mediaModelForms),
  },
});

const studioProgram =
  "(()=>{" + compiledMedia.outputFiles[0].text + ";return mediaPolicy.default})()";

const chatModels = [
  ...openrouterModels.map((m) => ({ ...m, provider: "openrouter" })),
  ...newapiModels.map((m) => ({ ...m, provider: "newapi" })),
].map((m) => ({
  id: m.id,
  label: m.label,
  kind: "chat",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  studio: {
    order: m.order,
    priceOrder: m.priceOrder,
    descriptor: {
      kind: "chat",
      label: m.label,
      provider: m.provider,
    },
    prices: [
      {
        tier: "reply",
        label: "每条完整回复",
        amount: 1,
        match: { type: "object" },
      },
    ],
  },
}));

const mediaModels = [
  {
    id: "openrouter/flux-1.1-pro",
    label: "Flux 1.1 Pro (OpenRouter 图像)",
    kind: "image",
    provider: "openrouter",
    order: 40,
    priceOrder: 220,
    amount: 2,
    tier: "standard",
  },
  {
    id: "newapi/gpt-image-1",
    label: "GPT-Image-1 (New API 图像)",
    kind: "image",
    provider: "newapi",
    order: 41,
    priceOrder: 221,
    amount: 3,
    tier: "standard",
  },
  {
    id: "newapi/sora-2",
    label: "Sora 2 (New API 视频)",
    kind: "video",
    provider: "newapi",
    order: 42,
    priceOrder: 222,
    amount: 10,
    tier: "video",
  },
].map((m) => ({
  id: m.id,
  label: m.label,
  kind: m.kind,
  inputSchema: {
    type: "object",
    additionalProperties: true,
    properties: {},
  },
  studio: {
    order: m.order,
    priceOrder: m.priceOrder,
    descriptor: {
      kind: m.kind,
      label: m.label,
      provider: m.provider,
    },
    prices: [
      {
        tier: m.tier,
        label: m.kind === "video" ? "单次视频生成" : "单张图片生成",
        amount: m.amount,
        match: { type: "object", properties: {} },
      },
    ],
  },
}));

const manifest = {
  id: "openrouter-gateway",
  label: "OpenRouter / New API 多模态聚合网关",
  version,
  contractVersion: 1,
  mode: "request",
  configSchema: {
    type: "object",
    required: ["provider"],
    additionalProperties: false,
    properties: {
      provider: { type: "string", enum: providers.map((p) => p.id) },
      apiKey: { type: "string", writeOnly: true },
      baseUrl: { type: "string", pattern: "^https://" },
      upstreamCostFen: { type: "integer", minimum: 0 },
    },
  },
  models: [...chatModels, ...mediaModels],
  canvas: {
    version: 1,
    models: mediaModels.map((m) => ({
      model: m.id,
      kind: m.kind,
      defaultForKind: false,
    })),
  },
  canvasSubmission: {
    version: 1,
    models: mediaModels.map((m) => ({
      model: m.id,
      kind: m.kind,
      defaultForKind: false,
    })),
  },
  artifactDownload: { version: 1 },
  artifactValidation: {
    version: 3,
    errors: {
      imageFormat: "聚合网关返回的图片格式无效",
      imageDecode: "聚合网关返回的图片无法解码",
      video: "聚合网关返回的视频无法解码",
      audio: "聚合网关返回的音频无法解码",
      failed: "媒体成品保存失败，请重试",
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
    executionDeadlineMs: 240000,
    notes: {
      submitting: "正在通过聚合网关生成媒体",
      unavailable: "等待聚合网关就绪",
      inputUnavailable: "参考图不可用",
      inputFailed: "输入准备失败",
      saveFailed: "媒体成品保存失败",
      recoverySaveFailed: "媒体成品恢复保存失败",
      submitFailed: "聚合网关媒体提交失败",
      unknownSubmission: "聚合网关任务状态未确认",
      disabled: "账号已停用",
    },
  },
  originalSubmission: {
    version: 5,
    studioDigest: createHash("sha256").update(studioProgram).digest("hex"),
  },
  chat: {
    version: 1,
    providers,
    sandbox: {
      tools: true,
      origins,
      allowedHeaders,
      program:
        "(()=>{" + compiledChat.outputFiles[0].text + ";return policy.default})()",
    },
  },
};

process.stdout.write(
  JSON.stringify({
    manifest,
    studioProgram,
    contributes: {
      version: 1,
      hostCapabilities: ["http", "secrets", "media"],
      http: { origins, connection: true, allowedHeaders },
    },
  }),
);
