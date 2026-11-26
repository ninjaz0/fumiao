import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMatchSpansReplacement,
  detectAmbiguousShotMatches,
  extractScriptAnchorsMap,
  parseScriptBreakdown,
  replaceCanvasNodeText,
  searchCanvasTextNodes,
  stampScriptShotIds,
  syncScriptBreakdownToCanvas,
} from "../../apps/web/canvas-editor/script-fusion.js";
import type { Doc } from "../../apps/web/canvas-editor/types.js";
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
});
