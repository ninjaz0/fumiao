import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { databaseFixture } from "../helpers/database.js";
import { one } from "../../packages/platform/src/db.js";
import { PluginRegistry } from "../../packages/platform/src/plugins.js";
import { StudioCatalog } from "../../packages/platform/src/catalog.js";
import { Executor } from "../../packages/platform/src/executor.js";
import { GpuGateway } from "../../packages/platform/src/gpu.js";
import { OriginalState } from "../../packages/original-api/src/state.js";
import { OriginalGeneration } from "../../packages/original-api/src/generation.js";
import {
  OriginalIdentity,
  type OriginalActor,
} from "../../packages/original-api/src/identity.js";
import { OriginalSettings } from "../../packages/original-api/src/settings.js";
import { gpuState } from "../../plugins/gpu/src/state.js";
import { museState } from "../../plugins/muse/src/state.js";
import { museLifecycle } from "../../plugins/muse/src/lifecycle.js";
import { flowState } from "../../plugins/flow/src/state.js";
import { imagesState } from "../../plugins/images/src/state.js";
import { gpuEstimate } from "../../plugins/gpu/src/estimate.js";
import { imagesEstimate } from "../../plugins/images/src/estimate.js";
import {
  RequestLifecycleError,
  type ProviderPlugin,
} from "../../packages/plugin-sdk/src/index.js";
async function fixture(musePlugin: ProviderPlugin = museState) {
  const f = await databaseFixture(),
    identity = new OriginalIdentity(f.p),
    password = "state-only-test-password";
  await identity.bootstrap({ name: "admin", nickname: "管理员", password });
  const admin = await identity.actor(
    await identity.login({ name: "admin", password }, "fixture"),
  );
  const plugins = [gpuState, musePlugin, flowState, imagesState].map((p) => ({
    ...p,
    originalState: { ...p.originalState! },
  }));
  f.p.registry = new PluginRegistry([...plugins, gpuEstimate, imagesEstimate]);
  await f.p.registry.installBuiltins(f.db);
  const catalog = new StudioCatalog(f.db);
  for (const p of plugins)
    await f.db.transaction((sql) => catalog.activate(sql, p.manifest));
  const connections: Record<string, string> = {};
  for (const p of plugins) {
    const c = await f.p.createConnection(admin, {
      name: p.manifest.id,
      pluginId: p.manifest.id,
      version: p.manifest.version,
      config:
        p.manifest.mode === "pull"
          ? {}
          : { baseUrl: "http://127.0.0.1:9", apiKey: "sk-state-fixture" },
    });
    connections[p.manifest.id] = c.id;
    await f.p.updateConnection(admin, c.id, {
      revision: 1,
      enabled: true,
      concurrency: 1,
    });
  }
  await f.db.query("UPDATE studio_prices SET amount=1");
  await f.db.query("UPDATE wallets SET balance=1000");
  const team = await one(f.db, "SELECT * FROM workspaces WHERE kind='team'");
  const generation = new OriginalGeneration(f.p),
    state = new OriginalState(f.p);
  async function submit(
    kind: "video" | "image" | "audio" = "video",
    fields: Record<string, unknown> = {},
  ) {
    const task = await generation.submit(
      admin,
      await generation.parse(kind, {
        uid: randomUUID(),
        prompt: "fixture",
        seed: 42,
        ...fields,
      }),
      String(team.public_id),
    );
    return one(f.db, "SELECT * FROM jobs WHERE public_id=$1", [task.id]);
  }
  return {
    ...f,
    admin,
    identity,
    plugins,
    connections,
    catalog,
    team,
    state,
    submit,
    read: () => state.read(admin, String(team.public_id)),
  };
}

