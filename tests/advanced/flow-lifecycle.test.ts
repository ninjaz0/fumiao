import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  flowLifecycleFixture,
  flowImage,
  flowVideo,
  flowSuccess,
} from "../helpers/flow-lifecycle.js";
import { one } from "@fumiao/platform/db.js";
import { Executor } from "@fumiao/platform/executor.js";
import { JobTiming } from "@fumiao/platform/timing.js";
import { QueueHealthPoller } from "@fumiao/platform/queue-health.js";
import { flowLifecycle, flowStream } from "@fumiao/plugin-flow/lifecycle.js";
import { flowArtifacts } from "@fumiao/plugin-flow/artifacts.js";
import { ArtifactValidationError } from "@fumiao/plugin-sdk/index.js";
const row = (f: Awaited<ReturnType<typeof flowLifecycleFixture>>, id: string) =>
  one(f.db, "SELECT * FROM jobs WHERE id=$1", [id]);

test("Flow serial FIFO admission ignores the global image flag and preserves its original no-note health wait", async () => {
  const f = await flowLifecycleFixture();
  try {
    const first = await f.create(flowImage),
      second = await f.create(flowVideo);
    await f.db.query("UPDATE original_state_settings SET image_enabled=false");
    assert.equal(await f.executor.claim(second.id), undefined);
    const claimed = await f.executor.claim(first.id);
    assert.ok(claimed);
    assert.equal(await f.executor.claim(second.id), undefined);
    assert.equal((await row(f, first.id)).request_note, "Flow 正在生成");
    await f.db.query(
      "UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
      [first.id],
    );
    await f.executor.recover();
    await f.executor.recover();
    await f.executor.execute(first.id);
    const failed = await row(f, first.id);
    assert.equal(failed.state, "failed");
    assert.equal(failed.request_uncertain, true);
    assert.equal(
      failed.error,
      "服务重启，Flow 生成结果未确认；请核对后台记录后再重新生成",
    );
    assert.equal(
      (await new JobTiming(f.p).current(f.db, first.id))?.status,
      "interrupted",
    );
    assert.equal(f.requests.length, 0);
    await f.db.query("UPDATE connections SET queue_health='{}'");
    await f.executor.recover();
    assert.equal((await row(f, second.id)).request_note, null);
    assert.equal(await f.executor.claim(second.id), undefined);
    await f.db.query(
      "UPDATE connections SET queue_health=$2,queue_health_revision=revision WHERE id=$1",
      [
        f.connection,
        JSON.stringify({ ready: true, checked: Date.now() / 1000 }),
      ],
    );
    await Promise.all([
      f.executor.execute(second.id),
      new Executor(f.p).execute(second.id),
    ]);
    assert.equal((await row(f, second.id)).state, "completed");
    assert.equal(f.requests.length, 1);
    assert.equal(Number((await f.p.wallet(f.admin, f.wid)).balance), 9998);
    assert.equal(Number((await f.p.wallet(f.admin, f.wid)).held), 0);
  } finally {
    await f.cleanup();
  }
});

test("Flow progress updates health and timestamp only for its current lease and frozen connection configuration", async () => {
  let probes = 0;
  const f = await flowLifecycleFixture({
    queueHealth: async () => {
      probes++;
      return { ready: false };
    },
  });
  try {
    const j = await f.create(flowVideo),
      claimed = (await f.executor.claim(j.id))!,
      e = await f.executor.execution(claimed, new AbortController().signal);
    await f.db.query(
      "UPDATE jobs SET updated_at=now()-interval '1 minute' WHERE id=$1",
      [j.id],
    );
    const stale = randomUUID();
    await f.db.query(
      "UPDATE connections SET queue_health='{}',queue_refresh_token=$2 WHERE id=$1",
      [f.connection, stale],
    );
    await e.reportProviderNote!("Flow 正在生成");
    const c = await one(f.db, "SELECT * FROM connections WHERE id=$1", [
      f.connection,
    ]);
    assert.equal(c.queue_health.ready, true);
    assert.equal(c.queue_refresh_token, null);
    assert.ok(Date.now() - +new Date((await row(f, j.id)).updated_at) < 5000);
    await f.db.query(
      "UPDATE connections SET queue_refresh_until=NULL WHERE id=$1",
      [f.connection],
    );
    await new QueueHealthPoller(f.p).refresh(f.connection);
    assert.equal(probes, 0);
    await f.p.updateConnection(f.admin, f.connection, {
      revision: 3,
      enabled: true,
      concurrency: 5,
      config: { ...f.config, apiKey: "changed" },
    });
    await e.reportProviderNote!("Flow 正在生成");
    const changed = await one(f.db, "SELECT * FROM connections WHERE id=$1", [
      f.connection,
    ]);
    assert.notEqual(changed.queue_health_revision, changed.revision);
    await f.db.query(
      "UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
      [j.id],
    );
    await f.executor.recover();
    await assert.rejects(
      () => e.reportProviderNote!("stale callback"),
      /租约已失效/,
    );
    assert.equal((await row(f, j.id)).state, "failed");
  } finally {
    await f.cleanup();
  }
});

