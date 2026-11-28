import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMatchSpansReplacement,
  buildCanvasLocalBackup,
  buildPersistedScriptDraftForSession,
  createCanvasRunsTracker,
  detectAmbiguousShotMatches,
  directorMemberForScriptShot,
  directorSourceChanges,
  directorSyncPreview,
  extractScriptAnchorsMap,
  nodeHasOutputOrActiveRun,
  parseScriptBreakdown,
  reconcileLoadedScriptDraft,
  reconcileRenamedOpenScriptSession,
  replaceCanvasNodeText,
  resolveChatReplaceTarget,
  resolvePreferredShotIdLines,
  searchCanvasTextNodes,
  stampScriptShotIds,
  stampDirectorScriptShotIds,
  syncScriptBreakdownToCanvas,
  syncDirectorBreakdownToCanvas,
  scriptSourceJump,
} from "../../apps/web/canvas-editor/script-fusion.js";
import { newNode, type Doc, type Job } from "../../apps/web/canvas-editor/types.js";
import { draftEquals } from "../../apps/web/canvas-editor/performance.js";
import { canvasesFixture } from "../helpers/canvases.js";

const SAMPLE_SCRIPT = `# 《说谎者》· 分集剧本 EP01

## 角色资产
- **CH01 齐夏**：25岁男性，深灰连帽卫衣，神情冷静敏锐，写实电影光影三视图。
- **CH02 人羊**：戴山羊头面具、穿黑西服的高大男人，眼洞露出人类眼睛。

## 场景资产
- **SC01 封闭密室**：灰白斑驳方格墙面，中央老旧实木圆桌，顶悬钨丝灯摇晃。

### S01 封闭密室 夜 内
人物：齐夏、人羊

△老旧钨丝灯被黑色电线吊在密室正中，光忽明忽暗，特写镜头缓慢推进至圆桌边缘。
人羊：早安，各位。你们已经在我面前沉睡了十二个小时了。

△全景俯拍圆桌，齐夏坐在离人羊最远的位置，抬手按了一下口袋，空的。
齐夏：手机和证件都被收走了，这到底是什么地方？
`;

test("director source changes distinguish script edits, canvas edits, and missing baselines", () => {
  assert.deepEqual(directorSourceChanges({ prompt: "a" }, { prompt: "b" }, { prompt: "c" }).conflicts, ["prompt"]);
  assert.deepEqual(directorSourceChanges({ prompt: "a" }, { prompt: "a" }, { prompt: "b" }).takeScript, ["prompt"]);
  assert.deepEqual(directorSourceChanges({ prompt: "a" }, { prompt: "b" }, { prompt: "a" }).preserve, ["prompt"]);
  assert.deepEqual(directorSourceChanges({}, { prompt: "a" }, { prompt: "b" }).conflicts, ["prompt"]);
  assert.deepEqual(directorSourceChanges({}, { prompt: "a" }, { prompt: "a" }), { takeScript: [], preserve: [], conflicts: [] });
});

test("director-only changes make a canvas draft eligible for saving", () => {
  const common: Doc = { schemaVersion: 1, nodes: [], edges: [], shots: [] };
  const director = { script_id: "doc_ep01", script_revision: 1, shot_ids: [] };
  const draft = { title: "本集", document: { ...common, director } };
  assert.ok(draftEquals(draft, structuredClone(draft)));
  assert.ok(!draftEquals(draft, { ...draft, document: common }));
  assert.ok(!draftEquals(draft, { ...draft, document: { ...common, director: { ...director, order_basis: "a".repeat(64) } } }));
});

test("director stamps stable IDs on table rows and dialogue-only beats", () => {
  const markdown = `### S01 钟表铺 夜 内\n| 01 | S01 | 缓推 | 5s | 镜头推近怀表。 | |\n\n### S02 街道 夜 外\n韩青：有人吗？\n`;
  const original = parseScriptBreakdown(markdown, { docId: "doc_ep01" });
  const first = stampDirectorScriptShotIds(markdown, original);
  const saved = parseScriptBreakdown(first.markdown, { docId: "doc_ep01" });
  assert.ok(saved.shots[0].shotId);
  assert.ok(saved.shots[1].shotId);
  assert.notEqual(saved.shots[0].shotId, saved.shots[1].shotId);
  assert.equal(saved.shots[1].dialogues[0].text, "有人吗？");
  assert.equal(stampDirectorScriptShotIds(first.markdown, saved).changed, false);
  const replacement = parseScriptBreakdown(first.markdown.replace("镜头推近怀表", "镜头推近收据"), { docId: "doc_ep01" });
  assert.equal(replacement.shots[0].shotId, saved.shots[0].shotId);
});

test("director takes over selected outputs from ordinary sync when stamping unmarked dialogue and table shots", () => {
  const markdown = `### S01 钟表铺 夜 内\n| 01 | S01 | 缓推 | 5s | 镜头推近怀表。 | |\n\n### S02 街道 夜 外\n韩青：有人吗？\n`;
  const breakdown = parseScriptBreakdown(markdown, { docId: "doc_ep01" });
  const legacy = syncScriptBreakdownToCanvas({ schemaVersion: 1, nodes: [], edges: [], shots: [] }, breakdown);
  const videos = legacy.document.nodes.filter((node) => node.type === "video");
  videos.forEach((video, index) => { video.media_id = String(index).repeat(32); video.use_media = true; });
  const preferred = resolvePreferredShotIdLines(legacy.document, breakdown);
  const stamped = stampDirectorScriptShotIds(markdown, breakdown, preferred);
  const ready = parseScriptBreakdown(stamped.markdown, { docId: "doc_ep01" });
  assert.deepEqual(ready.shots.map((shot) => shot.shotId), videos.map((video) => video.extra_params?.script_shot_id));
  const synced = syncDirectorBreakdownToCanvas(legacy.document, ready, { scriptRevision: 1 });
  assert.deepEqual(synced.shotNodeIds, videos.map((node) => node.id));
  assert.deepEqual(synced.document.nodes.filter((node) => node.use_media).map((node) => node.media_id), videos.map((node) => node.media_id));
  const inserted = parseScriptBreakdown("### S01 钟表铺 夜 内\n△补镜。\n" + stamped.markdown, { docId: breakdown.docId });
  assert.equal(inserted.shots[0].anchor, "S01-01");
  assert.equal(inserted.shots[1].anchor, "S01-02");
  assert.equal(directorMemberForScriptShot(synced.document, breakdown.docId, inserted.shots[0].shotId), undefined);
  assert.equal(directorMemberForScriptShot(synced.document, breakdown.docId, inserted.shots[1].shotId), videos[0].id);
  assert.equal(directorMemberForScriptShot(synced.document, breakdown.docId, inserted.shots[2].shotId), videos[1].id);
});

test("director requires a choice for edited audio and preserves a matching line's configuration and jobs", () => {
  const empty: Doc = { schemaVersion: 1, nodes: [], edges: [], shots: [] };
  const script = "### S01 钟表铺 夜 内\n△推门。\n韩青：你好。\n林秋：进来吧。";
  const body = stampScriptShotIds(script).markdown;
  const parse = (text: string) => parseScriptBreakdown(text, { docId: "doc_ep01" });
  const saved = syncDirectorBreakdownToCanvas(empty, parse(body), { scriptRevision: 1 }).document;
  const video = saved.nodes.find((node) => node.type === "video")!;
  const previous = video.dialogue_lines![0];
  Object.assign(previous, { voice_id: "voice-q", model: "voice-model", instruction: "耳语", pack_id: "a".repeat(32), audio_job: 12, audio_pending: 14 });
  const revised = parse(body.replace("你好。", "晚上好。"));
  assert.ok(directorSyncPreview(saved, revised)[0].changes.conflicts.includes("dialogues"));
  assert.throws(() => syncDirectorBreakdownToCanvas(saved, revised, { scriptRevision: 2 }), /对白/);
  const synced = syncDirectorBreakdownToCanvas(saved, revised, { scriptRevision: 2, choices: { "S01-01": { dialogues: "script" } } }).document;
  const actual = synced.nodes.find((node) => node.id === video.id)!.dialogue_lines!;
  assert.deepEqual(actual[0], { ...previous, text: "晚上好。", audio_stale: [12, 14] });
  assert.deepEqual(actual[1], video.dialogue_lines![1]);
});

test("director can keep a superseded media node independently without reopening the same ambiguity", () => {
  const base = parseScriptBreakdown("### S01 夜 内\n△旧镜头。 <!-- fm-shot:old_shot -->", { docId: "doc_ep01" });
  const legacy = syncScriptBreakdownToCanvas({ schemaVersion: 1, nodes: [], edges: [], shots: [] }, base);
  const old = legacy.document.nodes.find((node) => node.type === "video")!;
  old.media_id = "c".repeat(32);
  old.use_media = true;
  const incoming = parseScriptBreakdown("### S01 夜 内\n△另一镜。 <!-- fm-shot:new_shot -->", { docId: "doc_ep01" });
  assert.equal(directorSyncPreview(legacy.document, incoming)[0].unresolved, true);
  const resolved = syncDirectorBreakdownToCanvas(legacy.document, incoming, { scriptRevision: 2, bindings: { "S01-01": null } });
  const retained = resolved.document.nodes.find((node) => node.id === old.id)!;
  assert.equal(retained.extra_params?.script_doc_id, undefined);
  assert.equal(scriptSourceJump(retained)?.docId, base.docId);
  assert.equal(retained.media_id, old.media_id);
  assert.equal(directorSyncPreview(resolved.document, incoming)[0].unresolved, false);
  const repeated = syncDirectorBreakdownToCanvas(resolved.document, incoming, { scriptRevision: 2 });
  assert.deepEqual(repeated.shotNodeIds, resolved.shotNodeIds);
});

