import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { gzipSync, deflateSync, deflateRawSync } from "node:zlib";
import {
  chatStreaming,
  parseChatStream,
} from "../../plugins/chat/src/stream.js";
import { chatStudio } from "../../plugins/chat/src/studio.js";
import {
  chatHttp,
  chatLines,
  ChatTransportError,
} from "../../plugins/chat/src/transport.js";
import { ChatReplyError } from "../../packages/plugin-sdk/src/index.js";
import { chatProviderFixture } from "../helpers/chat-provider.js";
import { databaseFixture } from "../helpers/database.js";
import { one } from "../../packages/platform/src/db.js";
async function* sequence<T>(values: T[]) {
  yield* values;
}
async function collect<T>(stream: AsyncIterable<T>) {
  const result: T[] = [];
  for await (const row of stream) result.push(row);
  return result;
}
test("Chat stream filters reasoning, preserves integer usage lexemes and carries provider/model routing in a versioned plugin", async () => {
  const f = await chatProviderFixture();
  try {
    for (const model of ["deepseek-flash", "gpt-4.1"]) {
      const result = await f.run(
        {
          kind: "stream",
          model,
          wire: {
            raw: 'data: {"choices":[{"delta":{"content":"你好😀","reasoning_content":"hidden"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1.0,"completion_tokens":2e0,"total_tokens":9007199254740993,"prompt_cache_hit_tokens":true,"prompt_cache_miss_tokens":-1,"secret":"hidden"}}\ndata: [DONE]\ndata: invalid\n',
          },
        },
        [{ role: "user", content: "问题" }],
      );
      assert.deepEqual(result, {
        chunks: [
          { request_id: "fixture-request" },
          {
            text: "你好😀",
            reason: "stop",
            usage: {
              total_tokens: { $integer: "9007199254740993" },
              prompt_cache_miss_tokens: -1,
            },
          },
        ],
      });
      assert.equal(f.requests.length, 1);
      const request = f.requests[0];
      assert.equal(
        request.path,
        model === "deepseek-flash"
          ? "/chat/completions"
          : "/v1/chat/completions",
      );
      assert.deepEqual(
        request.body.thinking,
        model === "deepseek-flash" ? { type: "disabled" } : undefined,
      );
      assert.equal(request.body.max_tokens, 4096);
      assert.equal(request.body.stream_options.include_usage, true);
    }
    await assert.rejects(
      collect(
        chatStreaming.chatStream!({
          model: "gpt-4.1",
          messages: [],
          config: f.config("deepseek-flash"),
          signal: AbortSignal.timeout(1000),
        }),
      ),
      /Model does not belong/,
    );
    assert.equal(f.requests.length, 1);
  } finally {
    await f.cleanup();
  }
});
test("Chat line decoder preserves Python BOM, Unicode and CR boundaries and bounds oversized incomplete lines without replacing disconnect errors", async () => {
  const raw =
    '\ufeffdata: ignored\r\ndata: {"choices":[{"delta":{"content":"😀é"}}]}\u2028data: [DONE]\r';
  const bytes = Buffer.from(raw);
  const lines = await collect(
    chatLines(
      sequence([...bytes].map((b) => Uint8Array.of(b))),
      "text/event-stream; charset=utf-8",
    ),
  );
  assert.deepEqual(lines, [
    "\ufeffdata: ignored",
    'data: {"choices":[{"delta":{"content":"😀é"}}]}',
    "data: [DONE]",
  ]);
  assert.deepEqual(await collect(parseChatStream(sequence(lines))), [
    { text: "😀é", reason: null, usage: {} },
  ]);
  await assert.rejects(
    collect(parseChatStream(sequence(["data: \ufeff{}"]))),
    new ChatReplyError("服务返回格式无效"),
  );
  const partial = Buffer.alloc(1024 * 1024 + 1, 120);
  async function* interrupted() {
    yield partial;
    throw new Error("network-error");
  }
  await assert.rejects(collect(chatLines(interrupted(), "")), /network-error/);
  await assert.rejects(
    collect(chatLines(sequence([partial]), "")),
    /chat-line-too-long/,
  );
  assert.equal(
    (
      await collect(
        chatLines(sequence([partial.subarray(1), Buffer.from("\n")]), ""),
      )
    )[0].length,
    1024 * 1024,
  );
});
test("Chat transport uses read-idle timeouts, propagates aborts through decoders and never redirects/replays", async () => {
  let count = 0,
    live = 0;
  const server = createServer(async (req, res) => {
    count++;
    live++;
    res.on("close", () => live--);
    req.resume();
    if (req.url === "/redirect") {
      res.writeHead(302, { location: "/unexpected" });
      res.end();
      return;
    }
    if (req.url === "/gzip") {
      res.writeHead(200, { "content-encoding": "gzip" });
      res.flushHeaders();
      const chunk = gzipSync(Buffer.from("data: {}\n"));
      res.write(chunk.subarray(0, -8));
      return;
    }
    res.writeHead(200);
    res.flushHeaders();
    if (req.url === "/active") {
      for (let i = 0; i < 6; i++) {
        if (res.destroyed) return;
        res.write("a");
        await delay(10);
      }
      res.end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const options = {
    method: "GET" as const,
    key: "fixture",
    signal: AbortSignal.timeout(3000),
    connectMs: 1000,
    readMs: 45,
  };
  try {
    const active = await chatHttp(new URL(origin + "/active"), options);
    try {
      assert.equal(
        Buffer.concat(await collect(active.body)).toString(),
        "aaaaaa",
      );
    } finally {
      active.close();
    }
    const idle = await chatHttp(new URL(origin + "/idle"), options);
    try {
      await assert.rejects(collect(idle.body), ChatTransportError);
    } finally {
      idle.close();
    }
    const abort = new AbortController();
    const compressed = await chatHttp(new URL(origin + "/gzip"), {
      ...options,
      signal: abort.signal,
      readMs: 1000,
    });
    const pending = collect(compressed.body);
    abort.abort();
    try {
      await assert.rejects(pending, ChatTransportError);
    } finally {
      compressed.close();
    }
    const redirected = await chatHttp(new URL(origin + "/redirect"), options);
    try {
      assert.equal(redirected.status, 302);
    } finally {
      redirected.close();
    }
    await delay(20);
    assert.equal(count, 4);
    assert.equal(live, 0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
test("Chat compressed responses support gzip and both deflate formats; body failures remain probe transport errors", async () => {
  const f = await chatProviderFixture();
  try {
    for (const [coding, body] of [
      ["gzip", gzipSync(Buffer.from("data: {}\n"))],
      ["deflate", deflateSync(Buffer.from("data: {}\n"))],
      ["deflate", deflateRawSync(Buffer.from("data: {}\n"))],
    ] as const) {
      const result = await f.run(
        {
          kind: "stream",
          model: "deepseek-flash",
          wire: {
            hex: body.toString("hex"),
            headers: { "content-encoding": coding },
          },
        },
        [],
      );
      assert.deepEqual(result, {
        chunks: [
          { request_id: "fixture-request" },
          { text: "", reason: null, usage: {} },
        ],
      });
    }
    const interrupted = await f.run(
      {
        kind: "probe",
        model: "deepseek-flash",
        wire: { raw: "{}", interrupt: true },
      },
      [],
    );
    assert.deepEqual(interrupted, {
      error: { kind: "probe", message: "连接超时或服务不可用" },
    });
    const malformed = await f.run(
      { kind: "probe", model: "deepseek-flash", wire: { raw: "invalid" } },
      [],
    );
    assert.deepEqual(malformed, { error: { kind: "generic" } });
  } finally {
    await f.cleanup();
  }
});
test("Installing chat streaming keeps the active catalog pinned and rejects unsupported remote chat capabilities", async () => {
  const f = await databaseFixture();
  try {
    await f.p.registry.installBuiltins(f.db);
    const pinned = await one(
      f.db,
      "SELECT plugin_version FROM studio_catalog WHERE id='deepseek-flash'",
    );
    assert.equal(pinned.plugin_version, "1.1.0");
    const plugin = await f.p.registry.resolve(
      f.db,
      chatStreaming.manifest.id,
      "1.2.0",
    );
    assert.equal(plugin.chatProvider!({ provider: "openai" }), "openai");
    assert.equal(
      plugin.chatConfigured!({ provider: "openai", apiKey: "\x85\u3000" }),
      false,
    );
    assert.equal(
      plugin.chatConfigured!({ provider: "deepseek", apiKey: " legacy-key " }),
      true,
    );
    assert.equal(chatStudio.manifest.chat, undefined);
    assert.equal(chatStudio.chatStream, undefined);
    await assert.rejects(
      f.p.registry.install(
        f.db,
        { ...chatStreaming.manifest, id: "remote-chat" },
        "https://plugin.example",
      ),
      { status: 400 },
    );
    await f.p.registry.installBuiltins(f.db);
    assert.equal(
      (
        await one(
          f.db,
          "SELECT plugin_version FROM studio_catalog WHERE id='deepseek-flash'",
        )
      ).plugin_version,
      "1.1.0",
    );
  } finally {
    await f.cleanup();
  }
});