test("Flow keeps a completed receipt across worker interruption and defers queued cancellation until saving finishes", async () => {
  let validations = 0;
  const f = await flowLifecycleFixture({
    validateArtifact: async () => {
      if (++validations === 1) throw new ArtifactValidationError("busy", 503);
      return { metadata: { mime: "image/png", width: 8, height: 6 } };
    },
  });
  try {
    const j = await f.create(flowImage);
    await f.executor.execute(j.id);
    assert.equal((await row(f, j.id)).state, "finalizing");
    const queued = await f.create(flowVideo);
    await f.db.query("UPDATE users SET active=false WHERE id=$1", [f.admin.id]);
    const before = (await new JobTiming(f.p).current(f.db, j.id))!;
    await f.executor.claim(j.id);
    await f.db.query(
      "UPDATE jobs SET lease_until=now()-interval '1 second',input=jsonb_set(input::jsonb,'{references}',$2::jsonb) WHERE id=$1",
      [j.id, JSON.stringify([randomUUID()])],
    );
    await f.executor.recover();
    assert.equal((await row(f, queued.id)).state, "queued");
    assert.equal((await new JobTiming(f.p).current(f.db, j.id))?.id, before.id);
    await f.executor.execute(j.id);
    assert.equal((await row(f, j.id)).state, "completed");
    assert.equal(f.requests.length, 1);
    assert.equal(f.downloads.length, 2);
    await f.executor.recover();
    assert.equal((await row(f, queued.id)).state, "cancelled");
    assert.equal((await row(f, queued.id)).error, "账户已停用");
    assert.equal(await new JobTiming(f.p).current(f.db, queued.id), undefined);
    assert.deepEqual(
      (
        await f.db.query(
          "SELECT action,amount FROM ledger WHERE job_id=$1 ORDER BY created_at",
          [j.id],
        )
      ).rows.map((x) => [x.action, Number(x.amount)]),
      [
        ["hold", 2],
        ["spend", 2],
      ],
    );
  } finally {
    await f.cleanup();
  }
});

test("Flow separates missing reference, storage failure, stream failure and recovered-save failure without repeating generation", async () => {
  const f = await flowLifecycleFixture();
  try {
    const missing = await f.create(flowImage);
    await f.db.query(
      "UPDATE jobs SET input=jsonb_set(input::jsonb,'{references}',$2::jsonb) WHERE id=$1",
      [missing.id, JSON.stringify([randomUUID()])],
    );
    await f.executor.execute(missing.id);
    assert.equal(
      (await row(f, missing.id)).error,
      "参考图片已不存在，请重新选择",
    );
    assert.equal(f.requests.length, 0);
    const ref = await f.reference(),
      asset = await one(f.db, "SELECT * FROM assets WHERE id=$1", [ref]);
    await f.p.storage.remove(asset.object_key);
    const broken = await f.create(flowImage);
    await f.db.query(
      "UPDATE jobs SET input=jsonb_set(input::jsonb,'{references}',$2::jsonb) WHERE id=$1",
      [broken.id, JSON.stringify([ref])],
    );
    await f.executor.execute(broken.id);
    assert.equal(
      (await row(f, broken.id)).error,
      "Flow 生成或保存失败，请从后台检查结果后重试",
    );
    f.setWire({ disconnect: true });
    const disconnected = await f.create(flowVideo);
    await f.executor.execute(disconnected.id);
    await f.executor.execute(disconnected.id);
    assert.equal(
      (await row(f, disconnected.id)).error,
      "与 Flow 的连接中断，生成结果未确认；请核对后台记录后再重新生成",
    );
    assert.equal((await row(f, disconnected.id)).request_uncertain, false);
    assert.equal(
      (await new JobTiming(f.p).current(f.db, disconnected.id))?.status,
      "failed",
    );
    const recovered = await f.create(flowImage);
    await f.executor.claim(recovered.id);
    await f.db.query(
      "UPDATE jobs SET state='finalizing',receipt=$2,lease_until=now()-interval '1 second' WHERE id=$1",
      [
        recovered.id,
        JSON.stringify({
          state: "completed",
          artifacts: [{ url: "https://public.example/flow/tmp/a" }],
        }),
      ],
    );
    f.setWire({ downloadError: true });
    await f.executor.recover();
    await f.executor.execute(recovered.id);
    assert.equal(
      (await row(f, recovered.id)).error,
      "Flow 成品保存失败，请从后台检查生成结果",
    );
    assert.equal(f.requests.length, 1);
    assert.equal(Number((await f.p.wallet(f.admin, f.wid)).held), 0);
    assert.equal(Number((await f.p.wallet(f.admin, f.wid)).balance), 10000);
  } finally {
    await f.cleanup();
  }
});