test("director resolves duplicate legacy claims and keeps source jumps, media, and hand-wired edges on resync", () => {
  const docId = "doc_ep01";
  const breakdown = parseScriptBreakdown(stampScriptShotIds(SAMPLE_SCRIPT).markdown, { docId });
  const empty: Doc = { schemaVersion: 1, nodes: [], edges: [], shots: [] };
  const legacy = syncScriptBreakdownToCanvas(empty, breakdown, { includeAssets: false });
  const mainId = legacy.anchorToNodeId["S01-01"];
  const main = legacy.document.nodes.find((node) => node.id === mainId)!;
  main.media_id = "a".repeat(32);
  main.active_job = 42;
  const copy = { ...structuredClone(main), id: "trial-shot", title: "试拍" };
  const reference = newNode("image", 960, 400, 1);
  const manualEdge = { id: "manual-edge", source: reference.id, target: main.id };
  const original: Doc = {
    ...legacy.document,
    nodes: [...legacy.document.nodes, copy, reference],
    edges: [...legacy.document.edges, manualEdge],
    shots: [main.id, copy.id, legacy.anchorToNodeId["S01-02"]],
  };
  const affected = directorSyncPreview(original, breakdown).find((entry) => entry.anchor === "S01-01")!;
  assert.equal(affected.nodeId, undefined);
  assert.deepEqual(affected.candidates.map(({ id }) => id), [main.id, copy.id]);
  const chosen = { bindings: { "S01-01": main.id }, scriptRevision: 1 };
  assert.throws(() => syncDirectorBreakdownToCanvas(original, breakdown, { scriptRevision: 1 }), /归属/);
  const first = syncDirectorBreakdownToCanvas(original, breakdown, chosen).document;
  assert.deepEqual(first.shots, original.shots);
  assert.deepEqual(first.director?.shot_ids, [main.id, legacy.anchorToNodeId["S01-02"]]);
  const unclaimed = first.nodes.find((node) => node.id === copy.id)!;
  assert.equal(unclaimed.extra_params?.script_doc_id, undefined);
  assert.deepEqual(scriptSourceJump(unclaimed), scriptSourceJump(main));

  const promptNode = first.nodes.find((node) => node.type === "text" && node.extra_params?.script_anchor === "S01-01")!;
  promptNode.text = "导演改过这镜的说明";
  const incoming = {
    ...breakdown,
    shots: breakdown.shots.map((shot, index) => index ? shot : {
      ...shot,
      prompt: "剧本中新的镜头说明",
      narration: "剧本中新增的旁白",
    }),
  };
  const diff = directorSyncPreview(first, incoming)[0];
  assert.deepEqual(diff.changes.conflicts, ["prompt"]);
  assert.ok(diff.changes.takeScript.includes("narration"));
  const updated = syncDirectorBreakdownToCanvas(first, incoming, {
    scriptRevision: 2,
    choices: { "S01-01": { prompt: "preserve" } },
  }).document;
  const updatedMain = updated.nodes.find((node) => node.id === main.id)!;
  assert.equal(updatedMain.media_id, main.media_id);
  assert.equal(updatedMain.active_job, main.active_job);
  assert.equal(updatedMain.narration_text, "剧本中新增的旁白");
  assert.equal(updated.nodes.find((node) => node.id === promptNode.id)?.text, promptNode.text);
  assert.deepEqual(updated.edges.find((edge) => edge.id === manualEdge.id), manualEdge);
  assert.equal(updated.nodes.find((node) => node.id === copy.id)?.media_id, copy.media_id);
  const reordered = syncDirectorBreakdownToCanvas(updated, incoming, {
    scriptRevision: 2,
    order: ["S01-02", "S01-01"],
  }).document;
  assert.deepEqual(reordered.shots, [legacy.anchorToNodeId["S01-02"], copy.id, main.id]);
  const fresh = syncDirectorBreakdownToCanvas(empty, breakdown, { scriptRevision: 1 }).document;
  assert.ok(fresh.nodes.filter((node) => node.type === "video").every((node) => !node.tail_inherited));
});

test("parseScriptBreakdown extracts assets, scenes, shots, dialogue lines, and cinematography hints", () => {
  const breakdown = parseScriptBreakdown(SAMPLE_SCRIPT, {
    docId: "doc_ep01",
    docPath: "说谎者/02_分集剧本_EP01.md",
  });

  assert.equal(breakdown.assets.length, 3);
  assert.equal(breakdown.assets[0].code, "CH01");
  assert.equal(breakdown.assets[0].name, "齐夏");
  assert.equal(breakdown.assets[0].category, "character");
  assert.equal(breakdown.assets[2].category, "scene");

  assert.equal(breakdown.scenes.length, 1);
  assert.equal(breakdown.scenes[0].code, "S01");
  assert.equal(breakdown.scenes[0].location, "封闭密室");

  assert.equal(breakdown.shots.length, 2);
  assert.equal(breakdown.shots[0].anchor, "S01-01");
  assert.equal(breakdown.shots[0].cinematography?.shot_size, "特写");
  assert.equal(breakdown.shots[0].cinematography?.camera_movement, "推镜");
  assert.equal(breakdown.shots[0].dialogues.length, 1);
  assert.equal(breakdown.shots[0].dialogues[0].speaker, "人羊");
  assert.match(breakdown.shots[0].dialogues[0].text, /沉睡了十二个小时/);

  assert.equal(breakdown.shots[1].anchor, "S01-02");
  assert.equal(breakdown.shots[1].cinematography?.shot_size, "全景");
  assert.equal(breakdown.shots[1].dialogues[0].speaker, "齐夏");
});

test("syncScriptBreakdownToCanvas wires asset refs + shot chains and updates idempotently without losing generated media", () => {
  const emptyDoc: Doc = {
    schemaVersion: 1,
    nodes: [],
    edges: [],
    shots: [],
  };

  const breakdown = parseScriptBreakdown(SAMPLE_SCRIPT, {
    docId: "doc_ep01",
    docPath: "说谎者/02_分集剧本_EP01.md",
  });

  const firstSync = syncScriptBreakdownToCanvas(emptyDoc, breakdown, {
    includeAssets: true,
    generationMode: "omni_ref",
    tailChain: true,
    videoModel: "MiniMax H3",
    imageModel: "gpt-image-2.6-sunburst",
    ratio: "9:16",
  });

  // 3 asset image nodes + 2 * (text + video) shot nodes = 7 nodes
  assert.equal(firstSync.document.nodes.length, 7);
  assert.equal(firstSync.document.shots?.length, 2);
  assert.equal(firstSync.createdNodeIds.length, 7);

  const firstVideoId = firstSync.anchorToNodeId["S01-01"];
  assert.ok(firstVideoId);
  const firstVideo = firstSync.document.nodes.find(
    (n) => n.id === firstVideoId,
  )!;
  assert.equal(firstVideo.type, "video");
  assert.equal(firstVideo.params.ratio, "9:16");
  assert.equal(firstVideo.dialogue_lines?.length, 1);
  assert.equal(firstVideo.extra_params?.script_doc_id, "doc_ep01");
  assert.equal(firstVideo.extra_params?.script_anchor, "S01-01");

  // Asset image nodes should be wired as incoming references to the shot video node
  const incomingRefEdges = firstSync.document.edges.filter(
    (e) => e.target === firstVideoId,
  );
  assert.ok(incomingRefEdges.length >= 3); // text prompt + scene SC01 + character CH02

  // Simulate user generating a video on S01-01, then revising dialogue in the script
  const withGeneratedMedia: Doc = {
    ...firstSync.document,
    nodes: firstSync.document.nodes.map((n) =>
      n.id === firstVideoId
        ? { ...n, media_id: "a".repeat(32), active_job: 42 }
        : n,
    ),
  };

  const revisedScript = SAMPLE_SCRIPT.replace(
    "沉睡了十二个小时了",
    "整整沉睡了二十四个小时",
  );
  const revisedBreakdown = parseScriptBreakdown(revisedScript, {
    docId: "doc_ep01",
    docPath: "说谎者/02_分集剧本_EP01.md",
  });

  const secondSync = syncScriptBreakdownToCanvas(
    withGeneratedMedia,
    revisedBreakdown,
    {
      includeAssets: true,
      generationMode: "omni_ref",
      tailChain: true,
      videoModel: "MiniMax H3",
      imageModel: "gpt-image-2.6-sunburst",
      ratio: "9:16",
    },
  );

  // Node count unchanged, generated media_id & active_job preserved, dialogue updated!
  assert.equal(secondSync.document.nodes.length, 7);
  assert.equal(secondSync.createdNodeIds.length, 0);
  assert.ok(secondSync.updatedNodeIds.includes(firstVideoId));

  const updatedVideo = secondSync.document.nodes.find(
    (n) => n.id === firstVideoId,
  )!;
  assert.equal(updatedVideo.media_id, "a".repeat(32));
  assert.equal(updatedVideo.active_job, 42);
  assert.match(
    updatedVideo.dialogue_lines?.[0]?.text || "",
    /二十四个小时/,
  );

  const anchorsMap = extractScriptAnchorsMap(secondSync.document, "doc_ep01");
  assert.equal(anchorsMap["S01-01"]?.hasMedia, true);
  assert.equal(anchorsMap["S01-02"]?.hasMedia, false);
});

test("searchCanvasTextNodes and replaceCanvasNodeText support workspace-wide node search & safe replace", () => {
  const breakdown = parseScriptBreakdown(SAMPLE_SCRIPT, {
    docId: "doc_ep01",
    docPath: "说谎者/02_分集剧本_EP01.md",
  });
  const synced = syncScriptBreakdownToCanvas(
    { schemaVersion: 1, nodes: [], edges: [], shots: [] },
    breakdown,
    { includeAssets: true },
  );

  const hits = searchCanvasTextNodes(
    synced.document,
    { id: "cv_1", title: "画布1" },
    "齐夏",
    false,
  );
  assert.ok(hits.length >= 2);

  const targetHit = hits[0];
  const replacedDoc = replaceCanvasNodeText(
    synced.document,
    targetHit.nodeId,
    targetHit.currentText,
    targetHit.currentText.replaceAll("齐夏", "林默"),
  );
  const afterHits = searchCanvasTextNodes(
    replacedDoc,
    { id: "cv_1", title: "画布1" },
    "林默",
    false,
  );
  assert.ok(afterHits.some((h) => h.nodeId === targetHit.nodeId));

  // Stale expectedText throws conflict error instead of clobbering
  assert.throws(
    () =>
      replaceCanvasNodeText(
        replacedDoc,
        targetHit.nodeId,
        "过期的旧文本",
        "覆盖文本",
      ),
    /已变化/,
  );
});

