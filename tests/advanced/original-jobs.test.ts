import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { databaseFixture } from "../helpers/database.js";
import { one } from "@fumiao/platform/db.js";
import { PluginRegistry } from "@fumiao/platform/plugins.js";
import type { Actor } from "@fumiao/platform/platform.js";
import { GpuGateway } from "@fumiao/platform/gpu.js";
import { OriginalIdentity } from "@fumiao/original-api/identity.js";
import { OriginalJobs } from "@fumiao/original-api/jobs.js";
import { OriginalLibrary } from "@fumiao/original-api/library.js";
import { createOriginalApp } from "../../apps/api/src/original.js";
import { gpuTiming } from "@fumiao/plugin-gpu/timing.js";
import type { ProviderPlugin } from "@fumiao/plugin-sdk/index.js";

async function fixture() {
  const f = await databaseFixture(),
    identity = new OriginalIdentity(f.p);
  const password = "original-jobs-fixture-password";
  await identity.bootstrap({ name: "admin", nickname: "管理员", password });
  const token = await identity.login({ name: "admin", password }, "fixture");
  const admin = await identity.actor(token);
  const member = await f.db.transaction((sql) =>
    f.p.createUser(sql, "member", "成员", password, "member"),
  );
  const team = await one(f.db, "SELECT * FROM workspaces WHERE kind='team'");
  await f.db.query("INSERT INTO members(workspace_id,user_id) VALUES($1,$2)", [
    team.id,
    member.id,
  ]);
  const plugin: ProviderPlugin = {
    ...gpuTiming,
    manifest: {
      ...gpuTiming.manifest,
      id: "original-job-fixture",
      models: gpuTiming.manifest.models.map(({ studio, ...model }) => model),
    },
  };
  f.p.registry = new PluginRegistry([plugin]);
  await f.p.registry.installBuiltins(f.db);
  const c = await f.p.createConnection(admin, {
    name: "Fixture",
    pluginId: plugin.manifest.id,
    version: plugin.manifest.version,
    config: {},
  });
  await f.p.updateConnection(admin, c.id, {
    revision: 1,
    enabled: true,
    concurrency: 1,
  });
  const model = await one(
    f.db,
    "SELECT id FROM models WHERE connection_id=$1 AND provider_model='MiniMax H3'",
    [c.id],
  );
  await f.p.setModel(admin, model.id, { enabled: true, price: 3 });
  await f.db.transaction((sql) =>
    f.p.credit(sql, team.id, 30, randomUUID(), "adjust"),
  );
  const gateway = new GpuGateway(f.p);
  const pairing = await gateway.pair(admin, { connectionId: c.id });
  const node = await gateway.enroll({
    code: pairing.code,
    name: "fixture",
    models: ["MiniMax H3"],
  });
  const controls = new OriginalJobs(f.p);
  async function submit(owner: Actor = admin, references: string[] = []) {
    const result = await f.p.submit(owner, team.id, {
      modelId: model.id,
      key: randomUUID(),
      prompt: "fixture",
      references,
    });
    return one(f.db, "SELECT * FROM jobs WHERE id=$1", [result.id]);
  }
  return {
    ...f,
    identity,
    token,
    admin,
    member,
    team,
    gateway,
    node,
    controls,
    submit,
  };
}

