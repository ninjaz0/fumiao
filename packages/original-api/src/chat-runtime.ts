import { chatContext } from "@fumiao/platform/chat-context.js";
import { chatText } from "@fumiao/platform/chat-values.js";
import { pythonStrip, pythonTruthy } from "@fumiao/plugin-sdk/python-values.js";
import {
  ChatReplyError,
  type ProviderPlugin,
  type ChatChunk,
} from "@fumiao/plugin-sdk/index.js";
import { creditUnits } from "@fumiao/platform/credit-amount.js";
import {
  chatLimit,
  chatBill,
  type ChatCallUsage,
} from "@fumiao/platform/model-access/chat.js";
import { chatCompletion } from "@fumiao/platform/model-access/chat-completions.js";
import { resolveConnectionRevision } from "@fumiao/platform/model-access/connections.js";
import {
  generationTransport,
  type HttpTransport,
} from "@fumiao/platform/plugin-host.js";
import type { NativeChatSnapshot } from "./chat-billing.js";
import { chatToolStream } from "./chat-tool-stream.js";
import { turnTools } from "./chat-tools.js";
import type { ChatExecution } from "./chat-execution.js";

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const stop = () => reject(signal.reason);
    signal.addEventListener("abort", stop, { once: true });
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", stop));
    if (signal.aborted) stop();
  });
}
/** SQLite coerces scalar finish reasons to TEXT, but rejects containers. Keep a
 * malformed container distinct: settlement fails and lease recovery refunds it. */
