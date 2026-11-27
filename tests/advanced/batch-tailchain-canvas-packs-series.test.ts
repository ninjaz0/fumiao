import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { ProviderError, type ProviderPlugin } from "@fumiao/plugin-sdk/index.js";
import { wakeTailFrameChildren } from "@fumiao/platform/tail-frame.js";
import { ensureBuiltinEdgeTts } from "@fumiao/platform/tts/edge-plugin.js";
import { OriginalBatchPrecheck } from "@fumiao/original-api/batch-precheck.js";
import { OriginalPacks } from "@fumiao/original-api/packs.js";
import { OriginalSeries } from "@fumiao/original-api/series.js";
import { canvasRunsFixture } from "../helpers/canvas-runs.js";

function generateValidMp4Bytes(): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "fm-tailchain-mp4-"));
  try {
    const out = join(dir, "clip.mp4");
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=#224488:s=320x180:d=0.6:r=12",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        out,
      ],
      { stdio: "ignore" },
    );
    return readFileSync(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function seedImageAsset(
  f: Awaited<ReturnType<typeof canvasRunsFixture>>,
  color = "#4477aa",
  w = 320,
  h = 180,
) {
  const bytes = await sharp({
    create: { width: w, height: h, channels: 3, background: color },
  })
    .png()
    .toBuffer();
  const id = randomUUID();
  const publicId = randomUUID().replaceAll("-", "");
  await f.p.storage.put(id, bytes, "image/png");
  await f.p.db.query(
    `INSERT INTO assets(id, public_id, workspace_id, owner_id, object_key, mime, size, state, original_kind, metadata)
     VALUES ($1,$2,$3,$4,$5,'image/png',$6,'ready','ref',$7::jsonb)`,
    [id, publicId, f.workspace.id, f.admin.id, id, bytes.length, JSON.stringify({ width: w, height: h })],
  );
  return { id, publicId, bytes };
}

test("#9 F010/F007/F027: mixed-price dialogue precheck matches batchRun, rejects quote drift 409, replays idempotently, and returns line_id", async (t) => {
  const f = await canvasRunsFixture();
  t.after(() => f.cleanup());

  const precheck = new OriginalBatchPrecheck(f.p);
  const packs = new OriginalPacks(f.p);
  const wsPublicId = String(f.workspace.public_id);

  // Enable free Edge TTS (0 credits) + a paid commercial TTS (tts-1 = 5 credits)
  await ensureBuiltinEdgeTts(f.p);
  const commercialTts: ProviderPlugin = {
    manifest: {
      id: "mock-paid-tts",
      label: "Paid TTS",
      version: "1.0.0",
      contractVersion: 1,
      mode: "request",
      configSchema: { type: "object", properties: {} },
      models: [
        {
          id: "tts-1",
          label: "Commercial TTS-1",
          kind: "audio",
          inputSchema: { type: "object", properties: { instruction: { type: "string" } } },
        },
      ],
      canvasSubmission: {
        version: 1,
        models: [{ model: "tts-1", kind: "audio", defaultForKind: false }],
      },
      originalSubmission: { version: 1 },
      originalState: { version: 1, fields: [], queueLane: "kind" },
    },
    health: async () => true,
    originalSubmission: {
      validate: () => {},
      namespace: () => "-tts1",
      plan: () => ({ namespace: "-tts1", parentKind: "any", refs: [], roles: [], missing: { status: 400, message: "" } }),
      prepare: async (d) => ({
        params: { instruction: d.instruction || "" },
        references: [],
        view: {
          ratio: "", quality: null, seconds: null, sampling_steps: null, seed: null,
          width: null, height: null, image_quality: null,
          audio_settings: { instruction: d.instruction || "" }, h3_inputs: null, refs: [],
        },
      }),
    },
    originalState: { configured: () => true, configuration: () => ({}), project: () => ({}) },
    submit: async () => {
      throw new ProviderError("mock stop", "rejected");
    },
  };
  f.p.registry.registerBuiltin(commercialTts);
  await f.p.db.query(
    `INSERT INTO plugin_versions(id, version, manifest) VALUES ('mock-paid-tts', '1.0.0', $1::jsonb)`,
    [JSON.stringify(commercialTts.manifest)],
  );
  await f.p.db.query(
    `INSERT INTO studio_catalog(id, plugin_id, plugin_version, descriptor, runtime, position, price_position, hidden)
     VALUES ('tts-1', 'mock-paid-tts', '1.0.0', '{"kind":"audio","label":"Commercial TTS-1"}'::jsonb, '{}'::jsonb, 80, 800, FALSE)`,
  );
  await f.p.db.query(
    `INSERT INTO studio_prices(key, model_id, tier, label, position, matcher, amount)
     VALUES ('tts-1|std', 'tts-1', 'std', '标准', 800, '{"type":"object","properties":{}}'::jsonb, 5)`,
  );
  await f.p.db.query(
    `UPDATE studio_policy SET flags = flags || '{"tts-1":true}'::jsonb WHERE singleton`,
  );
  const cConn = randomUUID();
  await f.p.db.query(
    `INSERT INTO connections(id, name, plugin_id, plugin_version, config, enabled) VALUES ($1, 'Paid TTS', 'mock-paid-tts', '1.0.0', $2, TRUE)`,
    [cConn, f.p.vault.seal({})],
  );
  await f.p.db.query(
    `INSERT INTO models(id, connection_id, catalog_id, provider_model, label, kind, schema, enabled)
     VALUES ($1, $2, 'tts-1', 'tts-1', 'Commercial TTS-1', 'audio', '{"type":"object"}'::jsonb, TRUE)`,
    [randomUUID(), cConn],
  );

  // Create two character packs: 林墨 -> paid tts-1 (5 cr), 苏青 -> free edge-tts (0 cr)
  const img = await seedImageAsset(f);
  await packs.save(
    f.admin,
    {
      name: "林墨",
      purpose: "subject",
      description: "男主角",
      media: [img.publicId],
      voice_profile: { model: "tts-1", voice_id: "onyx" },
    },
    wsPublicId,
  );
  await packs.save(
    f.admin,
    {
      name: "苏青",
      purpose: "subject",
      description: "女主角",
      media: [img.publicId],
      voice_profile: { model: "edge-tts", voice_id: "zh-CN-XiaoxiaoNeural" },
    },
    wsPublicId,
  );

  await f.p.db.query("UPDATE wallets SET balance = 200, held = 0 WHERE workspace_id = $1", [f.workspace.id]);

  // Canvas with 1 shot having mixed dialogue lines + 1 blocked empty shot
  const canvasId = await f.project(
    [
      {
        id: "shot1",
        type: "video",
        title: "混合声线对白镜头",
        x: 0,
        y: 0,
        width: 320,
        height: 220,
        prompt: "two characters talking in rain",
        dialogue_lines: [
          { id: "line_paid", speaker: "林墨", text: "今天这场雨不太寻常。" },
          { id: "line_free", speaker: "苏青", text: "快看窗外的霓虹灯！" },
        ],
        params: {},
      },
      {
        id: "shot_empty",
        type: "video",
        title: "空对白镜头",
        x: 360,
        y: 0,
        width: 320,
        height: 220,
        prompt: "",
        dialogue_lines: [],
        params: {},
      },
    ],
    [],
    wsPublicId,
    f.admin,
  );

  // 1. Precheck quotes EXACT mixed total: 5 + 0 = 5 credits (NOT default * 2!)
  const pre = await precheck.precheckCanvas(f.admin, canvasId, {
    expected_revision: 2,
    node_ids: ["shot1", "shot_empty"],
    stages: ["dialogue"],
  });
  assert.equal(pre.summary.total_credits, 5);
  assert.equal(pre.summary.runnable, 1);
  assert.equal(pre.summary.blocked, 1);
  assert.ok(pre.precheck_token);
  assert.deepEqual(pre.executable_keys, ["shot1:dialogue"]);

  // 2. First submit WITHOUT precheck_token MUST be rejected (400)!
  await assert.rejects(
    f.runs.batchRun(f.admin, canvasId, {
      expected_revision: 2,
      price_revision: pre.price_revision,
      uid: randomUUID(),
      node_ids: ["shot1", "shot_empty"],
      stages: ["dialogue"],
    }),
    (err: unknown) => (err as { status?: number })?.status === 400,
  );

  // 2b. Quote drift protection: wrong precheck_token -> 409!
  await assert.rejects(
    f.runs.batchRun(f.admin, canvasId, {
      expected_revision: 2,
      price_revision: pre.price_revision,
      precheck_token: "stale-token-mismatch",
      expected_total_credits: pre.summary.total_credits,
      uid: randomUUID(),
      node_ids: ["shot1", "shot_empty"],
      stages: ["dialogue"],
    }),
    (err: unknown) => (err as { status?: number })?.status === 409,
  );

  // 3. Valid locked batchRun ignores client executable_keys override (trying to include blocked shot_empty),
  // submits strictly server-bound executable set with line_id, skips shot_empty, and charges 5 credits!
  const stableUid = randomUUID();
  const batch1 = await f.runs.batchRun(f.admin, canvasId, {
    expected_revision: 2,
    price_revision: pre.price_revision,
    precheck_token: pre.precheck_token,
    expected_total_credits: pre.summary.total_credits,
    executable_keys: ["shot1:dialogue", "shot_empty:dialogue"],
    uid: stableUid,
    node_ids: ["shot1", "shot_empty"],
    stages: ["dialogue"],
  });
  assert.equal(batch1.submitted.length, 2);
  assert.equal(batch1.total_credits, 5);
  assert.deepEqual(
    batch1.submitted.map((s) => s.line_id).sort(),
    ["line_free", "line_paid"],
  );
  assert.ok(batch1.skipped.some((s) => s.node === "shot_empty"));

  // 4. Simulate lost response + another window renames the canvas (revision 2 -> 3) + page reload:
  // retrying with the original business `uid` MUST return the exact persisted receipt (200, NOT 409)
  // with zero duplicate jobs or holds!
  const beforeRename = await f.canvases.get(f.admin, canvasId);
  const renamed = await f.canvases.save(f.admin, canvasId, {
    title: "另一个窗口重命名后的画布",
    expected_revision: beforeRename.revision,
    document: beforeRename.document,
  });
  assert.equal(renamed.revision, 3);

  const batchReplay = await f.runs.batchRun(f.admin, canvasId, {
    expected_revision: 2,
    price_revision: pre.price_revision,
    precheck_token: pre.precheck_token,
    expected_total_credits: pre.summary.total_credits,
    uid: stableUid,
    node_ids: ["shot1", "shot_empty"],
    stages: ["dialogue"],
  });
  assert.deepEqual(batchReplay, batch1);
  const walletAfter = (
    await f.p.db.query("SELECT balance, held FROM wallets WHERE workspace_id = $1", [f.workspace.id])
  ).rows[0];
  assert.equal(Number(walletAfter.balance), 200);
  assert.equal(Number(walletAfter.held), 5);
});

test("#10 F028: batchRun(video) creates real job_tail_chains dependency for tail_inherited shot, wakes with extracted tail frame, cancels+refunds on parent failure, and never touches non-inherited shots", async (t) => {
  const f = await canvasRunsFixture();
  t.after(() => f.cleanup());
  const wsPublicId = String(f.workspace.public_id);
  await f.p.db.query("UPDATE wallets SET balance = 500, held = 0 WHERE workspace_id = $1", [f.workspace.id]);

  // Reviewer's exact regression benchmark: 2 shots with default video model, shot2 has tail_inherited=true, plus shot3 non-inherited!
  const explicitFrame = await seedImageAsset(f, "#cc3344");
  const canvasId = await f.project(
    [
      {
        id: "shot1",
        type: "video",
        title: "镜头 1",
        x: 0,
        y: 0,
        width: 320,
        height: 220,
        prompt: "wide shot of harbor at dawn",
        params: {},
      },
      {
        id: "shot2",
        type: "video",
        title: "镜头 2（尾帧续接）",
        x: 360,
        y: 0,
        width: 320,
        height: 220,
        prompt: "camera pans smoothly into the harbor pier",
        tail_inherited: true,
        params: {},
      },
      {
        id: "shot3",
        type: "video",
        title: "镜头 3（独立首帧不继承）",
        x: 720,
        y: 0,
        width: 320,
        height: 220,
        prompt: "cut to lighthouse interior",
        tail_inherited: false,
        params: {
          h3: {
            mode: "frames",
            first_frame: explicitFrame.publicId,
            last_frame: null,
            video_audio: [],
          },
        },
      },
    ],
    [],
    wsPublicId,
    f.admin,
  );
  // Save explicit storyboard shots order [shot1, shot2, shot3]
  const shotCanvasDoc = await f.canvases.get(f.admin, canvasId);
  const savedShotCanvas = await f.canvases.save(f.admin, canvasId, {
    title: shotCanvasDoc.title,
    expected_revision: shotCanvasDoc.revision,
    document: { ...shotCanvasDoc.document, shots: ["shot1", "shot2", "shot3"] },
  });

  // Submit out-of-order node_ids ["shot2", "shot1", "shot3"] to ALSO prove shot order sorting submits parent first!
  const precheckSvc = new OriginalBatchPrecheck(f.p);
  const tailPre = await precheckSvc.precheckCanvas(f.admin, canvasId, {
    expected_revision: savedShotCanvas.revision,
    node_ids: ["shot2", "shot1", "shot3"],
    stages: ["video"],
  });
  const batch = await f.runs.batchRun(f.admin, canvasId, {
    expected_revision: savedShotCanvas.revision,
    price_revision: tailPre.price_revision,
    precheck_token: tailPre.precheck_token,
    expected_total_credits: tailPre.summary.total_credits,
    uid: randomUUID(),
    node_ids: ["shot2", "shot1", "shot3"],
    stages: ["video"],
  });
  assert.equal(batch.submitted.length, 3);
  const jobByNode = new Map(batch.submitted.map((s) => [s.node, s.job_id]));
  const shot1Row = (await f.p.db.query("SELECT id, state FROM jobs WHERE public_id = $1", [jobByNode.get("shot1")])).rows[0];
  const shot2Row = (await f.p.db.query("SELECT id, state FROM jobs WHERE public_id = $1", [jobByNode.get("shot2")])).rows[0];
  const shot3Row = (await f.p.db.query("SELECT id, state, input FROM jobs WHERE public_id = $1", [jobByNode.get("shot3")])).rows[0];

  assert.equal(shot1Row.state, "queued");
  assert.equal(shot2Row.state, "queued");
  assert.equal(shot3Row.state, "queued");

  // Strictly 1 dependency row in job_tail_chains (shot1 -> shot2), 0 for shot3, and shot2 suppressed from outbox!
  const chains = (await f.p.db.query("SELECT * FROM job_tail_chains")).rows;
  assert.equal(chains.length, 1);
  assert.equal(chains[0].parent_job_id, shot1Row.id);
  assert.equal(chains[0].child_job_id, shot2Row.id);
  const shot2Outbox = (await f.p.db.query("SELECT * FROM outbox WHERE job_id = $1", [shot2Row.id])).rows;
  assert.equal(shot2Outbox.length, 0, "Chained child must not enter outbox before parent finishes");
  // Non-inherited shot3 keeps its explicit first_frame untouched!
  assert.equal(shot3Row.input?.params?.h3_inputs?.first_frame ?? shot3Row.input?.references?.[0], explicitFrame.id);

  // Complete shot1 with a real FFmpeg MP4 -> wakeTailFrameChildren extracts real tail frame & wakes shot2!
  const mp4Bytes = generateValidMp4Bytes();
  const vidAssetId = randomUUID();
  const vidPubId = randomUUID().replaceAll("-", "");
  await f.p.storage.put(vidAssetId, mp4Bytes, "video/mp4");
  await f.p.db.query(
    `INSERT INTO assets(id, public_id, workspace_id, owner_id, object_key, mime, size, state, original_kind, metadata)
     VALUES ($1,$2,$3,$4,$5,'video/mp4',$6,'ready','video','{"width":320,"height":180,"duration":0.6}'::jsonb)`,
    [vidAssetId, vidPubId, f.workspace.id, f.admin.id, vidAssetId, mp4Bytes.length],
  );
  await f.p.db.query("INSERT INTO job_assets(job_id, asset_id, role) VALUES ($1,$2,'output')", [shot1Row.id, vidAssetId]);
  await f.p.db.query("UPDATE jobs SET state='completed' WHERE id=$1", [shot1Row.id]);

  const woken = await wakeTailFrameChildren(
    f.p,
    { id: shot1Row.id, workspace_id: f.workspace.id, owner_id: f.admin.id, kind: "video" },
    "completed",
    vidAssetId,
    AbortSignal.timeout(30_000),
  );
  assert.equal(woken, 1);

  const shot2Woken = (await f.p.db.query("SELECT state, input FROM jobs WHERE id=$1", [shot2Row.id])).rows[0];
  assert.equal(shot2Woken.state, "queued");
  const injectedRefs = (shot2Woken.input?.references ?? []) as string[];
  assert.ok(injectedRefs.length >= 1, "Child shot must receive extracted tail frame reference");
  const chainAfterWake = (await f.p.db.query("SELECT * FROM job_tail_chains WHERE child_job_id=$1", [shot2Row.id])).rows;
  assert.equal(chainAfterWake.length, 0, "Dependency row must be cleared once woken");
  const shot2OutboxAfter = (await f.p.db.query("SELECT * FROM outbox WHERE job_id = $1", [shot2Row.id])).rows;
  assert.equal(shot2OutboxAfter.length, 1, "Woken child must be re-inserted into outbox");

  // Parent failure path: create a 2nd canvas where parent fails -> child settles failed & refunds held credits!
  const canvasFail = await f.project(
    [
      { id: "p1", type: "video", title: "父镜", x: 0, y: 0, width: 320, height: 220, prompt: "parent shot", params: {} },
      { id: "c1", type: "video", title: "子镜", x: 360, y: 0, width: 320, height: 220, prompt: "child shot", tail_inherited: true, params: {} },
    ],
    [],
    wsPublicId,
    f.admin,
  );
  const heldBefore = Number((await f.p.db.query("SELECT held FROM wallets WHERE workspace_id=$1", [f.workspace.id])).rows[0].held);
  const failPre = await precheckSvc.precheckCanvas(f.admin, canvasFail, {
    expected_revision: 2,
    node_ids: ["p1", "c1"],
    stages: ["video"],
  });
  const failBatch = await f.runs.batchRun(f.admin, canvasFail, {
    expected_revision: 2,
    price_revision: failPre.price_revision,
    precheck_token: failPre.precheck_token,
    expected_total_credits: failPre.summary.total_credits,
    uid: randomUUID(),
    node_ids: ["p1", "c1"],
    stages: ["video"],
  });
  const p1Job = (await f.p.db.query("SELECT * FROM jobs WHERE public_id=$1", [failBatch.submitted.find((s) => s.node === "p1")!.job_id])).rows[0];
  const c1Job = (await f.p.db.query("SELECT * FROM jobs WHERE public_id=$1", [failBatch.submitted.find((s) => s.node === "c1")!.job_id])).rows[0];
  const c1Chain = (await f.p.db.query("SELECT * FROM job_tail_chains WHERE child_job_id=$1", [c1Job.id])).rows;
  assert.equal(c1Chain.length, 1);

  await f.p.db.transaction(async (sql) => {
    await f.p.settle(sql, p1Job, "failed", undefined, "parent failed");
  });
  await wakeTailFrameChildren(
    f.p,
    { id: p1Job.id, workspace_id: f.workspace.id, owner_id: f.admin.id, kind: "video" },
    "failed",
    undefined,
    AbortSignal.timeout(30_000),
  );
  const c1After = (await f.p.db.query("SELECT state, error FROM jobs WHERE id=$1", [c1Job.id])).rows[0];
  assert.equal(c1After.state, "failed");
  assert.match(String(c1After.error), /前置镜头生成失败/);
  const heldAfter = Number((await f.p.db.query("SELECT held FROM wallets WHERE workspace_id=$1", [f.workspace.id])).rows[0].held);
  assert.equal(heldAfter, heldBefore, "Both failed parent and cancelled child holds must be fully released");
});

test("#11 F016/F019: explicit generation_mode overrides stale params.h3.mode on H3 video submission and gridCrop outputs valid PNG", async (t) => {
  const f = await canvasRunsFixture();
  t.after(() => f.cleanup());
  const wsPublicId = String(f.workspace.public_id);
  const refImg = await seedImageAsset(f, "#338855", 640, 360);

  // H3 video node where params.h3.mode is stale "frames", but explicit generation_mode is "omni_ref"
  const canvasId = await f.project(
    [
      {
        id: "img_grid",
        type: "image",
        title: "宫格预览图",
        x: 0,
        y: 0,
        width: 320,
        height: 220,
        prompt: "2x2 storyboard grid",
        generation_mode: "grid_preview",
        grid_layout: "2x2",
        media_id: refImg.publicId,
        use_media: true,
        params: {},
      },
      {
        id: "vid_h3",
        type: "video",
        title: "H3 全能参考镜头",
        x: 380,
        y: 0,
        width: 320,
        height: 220,
        prompt: "character walking through neon street",
        generation_mode: "omni_ref",
        cinematography: { shot_size: "特写", camera_movement: "缓推" },
        params: {
          model: "MiniMax H3",
          h3: {
            mode: "frames",
            first_frame: refImg.publicId,
            last_frame: null,
            video_audio: [],
          },
        },
      },
    ],
    [],
    wsPublicId,
    f.admin,
  );

  // Grid crop extracts 320x180 cell from 640x360 image cleanly
  const cropped = await f.canvases.gridCrop(f.admin, canvasId, "img_grid", {
    rows: 2,
    cols: 2,
    row: 0,
    col: 1,
  });
  assert.equal(cropped.width, 320);
  assert.equal(cropped.height, 180);
  assert.ok(cropped.asset_id);

  // Submitting vid_h3 honors generation_mode="omni_ref" -> mode="reference" (NOT stale "frames"!)
  const run = await f.runs.generate(f.admin, canvasId, "vid_h3", {
    expected_revision: 2,
    uid: randomUUID(),
  });
  const job = (await f.p.db.query("SELECT input, original_view FROM jobs WHERE public_id=$1", [run.id])).rows[0];
  assert.equal(job.original_view?.h3_inputs?.mode, "reference");
  assert.match(String(job.input?.prompt ?? ""), /特写/);
  assert.match(String(job.input?.prompt ?? ""), /缓推/);
});

test("#12 F009/F032: character asset pack supports turnaround views generation+binding, reference audio slot, and lock/global access enforcement", async (t) => {
  const f = await canvasRunsFixture();
  t.after(() => f.cleanup());
  const packs = new OriginalPacks(f.p);
  const wsPublicId = String(f.workspace.public_id);

  const imgFront = await seedImageAsset(f, "#225588");
  const imgSide = await seedImageAsset(f, "#558822");
  const imgBack = await seedImageAsset(f, "#882255");
  const imgSheet = await seedImageAsset(f, "#444444");

  // Seed a reference audio asset
  const audioId = randomUUID();
  const audioPubId = randomUUID().replaceAll("-", "");
  await f.p.storage.put(audioId, Buffer.from("ID3dummy"), "audio/mpeg");
  await f.p.db.query(
    `INSERT INTO assets(id, public_id, workspace_id, owner_id, object_key, mime, size, state, original_kind, metadata)
     VALUES ($1,$2,$3,$4,$5,'audio/mpeg',8,'ready','ref_audio','{"name":"林墨参考音.mp3"}'::jsonb)`,
    [audioId, audioPubId, f.workspace.id, f.admin.id, audioId],
  );

  // Create character pack with voice_profile.ref_audio_asset_id
  const created = await packs.save(
    f.admin,
    {
      name: "林墨定妆",
      purpose: "subject",
      description: "黑风衣短发侦探",
      media: [imgFront.publicId],
      voice_profile: {
        voice_id: "zh-CN-YunxiNeural",
        rate: "-10%",
        ref_audio_asset_id: audioPubId,
      },
    },
    wsPublicId,
  );
  assert.equal(created.voice_profile?.ref_audio_asset_id, audioPubId);

  // Generate turnaround view ("front") -> returns valid job_id
  const gen = await packs.turnaround(
    f.admin,
    created.id,
    { uid: randomUUID(), view: "front", ratio: "16:9", resolution: "2K" },
    wsPublicId,
  );
  assert.ok("job_id" in gen && gen.job_id);

  // Bind front/side/back/sheet views inline -> persisted and returned on list()
  const bound = await packs.turnaround(
    f.admin,
    created.id,
    {
      views: {
        front: imgFront.publicId,
        side: imgSide.publicId,
        back: imgBack.publicId,
        sheet: imgSheet.publicId,
      },
    },
    wsPublicId,
  );
  assert.ok("pack" in bound);
  assert.equal(bound.pack.turnaround_views?.front, imgFront.publicId);
  assert.equal(bound.pack.turnaround_views?.side, imgSide.publicId);
  assert.equal(bound.pack.turnaround_views?.back, imgBack.publicId);
  assert.equal(bound.pack.turnaround_views?.sheet, imgSheet.publicId);

  const listed = await packs.list(f.admin, wsPublicId);
  const found = listed.packs.find((p) => p.id === created.id);
  assert.ok(found);
  assert.equal(found.voice_profile?.ref_audio_asset_id, audioPubId);
  assert.equal(found.turnaround_views?.back, imgBack.publicId);

  // Locking prevents updates and turnaround re-binding (409/423)
  await packs.setLock(f.admin, created.id, true, wsPublicId);
  await assert.rejects(
    packs.turnaround(f.admin, created.id, { views: { front: null } }, wsPublicId),
    (err: unknown) => [409, 423].includes(Number((err as { status?: number })?.status)),
  );
});

test("#19 F026: 4-level Series -> Season -> Episode -> Scene hierarchy supports multiple seasons/episodes/scenes while keeping flat canvas list intact", async (t) => {
  const f = await canvasRunsFixture();
  t.after(() => f.cleanup());
  const seriesSvc = new OriginalSeries(f.p);
  const wsPublicId = String(f.workspace.public_id);

  const created = await seriesSvc.create(
    f.admin,
    { title: "暗夜侦探录", synopsis: "悬疑连续剧" },
    wsPublicId,
  );

  // Season 1: 2 episodes, Episode 1 has 2 scenes
  const s1e1 = await seriesSvc.createEpisode(f.admin, created.id, { season_no: 1, episode_no: 1, title: "雨夜序幕" });
  await seriesSvc.createEpisode(f.admin, created.id, { season_no: 1, episode_no: 2, title: "失踪线索" });
  const s1e1sc1 = await seriesSvc.createScene(
    f.admin,
    created.id,
    s1e1.id,
    { scene_no: 1, title: "码头相遇", summary: "主角在雨夜码头发现第一条线索", create_canvas: true },
  );
  const s1e1sc2 = await seriesSvc.createScene(
    f.admin,
    created.id,
    s1e1.id,
    { scene_no: 2, title: "旧仓库追逐", summary: "黑衣人逃入仓库", create_canvas: true },
  );
  assert.ok(s1e1sc1.canvas_id);
  assert.ok(s1e1sc2.canvas_id);

  // Season 2: 2 episodes, Episode 1 has 2 scenes
  const s2e1 = await seriesSvc.createEpisode(f.admin, created.id, { season_no: 2, episode_no: 1, title: "重返旧城" });
  await seriesSvc.createEpisode(f.admin, created.id, { season_no: 2, episode_no: 2, title: "真相浮现" });
  await seriesSvc.createScene(
    f.admin,
    created.id,
    s2e1.id,
    { scene_no: 1, title: "列车抵达", summary: "主角返回旧城车站", create_canvas: true },
  );
  await seriesSvc.createScene(
    f.admin,
    created.id,
    s2e1.id,
    { scene_no: 2, title: "钟楼对峙", summary: "最终线索在钟楼揭晓", create_canvas: true },
  );

  // Verify 4-level tree structure
  const listed = await seriesSvc.list(f.admin, wsPublicId);
  const found = listed.series.find((s) => s.id === created.id);
  assert.ok(found);
  assert.equal(found.seasons.length, 2);
  assert.equal(found.seasons[0].season_no, 1);
  assert.equal(found.seasons[0].episodes.length, 2);
  assert.equal(found.seasons[0].episodes[0].scenes.length, 2);
  assert.equal(found.seasons[1].season_no, 2);
  assert.equal(found.seasons[1].episodes.length, 2);
  assert.equal(found.seasons[1].episodes[0].scenes.length, 2);

  // Update scene works cleanly
  await seriesSvc.updateScene(f.admin, created.id, s1e1.id, s1e1sc2.id, { title: "旧仓库夜战" });
  const afterUpdate = (await seriesSvc.list(f.admin, wsPublicId)).series.find((s) => s.id === created.id)!;
  assert.equal(afterUpdate.seasons[0].episodes[0].scenes[1].title, "旧仓库夜战");

  // Backward compatibility: flat canvases.list() opens and includes bound episode & scene canvases!
  const flatCanvases = await f.canvases.list(f.admin, wsPublicId);
  const flatIds = new Set(flatCanvases.projects.map((p) => p.id));
  assert.ok(flatIds.has(s1e1.canvas_id!), "Episode bound canvas must remain accessible in flat list");
  assert.ok(flatIds.has(s1e1sc1.canvas_id!), "Scene bound canvas must remain accessible in flat list");

  // Scene canvas itself can be fetched cleanly via OriginalCanvases.get()
  const openedSceneCanvas = await f.canvases.get(f.admin, s1e1sc1.canvas_id!);
  assert.ok(openedSceneCanvas.document.nodes.some((n: { type?: string }) => n.type === "sticky"));
});

test("#9 F010 concurrent retry & crash recovery: in-flight retry waits for full 2-item receipt (never seals 1-item half-receipt), survives revision bump, and stale crash recovery resumes remaining items idempotently", async (t) => {
  const f = await canvasRunsFixture();
  t.after(() => f.cleanup());

  const precheck = new OriginalBatchPrecheck(f.p);
  const wsPublicId = String(f.workspace.public_id);

  // Canvas with two image nodes
  const projectKey = await f.project(
    [
      {
        id: "img1",
        type: "image",
        title: "图一",
        x: 0,
        y: 0,
        width: 280,
        height: 200,
        prompt: "first concurrent batch image",
        params: { ratio: "16:9", resolution: "1K" },
      },
      {
        id: "img2",
        type: "image",
        title: "图二",
        x: 340,
        y: 0,
        width: 280,
        height: 200,
        prompt: "second concurrent batch image",
        params: { ratio: "16:9", resolution: "1K" },
      },
    ],
    [],
    wsPublicId,
    f.admin,
  );
  const docBefore = await f.canvases.get(f.admin, projectKey);
  assert.equal(docBefore.revision, 2);

  const pre = await precheck.precheckCanvas(f.admin, projectKey, {
    expected_revision: 2,
    node_ids: ["img1", "img2"],
    stages: ["image"],
  });
  assert.equal(pre.executable_keys.length, 2);
  const expectedTotalCredits = pre.summary.total_credits;
  assert.ok(expectedTotalCredits > 0);

  // Intercept `f.runs.generate` so img1 finishes immediately, signals us, and img2 pauses 350ms
  let notifyImg1Done!: () => void;
  const img1Done = new Promise<void>((resolve) => {
    notifyImg1Done = resolve;
  });
  const origGenerate = f.runs.generate.bind(f.runs);
  let delayImg2Once = true;
  (f.runs as any).generate = async (
    user: any,
    proj: string,
    nodeId: string,
    value: any,
  ) => {
    if (nodeId === "img2" && delayImg2Once) {
      delayImg2Once = false;
      notifyImg1Done();
      await new Promise((r) => setTimeout(r, 350));
    }
    return origGenerate(user, proj, nodeId, value);
  };

  const batchUid = randomUUID();
  const payload = {
    uid: batchUid,
    expected_revision: 2,
    node_ids: ["img1", "img2"],
    stages: ["image"],
    precheck_token: pre.precheck_token,
    expected_total_credits: expectedTotalCredits,
  };

  // Start Request 1
  const req1Promise = f.runs.batchRun(f.admin, projectKey, payload);
  // Wait until img1 is ALREADY accepted in DB & img2 is mid-delay!
  await img1Done;

  // Verify DB currently has status='in_progress' and exactly 1 linked job so far
  const midRow = (
    await f.p.db.query(
      `SELECT status FROM canvas_batch_runs WHERE uid = $1`,
      [batchUid],
    )
  ).rows[0];
  assert.equal(midRow?.status, "in_progress");

  // Launch concurrent Request 2 with the EXACT SAME UID right in the middle of Request 1!
  const req2Promise = f.runs.batchRun(f.admin, projectKey, payload);

  const [res1, res2] = await Promise.all([req1Promise, req2Promise]);
  // Restore generate
  (f.runs as any).generate = origGenerate;

  // BOTH callers must receive the COMPLETE 2-item / full-credit receipt (never a 1-item half-receipt!)
  assert.equal(res1.submitted.length, 2);
  assert.equal(res2.submitted.length, 2);
  assert.deepEqual(res2, res1);
  assert.equal(res1.total_credits, expectedTotalCredits);
  assert.equal(res2.total_credits, expectedTotalCredits);

  // Another tab renames canvas (revision 2 -> 3); subsequent retry with SAME UID still gets full 2-item receipt!
  await f.canvases.save(f.admin, projectKey, {
    title: "并发批次后重命名",
    expected_revision: 2,
    document: docBefore.document,
  });
  const res3 = await f.runs.batchRun(f.admin, projectKey, {
    uid: batchUid,
    expected_revision: 2,
    node_ids: ["img1", "img2"],
    stages: ["image"],
  });
  assert.equal(res3.submitted.length, 2);
  assert.deepEqual(res3, res1);

  // Settle first batch's queued image jobs so the user's concurrent active image quota (3) doesn't cap the next subtest
  await f.p.db.query(
    `UPDATE jobs SET state = 'completed' WHERE public_id = ANY($1::bigint[])`,
    [res1.submitted.map((s) => s.job_id)],
  );

  // Crash recovery check: simulate a real process crash after item 1 was dispatched & row went stale (> 60s)
  const crashProjKey = await f.project(
    [
      {
        id: "c_img1",
        type: "image",
        title: "崩溃恢复图一",
        x: 0,
        y: 0,
        width: 280,
        height: 200,
        prompt: "crash recovery image 1",
        params: { ratio: "16:9", resolution: "1K" },
      },
      {
        id: "c_img2",
        type: "image",
        title: "崩溃恢复图二",
        x: 340,
        y: 0,
        width: 280,
        height: 200,
        prompt: "crash recovery image 2",
        params: { ratio: "16:9", resolution: "1K" },
      },
    ],
    [],
    wsPublicId,
    f.admin,
  );
  const crashPre = await precheck.precheckCanvas(f.admin, crashProjKey, {
    expected_revision: 2,
    node_ids: ["c_img1", "c_img2"],
    stages: ["image"],
  });
  const crashUid = randomUUID();
  const { uuid5 } = await import("@fumiao/platform/uuid.js");
  const { hash } = await import("@fumiao/platform/security.js");
  const firstJob = await f.runs.generate(f.admin, crashProjKey, "c_img1", {
    expected_revision: 2,
    uid: uuid5(crashUid, `batch:${crashProjKey}:c_img1:image`),
  });
  const projUuidRow = (
    await f.p.db.query("SELECT id FROM documents WHERE public_id = $1", [
      crashProjKey,
    ])
  ).rows[0];
  const crashReqHash = hash(
    JSON.stringify({
      node_ids: ["c_img1", "c_img2"],
      stages: ["image"],
    }),
  );
  await f.p.db.query(
    `INSERT INTO canvas_batch_runs(owner_id, project_id, uid, request_hash, status, expected_revision, allowed_keys, response, updated_at)
     VALUES ($1, $2, $3, $4, 'in_progress', 2, $5::text[], '{}'::jsonb, now() - interval '2 minutes')`,
    [
      f.admin.id,
      projUuidRow.id,
      crashUid,
      crashReqHash,
      crashPre.executable_keys,
    ],
  );

  // Retry with the same crashUid -> reclaims stale in_progress, keeps c_img1 idempotently, submits c_img2, marks completed!
  const recovered = await f.runs.batchRun(f.admin, crashProjKey, {
    uid: crashUid,
    expected_revision: 2,
    node_ids: ["c_img1", "c_img2"],
    stages: ["image"],
  });
  assert.equal(recovered.submitted.length, 2, JSON.stringify(recovered));
  assert.equal(
    recovered.submitted.find((s) => s.node === "c_img1")?.job_id,
    firstJob.id,
    "Crash recovery must reuse c_img1's original idempotent job_id",
  );
  assert.ok(recovered.submitted.find((s) => s.node === "c_img2")?.job_id);
  assert.equal(recovered.total_credits, crashPre.summary.total_credits);
  const finalStatus = (
    await f.p.db.query("SELECT status FROM canvas_batch_runs WHERE uid = $1", [
      crashUid,
    ])
  ).rows[0];
  assert.equal(finalStatus?.status, "completed");
});

test("recovering an interrupted batch after a canvas edit preserves accepted jobs and skips remaining work", async (t) => {
  const f = await canvasRunsFixture();
  t.after(() => f.cleanup());

  const nodeIds = ["accepted", "pending"];
  const projectKey = await f.project(
    nodeIds.map((id, index) => ({
      id,
      type: "image",
      x: index * 340,
      y: 0,
      prompt: `Batch image ${id}`,
      params: { ratio: "16:9", resolution: "1K" },
    })),
  );
  const uid = randomUUID();
  const selection = { expected_revision: 2, node_ids: nodeIds, stages: ["image"] };
  const payload = { ...selection, uid };
  const precheck = await new OriginalBatchPrecheck(f.p).precheckCanvas(f.admin, projectKey, selection);
  assert.deepEqual([...precheck.executable_keys].sort(), ["accepted:image", "pending:image"]);
  const { uuid5 } = await import("@fumiao/platform/uuid.js");
  const { hash } = await import("@fumiao/platform/security.js");
  const accepted = await f.runs.generate(f.admin, projectKey, "accepted", {
    expected_revision: 2,
    uid: uuid5(uid, `batch:${projectKey}:accepted:image`),
  });
  await f.p.db.query(
    `INSERT INTO canvas_batch_runs(owner_id, project_id, uid, request_hash, status, expected_revision, allowed_keys, response, updated_at)
     SELECT $1, id, $2, $3, 'in_progress', 2, $4::text[], '{}'::jsonb, now() - interval '2 minutes'
       FROM documents WHERE public_id = $5`,
    [f.admin.id, uid, hash(JSON.stringify({ node_ids: nodeIds, stages: ["image"] })), precheck.executable_keys, projectKey],
  );
  await f.canvases.save(f.admin, projectKey, {
    title: "画布节点已删除",
    expected_revision: 2,
    document: { nodes: [], edges: [] },
  });

  const receipt = await f.runs.batchRun(f.admin, projectKey, payload);
  assert.deepEqual(receipt.submitted, [{ node: "accepted", stage: "image", job_id: accepted.id }]);
  assert.deepEqual(receipt.skipped.map(({ node, stage }) => ({ node, stage })), [{ node: "pending", stage: "image" }]);
  assert.equal(receipt.total_credits, 2);
  assert.deepEqual(await f.runs.batchRun(f.admin, projectKey, payload), receipt);
  const wallet = await f.p.db.query("SELECT held FROM wallets WHERE workspace_id=$1", [f.workspace.id]);
  assert.equal(Number(wallet.rows[0].held), 2);
});

test("PR #223 Item 1 & 2: Series bible editor pins expectedRevision across episode-refresh loads, preserves 409 drafts, and rejects malformed structured JSON without corrupting notes", async (t) => {
  const f = await canvasRunsFixture();
  t.after(() => f.cleanup());
  const seriesSvc = new OriginalSeries(f.p);
  const wsPublicId = String(f.workspace.public_id);

  const {
    openSeriesBibleSession,
    applyLoadedSeriesListToBibleSession,
    submitSeriesBibleSession,
    parseBibleDraft,
  } = await import("../../apps/web/canvas/series-bible.js");

  // 1. P1 concurrency: Actor A opens bible editor at rev 1 -> Actor B saves rev 2 -> Actor A creates an episode triggering list refresh (live rev = 2) -> Actor A submits stale draft -> 409 conflict + draft retained!
  const created = await seriesSvc.create(
    f.admin,
    {
      title: "双人并发剧集",
      synopsis: "主线梗概",
      bible: { notes: "初代世界观 v1" },
    },
    wsPublicId,
  );
  assert.equal(created.revision, 1);

  let sessionA = openSeriesBibleSession({
    id: created.id,
    revision: created.revision,
    bible: created.bible,
  });
  assert.equal(sessionA.expectedRevision, 1);
  assert.equal(sessionA.mode, "notes");
  sessionA = { ...sessionA, draft: "Actor A 基于 v1 编写的旧草稿" };

  // Collaborator B saves a new worldbuilding v2 on the server
  const updatedByB = await seriesSvc.update(f.admin, created.id, {
    expected_revision: 1,
    bible: { notes: "队友 B 已保存的新世界观 v2" },
  });
  assert.equal(updatedByB.revision, 2);

  // Actor A creates a new episode, which triggers load() and refreshes seriesList to revision = 2!
  await seriesSvc.createEpisode(f.admin, created.id, {
    season_no: 1,
    episode_no: 1,
    title: "第一集",
  });
  const refreshedList = await seriesSvc.list(f.admin, wsPublicId);
  const refreshedItem = refreshedList.series.find((s) => s.id === created.id)!;
  assert.equal(refreshedItem.revision, 2);

  sessionA = applyLoadedSeriesListToBibleSession(sessionA, refreshedList.series)!;
  assert.equal(sessionA.expectedRevision, 1, "expectedRevision must stay pinned to editor-open revision 1");
  assert.equal(sessionA.draft, "Actor A 基于 v1 编写的旧草稿");

  const outcome = await submitSeriesBibleSession(sessionA, async (id, payload) => {
    return seriesSvc.update(f.admin, id, payload);
  });
  assert.equal(outcome.ok, false, "stale bible save must fail with 409 instead of overwriting B's v2");
  if (!outcome.ok) {
    assert.equal(outcome.status, 409);
    assert.equal(outcome.session.conflicted, true);
    assert.equal(outcome.session.draft, "Actor A 基于 v1 编写的旧草稿");
    assert.equal(outcome.session.expectedRevision, 1);
  }

  // Server must still hold Collaborator B's v2 worldbuilding!
  const serverAfterConflict = (await seriesSvc.list(f.admin, wsPublicId)).series.find(
    (s) => s.id === created.id,
  )!;
  assert.deepEqual(serverAfterConflict.bible, { notes: "队友 B 已保存的新世界观 v2" });

  // 2. P2 structured vs plain-text notes mode:
  const legacyStructured = await seriesSvc.create(
    f.admin,
    {
      title: "结构化设定剧集",
      synopsis: "",
      bible: {
        era: "2088",
        factions: ["霓虹社", "铁幕局"],
        protagonist: { name: "林默", role: "私家侦探" },
      },
    },
    wsPublicId,
  );
  const structuredSession = openSeriesBibleSession(legacyStructured);
  assert.equal(structuredSession.mode, "structured");

  // Leaving a trailing comma in structured mode MUST reject without calling PUT or injecting broken JSON into notes!
  let putCalls = 0;
  const brokenJsonSession = {
    ...structuredSession,
    draft: '{\n  "era": "2099",\n  "factions": ["霓虹社"],\n}',
  };
  const brokenOutcome = await submitSeriesBibleSession(
    brokenJsonSession,
    async (id, payload) => {
      putCalls += 1;
      return seriesSvc.update(f.admin, id, payload);
    },
  );
  assert.equal(brokenOutcome.ok, false);
  assert.equal(putCalls, 0, "invalid structured JSON must not send PUT request");
  if (!brokenOutcome.ok) {
    assert.match(brokenOutcome.error, /JSON/);
    assert.equal(brokenOutcome.session.draft, brokenJsonSession.draft);
  }

  // Fixing the trailing comma saves cleanly and round-trips structured fields losslessly without extra notes key
  const validJsonSession = {
    ...structuredSession,
    draft: JSON.stringify(
      {
        era: "2099",
        factions: ["霓虹社", "铁幕局"],
        protagonist: { name: "林默", role: "首席调查员" },
      },
      null,
      2,
    ),
  };
  const validOutcome = await submitSeriesBibleSession(
    validJsonSession,
    async (id, payload) => seriesSvc.update(f.admin, id, payload),
  );
  assert.equal(validOutcome.ok, true);
  const savedStructured = (await seriesSvc.list(f.admin, wsPublicId)).series.find(
    (s) => s.id === legacyStructured.id,
  )!;
  assert.deepEqual(savedStructured.bible, {
    era: "2099",
    factions: ["霓虹社", "铁幕局"],
    protagonist: { name: "林默", role: "首席调查员" },
  });
  assert.equal("notes" in savedStructured.bible, false);

  // Plain-text mode stores { notes } cleanly even if text contains braces or punctuation
  assert.deepEqual(parseBibleDraft("纯文本世界观：第一幕{雨夜}", "notes"), {
    notes: "纯文本世界观：第一幕{雨夜}",
  });
});

test("PR #223 Item 3: Standalone scene canvas includes series.bible worldbuilding sticky note even when synopsis and scene summary are empty", async (t) => {
  const f = await canvasRunsFixture();
  t.after(() => f.cleanup());
  const seriesSvc = new OriginalSeries(f.p);
  const wsPublicId = String(f.workspace.public_id);

  // Case A: Series with only plain-text bible ({ notes }) and empty synopsis/summary
  const notesSeries = await seriesSvc.create(
    f.admin,
    {
      title: "浮空城编年史",
      synopsis: "",
      bible: { notes: "蒸汽朋克浮空群岛，全城依赖以太反应堆供能" },
    },
    wsPublicId,
  );
  const epA = await seriesSvc.createEpisode(f.admin, notesSeries.id, {
    season_no: 1,
    episode_no: 1,
    title: "起航",
  });
  const scA = await seriesSvc.createScene(f.admin, notesSeries.id, epA.id, {
    scene_no: 1,
    title: "反应堆甲板",
    summary: "",
    create_canvas: true,
  });
  assert.ok(scA.canvas_id);
  const canvasA = await f.canvases.get(f.admin, scA.canvas_id!);
  const stickyA = canvasA.document.nodes.find(
    (n: { type?: string }) => n.type === "sticky",
  ) as { text?: string } | undefined;
  assert.ok(stickyA, "standalone scene canvas must contain a sticky note when bible is set");
  assert.match(stickyA.text ?? "", /世界观与设定：[\s\S]*蒸汽朋克浮空群岛/);

  // Case B: Series with structured JSON bible and empty synopsis/summary
  const structSeries = await seriesSvc.create(
    f.admin,
    {
      title: "深海迷航",
      synopsis: "",
      bible: { depth: "8000m", lighting: "生物荧光冷蓝" },
    },
    wsPublicId,
  );
  const epB = await seriesSvc.createEpisode(f.admin, structSeries.id, {
    season_no: 1,
    episode_no: 1,
    title: "下潜",
  });
  const scB = await seriesSvc.createScene(f.admin, structSeries.id, epB.id, {
    scene_no: 1,
    title: "减压舱",
    summary: "",
    create_canvas: true,
  });
  assert.ok(scB.canvas_id);
  const canvasB = await f.canvases.get(f.admin, scB.canvas_id!);
  const stickyB = canvasB.document.nodes.find(
    (n: { type?: string }) => n.type === "sticky",
  ) as { text?: string } | undefined;
  assert.ok(stickyB, "standalone scene canvas must contain a sticky note for structured bible");
  assert.match(stickyB.text ?? "", /生物荧光冷蓝/);
});
