import {
  chatHttp,
  chatLines,
  ChatTransportError,
} from "@fumiao/plugin-sdk/chat-transport.js";
import { ChatProbeError, ChatReplyError } from "@fumiao/plugin-sdk/chat.js";
import { decodePythonJson } from "@fumiao/plugin-sdk/json.js";
import { pythonStrip } from "@fumiao/plugin-sdk/python-values.js";
import type { Manifest, ProviderPlugin } from "@fumiao/plugin-sdk/index.js";
import { z } from "zod";
import { guardedLookup, requirePublicHttps } from "./plugin-host.js";
import { loadProgram } from "./plugin-program.js";
import { requireValue } from "./security.js";

const requestPlan = z
  .object({
    path: z
      .string()
      .max(1024)
      .regex(/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/),
    body: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
const integer = z
  .string()
  .max(4301)
  .regex(/^-?(?:0|[1-9]\d*)$/);
const event = z.discriminatedUnion("type", [
  z.object({ type: z.literal("skip") }).strict(),
  z.object({ type: z.literal("done") }).strict(),
  z
    .object({ type: z.literal("error"), code: z.enum(["upstream", "format"]) })
    .strict(),
  z
    .object({
      type: z.literal("chunk"),
      text: z.unknown(),
      reason: z.unknown(),
      usage: z
        .record(z.string().min(1).max(64), integer)
        .refine((value) => Object.keys(value).length <= 32),
    })
    .strict(),
]);
const titles = z.string().max(160);
type Kind = "stream" | "title" | "probe";
type Config = Record<string, unknown>;
async function jsonText(response: Awaited<ReturnType<typeof chatHttp>>) {
  const chunks = [];
  for await (const chunk of response.body) chunks.push(chunk);
  return decodePythonJson(Buffer.concat(chunks));
}

// The frozen manifest holds both the mapping and its declared default destinations.
// An explicit service address belongs to the admin's own connection and is never
// passed to guest code. The same socket-level DNS guard covers both destinations.
export async function sandboxChat(
  manifest: Manifest,
  send = chatHttp,
): Promise<ProviderPlugin> {
  const policy = manifest.chat!;
  const sandbox = policy.sandbox!;
  const invoke = await loadProgram(sandbox.program);
  const hooks = (
    await loadProgram(
      `({inspect(){const p=(${sandbox.program}\n);return Object.keys(p).filter(k=>typeof p[k]==="function")}})`,
    )
  )("inspect");
  requireValue(
    ["request", "event", "title", "probe"].every((h) => hooks.includes(h)),
    400,
    "沙箱对话程序缺少入口",
  );
  const providers = new Map(policy.providers.map((p) => [p.id, p]));
  for (const p of providers.values()) {
    const base = URL.parse(String(p.defaultConfig.baseUrl));
    requireValue(
      base &&
        sandbox.origins.includes(base.origin) &&
        p.defaultConfig.provider === p.id,
      400,
      "对话服务默认地址或提供方无效",
    );
    requireValue(!p.credentialFallback, 400, "插件不能声明其他连接的密钥");
    requirePublicHttps(base);
  }
  function connection(config: Config, model?: string) {
    const provider = providers.get(String(config.provider));
    requireValue(
      provider && (!model || provider.models.includes(model)),
      400,
      "模型与服务连接不匹配",
    );
    return provider;
  }
  function credential(config: Config) {
    return typeof config.apiKey === "string" ? pythonStrip(config.apiKey) : "";
  }
  async function open(
    kind: Kind,
    config: Config,
    signal: AbortSignal,
    input: Config = {},
  ) {
    signal.throwIfAborted();
    const p = connection(config, input.model as string | undefined);
    const base = new URL(String(config.baseUrl || p.defaultConfig.baseUrl));
    requirePublicHttps(base);
    requireValue(
      !base.search && !base.hash,
      400,
      "对话服务地址不能包含查询或片段",
    );
    base.pathname = base.pathname.replace(/\/+$/, "") + "/";
    const plan = requestPlan.parse(
      invoke("request", kind, { ...input, provider: p.id }),
    );
    requireValue(
      (kind === "probe") === (plan.body === undefined),
      400,
      "对话请求正文无效",
    );
    const destination = new URL(plan.path, base);
    if (config.inheritedChatEndpoints) {
      const endpoints = z
        .object({ probe: z.string(), reply: z.string() })
        .parse(config.inheritedChatEndpoints);
      requireValue(
        destination.href ===
          (kind === "probe" ? endpoints.probe : endpoints.reply),
        403,
        "请求超出共享密钥授权范围",
      );
    }
    // Only the host attaches the saved bearer token; guests cannot supply URLs,
    // headers, redirects, timeouts or credentials.
    return send(destination, {
      method: kind === "probe" ? "GET" : "POST",
      key: credential(config),
      body: plan.body,
      signal,
      lookup: guardedLookup,
      connectMs: kind === "title" ? 5000 : 15000,
      readMs: kind === "title" ? 12000 : kind === "probe" ? 15000 : 90000,
      maxRequestBytes: 1024 * 1024,
      maxResponseBytes: kind === "stream" ? 8 * 1024 * 1024 : 1024 * 1024,
    });
  }
  async function probe(config: Config, signal: AbortSignal) {
    const p = connection(config);
    let response;
    try {
      response = await open("probe", config, signal);
    } catch {
      throw new ChatProbeError("连接超时或服务不可用");
    }
    try {
      const result =
        response.status === 200
          ? invoke("probe", await jsonText(response), p.models)
          : "empty";
      if (result === "unavailable")
        throw new ChatProbeError("连接成功，但当前密钥不可使用所选模型");
      if (result !== "ok")
        throw new ChatProbeError("连接未通过，请检查密钥与服务状态");
    } catch (error) {
      if (error instanceof ChatTransportError)
        throw new ChatProbeError("连接超时或服务不可用");
      throw error;
    } finally {
      response.close();
    }
  }
  return {
    manifest,
    modelForm: (model) => ({
      fields: {},
      references: { min: 0, max: 0 },
      tiers: model.studio!.prices.map(({ tier }) => ({ tier, when: {} })),
    }),
    chatProvider: (config) => providers.get(String(config.provider))?.id,
    chatConfigured: (config) =>
      Boolean(connection(config) && credential(config)),
    chatConfigure(config, key) {
      connection(config);
      return { ...config, apiKey: key };
    },
    chatProbe: probe,
    async health(config, signal) {
      try {
        await probe(config, signal);
        return true;
      } catch {
        return false;
      }
    },
    async submit() {
      return { state: "failed", error: "对话需要通过会话接口发送" };
    },
    async *chatStream({ config, model, messages, signal }) {
      const response = await open("stream", config, signal, {
        model,
        messages,
      });
      try {
        if (response.status !== 200)
          throw new ChatReplyError(
            [401, 403].includes(response.status)
              ? "服务凭据不可用，请联系管理员"
              : response.status === 429
                ? "服务繁忙或额度不足，请稍后重试"
                : "对话服务暂时不可用，请稍后重试",
          );
        yield {
          request_id: [...String(response.headers["x-request-id"] || "")]
            .slice(0, 200)
            .join(""),
        };
        let linesRead = 0;
        for await (const line of chatLines(
          response.body,
          String(response.headers["content-type"] || ""),
        )) {
          if (++linesRead > 16_384)
            throw new ChatReplyError("服务返回内容过长");
          if (linesRead % 128 === 0)
            await new Promise<void>((done) => setImmediate(done));
          signal.throwIfAborted();
          const value = event.parse(invoke("event", line));
          if (value.type === "done") return;
          if (value.type === "error")
            throw new ChatReplyError(
              value.code === "format"
                ? "服务返回格式无效"
                : "对话服务未能完成回复",
            );
          if (value.type === "chunk") {
            const usage = Object.fromEntries(
              Object.entries(value.usage).map(([key, digits]) => {
                const n = Number(digits);
                return [key, Number.isSafeInteger(n) ? n || 0 : BigInt(digits)];
              }),
            );
            yield { text: value.text, reason: value.reason, usage };
          }
        }
      } catch (error) {
        if (error instanceof Error && error.message === "chat-line-too-long")
          throw new ChatReplyError("服务返回内容过长");
        throw error;
      } finally {
        response.close();
      }
    },
    async chatTitle({ config, model, question, answer, signal }) {
      const response = await open("title", config, signal, {
        model,
        question,
        answer,
      });
      try {
        requireValue(
          response.status >= 200 && response.status < 300,
          502,
          "标题请求失败",
        );
        return titles.parse(invoke("title", await jsonText(response)));
      } finally {
        response.close();
      }
    },
  };
}
