import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID, createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { databaseFixture } from "../helpers/database.js";
import { OriginalIdentity } from "@fumiao/original-api/identity.js";
import { OriginalGeneration } from "@fumiao/original-api/generation.js";
import { OriginalState } from "@fumiao/original-api/state.js";
import {
  StudioPackages,
  type PackageFile,
} from "@fumiao/platform/studio-packages.js";
import { StudioUpdates } from "@fumiao/platform/studio-updates.js";
import { PluginRegistry } from "@fumiao/platform/plugins.js";
import { Executor } from "@fumiao/platform/executor.js";
import { migrate, one } from "@fumiao/platform/db.js";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { StudioCatalog } from "@fumiao/platform/catalog.js";
import { wavFixture } from "../helpers/timing.js";
import { createOriginalApp } from "../../apps/api/src/original.js";
import { secret } from "@fumiao/platform/security.js";
import { OriginalNodes } from "@fumiao/original-api/nodes.js";
import { OriginalCanvases } from "@fumiao/original-api/canvases.js";
import { OriginalCanvasRuns } from "@fumiao/original-api/canvas-runs.js";
import { OriginalChatSettings } from "@fumiao/original-api/chat-settings.js";
import { OriginalChats } from "@fumiao/original-api/chats.js";
import { ChatExecution } from "@fumiao/original-api/chat-execution.js";
import { ChatRuntime } from "@fumiao/original-api/chat-runtime.js";
import { chatProviderFixture } from "../helpers/chat-provider.js";
const load = async (id: string): Promise<PackageFile> =>
  JSON.parse(
    await readFile("plugins/" + id + "/" + id + ".fmplugin.json", "utf8"),
  );
const legacyGpu = async (): Promise<PackageFile> =>
  JSON.parse(
    await readFile("plugins/gpu/package/legacy-1.0.0.fmplugin.json", "utf8"),
  );