test("syncScriptBreakdownToCanvas output passes strict OriginalCanvases.save validation", async () => {
  const f = await canvasesFixture();
  try {
    const ws = String(f.team.public_id);
    const created = await f.canvases.create(
      f.member,
      { title: "说谎者 · EP01" },
      ws,
    );
    const breakdown = parseScriptBreakdown(SAMPLE_SCRIPT, {
      docId: "doc_ep01",
      docPath: "说谎者/02_分集剧本_EP01.md",
    });
    const synced = syncScriptBreakdownToCanvas(created.document as Doc, breakdown, {
      includeAssets: true,
      generationMode: "first_last_frame",
      tailChain: true,
      videoModel: "",
      imageModel: "",
      ratio: "9:16",
    });

    const saved = await f.canvases.save(f.member, created.id, {
      expected_revision: created.revision,
      title: created.title,
      document: synced.document,
    });
    assert.equal(saved.revision, created.revision + 1);
    assert.equal(saved.document.nodes.length, 7);
    assert.equal(saved.document.shots?.length, 2);
  } finally {
    await f.cleanup();
  }
});

test("Inserting a shot before an existing shot preserves generated video on the original shot instead of misattaching by positional index", () => {
  const scriptV1 = `# 密室逃脱
### S01 走廊 夜 内
人物：林默

△林默在黑暗中推开沉重的铁门。
林默：门没锁。
`;
  const b1 = parseScriptBreakdown(scriptV1, { docId: "doc_insert", docPath: "ep1.md" });
  const sync1 = syncScriptBreakdownToCanvas(
    { schemaVersion: 1, nodes: [], edges: [], shots: [] },
    b1,
    { includeAssets: true, generationMode: "omni_ref", videoModel: "MiniMax H3", imageModel: "gpt-image-2.6-sunburst" },
  );
  const doorVideoId = sync1.anchorToNodeId["S01-01"];
  assert.ok(doorVideoId);

  // User generates video #88 on "打开门"
  const docWithDoorMedia: Doc = {
    ...sync1.document,
    nodes: sync1.document.nodes.map((n) =>
      n.id === doorVideoId ? { ...n, media_id: "b".repeat(32), active_job: 88 } : n,
    ),
  };

  // User inserts a brand-new shot "摸索钥匙" BEFORE "推开沉重的铁门"
  const scriptV2 = `# 密室逃脱
### S01 走廊 夜 内
人物：林默

△特写林默手指在风衣口袋里摸索黄铜钥匙。

△林默在黑暗中推开沉重的铁门。
林默：门没锁。
`;
  const b2 = parseScriptBreakdown(scriptV2, { docId: "doc_insert", docPath: "ep1.md" });
  assert.equal(b2.shots.length, 2);

  const sync2 = syncScriptBreakdownToCanvas(docWithDoorMedia, b2, {
    includeAssets: true,
    generationMode: "omni_ref",
    videoModel: "MiniMax H3",
    imageModel: "gpt-image-2.6-sunburst",
  });

  const newShot1Id = sync2.anchorToNodeId["S01-01"];
  const shiftedDoorId = sync2.anchorToNodeId["S01-02"];
  assert.notEqual(newShot1Id, doorVideoId);
  assert.equal(shiftedDoorId, doorVideoId);

  const newShot1Node = sync2.document.nodes.find((n) => n.id === newShot1Id)!;
  const shiftedDoorNode = sync2.document.nodes.find((n) => n.id === shiftedDoorId)!;
  assert.equal(newShot1Node.media_id, null);
  assert.equal(newShot1Node.active_job, null);
  assert.equal(shiftedDoorNode.media_id, "b".repeat(32));
  assert.equal(shiftedDoorNode.active_job, 88);
  assert.deepEqual(sync2.document.shots, [newShot1Id, shiftedDoorId]);

  // Also verify stamped shot IDs survive total prose rewrite + insertion, and ambiguous cases surface cleanly
  const stamped = stampScriptShotIds(scriptV1);
  assert.equal(stamped.changed, true);
  assert.match(stamped.markdown, /<!--\s*fm-shot:sh_[a-z0-9_]+\s*-->/);

  // Ambiguous case: unstamped script where shot count changed AND old text was completely rewritten
  const scriptAmbiguous = `# 密室逃脱
### S01 走廊 夜 内
人物：林默

△全新的第一镜：监控摄像头红光闪烁。

△全新的第二镜：铁门轰然敞开露出阶梯。
`;
  const bAmb = parseScriptBreakdown(scriptAmbiguous, { docId: "doc_insert", docPath: "ep1.md" });
  const ambiguities = detectAmbiguousShotMatches(docWithDoorMedia, bAmb);
  assert.equal(ambiguities.length, 1);
  assert.equal(ambiguities[0].existingVideoNodeId, doorVideoId);

  // User confirms binding existing media node to S01-02
  const syncConfirmed = syncScriptBreakdownToCanvas(docWithDoorMedia, bAmb, {
    includeAssets: true,
    explicitNodeBindings: { "S01-02": doorVideoId },
  });
  assert.equal(syncConfirmed.anchorToNodeId["S01-02"], doorVideoId);
  const s01Node = syncConfirmed.document.nodes.find(
    (n) => n.id === syncConfirmed.anchorToNodeId["S01-01"],
  )!;
  assert.equal(s01Node.active_job, null);
});

test("grid_preview sync is idempotent across replays, prunes removed script asset edges, and preserves manual edges", () => {
  const scriptWithTwoChars = `# 测试
### S01 密室 夜 内
人物：齐夏、人羊

△特写齐夏抬头看向人羊。
齐夏：你是谁？

△中景人羊缓缓摘下面具。
`;
  const b1 = parseScriptBreakdown(scriptWithTwoChars, { docId: "doc_grid", docPath: "grid.md" });
  const sync1 = syncScriptBreakdownToCanvas(
    { schemaVersion: 1, nodes: [], edges: [], shots: [] },
    b1,
    { includeAssets: true, generationMode: "grid_preview", gridLayout: "3x3" },
  );
  const initialEdgeCount = sync1.document.edges.length;
  const initialNodeCount = sync1.document.nodes.length;

  // Replay identical grid_preview sync -> edge count and node count MUST stay identical!
  const sync2 = syncScriptBreakdownToCanvas(sync1.document, b1, {
    includeAssets: true,
    generationMode: "grid_preview",
    gridLayout: "3x3",
  });
  assert.equal(sync2.document.nodes.length, initialNodeCount);
  assert.equal(sync2.document.edges.length, initialEdgeCount);

  // Add a manual user-created sticky/text reference edge to shot 1 video node
  const shot1VideoId = sync2.anchorToNodeId["S01-01"];
  const docWithManualEdge: Doc = {
    ...sync2.document,
    nodes: [
      ...sync2.document.nodes,
      {
        ...sync2.document.nodes.find((n) => n.type === "text")!,
        id: "manual_director_note",
        title: "导演手写备注",
        text: "保持冷色调",
        extra_params: undefined,
      },
    ],
    edges: [
      ...sync2.document.edges,
      { id: "edge_manual_keep", source: "manual_director_note", target: shot1VideoId },
    ],
  };

  // Remove 人羊 from shot 1 & scene cast, switch mode from grid_preview to omni_ref
  const scriptReduced = `# 测试
### S01 密室 夜 内
人物：齐夏

△特写齐夏独自抬头看向镜头。
齐夏：只剩我一个人了。

△中景空荡的密室圆桌。
`;
  const bReduced = parseScriptBreakdown(scriptReduced, { docId: "doc_grid", docPath: "grid.md" });
  const sync3 = syncScriptBreakdownToCanvas(docWithManualEdge, bReduced, {
    includeAssets: true,
    generationMode: "omni_ref",
  });

  // Manual edge MUST still exist!
  assert.ok(sync3.document.edges.some((e) => e.id === "edge_manual_keep"));
  // Removed character "人羊" asset node MUST NO LONGER be wired to S01-01!
  const renyangNode = sync3.document.nodes.find((n) => n.title.includes("人羊"));
  if (renyangNode) {
    assert.equal(
      sync3.document.edges.some(
        (e) => e.source === renyangNode.id && e.target === shot1VideoId,
      ),
      false,
    );
  }
});

test("searchCanvasTextNodes handles Unicode case-folding accurately, reports truncation, and applyMatchSpansReplacement patches exact spans", () => {
  const repeated = Array.from({ length: 60 }, (_, i) => `词条${i}:林默`).join(" ");
  const doc: Doc = {
    schemaVersion: 1,
    edges: [],
    shots: [],
    nodes: [
      {
        id: "n_uni",
        type: "text",
        title: "Unicode 节点",
        x: 0,
        y: 0,
        width: 300,
        height: 200,
        text: "İabc 测试 AbC",
        prompt: "",
        color: "none",
        media_id: null,
        active_job: null,
        use_media: false,
        params: {
          model: "",
          ratio: "16:9",
          seconds: 5,
          resolution: "1K",
          quality: 768,
          image_quality: "high",
          fast_mode: true,
          sampling_steps: 20,
          seed: null,
          flow_source_job: null,
          h3: null,
          h3_refs: [],
        },
      },
      {
        id: "n_many",
        type: "text",
        title: "高频节点",
        x: 0,
        y: 300,
        width: 300,
        height: 200,
        text: repeated,
        prompt: "",
        color: "none",
        media_id: null,
        active_job: null,
        use_media: false,
        params: {
          model: "",
          ratio: "16:9",
          seconds: 5,
          resolution: "1K",
          quality: 768,
          image_quality: "high",
          fast_mode: true,
          sampling_steps: 20,
          seed: null,
          flow_source_job: null,
          h3: null,
          h3_refs: [],
        },
      },
    ],
  };

  const uniHits = searchCanvasTextNodes(doc, { id: "c1", title: "画布" }, "abc", false);
  assert.equal(uniHits.length, 1);
  assert.equal(uniHits[0].matches.length, 2);
  assert.equal(uniHits[0].matches[0].text, "abc");
  assert.equal(uniHits[0].matches[1].text, "AbC");
  assert.equal(uniHits[0].truncated, false);

  const patched = applyMatchSpansReplacement(
    "İabc 测试 AbC",
    [uniHits[0].matches[0]],
    "XYZ",
  );
  assert.equal(patched, "İXYZ 测试 AbC");

  const manyHits = searchCanvasTextNodes(doc, { id: "c1", title: "画布" }, "林默", false, 50);
  assert.equal(manyHits[0].matches.length, 50);
  assert.equal(manyHits[0].truncated, true);

  // Oversized replacement (> 12,000 chars) rejects instead of silently truncating tail text
  const maxText = "hit" + "x".repeat(11993) + "TAIL";
  assert.equal([...maxText].length, 12000);
  const maxDoc: Doc = {
    schemaVersion: 1,
    edges: [],
    shots: [],
    nodes: [
      {
        ...doc.nodes[0],
        id: "n_max",
        text: maxText,
      },
    ],
  };
  assert.throws(
    () =>
      replaceCanvasNodeText(
        maxDoc,
        "n_max",
        maxText,
        "longer" + "x".repeat(11993) + "TAIL",
      ),
    /12000/,
  );
  assert.equal(maxDoc.nodes[0].text.endsWith("TAIL"), true);
});

