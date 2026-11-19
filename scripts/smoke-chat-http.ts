import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createOriginalApp } from "../apps/api/src/original.js";
import { ChatExecution } from "../packages/original-api/src/chat-execution.js";
import { ChatQueue } from "../packages/original-api/src/chat-queue.js";
import { ChatRuntime } from "../packages/original-api/src/chat-runtime.js";
import { OriginalChats } from "../packages/original-api/src/chats.js";
import { StudioCatalog } from "../packages/platform/src/catalog.js";
import { importLegacy } from "../packages/platform/src/importer.js";
import { chatStreaming } from "../plugins/chat/src/stream.js";
import { flowText } from "../plugins/flow/src/text.js";
import { gpuText } from "../plugins/gpu/src/text.js";
import { imagesText } from "../plugins/images/src/text.js";
import { museText } from "../plugins/muse/src/text.js";
import { databaseFixture } from "../tests/helpers/database.js";

type Pair<T> = [T, T];
type User = "admin" | "member" | "anonymous";
const publicOrigin = "http://localhost:3000";
const model = "deepseek-flash";
const password = "chat-http-fixture";
const native = await databaseFixture();
const sides = ["oracle", "native"] as const;
const pending = new Map<string, ServerResponse>();
const providerRequests: Pair<any[]> = [[], []];
const provider = createServer(async (req, res) => {
  const index = req.url?.startsWith("/oracle/") ? 0 : 1;
  if (req.url === `/${sides[index]}/models`) {
    res.end(JSON.stringify({ data: [{ id: model }, { id: "gpt-4.1" }] }));
    return;
  }
  if (
    req.url !== `/${sides[index]}/chat/completions` ||
    req.headers.authorization !== `Bearer sk-${password}`
  ) {
    res.writeHead(403).end();
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  providerRequests[index].push(input);
  if (!input.stream) {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: "试写标题" } }],
      }),
    );
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "X-Request-Id": "chat-http-fixture",
  });
  res.flushHeaders();
  pending.set(sides[index], res);
});
provider.listen(0, "127.0.0.1");
await once(provider, "listening");
const address = provider.address();
assert.ok(address && typeof address !== "string");
const providerUrl = `http://127.0.0.1:${address.port}`;
const oracle = spawn(
  process.env.STUDIO_PYTHON ||
    resolve(".runtime-advanced/original/.venv/bin/python"),
  ["scripts/chat-http-oracle.py", native.directory, providerUrl],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let oracleError = "";
oracle.stderr.setEncoding("utf8").on("data", (data) => {
  oracleError += data;
});
oracle.on("error", (error) => {
  oracleError += String(error);
});
const oracleClosed = once(oracle, "close").catch(() => {});
const store = new ChatExecution(new OriginalChats(native.p));
const runtime = new ChatRuntime(store, { pollMs: 80 });
let queue: ChatQueue | undefined,
  app: Awaited<ReturnType<typeof createOriginalApp>> | undefined;
let dispatch: ReturnType<typeof setInterval> | undefined;
let dispatching: Promise<void> | undefined;
const workerErrors: Error[] = [];
const clients = new Set<AbortController>();
const origins: Pair<string> = ["", ""];
const sessions: Pair<Partial<Record<User, string>>> = [{}, {}];
const aliases: Pair<Map<string, string>> = [new Map(), new Map()];
const messageIds = new Map<number, number>();
let comparedResponses = 0,
  comparedEvents = 0;

async function until<T>(check: () => T | Promise<T>, label: string) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(25);
  }
  throw new Error(`Timed out waiting for ${label}\n${oracleError}`);
}

function names(ids: Pair<string>, kind: string) {
  const alias = aliases[0].get(ids[0]) ?? `$${kind}${aliases[0].size + 1}`;
  for (const [index, id] of ids.entries()) {
    assert.match(id, /^[a-f0-9]{32}$/);
    assert.equal(aliases[index].get(id) ?? alias, alias);
    aliases[index].set(id, alias);
  }
}

