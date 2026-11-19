import { createServer } from "node:http";
import { once } from "node:events";
import {
  setTimeout as delay,
  setImmediate as tick,
} from "node:timers/promises";
import { chatStreaming } from "../../plugins/chat/src/stream.js";
import {
  ChatReplyError,
  ChatProbeError,
} from "../../packages/plugin-sdk/src/index.js";
export type ChatWire = {
  raw?: string;
  hex?: string;
  status?: number;
  type?: string;
  requestId?: string;
  headers?: Record<string, string>;
  chunks?: number[];
  afterChunk?: (index: number) => Promise<void>;
  disconnect?: boolean;
  interrupt?: boolean;
  hang?: boolean;
};
export function normalizeChat(value: any): any {
  if (typeof value === "bigint") return { $integer: String(value) };
  if (typeof value === "number" && !Number.isFinite(value))
    return { $number: String(value) };
  if (Array.isArray(value)) return value.map(normalizeChat);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, normalizeChat(v)]),
    );
  return value;
}
export async function chatProviderFixture() {
  let current: { kind: string; wire: ChatWire } = { kind: "stream", wire: {} };
  let stallNext = false;
  const requests: any[] = [];
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const b of req) chunks.push(b);
      const input = Buffer.concat(chunks).toString();
      const body = input ? JSON.parse(input) : null;
      requests.push({
        method: req.method,
        path: req.url,
        authorization: req.headers.authorization,
        acceptEncoding: req.headers["accept-encoding"],
        body,
      });
      const { wire, kind } = current;
      if (wire.disconnect) {
        req.socket.destroy();
        return;
      }
      res.writeHead(wire.status ?? 200, {
        "content-type":
          wire.type ??
          (kind === "stream" ? "text/event-stream" : "application/json"),
        "x-request-id": wire.requestId ?? "fixture-request",
        ...wire.headers,
      });
      res.flushHeaders();
      if (stallNext && body?.stream) {
        stallNext = false;
        await once(res, "close");
        return;
      }
      if (wire.hang) {
        await delay(10);
        res.destroy();
        return;
      }
      let bytes =
        wire.hex !== undefined
          ? Buffer.from(wire.hex, "hex")
          : Buffer.from(wire.raw ?? "{}");
      for (const [i, n] of (wire.chunks ?? []).entries()) {
        if (res.destroyed || !bytes.length) break;
        res.write(bytes.subarray(0, n));
        bytes = bytes.subarray(n);
        if (wire.afterChunk) await wire.afterChunk(i);
        await tick();
      }
      if (res.destroyed) return;
      if (wire.interrupt) {
        res.write(bytes);
        await delay(10);
        res.destroy();
      } else res.end(bytes);
    } catch {
      res.destroy();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  return {
    origin,
    requests,
    stallNextStream() {
      stallNext = true;
    },
    setWire(kind: string, wire: ChatWire) {
      current = { kind, wire };
      requests.length = 0;
    },
    config(model = "deepseek-flash") {
      return {
        provider: model === "deepseek-flash" ? "deepseek" : "openai",
        baseUrl: origin + (model === "deepseek-flash" ? "/" : "/v1/"),
        apiKey: "sk-local-chat-fixture",
      };
    },
    async run(c: any, messages: any[]) {
      this.setWire(c.kind, c.wire ?? {});
      const request = {
        config: this.config(c.model),
        model: c.model,
        signal: AbortSignal.timeout(5000),
      };
      const result: Record<string, any> = {};
      try {
        if (c.kind === "stream") {
          result.chunks = [];
          for await (const chunk of chatStreaming.chatStream!({
            ...request,
            messages,
          }))
            result.chunks.push(chunk);
        } else if (c.kind === "title")
          result.title = await chatStreaming.chatTitle!({
            ...request,
            question: c.question ?? "首轮问题😀",
            answer: c.answer ?? "首轮回答😀",
          });
        else {
          await chatStreaming.chatProbe!(request.config, request.signal);
          result.probe = { ok: true };
        }
      } catch (error) {
        result.error =
          error instanceof ChatReplyError
            ? { kind: "reply", message: error.message }
            : error instanceof ChatProbeError
              ? { kind: "probe", message: error.message }
              : { kind: "generic" };
      }
      return normalizeChat(result);
    },
    async cleanup() {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
