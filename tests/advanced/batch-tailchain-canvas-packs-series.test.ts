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
import { directorBasis } from "@fumiao/web-compat/director.js";
import { OriginalBatchPrecheck } from "@fumiao/original-api/batch-precheck.js";
import { parseCanvasDocument } from "@fumiao/original-api/canvas-draft.js";
import { inspectDirectorShotInputs, resolveDirectorInput, resolveDirectorInputBasis } from "@fumiao/original-api/director-inputs.js";
import { OriginalGeneration } from "@fumiao/original-api/generation.js";
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

test("director input basis covers resolved reference and voice", async (t) => {
  const f = await canvasRunsFixture();
  t.after(() => f.cleanup());
  await ensureBuiltinEdgeTts(f.p);
  const packs = new OriginalPacks(f.p);
  const ws = String(f.workspace.public_id);
  const img = await seedImageAsset(f);
  const other = await seedImageAsset(f, "#aa7744");
  const voice = (voiceId: string) => ({
    name: "小林",
    purpose: "subject",
    media: [img.publicId],
    voice_profile: { model: "edge-tts", voice_id: voiceId },
  });
  const pack = await packs.save(f.admin, voice("zh-CN-XiaoxiaoNeural"), ws);
  const nodes = [
    { id: "image", type: "image", title: "角色参考", x: 0, y: 0 },
    { id: "previous", type: "video", title: "首镜", x: 0, y: 0 },
    { id: "shot", type: "video", x: 0, y: 0, prompt: "小林抬头", dialogue_lines: [
      { id: "line", speaker: "小林", pack_id: pack.id, text: "天亮了。" },
    ] },
  ];
  const edges = [{ id: "ref", source: "image", target: "shot" }];
  const publicId = await f.project(nodes, edges, ws);
  const row = await f.canvases.project(f.db, f.admin, publicId);
  const project = { id: String(row.id), workspace_id: f.workspace.id };
  const document = parseCanvasDocument({ nodes, edges, shots: ["previous", "shot"] });
  const pinned = parseCanvasDocument({
    ...document,
    nodes: [{ ...nodes[0], active_job: 801 }, ...nodes.slice(1)],
  });
  const mediaPinned = parseCanvasDocument({
    ...document,
    nodes: [{ ...nodes[0], use_media: true, media_id: img.publicId }, ...nodes.slice(1)],
  });
  const video = { node_id: "shot", stage: "video" } as const;
  const dialogue = { node_id: "shot", stage: "dialogue", line_id: "line" } as const;
  const editShot = (graph: typeof document, patch: Partial<typeof document.nodes[number]>) => ({
    ...graph,
    nodes: graph.nodes.map((node) => node.id === "shot" ? { ...node, ...patch } : node),
  });
  const inPack = editShot(pinned, { asset_packs: [{ id: pack.id, revision: pack.revision }] });
  const basis = (target: typeof video | typeof dialogue, graph = document) =>
    f.db.transaction((sql) => resolveDirectorInputBasis(sql, project, graph, target));
  const inspect = (graph: typeof document) => f.db.transaction((sql) =>
    inspectDirectorShotInputs(sql, project, graph, graph.nodes.find((node) => node.id === "shot")!),
  );
  await assert.rejects(basis(video), { status: 409, message: /角色参考.*尚未就绪/ });
  await f.job(801, "image", "completed", img.id);
  await f.link(publicId, "image", 801);
  const before = await basis(video);
  const pinnedBefore = await basis(video, pinned);
  const voiceBefore = await basis(dialogue);
  assert.ok(await basis(video, inPack));
  const followed = await inspect(document);
  assert.match(followed.visual_issues.join(), /请固定参考图.*角色参考/);
  const confirmed = await inspect(pinned);
  assert.equal(confirmed.story_basis, followed.story_basis);
  assert.equal(followed.material_basis, null);
  assert.ok(confirmed.material_basis);
  const revisedStory = await inspect(editShot(pinned, { prompt: "小林低头", x: 300 }));
  assert.notEqual(revisedStory.story_basis, confirmed.story_basis);
  assert.equal(revisedStory.material_basis, confirmed.material_basis);
  assert.deepEqual(await inspect(editShot(pinned, { x: 450 })), confirmed);
  await f.job(802, "image", "completed", other.id);
  await f.link(publicId, "image", 802);
  await packs.save(f.admin, { ...voice("zh-CN-YunxiNeural"), expected_revision: pack.revision }, ws, pack.id);
  assert.notEqual(await basis(video), before);
  assert.equal(await basis(video, pinned), pinnedBefore);
  assert.equal(await basis(video, mediaPinned), pinnedBefore);
  assert.notEqual(await basis(dialogue), voiceBefore);
  const revisedVoice = await inspect(pinned);
  assert.notEqual(revisedVoice.material_basis, confirmed.material_basis);
  assert.deepEqual(revisedVoice.audio_inputs["shot:dialogue:line"], {
    basis: revisedVoice.audio_input_bases["shot:dialogue:line"], model: "edge-tts",
    pack_id: pack.id, voice_id: "zh-CN-YunxiNeural", instruction: "",
  });
  await assert.rejects(basis(video, inPack), { status: 409, message: /素材包.*小林.*已更新/ });
  await assert.rejects(basis(video, editShot(document, { tail_inherited: true })), { status: 409, message: /首镜.*自动尾帧/ });
  await assert.rejects(basis(dialogue, editShot(document, { dialogue_lines: [{
    id: "line", speaker: "小林", pack_id: randomUUID().replaceAll("-", ""), text: "天亮了。",
  }] })), { status: 409, message: /角色素材包不可用/ });
});

