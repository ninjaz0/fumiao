import {
  ChatReplyError,
  type ChatChunk,
  type ChatRequest,
} from "@fumiao/plugin-sdk/chat.js";
import { pythonTruthy } from "@fumiao/plugin-sdk/python-values.js";
import type { ProviderPlugin } from "@fumiao/plugin-sdk/index.js";
import type { ChatExecution } from "./chat-execution.js";
import { turnTools, ChatToolCalls, executeChatTool } from "./chat-tools.js";

function addUsage(
  previous: NonNullable<ChatChunk["usage"]>,
  current: NonNullable<ChatChunk["usage"]>,
) {
  const total: NonNullable<ChatChunk["usage"]> = Object.assign(
    Object.create(null),
    previous,
  );
  for (const [key, value] of Object.entries(current)) {
    if (!Object.hasOwn(previous, key)) {
      total[key] = value;
      continue;
    }
    const n = BigInt(previous[key]) + BigInt(value);
    total[key] = Number.isSafeInteger(Number(n)) ? Number(n) : n;
  }
  return total;
}

// Each request reports cumulative usage within its own stream. Completed rounds
// are added once, including when the last event contains only usage.
export async function* chatToolStream(
  store: ChatExecution,
  id: string,
  lease: string,
  adapter: Pick<ProviderPlugin, "chatStream">,
  request: ChatRequest,
  project?: string | null,
  validateToolOutput?: (value: unknown) => void,
): AsyncGenerator<ChatChunk> {
  const tools = await turnTools(store.p.db, id, project);
  const messages = [...request.messages];
  const specs = [...tools.values()].map((t) => t.model);
  const used = new Set<string>();
  let previous: NonNullable<ChatChunk["usage"]> = {};
  for (let round = 0; ; round++) {
    request.signal.throwIfAborted();
    const batch = new ChatToolCalls();
    let text = "",
      reason: unknown = "",
      usage = previous;
    for await (const item of adapter.chatStream!({
      ...request,
      messages,
      ...(specs.length ? { tools: specs } : {}),
    })) {
      if (item.toolCalls) batch.append(item.toolCalls);
      if (typeof item.text === "string") text += item.text;
      if (pythonTruthy(item.reason)) reason = item.reason;
      if (item.usage && Object.keys(item.usage).length)
        usage = addUsage(previous, item.usage);
      yield {
        ...item,
        usage,
        ...(item.reason === "tool_calls" ? { reason: "" } : {}),
      };
    }
    if (reason !== "tool_calls") {
      if (batch.calls.size)
        throw new ChatReplyError("模型未完整返回对话工具调用");
      return;
    }
    if (round >= 4) throw new ChatReplyError("本次对话调用工具的轮次过多");
    const prepared = batch.prepare(tools, used);
    messages.push({
      role: "assistant",
      content: text,
      tool_calls: prepared.map((item) => item.call),
    });
    for (const { tool, call, args } of prepared) {
      const content = await executeChatTool(
        store,
        id,
        lease,
        tool,
        call,
        args,
        request.signal,
        validateToolOutput,
      );
      messages.push({ role: "tool", tool_call_id: call.id, content });
    }
    previous = usage;
  }
}
