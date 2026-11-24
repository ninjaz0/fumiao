import { build } from "esbuild";

const version = process.argv[2] || "1.0.0";
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

const compiled = await build({
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

const models = [
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

const manifest = {
  id: "openrouter-gateway",
  label: "OpenRouter / New API 聚合网关",
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
    },
  },
  models,
  chat: {
    version: 1,
    providers,
    sandbox: {
      tools: true,
      origins,
      allowedHeaders,
      program:
        "(()=>{" + compiled.outputFiles[0].text + ";return policy.default})()",
    },
  },
};

process.stdout.write(
  JSON.stringify({
    manifest,
    contributes: {
      version: 1,
      hostCapabilities: ["http", "secrets"],
      http: { origins, allowedHeaders },
    },
  }),
);