test("director Flow continuation binds the private provider output and the actual workspace video", async (t) => {
  const f = await canvasRunsFixture();
  t.after(() => f.cleanup());
  const clip = await f.asset(randomUUID().replaceAll("-", ""), "video");
  const source = await f.job(801, "video", "completed", clip.id);
  const sourceModel = "flow:veo-3.1-fast-extend-8s-landscape";
  await f.db.query(`UPDATE jobs SET provider_model=$2,plugin_id='flow',
    original_view='{"ratio":"16:9","actual":{"flow_media_id":"private-first"}}' WHERE id=$1`, [source.id, sourceModel]);
  const video = { node_id: "shot", stage: "video" } as const;
  const document = parseCanvasDocument({ nodes: [{
    id: video.node_id, x: 0, y: 0, type: "video", prompt: "镜头向前", params: { model: sourceModel, flow_source_job: 801 },
  }], edges: [] });
  const publicId = await f.project();
  const row = await f.canvases.project(f.db, f.admin, publicId);
  const project = { id: String(row.id), workspace_id: f.workspace.id };
  const resolve = () => f.db.transaction((sql) => resolveDirectorInput(sql, project, document, video));
  const before = await resolve();
  assert.equal(before.stage, "video");
  assert.ok(before.stage === "video" && before.references.some((item) => item.id === clip.public_id));
  await f.db.query("UPDATE jobs SET result=$2::json WHERE id=$1", [
    source.id, JSON.stringify({ assets: [clip.id], usage: { flow_media_id: "private-second" } }),
  ]);
  assert.notEqual((await resolve()).basis, before.basis);
  await f.db.query("UPDATE assets SET state='uploading' WHERE id=$1", [clip.id]);
  await assert.rejects(resolve(), { message: /续写来源/ });
  await f.db.query("UPDATE studio_catalog SET hidden=false WHERE id=$1", [sourceModel]);
  await f.db.query("UPDATE studio_policy SET flags=flags || jsonb_build_object($1::text,true)", [sourceModel]);
  await f.db.query("UPDATE studio_workspace_policy SET flags=flags || jsonb_build_object($1::text,true) WHERE workspace_id=$2", [sourceModel, f.workspace.id]);
  const ordinary = new OriginalGeneration(f.p);
  const draft = await ordinary.parse("video", { uid: randomUUID(), model: sourceModel, prompt: "镜头向前", flow_source_job: 801 });
  const accepted = await ordinary.submit(f.admin, draft, String(f.workspace.public_id));
  const submitted = (await f.db.query("SELECT input FROM jobs WHERE public_id=$1", [accepted.id])).rows[0];
  assert.equal(submitted.input.params.source_media_id, "private-second", "ordinary continuation can use a retained provider output without a local preview");
  await f.db.query("UPDATE jobs SET deleted_at=now() WHERE id=$1", [source.id]);
  await assert.rejects(resolve(), { message: /续写来源/ });

  const active = await f.job(802, "video", "running");
  await f.db.query("UPDATE jobs SET plugin_id='flow' WHERE id=$1", [active.id]);
  const activeGraph = parseCanvasDocument({ nodes: [{
    id: video.node_id, x: 0, y: 0, type: "video", prompt: "镜头向前", params: { model: sourceModel, flow_source_job: 802 },
  }], edges: [] });
  let signalLocked!: () => void;
  let signalRelease!: () => void;
  const locked = new Promise<void>((resolve) => { signalLocked = resolve; });
  const release = new Promise<void>((resolve) => { signalRelease = resolve; });
  const worker = f.db.transaction(async (sql) => {
    await sql.query("SELECT id FROM jobs WHERE id=$1 FOR UPDATE", [active.id]);
    signalLocked();
    await release;
  });
  try {
    await locked;
    await assert.rejects(f.db.transaction(async (sql) => {
      await sql.query("SET LOCAL lock_timeout='500ms'");
      await resolveDirectorInput(sql, project, activeGraph, video, undefined, { lock: true });
    }), { status: 409, message: /续写来源/ });
  } finally {
    signalRelease();
    await worker;
  }
});