function normalize(value: any, side: number, key?: string): any {
  if (typeof value === "string") return aliases[side].get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => normalize(item, side));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, item]) => [
        k,
        side === 0 &&
        Object.hasOwn(value, "reply_to") &&
        ["id", "reply_to"].includes(k) &&
        typeof item === "number"
          ? messageIds.get(item)
          : normalize(item, side, k),
      ]),
    );
  if (
    typeof value === "number" &&
    ["created", "updated", "started", "finished"].includes(key ?? "")
  ) {
    assert.ok(Number.isFinite(value) && value > 0);
    return "$time";
  }
  return value;
}

type HttpOptions = {
  user?: User;
  workspace?: string;
  origin?: string;
  body?: unknown;
  raw?: string;
  contentType?: string;
};
async function request(
  index: number,
  method: string,
  path: string,
  options: HttpOptions = {},
) {
  const headers = new Headers({ origin: options.origin ?? publicOrigin });
  const cookie = sessions[index][options.user ?? "admin"];
  if (cookie) headers.set("cookie", cookie);
  if (options.workspace !== undefined)
    headers.set("x-workspace-id", options.workspace);
  const body =
    options.raw ??
    (options.body === undefined ? undefined : JSON.stringify(options.body));
  if (body !== undefined)
    headers.set("content-type", options.contentType ?? "application/json");
  const response = await fetch(origins[index] + path, {
    method,
    headers,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
  });
  if (path === "/api/login" && response.ok) {
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    assert.match(cookie ?? "", /^fm_session=.+$/);
    sessions[index][options.user ?? "admin"] = cookie;
  }
  const type = response.headers.get("content-type");
  const text = await response.text();
  return {
    status: response.status,
    type,
    body: type === "application/json" && text ? JSON.parse(text) : text,
    allow: response.headers.get("allow"),
    location:
      response.headers.get("location")?.replace(origins[index], "$origin") ??
      null,
  };
}

async function both(
  method: string,
  path: string | Pair<string>,
  status = 200,
  options: HttpOptions | ((index: number) => HttpOptions) = {},
  identify?: "chat" | "turn" | "node",
) {
  const urls = typeof path === "string" ? [path, path] : path;
  const results = await Promise.all(
    urls.map((url, index) =>
      request(
        index,
        method,
        url,
        typeof options === "function" ? options(index) : options,
      ),
    ),
  );
  const [original, advanced] = results;
  assert.equal(
    original.status,
    status,
    `${method} ${urls[0]} original ${JSON.stringify(original.body)}`,
  );
  if (identify === "chat")
    names(
      [original.body.conversation.id, advanced.body.conversation.id],
      identify,
    );
  if (identify === "turn") {
    names(
      [
        original.body.conversation.active_turn,
        advanced.body.conversation.active_turn,
      ],
      identify,
    );
    assert.equal(original.body.messages.length, advanced.body.messages.length);
    for (const [index, { id }] of original.body.messages.entries()) {
      const nativeId = advanced.body.messages[index].id;
      assert.ok(
        Number.isSafeInteger(id) &&
          Number.isSafeInteger(nativeId) &&
          id > 0 &&
          nativeId > 0,
      );
      assert.equal(messageIds.get(id) ?? nativeId, nativeId);
      messageIds.set(id, nativeId);
    }
  }
  if (identify === "node")
    names([original.body.applied_node, advanced.body.applied_node], identify);
  assert.deepEqual(
    normalize(advanced, 1),
    normalize(original, 0),
    `${method} ${urls[0]}`,
  );
  comparedResponses++;
  return [original.body, advanced.body] as Pair<any>;
}

function withMessageId(
  body: Record<string, unknown>,
  field: "message" | "retry",
) {
  const id = body[field] as number;
  assert.ok(messageIds.has(id));
  return (side: number) => ({
    body: { ...body, [field]: side ? messageIds.get(id) : id },
  });
}

const paths = (views: Pair<any>, suffix = ""): Pair<string> => [
  `/api/chats/${views[0].conversation.id}${suffix}`,
  `/api/chats/${views[1].conversation.id}${suffix}`,
];

