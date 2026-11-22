import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { timingFixture, timedRequest, wavFixture } from "../helpers/timing.js";
import { one } from "@fumiao/platform/db.js";
import { JobTiming } from "@fumiao/platform/timing.js";
import { Executor } from "@fumiao/platform/executor.js";
import { Operations } from "@fumiao/platform/operations.js";
import { PluginRegistry } from "@fumiao/platform/plugins.js";
import type { Execution } from "@fumiao/plugin-sdk/index.js";
import { databaseFixture } from "../helpers/database.js";
import {
  importLegacy,
  legacyId,
} from "@fumiao/platform/importer.js";
import { gpuTiming } from "@fumiao/plugin-gpu/timing.js";
import { museTiming } from "@fumiao/plugin-muse/timing.js";
import {
  elapsedDetail,
  type Run,
} from "@fumiao/platform/timing-math.js";

test("older versions can still cancel and refund without a timing capability or installed adapter", async () => {
  const f = await timingFixture({
    ...timedRequest,
    manifest: { ...timedRequest.manifest, timing: undefined },
    timingFeatures: undefined,
  });
  try {
    const j = await f.create("timer-chat");
    f.p.registry = new PluginRegistry([]);
    await f.p.cancel(f.admin, j.id);
    assert.equal(Number((await f.p.wallet(f.admin, f.wid)).held), 0);
    assert.equal(Number((await f.p.wallet(f.admin, f.wid)).balance), 10000);
    assert.equal(
      (await one(f.db, "SELECT state FROM jobs WHERE id=$1", [j.id])).state,
      "cancelled",
    );
    assert.equal((await f.db.query("SELECT * FROM job_runs")).rows.length, 0);
  } finally {
    await f.cleanup();
  }
});

test("GPU timing is bound to the current lease; duplicate completion spends once", async () => {
  const f = await timingFixture();
  try {
    const { db, p, gateway: g, node } = f,
      t = new JobTiming(p);
    await g.heartbeat(node.token, {
      context: {
        runtime_id: "boot-A",
        profile: {
          backend: "cuda",
          gpu_name: "A100",
          vram_gib: 80,
          used_gpus: 1,
        },
      },
    });
    const j = await f.create("breeze-tts-2"),
      lease = (await g.claim(node.token)).job!.lease;
    const started = await t.current(db, j.id);
    assert.equal(started?.features.cold, true);
    assert.equal(started?.features.profile.vram_gib, 80);
    assert.equal((await g.claim(node.token)).job, null);
    await assert.rejects(
      g.heartbeat(node.token, {
        jobId: j.id,
        lease: randomUUID(),
        report: { job_phase: "uploading", timing: { recovered: true } },
      }),
      /租约/,
    );
    assert.deepEqual(await t.current(db, j.id), started);
    await assert.rejects(
      g.heartbeat(node.token, { report: { step: 1, steps: 20 } }),
    );
    await assert.rejects(
      g.heartbeat(node.token, {
        context: { profile: { apiKey: "not allowed" } },
      }),
    );
    await assert.rejects(
      g.heartbeat(node.token, { context: { profile: { vram_gib: 1e6 } } }),
    );
    await assert.rejects(
      g.heartbeat(node.token, {
        context: { model_profiles: { "not enrolled": {} } },
      }),
    );
    await g.heartbeat(node.token, {
      jobId: j.id,
      lease,
      report: {
        job_phase: "generating",
        timing: { prepare_s: 0, generate_s: 0, cold: false },
      },
    });
    await g.heartbeat(node.token, {
      jobId: j.id,
      lease,
      report: { job_phase: "uploading" },
    });
    await g.heartbeat(node.token, {
      jobId: j.id,
      lease,
      report: { job_phase: "preparing" },
    });
    assert.equal((await t.current(db, j.id))!.phase, "uploading");
    const result = await g.complete(node.token, j.id, lease, wavFixture()),
      done = (await t.current(db, j.id))!;
    assert.equal(done.status, "done");
    assert.equal(done.valid, true);
    assert.ok(done.validating);
    assert.equal(done.details.source, "worker");
    assert.deepEqual(
      await g.complete(node.token, j.id, lease, wavFixture()),
      result,
    );
    assert.deepEqual(await t.current(db, j.id), done);
    assert.equal(Number((await p.wallet(f.admin, f.wid)).balance), 9998);
    assert.equal(
      Number(
        (
          await one(
            db,
            "SELECT count(*) n FROM ledger WHERE job_id=$1 AND action='spend'",
            [j.id],
          )
        ).n,
      ),
      1,
    );
    const next = await f.create("breeze-tts-2");
    await g.claim(node.token);
    assert.equal((await t.current(db, next.id))!.features.cold, false);
    assert.ok(
      !JSON.stringify((await db.query("SELECT * FROM job_runs")).rows).includes(
        "private fixture prompt",
      ),
    );
  } finally {
    await f.cleanup();
  }
});

