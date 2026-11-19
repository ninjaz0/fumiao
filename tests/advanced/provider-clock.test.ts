import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import sharp from "sharp";
import { timingFixture } from "../helpers/timing.js";
import { museClock, museClockReport } from "../../plugins/muse/src/clock.js";
import { muse } from "../../plugins/muse/src/index.js";
import { museTiming } from "../../plugins/muse/src/timing.js";
import { museStudio } from "../../plugins/muse/src/studio.js";
import { museQueue } from "../../plugins/muse/src/queue.js";
import { Executor } from "../../packages/platform/src/executor.js";
import { JobTiming } from "../../packages/platform/src/timing.js";
import { QueueHealthPoller } from "../../packages/platform/src/queue-health.js";
import { QueueForecasts } from "../../packages/platform/src/queue-snapshot.js";
import { one } from "../../packages/platform/src/db.js";
import type { Execution } from "../../packages/plugin-sdk/src/index.js";

test("Muse provider clock follows actual submit and poll without resubmission or duplicate settlement", async () => {
  let posts = 0;
  const requests: { method: string; path: string; body: any }[] = [];
  let remote: any = {
    id: "task_fixture",
    status: "queued",
    phase: "queued",
    prompt: "private-upstream-sentinel",
    api_key: "private-upstream-sentinel",
  };
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, "Bearer local-fixture");
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({
      method: req.method!,
      path: req.url!,
      body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null,
    });
    if (req.method === "POST") posts++;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(remote));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const f = await timingFixture({
    ...museClock,
    manifest: {
      ...museClock.manifest,
      id: "clock-muse",
      configSchema: { type: "object" },
      models: museClock.manifest.models.map(({ studio, ...m }) => m),
    },
    queueHealth: async () => ({
      ready: true,
      capacity: 2,
      maintenance: 0,
      tasks: [],
    }),
  });
  try {
    const connection = f.connections["clock-muse"];
    await f.p.updateConnection(f.admin, connection, {
      revision: 2,
      enabled: true,
      concurrency: 2,
      config: {
        baseUrl: `http://127.0.0.1:${(server.address() as any).port}`,
        apiKey: "local-fixture",
      },
    });
    await new QueueHealthPoller(f.p).refresh(connection);
    const job = await f.create("muse-image"),
      e = new Executor(f.p),
      t = new JobTiming(f.p),
      stamp = Date.now() / 1000 - 1;
    await f.db.query(
      "UPDATE jobs SET created_at=to_timestamp($2) WHERE id=$1",
      [job.id, stamp - 120],
    );
    await e.execute(job.id);
    let run = (await t.current(f.db, job.id))!;
    assert.equal(posts, 1);
    assert.equal(run.phase, "queued");
    assert.equal(run.started, null);
    assert.ok(run.details.admitted_at);
    assert.equal(
      (await new QueueForecasts(f.p).forWorkspace(f.admin, f.wid)).jobs[job.id]
        .eta.phase,
      "queued",
    );
    const admitted = run.details.admitted_at,
      runId = run.id;
    assert.ok(!JSON.stringify(run).includes("private-upstream-sentinel"));
    remote = {
      id: "task_fixture",
      status: "processing",
      started_at: stamp,
      generating_at: stamp + 0.1,
    };
    await e.execute(job.id);
    run = (await t.current(f.db, job.id))!;
    assert.equal(run.id, runId);
    assert.equal(run.started, stamp);
    assert.equal(run.generating, stamp + 0.1);
    assert.equal(run.phase, "generating");
    assert.equal(run.details.source, "provider");
    assert.equal(run.details.admitted_at, admitted);
    const png = await sharp({
      create: { width: 16, height: 16, channels: 3, background: "#7353aa" },
    })
      .png()
      .toBuffer();
    remote = {
      id: "task_fixture",
      status: "completed",
      phase: "completed",
      started_at: stamp,
      generating_at: stamp + 0.1,
      finished_at: stamp + 0.2,
      url: "data:image/png;base64," + png.toString("base64"),
    };
    await e.execute(job.id);
    await e.execute(job.id);
    run = (await t.current(f.db, job.id))!;
    assert.equal(run.status, "done");
    assert.equal(run.finalizing, stamp + 0.2);
    assert.equal(run.id, runId);
    assert.equal(posts, 1);
    assert.equal(Number((await f.p.wallet(f.admin, f.wid)).held), 0);
    assert.equal(Number((await f.p.wallet(f.admin, f.wid)).balance), 9998);
    assert.deepEqual(
      requests.map((r) => [r.method, r.path]),
      [
        ["POST", "/v1/images/tasks"],
        ["GET", "/v1/images/tasks/task_fixture"],
        ["GET", "/v1/images/tasks/task_fixture"],
      ],
    );
    assert.deepEqual(requests[0].body, {
      model: "muse-image",
      prompt: "private fixture prompt",
      aspect_ratio: "16:9",
      images: [],
      videos: [],
      audios: [],
      timeout: 600,
      response_format: "url",
    });
    // Callbacks from a poll lease cannot modify a later attempt or inject fields.
    const next = await f.create("muse-image"),
      claimed = (await e.claim(next.id))!,
      execution = await e.execution(claimed, AbortSignal.timeout(5000));
    const before = await t.current(f.db, next.id);
    await assert.rejects(
      execution.reportProviderClock!({
        state: "queued",
        phase: "queued",
        api_key: "private",
      } as any),
    );
    assert.deepEqual(await t.current(f.db, next.id), before);
    await f.db.query(
      "UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
      [next.id],
    );
    await assert.rejects(
      execution.reportProviderClock!({ state: "queued", phase: "queued" }),
      /租约/,
    );
    assert.deepEqual(await t.current(f.db, next.id), before);
  } finally {
    await f.cleanup();
    server.close();
    await once(server, "close");
  }
});