test("completed provider text with NUL remains readable through full state and canvas runs", async () => {
  const png = await sharp({
    create: { width: 16, height: 20, channels: 3, background: "blue" },
  })
    .png()
    .toBuffer();
  const text = "provider\0中文😀\\u0000";
  const f = await fixture({
    ...museState,
    requestCapacity: () => null,
    submit: async () => ({
      state: "completed",
      artifacts: [{ url: "data:image/png;base64," + png.toString("base64") }],
      text,
      usage: { detail: text },
    }),
  });
  try {
    const job = await f.submit("image", { model: "muse-image", prompt: text });
    await new Executor(f.p).execute(job.id);
    const completed = await one(
      f.db,
      "SELECT state,result FROM jobs WHERE id=$1",
      [job.id],
    );
    assert.equal(completed.state, "completed");
    assert.equal(completed.result.text, text);
    assert.equal(completed.result.usage.detail, text);
    const asset = await one(f.db, "SELECT public_id FROM assets WHERE id=$1", [
      completed.result.assets[0],
    ]);
    const visible = (await f.read()).jobs.find(
      (j: any) => j.id === Number(job.public_id),
    );
    assert.equal(visible.prompt, text);
    assert.equal(visible.result, asset.public_id);
    const canvas = await f.db.transaction((sql) =>
      f.state.canvasJobs(sql, f.team.id),
    );
    assert.equal(
      canvas.find((j) => j.id === Number(job.public_id))!.result,
      asset.public_id,
    );
    // A result in a different workspace must not break the global forecast read.
    const own = await f.state.read(f.admin);
    assert.equal(
      own.jobs.some((j: any) => j.id === Number(job.public_id)),
      false,
    );
  } finally {
    await f.cleanup();
  }
});

test("original state exposes durable plugin notes without leaking lifecycle internals or overriding model pause", async () => {
  const f = await fixture({
    ...museLifecycle,
    requestCapacity: () => null,
    submit: async () => {
      throw new RequestLifecycleError({
        action: "retry",
        note: "等待 Muse 就绪",
        delaySeconds: 60,
      });
    },
    inspect: async () => {
      throw new RequestLifecycleError({
        action: "fail",
        note: "Muse 中的任务记录已不存在，结果未确认；请检查后再重新生成",
      });
    },
  });
  try {
    const job = await f.submit("image", { model: "muse-image" });
    const executor = new Executor(f.p);
    await executor.execute(job.id);
    let view = (await f.read()).jobs.find(
      (j: any) => j.id === Number(job.public_id),
    );
    assert.equal(view.note, "等待 Muse 就绪");
    assert.equal(view.status, "queued");
    for (const key of [
      "request_note",
      "request_retry_at",
      "request_uncertain",
      "lease_token",
      "config_snapshot",
    ])
      assert.equal(Object.hasOwn(view, key), false);
    await f.db.query(
      "UPDATE studio_policy SET flags=jsonb_set(flags,'{muse-image}','false')",
    );
    view = (await f.read()).jobs.find(
      (j: any) => j.id === Number(job.public_id),
    );
    assert.equal(view.note, "等待模型开放");
    await f.db.query(
      "UPDATE jobs SET state='running',remote_id='task_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',request_retry_at=NULL WHERE id=$1",
      [job.id],
    );
    await executor.execute(job.id);
    view = (await f.read()).jobs.find(
      (j: any) => j.id === Number(job.public_id),
    );
    assert.equal(view.status, "failed");
    assert.equal(
      view.note,
      "Muse 中的任务记录已不存在，结果未确认；请检查后再重新生成",
    );
  } finally {
    await f.cleanup();
  }
});