test("progress is monotonic and recovery cannot produce a calibration sample", async () => {
  const f = await timingFixture();
  try {
    const { db, p, gateway: g, node } = f,
      t = new JobTiming(p),
      j = await f.create(),
      lease = (await g.claim(node.token)).job!.lease;
    for (const step of [0, 1, 2, 2, 1, 3])
      await g.heartbeat(node.token, {
        jobId: j.id,
        lease,
        report: { step, steps: 20 },
      });
    await g.heartbeat(node.token, {
      jobId: j.id,
      lease,
      report: { step: 10, steps: 32, timing: { generate_s: 172800 } },
    });
    const row = (await t.current(db, j.id))!;
    assert.deepEqual(
      row.progress.map((p) => p[0]),
      [0, 1, 2, 3],
    );
    assert.equal(row.details.generate_s, undefined);
    await db.query(
      "UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
      [j.id],
    );
    await assert.rejects(
      g.heartbeat(node.token, {
        jobId: j.id,
        lease,
        report: { step: 4, steps: 20 },
      }),
      /租约/,
    );
    await new Executor(p).recover();
    assert.equal((await t.current(db, j.id))!.status, "interrupted");
    await assert.rejects(
      g.fail(node.token, j.id, { lease, error: "stale" }),
      /租约/,
    );
    await new Operations(p).resolve(f.admin, j.id, {
      action: "refund",
      reason: "Synthetic node confirmed stopped",
    });
    assert.equal((await t.current(db, j.id))!.status, "failed");
    assert.equal(Number((await p.wallet(f.admin, f.wid)).held), 0);
    const cancel = await f.create();
    await p.cancel(f.admin, cancel.id);
    await p.cancel(f.admin, cancel.id);
    const cancelled = (await t.current(db, cancel.id))!;
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.started, null);
    assert.equal(cancelled.valid, false);
    assert.equal(
      Number(
        (
          await one(
            db,
            "SELECT count(*) n FROM ledger WHERE job_id=$1 AND action='refund'",
            [cancel.id],
          )
        ).n,
      ),
      1,
    );
  } finally {
    await f.cleanup();
  }
});

test("request plugin polling shares an attempt and rejects callbacks after lease rotation", async () => {
  let callbacks: Execution[] = [];
  const f = await timingFixture({
    ...timedRequest,
    submit: async (e) => {
      callbacks.push(e);
      await e.reportTiming?.({ step: 1, steps: 20 });
      return { state: "pending", remoteId: "synthetic-remote" };
    },
    inspect: async (e) => {
      callbacks.push(e);
      await e.reportTiming?.({ step: 2, steps: 20 });
      return { state: "completed", artifacts: [], text: "ok" };
    },
  });
  try {
    const executor = new Executor(f.p),
      j = await f.create("timer-chat"),
      t = new JobTiming(f.p);
    await executor.execute(j.id);
    const first = (await t.current(f.db, j.id))!;
    assert.equal(first.attempt, 1);
    assert.equal(first.step, 1);
    await assert.rejects(
      callbacks[0].reportTiming!({ step: 20, steps: 20 }),
      /租约/,
    );
    await executor.execute(j.id);
    const done = (await t.current(f.db, j.id))!;
    assert.equal(done.id, first.id);
    assert.equal(done.attempt, 1);
    assert.equal(done.status, "done");
    assert.equal(done.valid, true);
    assert.equal(done.step, 2);
    await assert.rejects(
      callbacks[1].reportTiming!({ timing: { recovered: true } }),
      /租约/,
    );
    assert.equal(
      Number(
        (
          await one(f.db, "SELECT count(*) n FROM job_runs WHERE job=$1", [
            j.id,
          ])
        ).n,
      ),
      1,
    );
  } finally {
    await f.cleanup();
  }
});