test("media-bearing shots never auto-bind on delete+add with distinct shotId or copied duplicate fm-shot comments, and manual edges/grids stay intact", () => {
  const baseScript = `# 审讯

## 角色资产
- **CH01 林默**：年轻刑警

### S01 走廊 夜 内
人物：林默

△林默握紧手电筒走向铁门。 <!-- fm-shot:sh_orig1 -->
`;
  const b1 = parseScriptBreakdown(baseScript, { docId: "doc_safe", docPath: "safe.md" });
  const sync1 = syncScriptBreakdownToCanvas(
    { schemaVersion: 1, nodes: [], edges: [], shots: [] },
    b1,
    { includeAssets: true, generationMode: "grid_preview" },
  );
  const origVideoId = sync1.anchorToNodeId["S01-01"];
  const docWithMedia: Doc = {
    ...sync1.document,
    nodes: sync1.document.nodes.map((n) =>
      n.id === origVideoId
        ? { ...n, media_id: "c".repeat(32), active_job: 101 }
        : n,
    ),
  };

  // Case A: Delete old shot and add a brand new shot in the same scene (count stays 1, different shotId)
  const replacedShotScript = `# 审讯
### S01 走廊 夜 内
人物：林默

△天花板通风口突然掉落一把钥匙。 <!-- fm-shot:sh_new2 -->
`;
  const bReplaced = parseScriptBreakdown(replacedShotScript, {
    docId: "doc_safe",
    docPath: "safe.md",
  });
  const ambA = detectAmbiguousShotMatches(docWithMedia, bReplaced);
  assert.equal(ambA.length, 1);
  assert.equal(ambA[0].existingVideoNodeId, origVideoId);
  const syncA = syncScriptBreakdownToCanvas(docWithMedia, bReplaced, {
    includeAssets: true,
    generationMode: "omni_ref",
  });
  // Without explicit user confirmation, new shot MUST NOT steal old media_id!
  const newShotNodeA = syncA.document.nodes.find(
    (n) => n.id === syncA.anchorToNodeId["S01-01"],
  )!;
  assert.notEqual(newShotNodeA.id, origVideoId);
  assert.equal(newShotNodeA.media_id, null);
  assert.ok(syncA.document.nodes.some((n) => n.id === origVideoId && n.media_id === "c".repeat(32)));

  // Case B: Copy-paste line with <!-- fm-shot:sh_orig1 --> above the original line and edit the copy
  const duplicatedCommentScript = `# 审讯
### S01 走廊 夜 内
人物：林默

△走廊尽头红灯闪烁，脚步声逼近。 <!-- fm-shot:sh_orig1 -->

△林默握紧手电筒走向铁门。 <!-- fm-shot:sh_orig1 -->
`;
  const bDupRaw = parseScriptBreakdown(duplicatedCommentScript, {
    docId: "doc_safe",
    docPath: "safe.md",
  });
  const preferred = resolvePreferredShotIdLines(docWithMedia, bDupRaw);
  const deduped = stampScriptShotIds(duplicatedCommentScript, preferred);
  assert.equal(deduped.changed, true);
  const bDedup = parseScriptBreakdown(deduped.markdown, {
    docId: "doc_safe",
    docPath: "safe.md",
  });
  assert.notEqual(bDedup.shots[0].shotId, bDedup.shots[1].shotId);
  assert.equal(bDedup.shots[1].shotId, "sh_orig1");
  const syncB = syncScriptBreakdownToCanvas(docWithMedia, bDedup, {
    includeAssets: true,
    generationMode: "omni_ref",
  });
  assert.equal(syncB.anchorToNodeId["S01-02"], origVideoId);
  const copyNode = syncB.document.nodes.find(
    (n) => n.id === syncB.anchorToNodeId["S01-01"],
  )!;
  assert.equal(copyNode.media_id, null);

  // Case C: Unused grid_preview node manually wired to another video AND pre-existing manual edge matching script endpoint
  const gridNode = sync1.document.nodes.find(
    (n) => n.extra_params?.script_role === "grid_preview",
  )!;
  const charNode = sync1.document.nodes.find(
    (n) => n.extra_params?.script_asset_category === "character",
  )!;
  const docManualGridAndEdge: Doc = {
    ...sync1.document,
    nodes: [
      ...sync1.document.nodes,
      { ...docWithMedia.nodes.find((n) => n.id === origVideoId)!, id: "manual_vid", media_id: null, active_job: null, extra_params: undefined },
    ],
    edges: [
      ...sync1.document.edges,
      {
        id: "manual_preexisting_char_edge",
        source: charNode.id,
        target: origVideoId,
      },
      { id: "manual_grid_to_vid", source: gridNode.id, target: "manual_vid" },
    ],
  };

  // Sync once in omni_ref (switches away from grid_preview while林默 is still in script)
  const syncKeepGrid = syncScriptBreakdownToCanvas(docManualGridAndEdge, b1, {
    includeAssets: true,
    generationMode: "omni_ref",
  });
  assert.ok(
    syncKeepGrid.document.nodes.some((n) => n.id === gridNode.id),
    "grid node with manual edge must not be deleted",
  );

  // Now remove 林默 from script -> pre-existing manual edge must STILL survive!
  const noCharScript = `# 审讯
### S01 走廊 夜 内

△空旷走廊尽头铁门紧闭。 <!-- fm-shot:sh_orig1 -->
`;
  const bNoChar = parseScriptBreakdown(noCharScript, {
    docId: "doc_safe",
    docPath: "safe.md",
  });
  const syncAfterRemoveChar = syncScriptBreakdownToCanvas(
    syncKeepGrid.document,
    bNoChar,
    { includeAssets: true, generationMode: "omni_ref" },
  );
  assert.ok(
    syncAfterRemoveChar.document.edges.some(
      (e) => e.id === "manual_preexisting_char_edge",
    ),
    "pre-existing manual edge matching script endpoint must survive when script removes character",
  );
});

test("partial sync updates selected existing shots in-place without reordering 01, 02, 03 to 02, 03, 01", () => {
  const threeShotsScript = `# 三镜测试
### S01 密室 夜 内

△第一镜：特写怀表秒针跳动。 <!-- fm-shot:sh_01 -->

△第二镜：中景众人抬头对视。 <!-- fm-shot:sh_02 -->

△第三镜：全景铁门缓缓开启。 <!-- fm-shot:sh_03 -->
`;
  const bInitial = parseScriptBreakdown(threeShotsScript, {
    docId: "doc_order",
    docPath: "order.md",
  });
  const fullSync = syncScriptBreakdownToCanvas(
    { schemaVersion: 1, nodes: [], edges: [], shots: [] },
    bInitial,
    { includeAssets: false, generationMode: "omni_ref" },
  );
  const id01 = fullSync.anchorToNodeId["S01-01"];
  const id02 = fullSync.anchorToNodeId["S01-02"];
  const id03 = fullSync.anchorToNodeId["S01-03"];
  assert.deepEqual(fullSync.document.shots, [id01, id02, id03]);

  // Edit shot 01 and run partial sync ONLY for ["S01-01"]
  const editedShot01Script = threeShotsScript.replace(
    "特写怀表秒针跳动",
    "微距特写怀表齿轮停转",
  );
  const bEdited = parseScriptBreakdown(editedShot01Script, {
    docId: "doc_order",
    docPath: "order.md",
  });
  const partialSync = syncScriptBreakdownToCanvas(fullSync.document, bEdited, {
    includeAssets: false,
    generationMode: "omni_ref",
    selectedAnchors: ["S01-01"],
  });
  assert.deepEqual(
    partialSync.document.shots,
    [id01, id02, id03],
    "syncing only S01-01 must keep [01, 02, 03] in-place instead of moving 01 to tail",
  );
  const updatedText01 = partialSync.document.nodes.find(
    (n) => n.type === "text" && n.extra_params?.script_anchor === "S01-01",
  )!;
  assert.match(updatedText01.text, /微距特写怀表齿轮停转/);
});

test("conflict draft recovery preserves baseRevision and conflict status across repeated close/reopen cycles", () => {
  // User edited from v1 ("原始版本 v1") to "本地未同步草稿"
  const initialPersisted = {
    draftBody: "本地未同步草稿",
    savedBody: "原始版本 v1",
    baseRevision: 1,
    updatedAt: 1000,
  };
  const collaboratorServer = {
    body_md: "协作者已保存正文 v2",
    revision: 2,
  };

  // 1st reopen: detects v1 vs v2 conflict and persists conflict flag while keeping baseRevision = 1
  const load1 = reconcileLoadedScriptDraft(
    collaboratorServer,
    initialPersisted,
  );
  assert.equal(load1.status, "conflict");
  assert.equal(load1.baseRevision, 1);
  assert.equal(load1.revision, 2);
  assert.equal(load1.draftBody, "本地未同步草稿");
  assert.equal(load1.nextPersisted?.conflicted, true);
  assert.equal(load1.nextPersisted?.baseRevision, 1);

  // User closes workspace (or types further while conflicted and closes)
  const persistedOnClose1 = buildPersistedScriptDraftForSession(
    {
      draftBody: load1.draftBody + "\n补充一句",
      savedBody: load1.savedBody,
      baseRevision: load1.baseRevision,
      revision: load1.revision,
      status: load1.status,
    },
    2000,
  );
  assert.ok(persistedOnClose1);
  assert.equal(persistedOnClose1.conflicted, true);
  assert.equal(persistedOnClose1.baseRevision, 1);

  // 2nd reopen against the same server v2: MUST remain "conflict" (never turning "dirty" to auto-save over v2!)
  const load2 = reconcileLoadedScriptDraft(
    collaboratorServer,
    persistedOnClose1,
  );
  assert.equal(load2.status, "conflict");
  assert.equal(load2.baseRevision, 1);
  assert.equal(load2.revision, 2);
  assert.equal(load2.draftBody, "本地未同步草稿\n补充一句");
});

