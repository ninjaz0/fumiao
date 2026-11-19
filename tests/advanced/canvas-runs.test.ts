import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { canvasRunsFixture, canvasRunPlugins } from "../helpers/canvas-runs.js";
import { one } from "../../packages/platform/src/db.js";
import { canvasText } from "../../packages/original-api/src/canvas-values.js";
import { uuid5 } from "../../packages/platform/src/uuid.js";
import { CanvasSubmissionModels } from "../../packages/platform/src/canvas-submission.js";
import { gpuCanvas } from "../../plugins/gpu/src/canvas.js";
import { OriginalJobs } from "../../packages/original-api/src/jobs.js";

test("Canvas candidates freeze two plugin tasks, holds and links atomically; retries preserve their original identity and inputs", async () => {
  const f = await canvasRunsFixture();
  try {
    const project = await f.project(
      [
        {
          id: "text",
          type: "text",
          x: 0,
          y: 0,
          text: "\u001c 参考文字 \u3000",
        },
        {
          id: "v",
          type: "video",
          x: 0,
          y: 0,
          prompt: " 画面 ",
          params: { seed: 2 ** 53 - 1, fast_mode: true },
        },
      ],
      [{ id: "e", source: "text", target: "v" }],
    );
    const body = f.body({ count: 2 }),
      result = await f.runs.candidates(f.admin, project, "v", body);
    assert.equal(result.credits, 4);
    assert.equal(result.ids.length, 2);
    const links = (
      await f.db.query(
        "SELECT l.*,j.public_id,j.plugin_id,j.plugin_version,j.original_uid,j.input FROM canvas_job_links l JOIN jobs j ON j.id=l.job_id ORDER BY l.id",
      )
    ).rows;
    assert.equal(links.length, 2);
    for (const [i, l] of links.entries()) {
      assert.equal(l.uid, uuid5(body.uid, `candidate:${i}`));
      assert.equal(l.plugin_id, "gpu");
      assert.equal(l.plugin_version, "1.10.0");
      assert.equal(l.input.prompt, "参考文字\n\n画面");
      assert.equal(l.input.params.seed, i ? 0 : 2 ** 53 - 1);
      assert.equal(l.input.params.sampling_steps, 4);
      const inputs = JSON.parse(canvasText(l.inputs));
      assert.deepEqual(inputs.sources, [{ node: "text", text: "参考文字" }]);
      assert.equal(inputs.params.fast_mode, true);
      assert.equal(
        l.original_uid,
        `${f.admin.public_id}-${uuid5("6ba7b811-9dad-11d1-80b4-00c04fd430c8", `fumiao:canvas:${project}:v:${l.uid}`)}`,
      );
    }
    assert.equal(
      Number(
        (
          await one(f.db, "SELECT held FROM wallets WHERE workspace_id=$1", [
            f.workspace.id,
          ])
        ).held,
      ),
      4,
    );
    assert.deepEqual(
      await f.runs.candidates(f.admin, project, "v", {
        ...body,
        expected_revision: 1,
        price_revision: 999,
      }),
      result,
    );
    await assert.rejects(
      f.runs.candidates(f.admin, project, "v", { ...body, count: 1 }),
      /刷新后重试/,
    );
    await assert.rejects(
      f.runs.generate(f.admin, project, "v", f.body()),
      /还有生成任务/,
    );
    assert.equal(
      (await one(f.db, "SELECT count(*)::int AS n FROM outbox")).n,
      2,
    );
    // A lower-level child request has exactly the same retry namespace.
    assert.deepEqual(
      await f.runs.generate(
        f.admin,
        project,
        "v",
        f.body({ uid: links[0].uid, expected_revision: 1 }),
      ),
      { id: result.ids[0] },
    );
  } finally {
    await f.cleanup();
  }
});

test("An insufficient second candidate or late link failure rolls back jobs, wallet, ledger, events and outbox", async () => {
  const f = await canvasRunsFixture();
  try {
    const project = await f.project(),
      body = f.body({ count: 2 });
    await f.db.query("UPDATE wallets SET balance=3 WHERE workspace_id=$1", [
      f.workspace.id,
    ]);
    await assert.rejects(
      f.runs.candidates(f.admin, project, "v", body),
      /积分不足/,
    );
    async function empty() {
      for (const table of [
        "jobs",
        "canvas_job_links",
        "canvas_run_batches",
        "ledger",
        "job_events",
        "outbox",
      ])
        assert.equal(
          (await one(f.db, `SELECT count(*)::int AS n FROM ${table}`)).n,
          0,
          table,
        );
      assert.equal(
        Number(
          (
            await one(f.db, "SELECT held FROM wallets WHERE workspace_id=$1", [
              f.workspace.id,
            ])
          ).held,
        ),
        0,
      );
    }
    await empty();
    await f.db.query("UPDATE wallets SET balance=100 WHERE workspace_id=$1", [
      f.workspace.id,
    ]);
    await f.db
      .query(`CREATE FUNCTION fail_canvas_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture link rollback'; END $$;
    CREATE TRIGGER fail_canvas_link BEFORE INSERT ON canvas_job_links FOR EACH ROW EXECUTE FUNCTION fail_canvas_link();`);
    await assert.rejects(
      f.runs.candidates(f.admin, project, "v", body),
      /fixture link rollback/,
    );
    await empty();
    await f.db.query("DROP TRIGGER fail_canvas_link ON canvas_job_links");
    assert.equal(
      (await f.runs.candidates(f.admin, project, "v", body)).credits,
      4,
    );
  } finally {
    await f.cleanup();
  }
});

