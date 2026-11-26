import assert from "node:assert/strict";
import test from "node:test";
import {
  extractScriptAnchorsMap,
  parseScriptBreakdown,
  replaceCanvasNodeText,
  searchCanvasTextNodes,
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