function reasonText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number" && Number.isSafeInteger(value))
    return String(value);
  throw new TypeError("Invalid chat finish reason");
}
export class ChatRuntime {
  private active = new Map<
    string,
    { controller: AbortController; task: Promise<void> }
  >();
  private stopping = false;
  constructor(
    readonly store: ChatExecution,
    readonly options: {
      nativeHttp?: HttpTransport<string | Uint8Array>;
      pollMs?: number;
      timeoutMs?: number;
      titleTimeoutMs?: number;
      monotonic?: () => number;
    } = {},
  ) {}
  execute(id: string): Promise<void> {
    if (this.stopping || this.active.has(id)) return Promise.resolve();
    const controller = new AbortController();
    const task = this.run(id, controller).finally(() => this.active.delete(id));
    this.active.set(id, { controller, task });
    return task;
  }
  async close() {
    this.stopping = true;
    for (const entry of this.active.values())
      entry.controller.abort("shutdown");
    await Promise.allSettled([...this.active.values()].map((v) => v.task));
  }
  private async run(id: string, controller: AbortController) {
    const claim = await this.store.claim(id);
    if (!claim) return;
    const { turn, lease } = claim,
      { signal } = controller;
    const monotonic =
      this.options.monotonic ?? (() => Number(process.hrtime.bigint()) / 1e9);
    const calls: ChatCallUsage[] = [];
    let text = "",
      usage: Record<string, number | bigint> = {},
      reason: unknown = "",
      last = 0,
      first: number | null = null;
    let timer: NodeJS.Timeout | undefined,
      checking = false,
      streaming = true;
    let iterator: AsyncIterator<ChatChunk> | undefined;
    const heartbeat = setInterval(() => {
      if (checking || signal.aborted || !streaming) return;
      checking = true;
      void this.store
        .heartbeat(id, lease)
        .then(
          (alive) => {
            if (!alive && streaming) controller.abort("lost");
          },
          () => {
            if (streaming) controller.abort("lost");
          },
        )
        .finally(() => {
          checking = false;
        });
    }, this.options.pollMs ?? 1000);
    heartbeat.unref();
    try {
      signal.throwIfAborted();
      const snapshot: NativeChatSnapshot | null = turn.native_snapshot
        ? JSON.parse(turn.native_snapshot)
        : null;
      const messages =
        snapshot?.messages ?? chatContext(claim.rows, claim.skills);
      if (!(await this.store.start(id, lease))) return;
      timer = setTimeout(
        () => controller.abort("timeout"),
        this.options.timeoutMs ?? 600000,
      );
      timer.unref();
      let adapter: Pick<ProviderPlugin, "chatStream" | "chatTitle">;
      let useTools: boolean, config: Record<string, unknown>;
      let validateToolOutput: ((value: unknown) => void) | undefined;
      if (snapshot) {
        const route = snapshot.route;
        const client = await resolveConnectionRevision(
          this.store.p.db,
          this.store.p,
          route.connectionRevisionId,
          this.options.nativeHttp ?? generationTransport,
        );
        const output = client.createOutputGuard();
        validateToolOutput = (value) => {
          if (client.containsCredential(JSON.stringify(value)))
            throw new ChatReplyError("对话工具返回了受保护的内容");
        };
        config = {};
        useTools =
          route.capabilities.tools ??
          route.capabilities.names?.includes("tools") ??
          false;
        adapter = {
          chatStream(request) {
            const spent = chatBill(
              route.price,
              calls,
              snapshot.max_charge,
              "complete",
            ).charged;
            const { max_output_tokens } = chatLimit(
              route.price,
              route.capabilities,
              request.messages,
              request.tools ?? [],
              creditUnits(snapshot.max_charge) - creditUnits(spent),
              snapshot.max_output_tokens,
            );
            if (!max_output_tokens)
              throw new ChatReplyError(
                "本轮授权额度不足以继续生成，积分已退回",
              );
            return chatCompletion(
              client,
              route,
              request.messages,
              request.tools ?? [],
              max_output_tokens,
              route.capabilities.chat_response !== "json",
              request.signal,
              (usage) => calls.push(usage),
              output,
            );
          },
          async chatTitle(request) {
            let title = "";
            const messages = [
              {
                role: "system" as const,
                content: "为以下对话拟定简短标题，只输出标题。",
              },
              {
                role: "user" as const,
                content:
                  request.question.slice(0, 1000) +
                  "\n" +
                  request.answer.slice(0, 1000),
              },
            ];
            for await (const chunk of chatCompletion(
              client,
              route,
              messages,
              [],
              Math.min(64, route.capabilities.max_completion_tokens ?? 64),
              false,
              request.signal,
            ))
              if (typeof chunk.text === "string") title += chunk.text;
            return [...title.trim()].slice(0, 80).join("");
          },
        };
      } else {
        const plugin = await this.store.p.registry.resolve(
          this.store.p.db,
          turn.plugin_id,
          turn.plugin_version,
        );
        config = this.store.p.vault.open(turn.config_snapshot);
        adapter = plugin;
        useTools =
          Boolean(plugin.manifest.chat?.sandbox?.tools) ||
          (Boolean(plugin.manifest.chat) &&
            (await turnTools(this.store.p.db, id)).size > 0);
      }
      if (!adapter.chatStream) throw new Error("Missing frozen chat adapter");
      signal.throwIfAborted();
      const request = { model: turn.model, messages, config, signal };
      const stream = useTools
        ? chatToolStream(
            this.store,
            id,
            lease,
            adapter,
            request,
            snapshot?.project,
            validateToolOutput,
          )
        : adapter.chatStream(request);
      iterator = stream[Symbol.asyncIterator]();
      while (true) {
        signal.throwIfAborted();
        const next = await abortable(iterator.next(), signal);
        if (next.done) break;
        const item = next.value;
        if (pythonTruthy(item.text)) {
          if (typeof item.text !== "string")
            throw new TypeError("Invalid chat text");
          text += item.text;
          first ||= this.store.chats.clock();
        }
        if ([...text].length > 50000)
          throw new ChatReplyError("回复过长，已停止。请缩小本次写作范围");
        if (pythonTruthy(item.usage)) usage = item.usage!;
        if (pythonTruthy(item.reason)) reason = item.reason;
        if (monotonic() - last > 0.15 || pythonTruthy(item.reason)) {
          if (
            !(await this.store.progress(
              id,
              lease,
              text,
              first,
              item.request_id ?? "",
            ))
          )
            return;
          last = monotonic();
        }
      }
      clearTimeout(timer);
      timer = undefined;
      streaming = false;
      const success = !!pythonStrip(text) && reason === "stop";
      const error = success
        ? ""
        : reason === "length"
          ? "回复达到长度限制，请缩小本次写作范围"
          : "回复未完整结束，请重试";
      const completed = await this.store.chats.finish(
        id,
        {
          state: success ? "complete" : "failed",
          text,
          usage,
          calls,
          error,
          reason: reasonText(reason),
        },
        lease,
      );
      if (completed && success)
        await this.summarize(id, turn.model, adapter, config, text, signal);
    } catch (error) {
      streaming = false;
      if (signal.aborted && signal.reason === "lost") return;
      const stopped = signal.aborted && signal.reason === "shutdown";
      await this.store.chats.finish(
        id,
        {
          state: stopped ? "stopped" : "failed",
          text,
          usage,
          calls,
          reason: reasonText(reason),
          error: stopped
            ? ""
            : error instanceof ChatReplyError
              ? error.message
              : "连接中断，未完成的回复已退回积分",
        },
        lease,
      );
    } finally {
      clearInterval(heartbeat);
      clearTimeout(timer);
      // Abort closes the transport even if the iterator is suspended in next().
      controller.abort("closed");
      void iterator?.return?.().catch(() => {});
    }
  }
  private async summarize(
    id: string,
    model: string,
    plugin: Pick<ProviderPlugin, "chatTitle">,
    config: Record<string, unknown>,
    answer: string,
    signal: AbortSignal,
  ) {
    const controller = new AbortController(),
      abort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(
      () => controller.abort("title-timeout"),
      this.options.titleTimeoutMs ?? 15000,
    );
    timer.unref();
    try {
      if (signal.aborted) abort();
      const candidate = await this.store.titleCandidate(id);
      if (!candidate || controller.signal.aborted || !plugin.chatTitle) return;
      const title = await abortable(
        plugin.chatTitle({
          model,
          question: chatText(candidate.content),
          answer,
          config,
          signal: controller.signal,
        }),
        controller.signal,
      );
      if (title)
        await this.store.title(
          { id: candidate.id, title: candidate.title },
          title,
        );
    } catch {
      /* Best-effort metadata cannot undo a settled reply. */
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      controller.abort("closed");
    }
  }
}
