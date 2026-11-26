import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  museLifecycleFixture,
  museAck,
  museTaskId,
} from "../helpers/muse-lifecycle.js";
import { one } from "@fumiao/platform/db.js";
import { Executor } from "@fumiao/platform/executor.js";
import { JobTiming } from "@fumiao/platform/timing.js";
import { museLifecycle } from "@fumiao/plugin-muse/lifecycle.js";
import { museArtifacts } from "@fumiao/plugin-muse/artifacts.js";
import { museJson } from "@fumiao/plugin-muse/json.js";
import {
  ArtifactDownloadError,
  manifestSchema,
} from "@fumiao/plugin-sdk/index.js";
const row = (f: Awaited<ReturnType<typeof museLifecycleFixture>>, id: string) =>
  one(f.db, "SELECT * FROM jobs WHERE id=$1", [id]);

test("Muse admission retry is durable across queue wakeups, duplicate workers and connection configuration changes", async () => {
  const f = await museLifecycleFixture();
  try {
    const j = await f.create("muse-image");
    f.setWire({ status: 429 });
    await Promise.all([
      f.executor.execute(j.id),
      new Executor(f.p).execute(j.id),
    ]);
    const waiting = await row(f, j.id),
      delay = new Date(waiting.request_retry_at).getTime() - Date.now();
    assert.ok(delay > 55000 && delay <= 60000);
    assert.equal(waiting.attempts, 1);
    assert.equal(waiting.request_note, "等待 Muse 就绪");
    assert.equal(waiting.request_uncertain, false);
    assert.equal(
      (await new JobTiming(f.p).current(f.db, j.id))?.status,
      "interrupted",
    );
    assert.equal(Number((await f.p.wallet(f.admin, f.wid)).held), 2);
    await f.db.query(
      "UPDATE outbox SET available_at=now()-interval '1 minute' WHERE job_id=$1",
      [j.id],
    );
    assert.ok(!(await f.executor.queueReady()).some((x) => x.id === j.id));
    await f.executor.execute(j.id);
    assert.equal(f.requests.length, 1);
    // The frozen job config survives a connection edit; the local server still requires the old key.
    await f.p.updateConnection(f.admin, f.connection, {
      revision: 3,
      enabled: true,
      concurrency: 2,
      config: { baseUrl: "http://127.0.0.1:1", apiKey: "changed" },
    });
    await f.db.query(
      "UPDATE connections SET queue_health_revision=revision WHERE id=$1",
      [f.connection],
    );
    await f.db.query(
      "UPDATE jobs SET request_retry_at=now()-interval '1 second' WHERE id=$1",
      [j.id],
    );
    f.setWire({ body: museAck });
    await Promise.all([
      f.executor.execute(j.id),
      new Executor(f.p).execute(j.id),
    ]);
    const running = await row(f, j.id);
    assert.equal(running.remote_id, museTaskId);
    assert.equal(running.attempts, 2);
    assert.equal(running.request_retry_at, null);
    const posts = f.requests.filter((r) => r.method === "POST");
    assert.equal(posts.length, 2);
    assert.equal(posts[0].idempotency, j.id.replaceAll("-", ""));
    assert.equal(posts[1].idempotency, posts[0].idempotency);
    assert.ok(
      f.requests
        .filter((r) => r.method !== "POST")
        .every((r) => r.method === "GET" && r.path.endsWith("/" + museTaskId)),
    );
    assert.deepEqual(
      (
        await f.db.query(
          "SELECT status FROM job_runs WHERE job=$1 ORDER BY id",
          [j.id],
        )
      ).rows.map((x) => x.status),
      ["interrupted", "running"],
    );
  } finally {
    await f.cleanup();
  }
});