test("uncertain request resume keeps the original timer but excludes recovered history", async () => {
  const f = await timingFixture({
    ...timedRequest,
    submit: async () => {
      throw Error("synthetic lost acknowledgement");
    },
    inspect: timedRequest.submit,
  });
  try {
    const j = await f.create("timer-chat"),
      executor = new Executor(f.p),
      t = new JobTiming(f.p);
    await executor.execute(j.id);
    const interrupted = (await t.current(f.db, j.id))!;
    assert.equal(interrupted.status, "interrupted");
    assert.equal(Number((await f.p.wallet(f.admin, f.wid)).held), 2);
    await new Operations(f.p).resolve(f.admin, j.id, {
      action: "resume",
      reason: "Synthetic upstream identifier confirmed",
      remoteId: "synthetic-id",
    });
    await executor.execute(j.id);
    const done = (await t.current(f.db, j.id))!;
    assert.equal(done.id, interrupted.id);
    assert.equal(done.status, "done");
    assert.equal(done.valid, false);
    const estimator = await t.estimator(
      f.db,
      timedRequest.manifest.id,
      timedRequest.manifest.timing!,
    );
    assert.equal(estimator.samples.length, 0);
    assert.equal(Number((await f.p.wallet(f.admin, f.wid)).balance), 9998);
  } finally {
    await f.cleanup();
  }
});

