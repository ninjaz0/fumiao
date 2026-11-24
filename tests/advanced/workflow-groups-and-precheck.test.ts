import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { one } from "@fumiao/platform/db.js";
import { OriginalBatchPrecheck } from "@fumiao/original-api/batch-precheck.js";
import { OriginalPacks } from "@fumiao/original-api/packs.js";
import { canvasRunsFixture } from "../helpers/canvas-runs.js";

test("F007 + F010 workflow groups validate parent_id, precheck detects blocked/warning/ready states read-only, and batchRun executes only selected stages", async () => {
  const f = await canvasRunsFixture();
  try {
    const precheck = new OriginalBatchPrecheck(f.p);
    const packs = new OriginalPacks(f.p);

    const ref = await f.asset(
      randomUUID().replaceAll("-", ""),
      "ref",
      f.team,
      f.admin,
    );
    const pack = await packs.save(
      f.admin,
      {
        name: "女主",
        purpose: "subject",
        description: "白衣长发",
        media: [ref.public_id],
        expected_revision: null,
      },
      String(f.team.public_id),
    );

    // Bump pack revision so a canvas pinning revision=1 triggers stale-pack precheck block!
    const packV2 = await packs.save(
      f.admin,
      {
        name: "女主",
        purpose: "subject",
        description: "白衣长发（更新版）",
        media: [ref.public_id],
        expected_revision: pack.revision,
      },
      String(f.team.public_id),
      pack.id,
    );
    assert.equal(packV2.revision, 2);

    const project = await f.canvases.create(
      f.admin,
      { title: "工作流组与预检测试" },
      String(f.team.public_id),
    );

    // Invalid parent_id (pointing to a non-group node) must be rejected with 400
    await assert.rejects(
      () =>
        f.canvases.save(f.admin, project.id, {
          expected_revision: project.revision,
          title: project.title,
          document: {
            schemaVersion: 1,
            nodes: [
              { id: "n1", type: "text", title: "文本", x: 0, y: 0, text: "hi" },
              {
                id: "n2",
                type: "image",
                title: "错误父节点",
                x: 100,
                y: 0,
                parent_id: "n1",
                prompt: "cat",
              },
            ],
            edges: [],
          },
        }),
      { status: 400 },
    );

    const saved = await f.canvases.save(f.admin, project.id, {
      expected_revision: project.revision,
      title: project.title,
      document: {
        schemaVersion: 1,
        nodes: [
          {
            id: "grp-1",
            type: "group",
            title: "第一幕工作流组",
            x: 0,
            y: 0,
            width: 900,
            height: 500,
          },
          {
            id: "img-ok",
            type: "image",
            title: "镜头1首帧",
            parent_id: "grp-1",
            x: 40,
            y: 60,
            prompt: "@女主 站在雨夜霓虹街头",
            asset_packs: [{ id: packV2.id, revision: packV2.revision }],
          },
          {
            id: "vid-stale",
            type: "video",
            title: "镜头2旧包",
            parent_id: "grp-1",
            x: 420,
            y: 60,
            prompt: "推镜特写",
            asset_packs: [{ id: pack.id, revision: pack.revision }],
          },
          {
            id: "vid-narr",
            type: "video",
            title: "镜头3纯旁白",
            parent_id: "grp-1",
            x: 420,
            y: 340,
            prompt: "",
            narration_text: "雨点敲打在霓虹灯箱上。",
          },
        ],
        edges: [],
      },
    });

    // F010: Standalone batch quote (read-only)
    const quote = await precheck.quoteBatch(
      f.admin,
      {
        items: [
          {
            kind: "image",
            model: "",
            resolution: "1K",
            image_quality: "medium",
            count: 2,
          },
          { kind: "audio", model: "edge-tts", count: 3 },
        ],
      },
      String(f.team.public_id),
    );
    assert.equal(quote.items.length, 2);
    assert.equal(quote.items[1].credits, 0);
    assert.ok(quote.price_revision >= 1);
    assert.equal(quote.sufficient, true);

    // F007 + F010: Precheck the workflow group directly by group ID!
    const report = await precheck.precheckCanvas(f.admin, project.id, {
      expected_revision: saved.revision,
      node_ids: ["grp-1"],
      stages: ["image", "video", "narration"],
    });
    const imgItem = report.items.find(
      (i) => i.node_id === "img-ok" && i.stage === "image",
    );
    const staleItem = report.items.find(
      (i) => i.node_id === "vid-stale" && i.stage === "video",
    );
    const emptyVidItem = report.items.find(
      (i) => i.node_id === "vid-narr" && i.stage === "video",
    );
    const narrItem = report.items.find(
      (i) => i.node_id === "vid-narr" && i.stage === "narration",
    );

    assert.equal(imgItem?.status, "ready", JSON.stringify(imgItem));
    assert.ok((imgItem?.credits ?? 0) > 0);
    assert.equal(staleItem?.status, "blocked");
    assert.ok(staleItem?.issues.some((m) => m.includes("新版本")));
    assert.equal(emptyVidItem?.status, "blocked");
    assert.ok(narrItem && narrItem.status !== "blocked");

    // F007: Execute partial group rerun ONLY for stage=["image"]!
    const batchUid = randomUUID();
    const runRes = await f.runs.batchRun(f.admin, project.id, {
      expected_revision: saved.revision,
      price_revision: report.price_revision,
      uid: batchUid,
      node_ids: ["grp-1"],
      stages: ["image"],
    });
    assert.equal(runRes.submitted.length, 1, JSON.stringify(runRes));
    assert.equal(runRes.submitted[0].node, "img-ok");
    assert.equal(runRes.submitted[0].stage, "image");
    assert.equal(runRes.total_credits, imgItem!.credits);

    // Confirm job_projects sidecar linked the job to this canvas project!
    const jobRow = await one(f.db, "SELECT id FROM jobs WHERE public_id=$1", [
      runRes.submitted[0].job_id,
    ]);
    const jp = await one(
      f.db,
      "SELECT project_id FROM job_projects WHERE job_id=$1",
      [jobRow.id],
    );
    assert.ok(jp?.project_id);

    // Retrying batchRun with same uid is strictly idempotent (no double-charge!)
    const retryRes = await f.runs.batchRun(f.admin, project.id, {
      expected_revision: saved.revision,
      price_revision: report.price_revision,
      uid: batchUid,
      node_ids: ["grp-1"],
      stages: ["image"],
    });
    assert.equal(retryRes.submitted.length, 1);
    assert.equal(retryRes.submitted[0].job_id, runRes.submitted[0].job_id);
  } finally {
    await f.cleanup();
  }
});
