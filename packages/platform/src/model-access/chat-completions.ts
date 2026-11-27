import {
  ChatReplyError,
  type ChatChunk,
  type ChatMessage,
} from "@fumiao/plugin-sdk/chat.js";
import {
  toolFragmentSchema,
  appendToolFragments,
  type ToolCall,
  type ModelTool,
} from "@fumiao/plugin-sdk/chat-tools.js";
import { httpChunks } from "../plugin-host.js";
import type { resolveConnectionRevision } from "./connections.js";
import {
  normalizeChatUsage,
  type NormalizedUsage,
  type ChatCallUsage,
} from "./chat.js";

type Client = Awaited<ReturnType<typeof resolveConnectionRevision>>;
async function* events(
  body: Buffer | ReadableStream<Uint8Array>,
  stream: boolean,
  signal: AbortSignal,
) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  const parse = (text: string) =>
    JSON.parse(text, (_key, v, ctx?: { source?: string }) =>
      typeof v === "number" &&
      !Number.isSafeInteger(v) &&
      /^\d{1,30}$/.test(ctx?.source ?? "")
        ? BigInt(ctx!.source!)
        : v,
    );
  // SSE events can span transport chunks and use CRLF. Dispatch on the blank line.
  let data: string[] = [];
  function line(value: string) {
    if (value.startsWith("data:")) data.push(value.slice(5).trimStart());
    if (value !== "" || !data.length) return;
    const event = data.join("\n");
    data = [];
    return event === "[DONE]" ? "done" : parse(event);
  }
  for await (const bytes of httpChunks(body, signal, 4 * 1024 * 1024)) {
    buffer += decoder.decode(bytes, { stream: true });
    if (!stream) continue;
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const event = line(buffer.slice(0, end).replace(/\r$/, ""));
      buffer = buffer.slice(end + 1);
      if (event === "done") return;
      if (event !== undefined) yield event;
    }
  }
  buffer += decoder.decode();
  if (!stream) {
    yield parse(buffer);
    return;
  }
  const last = line(buffer.replace(/\r$/, "")) ?? line("");
  if (last !== undefined && last !== "done") yield last;
}
export async function* chatCompletion(
  client: Client,
  model: string,
  messages: ChatMessage[],
  tools: ModelTool[],
  maxTokens: number,
  stream: boolean,
  signal: AbortSignal,
  record?: (usage: ChatCallUsage) => void,
  output = client.createOutputGuard(),
): AsyncGenerator<ChatChunk> {
  const res = await client.request(
    {
      endpoint: "chat/completions",
      method: "POST",
      content_type: "application/json",
      model,
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        stream,
        ...(stream ? { stream_options: { include_usage: true } } : {}),
        ...(tools.length ? { tools } : {}),
      }),
    },
    signal,
  );
  if (res.status < 200 || res.status >= 300) {
    if (!Buffer.isBuffer(res.body)) await res.body.cancel().catch(() => {});
    throw new ChatReplyError("对话服务未能完成回复");
  }
  let usage: NormalizedUsage | null = null;
  let reported = false;
  let finish: unknown;
  const calls = new Map<number, ToolCall>();
  try {
    for await (const event of events(
      res.body,
      res.contentType.toLowerCase().includes("text/event-stream"),
      signal,
    )) {
      if (!event || typeof event !== "object" || event.error)
        throw new ChatReplyError("对话服务未能完成回复");
      if (event.usage != null) {
        reported = true;
        usage = normalizeChatUsage(event.usage) ?? usage;
      }
      const choice = event.choices?.[0];
      const fragment = choice?.delta ?? choice?.message;
      if (fragment?.tool_calls) {
        appendToolFragments(
          calls,
          fragment.tool_calls.map((call: unknown, index: number) =>
            toolFragmentSchema.parse(
              choice.message && call && typeof call === "object"
                ? { ...call, index }
                : call,
            ),
          ),
        );
      }
      if (choice?.finish_reason != null) {
        if (
          ![
            "stop",
            "length",
            "tool_calls",
            "content_filter",
            "function_call",
          ].includes(choice.finish_reason) ||
          client.containsCredential(choice.finish_reason)
        )
          throw new ChatReplyError("对话服务返回的结束状态无效");
        finish = choice.finish_reason;
      }
      if (fragment?.content != null) {
        if (typeof fragment.content !== "string")
          throw new ChatReplyError("对话服务返回的正文无效");
        const text = output.write(fragment.content);
        if (text) yield { text };
      }
    }
    // Only assembled tool fields can be validated: fragments can split a name,
    // an ID, or even a JSON escape sequence inside a tool argument.
    const toolCalls = [];
    for (const [index, call] of calls) {
      const args = JSON.stringify(JSON.parse(call.function.arguments));
      if (
        [call.id, call.function.name, call.function.arguments, args].some((s) =>
          client.containsCredential(s),
        )
      )
        throw new ChatReplyError("对话工具返回了受保护的内容");
      toolCalls.push({ ...call, index });
    }
    yield {
      text: finish === "tool_calls" ? "" : output.finish(),
      reason: finish,
      ...(toolCalls.length ? { toolCalls } : {}),
    };
  } finally {
    record?.(usage ?? (reported ? "invalid" : null));
  }
}
