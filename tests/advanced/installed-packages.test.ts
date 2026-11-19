import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID, createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { databaseFixture } from "../helpers/database.js";
import { OriginalIdentity } from "../../packages/original-api/src/identity.js";
import { OriginalGeneration } from "../../packages/original-api/src/generation.js";
import { OriginalState } from "../../packages/original-api/src/state.js";
import {
  StudioPackages,
  type PackageFile,
} from "../../packages/platform/src/studio-packages.js";
import { StudioUpdates } from "../../packages/platform/src/studio-updates.js";
import { PluginRegistry } from "../../packages/platform/src/plugins.js";
import { Executor } from "../../packages/platform/src/executor.js";
import { one } from "../../packages/platform/src/db.js";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { StudioCatalog } from "../../packages/platform/src/catalog.js";
import { wavFixture } from "../helpers/timing.js";
import { createOriginalApp } from "../../apps/api/src/original.js";
import { secret } from "../../packages/platform/src/security.js";
import { OriginalNodes } from "../../packages/original-api/src/nodes.js";
const load = async (id: string): Promise<PackageFile> =>
  JSON.parse(
    await readFile("plugins/" + id + "/" + id + ".fmplugin.json", "utf8"),
  );
async function setup() {
  const f = await databaseFixture();
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
test("GPU package installs its administrator panel while disabled and removes the pairing capability", async () => {
  const f = await setup(),
    file = await load("gpu");
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

test("current installation upgrades its configured GPU service without requiring fresh pairing", async () => {
  const f = await databaseFixture("033_studio_plugin_profile.sql");
  const file = await load("gpu");
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