test("resolveChatReplaceTarget enforces question-time node and expectedText baseline instead of click-time selection", () => {
  const nodes = [
    { id: "node_a", type: "text" as const, text: "修改后的新正文 v2" },
    { id: "node_b", type: "text" as const, text: "另一节点的无辜正文" },
  ];

  // Stale reply generated when node_a was "旧正文 v1" must NOT overwrite node_a ("v2") OR currently-selected node_b
  assert.throws(
    () =>
      resolveChatReplaceTarget({
        currentProjectId: "proj_1",
        nodes,
        messageContent: "AI 基于 v1 生成的旧回复",
        options: {
          targetProject: "proj_1",
          targetNode: "node_a",
          expectedText: "旧正文 v1",
        },
      }),
    /节点文字已被修改/,
  );

  // Reply generated without a selected text node cannot replace an arbitrary later-clicked node
  assert.throws(
    () =>
      resolveChatReplaceTarget({
        currentProjectId: "proj_1",
        nodes,
        messageContent: "通用对话回复",
        options: {},
      }),
    /提问时未选中文本节点/,
  );

  // When question-time node_a still matches expectedText, replace targets node_a cleanly even if user clicked node_b
  const resolved = resolveChatReplaceTarget({
    currentProjectId: "proj_1",
    nodes: [
      { id: "node_a", type: "text" as const, text: "旧正文 v1" },
      { id: "node_b", type: "text" as const, text: "另一节点的无辜正文" },
    ],
    messageContent: "AI 基于 v1 生成的回复",
    options: {
      targetProject: "proj_1",
      targetNode: "node_a",
      expectedText: "旧正文 v1",
    },
  });
  assert.deepEqual(resolved, {
    nodeId: "node_a",
    expectedText: "旧正文 v1",
  });
});

test("syncScriptBreakdownToCanvas keeps similar-named assets distinct and never reuses grid_preview images as asset nodes", () => {
  const similarAssetsScript = [
    "# EP04 相近资产防串绑",
    "",
    "## 角色资产",
    "- **CH01 林默**：成年男性，黑色风衣。",
    "- **CH02 林默少年**：十二岁少年，校服衬衫。",
    "",
    "## 场景资产",
    "- **SC01 客厅**：暖光吊灯与老式沙发。",
    "- **SC02 客厅走廊**：狭长木地板走廊与壁灯。",
    "",
    "### S01 客厅 夜 内",
    "人物：林默、林默少年",
    "",
    "△林默从客厅走廊走进客厅，望向墙上的林默少年旧照。",
  ].join("\n");

  const breakdown = parseScriptBreakdown(similarAssetsScript, {
    docId: "404",
    docPath: "EP04.md",
  });

  // Pre-seed canvas with two grid_preview image nodes whose titles match "客厅" and "资产 · SC01 客厅",
  // plus a standalone unbound reusable image node titled exactly "客厅走廊".
  const seededDoc: Doc = {
    schemaVersion: 1,
    nodes: [
      {
        ...newNode("image", 100, 100, 1),
        id: "grid_prev_exact_name",
        title: "客厅",
        prompt: "九宫格预览",
        media_id: "media_grid_1",
        generation_mode: "grid_preview",
        extra_params: { script_role: "grid_preview" },
      },
      {
        ...newNode("image", 100, 280, 2),
        id: "grid_prev_expected_title",
        title: "资产 · SC01 客厅",
        prompt: "九宫格预览2",
        media_id: "media_grid_2",
        extra_params: { script_role: "grid_preview" },
      },
      {
        ...newNode("image", 100, 460, 3),
        id: "unbound_corridor_img",
        title: "客厅走廊",
        prompt: "手工上传走廊参考图",
        media_id: "media_corridor_manual",
      },
    ],
    edges: [],
    shots: [],
  };

  const firstSync = syncScriptBreakdownToCanvas(seededDoc, breakdown, {
    includeAssets: true,
    generationMode: "omni_ref",
    tailChain: false,
    videoModel: "MiniMax H3",
    imageModel: "gpt-image-2.6-sunburst",
    ratio: "9:16",
  });

  // 1. Neither grid_preview node may be reused or have script_asset_key overwritten onto it
  const gridNode1 = firstSync.document.nodes.find(
    (n) => n.id === "grid_prev_exact_name",
  )!;
  const gridNode2 = firstSync.document.nodes.find(
    (n) => n.id === "grid_prev_expected_title",
  )!;
  assert.equal(gridNode1.extra_params?.script_role, "grid_preview");
  assert.equal(gridNode1.extra_params?.script_asset_key, undefined);
  assert.equal(gridNode2.extra_params?.script_role, "grid_preview");
  assert.equal(gridNode2.extra_params?.script_asset_key, undefined);

  // 2. Unbound exact-title image "客厅走廊" IS reused for scene:客厅走廊, while "客厅" gets its own fresh asset node!
  const corridorNode = firstSync.document.nodes.find(
    (n) => n.extra_params?.script_asset_key === "scene:客厅走廊",
  );
  const livingRoomNode = firstSync.document.nodes.find(
    (n) => n.extra_params?.script_asset_key === "scene:客厅",
  );
  assert.ok(corridorNode && livingRoomNode);
  assert.equal(corridorNode.id, "unbound_corridor_img");
  assert.notEqual(livingRoomNode.id, corridorNode.id);
  assert.notEqual(livingRoomNode.id, "grid_prev_exact_name");
  assert.notEqual(livingRoomNode.id, "grid_prev_expected_title");

  // 3. Similar character names "林默" vs "林默少年" stay distinct and never overwrite each other's script_asset_key
  const adultHeroNode = firstSync.document.nodes.find(
    (n) => n.extra_params?.script_asset_key === "character:林默",
  );
  const youngHeroNode = firstSync.document.nodes.find(
    (n) => n.extra_params?.script_asset_key === "character:林默少年",
  );
  assert.ok(adultHeroNode && youngHeroNode);
  assert.notEqual(adultHeroNode.id, youngHeroNode.id);

  // 4. Second sync reuses all 4 asset nodes cleanly without creating duplicates
  const secondSync = syncScriptBreakdownToCanvas(firstSync.document, breakdown, {
    includeAssets: true,
    generationMode: "omni_ref",
    tailChain: false,
    videoModel: "MiniMax H3",
    imageModel: "gpt-image-2.6-sunburst",
    ratio: "9:16",
  });
  assert.equal(secondSync.createdNodeIds.length, 0);
  assert.equal(
    secondSync.document.nodes.find(
      (n) => n.extra_params?.script_asset_key === "scene:客厅",
    )?.id,
    livingRoomNode.id,
  );
  assert.equal(
    secondSync.document.nodes.find(
      (n) => n.extra_params?.script_asset_key === "scene:客厅走廊",
    )?.id,
    corridorNode.id,
  );
});

test("buildCanvasLocalBackup preserves top-level canvas draft format and embeds unsaved_scripts when present", () => {
  const sampleDoc: Doc = { schemaVersion: 1, nodes: [], edges: [], shots: [] };
  const canvasOnly = buildCanvasLocalBackup(
    { title: "纯画布草稿", document: sampleDoc },
    [],
  );
  assert.equal(canvasOnly.title, "纯画布草稿");
  assert.deepEqual(canvasOnly.document, sampleDoc);
  assert.equal("unsaved_scripts" in canvasOnly, false);

  const withScripts = buildCanvasLocalBackup(
    { title: "含剧本冲突画布", document: sampleDoc },
    [
      {
        id: "12",
        path: "01_EP01.md",
        doc_kind: "script",
        status: "conflict",
        base_revision: 3,
        server_revision: 4,
        saved_body_md: "# EP01\n> 远端版本",
        draft_body_md: "# EP01\n△本地冲突草稿",
      },
    ],
  );
  assert.equal(withScripts.title, "含剧本冲突画布");
  assert.equal(withScripts.unsaved_scripts?.length, 1);
  assert.equal(withScripts.unsaved_scripts?.[0]?.path, "01_EP01.md");
  assert.equal(withScripts.unsaved_scripts?.[0]?.status, "conflict");
  assert.match(
    withScripts.unsaved_scripts?.[0]?.draft_body_md ?? "",
    /本地冲突草稿/,
  );
});