async function setup(through?: string) {
  const f = await databaseFixture(through);
  await f.p.registry.initializeStudio(f.db, false);
  const identity = new OriginalIdentity(f.p),
    user = { name: "admin", password: randomUUID() };
  await identity.bootstrap({ ...user, nickname: "隔离测试" });
  const session = await identity.login(user, "fixture"),
    actor = await identity.actor(session);
  return { ...f, session, actor, packages: new StudioPackages(f.p) };
}
for (const id of ["flow", "muse"]) {
  test(
    "import " +
      id +
      " file into an empty Studio, then drain a frozen job across update, restart and disable",
    async () => {
      const f = await setup(),
        file = await load(id),
        seen: string[] = [],
        png = await sharp({
          create: { width: 16, height: 16, channels: 3, background: "#345678" },
        })
          .png()
          .toBuffer();
      let video: Buffer = Buffer.alloc(0);
      if (id === "flow") {
        const path = join(f.directory, "clip.mp4");
        execFileSync("ffmpeg", [
          "-loglevel",
          "error",
          "-f",
          "lavfi",
          "-i",
          "color=s=32x32:r=8",
          "-t",
          "1",
          "-pix_fmt",
          "yuv420p",
          path,
        ]);
        video = await readFile(path);
      }
      let base = "";
      const server = createServer((req, res) => {
        assert.equal(req.headers.authorization, "Bearer fixture-key");
        const path = req.url!;
        if (path === "/v1/models")
          return void res.end(JSON.stringify({ data: [{ id: "fixture" }] }));
        if (path === "/health")
          return void res.end(
            JSON.stringify({
              backend_running: true,
              has_active_tokens: true,
              ready: true,
            }),
          );
        if (path === "/tmp/video.mp4") return void res.end(video);
        if (path === "/tmp/image.png" || path === "/v1/media/image.png")
          return void res.end(png);
        seen.push(path);
        if (id === "flow") {
          res.end(
            "data: " +
              JSON.stringify({
                choices: [
                  {
                    delta: {
                      content:
                        '<video src="' + base + '/tmp/video.mp4"></video>',
                    },
                  },
                ],
              }) +
              "\n\ndata: [DONE]\n\n",
          );
          return;
        }
        res.end(
          JSON.stringify(
            req.method === "POST"
              ? { task_id: "task_" + "a".repeat(32) }
              : { status: "completed", url: base + "/v1/media/image.png" },
          ),
        );
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      base = "http://127.0.0.1:" + (server.address() as { port: number }).port;
      try {
        assert.deepEqual(await f.packages.list(f.actor), []);
        await Promise.all([
          f.packages.install(f.actor, file),
          f.packages.install(f.actor, file),
        ]);
        const pkg = async () => (await f.packages.list(f.actor))[0];
        assert.equal((await pkg()).enabled, false);
        const service = await f.p.createConnection(
          f.actor,
          {
            name: "测试服务",
            pluginId: id,
            version: file.adapterVersion,
            config: { baseUrl: base, apiKey: "fixture-key" },
          },
          true,
        );
        assert.equal(
          (await f.p.connectionHealth(f.actor, service.id)).ready,
          true,
        );
        const kind = id === "flow" ? "video" : "image";
        const image = await one(
          f.db,
          "SELECT id FROM studio_catalog WHERE plugin_id=$1 AND descriptor->>'kind'=$2 AND NOT hidden ORDER BY position LIMIT 1",
          [id, kind],
        );
        const catalog = new StudioCatalog(f.db),
          prices = await catalog.prices();
        await f.db.transaction((sql) =>
          catalog.savePrices(
            sql,
            Object.fromEntries(prices.items.map((t) => [t.key, 2])),
            prices.revision,
          ),
        );
        const generation = new OriginalGeneration(f.p),
          team = await one(f.db, "SELECT * FROM workspaces WHERE kind='team'");
        await f.db.transaction((sql) =>
          f.p.credit(sql, team.id, 100, randomUUID(), "adjust"),
        );
        const submit = async () =>
          generation.submit(
            f.actor,
            await generation.parse(kind, {
              uid: randomUUID(),
              prompt: "local fixture",
              model: image.id,
            }),
            String(team.public_id),
          );
        await assert.rejects(submit);
        await f.packages.change(f.actor, id, (await pkg()).revision, "enable");
        const result = await submit(),
          job = await one(f.db, "SELECT * FROM jobs WHERE public_id=$1", [
            result.id,
          ]);
        assert.equal(job.package_version, file.version);
        const next = { ...file, version: "1.1.0" };
        await f.packages.install(f.actor, next, (await pkg()).revision);
        await f.packages.change(f.actor, id, (await pkg()).revision, "disable");
        await assert.rejects(submit);
        await f.packages.install(f.actor, file, (await pkg()).revision, true);
        await f.packages.change(f.actor, id, (await pkg()).revision, "remove");
        assert.equal((await pkg()).removing, true);
        f.p.registry = new PluginRegistry();
        await f.db.query(
          "UPDATE connections SET queue_health_revision=revision,queue_health=$2 WHERE id=$1",
          [
            service.id,
            JSON.stringify({ ready: true, checked: Date.now() / 1000 }),
          ],
        );
        const executor = new Executor(f.p);
        await executor.execute(job.id);
        if (id === "muse") await executor.execute(job.id);
        const done = await one(
          f.db,
          "SELECT state,error FROM jobs WHERE id=$1",
          [job.id],
        );
        assert.equal(done.state, "completed", JSON.stringify({ done, seen }));
        assert.ok(seen.length > 0);
        await f.packages.finishRemovals();
        assert.deepEqual(await f.packages.list(f.actor), []);
        assert.ok(
          (
            await new OriginalState(f.p).read(f.actor, String(team.public_id))
          ).jobs.some((j: { id: number }) => j.id === result.id),
        );
      } finally {
        server.closeAllConnections();
        await new Promise<void>((r) => server.close(() => r()));
        await f.cleanup();
      }
    },
  );
}
test("chat package drains accepted replies and can be reinstalled with fresh credentials", async () => {
  const f = await setup(),
    wire = await chatProviderFixture();
  const file = await load("compatible-chat");
  const settings = new OriginalChatSettings(f.p),
    chats = new OriginalChats(f.p);
  const models = async () =>
    Object.keys((await settings.config(f.actor)).models).sort();
  const pkg = async () => (await f.packages.list(f.actor))[0];
  const change = async (action: "enable" | "disable" | "remove") =>
    f.packages.change(f.actor, file.id, (await pkg()).revision, action);
  const connect = (model: string) =>
    f.p.createConnection(
      f.actor,
      {
        name: model,
        pluginId: file.id,
        version: file.adapterVersion,
        config: wire.config(model),
      },
      true,
    );
  try {
    assert.deepEqual(await models(), []);
    await f.packages.install(f.actor, file);
    await connect("gpt-4.1");
    await connect("deepseek-flash");
    await assert.rejects(connect("deepseek-flash"), { status: 409 });
    assert.deepEqual(await models(), []);
    await change("enable");
    assert.deepEqual(await models(), ["deepseek-flash", "gpt-4.1"]);
    await f.db.query("UPDATE wallets SET balance=10");
    const { conversation } = await chats.create(f.actor, {});
    const draft = {
      uid: randomUUID(),
      model: "gpt-4.1",
      text: "插件回复验证",
      expected_revision: conversation.revision,
      price_revision: (await settings.config(f.actor)).pricing.revision,
    };
    const send = () => chats.send(f.actor, conversation.id, draft);
    await change("disable");
    await assert.rejects(send, { status: 403 });
    await change("enable");
    await send();
    const turn = await one(f.db, "SELECT id FROM chat_turns WHERE uid=$1", [
      draft.uid,
    ]);
    await change("remove");
    assert.equal((await pkg()).removing, true);
    assert.deepEqual(await models(), []);
    await send(); // Retrying the accepted UID during removal returns the same turn.
    f.p.registry = new PluginRegistry();
    wire.setWire("stream", {
      raw: 'data: {"choices":[{"delta":{"content":"已完成"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    });
    const runtime = new ChatRuntime(new ChatExecution(chats));
    await runtime.execute(turn.id);
    await runtime.execute(turn.id);
    assert.equal(
      (await chats.get(f.actor, conversation.id)).messages.at(-1)?.content,
      "已完成",
    );
    assert.deepEqual(
      wire.requests.filter((r) => r.body?.stream).map((r) => r.path),
      ["/v1/chat/completions"],
    );
    assert.deepEqual(
      await one(
        f.db,
        "SELECT balance::int,held::int FROM wallets JOIN chat_charges USING(workspace_id) WHERE turn_id=$1",
        [turn.id],
      ),
      { balance: 9, held: 0 },
    );
    await f.packages.finishRemovals();
    assert.deepEqual(await f.packages.list(f.actor), []);
    assert.deepEqual((await settings.read(f.actor)).providers, {});
    await f.packages.install(f.actor, file);
    assert.ok(
      Object.values((await settings.read(f.actor)).providers).every(
        (p) => !p.configured,
      ),
    );
    await connect("deepseek-flash");
    await change("enable");
    assert.deepEqual(await models(), ["deepseek-flash"]);
  } finally {
    await wire.cleanup();
    await f.cleanup();
  }
});

test("GPU package installs its administrator panel while disabled and removes the pairing capability", async () => {
  const f = await setup("036_plugin_data.sql"),
    file = await legacyGpu();
  const app = await createOriginalApp(f.p);
  try {
    await assert.rejects(
      f.packages.install(f.actor, {
        ...file,
        adapterModule: Buffer.from("modified").toString("base64"),
      }),
      /验证/,
    );
    await f.packages.install(f.actor, file);
    const state = new OriginalState(f.p);
    assert.equal(
      (await state.read(f.actor)).gpu_node_settings.title,
      "GPU 节点",
    );
    const nodes = new OriginalNodes(f.p);
    await assert.rejects(
      nodes.pair(
        { ...f.actor, role: "member" },
        { name: "test", models: ["MiniMax H3"] },
      ),
      { status: 403 },
    );
    await app.listen(0, "127.0.0.1");
    const url = await app.getUrl(),
      voice = "breeze-tts-2",
      token = secret();
    const call = async (path: string, init: RequestInit = {}) => {
      const r = await fetch(url + path, {
        ...init,
        headers: { authorization: "Bearer " + token, ...init.headers },
      });
      const data = await r.json();
      assert.equal(r.status, 200, JSON.stringify(data));
      return data;
    };
    const post = (path: string, body: object) =>
      call(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const installed = await fetch(url + "/connect/agent.tgz");
    assert.deepEqual(
      Buffer.from(await installed.arrayBuffer()),
      Buffer.from(file.nodeClient!["agent.tgz"], "base64"),
    );
    const pairing = await nodes.pair(f.actor, {
      name: "test",
      models: [voice],
    });
    await post("/agent/enroll", {
      code: pairing.command.split(" ").at(-1),
      secret: token,
    });
    await post("/agent/heartbeat", { stage: "ready", ready_models: [voice] });
    await f.packages.change(f.actor, "gpu", 1, "enable");
    const catalog = new StudioCatalog(f.db),
      prices = await catalog.prices();
    await f.db.transaction((sql) =>
      catalog.savePrices(
        sql,
        Object.fromEntries(prices.items.map((t) => [t.key, 0])),
        prices.revision,
      ),
    );
    const gen = new OriginalGeneration(f.p),
      job = await gen.submit(
        f.actor,
        await gen.parse("audio", {
          uid: randomUUID(),
          prompt: "free test",
          model: voice,
        }),
      );
    await f.packages.change(f.actor, "gpu", 2, "disable");
    const claimed = (await call("/agent/claim", { method: "POST" })).job;
    assert.equal(claimed.id, job.id);
    const snapshot = async () =>
      Promise.all(
        ["jobs", "ledger", "wallets", "gpu_pairings", "gpu_nodes"].map(
          async (table) =>
            (await f.db.query("SELECT * FROM " + table + " ORDER BY 1")).rows,
        ),
      );
    const prior = await snapshot();
    await migrate(f.db);
    assert.deepEqual(await snapshot(), prior);
    assert.equal(
      (await call("/agent/claim", { method: "POST" })).job.ticket,
      claimed.ticket,
    );
    const wav = wavFixture();
    for (let i = 44; i < wav.length; i += 2) wav.writeInt16LE(1100, i);
    const delivered = await call("/agent/jobs/" + job.id + "/result", {
      method: "PUT",
      body: new Uint8Array(wav),
      headers: {
        "X-Job-Ticket": claimed.ticket,
        "X-SHA256": createHash("sha256").update(wav).digest("hex"),
        "Content-Type": "application/octet-stream",
      },
    });
    assert.ok(delivered.id);
    assert.equal(
      Number(
        (await one(f.db, "SELECT price FROM jobs WHERE public_id=$1", [job.id]))
          .price,
      ),
      0,
    );
    await f.packages.change(f.actor, file.id, 3, "remove");
    assert.equal((await state.read(f.actor)).gpu_node_settings, null);
    assert.equal((await fetch(url + "/connect/agent.tgz")).status, 404);
    await f.packages.install(f.actor, file);
    assert.ok(
      (await nodes.pair(f.actor, { name: "test2", models: [voice] })).command,
    );
  } finally {
    await app.close();
    await f.cleanup();
  }
});
test("update source pins package identity and checksum before activation and preserves disabled state", async () => {
  const f = await setup(),
    file = await load("muse"),
    updates = new StudioUpdates(f.p),
    next = { ...file, version: "1.1.0" },
    raw = JSON.stringify(next);
  let digest = createHash("sha256").update(raw).digest("hex");
  const server = createServer((req, res) => {
    assert.equal(req.headers.authorization, "Bearer read-only");
    res.end(
      req.url === "/update.json"
        ? JSON.stringify({
            id: file.id,
            version: next.version,
            package: "release.json",
            notes: "更新测试",
            sha256: digest,
          })
        : raw,
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await f.packages.install(f.actor, file);
    await updates.configure(f.actor, file.id, {
      revision: 1,
      url:
        "http://127.0.0.1:" +
        (server.address() as { port: number }).port +
        "/update.json",
      token: "read-only",
    });
    await updates.check(file.id);
    const row = (await f.packages.list(f.actor))[0];
    assert.ok(!JSON.stringify(row).includes("read-only"));
    assert.equal(row.updateInfo.version, next.version);
    digest = "0".repeat(64);
    await assert.rejects(
      updates.check(file.id, {
        actor: f.actor,
        sha256: row.updateInfo.sha256,
        revision: row.revision,
      }),
      /校验失败/,
    );
    digest = row.updateInfo.sha256;
    await updates.check(file.id, {
      actor: f.actor,
      sha256: digest,
      revision: row.revision,
    });
    assert.equal((await f.packages.list(f.actor))[0].enabled, false);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await f.cleanup();
  }
});

test("portable packages share a declared model across services without changing frozen jobs", async () => {
  const f = await setup(),
    app = await createOriginalApp(f.p),
    paths: string[] = [];
  const server = createServer(async (req, res) => {
    paths.push(req.url!);
    assert.ok(req.headers.authorization?.startsWith("Bearer private-"));
    res.end(JSON.stringify({ message: "fixture rejected" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl =
    "http://127.0.0.1:" + (server.address() as { port: number }).port;
  const model = {
    id: "shared-audio",
    label: "共享语音",
    kind: "audio",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    studio: {
      order: 1,
      priceOrder: 1,
      descriptor: { kind: "audio", label: "共享语音" },
      prices: [
        {
          tier: "standard",
          label: "语音",
          amount: 0,
          match: { type: "object" },
        },
      ],
    },
  };
  const spec = (id: string) => ({
    format: 1,
    id,
    version: "1.0.0",
    adapterVersion: "1.0.0",
    label: id,
    equivalentModels: [model.id],
    manifest: {
      id,
      label: id,
      version: "1.0.0",
      contractVersion: 1,
      mode: "request",
      models: [model],
      originalSubmission: { version: 3 },
      configSchema: {
        type: "object",
        properties: {
          baseUrl: { type: "string" },
          apiKey: { type: "string", writeOnly: true },
        },
        required: ["baseUrl", "apiKey"],
      },
    },
    program:
      "({request(){return {path:'/" +
      id +
      "',body:{}}},result({raw}){return {state:'failed',error:raw.message}}})",
  });
  try {
    await app.listen(0, "127.0.0.1");
    const services: string[] = [];
    for (const id of ["station-a", "station-b"]) {
      const file = spec(id);
      await f.packages.install(f.actor, file);
      const { id: service } = await f.p.createConnection(
        f.actor,
        {
          pluginId: id,
          version: file.adapterVersion,
          name: id,
          config: { baseUrl, apiKey: "private-" + id },
        },
        true,
      );
      services.push(service);
      await f.packages.change(f.actor, id, 1, "enable");
    }
    const pkgs = () => f.packages.list(f.actor);
    assert.equal((await pkgs())[0].choices[0].services.length, 2);
    const gen = new OriginalGeneration(f.p),
      userKey = randomUUID();
    const submit = async (uid: string) =>
      gen.submit(
        f.actor,
        await gen.parse("audio", {
          model: model.id,
          prompt: "fixture",
          uid,
          params: {},
        }),
      );
    const old = await submit(userKey);
    const response = await fetch(
      (await app.getUrl()) + "/api/admin/plugins/station-b/model",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "fm_session=" + f.session,
        },
        body: JSON.stringify({
          revision: 2,
          service: services[1],
          model: model.id,
          enabled: true,
          label: "试音",
        }),
      },
    );
    assert.equal(response.status, 201, await response.text());
    assert.deepEqual(await submit(userKey), old);
    const fresh = await submit(randomUUID());
    f.p.registry = new PluginRegistry();
    for (const [job, service] of [
      [old, services[0]],
      [fresh, services[1]],
    ] as const) {
      const frozen = await one(f.db, "SELECT * FROM jobs WHERE public_id=$1", [
        job.id,
      ]);
      assert.equal(frozen.connection_id, service);
      await new Executor(f.p).execute(frozen.id);
      assert.equal(
        (await one(f.db, "SELECT state FROM jobs WHERE id=$1", [frozen.id]))
          .state,
        "failed",
      );
    }
    assert.deepEqual(paths, ["/station-a", "/station-b"]);
    const state = await new OriginalState(f.p).read(f.actor);
    assert.deepEqual(Object.keys(state.model_catalog), [model.id]);
    assert.equal(state.model_catalog[model.id].label, "试音");
    const previous = spec("station-b"),
      next = {
        ...previous,
        version: "2.0.0",
        adapterVersion: "2.0.0",
        manifest: {
          ...previous.manifest,
          version: "2.0.0",
          configSchema: {
            ...previous.manifest.configSchema,
            additionalProperties: false,
            properties: {
              ...previous.manifest.configSchema.properties,
              tenant: { type: "string", writeOnly: true },
            },
            required: ["baseUrl", "apiKey", "tenant"],
          },
        },
      };
    const pkg = async () => (await pkgs()).find((p) => p.id === "station-b")!;
    const preview = await f.packages.preview(f.actor, next);
    assert.deepEqual(
      preview.missing.map((s) => s.fields.map((f) => f.key)),
      [["tenant"]],
    );
    await assert.rejects(
      f.packages.install(f.actor, next, (await pkg()).revision),
      /缺少/,
    );
    assert.equal((await pkg()).version, "1.0.0");
    await f.packages.install(f.actor, next, (await pkg()).revision, false, {
      [services[1]]: { tenant: "test-tenant" },
    });
    await f.packages.install(f.actor, previous, (await pkg()).revision, true);
    assert.equal((await pkg()).version, "1.0.0");
    const requestsBefore = paths.length;
    const { program: _program, manifest, ...header } = previous;
    await assert.rejects(
      f.packages.install(
        f.actor,
        {
          ...header,
          version: "3.0.0",
          remote: { endpoint: baseUrl, manifest },
        },
        (await pkg()).revision,
      ),
      /不能向新的服务地址/,
    );
    assert.equal(paths.length, requestsBefore);

    await f.packages.change(
      f.actor,
      "station-b",
      (await pkg()).revision,
      "remove",
    );
    const catalog = new StudioCatalog(f.db);
    const remaining = await catalog.prices();
    assert.deepEqual(
      remaining.items.map((price) => price.model),
      [model.id],
    );
    assert.ok(Object.hasOwn(await catalog.catalog(), model.id));
    await f.db.transaction((sql) =>
      catalog.savePrices(
        sql,
        { [remaining.items[0].key]: 3 },
        remaining.revision,
      ),
    );
    const [last] = await pkgs();
    await f.packages.change(f.actor, last.id, last.revision, "remove");
    assert.deepEqual((await catalog.prices()).items, []);
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await f.cleanup();
  }
});

test("an authenticated Git update uses the repository default branch and its committed package", async () => {
  const f = await setup(),
    file = await load("muse"),
    next = { ...file, version: "1.2.0" };
  const repo = join(f.directory, "updates.git"),
    work = join(f.directory, "source");
  const git = (args: string[], cwd: string) =>
    execFileSync("git", args, { cwd, stdio: "pipe" });
  const raw = JSON.stringify(next),
    sha256 = createHash("sha256").update(raw).digest("hex");
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== "Bearer fixture-read") {
      res.writeHead(401).end();
      return;
    }
    try {
      const url = new URL(req.url!, "http://localhost"),
        chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const out = execFileSync("git", ["http-backend"], {
        env: {
          PATH: process.env.PATH,
          GIT_PROJECT_ROOT: f.directory,
          GIT_HTTP_EXPORT_ALL: "1",
          PATH_INFO: url.pathname,
          QUERY_STRING: url.search.slice(1),
          REQUEST_METHOD: req.method!,
          CONTENT_TYPE: req.headers["content-type"] || "",
          REMOTE_USER: "fixture",
        },
        input: Buffer.concat(chunks),
      });
      const split = out.indexOf("\r\n\r\n");
      assert.ok(split > 0);
      for (const line of out.subarray(0, split).toString().split("\r\n")) {
        const i = line.indexOf(":");
        res.setHeader(line.slice(0, i), line.slice(i + 1).trim());
      }
      res.end(out.subarray(split + 4));
    } catch {
      res.writeHead(500).end();
    }
  });
  try {
    await mkdir(work);
    git(["init", "-q", "-b", "stable"], work);
    await writeFile(join(work, "release.json"), raw);
    await writeFile(
      join(work, "update.json"),
      JSON.stringify({
        id: file.id,
        version: next.version,
        notes: "私有仓库测试",
        package: "release.json",
        sha256,
      }),
    );
    git(["add", "."], work);
    git(
      [
        "-c",
        "user.name=fixture",
        "-c",
        "user.email=fixture@localhost",
        "commit",
        "-qm",
        "fixture",
      ],
      work,
    );
    git(["clone", "--bare", "-q", work, repo], work);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const updates = new StudioUpdates(f.p);
    await f.packages.install(f.actor, file);
    await updates.configure(f.actor, file.id, {
      revision: 1,
      url:
        "http://127.0.0.1:" +
        (server.address() as { port: number }).port +
        "/updates.git",
      token: "fixture-read",
    });
    assert.equal((await updates.check(file.id))?.version, next.version);
    await updates.check(file.id, { actor: f.actor, revision: 2, sha256 });
    assert.equal((await f.packages.list(f.actor))[0].version, next.version);
  } finally {
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((r) => server.close(() => r()));
    await f.cleanup();
  }
});

test("a previously restored chat connection adopts the packaged adapter on restart", async () => {
  const f = await databaseFixture("033_studio_plugin_profile.sql"),
    file = await load("compatible-chat");
  try {
    await f.p.registry.initializeStudio(f.db, false);
    await f.db.transaction((sql) =>
      f.p.registry.installStudioPackage(sql, file.id, file.adapterVersion),
    );
    const identity = new OriginalIdentity(f.p),
      user = { name: "admin", password: randomUUID() };
    await identity.bootstrap({ ...user, nickname: "对话管理员" });
    const actor = await identity.actor(await identity.login(user, "upgrade"));
    const { id } = await f.p.createConnection(actor, {
      name: "已有对话服务",
      pluginId: file.id,
      version: file.adapterVersion,
      config: { provider: "deepseek", apiKey: "fixture-key" },
    });
    await f.p.updateConnection(actor, id, {
      revision: 1,
      enabled: true,
      concurrency: 1,
    });
    await assert.rejects(
      f.p.updateConnection(actor, id, {
        revision: 2,
        enabled: true,
        concurrency: 1,
        preserveCredentials: true,
        config: { baseUrl: "http://127.0.0.1" },
      }),
      /切换服务地址/,
    );
    await f.db.query(
      await readFile("migrations/034_studio_packages.sql", "utf8"),
    );
    // Simulate a previous platform boot which restored the historical adapter.
    await f.db.query(
      `UPDATE studio_package_releases SET package=package||'{"restored":true}'::jsonb WHERE id=$1`,
      [file.id],
    );
    const registry = (f.p.registry = new PluginRegistry());
    await registry.initializeStudio(f.db, false);
    await registry.initializeStudio(f.db, false);
    const [pkg] = await new StudioPackages(f.p).list(actor);
    assert.equal(pkg.version, file.version);
    assert.equal(pkg.enabled, true);
    assert.deepEqual(
      await one(
        f.db,
        "SELECT version,code FROM studio_adapter_modules WHERE id=$1",
        [file.id],
      ),
      { version: file.adapterVersion, code: file.adapterModule },
    );
    assert.deepEqual(
      Object.keys((await new OriginalChatSettings(f.p).config(actor)).models),
      ["deepseek-flash"],
    );
    assert.equal((await f.p.studioConnections(actor))[0].id, id);
  } finally {
    await f.cleanup();
  }
});

test("current installation upgrades its configured GPU service without requiring fresh pairing", async () => {
  const f = await databaseFixture("033_studio_plugin_profile.sql");
  const file = await legacyGpu();
  try {
    await f.p.registry.initializeStudio(f.db, false);
    await f.db.transaction((sql) =>
      f.p.registry.installStudioPackage(sql, file.id, file.adapterVersion),
    );
    const identity = new OriginalIdentity(f.p),
      user = { name: "admin", password: randomUUID() };
    await identity.bootstrap({ ...user, nickname: "节点管理员" });
    const actor = await identity.actor(
      await identity.login(user, "upgrade-test"),
    );
    const service = await f.p.createConnection(
      actor,
      {
        name: "原有节点服务",
        pluginId: "gpu",
        version: file.adapterVersion,
        config: {},
      },
      false,
    );
    await f.p.updateConnection(actor, service.id, {
      revision: 1,
      enabled: true,
      concurrency: 1,
    });
    const nodes = new OriginalNodes(f.p),
      pair = await nodes.pair(actor, {
        name: "现有机器",
        models: ["breeze-tts-2"],
      }),
      token = secret();
    await nodes.enroll({
      code: pair.command.split(" ").at(-1)!,
      secret: token,
    });
    const before = await nodes.registration("Bearer " + token);
    await f.db.query(
      await readFile("migrations/034_studio_packages.sql", "utf8"),
    );
    const registry = (f.p.registry = new PluginRegistry());
    await registry.initializeStudio(f.db, false);
    await registry.initializeStudio(f.db, false);
    const [pkg] = await new StudioPackages(f.p).list(actor);
    assert.equal(pkg.version, file.version);
    assert.equal(pkg.enabled, true);
    const { NodeManagement } = await registry.nodeExtension(f.db);
    assert.deepEqual(
      await new NodeManagement(f.p).registration("Bearer " + token),
      before,
    );
    assert.equal((await f.p.studioConnections(actor))[0].id, service.id);
  } finally {
    await f.cleanup();
  }
});

test("installed settings pages isolate values by package, reject stale saves and survive renames", async () => {
  const f = await setup();
  try {
    const pages = [
      {
        id: "defaults",
        title: "导出偏好",
        view: "fields" as const,
        fields: [{ id: "format", label: "格式", options: ["SRT", "WebVTT"] }],
      },
    ];
    const first = { ...(await load("muse")), settingsPages: pages };
    const second = { ...(await load("flow")), settingsPages: pages };
    const state = new OriginalState(f.p);
    const read = async () => (await state.read(f.actor)).settings_pages;
    assert.deepEqual(await read(), []);
    await assert.rejects(
      f.packages.install(f.actor, {
        ...first,
        settingsPages: [...pages, ...pages],
      }),
    );
    await f.packages.install(f.actor, first);
    await f.packages.install(f.actor, second);
    const save = (revision: number, value: string) =>
      f.packages.savePage(f.actor, first.id, "defaults", revision, {
        format: value,
      });
    await assert.rejects(
      f.packages.savePage(
        { ...f.actor, role: "member" },
        first.id,
        "defaults",
        1,
        { format: "SRT" },
      ),
      { status: 403 },
    );
    await assert.rejects(save(1, "unknown"), { status: 400 });
    await save(1, "WebVTT");
    await assert.rejects(save(1, "SRT"), { status: 409 });
    const upgraded = {
      ...first,
      version: "1.1.0",
      settingsPages: [
        { ...pages[0], title: "字幕选项" },
        { ...pages[0], id: "other" },
      ],
    };
    await f.packages.install(f.actor, upgraded, 2);
    assert.deepEqual(
      (await read()).map(
        (page: {
          plugin: string;
          title: string;
          values: { format: string };
        }) => [page.plugin, page.title, page.values.format],
      ),
      [
        ["flow", "导出偏好", "SRT"],
        ["muse", "字幕选项", "WebVTT"],
        ["muse", "导出偏好", "SRT"],
      ],
    );
    await f.packages.change(f.actor, first.id, 3, "remove");
    await assert.rejects(save(4, "SRT"), { status: 404 });
    assert.equal((await read()).length, 1);
    await f.packages.install(f.actor, first);
    assert.deepEqual((await read())[1].values, { format: "SRT" });
  } finally {
    await f.cleanup();
  }
});

test("blank canvases save sticky edits and list runs across zero-plugin, v3 package and removed-package states", async () => {
  const f = await setup();
  try {
    const canvases = new OriginalCanvases(f.p);
    const runs = new OriginalCanvasRuns(f.p);
    const ext = await load("example-extension");
    const canvas = await canvases.create(f.actor, { title: "未命名画布" });
    assert.deepEqual(await runs.list(f.actor, canvas.id), { runs: [] });

    const r2 = await canvases.save(f.actor, canvas.id, {
      expected_revision: 1,
      title: "零插件便签画布",
      document: {
        nodes: [
          { id: "sticky-1", type: "sticky", x: 0, y: 0, text: "记录想法" },
        ],
      },
    });
    assert.equal(r2.revision, 2);

    await f.packages.install(f.actor, ext);
    assert.deepEqual(await runs.list(f.actor, canvas.id), { runs: [] });
    const r3 = await canvases.save(f.actor, canvas.id, {
      expected_revision: 2,
      title: "安装 v3 扩展后保存",
      document: {
        nodes: [
          { id: "sticky-1", type: "sticky", x: 0, y: 0, text: "已更新便签" },
          {
            id: "img-1",
            type: "image",
            x: 320,
            y: 0,
            params: { model: "example-extension-image" },
          },
        ],
      },
    });
    assert.equal(r3.revision, 3);
    await assert.rejects(
      canvases.save(f.actor, canvas.id, {
        expected_revision: 3,
        title: "错误节点类型",
        document: {
          nodes: [
            {
              id: "vid-1",
              type: "video",
              x: 0,
              y: 0,
              params: { model: "example-extension-image" },
            },
          ],
        },
      }),
      { status: 400, message: "节点模型与生成类型不匹配" },
    );

    const [installed] = await f.packages.list(f.actor);
    await f.packages.change(f.actor, ext.id, installed.revision, "remove");
    assert.deepEqual(await runs.list(f.actor, canvas.id), { runs: [] });
    const r4 = await canvases.save(f.actor, canvas.id, {
      expected_revision: 3,
      title: "移除插件后仍可编辑便签",
      document: {
        nodes: [
          {
            id: "sticky-1",
            type: "sticky",
            x: 0,
            y: 0,
            text: "卸载后继续编辑",
          },
          { id: "img-blank", type: "image", x: 320, y: 0 },
        ],
      },
    });
    assert.equal(r4.revision, 4);
    await assert.rejects(
      canvases.save(f.actor, canvas.id, {
        expected_revision: 4,
        title: "引用已移除模型",
        document: {
          nodes: [
            {
              id: "img-1",
              type: "image",
              x: 0,
              y: 0,
              params: { model: "example-extension-image" },
            },
          ],
        },
      }),
      { status: 400, message: "节点模型与生成类型不匹配" },
    );
  } finally {
    await f.cleanup();
  }
});

test("a portable node pool pairs, claims and settles its pinned release alongside GPU", async (t) => {
  const f = await setup();
  t.after(() => f.cleanup());
  const file = await load("example-node-pool");
  const gpu = await legacyGpu();
  await f.packages.install(f.actor, gpu);
  await assert.rejects(
    f.packages.preview(f.actor, {
      ...file,
      program:
        "({capabilities:1,eligible(){},dispatch(){},receipt(){},artifactRules(){}})",
    }),
    { status: 400 },
  );
  await assert.rejects(
    f.packages.install(f.actor, {
      ...file,
      nodeClient: {
        ...file.nodeClient,
        "agent.tgz": Buffer.from("broken").toString("base64"),
      },
    }),
    { status: 400 },
  );
  await f.packages.install(f.actor, file);
  await f.packages.change(f.actor, file.id, 1, "enable");
  const app = await createOriginalApp(f.p);
  await app.listen(0, "127.0.0.1");
  t.after(() => app.close());
  const url = await app.getUrl();
  const root = "/agent/" + file.id;
  const token = secret();
  const request = async (path: string, body?: object, expected = 200) => {
    const response = await fetch(url + path, {
      method: body ? "POST" : "GET",
      headers: {
        "content-type": "application/json",
        cookie: "fm_session=" + f.session,
        authorization: "Bearer " + token,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    assert.equal(response.status, expected, JSON.stringify(data));
    return data;
  };
  const client = await fetch(url + root + "/client/agent.tgz");
  assert.deepEqual(
    Buffer.from(await client.arrayBuffer()),
    Buffer.from(file.nodeClient!["agent.tgz"], "base64"),
  );
  const pair = await request(
    "/api/plugins/" + file.id + "/pages/nodes/actions/pair",
    { payload: { name: "test", models: ["comfy-image"] } },
  );
  const code = pair.result.value.split(" ").at(-1);
  await request("/agent/enroll", { code, secret: token }, 403);
  await request(root + "/enroll", { code, secret: token });
  await request(root + "/enroll", { code, secret: secret() }, 403);
  await request("/agent/registration", undefined, 403);
  await request(root + "/heartbeat", {
    stage: "ready",
    capabilities: { ready: true },
  });
  const gen = new OriginalGeneration(f.p);
  const catalog = new StudioCatalog(f.db);
  const prices = await catalog.prices();
  await f.db.transaction((sql) =>
    catalog.savePrices(
      sql,
      Object.fromEntries(prices.items.map((p) => [p.key, 0])),
      prices.revision,
    ),
  );
  const job = await gen.submit(
    f.actor,
    await gen.parse("image", {
      uid: randomUUID(),
      model: "comfy-image",
      prompt: "test",
      params: {},
    }),
  );
  const newer = {
    ...file,
    version: "1.1.1",
    program: file.program!.replace(
      "return { prompt: job.input.prompt };",
      "return { updated: true };",
    ),
  };
  await f.packages.install(f.actor, newer, 2);
  const claim = (await request(root + "/claim", {})).job;
  assert.equal(claim.id, job.id);
  assert.deepEqual(claim.instruction, { prompt: "test" });
  assert.equal((await request(root + "/claim", {})).job.ticket, claim.ticket);
  const bytes = await sharp({
    create: { width: 12, height: 12, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const endpoint = root + "/jobs/" + job.id + "/result";
  const result = async (data: Buffer, report: unknown) =>
    fetch(url + endpoint, {
      method: "PUT",
      body: new Uint8Array(data),
      headers: {
        authorization: "Bearer " + token,
        "X-Job-Ticket": claim.ticket,
        "X-SHA256": createHash("sha256").update(data).digest("hex"),
        "X-Job-Timing": JSON.stringify(report),
      },
    });
  assert.equal((await result(bytes, {})).status, 422);
  assert.equal(
    (await result(Buffer.from("invalid"), { prompt_id: "test" })).status,
    422,
  );
  const [a, b] = await Promise.all([
    result(bytes, { prompt_id: "test" }),
    result(bytes, { prompt_id: "test" }),
  ]);
  assert.equal(a.status, 200, await a.clone().text());
  assert.deepEqual(await a.json(), await b.json());
  const settled = await one(
    f.db,
    `SELECT j.state, j.package_version,
     (SELECT count(*)::int FROM job_assets WHERE job_id=j.id AND role='output') AS outputs,
     (SELECT count(*)::int FROM ledger WHERE job_id=j.id AND action='spend') AS charges
     FROM jobs j WHERE j.public_id=$1`,
    [job.id],
  );
  assert.deepEqual(settled, {
    state: "completed",
    package_version: file.version,
    outputs: 1,
    charges: 1,
  });
});

test("GPU 2.0 dispatches H3 and Breeze through its sandbox, validates media and fences protocol changes", async (t) => {
  const f = await setup();
  t.after(() => f.cleanup());
  const file = await load("gpu");
  assert.equal(file.adapterModule, undefined);
  const old = await legacyGpu();
  await f.packages.install(f.actor, old);
  await f.packages.change(f.actor, "gpu", 1, "enable");
  const nodes = new OriginalNodes(f.p, "gpu");
  const oldPair = await nodes.pair(f.actor, {
    name: "旧节点",
    models: ["MiniMax H3"],
  });
  const revoked = secret();
  await nodes.enroll({
    code: oldPair.command.split(" ").at(-1)!,
    secret: revoked,
  });
  await f.packages.install(f.actor, file, 2);
  const app = await createOriginalApp(f.p);
  await app.listen(0, "127.0.0.1");
  t.after(() => app.close());
  const url = await app.getUrl(),
    token = secret();
  const call = async (
    path: string,
    body?: object,
    expected = 200,
    bearer = token,
  ) => {
    const r = await fetch(url + path, {
      method: body ? "POST" : "GET",
      headers: {
        "content-type": "application/json",
        cookie: "fm_session=" + f.session,
        authorization: "Bearer " + bearer,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json();
    assert.equal(r.status, expected, JSON.stringify(data));
    return data;
  };
  const root = "/agent/gpu";
  await call(root + "/registration", undefined, 403, revoked);
  const panel = "/api/plugins/gpu/pages/nodes";
  assert.equal((await call(panel + "/view", {})).title, "GPU 实例");
  const pair = await call(panel + "/actions/pair", {
    payload: { name: "验收节点", models: ["MiniMax H3", "breeze-tts-2"] },
  });
  assert.match(pair.result.value, /\/agent\/gpu\/client\/install.sh/);
  await call(root + "/enroll", {
    code: pair.result.value.split(" ").at(-1),
    secret: token,
  });
  const beat = {
    stage: "ready",
    ready_models: ["MiniMax H3", "breeze-tts-2"],
    video_steps: [4, 20],
    workflow: "h3-v6-native-inputs-turbo4",
    execution_plan: { mode: "serial" },
  };
  assert.equal(
    (await call(root + "/heartbeat", beat)).execution_mode,
    "serial",
  );
  const lane = (
    device: number,
    gpu_total_gib: number,
    gpu_budget_gib: number,
    ram_budget_gib: number,
  ) => ({
    backend: "cuda",
    device,
    gpu_total_gib,
    gpu_budget_gib,
    ram_budget_gib,
  });
  const parallel = {
    mode: "parallel",
    policy: "gpu-budget-v1",
    lanes: {
      "MiniMax H3": lane(0, 160, 140, 160),
      "breeze-tts-2": lane(1, 48, 24, 64),
    },
    reserve_vram_gib: { "0": 16, "1": 4 },
    ram_total_gib: 320,
    reserve_ram_gib: 32,
  };
  await call(
    root + "/heartbeat",
    { ...beat, execution_plan: { ...parallel, ram_total_gib: 100 } },
    400,
  );
  assert.equal(
    (await call(root + "/heartbeat", { ...beat, execution_plan: parallel }))
      .execution_mode,
    "parallel",
  );
  assert.equal((await call(root + "/claim", {})).job, null);
  await call(root + "/heartbeat", beat);
  const prices = await new StudioCatalog(f.db).prices();
  await f.db.transaction((sql) =>
    new StudioCatalog(f.db).savePrices(
      sql,
      Object.fromEntries(prices.items.map((p) => [p.key, 1])),
      prices.revision,
    ),
  );
  await f.db.query("UPDATE wallets SET balance=10");
  const gen = new OriginalGeneration(f.p);
  const submit = async (
    kind: "video" | "audio",
    model: string,
    extra: object = {},
  ) =>
    gen.submit(
      f.actor,
      await gen.parse(kind, {
        model,
        prompt: "测试",
        uid: randomUUID(),
        ...extra,
      }),
    );
  const h3 = await submit("video", "MiniMax H3", {
    h3: { mode: "frames" },
    sampling_steps: 4,
  });
  const audio = await submit("audio", "breeze-tts-2");
  await assert.rejects(f.packages.install(f.actor, old, 3, true), {
    status: 409,
    message: "请先排空在途任务，再切换节点协议",
  });
  const settled: string[] = [];
  for (const id of [h3.id, audio.id]) {
    const job = (await call(root + "/claim", {})).job;
    assert.equal(job.id, id);
    assert.equal(
      (
        await call(root + "/heartbeat", {
          ...beat,
          stage: "busy",
          ticket: job.ticket,
        })
      ).held,
      true,
    );
    const inst = job.instruction;
    const result = async (data: Buffer, report: object, status: number) => {
      const response = await fetch(url + root + "/jobs/" + id + "/result", {
        method: "PUT",
        body: new Uint8Array(data),
        headers: {
          authorization: "Bearer " + token,
          "X-Job-Ticket": job.ticket,
          "X-SHA256": createHash("sha256").update(data).digest("hex"),
          "X-Job-Timing": JSON.stringify(report),
        },
      });
      const value = await response.json();
      assert.equal(response.status, status, JSON.stringify(value));
      return value;
    };
    let data: Buffer,
      report: Record<string, unknown> = {};
    if (inst.kind === "video") {
      const path = join(f.directory, "fixture.mp4");
      execFileSync("ffmpeg", [
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=s=864x480:r=24",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=32000:cl=stereo",
        "-t",
        String(124 / 24),
        "-threads",
        "2",
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        path,
      ]);
      data = await readFile(path);
      const { inputFingerprint } =
        await import("@fumiao/plugin-gpu/artifacts.js");
      report = {
        h3_input_fingerprint: inputFingerprint(inst.h3_inputs),
        sampling_steps: 4,
        fast_mode: true,
      };
      await result(data, { ...report, sampling_steps: 20 }, 422);
      await result(
        data,
        { ...report, h3_input_fingerprint: "0".repeat(64) },
        422,
      );
      await result(data.subarray(0, 100), report, 422);
    } else {
      data = wavFixture();
      await result(data, report, 422);
      data.writeInt16LE(512, 44);
    }
    const first = await result(data, report, 200);
    assert.deepEqual(await result(data, report, 200), first);
    settled.push(first.id);
    await call(root + "/heartbeat", beat);
  }
  assert.equal(new Set(settled).size, 2);
  const ledger = await one(
    f.db,
    "SELECT count(*)::int AS n FROM ledger WHERE job_id IN (SELECT id FROM jobs WHERE plugin_id='gpu' AND package_version=$1 AND state='completed') AND action='spend'",
    [file.version],
  );
  assert.equal(ledger.n, 2);
});

test("sandbox media tools process private workspace assets and remove rolled-back outputs", async (t) => {
  const { PluginPages } = await import("@fumiao/platform/plugin-pages.js");
  const f = await setup();
  t.after(() => f.cleanup());
  const file = await load("example-node-pool");
  assert.match(
    (await f.packages.preview(f.actor, file)).changes.join(" "),
    /私有素材/,
  );
  await f.packages.install(f.actor, file);
  const pages = new PluginPages(f.p);
  const workspace = await one(
    f.db,
    "SELECT * FROM workspaces WHERE owner_id=$1",
    [f.actor.id],
  );
  const id = randomUUID(),
    path = join(f.directory, "input.mp4");
  execFileSync("ffmpeg", [
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=s=64x48:r=24",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440",
    "-t",
    "0.5",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-c:a",
    "aac",
    path,
  ]);
  const bytes = await readFile(path);
  await f.p.storage.put(id, bytes, "video/mp4");
  const { public_id: asset } = await one(
    f.db,
    "INSERT INTO assets(id,workspace_id,owner_id,object_key,mime,size,state,original_kind) VALUES($1,$2,$3,$4,'video/mp4',$5,'ready','video') RETURNING public_id",
    [id, workspace.id, f.actor.id, id, bytes.length],
  );
  const act = (name: string, payload: object, space = workspace.public_id) =>
    pages.action(f.actor, String(space), file.id, "media", name, { payload });
  assert.match((await act("probe", { asset })).notice!, /video\/mp4.*64 × 48/);
  const converted = async (name: string, payload: object, mime: string) => {
    const id = (await act(name, payload)).notice!.split(" ").at(-1);
    const a = await one(f.db, "SELECT * FROM assets WHERE public_id=$1", [id]);
    assert.equal(a.workspace_id, workspace.id);
    assert.equal(a.owner_id, f.actor.id);
    assert.equal(a.mime, mime);
    assert.equal((await f.p.storage.stat(a.object_key)).size, Number(a.size));
    return a;
  };
  await converted("frame", { asset, seconds: 0.1 }, "image/png");
  await converted("transcode", { asset, format: "wav" }, "audio/wav");
  const joined = await converted(
    "concat",
    { assets: asset + "\n" + asset, format: "mp4" },
    "video/mp4",
  );
  assert.ok(
    joined.metadata.duration >= 0.95 && joined.metadata.duration <= 1.1,
  );
  const other = await one(
    f.db,
    "INSERT INTO workspaces(id,kind,name,owner_id) VALUES(gen_random_uuid(),'team','隔离工作区',$1) RETURNING public_id",
    [f.actor.id],
  );
  await assert.rejects(act("probe", { asset }, other.public_id), {
    status: 422,
  });
  await assert.rejects(act("frame", { asset, seconds: 2 }), { status: 422 });
  await assert.rejects(
    act("transcode", { asset: "file:///tmp/input", format: "wav" }),
    { status: 422 },
  );
  const updated = structuredClone(file);
  updated.version = "1.1.1";
  const page = updated.contributes!.settingsPages.find(
    (p) => p.id === "media",
  )!;
  page.program =
    '({view(){return {schema:1,title:"测试",blocks:[]}},async action(id,p,_,host){await host.media.transcode(p.asset,{format:"wav"});throw Error("rollback")}})';
  await f.packages.install(f.actor, updated, 1);
  const { readdir } = await import("node:fs/promises");
  const before = await readdir(f.directory);
  await assert.rejects(act("transcode", { asset }), { status: 422 });
  assert.deepEqual(await readdir(f.directory), before);
  const audit = await one(
    f.db,
    "SELECT detail,outcome FROM studio_plugin_audit WHERE plugin_id=$1 ORDER BY id DESC LIMIT 1",
    [file.id],
  );
  assert.equal(audit.outcome, "failed");
  assert.match(audit.detail, /media.transcode×1/);
});