async function subscribe(
  index: number,
  path: string,
  user: User,
  lastId = "fixture-last-event",
) {
  const controller = new AbortController();
  clients.add(controller);
  const response = await fetch(origins[index] + path, {
    headers: {
      cookie: sessions[index][user]!,
      accept: "text/event-stream",
      "last-event-id": lastId,
    },
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45_000)]),
  });
  assert.equal(response.status, 200);
  for (const [header, value] of Object.entries({
    "content-type": "text/event-stream; charset=utf-8",
    "x-accel-buffering": "no",
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
  }))
    assert.equal(response.headers.get(header), value, header);
  const reader = response
    .body!.pipeThrough(new TextDecoderStream())
    .getReader();
  let buffer = "",
    last = "";
  return {
    async next() {
      while (!buffer.includes("\n\n")) {
        const chunk = await reader.read();
        if (chunk.done) {
          assert.equal(buffer, "");
          return null;
        }
        buffer += chunk.value;
      }
      const end = buffer.indexOf("\n\n");
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (frame.startsWith("data: ")) {
        assert.notEqual(frame, last, "SSE emitted an unchanged snapshot");
        last = frame;
        return JSON.parse(frame.slice(6));
      }
      return frame;
    },
    close() {
      controller.abort();
      clients.delete(controller);
    },
  };
}

async function streams(views: Pair<any>, user: User = "admin", query = "") {
  const [first, second] = paths(views, "/events" + query);
  return Promise.all([subscribe(0, first, user), subscribe(1, second, user)]);
}

type Stream = Awaited<ReturnType<typeof subscribe>>;
async function frame(
  subscriptions: Pair<Stream>,
  wanted: (value: any) => boolean = () => true,
) {
  async function read(stream: Stream) {
    for (let count = 0; count < 10; count++) {
      const value = await stream.next();
      if (wanted(value)) return value;
      assert.notEqual(value, null, "stream ended while waiting for a snapshot");
    }
    assert.fail("SSE did not deliver the expected snapshot");
  }
  const [original, advanced] = await Promise.all(
    subscriptions.map((stream, side) =>
      read(stream).catch((error) => {
        throw new Error(
          `${sides[side]} failed while reading SSE frame ${comparedEvents + 1}`,
          { cause: error },
        );
      }),
    ),
  );
  assert.deepEqual(normalize(advanced, 1), normalize(original, 0), "SSE frame");
  comparedEvents++;
  return original;
}

function sendDraft(
  revision: number,
  price: number,
  extra: Record<string, unknown> = {},
) {
  return {
    uid: randomUUID(),
    model,
    text: "  写作请求😀  ",
    expected_revision: revision,
    price_revision: price,
    ...extra,
  };
}

function delta(
  res: ServerResponse,
  content: string,
  reason: string | null = null,
) {
  res.write(
    `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: reason }], ...(reason ? { usage: { total_tokens: 17 } } : {}) })}\n\n`,
  );
}

async function partial(responses: ServerResponse[], content: string) {
  // The initial provider request ID can itself claim the 150 ms progress window.
  await delay(300);
  for (const response of responses) delta(response, content);
}

async function providerPair() {
  const connected = await until(
    () =>
      pending.size === 2 ? sides.map((side) => pending.get(side)!) : undefined,
    "both provider requests",
  );
  pending.clear();
  return connected;
}

const answer = (value: any) => value?.messages?.at(-1);
const hasText = (text: string) => (value: any) =>
  answer(value)?.content === text;
const hasState = (state: string) => (value: any) =>
  answer(value)?.state === state;