test("original queued withdrawal checks workspace and ownership, then releases the hold and timing exactly once", async () => {
  const f = await fixture();
  try {
    const job = await f.submit();
    const number = Number(job.public_id),
      selected = String(f.team.public_id);
    await assert.rejects(f.controls.cancel(f.member, number, selected), {
      status: 403,
      message: "只能管理自己的版本",
    });
    const personal = await one(
      f.db,
      "SELECT public_id FROM workspaces WHERE owner_id=$1 AND kind='personal'",
      [f.admin.id],
    );
    await assert.rejects(
      f.controls.cancel(f.admin, number, String(personal.public_id)),
      { status: 404, message: "内容不存在或无权访问" },
    );
    await assert.rejects(f.controls.cancel(f.admin, 999999, "invalid"), {
      status: 404,
      message: "任务不存在",
    });
    assert.equal(Number((await f.p.wallet(f.admin, f.team.id)).held), 3);
    const outcomes = await Promise.allSettled([
      f.controls.cancel(f.admin, number, selected),
      f.controls.cancel(f.admin, number, selected),
    ]);
    assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
    const failure = outcomes.find(
      (r) => r.status === "rejected",
    ) as PromiseRejectedResult;
    assert.equal(failure.reason.status, 409);
    assert.equal(failure.reason.message, "只能撤回尚未开始的任务");
    const saved = await one(f.db, "SELECT * FROM jobs WHERE id=$1", [job.id]);
    assert.equal(saved.state, "cancelled");
    assert.equal(saved.error, null);
    assert.equal(saved.cancel_requested, false);
    const wallet = await f.p.wallet(f.admin, f.team.id);
    assert.equal(Number(wallet.balance), 30);
    assert.equal(Number(wallet.held), 0);
    const refund = (
      await f.db.query(
        "SELECT * FROM ledger WHERE job_id=$1 AND action='refund'",
        [job.id],
      )
    ).rows;
    assert.equal(refund.length, 1);
    assert.equal(Number(refund[0].amount), 3);
    const timing = await one(f.db, "SELECT * FROM job_runs WHERE job=$1", [
      job.id,
    ]);
    assert.equal(timing.status, "cancelled");
    assert.equal(timing.phase, "queued");
    assert.equal(timing.valid, false);
    assert.equal((await f.gateway.claim(f.node.token)).job, null);
    const owned = await f.submit(f.member);
    await f.db.query(
      "DELETE FROM members WHERE workspace_id=$1 AND user_id=$2",
      [f.team.id, f.member.id],
    );
    await assert.rejects(
      f.controls.cancel(f.member, Number(owned.public_id), selected),
      { status: 403, message: "无法访问这个工作区" },
    );
    assert.deepEqual(
      await f.controls.cancel(f.admin, Number(owned.public_id), selected),
      { ok: true },
    );
  } finally {
    await f.cleanup();
  }
});

test("original job deletion protects live references and removes private outputs while retaining billing", async () => {
  const f = await fixture();
  try {
    const job = await f.submit(),
      number = Number(job.public_id),
      selected = String(f.team.public_id);
    await assert.rejects(f.controls.remove(f.admin, number, selected), {
      status: 409,
      message: "请先撤回排队任务或等待运行结束",
    });
    const bytes = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#5030ab" },
    })
      .png()
      .toBuffer();
    const output = await f.p.upload(f.admin, f.team.id, bytes, "image/png");
    const asset = await one(f.db, "SELECT * FROM assets WHERE id=$1", [
      output.id,
    ]);
    await f.db.transaction(async (sql) => {
      const locked = await one(
        sql,
        "SELECT * FROM jobs WHERE id=$1 FOR UPDATE",
        [job.id],
      );
      await sql.query(
        "INSERT INTO job_assets(job_id,asset_id,role) VALUES($1,$2,'output')",
        [job.id, output.id],
      );
      await f.p.settle(sql, locked, "completed", { assets: [output.id] });
    });
    await assert.rejects(f.controls.remove(f.member, number, selected), {
      status: 403,
      message: "只能管理自己的版本",
    });
    const library = new OriginalLibrary(f.p);
    await library.changeFavorites(
      f.admin,
      { keys: ["job:" + number], favorite: true },
      selected,
    );
    await library.changeFavorites(
      f.member,
      { keys: ["job:" + number], favorite: true },
      selected,
    );
    const canvas = randomUUID();
    await f.p.saveDocument(f.admin, f.team.id, {
      id: canvas,
      kind: "canvas",
      title: "fixture",
      revision: 0,
      body: {},
      assets: [output.id],
    });
    await assert.rejects(f.controls.remove(f.admin, number, selected), {
      status: 409,
      message: "素材正在画布中使用，请先从相关画布移除",
    });
    await f.p.deleteDocument(f.admin, canvas);
    const reference = await f.submit(f.admin, [output.id]);
    await f.controls.cancel(f.admin, Number(reference.public_id), selected);
    await assert.rejects(f.controls.remove(f.admin, number, selected), {
      status: 409,
      message: "仍有作品或任务引用这张图片，请先删除相关版本",
    });
    assert.deepEqual(
      Buffer.from(await f.p.storage.read(asset.object_key)),
      bytes,
    );
    assert.equal(
      (await one(f.db, "SELECT deleted_at FROM jobs WHERE id=$1", [job.id]))
        .deleted_at,
      null,
    );
    assert.deepEqual(
      await f.controls.remove(f.admin, Number(reference.public_id), selected),
      { ok: true },
    );
    const results = await Promise.allSettled([
      f.controls.remove(f.admin, number, selected),
      f.controls.remove(f.admin, number, selected),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      (results.find((r) => r.status === "rejected") as PromiseRejectedResult)
        .reason.status,
      404,
    );
    await assert.rejects(f.p.storage.stat(asset.object_key));
    assert.equal(
      await one(f.db, "SELECT id FROM assets WHERE id=$1", [output.id]),
      undefined,
    );
    assert.equal((await f.db.query("SELECT * FROM job_assets")).rows.length, 0);
    assert.equal((await f.db.query("SELECT * FROM favorites")).rows.length, 0);
    assert.equal(
      Number(
        (
          await one(f.db, "SELECT storage_used FROM workspaces WHERE id=$1", [
            f.team.id,
          ])
        ).storage_used,
      ),
      0,
    );
    assert.equal(Number((await f.p.wallet(f.admin, f.team.id)).balance), 27);
    assert.equal(Number((await f.p.wallet(f.admin, f.team.id)).held), 0);
    assert.equal(
      (
        await f.db.query(
          "SELECT * FROM ledger WHERE job_id=$1 AND action='spend'",
          [job.id],
        )
      ).rows.length,
      1,
    );
    assert.ok(
      (await one(f.db, "SELECT * FROM jobs WHERE id=$1", [job.id])).deleted_at,
    );
  } finally {
    await f.cleanup();
  }
});