test("full state keeps identity, plugin privacy, global model flags and administrator-only fields together", async () => {
  const f = await fixture();
  try {
    const member = await f.db.transaction((sql) =>
      f.p.createUser(sql, "member", "成员", "state-test-password", "member"),
    );
    const actor = (await one(f.db, "SELECT * FROM users WHERE id=$1", [
      member.id,
    ])) as OriginalActor;
    await f.db.query(
      "INSERT INTO members(workspace_id,user_id) VALUES($1,$2)",
      [f.team.id, member.id],
    );
    const admin = await f.read(),
      own = await f.state.read(actor, String(f.team.public_id));
    assert.equal(admin.legacy_workspace_id, Number(f.team.public_id));
    assert.equal(own.avatars.length, 12);
    for (const key of [
      "used",
      "reserved",
      "quota",
      "disk_free",
      "users",
      "invite_codes",
      "team_model_policies",
      "credit_accounts",
    ]) {
      assert.ok(Object.hasOwn(admin, key), key);
      assert.ok(!Object.hasOwn(own, key), key);
    }
    assert.ok(
      admin.images.configured && admin.muse.configured && admin.flow.configured,
    );
    assert.ok(!JSON.stringify(admin).includes("sk-state-fixture"));
    assert.ok(!JSON.stringify(own).includes("sk-state-fixture"));
    const personal = await one(
      f.db,
      "SELECT public_id FROM workspaces WHERE id=$1",
      [member.workspaceId],
    );
    await assert.rejects(f.state.read(f.admin, String(personal.public_id)), {
      status: 403,
    });
    for (const [id, spec] of Object.entries(admin.model_catalog) as [
      string,
      any,
    ][]) {
      if (spec.kind !== "image" || spec.hidden) continue;
      const policy = await f.catalog.policy();
      await new OriginalSettings(f.p).models(f.admin, {
        model: id,
        enabled: false,
        expected_revision: policy.revision,
      });
    }
    assert.equal((await f.read()).images.enabled, false);
    await f.db.query("UPDATE users SET active=false WHERE id=$1", [actor.id]);
    await assert.rejects(f.state.read(actor, String(f.team.public_id)), {
      status: 401,
    });
  } finally {
    await f.cleanup();
  }
});

test("new GPU state version retries one interrupted attempt then refunds once and rejects stale leases", async () => {
  const f = await fixture();
  try {
    const job = await f.submit(),
      gateway = new GpuGateway(f.p),
      pair = await gateway.pair(f.admin, { connectionId: f.connections.gpu });
    const node = await gateway.enroll({
      code: pair.code,
      name: "fixture-node",
      models: ["MiniMax H3"],
    });
    await gateway.heartbeat(node.token, {
      context: {
        workflow: "h3-v6-native-inputs-turbo4",
        hardware: "fixture",
        runtime_id: "fixture",
      },
      queue: {
        stage: "ready",
        ready_models: ["MiniMax H3"],
        video_steps: [4, 20],
        can_accept: true,
      },
    });
    const first = (await gateway.claim(node.token)).job!;
    assert.equal(first.id, job.id);
    await f.db.query(
      "UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
      [job.id],
    );
    let state = await f.read();
    let task = state.jobs.find((j: any) => j.id === Number(job.public_id));
    assert.equal(task.status, "queued");
    assert.equal(task.attempts, 1);
    assert.equal(task.note, "实例离线，等待重新接单");
    assert.equal(state.credits.reserved, 1);
    await assert.rejects(
      gateway.heartbeat(node.token, { jobId: job.id, lease: first.lease }),
      { status: 409 },
    );
    const second = (await gateway.claim(node.token)).job!;
    assert.notEqual(second.lease, first.lease);
    assert.equal(
      (await f.read()).jobs.find((j: any) => j.id === Number(job.public_id))
        .note,
      "",
    );
    await f.db.query("UPDATE gpu_nodes SET control='draining' WHERE id=$1", [
      node.id,
    ]);
    await f.db.query(
      "UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
      [job.id],
    );
    await Promise.all([f.read(), f.read(), new Executor(f.p).recover()]);
    state = await f.read();
    task = state.jobs.find((j: any) => j.id === Number(job.public_id));
    assert.equal(task.status, "failed");
    assert.equal(task.attempts, 2);
    assert.equal(task.note, "实例连续中断，请重新生成");
    assert.equal(state.credits.reserved, 0);
    assert.equal(state.credits.balance, 1000);
    assert.equal(state.nodes[0].control, "paused");
    assert.equal(
      (
        await f.db.query(
          "SELECT * FROM ledger WHERE job_id=$1 AND action='refund'",
          [job.id],
        )
      ).rows.length,
      1,
    );
    assert.deepEqual(
      (
        await f.db.query(
          "SELECT status FROM job_runs WHERE job=$1 ORDER BY id",
          [job.id],
        )
      ).rows.map((r) => r.status),
      ["interrupted", "interrupted"],
    );
    const old = await f.submit();
    await f.db.query(
      "UPDATE jobs SET plugin_version='1.7.0',state='running',attempts=1,lease_until=now()-interval '1 second',remote_id=$2 WHERE id=$1",
      [old.id, node.id],
    );
    await f.read();
    assert.equal(
      (await one(f.db, "SELECT state FROM jobs WHERE id=$1", [old.id])).state,
      "running",
    );
    await new Executor(f.p).recover();
    assert.equal(
      (await one(f.db, "SELECT state FROM jobs WHERE id=$1", [old.id])).state,
      "uncertain",
    );
  } finally {
    await f.cleanup();
  }
});

