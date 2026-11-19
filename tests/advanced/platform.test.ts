import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import {
  migrate,
  Postgres,
  type Database,
  type Sql,
  one,
} from "../../packages/platform/src/db.js";
import { Vault } from "../../packages/platform/src/security.js";
import { PluginRegistry } from "../../packages/platform/src/plugins.js";
import { DiskStorage } from "../../packages/platform/src/storage.js";
import { Platform } from "../../packages/platform/src/platform.js";
import { Executor } from "../../packages/platform/src/executor.js";
import { GpuGateway } from "../../packages/platform/src/gpu.js";
import {
  ProviderError,
  type ProviderPlugin,
} from "../../packages/plugin-sdk/src/index.js";
import { Operations } from "../../packages/platform/src/operations.js";
import { Payments } from "../../packages/platform/src/payments.js";
import {
  importLegacy,
  legacyId,
} from "../../packages/platform/src/importer.js";
import { sign, fen, zpay } from "../../plugins/payments/src/index.js";
import { createApp } from "../../apps/api/src/main.js";
import { loseUploadAcknowledgement } from "../helpers/upload-acknowledgement.js";
import { OriginalCredits } from "../../packages/original-api/src/credits.js";
import { OriginalCanvases } from "../../packages/original-api/src/canvases.js";