test("Muse polling preserves the acknowledged job, notes, timestamps, timing and held credit through outages", async () => {
  const f = await museLifecycleFixture();
  try {
    const j = await f.create("muse-image");
    await f.executor.execute(j.id);
    const initial = await row(f, j.id),
      initialRun = (await new JobTiming(f.p).current(f.db, j.id))!;
    // Acknowledged tasks no longer read references while polling or saving results.
    await f.db.query(
      "UPDATE jobs SET input=jsonb_set(input::jsonb,'{references}',$2::jsonb) WHERE id=$1",
      [j.id, JSON.stringify(["00000000-0000-4000-8000-000000000000"])],
    );
    for (const wire of [
      { status: 503 },
      { disconnect: true },
      { raw: "{invalid" },
      { body: { status: "unknown" } },
    ]) {
      f.setWire(wire);
      await f.executor.execute(j.id);
      const current = await row(f, j.id),
        run = (await new JobTiming(f.p).current(f.db, j.id))!;
      assert.equal(current.state, "running");
      assert.equal(current.request_note, "等待 Muse 空闲账号");
      assert.equal(
        +new Date(current.updated_at),
        +new Date(initial.updated_at),
      );
      assert.equal(current.attempts, 1);
      assert.equal(run.id, initialRun.id);
      assert.equal(run.status, "running");
    }
    f.setWire({ body: { status: "processing" } });
    await f.executor.execute(j.id);
    assert.equal((await row(f, j.id)).request_note, "Muse 生成中");
    assert.equal(
      (await new JobTiming(f.p).current(f.db, j.id))?.phase,
      "queued", // Original does not invent a start time when the provider omits it.
    );
    assert.equal(f.requests.filter((r) => r.method === "POST").length, 1);
    f.setWire({ status: 404 });
    await f.executor.execute(j.id);
    await f.executor.execute(j.id);
    await f.executor.recover();
    const failed = await row(f, j.id);
    assert.equal(failed.state, "failed");
    assert.equal(
      failed.error,
      "Muse 中的任务记录已不存在，结果未确认；请检查后再重新生成",
    );
    assert.equal(failed.request_note, null);
    assert.equal(failed.request_uncertain, false);
    assert.equal(Number((await f.p.wallet(f.admin, f.wid)).held), 0);
    assert.equal(Number((await f.p.wallet(f.admin, f.wid)).balance), 10000);
    assert.equal(
      Number(
        (
          await one(
            f.db,
            "SELECT count(*) AS n FROM ledger WHERE job_id=$1 AND action='refund'",
            [j.id],
          )
        ).n,
      ),
      1,
    );
  } finally {
    await f.cleanup();
  }
});

test("Muse lost acknowledgements fail once without replay; expired polling and download leases retain their runs", async () => {
  const f = await museLifecycleFixture();
  try {
    const lost = await f.create("muse-video"),
      claimed = (await f.executor.claim(lost.id))!;
    const execution = await f.executor.execution(
      claimed,
      new AbortController().signal,
    );
    await f.db.query(
      "UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
      [lost.id],
    );
    await f.executor.recover();
    await f.executor.recover();
    await f.executor.execute(lost.id);
    assert.equal((await row(f, lost.id)).state, "failed");
    assert.equal((await row(f, lost.id)).request_uncertain, true);
    assert.equal(
      (await new JobTiming(f.p).current(f.db, lost.id))?.status,
      "interrupted",
    );
    await assert.rejects(
      () => execution.reportProviderNote!("stale update"),
      /租约已失效/,
    );
    assert.equal(f.requests.length, 0);
    const j = await f.create("muse-image");
    await f.executor.execute(j.id);
    const run = (await new JobTiming(f.p).current(f.db, j.id))!;
    await f.executor.claim(j.id);
    await f.db.query(
      "UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
      [j.id],
    );
    await f.executor.recover();
    assert.equal((await row(f, j.id)).state, "running");
    assert.equal((await new JobTiming(f.p).current(f.db, j.id))?.id, run.id);
    assert.equal(
      (await new JobTiming(f.p).current(f.db, j.id))?.status,
      "running",
    );
    f.setWire({ body: { status: "completed", url: "/v1/media/result" } });
    await f.executor.execute(j.id);
    const receipt = (await row(f, j.id)).receipt;
    await f.executor.claim(j.id);
    await f.db.query(
      "UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
      [j.id],
    );
    await f.executor.recover();
    await f.executor.execute(j.id);
    assert.equal((await row(f, j.id)).state, "finalizing");
    assert.deepEqual((await row(f, j.id)).receipt, receipt);
    assert.equal(
      (await new JobTiming(f.p).current(f.db, j.id))?.status,
      "running",
    );
    assert.equal(f.requests.length, 2);
    assert.equal(f.downloads.length, 2);
  } finally {
    await f.cleanup();
  }
});