test("Flow stream stops at DONE, bounds progress callbacks and does not promote diagnostics into artifacts", async () => {
  let notes = 0,
    reads = 0,
    stamp = 100;
  async function* body() {
    for (const raw of [
      flowSuccess.split("\n")[0] + "\n",
      "data: {}\n",
      "data: {}\n",
      "data: [DONE]\n",
      'data: {"error":"captcha"}\n',
    ]) {
      reads++;
      if (reads === 2) stamp = 108;
      if (reads === 3) stamp = 108.001;
      yield Buffer.from(raw);
    }
  }
  const receipt = await flowStream(
    body(),
    {
      kind: "image",
      reportProviderNote: async (note) => {
        assert.equal(note, "Flow 正在生成");
        notes++;
      },
    },
    () => stamp,
  );
  assert.equal(receipt.state, "completed");
  assert.equal(reads, 4);
  assert.equal(notes, 2);
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(
        Buffer.from(
          'data: {"choices":[{"delta":{"reasoning_content":"quota https://private.example/sentinel"}}]}\n',
        ),
      );
      c.close();
    },
  });
  await assert.rejects(
    () => flowStream(stream, { kind: "image" }),
    /Flow 账号额度不足/,
  );
});

test("Flow readiness follows original truthiness and lifecycle installation keeps old and remote adapters isolated", async () => {
  const f = await flowLifecycleFixture();
  try {
    for (const [data, backend, tokens, ready] of [
      [{}, true, true, false],
      [{ id: 1 }, 1, "yes", true],
      [[1], [], true, false],
      [[1], true, {}, false],
      [[1], true, [1], true],
    ]) {
      f.setHealth(
        { data },
        { backend_running: backend, has_active_tokens: tokens },
      );
      assert.deepEqual(
        await flowLifecycle.queueHealth!(
          f.config,
          new AbortController().signal,
        ),
        { ready },
      );
    }
    assert.equal(flowArtifacts.manifest.requestLifecycle, undefined);
    assert.equal(flowLifecycle.manifest.version, "1.9.0");
    await assert.rejects(
      () =>
        f.p.registry.install(
          f.db,
          { ...flowLifecycle.manifest, id: "remote-flow" },
          "http://127.0.0.1:1",
        ),
      /本地适配器/,
    );
  } finally {
    await f.cleanup();
  }
});

test("Flow live progress wins over a health probe started before the request was claimed", async () => {
  let started!: () => void, finish!: (value: { ready: boolean }) => void;
  const probing = new Promise<void>((resolve) => {
    started = resolve;
  });
  const result = new Promise<{ ready: boolean }>((resolve) => {
    finish = resolve;
  });
  const f = await flowLifecycleFixture({
    queueHealth: async () => {
      started();
      return result;
    },
  });
  try {
    const j = await f.create(flowVideo),
      refresh = new QueueHealthPoller(f.p).refresh(f.connection);
    await probing;
    const claimed = (await f.executor.claim(j.id))!,
      execution = await f.executor.execution(
        claimed,
        new AbortController().signal,
      );
    await execution.reportProviderNote!("Flow 正在生成");
    finish({ ready: false });
    await refresh;
    const c = await one(f.db, "SELECT * FROM connections WHERE id=$1", [
      f.connection,
    ]);
    assert.equal(c.queue_health.ready, true);
    assert.equal(c.queue_health_revision, c.revision);
    assert.equal(c.queue_refresh_token, null);
  } finally {
    finish({ ready: false });
    await f.cleanup();
  }
});

test("Flow stream, authenticated cache download, real image validation and private saving complete on the same plugin version", async () => {
  const f = await flowLifecycleFixture({
    downloadArtifact: flowLifecycle.downloadArtifact,
    validateArtifact: flowLifecycle.validateArtifact,
  });
  try {
    const png = await sharp({
      create: { width: 18, height: 12, channels: 3, background: "#2255aa" },
    })
      .png()
      .toBuffer();
    f.setArtifact(png);
    const j = await f.create(flowImage);
    await f.executor.execute(j.id);
    await f.executor.execute(j.id);
    const completed = await row(f, j.id),
      asset = await one(f.db, "SELECT * FROM assets WHERE id=$1", [
        completed.result.assets[0],
      ]);
    assert.equal(completed.state, "completed");
    assert.equal(completed.plugin_version, "1.9.0");
    assert.equal(f.requests.length, 1);
    assert.equal(f.artifactRequests(), 1);
    assert.equal(asset.original_kind, "ref");
    assert.equal(asset.metadata.width, 18);
    assert.equal(asset.metadata.height, 12);
    assert.equal(asset.mime, "image/png");
    assert.deepEqual(
      Buffer.from(await f.p.storage.read(asset.object_key)),
      png,
    );
    assert.equal(Number((await f.p.wallet(f.admin, f.wid)).balance), 9998);
  } finally {
    await f.cleanup();
  }
});