test("director pack inputs match actual submit, including expanded prompt and deduplicated limits", async (t) => {
  const f = await canvasRunsFixture();
  t.after(() => f.cleanup());
  const refs = await Promise.all(Array.from({ length: 10 }, () => f.asset(randomUUID().replaceAll("-", ""))));
  const packs = new OriginalPacks(f.p);
  const ws = String(f.workspace.public_id);
  const main = await packs.save(f.admin, { name: "雨夜", purpose: "scene", description: "窗外灯塔", media: [refs[1].public_id, refs[0].public_id] }, ws);
  const extra = await packs.save(f.admin, { name: "场景组", purpose: "scene", media: refs.slice(2).map((asset) => asset.public_id) }, ws);
  const video = { node_id: "shot", stage: "video" } as const;
  const shot = { id: video.node_id, type: "video", x: 0, y: 0, prompt: "推近窗户", asset_packs: [{ id: main.id, revision: main.revision }] };
  const nodes = [{ id: "ref", type: "image", x: 0, y: 0, media_id: refs[0].public_id, use_media: true }, shot];
  const edges = [{ id: "edge", source: "ref", target: "shot" }];
  const publicId = await f.project(nodes, edges, ws);
  const row = await f.canvases.project(f.db, f.admin, publicId);
  const project = { id: String(row.id), workspace_id: f.workspace.id };
  const graph = (patch = {}) => parseCanvasDocument({ nodes: [nodes[0], { ...shot, ...patch }], edges });
  const inspect = (doc = graph()) => f.db.transaction((sql) => inspectDirectorShotInputs(sql, project, doc, doc.nodes[1]));
  const input = await inspect();
  assert.deepEqual(input.references.map(({ id }) => id), refs.slice(0, 2).map((asset) => asset.public_id));
  const generated = await f.runs.generate(f.admin, publicId, "shot", f.body());
  const job = (await f.db.query("SELECT input FROM jobs WHERE public_id=$1", [generated.id])).rows[0];
  assert.equal(job.input.prompt, `${input.description}\n\n${input.pack_texts.map(({ text }) => text).join("\n\n")}`);
  assert.deepEqual(job.input.references, refs.slice(0, 2).map((asset) => asset.id));
  assert.ok(input.story_basis && input.material_basis);
  const expanded = await inspect(graph({ asset_packs: [...shot.asset_packs, { id: extra.id, revision: extra.revision }] }));
  const tooLong = await inspect(graph({ prompt: "景".repeat(11999) }));
  for (const invalid of [expanded, tooLong]) {
    assert.equal(invalid.material_basis, null);
    assert.match(invalid.visual_issues.join(), /参考图片合计最多 9 张.*12000 字/);
  }
  const newer = await packs.save(f.admin, { name: "雨夜", purpose: "scene", description: "更亮的窗外灯塔", media: main.media, expected_revision: main.revision }, ws, main.id);
  const rebound = await inspect(graph({ asset_packs: [{ id: newer.id, revision: newer.revision }] }));
  assert.equal(rebound.story_basis, input.story_basis);
  assert.notEqual(rebound.material_basis, input.material_basis);
  await f.db.query("UPDATE documents SET body=jsonb_set(body,'{assets}','null') WHERE public_id=$1", [extra.id]);
  const legacy = await inspect(graph({ asset_packs: [{ id: extra.id, revision: extra.revision }] }));
  assert.ok(legacy.material_basis, "legacy descriptive packs can omit their media array");
  assert.deepEqual(legacy.references.map(({ id }) => id), [refs[0].public_id]);
});