test("Muse worker maintenance respects disabled owners, health, global image control and poll continuity", async () => {
  const f = await museLifecycleFixture();
  try {
    const running = await f.create("muse-video");
    await f.executor.execute(running.id);
    const image = await f.create("muse-image");
    await f.db.query("UPDATE original_state_settings SET image_enabled=false");
    assert.ok(!(await f.executor.queueReady()).some((x) => x.id === image.id));
    await f.executor.execute(image.id);
    assert.equal((await row(f, image.id)).attempts, 0);
    await f.db.query("UPDATE connections SET queue_health='{}'");
    const before = await row(f, image.id);
    await f.executor.recover();
    assert.equal((await row(f, image.id)).request_note, "等待 Muse 就绪");
    assert.equal(
      +new Date((await row(f, image.id)).updated_at),
      +new Date(before.updated_at),
    );
    await f.db.query("UPDATE users SET active=false WHERE id=$1", [f.admin.id]);
    // Reading original state must not run request-worker cancellation.
    await f.db.transaction((sql) => f.executor.recoverOn(sql, true));
    assert.equal((await row(f, image.id)).state, "queued");
    await f.executor.recover();
    await f.executor.recover();
    assert.equal((await row(f, image.id)).state, "cancelled");
    assert.equal((await row(f, image.id)).error, "账户已停用");
    f.setWire({ body: { status: "processing" } });
    await f.executor.execute(running.id);
    assert.equal((await row(f, running.id)).state, "running");
    assert.equal((await row(f, running.id)).request_note, "Muse 生成中");
    assert.equal(
      Number(
        (
          await one(f.db, "SELECT held FROM wallets WHERE workspace_id=$1", [
            f.wid,
          ])
        ).held,
      ),
      2,
    );
  } finally {
    await f.cleanup();
  }
});

test("Muse completion saves only the first result, retries downloads without a new POST, and spends exactly once", async () => {
  const bytes = await sharp({
    create: { width: 12, height: 8, channels: 3, background: "blue" },
  })
    .png()
    .toBuffer();
  let downloads = 0;
  const urls: string[] = [];
  const f = await museLifecycleFixture({
    downloadArtifact: async (a) => {
      urls.push(a.url);
      if (++downloads === 1) throw new ArtifactDownloadError("outage", "retry");
      return bytes;
    },
  });
  try {
    const j = await f.create("muse-image");
    await f.executor.execute(j.id);
    f.setWire({
      body: {
        status: "success",
        data: [{ url: "/v1/media/first" }, { url: "/v1/media/second" }],
      },
    });
    await f.executor.execute(j.id);
    assert.equal((await row(f, j.id)).state, "finalizing");
    await f.executor.execute(j.id);
    await f.executor.execute(j.id);
    const result = await row(f, j.id);
    assert.equal(result.state, "completed");
    assert.equal(result.request_note, null);
    assert.equal(result.request_retry_at, null);
    assert.deepEqual(urls, ["/v1/media/first", "/v1/media/first"]);
    assert.equal(f.requests.length, 2);
    assert.equal(Number((await f.p.wallet(f.admin, f.wid)).balance), 9998);
    assert.equal(Number((await f.p.wallet(f.admin, f.wid)).held), 0);
    assert.equal(
      Number(
        (
          await one(
            f.db,
            "SELECT count(*) AS n FROM ledger WHERE job_id=$1 AND action='spend'",
            [j.id],
          )
        ).n,
      ),
      1,
    );
    assert.deepEqual(
      (
        await f.db.query(
          "SELECT original_kind,mime,metadata FROM assets WHERE workspace_id=$1",
          [f.wid],
        )
      ).rows.map((a) => [
        a.original_kind,
        a.mime,
        a.metadata.width,
        a.metadata.height,
      ]),
      [["ref", "image/png", 12, 8]],
    );
  } finally {
    await f.cleanup();
  }
});

