import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { databaseFixture } from "../helpers/database.js";
import {
  OriginalIdentity,
  type OriginalActor,
} from "../../packages/original-api/src/identity.js";
import { OriginalEstimates } from "../../packages/original-api/src/estimate.js";
import { OriginalGeneration } from "../../packages/original-api/src/generation.js";
import { PluginRegistry } from "../../packages/platform/src/plugins.js";
import { GpuGateway } from "../../packages/platform/src/gpu.js";
import { StudioCatalog } from "../../packages/platform/src/catalog.js";
import { one } from "../../packages/platform/src/db.js";
import { gpuEstimate } from "../../plugins/gpu/src/estimate.js";
import { imagesEstimate } from "../../plugins/images/src/estimate.js";
import { museEstimate } from "../../plugins/muse/src/estimate.js";
import { flowEstimate } from "../../plugins/flow/src/estimate.js";
import { timingFeaturesSchema } from "../../packages/plugin-sdk/src/index.js";

async function fixture() {
  const f = await databaseFixture();
  const identity = new OriginalIdentity(f.p);
  await identity.bootstrap({
    name: "estimate-admin",
    nickname: "估时",
    password: "isolated-estimate-password",
  });
  const actor = await identity.actor(
    await identity.login(
      { name: "estimate-admin", password: "isolated-estimate-password" },
      "fixture",
    ),
  );
  const plugins = [gpuEstimate, imagesEstimate, museEstimate, flowEstimate].map(
    (p) => ({ ...p, originalEstimate: { ...p.originalEstimate! } }),
  );
  f.p.registry = new PluginRegistry(plugins);
  await f.p.registry.installBuiltins(f.db);
  const estimates = new OriginalEstimates(f.p);
  const team = await one(f.db, "SELECT * FROM workspaces WHERE kind='team'");
  const snapshot = async () =>
    Object.fromEntries(
      await Promise.all(
        [
          "jobs",
          "wallets",
          "ledger",
          "outbox",
          "job_events",
          "job_runs",
          "storage_holds",
          "storage_capacity",
        ].map(async (table) => [
          table,
          (
            await f.db.query(
              `SELECT row_to_json(t) AS row FROM ${table} t ORDER BY row_to_json(t)::text`,
            )
          ).rows,
        ]),
      ),
    );
  return {
    ...f,
    identity,
    actor,
    plugins,
    estimates,
    team,
    snapshot,
    read: (body: unknown = {}, selected = String(team.public_id)) =>
      estimates.read(actor, body, selected),
  };
}

test("original estimates run without execution connections or credits and never persist hypothetical tasks", async () => {
  const f = await fixture();
  try {
    const before = await f.snapshot();
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        f.read(i % 2 ? { kind: "image", ratio: "21:9", resolution: "2K" } : {}),
      ),
    );
    assert.deepEqual(results[0], {
      duration: {
        source: "none",
        samples: 0,
        confidence: "none",
        reason: "no_instance",
        version: 4,
      },
      queue: { source: "none", reason: "waiting_gpu", ahead: 0 },
    });
    assert.equal(results[1].queue.high, 5);
    assert.equal(results[1].queue.ahead, 0);
    for (const body of [
      { kind: "audio" },
      { model: "absent" },
      { ratio: "auto" },
    ])
      await assert.rejects(f.read(body), { status: 400 });
    await assert.rejects(f.read({ refs: ["missing"] }), { status: 404 });
    await assert.rejects(f.read({}, "999999"), { status: 403 });
    assert.deepEqual(await f.snapshot(), before);
  } finally {
    await f.cleanup();
  }
});