test("runs-derived completed/active jobs protect grid_preview nodes on mode switch and prevent positional video rebinding", () => {
  const scriptV1 = [
    "# EP05 任务列表产出保护",
    "### S01 钟楼 夜 内",
    "△林默推开钟楼木门。 <!-- fm-shot:sh_bell_01 -->",
  ].join("\n");
  const bd1 = parseScriptBreakdown(scriptV1, { docId: "505", docPath: "EP05.md" });

  // 1. Sync in grid_preview mode -> grid node has media_id: null, active_job: null
  const gridSynced = syncScriptBreakdownToCanvas(
    { schemaVersion: 1, nodes: [], edges: [], shots: [] },
    bd1,
    { generationMode: "grid_preview", gridLayout: "3x3" },
  );
  const gridNode = gridSynced.document.nodes.find(
    (n) => n.extra_params?.script_role === "grid_preview",
  )!;
  const videoNode = gridSynced.document.nodes.find((n) => n.type === "video")!;
  assert.ok(gridNode && videoNode);
  assert.equal(gridNode.media_id, null);
  assert.equal(gridNode.active_job, null);
  assert.equal(videoNode.media_id, null);
  assert.equal(videoNode.active_job, null);

  // Latest completed jobs exist ONLY in `runs` (exact CanvasWorkspace resolveNode auto-selection behavior!)
  const runs: Job[] = [
    {
      id: 901,
      canvas_node: gridNode.id,
      owner: 1,
      kind: "image",
      status: "done",
      result: "c".repeat(32),
      note: "",
      prompt: gridNode.prompt,
      refs: [],
      width: 1024,
      height: 1024,
      created: 1000,
      seconds: 0,
      quality: 0,
      ratio: "16:9",
      image_quality: "medium",
      model: "gpt-image-2.6-sunburst",
    },
    {
      id: 902,
      canvas_node: videoNode.id,
      owner: 1,
      kind: "video",
      status: "done",
      result: "d".repeat(32),
      note: "",
      prompt: videoNode.prompt,
      refs: [],
      width: 1280,
      height: 720,
      created: 1001,
      seconds: 5,
      quality: 720,
      ratio: "16:9",
      image_quality: "",
      model: "MiniMax H3",
    },
  ];
  assert.equal(nodeHasOutputOrActiveRun(gridNode, runs), true);
  assert.equal(nodeHasOutputOrActiveRun(videoNode, runs), true);

  // 2. Re-sync switching to non-grid omni_ref WITH runs -> gridNode MUST be preserved (not deleted)!
  const switchedToOmni = syncScriptBreakdownToCanvas(
    gridSynced.document,
    bd1,
    { generationMode: "omni_ref", runs },
  );
  assert.ok(
    switchedToOmni.document.nodes.some((n) => n.id === gridNode.id),
    "grid_preview node with completed job in runs must NOT be deleted on mode switch",
  );

  // 3. Delete sh_bell_01 and add a brand-new shot sh_bell_99 in the same scene (sameSceneCount = 1):
  // videoNode (whose media is only in `runs`) MUST require explicit confirmation and NEVER auto-rebind by position!
  const scriptV2 = [
    "# EP05 任务列表产出保护",
    "### S01 钟楼 夜 内",
    "△完全不同的新镜头：白鸽飞出钟楼窗外。 <!-- fm-shot:sh_bell_99 -->",
  ].join("\n");
  const bd2 = parseScriptBreakdown(scriptV2, { docId: "505", docPath: "EP05.md" });
  const amb = detectAmbiguousShotMatches(
    switchedToOmni.document,
    bd2,
    undefined,
    runs,
  );
  assert.equal(amb.length, 1);
  assert.equal(amb[0].existingVideoNodeId, videoNode.id);

  const syncedWithoutExplicit = syncScriptBreakdownToCanvas(
    switchedToOmni.document,
    bd2,
    { generationMode: "omni_ref", runs },
  );
  const oldVidAfter = syncedWithoutExplicit.document.nodes.find(
    (n) => n.id === videoNode.id,
  )!;
  assert.equal(oldVidAfter.extra_params?.script_shot_id, "sh_bell_01");
  assert.notEqual(syncedWithoutExplicit.anchorToNodeId["S01-01"], videoNode.id);
});

test("explicit node binding aligns script_shot_id on canvas nodes and partial selectedAnchors does not flag bound unselected shots", () => {
  const initialScript = [
    "# EP06 显式绑定与局部同步校验",
    "### S01 书房 夜 内",
    "△林默翻开日记本。 <!-- fm-shot:sh_old_01 -->",
    "△林默吹灭蜡烛。 <!-- fm-shot:sh_keep_02 -->",
    "△林默推窗望月。 <!-- fm-shot:sh_keep_03 -->",
  ].join("\n");
  const bdInit = parseScriptBreakdown(initialScript, {
    docId: "606",
    docPath: "EP06.md",
  });
  const initSync = syncScriptBreakdownToCanvas(
    { schemaVersion: 1, nodes: [], edges: [], shots: [] },
    bdInit,
    { generationMode: "omni_ref" },
  );
  const v1Id = initSync.anchorToNodeId["S01-01"];
  const v2Id = initSync.anchorToNodeId["S01-02"];
  const v3Id = initSync.anchorToNodeId["S01-03"];
  const withMedia: Doc = {
    ...initSync.document,
    nodes: initSync.document.nodes.map((n) =>
      n.type === "video" ? { ...n, media_id: "e".repeat(32) } : n,
    ),
  };

  // 1. Partial selection ["S01-01"] must NOT report bound unselected S01-02 / S01-03 media nodes as ambiguous!
  const partialAmb = detectAmbiguousShotMatches(withMedia, bdInit, ["S01-01"]);
  assert.deepEqual(partialAmb, []);

  // 2. Rewrite S01-01 with a new persistent comment <!-- fm-shot:sh_new_01 --> and explicitly bind old v1Id to S01-01
  const rewrittenScript = [
    "# EP06 显式绑定与局部同步校验",
    "### S01 书房 夜 内",
    "△全新的第一镜：特写铜钥匙插入抽屉锁孔。 <!-- fm-shot:sh_new_01 -->",
    "△林默吹灭蜡烛。 <!-- fm-shot:sh_keep_02 -->",
    "△林默推窗望月。 <!-- fm-shot:sh_keep_03 -->",
  ].join("\n");
  const bdRewritten = parseScriptBreakdown(rewrittenScript, {
    docId: "606",
    docPath: "EP06.md",
  });
  const ambBeforeExplicit = detectAmbiguousShotMatches(withMedia, bdRewritten, [
    "S01-01",
  ]);
  assert.equal(ambBeforeExplicit.length, 1);
  assert.equal(ambBeforeExplicit[0].existingVideoNodeId, v1Id);

  const boundSync = syncScriptBreakdownToCanvas(withMedia, bdRewritten, {
    generationMode: "omni_ref",
    selectedAnchors: ["S01-01"],
    explicitNodeBindings: { "S01-01": v1Id },
  });
  const v1After = boundSync.document.nodes.find((n) => n.id === v1Id)!;
  assert.equal(
    v1After.extra_params?.script_shot_id,
    "sh_new_01",
    "explicit binding must align canvas node script_shot_id with the script shot's sh_new_01",
  );
  // Order of shots [v1Id, v2Id, v3Id] preserved in-place
  assert.deepEqual(boundSync.document.shots, [v1Id, v2Id, v3Id]);

  // 3. Subsequent sync WITHOUT explicitNodeBindings has ZERO ambiguity and reuses v1Id cleanly!
  assert.deepEqual(
    detectAmbiguousShotMatches(boundSync.document, bdRewritten),
    [],
  );
  const resyncAfterExplicit = syncScriptBreakdownToCanvas(
    boundSync.document,
    bdRewritten,
    { generationMode: "omni_ref" },
  );
  assert.equal(resyncAfterExplicit.anchorToNodeId["S01-01"], v1Id);
  assert.equal(resyncAfterExplicit.createdNodeIds.length, 0);
});

test("reconcileRenamedOpenScriptSession refreshes clean session and flags conflict on dirty session when collaborator edited before directory rename", () => {
  // User A has clean r1 open; Collaborator B saved r2 ("body_r2"); User A renamed directory -> r3 ("body_r2")
  const cleanReconciled = reconcileRenamedOpenScriptSession(
    {
      draftBody: "body_r1",
      savedBody: "body_r1",
      baseRevision: 1,
      revision: 1,
      status: "saved",
      error: "",
    },
    { revision: 3, body_md: "body_r2" },
  );
  assert.deepEqual(cleanReconciled, {
    draftBody: "body_r2",
    savedBody: "body_r2",
    baseRevision: 3,
    revision: 3,
    status: "saved",
    error: "",
  });

  // User A had unsaved local draft at r1 ("draft_A_on_r1"); Collaborator B saved r2 ("body_r2"); directory rename -> r3
  const dirtyReconciled = reconcileRenamedOpenScriptSession(
    {
      draftBody: "draft_A_on_r1",
      savedBody: "body_r1",
      baseRevision: 1,
      revision: 1,
      status: "dirty",
      error: "",
    },
    { revision: 3, body_md: "body_r2" },
  );
  assert.equal(dirtyReconciled.status, "conflict");
  assert.equal(dirtyReconciled.draftBody, "draft_A_on_r1");
  assert.equal(dirtyReconciled.savedBody, "body_r2");
  assert.equal(dirtyReconciled.baseRevision, 1);
  assert.equal(dirtyReconciled.revision, 3);
});

test("runsKnown=false preserves grid_preview nodes and their edges on mode switch and blocks positional video rebinding", () => {
  const scriptV1 = [
    "# EP07 任务状态未加载时的保守保护",
    "## 角色资产",
    "- **CH01 林默**：黑色风衣侦探。",
    "### S01 码头 夜 外",
    "人物：林默",
    "△林默站在雾气弥漫的码头边。 <!-- fm-shot:sh_dock_01 -->",
  ].join("\n");
  const bd1 = parseScriptBreakdown(scriptV1, { docId: "707", docPath: "EP07.md" });
  const gridSynced = syncScriptBreakdownToCanvas(
    { schemaVersion: 1, nodes: [], edges: [], shots: [] },
    bd1,
    { generationMode: "grid_preview", includeAssets: true },
  );
  const gridNode = gridSynced.document.nodes.find(
    (n) => n.extra_params?.script_role === "grid_preview",
  )!;
  const videoNode = gridSynced.document.nodes.find((n) => n.type === "video")!;
  assert.ok(gridNode && videoNode);
  const gridEdgeIdsBefore = gridSynced.document.edges.filter(
    (e) => e.source === gridNode.id || e.target === gridNode.id,
  );
  assert.ok(gridEdgeIdsBefore.length >= 3); // text->grid, asset->grid, grid->video

  // Simulate /api/canvases/:id/runs failing or not yet loaded (runs=[], runsKnown=false)
  const switchedWhileRunsUnknown = syncScriptBreakdownToCanvas(
    gridSynced.document,
    bd1,
    {
      generationMode: "omni_ref",
      includeAssets: true,
      runs: [],
      runsKnown: false,
    },
  );
  assert.ok(
    switchedWhileRunsUnknown.document.nodes.some((n) => n.id === gridNode.id),
    "grid_preview node must be preserved when runsKnown is false",
  );
  for (const prevEdge of gridEdgeIdsBefore) {
    assert.ok(
      switchedWhileRunsUnknown.document.edges.some(
        (e) => e.source === prevEdge.source && e.target === prevEdge.target,
      ),
      `edge ${prevEdge.source}->${prevEdge.target} must be preserved when runsKnown is false`,
    );
  }

  // Same-scene rewrite while runsKnown=false must NOT positionally rebind uncertain video node
  const scriptV2 = [
    "# EP07 任务状态未加载时的保守保护",
    "### S01 码头 夜 外",
    "△货轮拉响汽笛驶离港口。 <!-- fm-shot:sh_dock_99 -->",
  ].join("\n");
  const bd2 = parseScriptBreakdown(scriptV2, { docId: "707", docPath: "EP07.md" });
  const ambUnknown = detectAmbiguousShotMatches(
    switchedWhileRunsUnknown.document,
    bd2,
    ["S01-01"],
    [],
    false,
  );
  assert.equal(ambUnknown.length, 1);
  assert.equal(ambUnknown[0].existingVideoNodeId, videoNode.id);
});