test("legacy timings retain attempts and anonymous samples without restoring live providers", async () => {
  const f = await databaseFixture();
  try {
    const features = gpuTiming.timingFeatures!({
      model: "MiniMax H3",
      kind: "video",
      input: { prompt: "", params: {}, references: [] },
      node: { id: "old-node", hardware: "same-hardware" },
    });
    const sample = {
      id: 10,
      job: 1,
      node: 7,
      attempt: 1,
      kind: "video",
      model: features.model,
      features: JSON.stringify(features),
      created: 1000,
      queued: 1000,
      started: 1100,
      generating: 1110,
      finalizing: 1180,
      uploading: 1190,
      validating: 1195,
      finished: 1200,
      status: "done",
      phase: "done",
      step: 20,
      steps: 20,
      progress: "[]",
      predicted:
        '{"source":"none","samples":0,"confidence":"none","version":4}',
      details: '{"source":"worker","generate_s":70}',
      valid: 1,
    };
    const museFeatures = museTiming.timingFeatures!({
      model: "muse-video",
      kind: "video",
      input: {
        prompt: "",
        params: { ratio: "16:9", seconds: 6 },
        references: [],
      },
    });
    const rows = [
      {
        ...sample,
        id: 13,
        job: null,
        node: null,
        model: museFeatures.model,
        features: JSON.stringify(museFeatures),
        steps: 0,
        step: 0,
        details: JSON.stringify({
          source: "provider",
          admitted_at: 1090,
          provider_elapsed: 100,
        }),
      },
      { ...sample, id: 12, job: null },
      { ...sample, id: 9, status: "failed", valid: 0 },
      {
        ...sample,
        id: 11,
        job: 999,
        model: "unknown historical model",
        features: JSON.stringify({
          ...features,
          model: "unknown historical model",
        }),
      },
      sample,
    ];
    const data = {
      version: 1 as const,
      source: "timing-legacy",
      tables: {
        users: [
          {
            id: 1,
            name: "legacy",
            salt: "fixture-only",
            pw: "fixture-only",
            role: "admin",
            active: 1,
          },
        ],
        workspaces: [{ id: 1, owner: 1, name: "Personal", kind: "personal" }],
        credit_accounts: [{ workspace: 1, balance: 42, reserved: 0 }],
        jobs: [
          {
            id: 1,
            workspace: 1,
            owner: 1,
            model: features.model,
            kind: "video",
            prompt: "historical prompt",
            refs: "[]",
            status: "done",
            created: 1000,
            updated: 1200,
          },
        ],
        job_runs: rows,
      },
    };
    await assert.rejects(
      importLegacy(
        f.p,
        {
          ...data,
          tables: {
            ...data.tables,
            job_runs: [
              {
                ...sample,
                features: JSON.stringify({ ...features, apiKey: "forbidden" }),
              },
            ],
          },
        },
        f.directory,
      ),
    );
    assert.equal((await f.db.query("SELECT id FROM users")).rows.length, 0);
    await importLegacy(f.p, data, f.directory);
    assert.equal(
      (await importLegacy(f.p, data, f.directory)).alreadyImported,
      true,
    );
    const saved = (await f.db.query("SELECT * FROM job_runs ORDER BY id")).rows;
    assert.equal(saved.length, 5);
    assert.deepEqual(
      saved.map((r) => r.status),
      ["failed", "done", "done", "done", "done"],
    );
    const jid = legacyId(data.source, "job", 1);
    assert.equal(saved[1].job, jid);
    assert.equal(saved[1].node, legacyId(data.source, "node", 7));
    assert.equal(saved[2].job, null);
    assert.equal(saved[3].job, null);
    assert.equal(saved[2].plugin_id, "legacy-archive");
    assert.equal(saved[1].plugin_id, "gpu");
    assert.equal(saved[1].plugin_version, "1.2.0");
    assert.equal(saved[4].plugin_id, "muse");
    assert.deepEqual(saved[4].details, {
      source: "provider",
      admitted_at: 1090,
      provider_elapsed: 100,
    });
    assert.equal(
      elapsedDetail(saved[4] as Run, 1400)?.phase_source,
      "provider",
    );
    assert.deepEqual(elapsedDetail(saved[1] as Run, 1400), {
      source: "measured",
      elapsed: 100,
      queue: 100,
      total: 200,
      attempt: 1,
      phase_source: "worker",
      prediction: JSON.parse(sample.predicted),
      prepare: 10,
      generation: 70,
      finalize: 10,
      upload: 5,
      validation: 5,
    });
    const t = new JobTiming(f.p),
      estimate = await t.estimator(f.db, "gpu", gpuTiming.manifest.timing!);
    assert.equal(estimate.estimate(features).samples, 2);
    assert.equal(
      (
        await one(
          f.db,
          "SELECT enabled FROM connections WHERE id=(SELECT connection_id FROM jobs WHERE id=$1)",
          [jid],
        )
      ).enabled,
      false,
    );
    assert.equal(
      (
        await one(
          f.db,
          "SELECT plugin_version FROM studio_catalog WHERE id=$1",
          [features.model],
        )
      ).plugin_version,
      "1.1.0",
    );
    await f.db.query("DELETE FROM jobs WHERE id=$1", [jid]);
    assert.equal(
      (await f.db.query("SELECT id FROM job_runs WHERE job IS NOT NULL")).rows
        .length,
      0,
    );
    assert.equal(
      (await t.estimator(f.db, "gpu", gpuTiming.manifest.timing!)).estimate(
        features,
      ).samples,
      2,
    );
  } finally {
    await f.cleanup();
  }
});

test("the estimator keeps the original global 500-sample history boundary", async () => {
  const f = await timingFixture();
  try {
    const j = await f.create("timer-chat");
    await new Executor(f.p).execute(j.id);
    const t = new JobTiming(f.p),
      policy = timedRequest.manifest.timing!;
    assert.equal(
      (await t.estimator(f.db, "timing-request", policy)).samples.length,
      1,
    );
    const gpu = await f.create();
    await f.gateway.claim(f.node.token);
    await f.db.query(
      `INSERT INTO job_runs(run_key,attempt,plugin_id,plugin_version,policy,kind,model,features,created,started,finished,status,phase)
    SELECT 'sample:'||i,1,plugin_id,plugin_version,policy,kind,model,features,created,started,started+100,'done','done'
    FROM job_runs CROSS JOIN generate_series(1,500) i WHERE job=$1`,
      [gpu.id],
    );
    assert.equal(
      (await t.estimator(f.db, "timing-request", policy)).samples.length,
      0,
    );
  } finally {
    await f.cleanup();
  }
});