test("state-enabled image results enter original references without changing older plugin output roles", async () => {
  const f = await fixture();
  try {
    const png = await sharp({
      create: { width: 16, height: 24, channels: 3, background: "blue" },
    })
      .png()
      .toBuffer();
    const image = f.plugins.find((p) => p.manifest.id === "compatible-images")!;
    image.submit = async () => ({
      state: "completed",
      artifacts: [{ url: "data:image/png;base64," + png.toString("base64") }],
      usage: { hiddenInternal: "not-a-public-field" },
    });
    const job = await f.submit("image");
    await new Executor(f.p).execute(job.id);
    const state = await f.read(),
      task = state.jobs.find((j: any) => j.id === Number(job.public_id));
    assert.equal(task.status, "done");
    assert.equal(task.width, 16);
    assert.equal(task.height, 24);
    assert.deepEqual(task.actual, {});
    assert.equal(
      state.assets.find((a: any) => a.id === task.result).kind,
      "ref",
    );
    assert.ok(!JSON.stringify(task).includes("hiddenInternal"));
    const oldPlugin = { ...imagesEstimate, submit: image.submit };
    f.p.registry = new PluginRegistry([...f.plugins, gpuEstimate, oldPlugin]);
    const old = await f.submit("image");
    await f.db.query("UPDATE jobs SET plugin_version='1.5.0' WHERE id=$1", [
      old.id,
    ]);
    await new Executor(f.p).execute(old.id);
    const saved = await one(
      f.db,
      "SELECT a.* FROM assets a JOIN job_assets r ON r.asset_id=a.id WHERE r.job_id=$1 AND r.role='output'",
      [old.id],
    );
    assert.equal(saved.original_kind, "image");
  } finally {
    await f.cleanup();
  }
});

test("state capability rejects remote manifests, ambiguous connections and malformed public projections", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      f.p.registry.install(
        f.db,
        { ...museState.manifest, id: "external-state" },
        "http://127.0.0.1:9",
      ),
      { status: 400 },
    );
    const image = f.plugins.find((p) => p.manifest.id === "compatible-images")!;
    const original = image.originalState!.configuration;
    image.originalState!.configuration = () => ({
      images: { configured: true, apiKey: "forbidden" },
    });
    await assert.rejects(f.read(), { status: 503 });
    image.originalState!.configuration = original;
    await f.p.createConnection(f.admin, {
      name: "ambiguous",
      pluginId: image.manifest.id,
      version: image.manifest.version,
      config: { baseUrl: "http://127.0.0.1:9", apiKey: "sk-unused" },
    });
    await assert.rejects(f.read(), {
      status: 503,
      message: "原状态提供方连接存在歧义",
    });
    assert.equal((await f.db.query("SELECT * FROM jobs")).rows.length, 0);
  } finally {
    await f.cleanup();
  }
});