test("detectAmbiguousShotMatches keeps cross-scene manual binding candidates when explicit full-selection array is passed", () => {
  const scriptScene1 = [
    "# EP08 跨场改稿手动绑定",
    "### S01 旧书店 夜 内",
    "△林默在书架后发现暗格。 <!-- fm-shot:sh_s01_orig -->",
  ].join("\n");
  const bdS01 = parseScriptBreakdown(scriptScene1, {
    docId: "808",
    docPath: "EP08.md",
  });
  const syncedS01 = syncScriptBreakdownToCanvas(
    { schemaVersion: 1, nodes: [], edges: [], shots: [] },
    bdS01,
    { generationMode: "omni_ref" },
  );
  const oldVideoId = syncedS01.anchorToNodeId["S01-01"];
  const withMedia: Doc = {
    ...syncedS01.document,
    nodes: syncedS01.document.nodes.map((n) =>
      n.id === oldVideoId ? { ...n, media_id: "f".repeat(32) } : n,
    ),
  };

  // Author rewrites S01 into S02 with completely new shotId and action text;
  // ScriptSyncModal defaults to selecting all current shots and passes explicit ["S02-01"] array!
  const scriptScene2 = [
    "# EP08 跨场改稿手动绑定",
    "### S02 地下密室 夜 内",
    "△火柴擦亮照亮石桌上的青铜匣。 <!-- fm-shot:sh_s02_rewritten -->",
  ].join("\n");
  const bdS02 = parseScriptBreakdown(scriptScene2, {
    docId: "808",
    docPath: "EP08.md",
  });

  const ambFullArray = detectAmbiguousShotMatches(withMedia, bdS02, ["S02-01"]);
  assert.equal(
    ambFullArray.length,
    1,
    "full-selection array must NOT filter out cross-scene unmatched media node",
  );
  assert.equal(ambFullArray[0].existingVideoNodeId, oldVideoId);
  assert.deepEqual(ambFullArray[0].candidateAnchors, ["S02-01"]);

  // Binding explicitly across scenes aligns shotId and anchor cleanly
  const rebound = syncScriptBreakdownToCanvas(withMedia, bdS02, {
    generationMode: "omni_ref",
    selectedAnchors: ["S02-01"],
    explicitNodeBindings: { "S02-01": oldVideoId },
  });
  assert.equal(rebound.anchorToNodeId["S02-01"], oldVideoId);
  const reboundVideo = rebound.document.nodes.find((n) => n.id === oldVideoId)!;
  assert.equal(reboundVideo.extra_params?.script_shot_id, "sh_s02_rewritten");
  assert.equal(reboundVideo.extra_params?.script_scene_code, "S02");
});

test("createCanvasRunsTracker resolves pre-existing in-flight /runs directly before deferred React 19 state commit", async () => {
  const tracker = createCanvasRunsTracker<{ id: number; canvas_node: string }>({
    reconcile: (_prev, next) => [...next],
  });

  // Simulate React 19 deferring setRuns updater commit behind a pending state update
  let reactCommittedRuns: { id: number; canvas_node: string }[] = [];
  let releaseApi!: () => void;
  const apiGate = new Promise<void>((resolve) => {
    releaseApi = resolve;
  });

  const inFlightMountFetch = tracker.runFetch(
    async () => {
      await apiGate;
      return {
        runs: [{ id: 101, canvas_node: "grid_node_1" }],
        extra: { ok: true },
      };
    },
    {
      silent: true,
      onCommit: (nextRuns) => {
        // React 19 commits state asynchronously in a later task
        setTimeout(() => {
          reactCommittedRuns = nextRuns;
        }, 50);
      },
    },
  );

  assert.equal(tracker.hasInFlight(), true);
  const ensurePromise = tracker.ensureFresh(async () => {
    throw new Error("should reuse pre-existing in-flight request instead of re-fetching");
  });

  releaseApi();
  const [snap] = await Promise.all([ensurePromise, inFlightMountFetch]);

  // Even BEFORE React 19 commits reactCommittedRuns (still length 0!), ensureFresh and getCurrentRuns MUST already have length 1!
  assert.equal(reactCommittedRuns.length, 0);
  assert.equal(snap.runsKnown, true);
  assert.equal(snap.runs.length, 1);
  assert.equal(snap.runs[0].canvas_node, "grid_node_1");
  assert.equal(tracker.getCurrentRuns().length, 1);

  await new Promise((r) => setTimeout(r, 60));
  assert.equal(reactCommittedRuns.length, 1);
});