test("pack generation rechecks workspace membership after waiting for the wallet", async (t) => {
  const f = await canvasRunsFixture();
  t.after(() => f.cleanup());
  const ws = String(f.team.public_id);
  const ref = await f.asset(randomUUID().replaceAll("-", ""), "ref", f.team);
  const pack = await new OriginalPacks(f.p).save(f.admin, {
    name: "场景说明",
    purpose: "scene",
    media: [ref.public_id],
  }, ws);
  await f.db.query("UPDATE documents SET body=body-'assets' WHERE public_id=$1", [pack.id]);
  const project = await f.project([{
    id: "shot", type: "video", x: 0, y: 0, prompt: "窗边",
    asset_packs: [{ id: pack.id, revision: pack.revision }],
  }], [], ws, f.member);
  const transaction = f.db.transaction.bind(f.db);
  let revoked = false;
  f.db.transaction = (fn) => transaction((sql) => fn({
    query: async <T extends Record<string, unknown>>(query: string, values?: unknown[]) => {
      const result = await sql.query<T>(query, values);
      if (!revoked && query.includes("FROM wallets WHERE workspace_id=$1 FOR UPDATE")) {
        await f.db.query("DELETE FROM members WHERE workspace_id=$1 AND user_id=$2", [f.team.id, f.member.id]);
        revoked = true;
      }
      return result;
    },
  }));
  await assert.rejects(f.runs.generate(f.member, project, "shot", f.body()), { status: 403, message: "无法访问这个工作区" });
  assert.ok(revoked);
  const count = (await f.db.query("SELECT count(*) AS count FROM jobs WHERE workspace_id=$1", [f.team.id])).rows[0];
  assert.equal(Number(count.count), 0);
});

async function saveDirectorCanvas(
  f: Awaited<ReturnType<typeof canvasRunsFixture>>,
  nodes: Parameters<typeof f.project>[0],
  shots: string[],
  edges: Parameters<typeof f.project>[1] = [],
) {
  const precheck = new OriginalBatchPrecheck(f.p);
  const scriptId = randomUUID().replaceAll("-", "");
  await f.db.query(
    "INSERT INTO workspace_script_documents(id, public_id, workspace_id, owner_id, path) VALUES ($1,$2,$3,$4,'主剧本.md')",
    [randomUUID(), scriptId, f.workspace.id, f.admin.id],
  );
  const canvasId = await f.project(nodes, edges);
  const canvas = await f.canvases.project(f.db, f.admin, canvasId);
  const target = { id: String(canvas.id), workspace_id: f.workspace.id };
  const document = parseCanvasDocument({ nodes, edges, shots });
  const confirmations = await f.db.transaction(async (sql) => {
    const states = [];
    for (const id of shots) {
      const { story_basis, material_basis } = await inspectDirectorShotInputs(sql, target, document, document.nodes.find((node) => node.id === id)!);
      states.push({ node_id: id, ...(story_basis ? { story_basis } : {}), ...(material_basis ? { material_basis } : {}) });
    }
    return states;
  });
  const save = await f.canvases.save(f.admin, canvasId, {
    title: "生成画布",
    expected_revision: 2,
    document: {
      nodes, edges, shots,
      director: {
        script_id: scriptId, script_revision: 1, shot_ids: shots,
        order_basis: await directorBasis(shots), shots: confirmations,
      },
    },
  });
  const quote = (targets: unknown[], extra = {}) => precheck.precheckCanvas(f.admin, canvasId, {
    expected_revision: save.revision,
    director: { script_revision: 1, targets, ...extra },
  });
  const request = (pre: Awaited<ReturnType<typeof quote>>, targets: unknown[], extra = {}) => ({
    expected_revision: pre.revision,
    price_revision: pre.price_revision,
    precheck_token: pre.precheck_token,
    expected_total_credits: pre.summary.total_credits,
    director: { script_revision: 1, targets, ...extra },
    uid: randomUUID(),
  });
  return { canvasId, scriptId, savedRevision: save.revision, quote, request };
}