test("Muse generic storage failure is terminal with the original note, refunds once and does not leak exception text", async () => {
  const f = await museLifecycleFixture({
    downloadArtifact: async () => {
      throw new Error("private-sentinel");
    },
  });
  try {
    const j = await f.create("muse-image");
    await f.executor.execute(j.id);
    f.setWire({ body: { status: "completed", url: "/v1/media/a" } });
    await f.executor.execute(j.id);
    await f.executor.execute(j.id);
    const failed = await row(f, j.id);
    assert.equal(failed.state, "failed");
    assert.equal(failed.error, "Muse 成品保存失败，请检查后重新生成");
    assert.ok(!JSON.stringify(failed).includes("private-sentinel"));
    assert.equal(Number((await f.p.wallet(f.admin, f.wid)).held), 0);
  } finally {
    await f.cleanup();
  }
});

test("Muse lifecycle is versioned and cannot be advertised by remote plugins or silently applied to old adapters", async () => {
  const f = await museLifecycleFixture();
  try {
    assert.equal(museArtifacts.manifest.version, "1.9.0");
    assert.equal(museArtifacts.manifest.requestLifecycle, undefined);
    assert.equal(museLifecycle.manifest.version, "1.10.0");
    assert.equal(museLifecycle.manifest.requestLifecycle?.version, 1);
    await assert.rejects(
      () =>
        f.p.registry.install(
          f.db,
          { ...museLifecycle.manifest, id: "remote-lifecycle" },
          "http://127.0.0.1:1",
        ),
      /本地适配器/,
    );
    assert.equal(
      manifestSchema.safeParse({
        ...museLifecycle.manifest,
        requestLifecycle: {
          ...museLifecycle.manifest.requestLifecycle,
          version: 2,
        },
      }).success,
      false,
    );
  } finally {
    await f.cleanup();
  }
});

test("Muse JSON decoding preserves Python constants and rejects invalid encodings and token injection", () => {
  const value = museJson(
    Buffer.from(
      '{"value":NaN,"pos":Infinity,"neg":-Infinity,"text":"NaN Infinity __muse_json_constant__","__proto__":{"polluted":true}}',
    ),
  );
  assert.ok(Number.isNaN(value.value));
  assert.equal(value.pos, Infinity);
  assert.equal(value.neg, -Infinity);
  assert.equal(value.text, "NaN Infinity __muse_json_constant__");
  assert.equal(({} as any).polluted, undefined);
  assert.equal(
    museJson(Buffer.from('{"a":"\\u005f_muse_json_constant__0","b":NaN}')).a,
    "__muse_json_constant__0",
  );
  assert.equal(museJson(Buffer.from([34, 237, 160, 128, 34])), "\ud800");
  for (const bytes of [
    Buffer.from("NaNInfinity"),
    Buffer.from("{NaN:1}"),
    Buffer.from('{"a": NaN; process.exit()}'),
    Buffer.from([34, 192, 128, 34]),
    Buffer.from([255, 254, 34]),
    Buffer.from([0, 0, 254, 255, 0, 17, 0, 0]),
  ])
    assert.throws(() => museJson(bytes));
});

test("Muse bounds JSON response bytes and never replays oversized or disconnected submissions", async () => {
  const f = await museLifecycleFixture();
  try {
    for (const wire of [
      { bytes: Buffer.alloc(2 * 1024 ** 2 + 1, 32) },
      { disconnect: true },
    ]) {
      const j = await f.create("muse-image");
      f.setWire(wire);
      const before = f.requests.length;
      await f.executor.execute(j.id);
      await f.executor.execute(j.id);
      await f.executor.recover();
      assert.equal((await row(f, j.id)).state, "failed");
      assert.equal((await row(f, j.id)).request_uncertain, true);
      assert.equal(f.requests.length, before + 1);
      assert.equal(Number((await f.p.wallet(f.admin, f.wid)).held), 0);
    }
    const j = await f.create("muse-image");
    f.setWire({ body: museAck });
    await f.executor.execute(j.id);
    f.setWire({ bytes: Buffer.alloc(2 * 1024 ** 2 + 1, 32) });
    await f.executor.execute(j.id);
    assert.equal((await row(f, j.id)).state, "running");
    assert.equal((await row(f, j.id)).attempts, 1);
    assert.equal(Number((await f.p.wallet(f.admin, f.wid)).held), 2);
  } finally {
    await f.cleanup();
  }
});
