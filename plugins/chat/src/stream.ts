import { chatStudio } from "./studio.js";
import { chatHttp, chatLines, ChatTransportError } from "./transport.js";
import {
  pythonJson,
  pythonJsonText,
} from "@fumiao/plugin-sdk/json.js";
import {
  pythonStrip as strip,
  pythonTruthy as truthy,
} from "@fumiao/plugin-sdk/python-values.js";
import {
  ChatReplyError,
  ChatProbeError,
  type ProviderPlugin,
  type ChatRequest,
  type ChatChunk,
} from "@fumiao/plugin-sdk/index.js";
import {
  providers,
  record,
  provider,
  configFor,
  chatPayload,
  chatTitlePayload,
  chatTitleResult,
} from "./policy.js";
export {
  TITLE_SYSTEM,
  chatPayload,
  chatTitlePayload,
  chatTitleResult,
} from "./policy.js";
export async function* parseChatStream(
  lines: AsyncIterable<string>,
): AsyncIterable<ChatChunk> {
  for await (const line of lines) {
    if ([...line].length > 1024 * 1024)
      throw new ChatReplyError("服务返回内容过长");
    if (!line.startsWith("data:")) continue;
    const data = strip(line.slice(5));
    if (data === "[DONE]") return;
    let parsed: any;
    const integers = new WeakMap<object, Map<string, number | bigint>>();
    try {
      parsed = pythonJsonText(data, function (key, value, context) {
        if (typeof value === "number" && /^-?\d+$/.test(context.source ?? "")) {
          const source = context.source!;
          if (source.replace(/^-/, "").length > 4300)
            throw new Error("Integer string limit");
          let keys = integers.get(this);
          if (!keys) integers.set(this, (keys = new Map()));
          keys.set(
            key,
            Number.isSafeInteger(value)
              ? value === 0
                ? 0
                : value
              : BigInt(source),
          );
        }
        return value;
      });
    } catch {
      throw new ChatReplyError("服务返回格式无效");
    }
    const item = record(parsed);
    if (truthy(item.error)) throw new ChatReplyError("对话服务未能完成回复");
    const choices = truthy(item.choices) ? item.choices : [];
    if (!Array.isArray(choices)) throw new Error("Invalid choices");
    const choice = choices.length ? record(choices[0]) : {},
      delta = record(truthy(choice.delta) ? choice.delta : {}),
      usage = record(truthy(item.usage) ? item.usage : {});
    yield {
      text: truthy(delta.content) ? delta.content : "",
      reason: Object.hasOwn(choice, "finish_reason")
        ? choice.finish_reason
        : null,
      usage: Object.fromEntries(
        Object.entries(usage)
          .filter(
            ([key, value]) =>
              [
                "prompt_tokens",
                "completion_tokens",
                "total_tokens",
                "prompt_cache_hit_tokens",
                "prompt_cache_miss_tokens",
              ].includes(key) && integers.get(usage)?.has(key),
          )
          .map(([key]) => [key, integers.get(usage)!.get(key)!]),
      ),
    };
  }
}
async function jsonBody(body: AsyncIterable<Uint8Array>) {
  const chunks: Uint8Array[] = [];
  for await (const b of body) chunks.push(b);
  return pythonJson(Buffer.concat(chunks));
}
export const chatStreaming: ProviderPlugin = {
  ...chatStudio,
  manifest: {
    ...chatStudio.manifest,
    version: "1.2.0",
    configSchema: {
      type: "object",
      required: ["provider"],
      additionalProperties: false,
      properties: {
        provider: { type: "string", enum: Object.keys(providers) },
        apiKey: { type: "string", writeOnly: true },
        baseUrl: { type: "string", pattern: "^https?://" },
      },
    },
    chat: {
      version: 1,
      providers: Object.entries(providers).map(([id, p]) => ({
        id,
        label: p.label,
        models: p.models,
        defaultConfig: { provider: id, baseUrl: p.baseUrl },
        ...(id === "openai"
          ? {
              credentialFallback: {
                model: "gpt-image-2.6-sunburst",
                field: "apiKey",
              },
            }
          : {}),
      })),
    },
  },
  chatProvider(config) {
    return Object.hasOwn(providers, String(config.provider))
      ? String(config.provider)
      : undefined;
  },
  chatConfigured(config) {
    return Boolean(provider(config).key);
  },
  chatConfigure(config, key) {
    provider(config);
    return { ...config, apiKey: key };
  },
  async health(config, signal) {
    try {
      await chatStreaming.chatProbe!(config, signal);
      return true;
    } catch {
      return false;
    }
  },
  async submit() {
    // This version is consumed by the durable conversation executor. Do not let
    // the old prototype media-job path accidentally run a second chat protocol.
    return { state: "failed", error: "对话需要通过会话接口发送" };
  },
  async *chatStream(e) {
    const config = configFor(e),
      response = await chatHttp(new URL("chat/completions", config.baseUrl), {
        method: "POST",
        body: chatPayload(e),
        key: config.key,
        signal: e.signal,
        connectMs: 15000,
        readMs: 90000,
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
      yield* parseChatStream(
        chatLines(
          response.body,
          String(response.headers["content-type"] || ""),
        ),
      );
    } catch (error) {
      if (error instanceof Error && error.message === "chat-line-too-long")
        throw new ChatReplyError("服务返回内容过长");
      throw error;
    } finally {
      response.close();
    }
  },
  async chatTitle(e) {
    const config = configFor(e),
      response = await chatHttp(new URL("chat/completions", config.baseUrl), {
        method: "POST",
        body: chatTitlePayload(e),
        key: config.key,
        signal: e.signal,
        connectMs: 5000,
        readMs: 12000,
      });
    try {
      if (response.status < 200 || response.status >= 300)
        throw new Error("Title request failed");
      return chatTitleResult(await jsonBody(response.body));
    } finally {
      response.close();
    }
  },
  async chatProbe(config, signal) {
    const connection = provider(config);
    let response: Awaited<ReturnType<typeof chatHttp>>;
    try {
      response = await chatHttp(new URL("models", connection.baseUrl), {
        method: "GET",
        key: connection.key,
        signal,
        connectMs: 15000,
        readMs: 15000,
      });
    } catch {
      throw new ChatProbeError("连接超时或服务不可用");
    }
    try {
      let body: any;
      if (response.status === 200) body = await jsonBody(response.body);
      let data =
        response.status === 200
          ? Object.hasOwn(record(body), "data")
            ? body.data
            : []
          : [];
      // Empty dict/string are iterable in Python and produce an empty model set.
      if (
        data === "" ||
        (data &&
          typeof data === "object" &&
          !Array.isArray(data) &&
          Object.keys(data).length === 0)
      )
        data = [];
      if (!Array.isArray(data)) throw new Error("Invalid model list");
      const ids = new Set(
        data.map((m) => {
          const item = record(m);
          if (!Object.hasOwn(item, "id")) throw new Error("Missing model ID");
          if (item.id !== null && typeof item.id === "object")
            throw new Error("Unhashable model ID");
          return item.id;
        }),
      );
      if (!ids.size)
        throw new ChatProbeError("连接未通过，请检查密钥与服务状态");
      if (!connection.models.some((m) => ids.has(m)))
        throw new ChatProbeError("连接成功，但当前密钥不可使用所选模型");
    } catch (error) {
      if (error instanceof ChatTransportError)
        throw new ChatProbeError("连接超时或服务不可用");
      throw error;
    } finally {
      response.close();
    }
  },
};
