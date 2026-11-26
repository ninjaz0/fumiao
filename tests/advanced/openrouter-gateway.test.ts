import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { contributionProblems } from "@fumiao/plugin-sdk/contributions.js";
import { chatHttp } from "@fumiao/plugin-sdk/chat-transport.js";
import { manifestSchema } from "@fumiao/plugin-sdk/index.js";
import { one } from "@fumiao/platform/db.js";
import { guardedLookup } from "@fumiao/platform/plugin-host.js";
import { sandboxChat } from "@fumiao/platform/sandbox-chat.js";
import {
  StudioPackages,
  parsePackageFile,
} from "@fumiao/platform/studio-packages.js";
import { canvasesFixture } from "../helpers/canvases.js";

const loadOpenRouterManifest = async () =>
  manifestSchema.parse(
    JSON.parse(
      await readFile(
        "plugins/openrouter-gateway/openrouter-gateway.fmplugin.json",
        "utf8",
      ),
    ).manifest,
  );

async function collect<T>(stream: AsyncIterable<T>) {
  const result: T[] = [];
  for await (const item of stream) result.push(item);
  return result;
}

function mockWire(raw: string) {
  const calls: { url: URL; init: Parameters<typeof chatHttp>[1] }[] = [];
  let closes = 0;
  const send: typeof chatHttp = async (url, init) => {
    calls.push({ url, init });
    return {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-request-id": "or-req-1",
      },
      body: (async function* () {
        yield Buffer.from(raw);
      })(),
      close() {
        closes++;
      },
    };
  };
  return { calls, send, closes: () => closes };
}

test("F006 openrouter-gateway package parses, installs alongside compatible-chat and exposes distinct catalog IDs", async () => {
  const f = await canvasesFixture();
  try {
    const raw = JSON.parse(
      await readFile(
        "plugins/openrouter-gateway/openrouter-gateway.fmplugin.json",
        "utf8",
      ),
    );
    const parsed = parsePackageFile(raw);
    assert.equal(parsed.id, "openrouter-gateway");
    const manifest = manifestSchema.parse(parsed.manifest);
    assert.ok(manifest.chat);
    assert.deepEqual(
      manifest.chat.providers.map((p) => p.id),
      ["openrouter", "newapi"],
    );
    assert.deepEqual(manifest.chat.sandbox?.allowedHeaders, [
      "HTTP-Referer",
      "X-Title",
    ]);

    const packages = new StudioPackages(f.p);
    await packages.install(f.admin, raw);
    const conn = await f.p.createConnection(
      f.admin,
      {
        name: "OpenRouter",
        pluginId: "openrouter-gateway",
        version: parsed.adapterVersion,
        config: {
          provider: "openrouter",
          apiKey: "sk-or-synthetic-test-key-1234567890",
          baseUrl: "https://openrouter.ai/api/v1/",
        },
        concurrency: 2,
      },
      true,
    );
    await f.p.updateConnection(f.admin, conn.id, {
      revision: 1,
      enabled: true,
      concurrency: 2,
    });
    const rev = (
      await one(
        f.db,
        "SELECT revision FROM studio_packages WHERE id='openrouter-gateway'",
      )
    ).revision;
    await packages.change(f.admin, "openrouter-gateway", rev, "enable");

    const installed = await packages.list(f.admin);
    const pkg = installed.find((p) => p.id === "openrouter-gateway");
    assert.ok(pkg);
    assert.equal(pkg.enabled, true);
  } finally {
    await f.cleanup();
  }
});