test("original withdrawal serializes with claim and never asks an already running provider to cancel", async () => {
  const f = await fixture();
  try {
    const job = await f.submit();
    const [withdrawal, claim] = await Promise.allSettled([
      f.controls.cancel(
        f.admin,
        Number(job.public_id),
        String(f.team.public_id),
      ),
      f.gateway.claim(f.node.token),
    ]);
    assert.equal(claim.status, "fulfilled");
    const saved = await one(f.db, "SELECT * FROM jobs WHERE id=$1", [job.id]);
    if (withdrawal.status === "fulfilled") {
      assert.equal(saved.state, "cancelled");
      assert.equal((claim as PromiseFulfilledResult<any>).value.job, null);
    } else {
      assert.equal(withdrawal.reason.status, 409);
      assert.equal(saved.state, "running");
      assert.equal((claim as PromiseFulfilledResult<any>).value.job.id, job.id);
    }
    assert.equal(saved.cancel_requested, false);
    // Always exercise the claimed path, independent of the race winner.
    if (saved.state === "running")
      await f.gateway.fail(f.node.token, job.id, {
        lease: saved.lease_token,
        error: "fixture",
      });
    const running = await f.submit();
    await f.gateway.claim(f.node.token);
    await assert.rejects(
      f.controls.cancel(
        f.admin,
        Number(running.public_id),
        String(f.team.public_id),
      ),
      { status: 409, message: "只能撤回尚未开始的任务" },
    );
    assert.equal(
      (
        await one(f.db, "SELECT cancel_requested FROM jobs WHERE id=$1", [
          running.id,
        ])
      ).cancel_requested,
      false,
    );
    assert.equal(Number((await f.p.wallet(f.admin, f.team.id)).held), 3);
  } finally {
    await f.cleanup();
  }
});

test("original withdrawal HTTP validates numeric paths before authentication and respects CSRF", async () => {
  const f = await fixture(),
    app = await createOriginalApp(f.p);
  try {
    await app.listen(0, "127.0.0.1");
    const url = await app.getUrl(),
      job = await f.submit();
    const send = (id: string, headers: Record<string, string> = {}) =>
      fetch(`${url}/api/jobs/${id}/cancel`, { method: "POST", headers });
    const malformed = await send("invalid");
    assert.equal(malformed.status, 422);
    assert.deepEqual((await malformed.json()).detail[0].loc, ["path", "i"]);
    const guest = await send(String(job.public_id));
    assert.equal(guest.status, 401);
    const rejected = await send(String(job.public_id), {
      cookie: "fm_session=" + f.token,
      origin: "https://untrusted.invalid",
    });
    assert.equal(rejected.status, 403);
    const result = await send(String(job.public_id), {
      cookie: "fm_session=" + f.token,
      origin: process.env.PUBLIC_URL || "http://localhost:3000",
      "X-Workspace-Id": String(f.team.public_id),
    });
    assert.equal(result.status, 200, await result.clone().text());
    assert.deepEqual(await result.json(), { ok: true });
  } finally {
    await app.close();
    await f.cleanup();
  }
});
