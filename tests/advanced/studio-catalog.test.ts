import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { databaseFixture } from "../helpers/database.js";
import { one } from "../../packages/platform/src/db.js";
import { StudioCatalog } from "../../packages/platform/src/catalog.js";
import { PluginRegistry } from "../../packages/platform/src/plugins.js";
import { Executor } from "../../packages/platform/src/executor.js";
import { GpuGateway } from "../../packages/platform/src/gpu.js";
import { Operations } from "../../packages/platform/src/operations.js";
import type {
  ProviderPlugin,
  Execution,
} from "../../packages/plugin-sdk/src/index.js";
const mock: ProviderPlugin = {
  manifest: {
    id: "catalog-test",
    version: "1.0.0",
    contractVersion: 1,
    label: "Fixture",
    mode: "request",
    configSchema: {
      type: "object",
      properties: { tag: { type: "string" } },
      required: ["tag"],
      additionalProperties: false,
    },
    models: [
      {
        id: "catalog-test-model",
        label: "模型",
        kind: "chat",
        inputSchema: {
          type: "object",
          properties: { size: { enum: ["small", "large"], default: "small" } },
          additionalProperties: false,
        },
        studio: {
          order: 1000,
          priceOrder: 1000,
          descriptor: { kind: "chat", label: "模型", family: "test-family" },
          prices: [
            {
              tier: "small",
              label: "小",
              amount: 7,
              match: {
                type: "object",
                required: ["size"],
                properties: { size: { const: "small" } },
              },
            },
            {
              tier: "large",
              label: "大",
              amount: 13,
              match: {
                type: "object",
                required: ["size"],
                properties: { size: { const: "large" } },
              },
            },
          ],
        },
      },
    ],
  },
  health: async () => true,
  submit: async () => ({ state: "completed", artifacts: [], text: "fixture" }),
};
async function fixture(plugins?: ProviderPlugin[]) {
  const f = await databaseFixture();
  if (plugins) f.p.registry = new PluginRegistry(plugins);
  await f.p.registry.installBuiltins(f.db);
  const admin = await f.p.bootstrap({
    name: "admin",
    nickname: "管理员",
    password: "catalog-test-password",
  });
  await f.db.transaction((sql) =>
    f.p.credit(sql, admin.workspaceId, 1000, randomUUID(), "adjust", {
      actorId: admin.id,
    }),
  );
  return { ...f, admin, catalog: new StudioCatalog(f.db) };
}
async function connect(
  f: Awaited<ReturnType<typeof fixture>>,
  plugin: ProviderPlugin,
  config: Record<string, unknown> = { tag: "before" },
) {
  const c = await f.p.createConnection(f.admin, {
    name: "Fixture",
    pluginId: plugin.manifest.id,
    version: plugin.manifest.version,
    config,
  });
  await f.p.updateConnection(f.admin, c.id, {
    enabled: true,
    revision: 1,
    concurrency: 2,
  });
  const m = await one(
    f.db,
    "SELECT * FROM models WHERE connection_id=$1 ORDER BY provider_model",
    [c.id],
  );
  return { connection: c.id, model: m.id };
}
async function switchModel(
  f: Awaited<ReturnType<typeof fixture>>,
  model: string,
  enabled: boolean,
) {
  const policy = await f.catalog.policy();
  return f.db.transaction((sql) =>
    f.catalog.savePolicy(sql, {
      model,
      enabled,
      group: false,
      workspace: null,
      expected_revision: policy.revision,
    }),
  );
}
async function price(
  f: Awaited<ReturnType<typeof fixture>>,
  key: string,
  amount: number | null,
) {
  const pricing = await f.catalog.prices();
  return f.db.transaction((sql) =>
    f.catalog.savePrices(
      sql,
      {
        ...Object.fromEntries(pricing.items.map((p) => [p.key, p.amount])),
        [key]: amount,
      },
      pricing.revision,
    ),
  );
}
test("plugin registration is immutable, atomic, extensible and keeps original default revisions", async () => {
  const f = await fixture();
  try {
    const models = await f.catalog.catalog(),
      prices = await f.catalog.prices();
    assert.equal(Object.keys(models).length, 111);
    assert.equal(prices.items.length, 124);
    assert.equal((await f.catalog.policy()).revision, 1);
    assert.equal(prices.revision, 1);
    await f.p.registry.installBuiltins(f.db);
    assert.deepEqual(await f.catalog.prices(), prices);
    await f.p.registry.install(f.db, mock.manifest, "http://127.0.0.1:1");
    assert.equal((await f.catalog.policy()).revision, 2);
    assert.equal((await f.catalog.prices()).items.length, 126);
    await assert.rejects(
      f.p.registry.install(
        f.db,
        { ...mock.manifest, label: "changed" },
        "http://127.0.0.1:1",
      ),
      { status: 409 },
    );
    const conflict = structuredClone(mock.manifest);
    conflict.id = "duplicate-owner";
    await assert.rejects(
      f.p.registry.install(f.db, conflict, "http://127.0.0.1:1"),
      /已由其他插件/,
    );
    assert.equal(
      await one(
        f.db,
        "SELECT * FROM plugin_versions WHERE id='duplicate-owner'",
      ),
      undefined,
    );
    const mixed = structuredClone(mock.manifest);
    mixed.id = "mixed-family";
    mixed.models[0].id = "different-model";
    mixed.models[0].kind = "video";
    mixed.models[0].studio!.descriptor.kind = "video";
    await assert.rejects(
      f.p.registry.install(f.db, mixed, "http://127.0.0.1:1"),
      /分组不能混用/,
    );
    assert.equal(
      await one(
        f.db,
        "SELECT * FROM studio_catalog WHERE id='different-model'",
      ),
      undefined,
    );
    assert.equal((await f.catalog.policy()).revision, 2);
  } finally {
    await f.cleanup();
  }
});
test("catalog permission and tier price compare-and-swap have a single concurrent winner", async () => {
  const f = await fixture([mock]);
  try {
    const policy = await f.catalog.policy();
    const updates = await Promise.allSettled(
      [false, true].map((enabled) =>
        f.db.transaction((sql) =>
          f.catalog.savePolicy(sql, {
            model: "test-family",
            group: true,
            enabled,
            workspace: null,
            expected_revision: policy.revision,
          }),
        ),
      ),
    );
    assert.equal(updates.filter((v) => v.status === "fulfilled").length, 1);
    assert.equal(
      updates.filter((v) => v.status === "rejected" && v.reason.status === 409)
        .length,
      1,
    );
    const prices = await f.catalog.prices(),
      values = Object.fromEntries(prices.items.map((p) => [p.key, p.amount]));
    const changes = await Promise.allSettled(
      [8, 9].map((amount) =>
        f.db.transaction((sql) =>
          f.catalog.savePrices(
            sql,
            { ...values, "catalog-test-model|small": amount },
            prices.revision,
          ),
        ),
      ),
    );
    assert.equal(changes.filter((v) => v.status === "fulfilled").length, 1);
    assert.equal(
      changes.filter((v) => v.status === "rejected" && v.reason.status === 409)
        .length,
      1,
    );
    const team = randomUUID();
    await f.db.query(
      "INSERT INTO workspaces(id,name,kind,owner_id) VALUES($1,'团队','team',$2)",
      [team, f.admin.id],
    );
    const publicId = Number(
      (await one(f.db, "SELECT public_id FROM workspaces WHERE id=$1", [team]))
        .public_id,
    );
    const switches = await Promise.allSettled(
      [false, true].map((enabled) =>
        f.db.transaction((sql) =>
          f.catalog.savePolicy(sql, {
            model: "test-family",
            group: true,
            enabled,
            workspace: publicId,
            expected_revision: 0,
          }),
        ),
      ),
    );
    assert.equal(switches.filter((v) => v.status === "fulfilled").length, 1);
    assert.equal((await f.catalog.teamPolicy(f.db, team)).revision, 1);
    assert.equal(
      (await f.catalog.teamPolicy(f.db, f.admin.workspaceId)).revision,
      0,
    );
  } finally {
    await f.cleanup();
  }
});
test("accepted tasks retain plugin, config and tier charge snapshots across explicit upgrades", async () => {
  const seen: Execution[] = [];
  const v1 = {
    ...mock,
    submit: async (e: Execution) => {
      seen.push(e);
      return { state: "completed" as const, artifacts: [], text: "before" };
    },
  };
  const v2 = structuredClone(mock.manifest);
  v2.version = "2.0.0";
  v2.models[0].studio!.prices[0].amount = 29;
  const next = {
    ...mock,
    manifest: v2,
    submit: async (e: Execution) => {
      seen.push(e);
      return { state: "completed" as const, artifacts: [], text: "after" };
    },
  };
  const f = await fixture([v1]);
  try {
    const c = await connect(f, v1),
      wid = f.admin.workspaceId;
    await assert.rejects(
      f.p.setModel(f.admin, c.model, { enabled: true, price: 99 }),
      { status: 409 },
    );
    const input = {
      modelId: c.model,
      key: randomUUID(),
      prompt: "first",
      params: { size: "large" },
      priceRevision: 1,
    };
    const job = await f.p.submit(f.admin, wid, input);
    const original = await one(f.db, "SELECT * FROM jobs WHERE id=$1", [
      job.id,
    ]);
    assert.equal(Number(original.price), 13);
    assert.equal(original.price_key, "catalog-test-model|large");
    assert.equal(original.price_revision, 1);
    await price(f, "catalog-test-model|large", 31);
    assert.deepEqual(await f.p.submit(f.admin, wid, input), job);
    await assert.rejects(
      f.p.submit(f.admin, wid, { ...input, key: randomUUID() }),
      { status: 409, message: "积分价格已更新，请确认新价格后重新提交" },
    );
    await switchModel(f, "catalog-test-model", false);
    assert.equal(await new Executor(f.p).claim(job.id), undefined);
    assert.deepEqual(await new Executor(f.p).queueReady(), []);
    await assert.rejects(
      f.p.submit(f.admin, wid, {
        ...input,
        key: randomUUID(),
        priceRevision: 2,
      }),
      { status: 403 },
    );
    await switchModel(f, "catalog-test-model", true);
    f.p.registry = new PluginRegistry([v1, next]);
    await f.p.registry.install(f.db, next.manifest);
    assert.equal(
      (await one(f.db, "SELECT plugin_version FROM studio_catalog"))
        .plugin_version,
      "1.0.0",
    );
    const operations = new Operations(f.p);
    await assert.rejects(
      operations.upgrade(f.admin, c.connection, {
        version: "2.0.0",
        revision: 2,
        config: { tag: "after" },
      }),
      { status: 409 },
    );
    await operations.upgrade(f.admin, c.connection, {
      version: "2.0.0",
      revision: 2,
      config: { tag: "after" },
      activateCatalog: true,
    });
    await f.p.updateConnection(f.admin, c.connection, {
      enabled: true,
      concurrency: 2,
      revision: 3,
    });
    const old = await one(f.db, "SELECT * FROM jobs WHERE id=$1", [job.id]);
    assert.equal(old.plugin_version, "1.0.0");
    assert.equal(Number(old.price), 13);
    assert.equal(f.p.vault.open(old.config_snapshot).tag, "before");
    await f.db.query(
      "INSERT INTO model_permissions(workspace_id,model_id,enabled) VALUES($1,$2,false)",
      [wid, c.model],
    );
    assert.deepEqual(await new Executor(f.p).queueReady(), []);
    assert.equal(await new Executor(f.p).claim(job.id), undefined);
    await f.db.query(
      "UPDATE model_permissions SET enabled=true WHERE workspace_id=$1 AND model_id=$2",
      [wid, c.model],
    );
    assert.deepEqual(await new Executor(f.p).queueReady(), [{ id: job.id }]);
    await new Executor(f.p).execute(job.id);
    assert.equal(
      (await one(f.db, "SELECT state FROM jobs WHERE id=$1", [job.id])).state,
      "completed",
    );
    assert.equal(seen[0].config.tag, "before");
    const current = await f.catalog.prices();
    const fresh = await f.p.submit(f.admin, wid, {
      ...input,
      key: randomUUID(),
      priceRevision: current.revision,
    });
    assert.equal(
      Number(
        (await one(f.db, "SELECT price FROM jobs WHERE id=$1", [fresh.id]))
          .price,
      ),
      31,
    );
    await new Executor(f.p).execute(fresh.id);
    assert.equal(seen[1].config.tag, "after");
    const wallet = await one(
      f.db,
      "SELECT * FROM wallets WHERE workspace_id=$1",
      [wid],
    );
    assert.equal(Number(wallet.balance), 956);
    assert.equal(Number(wallet.held), 0);
    await price(f, "catalog-test-model|small", null);
    await assert.rejects(
      f.p.submit(f.admin, wid, {
        modelId: c.model,
        key: randomUUID(),
        prompt: "unpriced",
      }),
      { status: 409, message: "这个档位尚未定价，请联系管理员" },
    );
  } finally {
    await f.cleanup();
  }
});
test("pull workers use the registered plugin version, tier prices and current team admission", async () => {
  const plugin = structuredClone(mock.manifest);
  plugin.id = "pull-fixture";
  plugin.mode = "pull";
  plugin.models[0].id = "pull-model";
  plugin.models[0].kind = "audio";
  plugin.models[0].studio!.descriptor.kind = "audio";
  const pull = { ...mock, manifest: plugin };
  const f = await fixture([pull]);
  try {
    const c = await connect(f, pull),
      g = new GpuGateway(f.p),
      wid = randomUUID();
    await f.db.query(
      "INSERT INTO workspaces(id,name,kind,owner_id) VALUES($1,'领取测试团队','team',$2)",
      [wid, f.admin.id],
    );
    await f.db.query("INSERT INTO wallets(workspace_id) VALUES($1)", [wid]);
    await f.db.transaction((sql) =>
      f.p.credit(sql, wid, 1000, randomUUID(), "adjust", {
        actorId: f.admin.id,
      }),
    );
    const teamId = Number(
      (await one(f.db, "SELECT public_id FROM workspaces WHERE id=$1", [wid]))
        .public_id,
    );
    const pair = await g.pair(f.admin, { connectionId: c.connection });
    const node = await g.enroll({
      code: pair.code,
      name: "isolated node",
      models: ["pull-model"],
    });
    const job = await f.p.submit(f.admin, wid, {
      modelId: c.model,
      key: randomUUID(),
      prompt: "queued",
    });
    await switchModel(f, "pull-model", false);
    assert.equal((await g.claim(node.token)).job, null);
    await switchModel(f, "pull-model", true);
    await f.db.transaction((sql) =>
      f.catalog.savePolicy(sql, {
        model: "pull-model",
        group: false,
        enabled: false,
        expected_revision: 0,
        workspace: teamId,
      }),
    );
    assert.equal((await g.claim(node.token)).job, null);
    assert.equal(
      (await f.catalog.effective(f.db, f.admin.workspaceId))["pull-model"],
      true,
    );
    await f.db.transaction((sql) =>
      f.catalog.savePolicy(sql, {
        model: "pull-model",
        group: false,
        enabled: true,
        expected_revision: 1,
        workspace: teamId,
      }),
    );
    const claimed = (await g.claim(node.token)).job!;
    assert.equal(claimed.id, job.id);
    assert.equal(claimed.pluginId, "pull-fixture");
    assert.equal(claimed.pluginVersion, "1.0.0");
    assert.equal(claimed.params.size, "small");
    assert.equal(
      Number(
        (await one(f.db, "SELECT price FROM jobs WHERE id=$1", [job.id])).price,
      ),
      7,
    );
    await switchModel(f, "pull-model", false);
    await price(f, "pull-model|small", 18);
    await g.fail(node.token, job.id, {
      lease: claimed.lease,
      error: "fixture failure",
    });
    const wallet = await one(
      f.db,
      "SELECT * FROM wallets WHERE workspace_id=$1",
      [wid],
    );
    assert.equal(Number(wallet.balance), 1000);
    assert.equal(Number(wallet.held), 0);
    const ledger = await one(
      f.db,
      "SELECT amount FROM ledger WHERE job_id=$1 AND action='refund'",
      [job.id],
    );
    assert.equal(Number(ledger.amount), 7);
  } finally {
    await f.cleanup();
  }
});