async function fixture(plugin?: ProviderPlugin) {
  const pg = process.env.TEST_DATABASE_URL ? null : new PGlite();
  const directory = await mkdtemp(join(tmpdir(), "fumiao-test-"));
  const wrap = (handle: any): Sql => ({
    async query(sql, params = []) {
      if (!params.length && sql.includes(";")) {
        const results = await handle.exec(sql);
        return results.at(-1) || { rows: [] };
      }
      return handle.query(sql, params);
    },
  });
  let db: Database;
  if (process.env.TEST_DATABASE_URL) {
    const adminDb = new Postgres(process.env.TEST_DATABASE_URL);
    const schema = "test_" + randomUUID().replaceAll("-", "");
    await adminDb.query("CREATE SCHEMA " + schema);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set("options", "-c search_path=" + schema);
    const instance = new Postgres(url.toString());
    db = {
      query: instance.query.bind(instance),
      transaction: instance.transaction.bind(instance),
      close: async () => {
        await instance.close();
        await adminDb.query("DROP SCHEMA " + schema + " CASCADE");
        await adminDb.close();
      },
    };
  } else {
    db = {
      ...wrap(pg),
      transaction: (fn) => pg!.transaction((tx) => fn(wrap(tx))),
      close: () => pg!.close(),
    };
  }
  const registry = plugin ? new PluginRegistry([plugin]) : new PluginRegistry();
  const p = new Platform(
    db,
    new Vault(randomBytes(32).toString("base64")),
    registry,
    new DiskStorage(directory),
  );
  await migrate(db);
  await migrate(db);
  await registry.installBuiltins(db);
  await registry.installBuiltins(db);
  const admin = await p.bootstrap({
    name: "admin",
    nickname: "管理员",
    password: "safe-test-password",
  });
  const token = await p.login(
    { name: "admin", password: "safe-test-password" },
    "local",
  );
  const actor = await p.actor(token);
  const invite = await p.createInvite(actor, { name: "test", credits: 100 });
  const user = await p.register({
    name: "member",
    nickname: "成员",
    password: "safe-test-password",
    code: invite.code,
  });
  const member = await p.actor(
    await p.login({ name: "member", password: "safe-test-password" }, "local"),
  );
  const wid = (await p.workspaces(member))[0].id;
  return {
    p,
    db,
    directory,
    admin: actor,
    member,
    wid,
    token,
    cleanup: async () => {
      await db.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
const mock: ProviderPlugin = {
  manifest: {
    id: "mock-provider",
    version: "1.0.0",
    contractVersion: 1,
    label: "Test provider",
    mode: "request",
    configSchema: { type: "object", additionalProperties: false },
    models: [
      {
        id: "test-chat",
        label: "Test chat",
        kind: "chat",
        inputSchema: { type: "object", additionalProperties: false },
      },
    ],
  },
  health: async () => true,
  submit: async () => ({ state: "completed", artifacts: [], text: "hello" }),
};
async function prepare(f: Awaited<ReturnType<typeof fixture>>, plugin = mock) {
  const { id } = await f.p.createConnection(f.admin, {
    name: "test",
    pluginId: plugin.manifest.id,
    version: "1.0.0",
    config: {},
  });
  await f.p.updateConnection(f.admin, id, {
    revision: 1,
    enabled: true,
    concurrency: 2,
  });
  const model = await one(
    f.db,
    "SELECT id FROM models WHERE connection_id=$1",
    [id],
  );
  await f.p.setModel(f.admin, model.id, { enabled: true, price: 7 });
  return { connection: id, model: model.id };
}
test("tenant isolation, transactional credits, idempotent jobs and terminal settlement", async () => {
  const f = await fixture(mock);
  try {
    const { model } = await prepare(f);
    const body = { key: randomUUID(), modelId: model, prompt: "hello" };
    const job = await f.p.submit(f.member, f.wid, body);
    assert.equal((await f.p.submit(f.member, f.wid, body)).id, job.id);
    await assert.rejects(
      f.p.submit(f.member, f.wid, { ...body, prompt: "changed" }),
      /幂等键/,
    );
    await assert.rejects(f.p.jobs(f.admin, f.wid), /访问权限/);
    assert.equal(Number((await f.p.wallet(f.member, f.wid)).held), 7);
    const heldHistory = (await new OriginalCredits(f.p).list(f.member)).history;
    assert.deepEqual(
      heldHistory
        .slice(0, 2)
        .map((r) => [r.action, r.balance, r.reserved, r.actor]),
      [
        ["reserve", 100, 7, 2],
        ["adjust", 100, 0, 1],
      ],
    );
    const executor = new Executor(f.p);
    await executor.execute(job.id);
    await executor.execute(job.id);
    const wallet = await f.p.wallet(f.member, f.wid);
    assert.equal(Number(wallet.balance), 93);
    assert.equal(Number(wallet.held), 0);
    const spentHistory = (await new OriginalCredits(f.p).list(f.member))
      .history;
    assert.deepEqual(
      spentHistory
        .slice(0, 2)
        .map((r) => [r.action, r.balance, r.reserved, r.actor]),
      [
        ["spend", 93, 0, 2],
        ["reserve", 100, 7, 2],
      ],
    );
    assert.equal(spentHistory[0].job, heldHistory[0].job);
    assert.equal((await f.p.jobs(f.member, f.wid))[0].result.text, "hello");
    assert.equal(
      (await f.p.ledger(f.member, f.wid)).filter((x) => x.action === "spend")
        .length,
      1,
    );
    await assert.rejects(
      f.p.createConnection(f.member, { name: "bad" }),
      /管理员/,
    );
  } finally {
    await f.cleanup();
  }
});
test("uncertain provider submissions retain hold and are never automatically resubmitted", async () => {
  let calls = 0;
  const plugin = {
    ...mock,
    submit: async () => {
      calls++;
      throw new ProviderError("lost acknowledgement", "uncertain");
    },
  };
  const f = await fixture(plugin);
  try {
    const { model } = await prepare(f);
    const job = await f.p.submit(f.member, f.wid, {
      key: randomUUID(),
      modelId: model,
      prompt: "test",
    });
    const executor = new Executor(f.p);
    await executor.execute(job.id);
    await executor.execute(job.id);
    assert.equal(calls, 1);
    assert.equal((await f.p.jobs(f.member, f.wid))[0].state, "uncertain");
    assert.equal(Number((await f.p.wallet(f.member, f.wid)).held), 7);
  } finally {
    await f.cleanup();
  }
});
test("queued cancellation refunds once; disabled connections pause new work", async () => {
  const f = await fixture(mock);
  try {
    const { model, connection } = await prepare(f);
    const job = await f.p.submit(f.member, f.wid, {
      key: randomUUID(),
      modelId: model,
      prompt: "test",
    });
    await f.p.updateConnection(f.admin, connection, {
      revision: 2,
      enabled: false,
      concurrency: 1,
    });
    await new Executor(f.p).execute(job.id);
    assert.equal((await f.p.jobs(f.member, f.wid))[0].state, "queued");
    await f.p.cancel(f.member, job.id);
    await f.p.cancel(f.member, job.id);
    const refunded = (await new OriginalCredits(f.p).list(f.member)).history;
    assert.deepEqual(
      refunded.slice(0, 2).map((r) => [r.action, r.balance, r.reserved]),
      [
        ["refund", 100, 0],
        ["reserve", 100, 7],
      ],
    );
    assert.equal(Number((await f.p.wallet(f.member, f.wid)).held), 0);
    assert.equal(
      (await f.p.ledger(f.member, f.wid)).filter((x) => x.action === "refund")
        .length,
      1,
    );
  } finally {
    await f.cleanup();
  }
});
test("GPU pairing is single use and results require an active node lease", async () => {
  const f = await fixture();
  try {
    const connection = await f.p.createConnection(f.admin, {
      name: "GPU",
      pluginId: "gpu",
      version: "1.0.0",
      config: {},
    });
    await f.p.updateConnection(f.admin, connection.id, {
      revision: 1,
      enabled: true,
      concurrency: 1,
    });
    const model = await one(
      f.db,
      "SELECT id FROM models WHERE connection_id=$1 AND kind='audio'",
      [connection.id],
    );
    await f.p.setModel(f.admin, model.id, { enabled: true, price: 1 });
    const gateway = new GpuGateway(f.p);
    const pair = await gateway.pair(f.admin, { connectionId: connection.id });
    const node = await gateway.enroll({
      code: pair.code,
      name: "local",
      models: ["breeze-tts-2"],
    });
    await assert.rejects(
      gateway.enroll({
        code: pair.code,
        name: "again",
        models: ["breeze-tts-2"],
      }),
      /接入码/,
    );
    const job = await f.p.submit(f.member, f.wid, {
      key: randomUUID(),
      modelId: model.id,
      prompt: "你好",
    });
    const claimed = await gateway.claim(node.token);
    assert.equal(claimed.job.id, job.id);
    assert.equal((await gateway.claim(node.token)).job, null);
    await gateway.heartbeat(node.token, {
      jobId: job.id,
      lease: claimed.job.lease,
    });
    await assert.rejects(
      gateway.heartbeat(node.token, { jobId: job.id, lease: randomUUID() }),
      /租约/,
    );
  } finally {
    await f.cleanup();
  }
});
test("asset references and optimistic document saves enforce workspace boundaries", async () => {
  const f = await fixture(mock);
  try {
    const png = await sharp({
      create: { width: 16, height: 16, channels: 3, background: "blue" },
    })
      .png()
      .toBuffer();
    const asset = await f.p.upload(f.member, f.wid, png, "image/png");
    const id = randomUUID();
    const doc = {
      id,
      kind: "canvas",
      title: "Draft",
      revision: 0,
      body: { nodes: [] },
      assets: [asset.id],
    };
    await f.p.saveDocument(f.member, f.wid, doc);
    await assert.rejects(f.p.saveDocument(f.member, f.wid, doc), /版本冲突/);
    await assert.rejects(f.p.deleteAsset(f.member, asset.id), /引用/);
    await assert.rejects(f.p.media(f.admin, asset.id), /访问权限/);
    const { model } = await prepare(f);
    const own = (await f.p.workspaces(f.admin))[0].id;
    await f.p.adjustCredits(f.admin, own, { amount: 100, key: randomUUID() });
    await assert.rejects(
      f.p.submit(f.admin, own, {
        key: randomUUID(),
        modelId: model,
        prompt: "test",
        references: [asset.id],
      }),
      /素材/,
    );
  } finally {
    await f.cleanup();
  }
});
for (const offline of [false, true]) {
  test(`Advanced upload survives lost commit acknowledgement with database ${offline ? "offline" : "available"}`, async () => {
    const f = await fixture();
    const app = await createApp(f.p);
    try {
      await app.listen(0, "127.0.0.1");
      const url = await app.getUrl();
      const workspace = await one(
        f.db,
        "SELECT id FROM workspaces WHERE kind='personal' AND owner_id=$1",
        [f.member.id],
      );
      const token = await f.p.login(
        { name: "member", password: "safe-test-password" },
        "local",
      );
      const cookie = "fm_session=" + token;
      const bytes = await sharp({
        create: { width: 11, height: 17, channels: 3, background: "#234567" },
      })
        .png()
        .toBuffer();
      const response = await loseUploadAcknowledgement(
        f.db,
        () =>
          fetch(url + "/api/assets", {
            method: "POST",
            headers: {
              cookie,
              "Content-Type": "image/png",
              "X-Workspace-Id": workspace.id,
            },
            body: new Uint8Array(bytes),
          }),
        offline,
      );
      const { rows } = await f.db.query(
        "SELECT id, public_id, owner_id, workspace_id, state, object_key FROM assets",
      );
      assert.equal(rows.length, 1);
      const [asset] = rows;
      assert.equal(asset.state, "ready");
      assert.equal(asset.workspace_id, workspace.id);
      assert.equal(asset.owner_id, f.member.id);
      assert.notEqual(asset.id, asset.public_id);
      assert.deepEqual(
        Buffer.from(await f.p.storage.read(asset.object_key)),
        bytes,
      );
      assert.equal(response.status, offline ? 500 : 201);
      assert.deepEqual(
        await response.json(),
        offline ? { message: "请求处理失败" } : { id: asset.id },
      );
      const media = url + "/media/" + asset.id;
      assert.equal((await fetch(media)).status, 401);
      const denied = await fetch(media, {
        headers: { cookie: "fm_session=" + f.token },
        redirect: "manual",
      });
      assert.equal(denied.status, 404);
      assert.equal(denied.headers.get("location"), null);
      const authorized = await fetch(media, { headers: { cookie } });
      assert.equal(authorized.status, 200);
      assert.deepEqual(Buffer.from(await authorized.bytes()), bytes);
      const usage = await one(
        f.db,
        "SELECT storage_used FROM workspaces WHERE id=$1",
        [workspace.id],
      );
      assert.equal(Number(usage.storage_used), bytes.length);
    } finally {
      await app.close();
      await f.cleanup();
    }
  });
}

test("Nest entry points enforce session authentication, CSRF and input validation", async () => {
  const f = await fixture(mock);
  const app = await createApp(f.p);
  try {
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    assert.equal((await fetch(base + "/api/workspaces")).status, 401);
    const login = await fetch(base + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "admin", password: "safe-test-password" }),
    });
    assert.equal(login.status, 201);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    assert.match(login.headers.get("set-cookie")!, /HttpOnly/);
    assert.equal(
      (await fetch(base + "/api/workspaces", { headers: { cookie } })).status,
      200,
    );
    assert.equal(
      (
        await fetch(base + "/api/workspaces", {
          method: "POST",
          headers: {
            cookie,
            Origin: "https://evil.invalid",
            "Content-Type": "application/json",
          },
          body: '{"name":"bad"}',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + "/api/jobs", {
          method: "POST",
          headers: {
            cookie,
            "Content-Type": "application/json",
            "X-Workspace-Id": f.wid,
          },
          body: "{}",
        })
      ).status,
      400,
    );
  } finally {
    await app.close();
    await f.cleanup();
  }
});

test("manual reconciliation releases only one hold and records the decision", async () => {
  const f = await fixture({
    ...mock,
    submit: async () => {
      throw new ProviderError("lost", "uncertain");
    },
  });
  try {
    const { model } = await prepare(f);
    const job = await f.p.submit(f.member, f.wid, {
      key: randomUUID(),
      modelId: model,
      prompt: "test",
    });
    await new Executor(f.p).execute(job.id);
    const ops = new Operations(f.p);
    await assert.rejects(
      ops.resolve(f.member, job.id, {
        action: "refund",
        reason: "provider confirmed no charge",
      }),
      /管理员/,
    );
    await ops.resolve(f.admin, job.id, {
      action: "refund",
      reason: "provider confirmed no charge",
    });
    assert.equal(Number((await f.p.wallet(f.member, f.wid)).held), 0);
    await assert.rejects(
      ops.resolve(f.admin, job.id, {
        action: "refund",
        reason: "repeat confirmed",
      }),
      /未确认/,
    );
  } finally {
    await f.cleanup();
  }
});
test("credit adjustment rejects changed payload on reused idempotency key", async () => {
  const f = await fixture(mock);
  try {
    const key = randomUUID();
    await f.p.adjustCredits(f.admin, f.wid, { key, amount: 5 });
    await f.p.adjustCredits(f.admin, f.wid, { key, amount: 5 });
    await assert.rejects(
      f.p.adjustCredits(f.admin, f.wid, { key, amount: 50 }),
      /幂等键/,
    );
    assert.equal(Number((await f.p.wallet(f.member, f.wid)).balance), 105);
  } finally {
    await f.cleanup();
  }
});
test("plugin upgrades preserve snapshots on jobs already accepted", async () => {
  const f = await fixture(mock);
  try {
    const { model, connection } = await prepare(f);
    const job = await f.p.submit(f.member, f.wid, {
      key: randomUUID(),
      modelId: model,
      prompt: "test",
    });
    const manifest = { ...mock.manifest, version: "2.0.0" };
    await f.p.registry.install(f.db, manifest, "http://127.0.0.1:9999");
    await new Operations(f.p).upgrade(f.admin, connection, {
      revision: 2,
      version: "2.0.0",
      config: {},
    });
    const stored = await one(
      f.db,
      "SELECT plugin_version FROM jobs WHERE id=$1",
      [job.id],
    );
    assert.equal(stored.plugin_version, "1.0.0");
    const latest = await one(
      f.db,
      "SELECT plugin_version,enabled FROM connections WHERE id=$1",
      [connection],
    );
    assert.equal(latest.plugin_version, "2.0.0");
    assert.equal(latest.enabled, false);
    await assert.rejects(
      f.p.registry.install(
        f.db,
        { ...manifest, label: "modified" },
        "http://127.0.0.1:9999",
      ),
      /不可修改/,
    );
  } finally {
    await f.cleanup();
  }
});
test("verified recharge settles exactly once and rejects forged callbacks", async () => {
  const f = await fixture(mock);
  let calls = 0;
  const adapter = {
    ...zpay,
    create: async () => {
      calls++;
      return { checkout: "https://payments.example/checkout" };
    },
    verify: async () => "trade-1",
  };
  const payments = new Payments(f.p, { alipay: adapter });
  try {
    const config = {
      gateway: "https://payments.example",
      pid: "1",
      key: "test-secret",
    };
    await payments.configure(f.admin, "alipay", { config, enabled: true });
    const input = { key: randomUUID(), method: "alipay", yuan: 5 };
    const order = await payments.create(f.member, f.wid, input);
    assert.equal((await payments.create(f.member, f.wid, input)).id, order.id);
    assert.equal(calls, 1);
    const values = {
      pid: "1",
      out_trade_no: order.id,
      money: "5.00",
      trade_status: "TRADE_SUCCESS",
      type: "alipay",
      trade_no: "trade-1",
    };
    await assert.rejects(
      payments.callback("alipay", { ...values, sign: "forged" }),
    );
    await payments.callback("alipay", {
      ...values,
      sign: sign(values, config.key),
    });
    await payments.callback("alipay", {
      ...values,
      sign: sign(values, config.key),
    });
    assert.equal(Number((await f.p.wallet(f.member, f.wid)).balance), 150);
    const recharge = (await new OriginalCredits(f.p).list(f.member)).history[0];
    assert.deepEqual(
      [
        recharge.action,
        recharge.balance,
        recharge.reserved,
        recharge.actor,
        recharge.note,
      ],
      ["recharge", 150, 0, 2, "支付宝 ¥5.00 · " + order.id],
    );
    assert.equal(
      (await f.p.ledger(f.member, f.wid)).filter((l) => l.action === "recharge")
        .length,
      1,
    );
    assert.throws(() => fen("0.001"));
    assert.equal(fen("5.2"), 520);
  } finally {
    await f.cleanup();
  }
});
test("legacy import preserves passwords, balances, media and documents and is repeatable", async () => {
  const f = await fixture(mock);
  try {
    await f.db.query("TRUNCATE users CASCADE");
    const salt = randomBytes(16).toString("hex");
    const pw = scryptSync("old-password", Buffer.from(salt, "hex"), 64, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    }).toString("hex");
    const mid = "a".repeat(32);
    const png = await sharp({
      create: { width: 16, height: 16, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    await writeFile(join(f.directory, mid), png);
    const data = {
      version: 1 as const,
      source: "test-import",
      canvasVersion: 1 as const,
      tables: {
        users: [{ id: 1, name: "legacy", salt, pw, role: "admin", active: 1 }],
        workspaces: [{ id: 1, owner: 1, name: "Personal", kind: "personal" }],
        credit_accounts: [{ workspace: 1, balance: 42, reserved: 0 }],
        credit_ledger: [
          {
            id: 40,
            workspace: 1,
            actor: 1,
            job: null,
            chat_turn: null,
            action: "adjust",
            amount: 50,
            balance: 50,
            reserved: 0,
            note: "历史增加",
            uid: randomUUID(),
            created: 1,
          },
          {
            id: 51,
            workspace: 1,
            actor: 1,
            job: 1,
            chat_turn: null,
            action: "spend",
            amount: 8,
            balance: 42,
            reserved: 0,
            note: "历史扣款",
            uid: null,
            created: 2,
          },
        ],
        media: [
          {
            id: mid,
            kind: "image",
            owner: 1,
            workspace: 1,
            mime: "image/png",
            size: png.length,
            w: 16,
            h: 16,
          },
        ],
        canvas_projects: [
          {
            id: "c".repeat(32),
            owner: 1,
            workspace: 1,
            title: "Legacy canvas",
            last_editor: 1,
            created: 1,
            updated: 2,
            revision: 1,
            document: JSON.stringify({
              nodes: [
                {
                  id: "n",
                  type: "image",
                  x: 0,
                  y: 0,
                  media_id: mid,
                  text: "/media/" + mid,
                },
              ],
              edges: [],
            }),
          },
        ],
        canvas_media_refs: [{ project: "c".repeat(32), node: "n", media: mid }],
        canvas_job_links: [],
        canvas_run_batches: [],
        storyboard_exports: [],
        storyboard_export_refs: [],
        jobs: [
          {
            id: 1,
            owner: 1,
            workspace: 1,
            model: "muse-image",
            kind: "image",
            prompt: "test",
            refs: "[]",
            status: "done",
            result: mid,
            created: 1,
          },
        ],
      },
    };
    await importLegacy(f.p, data, f.directory);
    assert.equal(
      (await importLegacy(f.p, data, f.directory)).alreadyImported,
      true,
    );
    const actor = await f.p.actor(
      await f.p.login({ name: "legacy", password: "old-password" }, "local"),
    );
    const wid = legacyId(data.source, "workspace", 1);
    assert.equal(Number((await f.p.wallet(actor, wid)).balance), 42);
    const importedHistory = await new OriginalCredits(f.p).history(f.db, 1);
    assert.deepEqual(
      importedHistory.map((r) => [
        r.id,
        r.job,
        r.action,
        r.amount,
        r.balance,
        r.actor_name,
      ]),
      [
        [51, 1, "spend", 8, 42, "legacy"],
        [40, null, "adjust", 50, 50, "legacy"],
      ],
    );
    assert.equal(
      Number(
        (
          await one(
            f.db,
            "SELECT count(*) FROM ledger WHERE action='migration'",
          )
        ).count,
      ),
      0,
    );
    assert.equal(
      Number((await one(f.db, "SELECT public_id FROM jobs LIMIT 1")).public_id),
      1,
    );
    assert.equal(
      Number(
        (
          await one(
            f.db,
            "SELECT nextval(pg_get_serial_sequence('jobs','public_id')) AS value",
          )
        ).value,
      ),
      2,
    );
    assert.equal(
      (await f.p.jobs(actor, wid))[0].result.assets[0],
      legacyId(data.source, "asset", mid),
    );
    const nativeActor = await one(f.db, "SELECT * FROM users WHERE id=$1", [
      actor.id,
    ]);
    const canvas = await new OriginalCanvases(f.p).get(
      nativeActor as any,
      "c".repeat(32),
    );
    assert.equal(canvas.document.nodes[0].media_id, mid);
    assert.equal(canvas.document.nodes[0].text, "/media/" + mid);
    assert.deepEqual(await f.p.documents(actor, wid, "canvas"), []);
    const record = await one(f.db, "SELECT password FROM users WHERE id=$1", [
      actor.id,
    ]);
    assert.ok(record.password.startsWith("scrypt:"));
    await assert.rejects(
      importLegacy(
        f.p,
        {
          ...data,
          tables: {
            ...data.tables,
            credit_accounts: [{ workspace: 1, balance: 400, reserved: 0 }],
          },
        },
        f.directory,
      ),
      /变化/,
    );
  } finally {
    await f.cleanup();
  }
});
test("GPU completion validates media and fences duplicate and expired leases", async () => {
  const f = await fixture();
  try {
    const c = await f.p.createConnection(f.admin, {
      name: "GPU",
      pluginId: "gpu",
      version: "1.0.0",
      config: {},
    });
    await f.p.updateConnection(f.admin, c.id, {
      revision: 1,
      enabled: true,
      concurrency: 1,
    });
    const model = await one(
      f.db,
      "SELECT id FROM models WHERE connection_id=$1 AND kind='audio'",
      [c.id],
    );
    await f.p.setModel(f.admin, model.id, { enabled: true, price: 2 });
    const g = new GpuGateway(f.p);
    const pair = await g.pair(f.admin, { connectionId: c.id });
    const node = await g.enroll({
      code: pair.code,
      name: "GPU",
      models: ["breeze-tts-2"],
    });
    const job = await f.p.submit(f.member, f.wid, {
      key: randomUUID(),
      modelId: model.id,
      prompt: "hello",
    });
    const claimed = (await g.claim(node.token)).job!;
    const wav = Buffer.alloc(44 + 4800);
    wav.write("RIFF");
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(24000, 24);
    wav.writeUInt32LE(48000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(4800, 40);
    const result = await g.complete(node.token, job.id, claimed.lease, wav);
    assert.deepEqual(
      await g.complete(node.token, job.id, claimed.lease, wav),
      result,
    );
    assert.equal(Number((await f.p.wallet(f.member, f.wid)).balance), 98);
    const next = await f.p.submit(f.member, f.wid, {
      key: randomUUID(),
      modelId: model.id,
      prompt: "next",
    });
    const lease = (await g.claim(node.token)).job!.lease;
    await f.db.query(
      "UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
      [next.id],
    );
    await assert.rejects(
      g.heartbeat(node.token, { jobId: next.id, lease }),
      /租约/,
    );
    await new Executor(f.p).recover();
    assert.equal(
      (await one(f.db, "SELECT state FROM jobs WHERE id=$1", [next.id])).state,
      "uncertain",
    );
    await assert.rejects(g.complete(node.token, next.id, lease, wav), /租约/);
  } finally {
    await f.cleanup();
  }
});
test(
  "BullMQ delivers jobs against PostgreSQL and Redis",
  { skip: !process.env.TEST_REDIS_URL },
  async () => {
    const { Queue, Worker, QueueEvents } = await import("bullmq");
    const url = new URL(process.env.TEST_REDIS_URL!);
    const connection = {
      host: url.hostname,
      port: Number(url.port || 6379),
      username: url.username ? decodeURIComponent(url.username) : undefined,
      password: url.password ? decodeURIComponent(url.password) : undefined,
      db: Number(url.pathname.slice(1) || 0),
      ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    };
    const name = "test-" + randomUUID();
    const f = await fixture(mock);
    const queue = new Queue(name, { connection }),
      events = new QueueEvents(name, { connection });
    const worker = new Worker(
      name,
      async (job) => new Executor(f.p).execute(job.data.id),
      { connection, concurrency: 2 },
    );
    try {
      await events.waitUntilReady();
      const { model } = await prepare(f);
      const result = await f.p.submit(f.member, f.wid, {
        key: randomUUID(),
        modelId: model,
        prompt: "queue test",
      });
      const job = await queue.add("execute", { id: result.id });
      await job.waitUntilFinished(events, 20000);
      assert.equal(Number((await f.p.wallet(f.member, f.wid)).balance), 93);
    } finally {
      await worker.close();
      await events.close();
      await queue.obliterate({ force: true });
      await queue.close();
      await f.cleanup();
    }
  },
);

test("storage quota is enforced in the database and failed uploads leave no metadata", async () => {
  const f = await fixture(mock);
  try {
    await f.db.query("UPDATE workspaces SET storage_limit=50 WHERE id=$1", [
      f.wid,
    ]);
    const png = await sharp({
      create: { width: 16, height: 16, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    await assert.rejects(
      f.p.upload(f.member, f.wid, png, "image/png"),
      /quota/,
    );
    assert.equal((await f.p.assets(f.member, f.wid)).length, 0);
    assert.deepEqual(await readdir(f.directory), []);
    assert.equal(
      Number(
        (
          await one(f.db, "SELECT storage_used FROM workspaces WHERE id=$1", [
            f.wid,
          ])
        ).storage_used,
      ),
      0,
    );
  } finally {
    await f.cleanup();
  }
});

test("Advanced upload cleans up its own bytes when a deferred check rejects COMMIT", async () => {
  const f = await fixture();
  try {
    const png = await sharp({
      create: { width: 11, height: 17, channels: 3, background: "#345678" },
    })
      .png()
      .toBuffer();
    const first = await f.p.upload(f.member, f.wid, png, "image/png");
    await f.db.query(`
      CREATE FUNCTION reject_upload() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic commit rejection'; END $$;
      CREATE CONSTRAINT TRIGGER reject_upload AFTER INSERT ON assets
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_upload()`);
    await assert.rejects(
      f.p.upload(f.member, f.wid, png, "image/png"),
      /synthetic commit rejection/,
    );
    assert.deepEqual((await f.db.query("SELECT id FROM assets")).rows, [first]);
    assert.deepEqual(await readdir(f.directory), [first.id]);
    assert.deepEqual(Buffer.from(await f.p.storage.read(first.id)), png);
    const workspace = await one(
      f.db,
      "SELECT storage_used FROM workspaces WHERE id=$1",
      [f.wid],
    );
    assert.equal(Number(workspace.storage_used), png.length);
  } finally {
    await f.cleanup();
  }
});

test("global capacity replaces task reservations with output bytes and rolls back rejected submissions", async () => {
  const imagePlugin: ProviderPlugin = {
    ...mock,
    manifest: {
      ...mock.manifest,
      models: mock.manifest.models.map((m) => ({ ...m, kind: "image" })),
    },
  };
  const f = await fixture(imagePlugin);
  try {
    const { model } = await prepare(f, imagePlugin),
      budget = 64 << 20;
    await f.db.query("UPDATE storage_capacity SET quota=$1", [budget]);
    const input = { key: randomUUID(), modelId: model, prompt: "reserved" };
    const job = await f.p.submit(f.member, f.wid, input);
    assert.equal((await f.p.submit(f.member, f.wid, input)).id, job.id);
    await assert.rejects(
      f.p.submit(f.member, f.wid, { ...input, key: randomUUID() }),
      { status: 507 },
    );
    assert.equal(Number((await f.p.wallet(f.member, f.wid)).held), 7);
    assert.equal((await f.db.query("SELECT id FROM jobs")).rows.length, 1);
    const bytes = await sharp({
      create: { width: 17, height: 13, channels: 3, background: "#123456" },
    })
      .png()
      .toBuffer();
    await assert.rejects(f.p.upload(f.member, f.wid, bytes, "image/png"), {
      status: 507,
    });
    assert.deepEqual(await readdir(f.directory), []);
    const lease = randomUUID();
    await f.db.query(
      "UPDATE jobs SET state='finalizing',lease_token=$2 WHERE id=$1",
      [job.id, lease],
    );
    const executor = new Executor(f.p),
      row = await one(f.db, "SELECT * FROM jobs WHERE id=$1", [job.id]);
    const receipt = {
      state: "completed" as const,
      artifacts: [{ url: "data:image/png;base64," + bytes.toString("base64") }],
    };
    const result = await executor.saveArtifacts(
      row,
      receipt,
      AbortSignal.timeout(5000),
    );
    let usage = await one(f.db, "SELECT * FROM storage_capacity");
    assert.equal(Number(usage.used), bytes.length);
    assert.equal(Number(usage.reserved), budget - bytes.length);
    assert.deepEqual(
      await executor.saveArtifacts(row, receipt, AbortSignal.timeout(5000)),
      result,
    );
    await executor.finish(row, "completed", result);
    usage = await one(f.db, "SELECT * FROM storage_capacity");
    assert.equal(Number(usage.reserved), 0);
    assert.equal(Number(usage.used), bytes.length);
    assert.equal(
      (await f.db.query("SELECT * FROM storage_changes")).rows.length,
      0,
    );
    assert.equal(
      (await f.db.query("SELECT * FROM storage_holds")).rows.length,
      0,
    );
    assert.equal(
      (await f.p.ledger(f.member, f.wid)).filter((x) => x.action === "spend")
        .length,
      1,
    );
  } finally {
    await f.cleanup();
  }
});

test("export capacity applies net transactional changes and supports cleanup after a quota reduction", async () => {
  const f = await fixture(mock);
  try {
    const budget = 256 << 20,
      key = "export:" + randomUUID();
    await f.db.query("UPDATE storage_capacity SET quota=$1", [budget]);
    await f.db.query(
      "INSERT INTO storage_holds(key,kind,workspace_id,budget) VALUES($1,'export',$2,$3)",
      [key, f.wid, budget],
    );
    await assert.rejects(
      f.db.query(
        "INSERT INTO storage_holds(key,kind,workspace_id,budget) VALUES($1,'export',$2,$3)",
        ["export:" + randomUUID(), f.wid, budget],
      ),
      { code: "P1002" },
    );
    const asset = randomUUID();
    await f.db.transaction(async (sql) => {
      // The temporary sum exceeds the quota; the committed state does not.
      await sql.query(
        "INSERT INTO assets(id,workspace_id,owner_id,object_key,mime,size,state) VALUES($1,$2,$3,$4,'video/mp4',100,'ready')",
        [asset, f.wid, f.member.id, asset],
      );
      await sql.query("DELETE FROM storage_holds WHERE key=$1", [key]);
    });
    let usage = await one(f.db, "SELECT * FROM storage_capacity");
    assert.equal(Number(usage.used), 100);
    assert.equal(Number(usage.reserved), 0);
    await f.db.query("UPDATE assets SET size=50 WHERE id=$1", [asset]);
    assert.equal(
      Number((await one(f.db, "SELECT used FROM storage_capacity")).used),
      50,
    );
    assert.equal(
      Number(
        (
          await one(f.db, "SELECT storage_used FROM workspaces WHERE id=$1", [
            f.wid,
          ])
        ).storage_used,
      ),
      50,
    );
    await f.db.query("UPDATE storage_capacity SET quota=0");
    await f.db.query("DELETE FROM assets WHERE id=$1", [asset]);
    usage = await one(f.db, "SELECT * FROM storage_capacity");
    assert.equal(Number(usage.used), 0);
    assert.equal(
      (await f.db.query("SELECT * FROM storage_changes")).rows.length,
      0,
    );
  } finally {
    await f.cleanup();
  }
});

test(
  "concurrent uploads in different workspaces cannot overspend global capacity or leave private objects",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const f = await fixture(mock);
    try {
      const other = await f.db.transaction((sql) =>
        f.p.createUser(sql, "other", "Other", "safe-test-password", "member"),
      );
      const bytes = await sharp({
        create: { width: 11, height: 17, channels: 3, background: "#456789" },
      })
        .png()
        .toBuffer();
      await f.db.query("UPDATE storage_capacity SET quota=$1", [bytes.length]);
      const put = f.p.storage.put.bind(f.p.storage);
      let arrived = 0,
        release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      f.p.storage.put = async (...args) => {
        await put(...args);
        if (++arrived === 2) release();
        await gate;
      };
      const results = await Promise.allSettled([
        f.p.upload(f.member, f.wid, bytes, "image/png"),
        f.p.upload(other, other.workspaceId, bytes, "image/png"),
      ]);
      assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
      const failure = results.find(
        (x) => x.status === "rejected",
      ) as PromiseRejectedResult;
      assert.equal(failure.reason.code, "P1002");
      const assets = (await f.db.query("SELECT * FROM assets")).rows;
      assert.equal(assets.length, 1);
      assert.deepEqual(await readdir(f.directory), [assets[0].object_key]);
      const usage = await one(f.db, "SELECT * FROM storage_capacity");
      assert.equal(Number(usage.used), bytes.length);
      assert.equal(
        (await f.db.query("SELECT * FROM storage_changes")).rows.length,
        0,
      );
    } finally {
      await f.cleanup();
    }
  },
);

test(
  "concurrent plugin deliveries retain a single output and clean only their own objects",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const plugin: ProviderPlugin = {
      ...mock,
      manifest: {
        ...mock.manifest,
        models: mock.manifest.models.map((m) => ({ ...m, kind: "image" })),
      },
    };
    const f = await fixture(plugin);
    try {
      const { model } = await prepare(f, plugin),
        job = await f.p.submit(f.member, f.wid, {
          key: randomUUID(),
          modelId: model,
          prompt: "image",
        }),
        lease = randomUUID();
      await f.db.query(
        "UPDATE jobs SET state='finalizing',lease_token=$2 WHERE id=$1",
        [job.id, lease],
      );
      const row = await one(f.db, "SELECT * FROM jobs WHERE id=$1", [job.id]),
        executor = new Executor(f.p);
      const bytes = await sharp({
        create: { width: 13, height: 17, channels: 3, background: "#567890" },
      })
        .png()
        .toBuffer();
      const receipt = {
        state: "completed" as const,
        artifacts: [
          { url: "data:image/png;base64," + bytes.toString("base64") },
        ],
      };
      const put = f.p.storage.put.bind(f.p.storage);
      let arrived = 0,
        release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      f.p.storage.put = async (...args) => {
        await put(...args);
        if (++arrived === 2) release();
        await gate;
      };
      const results = await Promise.all([
        executor.saveArtifacts(row, receipt, AbortSignal.timeout(5000)),
        executor.saveArtifacts(row, receipt, AbortSignal.timeout(5000)),
      ]);
      assert.deepEqual(results[0], results[1]);
      const assets = (await f.db.query("SELECT * FROM assets")).rows;
      assert.equal(assets.length, 1);
      assert.deepEqual(await readdir(f.directory), [assets[0].object_key]);
      assert.deepEqual(
        Buffer.from(await f.p.storage.read(assets[0].object_key)),
        bytes,
      );
      const usage = await one(f.db, "SELECT * FROM storage_capacity");
      assert.equal(Number(usage.used), bytes.length);
      assert.equal(Number(usage.used) + Number(usage.reserved), 64 << 20);
    } finally {
      await f.cleanup();
    }
  },
);