test("Canvas concurrency admits one request per busy node, shares same-UID replies and refuses cross-project UID reuse", async () => {
  const f = await canvasRunsFixture();
  try {
    const project = await f.project(),
      other = await f.project(),
      body = f.body();
    const repeat = await Promise.all([
      f.runs.generate(f.admin, project, "v", body),
      f.runs.generate(f.admin, project, "v", body),
    ]);
    assert.deepEqual(repeat[0], repeat[1]);
    await assert.rejects(f.runs.generate(f.admin, other, "v", body), {
      status: 409,
    });
    const requests = await Promise.allSettled([
      f.runs.generate(f.admin, other, "v", f.body()),
      f.runs.generate(f.admin, other, "v", f.body()),
    ]);
    assert.equal(requests.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await one(f.db, "SELECT count(*)::int AS n FROM jobs")).n, 2);
    const third = await f.project(),
      fourth = await f.project(),
      collision = f.body();
    const collisionResult = await Promise.allSettled([
      f.runs.generate(f.admin, third, "v", collision),
      f.runs.generate(f.admin, fourth, "v", collision),
    ]);
    assert.equal(
      collisionResult.filter((r) => r.status === "fulfilled").length,
      1,
    );
    assert.equal(
      (
        collisionResult.find(
          (r) => r.status === "rejected",
        ) as PromiseRejectedResult
      ).reason.status,
      409,
    );
  } finally {
    await f.cleanup();
  }
});

test("Narration uses the declared audio plugin, enforces project access, preserves retries and detects soft-deleted history", async () => {
  const f = await canvasRunsFixture();
  try {
    const project = await f.project([
        {
          id: "v",
          type: "video",
          x: 0,
          y: 0,
          narration_text: " 旁白 ",
          narration_instruction: " 自然 ",
        },
      ]),
      body = f.body();
    await assert.rejects(f.runs.narrate(f.member, project, "v", body), {
      status: 404,
    });
    const result = await f.runs.narrate(f.admin, project, "v", body);
    const row = await one(f.db, "SELECT * FROM jobs WHERE public_id=$1", [
      result.id,
    ]);
    assert.equal(row.kind, "audio");
    assert.equal(row.provider_model, "breeze-tts-2");
    assert.equal(row.input.prompt, "旁白");
    assert.equal(
      row.original_uid,
      `${f.admin.public_id}-audio-${uuid5(body.uid, `voice:${project}:v`)}`,
    );
    assert.deepEqual(
      await f.runs.narrate(f.admin, project, "v", {
        ...body,
        expected_revision: 1,
      }),
      result,
    );
    await assert.rejects(
      f.runs.narrate(f.admin, project, "v", f.body()),
      /旁白仍在生成/,
    );
    const link = await one(
      f.db,
      "SELECT * FROM canvas_job_links WHERE job_id=$1",
      [row.id],
    );
    assert.equal(link.uid, uuid5(body.uid, "narration"));
    assert.equal(JSON.parse(canvasText(link.inputs)).text, " 旁白 ");
    await new OriginalJobs(f.p).cancel(f.admin, result.id);
    await new OriginalJobs(f.p).remove(f.admin, result.id);
    await assert.rejects(
      f.runs.narrate(f.admin, project, "v", body),
      /刷新后重试/,
    );
  } finally {
    await f.cleanup();
  }
});

test("Canvas submission policies are versioned, validated and never activated by installation alone", async () => {
  const f = await canvasRunsFixture();
  try {
    const old = await one(
      f.db,
      "SELECT manifest FROM plugin_versions WHERE id='gpu' AND version='1.9.0'",
    );
    assert.equal(old.manifest.canvasSubmission, undefined);
    await f.db.transaction((sql) =>
      f.catalog.activate(sql, gpuCanvas.manifest),
    );
    const p = await f.project();
    await assert.rejects(
      f.runs.generate(f.admin, p, "v", f.body()),
      /生成插件尚未完整启用/,
    );
    await f.p.registry.installBuiltins(f.db);
    await assert.rejects(
      CanvasSubmissionModels.read(f.db),
      /生成插件尚未完整启用/,
    );
    const invalid = structuredClone(canvasRunPlugins[0].manifest);
    invalid.version = "99.0.0";
    invalid.canvasSubmission!.models[0].model = "not-owned";
    await assert.rejects(
      f.p.registry.install(f.db, invalid, "http://127.0.0.1:9"),
      /画布生成规则无效/,
    );
    assert.equal(
      (
        await one(
          f.db,
          "SELECT count(*)::int AS n FROM plugin_versions WHERE id='gpu' AND version='99.0.0'",
        )
      ).n,
      0,
    );
  } finally {
    await f.cleanup();
  }
});