try {
  process.env.PUBLIC_URL = publicOrigin;
  const fixture = await until(async () => {
    try {
      return JSON.parse(
        await readFile(join(native.directory, "server.json"), "utf8"),
      );
    } catch (error) {
      if (oracle.exitCode !== null || oracleError.includes("Traceback"))
        throw new Error(oracleError, { cause: error });
      return null;
    }
  }, "pinned server");
  origins[0] = `http://127.0.0.1:${fixture.port}`;
  const data = JSON.parse(
    await readFile(join(native.directory, "export.json"), "utf8"),
  );
  await native.p.registry.installBuiltins(native.db);
  await native.db.transaction(async (sql) => {
    const catalog = new StudioCatalog(native.db);
    for (const plugin of [
      chatStreaming,
      flowText,
      gpuText,
      imagesText,
      museText,
    ])
      await catalog.activate(sql, plugin.manifest);
  });
  await importLegacy(native.p, data, join(native.directory, "sqlite/media"));
  const admin = (
    await native.db.query("SELECT * FROM users WHERE name='admin'")
  ).rows[0];
  for (const provider of ["deepseek", "openai"]) {
    const connection = await native.p.createConnection(
      {
        id: admin.id,
        name: admin.name,
        role: admin.role,
        nickname: admin.nickname,
      },
      {
        name: provider,
        pluginId: chatStreaming.manifest.id,
        version: chatStreaming.manifest.version,
        config: {
          provider,
          baseUrl: `${providerUrl}/native/`,
          apiKey: `sk-${password}`,
        },
      },
    );
    await native.db.query("UPDATE connections SET enabled=true WHERE id=$1", [
      connection.id,
    ]);
  }
  if (process.env.TEST_REDIS_URL) {
    const url = new URL(process.env.TEST_REDIS_URL);
    queue = new ChatQueue(
      runtime,
      {
        host: url.hostname,
        port: Number(url.port || 6379),
        username: decodeURIComponent(url.username) || undefined,
        password: decodeURIComponent(url.password) || undefined,
        db: Number(url.pathname.slice(1) || 0),
        ...(url.protocol === "rediss:" ? { tls: {} } : {}),
      },
      {
        name: "test-chat-http-" + randomUUID(),
        dispatchMs: 80,
        onError: (error) => workerErrors.push(error),
      },
    );
    await queue.start();
  } else {
    // The portable path still uses the durable SQL outbox and original runtime.
    dispatch = setInterval(() => {
      dispatching ??= (async () => {
        await store.recover();
        for (const turn of await store.ready()) {
          await store.dispatched(turn.id);
          void runtime
            .execute(turn.id)
            .catch((error) => workerErrors.push(error));
        }
      })()
        .catch((error) => {
          workerErrors.push(error);
        })
        .finally(() => {
          dispatching = undefined;
        });
    }, 80);
  }
  app = await createOriginalApp(native.p);
  await app.listen(0, "127.0.0.1");
  origins[1] = await app.getUrl();

  await both("GET", "/api/chats", 401);
  await both("GET", "/api/%63hats", 401);
  await both("GET", "/api%2Fchats/example/%65vents", 401);
  await both("POST", "/api/chats", 403, {
    body: {},
    origin: "https://example.invalid",
  });
  await both("POST", "/api/chats", 422, {
    body: { model: 42, context: { extra: true } },
  });
  await both("POST", "/api/chats", 422);
  for (const raw of [
    "{",
    '{"😀":}',
    '{"model":"x",}',
    '{"model":"abc',
    "{} {}",
    "null",
  ])
    await both("POST", "/api/chats", 422, { raw });
  await both("POST", "/api/chats", 422, {
    raw: "{}",
    contentType: "text/plain",
  });
  await both("POST", "/api/chats", 401, {
    raw: "{}",
    contentType: "application/vnd.fixture+json",
  });
  await both("HEAD", "/api/chats", 405);
  await both("OPTIONS", "/api/chats/example", 405);
  await both("GET", "/api/chats/example/?workspace=1", 307);
  await both("GET", "/api/chats/a%2Fb/events", 404);
  await both("GET", "/API/CHATS", 404);
  await both("GET", "/api/chats/example/events", 401);
  for (const user of ["admin", "member"] as const)
    await both("POST", "/api/login", 200, {
      user,
      body: { name: user, password },
    });
  await both("GET", "/api/%63hats");
  const [config] = await both("GET", "/api/chat/config");
  const price = config.pricing.revision;
  const context = {
    project: fixture.canvas.id,
    node: "text-node",
    expected_revision: fixture.canvas.revision,
    writeback: true,
  };
  await both("POST", "/api/chats", 409, {
    body: { context: { ...context, node: "missing" } },
  });
  const first = await both(
    "POST",
    "/api/chats",
    200,
    { body: { context } },
    "chat",
  );
  await both(
    "GET",
    "/api/chats?project=missing&project=" + context.project + "&node=text-node",
  );
  await both("GET", "/api/chats?project=" + context.project);
  await both("GET", paths(first), 404, { user: "member" });
  await both("GET", paths(first, "/events"), 404, { user: "member" });
  await both("GET", paths(first, "?workspace=1"), 404);
  await both("GET", paths(first), 400, { workspace: "bad-workspace" });

  const initial = await streams(first);
  assert.equal((await frame(initial)).messages.length, 0);
  assert.equal(await frame(initial), ": keepalive");
  // Exercise both route families with the same session while SSE stays open.
  const canvasPath = "/api/canvases/" + context.project;
  await both("GET", "/api/canvases");
  await both("GET", canvasPath + "/runs");
  await both("POST", canvasPath + "/runs", 405, { raw: "{" });
  await both("PUT", canvasPath + "/document", 422, { raw: "{" });
  const large = "9007199254740993";
  const invalidRun = `{"uid":"${randomUUID()}","expected_revision":-${large},"extra":${large}}`;
  for (const base of origins) {
    const response = await fetch(base + canvasPath + "/nodes/text-node/runs", {
      method: "POST",
      headers: { origin: publicOrigin, "content-type": "application/json" },
      body: invalidRun,
      signal: AbortSignal.timeout(8000),
    });
    assert.equal(response.status, 422);
    const text = await response.text();
    assert.ok(text.includes(`"input":-${large}`), text);
    assert.ok(text.includes(`"input":${large}`), text);
  }
  const draft = sendDraft(first[0].conversation.revision, price, { context });
  await both("POST", paths(first, "/messages"), 409, {
    body: { ...draft, price_revision: price + 1 },
  });
  const sent = await both(
    "POST",
    paths(first, "/messages"),
    200,
    { body: draft },
    "turn",
  );
  assert.equal(answer(sent[0]).state, "running");
  const firstProvider = await providerPair();
  await partial(firstProvider, "第一段😀");
  await frame(initial, hasText("第一段😀"));
  assert.deepEqual((await both("GET", "/api/credits"))[0].wallet.reserved, 1);
  await both("POST", paths(first, "/messages"), 200, { body: draft });
  await both("POST", paths(first, "/messages"), 409, {
    body: { ...draft, text: "不同请求" },
  });
  await both("POST", paths(first, "/messages"), 409, {
    body: sendDraft(1, price),
  });
  await both("DELETE", paths(first), 409);
  const adoption = {
    uid: randomUUID(),
    message: answer(sent[0]).id,
    project: context.project,
    node: context.node,
    expected_revision: context.expected_revision,
    mode: "replace",
    expected_text: "原文😀",
  };
  await both(
    "POST",
    paths(first, "/apply"),
    409,
    withMessageId(adoption, "message"),
  );
  for (const stream of initial) stream.close();
  const resumed = await streams(first);
  assert.equal(answer(await frame(resumed)).content, "第一段😀");
  for (const res of firstProvider) {
    delta(res, "第二段\n\0", "stop");
    res.end("data: [DONE]\n\n");
  }
  const complete = await frame(
    resumed,
    (value) => value?.conversation?.title === "试写标题",
  );
  assert.equal(answer(complete).content, "第一段😀第二段\n\0");
  assert.equal(answer(complete).state, "complete");
  for (const stream of resumed) stream.close();
  assert.deepEqual(providerRequests[1], providerRequests[0]);
  assert.equal(providerRequests[0].length, 2);
  await both("POST", paths(first, "/messages"), 200, { body: draft });
  assert.equal((await both("GET", "/api/credits"))[0].wallet.balance, 99);

  const replaced = await both(
    "POST",
    paths(first, "/apply"),
    200,
    withMessageId(adoption, "message"),
  );
  assert.equal(replaced[0].applied_node, "text-node");
  assert.equal(replaced[0].document.nodes[0].text, answer(complete).content);
  await both(
    "POST",
    paths(first, "/apply"),
    200,
    withMessageId({ ...adoption, expected_text: "stale" }, "message"),
  );
  const added = await both(
    "POST",
    paths(first, "/apply"),
    200,
    withMessageId(
      {
        ...adoption,
        uid: randomUUID(),
        mode: "new",
        expected_revision: replaced[0].revision,
      },
      "message",
    ),
    "node",
  );
  assert.equal(added[0].document.nodes[1].title, "AI 写作");
  await both("GET", `/api/chats?project=${context.project}&node=missing`);
  await both(
    "GET",
    [0, 1].map(
      (side) =>
        `/api/chats?project=${context.project}&node=${added[side].applied_node}`,
    ) as Pair<string>,
  );
  await both("PATCH", paths(first), 409, {
    body: { title: "新标题", expected_revision: 1 },
  });
  const renamed = await both("PATCH", paths(first), 200, {
    body: {
      title: " 手动改名 ",
      expected_revision: complete.conversation.revision,
    },
  });
  assert.equal(renamed[0].conversation.title, "手动改名");

  const second = await both("POST", "/api/chats", 200, { body: {} }, "chat");
  const secondStream = await streams(second);
  await frame(secondStream);
  const secondDraft = sendDraft(1, price, { text: "测试停止" });
  await both(
    "POST",
    paths(second, "/messages"),
    200,
    { body: secondDraft },
    "turn",
  );
  const secondProvider = await providerPair();
  await partial(secondProvider, "保留部分");
  await frame(secondStream, hasText("保留部分"));
  const stopped = await both("POST", paths(second, "/stop"), 200, { raw: "{" });
  assert.equal(answer(stopped[0]).state, "stopped");
  assert.equal(answer(stopped[0]).content, "保留部分");
  await frame(secondStream, hasState("stopped"));
  await until(
    () => secondProvider.every((res) => res.destroyed),
    "stop aborts both provider sockets",
  );
  await both("POST", paths(second, "/stop"));
  assert.equal((await both("GET", "/api/credits"))[0].wallet.balance, 99);

  const retry = sendDraft(stopped[0].conversation.revision, price, {
    text: "",
    retry: answer(stopped[0]).id,
  });
  const retried = await both(
    "POST",
    paths(second, "/messages"),
    200,
    withMessageId(retry, "retry"),
    "turn",
  );
  assert.equal(retried[0].messages.length, 2);
  assert.equal(answer(retried[0]).reply_to, stopped[0].messages[0].id);
  const retryProvider = await providerPair();
  await partial(retryProvider, "断开前的内容");
  await frame(secondStream, hasText("断开前的内容"));
  for (const res of retryProvider) res.destroy();
  const failed = await frame(secondStream, hasState("failed"));
  assert.equal(answer(failed).error, "连接中断，未完成的回复已退回积分");
  await both(
    "POST",
    paths(second, "/messages"),
    200,
    withMessageId(retry, "retry"),
  );

  const recoveryDraft = sendDraft(failed.conversation.revision, price, {
    text: "",
    retry: answer(failed).id,
  });
  const waiting = await both(
    "POST",
    paths(second, "/messages"),
    200,
    withMessageId(recoveryDraft, "retry"),
    "turn",
  );
  const beforeRecovery = await providerPair();
  await partial(beforeRecovery, "恢复前的内容");
  await frame(secondStream, hasText("恢复前的内容"));
  const recovered = await fetch(origins[0] + "/__fixture/recover", {
    method: "POST",
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(recovered.status, 200);
  await native.db.query(
    "UPDATE chat_turns SET lease_until=0 WHERE public_id=$1",
    [waiting[1].conversation.active_turn],
  );
  const interrupted = await frame(secondStream, hasState("interrupted"));
  assert.equal(answer(interrupted).content, "恢复前的内容");
  assert.equal(answer(interrupted).error, "服务重启，回复已停止，积分已退回");
  await until(
    () => beforeRecovery.every((res) => res.destroyed),
    "recovery aborts both provider sockets",
  );
  const credits = await both("GET", "/api/credits");
  assert.equal(credits[0].wallet.reserved, 0);
  assert.deepEqual(
    credits[0].history.map((row: any) => row.action),
    [
      "refund",
      "reserve",
      "refund",
      "reserve",
      "refund",
      "reserve",
      "spend",
      "reserve",
    ],
  );
  assert.deepEqual(providerRequests[1], providerRequests[0]);

  await both("DELETE", paths(second));
  assert.equal(await frame(secondStream), "event: unavailable\ndata: {}");
  assert.equal(await frame(secondStream), null);
  for (const stream of secondStream) stream.close();
  await both("GET", paths(second), 404);
  await both("GET", paths(second, "/events"), 404);
  await both("GET", "/api/chats");
  await both("POST", paths(second, "/restore"));
  await both("GET", paths(second));

  const team = await both(
    "POST",
    "/api/chats?workspace=1",
    200,
    { body: {} },
    "chat",
  );
  await both("GET", paths(team), 200, { workspace: "1" });
  await both("GET", paths(team, "?workspace=bad"), 200, { workspace: "1" });
  await both("GET", paths(team, "?workspace=1"), 200, { user: "member" });
  await both("DELETE", paths(team, "?workspace=1"), 403, { user: "member" });
  await both("POST", paths(team, "/messages?workspace=1"), 409, {
    body: secondDraft,
  });
  const access = await streams(team, "member", "?workspace=1");
  assert.equal((await frame(access)).conversation.can_delete, false);
  const revoked = await fetch(origins[0] + "/__fixture/revoke-member", {
    method: "POST",
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(revoked.status, 200);
  await native.db.query(
    "DELETE FROM members m USING users u,workspaces w WHERE m.user_id=u.id AND m.workspace_id=w.id AND u.name='member' AND w.public_id=1",
  );
  assert.equal(await frame(access), "event: unavailable\ndata: {}");
  assert.equal(await frame(access), null);
  for (const stream of access) stream.close();
  await both("GET", paths(team, "/events?workspace=1"), 403, {
    user: "member",
  });

  const signedIn = await streams(first);
  await frame(signedIn);
  await both("POST", "/api/logout");
  assert.equal(await frame(signedIn), "event: unavailable\ndata: {}");
  assert.equal(await frame(signedIn), null);
  for (const stream of signedIn) stream.close();
  await both("GET", paths(first), 401);
  await both("GET", paths(first, "/events"), 401);
  await both("GET", "/api/canvases", 401);
  await both("GET", canvasPath + "/runs", 401);

  await both("POST", "/api/login", 200, { body: { name: "admin", password } });
  const nativeShutdown = await subscribe(
    1,
    paths(first, "/events")[1],
    "admin",
  );
  assert.equal(
    (await nativeShutdown.next()).conversation.id,
    first[1].conversation.id,
  );
  await app.close();
  app = undefined;
  assert.equal(await nativeShutdown.next(), null);
  nativeShutdown.close();
  assert.deepEqual(workerErrors, []);
  console.log(
    `Original chat HTTP/SSE parity passed (${comparedResponses} HTTP comparisons, ${comparedEvents} SSE frames, ${queue ? "BullMQ" : "SQL outbox"})`,
  );
} catch (error) {
  if (oracleError) console.error(oracleError);
  throw error;
} finally {
  for (const client of clients) client.abort();
  clearInterval(dispatch);
  await dispatching;
  await app?.close();
  await (queue ? queue.close() : runtime.close());
  provider.closeAllConnections();
  await new Promise<void>((close) => provider.close(() => close()));
  oracle.kill("SIGTERM");
  const kill = setTimeout(() => oracle.kill("SIGKILL"), 3000);
  await oracleClosed;
  clearTimeout(kill);
  await native.cleanup();
}