test("older Muse versions retain their original wire and receipt contract without clock callbacks", async () => {
  let clockCalls = 0,
    posts = 0;
  const server = createServer(async (req, res) => {
    for await (const _ of req) {
    }
    posts++;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({ id: "fixture-old", status: "queued", phase: "queued" }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const e: Execution = {
      jobId: "fixture",
      idempotencyKey: "fixture",
      model: "muse-image",
      kind: "image",
      input: { prompt: "fixture", params: {}, references: [] },
      config: {
        baseUrl: `http://127.0.0.1:${(server.address() as any).port}`,
        apiKey: "local-fixture",
      },
      signal: AbortSignal.timeout(5000),
      reportProviderClock: async () => {
        clockCalls++;
      },
    };
    for (const plugin of [muse, museStudio, museTiming, museQueue])
      assert.deepEqual(await plugin.submit(e), {
        state: "pending",
        remoteId: "fixture-old",
      });
    assert.equal(posts, 4);
    assert.equal(clockCalls, 0);
    assert.deepEqual(
      museClockReport({
        status: "processing",
        started_at: "123",
        elapsed: Infinity,
        phase: "generating",
        token: "private",
        generating_at: 123,
      }),
      {
        state: "running",
        phase: "generating",
        generating_at: 123,
        started_at_reported: true,
      },
    );
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("absolute clocks require a declared capability and cannot change finished jobs through stale callbacks", async () => {
  const f = await timingFixture();
  try {
    const e = new Executor(f.p),
      job = await f.create("timer-chat"),
      claimed = (await e.claim(job.id))!,
      execution = await e.execution(claimed, AbortSignal.timeout(5000)),
      t = new JobTiming(f.p),
      before = await t.current(f.db, job.id);
    await assert.rejects(
      execution.reportProviderClock!({
        state: "running",
        started_at: Date.now() / 1000,
      }),
      /未声明/,
    );
    assert.deepEqual(await t.current(f.db, job.id), before);
    await f.db.query(
      "UPDATE jobs SET state='failed',lease_token=NULL,lease_until=NULL WHERE id=$1",
      [job.id],
    );
    await assert.rejects(
      execution.reportProviderClock!({ state: "queued", phase: "queued" }),
      /租约/,
    );
  } finally {
    await f.cleanup();
  }
});