test("director retries one failed line and recovers accepted receipt", async (t) => {
  const f = await canvasRunsFixture();
  t.after(() => f.cleanup());
  await ensureBuiltinEdgeTts(f.p);
  await f.db.query("UPDATE studio_prices SET amount=4 WHERE model_id='edge-tts'");
  const line = (line_id: string) => ({ node_id: "shot", stage: "dialogue", line_id });
  const first = line("first");
  const second = line("second");
  const { canvasId, scriptId, quote, request } = await saveDirectorCanvas(f, [{
    id: "shot", x: 0, y: 0, type: "video", prompt: "两人交谈", dialogue_lines: [
      { id: first.line_id, text: "天亮了。", model: "edge-tts" },
      { id: second.line_id, text: "出发吧。", model: "edge-tts" },
    ],
  }, {
    id: "original", x: 0, y: 0, type: "video", prompt: "保留原声", audio_strategy: "keep_original",
    dialogue_lines: [{ id: "other-line", speaker: "甲", text: "保留视频原音" }],
  }], ["shot", "original"]);
  const wallet = async () => (await f.db.query("SELECT balance, held FROM wallets WHERE workspace_id=$1", [f.workspace.id])).rows[0];
  const jobRows = async (ids: number[]) => (await f.db.query(
    "SELECT * FROM jobs WHERE public_id=ANY($1::bigint[]) ORDER BY public_id", [ids],
  )).rows;
  const noLongerPresent = await quote([
    line("removed"), { node_id: "original", stage: "dialogue", line_id: "other-line" }, second,
  ]);
  assert.deepEqual(noLongerPresent.items.map(({ line_id, status }) => [line_id, status]), [
    ["removed", "blocked"], ["other-line", "blocked"], ["second", "ready"],
  ]);
  await assert.rejects(quote([line("other-line"), second]), { status: 400, message: /不属于本镜/ });
  const initial = await quote([first, second]);
  assert.equal(initial.summary.total_credits, 8, JSON.stringify(initial.items));
  assert.equal(initial.summary.runnable, 2);
  const initialRequest = request(initial, [first, second]);
  await assert.rejects(f.runs.batchRun(f.admin, canvasId, {
    ...initialRequest, director: { ...initialRequest.director, targets: [second] },
  }), { status: 409 });
  const accepted = await f.runs.batchRun(f.admin, canvasId, initialRequest);
  assert.deepEqual(accepted.submitted.map((item) => item.line_id), ["first", "second"]);
  assert.deepEqual(await f.runs.batchRun(f.admin, canvasId, initialRequest), accepted);
  await assert.rejects(f.runs.batchRun(f.admin, canvasId, {
    ...initialRequest, expected_total_credits: 0,
  }), { status: 409 });

  assert.equal(Number((await wallet()).held), 8);
  const [firstJob, secondJob] = await jobRows(accepted.submitted.map((item) => item.job_id));
  await f.db.transaction(async (sql) => {
    await f.p.settle(sql, firstJob, "completed");
    await f.p.settle(sql, secondJob, "failed");
  });
  const afterSettlement = await wallet();
  assert.equal(Number(afterSettlement.held), 0);
  const retry = await quote([second]);
  assert.equal(retry.summary.total_credits, 4);
  assert.equal(retry.items.length, 1);
  assert.equal(retry.items[0].line_id, "second");
  const retryRequest = request(retry, [second]);
  const retried = await f.runs.batchRun(f.admin, canvasId, retryRequest);
  assert.deepEqual(retried.submitted.map((item) => item.line_id), ["second"]);
  assert.deepEqual(await f.runs.batchRun(f.admin, canvasId, retryRequest), retried);
  assert.equal(Number((await wallet()).held), 4);
  const [retriedJob] = await jobRows(retried.submitted.map((item) => item.job_id));
  await f.db.transaction((sql) => f.p.settle(sql, retriedJob, "failed"));
  const boughtAgain = await f.runs.batchRun(f.admin, canvasId, { ...retryRequest, uid: randomUUID() });
  assert.deepEqual(boughtAgain.submitted.map((item) => item.line_id), ["second"]);
  assert.notEqual(boughtAgain.submitted[0].job_id, retried.submitted[0].job_id);
  assert.equal(Number((await wallet()).held), 4);
  assert.equal((await wallet()).balance, afterSettlement.balance);
  assert.equal((await jobRows([accepted.submitted[0].job_id]))[0].state, "completed");
  assert.deepEqual((await f.db.query(
    "SELECT action,count(*)::int AS count FROM ledger WHERE workspace_id=$1 AND job_id=$2 GROUP BY action ORDER BY action",
    [f.workspace.id, firstJob.id],
  )).rows, [{ action: "hold", count: 1 }, { action: "spend", count: 1 }]);

  await f.db.query("UPDATE workspace_script_documents SET revision=revision+1 WHERE public_id=$1", [scriptId]);
  await assert.rejects(quote([second]), { status: 409, message: /主剧本已更新/ });
  await assert.rejects(quote([second], { script_revision: 2, use_confirmed_script: true }), { status: 409 });
  const previousScript = await quote([first], { use_confirmed_script: true });
  assert.equal(previousScript.summary.runnable, 1);
  const previousScriptReceipt = await f.runs.batchRun(f.admin, canvasId, request(previousScript, [first], { use_confirmed_script: true }));
  assert.deepEqual(previousScriptReceipt.submitted.map((item) => item.line_id), ["first"]);
  assert.deepEqual(await f.runs.batchRun(f.admin, canvasId, initialRequest), accepted);
});

