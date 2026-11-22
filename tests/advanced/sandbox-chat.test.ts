import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { chatHttp } from "@fumiao/plugin-sdk/chat-transport.js";
import { manifestSchema } from "@fumiao/plugin-sdk/index.js";
import { sandboxChat } from "@fumiao/platform/sandbox-chat.js";
import { guardedLookup } from "@fumiao/platform/plugin-host.js";
import { chatTitlePayload } from "@fumiao/plugin-chat/stream.js";

const published = async () =>
  manifestSchema.parse(
    JSON.parse(
      await readFile(
        "plugins/compatible-chat/compatible-chat.fmplugin.json",
        "utf8",
      ),
    ).manifest,
  );
const signal = new AbortController().signal;
const config = { provider: "deepseek", apiKey: "synthetic-credential" };
const model = "deepseek-flash";

async function collect<T>(stream: AsyncIterable<T>) {
  const result: T[] = [];
  for await (const item of stream) result.push(item);
  return result;
}

function fixture(raw: string) {
  const calls: { url: URL; init: Parameters<typeof chatHttp>[1] }[] = [];
  let closes = 0;
  const send: typeof chatHttp = async (url, init) => {
    calls.push({ url, init });
    return {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-request-id": "wire-1",
      },
      body: (async function* () {
        const bytes = Buffer.from(raw);
        for (let i = 0; i < bytes.length; i += 3)
          yield bytes.subarray(i, i + 3);
      })(),
      close() {
        closes++;
      },
    };
  };
  return { calls, send, closes: () => closes };
}

test("published QuickJS chat policy streams events and preserves integer lexemes, UTF-8 and close", async () => {
  const wire = fixture(
    'data: {"choices":[{"delta":{"content":"河😀","reasoning_content":"hidden"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1.0,"completion_tokens":2e0,"total_tokens":9007199254740993,"prompt_cache_hit_tokens":false,"prompt_cache_miss_tokens":-1}}\r\ndata: [DONE]\r\ndata: invalid\n',
  );
  const plugin = await sandboxChat(await published(), wire.send);
  const chunks = await collect(
    plugin.chatStream!({
      model,
      config,
      signal,
      messages: [{ role: "user", content: "问题" }],
    }),
  );
  assert.deepEqual(chunks, [
    { request_id: "wire-1" },
    {
      text: "河😀",
      reason: "stop",
      usage: { total_tokens: 9007199254740993n, prompt_cache_miss_tokens: -1 },
    },
  ]);
  assert.equal(wire.closes(), 1);
  const { url, init } = wire.calls[0];
  assert.equal(url.href, "https://api.deepseek.com/chat/completions");
  assert.equal(init.key, config.apiKey);
  assert.equal(init.lookup, guardedLookup);
  assert.equal(JSON.stringify(init.body).includes(config.apiKey), false);
  assert.deepEqual(init.body, {
    model,
    messages: [{ role: "user", content: "问题" }],
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: 4096,
    thinking: { type: "disabled" },
  });
  const iterator = plugin.chatStream!({ model, config, signal, messages: [] })[
    Symbol.asyncIterator
  ]();
  await iterator.next();
  await iterator.return!();
  assert.equal(wire.closes(), 2);
});

test("sandbox chat routes title and probe through the configured connection", async () => {
  const request = {
    model,
    config: { ...config, baseUrl: "https://gateway.example/api/v1" },
    signal,
    question: "你好",
    answer: "世界",
  };
  const title = fixture(
    JSON.stringify({
      choices: [
        {
          finish_reason: "stop",
          message: { content: " 标题：  “简短 标题” " },
        },
      ],
    }),
  );
  assert.equal(
    await (
      await sandboxChat(await published(), title.send)
    ).chatTitle!(request),
    "简短 标题",
  );
  assert.equal(
    title.calls[0].url.href,
    "https://gateway.example/api/v1/chat/completions",
  );
  assert.deepEqual(title.calls[0].init.body, chatTitlePayload(request));
  const probe = fixture(JSON.stringify({ data: [{ id: model }] }));
  const plugin = await sandboxChat(await published(), probe.send);
  await plugin.chatProbe!(config, signal);
  assert.equal(probe.calls[0].init.method, "GET");
  assert.equal(probe.calls[0].url.href, "https://api.deepseek.com/models");
  for (const baseUrl of [
    "https://127.0.0.1",
    "http://example.com",
    "https://u:p@example.com",
  ]) {
    await assert.rejects(plugin.chatProbe!({ ...config, baseUrl }, signal));
  }
  assert.equal(probe.calls.length, 1);
  assert.equal(probe.closes(), 1);
});

test("mapping receives only request fields and cannot redirect connection authentication", async () => {
  const m = await published(),
    sandbox = m.chat!.sandbox!;
  sandbox.program =
    '({request(kind, input){return {path:"test",body:input}},event(){return {type:"done"}},title(){return ""},probe(){return "ok"}})';
  const wire = fixture("data: [DONE]\n");
  const plugin = await sandboxChat(m, wire.send);
  await collect(plugin.chatStream!({ model, config, signal, messages: [] }));
  assert.deepEqual(wire.calls[0].init.body, {
    model,
    messages: [],
    provider: "deepseek",
  });
  await assert.rejects(
    collect(
      plugin.chatStream!({
        model,
        signal,
        messages: [],
        config: {
          ...config,
          inheritedChatEndpoints: {
            probe: "https://api.deepseek.com/models",
            reply: "https://api.deepseek.com/chat/completions",
          },
        },
      }),
    ),
    /共享密钥授权范围/,
  );
  const stream = (p: typeof plugin) =>
    collect(p.chatStream!({ model, messages: [], config, signal }));
  sandbox.program = sandbox.program.replace(
    'path:"test"',
    'path:"https://example.net"',
  );
  await assert.rejects(stream(await sandboxChat(m, wire.send)));
  m.id = "third-party";
  m.chat!.providers[0].credentialFallback = {
    model: "another-connection",
    field: "apiKey",
  };
  await assert.rejects(sandboxChat(m, wire.send), /其他连接的密钥/);
  assert.equal(wire.calls.length, 1);
});