test("F006 openrouter provider sends allowlisted HTTP-Referer/X-Title headers, streams tools/text and probes /models", async () => {
  const signal = new AbortController().signal;
  const manifest = await loadOpenRouterManifest();
  const wire = mockWire(
    'data: {"choices":[{"delta":{"content":"你好","tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"search","arguments":"{\\"q\\":\\"猫\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":12,"completion_tokens":8,"total_tokens":20}}\n' +
      "data: [DONE]\n",
  );
  const plugin = await sandboxChat(manifest, wire.send);
  const config = {
    provider: "openrouter",
    apiKey: "synthetic-or-key",
  };
  const chunks = await collect(
    plugin.chatStream!({
      model: "anthropic/claude-sonnet-4",
      config,
      signal,
      messages: [{ role: "user", content: "写一个开场镜头" }],
      tools: [
        {
          type: "function",
          function: {
            name: "search",
            description: "Search assets",
            parameters: {
              type: "object",
              properties: { q: { type: "string" } },
              additionalProperties: false,
            },
          },
        },
      ],
    }),
  );

  assert.equal(chunks[0].request_id, "or-req-1");
  assert.equal(chunks[1].text, "你好");
  assert.equal(chunks[1].reason, "tool_calls");
  assert.deepEqual(chunks[1].toolCalls, [
    {
      index: 0,
      id: "call_1",
      type: "function",
      function: { name: "search", arguments: '{"q":"猫"}' },
    },
  ]);

  const call = wire.calls[0];
  assert.equal(call.url.href, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(call.init.key, "synthetic-or-key");
  assert.equal(call.init.lookup, guardedLookup);
  assert.deepEqual(call.init.extraHeaders, {
    "HTTP-Referer": "https://fumiao.studio",
    "X-Title": "Fumiao Studio",
  });
  assert.equal((call.init.body as { model: string }).model, "anthropic/claude-sonnet-4");

  // Probe OpenRouter /models
  const probeWire = mockWire(
    JSON.stringify({ data: [{ id: "anthropic/claude-sonnet-4" }] }),
  );
  const probePlugin = await sandboxChat(manifest, probeWire.send);
  await probePlugin.chatProbe!(config, signal);
  assert.equal(probeWire.calls[0].url.href, "https://openrouter.ai/api/v1/models");
  assert.equal(probeWire.calls[0].init.method, "GET");
});

test("F006 newapi provider strips newapi/ prefix on completions/title/probe and enforces HTTPS SSRF guard", async () => {
  const signal = new AbortController().signal;
  const manifest = await loadOpenRouterManifest();
  const wire = mockWire(
    'data: {"choices":[{"delta":{"content":"收到"},"finish_reason":"stop"}]}\ndata: [DONE]\n',
  );
  const plugin = await sandboxChat(manifest, wire.send);
  const config = {
    provider: "newapi",
    apiKey: "synthetic-newapi-key",
    baseUrl: "https://relay.example.com/v1",
  };

  await collect(
    plugin.chatStream!({
      model: "newapi/gpt-4.1",
      config,
      signal,
      messages: [{ role: "user", content: "测试" }],
    }),
  );
  assert.equal(wire.calls[0].url.href, "https://relay.example.com/v1/chat/completions");
  assert.equal((wire.calls[0].init.body as { model: string }).model, "gpt-4.1");

  // Title generation strips prefix too
  const titleWire = mockWire(
    JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: "“科幻分镜”" } }],
    }),
  );
  const titlePlugin = await sandboxChat(manifest, titleWire.send);
  const title = await titlePlugin.chatTitle!({
    model: "newapi/gpt-4.1",
    config,
    signal,
    question: "写科幻片",
    answer: "第一幕",
  });
  assert.equal(title, "科幻分镜");
  assert.equal(
    (titleWire.calls[0].init.body as { model: string }).model,
    "gpt-4.1",
  );

  // Probe accepts either stripped or prefixed model ID in /models
  const probeWire = mockWire(JSON.stringify({ data: [{ id: "gpt-4.1" }] }));
  const probePlugin = await sandboxChat(manifest, probeWire.send);
  await probePlugin.chatProbe!(config, signal);
  assert.equal(probeWire.calls[0].url.href, "https://relay.example.com/v1/models");

  // SSRF / insecure baseUrl rejected
  for (const badBase of ["https://127.0.0.1/v1", "http://relay.example.com/v1"]) {
    await assert.rejects(
      probePlugin.chatProbe!({ ...config, baseUrl: badBase }, signal),
    );
  }
});

test("F006 header allowlist rejects forbidden headers at manifest, sandbox load, runtime and transport layers", async () => {
  const signal = new AbortController().signal;

  // 1. Contribution validator blocks forbidden headers
  const problems = contributionProblems(
    {
      version: 1,
      hostCapabilities: ["http"],
      http: {
        origins: ["https://openrouter.ai"],
        allowedHeaders: ["HTTP-Referer", "Authorization"],
      },
      settingsPages: [],
    },
    { mode: "request", hasProgram: false },
  );
  assert.ok(problems.some((p) => p.includes("禁止声明受保护请求头")));

  // 2. sandboxChat blocks forbidden headers declared in chat.sandbox.allowedHeaders
  const mForbidden = await loadOpenRouterManifest();
  mForbidden.chat!.sandbox!.allowedHeaders = ["Cookie"];
  await assert.rejects(sandboxChat(mForbidden), /禁止声明受保护请求头/);

  // 3. sandboxChat blocks undeclared headers returned at runtime by policy
  const mSneaky = await loadOpenRouterManifest();
  mSneaky.chat!.sandbox!.program =
    '({request(){return {path:"chat/completions",headers:{"X-Evil":"1"},body:{}}},event(){return {type:"done"}},title(){return ""},probe(){return "ok"}})';
  const wire = mockWire("data: [DONE]\n");
  const sneakyPlugin = await sandboxChat(mSneaky, wire.send);
  await assert.rejects(
    collect(
      sneakyPlugin.chatStream!({
        model: "anthropic/claude-sonnet-4",
        config: { provider: "openrouter", apiKey: "k" },
        signal,
        messages: [],
      }),
    ),
    /未声明的请求头/,
  );
  assert.equal(wire.calls.length, 0);

  // 4. chatHttp transport strips forbidden/CRLF extraHeaders while forwarding safe headers
  let seenHeaders: Record<string, string | string[] | undefined> = {};
  const server = createServer((req, res) => {
    seenHeaders = req.headers;
    req.resume();
    res.writeHead(200);
    res.end("ok");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  try {
    const res = await chatHttp(new URL(`http://127.0.0.1:${port}/test`), {
      method: "GET",
      key: "real-bearer-token",
      signal: AbortSignal.timeout(3000),
      connectMs: 1000,
      readMs: 1000,
      extraHeaders: {
        "HTTP-Referer": "https://fumiao.example",
        "X-Title": "Fumiao",
        Authorization: "Bearer evil-override",
        Cookie: "session=hijack",
        "X-Injected": "bad\r\nX-Other: 1",
      },
    });
    res.close();
    assert.equal(seenHeaders["authorization"], "Bearer real-bearer-token");
    assert.equal(seenHeaders["cookie"], undefined);
    assert.equal(seenHeaders["x-injected"], undefined);
    assert.equal(seenHeaders["http-referer"], "https://fumiao.example");
    assert.equal(seenHeaders["x-title"], "Fumiao");
  } finally {
    server.close();
  }
});