test("director quotes a missing reference image separately from its dependent video", async (t) => {
  const f = await canvasRunsFixture();
  t.after(() => f.cleanup());
  const image = { node_id: "ref", stage: "image" };
  const video = { node_id: "shot", stage: "video" };
  const { canvasId, quote, request } = await saveDirectorCanvas(f, [
    { id: "ref", x: 0, y: 0, type: "image", prompt: "窗外的灯塔" },
    { id: "other", x: 0, y: 0, type: "image", prompt: "无关图片" },
    { id: "shot", x: 0, y: 0, type: "video", prompt: "走到窗边" },
  ], ["shot"], [{ id: "ref-link", source: "ref", target: "shot" }]);
  await assert.rejects(quote([{ node_id: "other", stage: "image" }]), { status: 400 });
  await assert.rejects(quote([{ ...video, line_id: "first" }]), { status: 400 });
  const pre = await quote([image, video]);
  assert.deepEqual(pre.items.map(({ status }) => status), ["ready", "blocked"]);
  const receipt = await f.runs.batchRun(f.admin, canvasId, request(pre, [image, video]));
  assert.deepEqual(receipt.submitted.map(({ node, stage }) => [node, stage]), [["ref", "image"]]);
  assert.deepEqual(receipt.skipped.map(({ node, stage }) => [node, stage]), [["shot", "video"]]);
});