test("original estimates include cross-workspace predecessors and real historical calibration without changing jobs or leases", async () => {
  const f = await fixture();
  try {
    const connection = await f.p.createConnection(f.actor, {
      name: "estimate GPU",
      pluginId: "gpu",
      version: gpuEstimate.manifest.version,
      config: {},
    });
    await f.p.updateConnection(f.actor, connection.id, {
      revision: 1,
      enabled: true,
      concurrency: 1,
    });
    const gateway = new GpuGateway(f.p),
      pairing = await gateway.pair(f.actor, { connectionId: connection.id });
    const node = await gateway.enroll({
      code: pairing.code,
      name: "fixture",
      models: ["MiniMax H3"],
    });
    await gateway.heartbeat(node.token, {
      context: {
        workflow: "h3-v6-native-inputs-turbo4",
        hardware: "estimate-hardware",
        runtime_id: "estimate-runtime",
      },
      queue: {
        stage: "ready",
        ready_models: ["MiniMax H3"],
        video_steps: [4, 16, 20, 32, 50],
        can_accept: true,
      },
    });
    const features = timingFeaturesSchema.parse(
      gpuEstimate.timingFeatures!({
        model: "MiniMax H3",
        kind: "video",
        input: {
          prompt: "",
          params: {
            ratio: "16:9",
            quality: 480,
            seconds: 5,
            sampling_steps: 20,
          },
          references: [],
        },
        node: {
          id: node.id,
          workflow: "h3-v6-native-inputs-turbo4",
          hardware: "estimate-hardware",
          runtime_id: "estimate-runtime",
        },
      }),
    );
    features.cold = false;
    for (let i = 0; i < 6; i++)
      await f.db.query(
        "INSERT INTO job_runs(run_key,attempt,node,plugin_id,plugin_version,policy,kind,model,features,created,started,finished,status,phase) VALUES($1,1,$2,'gpu',$3,$4,'video','MiniMax H3',$5,$6,$6,$7,'done','done')",
        [
          randomUUID(),
          node.id,
          gpuEstimate.manifest.version,
          JSON.stringify(gpuEstimate.manifest.timing),
          JSON.stringify(features),
          1000 + i * 100,
          1010 + i * 101,
        ],
      );
    const user = await f.db.transaction((sql) =>
      f.p.createUser(
        sql,
        "private-member",
        "私人",
        "isolated-member-password",
        "member",
      ),
    );
    const member = (await one(f.db, "SELECT * FROM users WHERE id=$1", [
      user.id,
    ])) as OriginalActor;
    const personal = await one(f.db, "SELECT * FROM workspaces WHERE id=$1", [
      user.workspaceId,
    ]);
    await f.db.transaction((sql) =>
      f.p.credit(sql, user.workspaceId, 100, randomUUID(), "adjust"),
    );
    const catalog = new StudioCatalog(f.db),
      prices = await catalog.prices();
    await f.db.transaction((sql) =>
      catalog.savePrices(
        sql,
        Object.fromEntries(prices.items.map((p) => [p.key, 1])),
        prices.revision,
      ),
    );
    const generation = new OriginalGeneration(f.p);
    const job = await generation.submit(
      member,
      await generation.parse("video", {
        uid: randomUUID(),
        prompt: "private-predecessor-do-not-reveal",
      }),
      String(personal.public_id),
    );
    const before = await f.snapshot();
    const result = await f.read();
    assert.equal(result.queue.ahead, 1);
    assert.equal(result.duration.source, "history");
    assert.equal(result.duration.samples, 6);
    assert.ok(result.duration.median > 0);
    assert.ok(result.queue.median > 0);
    assert.ok(!JSON.stringify(result).includes("private-predecessor"));
    assert.deepEqual(await f.snapshot(), before);
    const claimed = await gateway.claim(node.token);
    assert.ok(claimed.job);
    const leaseBefore = await f.snapshot();
    await f.read();
    assert.deepEqual(await f.snapshot(), leaseBefore);
    assert.equal(
      Number((await one(f.db, "SELECT public_id FROM jobs")).public_id),
      job.id,
    );
    await f.db.query(
      "UPDATE studio_policy SET flags=jsonb_set(flags,ARRAY['MiniMax H3'],'false'::jsonb)",
    );
    const paused = await f.read();
    assert.deepEqual(paused.queue, {
      source: "none",
      reason: "model_paused",
      ahead: 0,
    });
    assert.equal(paused.duration.reason, "uncalibrated_instance");
  } finally {
    await f.cleanup();
  }
});

test("original estimate capabilities are local and cannot return unauthorized inputs or ambiguous routing", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      f.p.registry.install(
        f.db,
        gpuEstimate.manifest,
        "https://plugin.invalid",
      ),
      { status: 400 },
    );
    const plugin = f.plugins.find((p) => p.manifest.id === "gpu")!,
      original = plugin.originalEstimate.prepare;
    plugin.originalEstimate.prepare = async (d, r) => ({
      ...(await original(d, r)),
      references: [randomUUID()],
    });
    const before = await f.snapshot();
    await assert.rejects(f.read(), {
      status: 500,
      message: "插件估时输入无效",
    });
    assert.deepEqual(await f.snapshot(), before);
    plugin.originalEstimate.prepare = original;
    for (let i = 0; i < 2; i++) {
      const c = await f.p.createConnection(f.actor, {
        name: "duplicate " + i,
        pluginId: "gpu",
        version: gpuEstimate.manifest.version,
        config: {},
      });
      await f.p.updateConnection(f.actor, c.id, {
        revision: 1,
        enabled: true,
        concurrency: 1,
      });
    }
    await assert.rejects(f.read(), {
      status: 503,
      message: "该模型配置了多个执行连接，请指定唯一原站连接",
    });
    assert.deepEqual(await f.snapshot(), before);
  } finally {
    await f.cleanup();
  }
});