test("createCanvasRunsTracker never regresses when superseded request A resolves after newer request B, failure, or reset", async () => {
  const script = [
    "# EP10 乱序请求保护",
    "### S01 天台 夜 外",
    "△林默仰望霓虹灯牌。 <!-- fm-shot:sh_roof_01 -->",
  ].join("\n");
  const bd = parseScriptBreakdown(script, { docId: "1010", docPath: "EP10.md" });
  const gridInit = syncScriptBreakdownToCanvas(
    { schemaVersion: 1, nodes: [], edges: [], shots: [] },
    bd,
    { generationMode: "grid_preview" },
  );
  const gridNode = gridInit.document.nodes.find(
    (n) => n.extra_params?.script_role === "grid_preview",
  )!;

  // 1. Exact out-of-order reproducer:
  // A (seq=1) is an older empty /runs poll; ensureFresh starts waiting on A;
  // B (seq=2) from candidate submission fetchRuns() finishes FIRST with a queued/done job on gridNode;
  // A finishes LAST with []. ensureFresh MUST return B's job list and preserve gridNode on omni_ref switch!
  const tracker = createCanvasRunsTracker<Job>({
    reconcile: (_prev, next) => [...next],
  });
  let releaseA!: () => void;
  const gateA = new Promise<void>((resolve) => {
    releaseA = resolve;
  });
  let releaseB!: () => void;
  const gateB = new Promise<void>((resolve) => {
    releaseB = resolve;
  });

  const reqA = tracker.runFetch(
    async () => {
      await gateA;
      return { runs: [], extra: null };
    },
    { silent: true },
  );

  const ensure1 = tracker.ensureFresh(async () => {
    throw new Error("should consume committed B snapshot without extra fetch");
  });

  const queuedGridJob: Job = {
    id: 5001,
    canvas_node: gridNode.id,
    owner: 1,
    kind: "image",
    status: "queued",
    result: null,
    note: "",
    prompt: gridNode.prompt,
    refs: [],
    width: 1024,
    height: 1024,
    created: 2000,
    seconds: 0,
    quality: 0,
    ratio: "16:9",
    image_quality: "medium",
    model: "gpt-image-2.6-sunburst",
  };
  const reqB = tracker.runFetch(async () => {
    await gateB;
    return { runs: [queuedGridJob], extra: null };
  });

  // B finishes FIRST, then old empty A finishes LAST
  releaseB();
  await reqB;
  releaseA();
  const [snap1] = await Promise.all([ensure1, reqA]);

  assert.equal(snap1.runsKnown, true);
  assert.equal(snap1.runs.length, 1);
  assert.equal(snap1.runs[0].id, 5001);

  const syncedOmni = syncScriptBreakdownToCanvas(gridInit.document, bd, {
    generationMode: "omni_ref",
    runs: snap1.runs,
    runsKnown: snap1.runsKnown,
  });
  assert.equal(
    syncedOmni.document.nodes.some((n) => n.id === gridNode.id),
    true,
    "grid_preview node with queued job from B must NOT be deleted when stale A resolves last",
  );

  // 2. Latest request B2 fails (503), then superseded A2 resolves ok:true -> must NOT mark runsKnown:true if retry also fails!
  let releaseA2!: () => void;
  const gateA2 = new Promise<void>((resolve) => {
    releaseA2 = resolve;
  });
  const reqA2 = tracker.runFetch(
    async () => {
      await gateA2;
      return { runs: [], extra: null };
    },
    { silent: true },
  );
  const ensure2 = tracker.ensureFresh(() =>
    tracker.runFetch(async () => {
      throw new Error("503 retry failed");
    }),
  );
  const reqB2 = tracker.runFetch(
    async () => {
      throw new Error("503 B2 failed");
    },
    { silent: true },
  );
  await reqB2;
  releaseA2();
  const [snap2] = await Promise.all([ensure2, reqA2]);
  assert.equal(
    snap2.runsKnown,
    false,
    "superseded A2 must NOT re-mark runsKnown=true after newer B2 failed",
  );
  assert.equal(snap2.runs.length, 1); // retains last valid currentRuns ([queuedGridJob])

  // 3. tracker.reset() while A3 is in flight -> A3 resolving must NOT mark runsKnown:true!
  let releaseA3!: () => void;
  const gateA3 = new Promise<void>((resolve) => {
    releaseA3 = resolve;
  });
  const reqA3 = tracker.runFetch(
    async () => {
      await gateA3;
      return { runs: [], extra: null };
    },
    { silent: true },
  );
  const ensure3 = tracker.ensureFresh(async () => {
    throw new Error("unmounted/reset fetch rejected");
  });
  tracker.reset([]);
  releaseA3();
  const [snap3] = await Promise.all([ensure3, reqA3]);
  assert.equal(
    snap3.runsKnown,
    false,
    "pre-reset in-flight request must NOT mark runsKnown=true after reset()",
  );

  // 4. B finishes BEFORE sync starts while superseded old A is STILL hanging:
  //    - hasInFlight() must be false (obsolete A must NOT block polling!)
  //    - ensureFresh MUST NOT reuse B's older empty snapshot just because obsolete A is still hanging;
  //      it must call freshFetch() (picking up collaborator's newly submitted grid job) without waiting on A!
  const tracker4 = createCanvasRunsTracker<Job>({
    reconcile: (_prev, next) => [...next],
  });
  let releaseObsoleteA!: () => void;
  const gateObsoleteA = new Promise<void>((resolve) => {
    releaseObsoleteA = resolve;
  });
  const reqObsoleteA = tracker4.runFetch(
    async () => {
      await gateObsoleteA;
      return { runs: [], extra: null };
    },
    { silent: true },
  );
  // Newer manual refresh B finishes BEFORE sync starts (still empty at that moment)
  await tracker4.runFetch(async () => ({ runs: [], extra: null }));
  assert.equal(
    tracker4.hasInFlight(),
    false,
    "superseded hanging poll A must NOT block subsequent polling once newer B finished",
  );

  // Collaborator / another tab submits grid generation; user clicks sync while obsolete A is still hanging!
  let freshCalls = 0;
  const settled4 = await tracker4.ensureFresh(() => {
    freshCalls++;
    return tracker4.runFetch(async () => ({
      runs: [queuedGridJob],
      extra: null,
    }));
  });
  assert.equal(freshCalls, 1);
  assert.equal(settled4.runsKnown, true);
  assert.equal(settled4.runs.length, 1);
  assert.equal(settled4.runs[0].id, 5001);

  const syncedAfterBBeforeSync = syncScriptBreakdownToCanvas(
    gridInit.document,
    bd,
    {
      generationMode: "omni_ref",
      runs: settled4.runs,
      runsKnown: settled4.runsKnown,
    },
  );
  assert.equal(
    syncedAfterBBeforeSync.document.nodes.some((n) => n.id === gridNode.id),
    true,
    "grid_preview node must be preserved via freshFetch even when superseded A was still pending",
  );

  // Finally release obsolete A and verify currentRuns still retains [queuedGridJob]
  releaseObsoleteA();
  await reqObsoleteA;
  assert.equal(tracker4.getCurrentRuns().length, 1);

  // 5. ensureFresh enters with NO in-flight request, triggers A itself (which stays permanently unreleased),
  //    then candidate submission triggers B and B succeeds -> ensureFresh MUST resolve immediately WITHOUT releasing A!
  const withShortTimeout = <T>(p: Promise<T>, label: string): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${label} hung waiting on superseded request`)),
        300,
      );
      p.then(
        (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        (err) => {
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        },
      );
    });

  const tracker5 = createCanvasRunsTracker<Job>({
    reconcile: (_prev, next) => [...next],
  });
  assert.equal(tracker5.hasInFlight(), false);
  let rejectSelfA5!: (err: Error) => void;
  const gateSelfA5 = new Promise<void>((_resolve, reject) => {
    rejectSelfA5 = reject;
  });
  let selfA5Released = false;
  const ensure5 = tracker5.ensureFresh(() =>
    tracker5.runFetch(async () => {
      await gateSelfA5;
      selfA5Released = true;
      return { runs: [], extra: null };
    }),
  );

  // Candidate submission finishes while A5 is still hanging and calls fetchRuns() -> B5
  await tracker5.runFetch(async () => ({
    runs: [queuedGridJob],
    extra: null,
  }));
  assert.equal(tracker5.hasInFlight(), false);
  assert.equal(selfA5Released, false);

  // Must resolve WITHOUT releasing A5!
  const settled5 = await withShortTimeout(
    ensure5,
    "ensureFresh(self-triggered A5 superseded by B5)",
  );
  assert.equal(selfA5Released, false);
  assert.equal(settled5.runsKnown, true);
  assert.equal(settled5.runs.length, 1);
  assert.equal(settled5.runs[0].id, 5001);

  const syncedSelfASuperseded = syncScriptBreakdownToCanvas(
    gridInit.document,
    bd,
    {
      generationMode: "omni_ref",
      runs: settled5.runs,
      runsKnown: settled5.runsKnown,
    },
  );
  assert.equal(
    syncedSelfASuperseded.document.nodes.some((n) => n.id === gridNode.id),
    true,
    "grid_preview node must be preserved when self-triggered A hangs and concurrent B succeeds",
  );

  // Even if superseded A5 later rejects, rejection is handled and currentRuns keeps [queuedGridJob]
  rejectSelfA5(new Error("network socket closed much later"));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(tracker5.getCurrentRuns().length, 1);
  assert.equal(tracker5.getCurrentRuns()[0].id, 5001);

  // 6. ensureFresh enters with NO in-flight request, triggers A6 itself (which stays unreleased),
  //    then tracker.reset([]) runs -> ensureFresh MUST wake & resolve immediately WITHOUT releasing A6!
  const tracker6 = createCanvasRunsTracker<Job>({
    reconcile: (_prev, next) => [...next],
  });
  let rejectSelfA6!: (err: Error) => void;
  const gateSelfA6 = new Promise<void>((_resolve, reject) => {
    rejectSelfA6 = reject;
  });
  let selfA6Released = false;
  const ensure6 = tracker6.ensureFresh(() =>
    tracker6.runFetch(async () => {
      await gateSelfA6;
      selfA6Released = true;
      return { runs: [queuedGridJob], extra: null };
    }),
  );
  tracker6.reset([]);
  const settled6 = await withShortTimeout(
    ensure6,
    "ensureFresh(self-triggered A6 woken by reset)",
  );
  assert.equal(selfA6Released, false);
  assert.equal(settled6.runsKnown, false);
  assert.equal(settled6.runs.length, 0);

  rejectSelfA6(new Error("aborted after reset"));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(tracker6.getCurrentRuns().length, 0);

  // 7. ensureFresh triggers A7 itself (stays unreleased), newer B7 fails (503) ->
  //    ensureFresh wakes WITHOUT releasing A7 and marks runsKnown=false!
  const tracker7 = createCanvasRunsTracker<Job>({
    reconcile: (_prev, next) => [...next],
  });
  let releaseSelfA7!: () => void;
  const gateSelfA7 = new Promise<void>((resolve) => {
    releaseSelfA7 = resolve;
  });
  let selfA7Released = false;
  const ensure7 = tracker7.ensureFresh(() =>
    tracker7.runFetch(async () => {
      await gateSelfA7;
      selfA7Released = true;
      return { runs: [], extra: null };
    }),
  );
  await tracker7.runFetch(
    async () => {
      throw new Error("503 B7 failed");
    },
    { silent: true },
  );
  const settled7 = await withShortTimeout(
    ensure7,
    "ensureFresh(self-triggered A7 superseded by failing B7)",
  );
  assert.equal(selfA7Released, false);
  assert.equal(settled7.runsKnown, false);
  releaseSelfA7();
  await new Promise((r) => setTimeout(r, 10));
});

test("runsKnown=false preserves existing grid->video edge when shot references >=9 props/scenes with includeAssets=false or true", () => {
  const nineRefsScript = [
    "# EP09 九道具场次宫格连线保护",
    "## 场景资产",
    "- **SC01 古董店**：暗调木柜与铜灯。",
    "## 道具资产",
    "- **PR01 怀表**：黄铜怀表。",
    "- **PR02 铜钥匙**：古旧铜钥匙。",
    "- **PR03 羊皮卷**：残破羊皮卷。",
    "- **PR04 烛台**：银质三叉烛台。",
    "- **PR05 放大镜**：木柄放大镜。",
    "- **PR06 印章**：红玛瑙印章。",
    "- **PR07 算盘**：紫檀算盘。",
    "- **PR08 匕首**：雕花短匕首。",
    "### S01 古董店 夜 内",
    "△桌面依次摆着怀表、铜钥匙、羊皮卷、烛台、放大镜、印章、算盘、匕首，映照古董店微光。 <!-- fm-shot:sh_ant_01 -->",
  ].join("\n");

  const bd = parseScriptBreakdown(nineRefsScript, {
    docId: "909",
    docPath: "EP09.md",
  });
  assert.equal(bd.shots[0].referencedAssets.length, 9);

  // 1. Initial sync in grid_preview mode (includeAssets=false, just like user toggling assets off)
  const gridSync = syncScriptBreakdownToCanvas(
    { schemaVersion: 1, nodes: [], edges: [], shots: [] },
    bd,
    { generationMode: "grid_preview", includeAssets: false },
  );
  const gridNode = gridSync.document.nodes.find(
    (n) => n.extra_params?.script_role === "grid_preview",
  )!;
  const videoNode = gridSync.document.nodes.find((n) => n.type === "video")!;
  assert.ok(gridNode && videoNode);
  const hadGridToVideoBefore = gridSync.document.edges.some(
    (e) => e.source === gridNode.id && e.target === videoNode.id,
  );
  assert.equal(hadGridToVideoBefore, true);

  // 2. Switch to omni_ref with includeAssets=false and runsKnown=false (/runs failed):
  // grid->video MUST remain intact (imageRefsAfter === 1, never dropped to 0!)
  const switchedNoAssets = syncScriptBreakdownToCanvas(gridSync.document, bd, {
    generationMode: "omni_ref",
    includeAssets: false,
    runs: [],
    runsKnown: false,
  });
  const gridPreserved = switchedNoAssets.document.nodes.some(
    (n) => n.id === gridNode.id,
  );
  const hasGridToVideoAfter = switchedNoAssets.document.edges.some(
    (e) => e.source === gridNode.id && e.target === videoNode.id,
  );
  const imageRefsAfter = switchedNoAssets.document.edges.filter((e) => {
    if (e.target !== videoNode.id) return false;
    const src = switchedNoAssets.document.nodes.find((n) => n.id === e.source);
    return src?.type === "image";
  }).length;
  assert.deepEqual(
    {
      before: hadGridToVideoBefore,
      after: hasGridToVideoAfter,
      gridPreserved,
      imageRefsAfter,
    },
    {
      before: true,
      after: true,
      gridPreserved: true,
      imageRefsAfter: 1,
    },
  );

  // 3. Switch to omni_ref with includeAssets=true (9 assets) and runsKnown=false:
  // existing grid->video takes priority first, and 8 new asset refs fill the remaining capacity (total = 9 <= 9)!
  const switchedWithAssets = syncScriptBreakdownToCanvas(
    gridSync.document,
    bd,
    {
      generationMode: "omni_ref",
      includeAssets: true,
      runs: [],
      runsKnown: false,
    },
  );
  assert.equal(
    switchedWithAssets.document.edges.some(
      (e) => e.source === gridNode.id && e.target === videoNode.id,
    ),
    true,
    "existing grid->video must still be preserved first even when 9 assets are enabled",
  );
  const totalVideoImageRefs = switchedWithAssets.document.edges.filter((e) => {
    if (e.target !== videoNode.id) return false;
    const src = switchedWithAssets.document.nodes.find(
      (n) => n.id === e.source,
    );
    return src?.type === "image";
  }).length;
  assert.equal(totalVideoImageRefs, 9);
});