test("director preserves accepted inputs when references, voice or script drift between items", async (t) => {
  const f = await canvasRunsFixture();
  t.after(() => f.cleanup());
  await ensureBuiltinEdgeTts(f.p);
  const packs = new OriginalPacks(f.p);
  const reference = await seedImageAsset(f);
  const voice = await packs.save(f.admin, {
    name: "小林", purpose: "subject", media: [reference.publicId],
    voice_profile: { model: "edge-tts", voice_id: "zh-CN-XiaoxiaoNeural" },
  }, String(f.workspace.public_id));
  const nodes = [
    { id: "first", x: 0, y: 0, type: "video", prompt: "首镜" },
    { id: "ref", x: 0, y: 0, type: "image", media_id: reference.publicId, use_media: true },
    { id: "vis", x: 0, y: 0, type: "video", prompt: "次镜" },
    { id: "speech", x: 0, y: 0, type: "video", prompt: "人物开口", dialogue_lines: [
      { id: "line", speaker: "小林", text: "出发吧", pack_id: voice.id },
    ] },
    { id: "next", x: 0, y: 0, type: "video", prompt: "末镜" },
  ];
  const edges = [{ id: "ref-edge", source: "ref", target: "vis" }];
  const { canvasId, scriptId, savedRevision, quote, request } = await saveDirectorCanvas(
    f, nodes, ["first", "vis", "speech", "next"], edges,
  );
  const targets = [
    { node_id: "first", stage: "video" },
    { node_id: "vis", stage: "video" },
    { node_id: "speech", stage: "dialogue", line_id: "line" },
    { node_id: "next", stage: "video" },
  ];
  const pre = await quote(targets);
  assert.equal(pre.summary.runnable, 4, JSON.stringify(pre.items));
  const order = await f.canvases.project(f.db, f.admin, canvasId);
  await f.db.query(`CREATE TABLE director_drift_fixture (
    project_id uuid, asset_id uuid, pack_id text, script_id text, change_script boolean
  )`);
  await f.db.query("INSERT INTO director_drift_fixture VALUES ($1,$2,$3,$4,false)",
    [order.id, reference.id, voice.id, scriptId]);
  await f.db.query(`
    CREATE FUNCTION drift_after_director_link() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.node <> 'first' THEN RETURN NEW; END IF;
      UPDATE assets a SET state='uploading'
        FROM director_drift_fixture f WHERE f.project_id=NEW.project_id AND a.id=f.asset_id AND NOT f.change_script;
      UPDATE asset_pack_meta m SET voice_profile=jsonb_set(m.voice_profile,'{voice_id}','"zh-CN-YunxiNeural"')
        FROM documents d, director_drift_fixture f WHERE f.project_id=NEW.project_id AND d.public_id=f.pack_id
          AND d.id=m.pack_id AND NOT f.change_script;
      UPDATE workspace_script_documents d SET revision=revision+1
        FROM director_drift_fixture f WHERE f.project_id=NEW.project_id AND d.public_id=f.script_id AND f.change_script;
      RETURN NEW;
    END $$;
    CREATE TRIGGER director_link_drift AFTER INSERT ON canvas_job_links
      FOR EACH ROW EXECUTE FUNCTION drift_after_director_link();
  `);
  const original = request(pre, targets);
  const accepted = await f.runs.batchRun(f.admin, canvasId, original);
  assert.deepEqual(accepted.submitted.map(({ node }) => node), ["first", "next"]);
  assert.match(accepted.skipped.find(({ node }) => node === "vis")?.reason ?? "", /素材/);
  assert.match(accepted.skipped.find(({ node }) => node === "speech")?.reason ?? "", /声线/);
  const jobs = (await f.db.query("SELECT * FROM jobs WHERE public_id=ANY($1::bigint[]) ORDER BY public_id",
    [accepted.submitted.map((item) => item.job_id)])).rows;
  assert.deepEqual(jobs.map((job) => job.input.prompt), ["首镜", "末镜"]);
  for (const job of jobs) await f.db.transaction((sql) => f.p.settle(sql, job, "failed"));
  await f.db.query("UPDATE director_drift_fixture SET change_script=true");
  const scriptTargets = [targets[0], targets[3]];
  const scriptQuote = await quote(scriptTargets);
  const scriptRequest = request(scriptQuote, scriptTargets);
  const partial = await f.runs.batchRun(f.admin, canvasId, scriptRequest);
  assert.deepEqual(partial.submitted.map(({ node }) => node), ["first"]);
  assert.match(partial.skipped[0].reason, /主剧本已更新/);
  assert.deepEqual(await f.runs.batchRun(f.admin, canvasId, original), accepted);
  assert.deepEqual(await f.runs.batchRun(f.admin, canvasId, scriptRequest), partial);

  await f.db.query("UPDATE assets SET state='ready' WHERE id=$1", [reference.id]);
  // A later canvas edit must leave the old revision conflict visible while recovery returns the same receipt.
  const changed = await f.canvases.save(f.admin, canvasId, {
    title: "其他成员已保存", expected_revision: savedRevision, document: { nodes, edges },
  });
  assert.equal(changed.revision, savedRevision + 1);
  await assert.rejects(f.canvases.save(f.admin, canvasId, {
    title: "挂接前的草稿", expected_revision: savedRevision, document: { nodes, edges },
  }), { status: 409 });
  assert.deepEqual(await f.runs.batchRun(f.admin, canvasId, scriptRequest), partial);
});

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
    resolveSeriesBibleSaveOutcome,
  } = await import("../../apps/web/canvas/series-bible.js");
  assert.equal(
    typeof resolveSeriesBibleSaveOutcome,
    "function",
    "resolveSeriesBibleSaveOutcome must reconcile post-submit edits safely across delayed 200 and 409 responses",
  );

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

  // Plain-text mode stores { notes } cleanly even if text contains braces or punctuation, and blank clears {}
  assert.deepEqual(parseBibleDraft("纯文本世界观：第一幕{雨夜}", "notes"), {
    notes: "纯文本世界观：第一幕{雨夜}",
  });
  assert.deepEqual(parseBibleDraft("   ", "notes"), {});
  // Optional new-series creation field with allowEmpty=true still treats blank as {}
  assert.deepEqual(parseBibleDraft("   ", "structured", { allowEmpty: true }), {});

  // Round 2 Item 2: Blank structured input on existing series MUST reject and preserve draft (NOT clear bible), whereas explicit "{}" clears bible!
  let blankStructPuts = 0;
  const blankStructSession = {
    ...openSeriesBibleSession(savedStructured),
    draft: "   \n  ",
  };
  const blankStructOutcome = await submitSeriesBibleSession(
    blankStructSession,
    async (id: string, payload: any) => {
      blankStructPuts += 1;
      return seriesSvc.update(f.admin, id, payload);
    },
  );
  assert.equal(blankStructOutcome.ok, false, "blank structured draft must not send PUT {}");
  assert.equal(blankStructPuts, 0);
  if (!blankStructOutcome.ok) {
    assert.equal(blankStructOutcome.session.draft, "   \n  ");
    assert.match(blankStructOutcome.error, /\{\}/);
  }
  // Explicit "{}" in structured mode clears worldbuilding cleanly
  const explicitEmptySession = {
    ...openSeriesBibleSession(savedStructured),
    draft: "{}",
  };
  const explicitEmptyOutcome = await submitSeriesBibleSession(
    explicitEmptySession,
    async (id: string, payload: any) => seriesSvc.update(f.admin, id, payload),
  );
  assert.equal(explicitEmptyOutcome.ok, true);
  const clearedStructured = (await seriesSvc.list(f.admin, wsPublicId)).series.find(
    (s) => s.id === legacyStructured.id,
  )!;
  assert.deepEqual(clearedStructured.bible, {});

  // Round 2 Item 1: Delayed PUT (both 200 and 409) preserves any post-start edits and SeriesTree disables editing while saving while keeping 409 textarea selectable/copyable!
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const seriesTreeSrc = await readFile(
    join(process.cwd(), "apps/web/canvas/SeriesTree.tsx"),
    "utf8",
  );
  assert.match(seriesTreeSrc, /resolveSeriesBibleSaveOutcome\(/);
  assert.match(seriesTreeSrc, /aria-label="编辑世界观设定"[\s\S]{0,400}readOnly=\{busy\}/);

  // Delayed 200 when user modified draft while PUT was in flight -> keeps new draft open and advances expectedRevision to saved revision!
  const delayedStart = openSeriesBibleSession(clearedStructured);
  const submitted200 = { ...delayedStart, mode: "notes" as const, draft: "第一版提交内容" };
  let editedDuring200 = { ...submitted200 };
  const delayed200Outcome = await submitSeriesBibleSession(
    submitted200,
    async (id: string, payload: any) => {
      editedDuring200 = { ...editedDuring200, draft: "第一版提交内容 + 保存期间追加的新段落" };
      return seriesSvc.update(f.admin, id, payload);
    },
  );
  assert.equal(delayed200Outcome.ok, true);
  const reconciled200 = resolveSeriesBibleSaveOutcome(
    editedDuring200,
    submitted200,
    delayed200Outcome,
  );
  assert.ok(reconciled200, "post-submit edits must keep editor open instead of discarding new input");
  assert.equal(reconciled200.draft, "第一版提交内容 + 保存期间追加的新段落");
  assert.equal(reconciled200.expectedRevision, clearedStructured.revision + 1);
  assert.equal(reconciled200.conflicted, false);

  // Delayed 409 when user modified draft while PUT was in flight -> keeps new draft, marks conflicted=true, and NEVER regresses pinned expectedRevision!
  await seriesSvc.update(f.admin, legacyStructured.id, {
    expected_revision: clearedStructured.revision + 1,
    bible: { notes: "协作者抢先提交的新设定" },
  });
  const staleSubmitted = { ...reconciled200 };
  let editedDuring409 = { ...staleSubmitted };
  const delayed409Outcome = await submitSeriesBibleSession(
    staleSubmitted,
    async (id: string, payload: any) => {
      editedDuring409 = { ...editedDuring409, draft: "本地继续补充的冲突草稿（可完整复制）" };
      return seriesSvc.update(f.admin, id, payload);
    },
  );
  assert.equal(delayed409Outcome.ok, false);
  const reconciled409 = resolveSeriesBibleSaveOutcome(
    editedDuring409,
    staleSubmitted,
    delayed409Outcome,
  );
  assert.ok(reconciled409);
  assert.equal(reconciled409.conflicted, true);
  assert.equal(reconciled409.draft, "本地继续补充的冲突草稿（可完整复制）");
  assert.equal(reconciled409.expectedRevision, staleSubmitted.expectedRevision);
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

  // Case C: Long series.bible must not push scene summary past the 11,000-char sticky note cap
  const longBibleSeries = await seriesSvc.create(
    f.admin,
    {
      title: "长设定剧集",
      synopsis: "全剧主线：海底遗迹争夺",
      bible: { notes: "setting ".repeat(1450) },
    },
    wsPublicId,
  );
  const epC = await seriesSvc.createEpisode(f.admin, longBibleSeries.id, {
    season_no: 1,
    episode_no: 1,
    title: "序幕",
  });
  const scC = await seriesSvc.createScene(f.admin, longBibleSeries.id, epC.id, {
    scene_no: 1,
    title: "遗迹入口",
    summary: "Important scene synopsis",
    create_canvas: true,
  });
  assert.ok(scC.canvas_id);
  const canvasC = await f.canvases.get(f.admin, scC.canvas_id!);
  const stickyC = canvasC.document.nodes.find(
    (n: { type?: string }) => n.type === "sticky",
  ) as { text?: string } | undefined;
  assert.ok(stickyC, "standalone scene canvas must contain scene-brief sticky note");
  const stickyCText = stickyC.text ?? "";
  assert.equal(stickyCText.length, 11000);
  assert.match(stickyCText, /剧集梗概：全剧主线：海底遗迹争夺/);
  assert.match(stickyCText, /分场梗概：Important scene synopsis/);
  assert.match(stickyCText, /世界观与设定：setting setting /);
  assert.ok(
    stickyCText.indexOf("分场梗概：") < stickyCText.indexOf("世界观与设定："),
    "scene summary must precede worldbuilding so long bible notes never truncate scene synopsis",
  );
});