test("original GPU, Muse, image and Flow selections charge their plugin-defined tiers without provider calls", async () => {
  const f = await fixture();
  try {
    const wid = f.admin.workspaceId,
      connections = new Map<string, string>();
    for (const id of ["gpu", "muse", "compatible-images", "flow"]) {
      const plugin = await f.p.registry.resolve(f.db, id, "1.1.0");
      const c = await connect(
        f,
        plugin,
        id === "gpu"
          ? {}
          : {
              baseUrl: "https://fixture.invalid",
              apiKey: "fixture-not-a-real-key",
            },
      );
      connections.set(id, c.connection);
    }
    async function submit(
      provider: string,
      model: string,
      params: Record<string, unknown> = {},
    ) {
      const row = await one(
        f.db,
        "SELECT id FROM models WHERE connection_id=$1 AND provider_model=$2",
        [connections.get(provider), model],
      );
      const job = await f.p.submit(f.admin, wid, {
        modelId: row.id,
        key: randomUUID(),
        prompt: "isolated queue only",
        params,
      });
      return one(f.db, "SELECT * FROM jobs WHERE id=$1", [job.id]);
    }
    await assert.rejects(submit("gpu", "MiniMax H3"), { status: 409 });
    for (const [key, amount] of [
      ["MiniMax H3|768|15", 21],
      ["muse-video|6", 14],
      ["gpt-image-2.6-sunburst|1K|medium", 5],
      ["gpt-image-2.6-sunburst|2K|high", 17],
    ] as const)
      await price(f, key, amount);
    for (const [provider, model, params, key, amount] of [
      [
        "gpu",
        "MiniMax H3",
        { quality: 768, seconds: 15 },
        "MiniMax H3|768|15",
        21,
      ],
      ["muse", "muse-video", { seconds: 6 }, "muse-video|6", 14],
      [
        "compatible-images",
        "gpt-image-2.6-sunburst",
        {},
        "gpt-image-2.6-sunburst|1K|medium",
        5,
      ],
      [
        "compatible-images",
        "gpt-image-2.6-sunburst",
        { size: "2048x1152", quality: "high" },
        "gpt-image-2.6-sunburst|2K|high",
        17,
      ],
    ] as const) {
      const job = await submit(provider, model, params);
      assert.equal(job.price_key, key);
      assert.equal(Number(job.price), amount);
      assert.equal(job.plugin_version, "1.1.0");
    }
    const catalog = await f.catalog.catalog();
    const flow = Object.entries(catalog).find(
      ([id, v]) => id.startsWith("flow:") && !v.hidden && v.min_refs === 0,
    )![0];
    const flowJob = await submit("flow", flow);
    assert.equal(flowJob.price_key, flow + "|native");
    assert.equal(Number(flowJob.price), 1);
    const hidden = Object.entries(catalog).find(
      ([id, v]) => id.startsWith("flow:") && v.hidden && v.min_refs === 0,
    )![0];
    await assert.rejects(submit("flow", hidden), { status: 403 });
    const wallet = await one(
      f.db,
      "SELECT * FROM wallets WHERE workspace_id=$1",
      [wid],
    );
    assert.equal(Number(wallet.balance), 1000);
    assert.equal(Number(wallet.held), 58);
  } finally {
    await f.cleanup();
  }
});

