import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  PASTE_OFFSET,
  collectDownloadTargets,
  createClipboardSnapshot,
  formatRunsError,
  hasCanvasSelectionToolbar,
  hasDownloadableNodes,
  isCanvasComposerOpen,
  matchViewportFocusShortcut,
  newNode,
  nextContextSelection,
  resolveBatchShots,
  resolveCinePopoverSide,
  resolveFocusTargets,
  resolveHistoryModalState,
  resolvePasteOffset,
  shouldRedirectRunsError,
  textDownloadFilename,
  type Doc,
  type Job,
} from "../../apps/web/canvas-editor/types.js";

function makeJob(overrides: Partial<Job>): Job {
  return {
    id: 1,
    owner: 1,
    kind: "image",
    status: "done",
    result: "media-1",
    note: "",
    prompt: "prompt",
    refs: [],
    width: 1024,
    height: 1024,
    created: 1700000000,
    seconds: 5,
    quality: 480,
    ratio: "16:9",
    image_quality: "medium",
    model: "gpt-image-2.6-sunburst",
    ...overrides,
  };
}

test("#103 createClipboardSnapshot ignores empty or unmatched selections without clearing prior clipboard", () => {
  const a = newNode("text", 100, 200, 1);
  const b = newNode("image", 460, 240, 1);
  const c = newNode("video", 820, 280, 1);
  const doc: Doc = {
    schemaVersion: 1,
    nodes: [a, b, c],
    edges: [
      { id: "e1", source: a.id, target: b.id },
      { id: "e2", source: b.id, target: c.id },
    ],
  };

  assert.equal(createClipboardSnapshot(doc, []), null);
  assert.equal(createClipboardSnapshot(doc, ["missing-id"]), null);

  const snapshot = createClipboardSnapshot(doc, [a.id, b.id, "missing-id"]);
  assert.ok(snapshot);
  assert.equal(snapshot.nodes.length, 2);
  assert.deepEqual(
    snapshot.nodes.map((n) => n.id),
    [a.id, b.id],
  );
  assert.deepEqual(
    snapshot.edges.map((e) => e.id),
    ["e1"],
  );
  assert.equal(snapshot.pasteCount, 0);
  // Cloned snapshot must not alias document nodes
  a.x = 999;
  assert.equal(snapshot.nodes[0].x, 100);
});

test("#104 resolvePasteOffset staggers repeated keyboard pastes, resets on recopy, and anchors context-menu pastes", () => {
  const a = newNode("text", 100, 200, 1);
  const b = newNode("sticky", 460, 260, 1);
  const doc: Doc = { schemaVersion: 1, nodes: [a, b], edges: [] };

  const clip = createClipboardSnapshot(doc, [a.id, b.id]);
  assert.ok(clip);

  // Consecutive Cmd+V pastes step by +56px each time
  const first = resolvePasteOffset(clip.nodes, {
    pasteCount: clip.pasteCount,
    anchor: clip.anchor,
  });
  assert.deepEqual(
    { dx: first.dx, dy: first.dy, nextPasteCount: first.nextPasteCount },
    { dx: PASTE_OFFSET, dy: PASTE_OFFSET, nextPasteCount: 1 },
  );
  clip.pasteCount = first.nextPasteCount;
  clip.anchor = first.nextAnchor;

  const second = resolvePasteOffset(clip.nodes, {
    pasteCount: clip.pasteCount,
    anchor: clip.anchor,
  });
  assert.deepEqual(
    { dx: second.dx, dy: second.dy, nextPasteCount: second.nextPasteCount },
    { dx: PASTE_OFFSET * 2, dy: PASTE_OFFSET * 2, nextPasteCount: 2 },
  );
  clip.pasteCount = second.nextPasteCount;
  clip.anchor = second.nextAnchor;

  const third = resolvePasteOffset(clip.nodes, {
    pasteCount: clip.pasteCount,
    anchor: clip.anchor,
  });
  assert.deepEqual(
    { dx: third.dx, dy: third.dy, nextPasteCount: third.nextPasteCount },
    { dx: PASTE_OFFSET * 3, dy: PASTE_OFFSET * 3, nextPasteCount: 3 },
  );

  // Right-click pane paste anchors group bounding-box origin at the flow point
  const anchored = resolvePasteOffset(clip.nodes, {
    point: { x: 800, y: 500 },
    pasteCount: third.nextPasteCount,
    anchor: third.nextAnchor,
  });
  assert.equal(a.x + anchored.dx, 800);
  assert.equal(a.y + anchored.dy, 500);
  assert.equal(b.x + anchored.dx, 1160);
  assert.equal(b.y + anchored.dy, 560);
  assert.equal(anchored.nextPasteCount, 0);
  assert.deepEqual(anchored.nextAnchor, { x: 800, y: 500 });

  // Follow-up keyboard paste steps cleanly from the anchored position
  const afterAnchor = resolvePasteOffset(clip.nodes, {
    pasteCount: anchored.nextPasteCount,
    anchor: anchored.nextAnchor,
  });
  assert.equal(a.x + afterAnchor.dx, 800 + PASTE_OFFSET);
  assert.equal(a.y + afterAnchor.dy, 500 + PASTE_OFFSET);
  assert.equal(b.x + afterAnchor.dx, 1160 + PASTE_OFFSET);
  assert.equal(b.y + afterAnchor.dy, 560 + PASTE_OFFSET);
  assert.equal(afterAnchor.nextPasteCount, 1);

  // Duplicate always uses single step offset without mutating clipboard step
  const dup = resolvePasteOffset(clip.nodes, {
    duplicate: true,
    pasteCount: 5,
    anchor: { x: 800, y: 500 },
  });
  assert.equal(dup.dx, PASTE_OFFSET);
  assert.equal(dup.dy, PASTE_OFFSET);
  assert.equal(dup.nextPasteCount, 5);

  // New copy resets pasteCount and anchor
  const recopied = createClipboardSnapshot(doc, [a.id]);
  assert.ok(recopied);
  assert.equal(recopied.pasteCount, 0);
  assert.equal(recopied.anchor, undefined);
  const afterRecopy = resolvePasteOffset(recopied.nodes, {
    pasteCount: recopied.pasteCount,
    anchor: recopied.anchor,
  });
  assert.equal(afterRecopy.dx, PASTE_OFFSET);
  assert.equal(afterRecopy.dy, PASTE_OFFSET);
  assert.equal(afterRecopy.nextPasteCount, 1);
});

test("#105 nextContextSelection preserves multi-selection when right-clicking a selected node and switches otherwise", () => {
  const multi = ["n1", "n2", "n3"];
  assert.deepEqual(nextContextSelection(multi, "n2"), ["n1", "n2", "n3"]);
  assert.deepEqual(nextContextSelection(multi, "n4"), ["n4"]);
  assert.deepEqual(nextContextSelection([], "n1"), ["n1"]);
});

test("#107 textDownloadFilename uses current live document title and falls back safely", () => {
  assert.equal(
    textDownloadFilename("重命名后的画布", "初始画布"),
    "重命名后的画布.txt",
  );
  assert.equal(textDownloadFilename("", "初始画布"), "初始画布.txt");
  assert.equal(textDownloadFilename("   ", "初始画布"), "初始画布.txt");
  assert.equal(textDownloadFilename(undefined, "初始画布"), "初始画布.txt");
  assert.equal(textDownloadFilename("", ""), "未命名画布.txt");
});

test("#109 downloadable detection matches single/multi/context rules across media and text states", () => {
  const emptyImg = newNode("image", 0, 0, 1);
  const emptyVid = newNode("video", 400, 0, 1);
  const readyImg = { ...newNode("image", 0, 300, 2), media_id: "asset-img-1" };
  const generatedVid = newNode("video", 400, 300, 2);
  const runningImg = newNode("image", 800, 0, 3);
  const textNode = newNode("text", 800, 300, 1);
  const stickyNode = newNode("sticky", 1200, 300, 1);

  const runs: Job[] = [
    makeJob({
      id: 10,
      canvas_node: generatedVid.id,
      kind: "video",
      status: "done",
      result: "vid-result-10",
    }),
    makeJob({
      id: 11,
      canvas_node: runningImg.id,
      kind: "image",
      status: "running",
      result: null,
    }),
  ];

  // Empty or still-running media nodes are not downloadable
  assert.equal(hasDownloadableNodes([], runs), false);
  assert.equal(hasDownloadableNodes([emptyImg], runs), false);
  assert.equal(hasDownloadableNodes([emptyVid], runs), false);
  assert.equal(hasDownloadableNodes([emptyImg, emptyVid, runningImg], runs), false);

  // Ready direct media, completed run media, text, and sticky nodes are downloadable
  assert.equal(hasDownloadableNodes([readyImg], runs), true);
  assert.equal(hasDownloadableNodes([generatedVid], runs), true);
  assert.equal(hasDownloadableNodes([textNode], runs), true);
  assert.equal(hasDownloadableNodes([stickyNode], runs), true);

  // Mixed selection containing empty nodes plus at least one downloadable node is downloadable
  const mixed = collectDownloadTargets(
    [emptyImg, readyImg, generatedVid, textNode, stickyNode],
    runs,
  );
  assert.equal(mixed.hasDownloadable, true);
  assert.deepEqual(mixed.media, ["asset-img-1", "vid-result-10"]);
  assert.deepEqual(
    mixed.text.map((n) => n.id),
    [textNode.id, stickyNode.id],
  );
});

test("#26 history modal distinguishes loading, error, empty and list states without faking empty on 503", () => {
  // Redirect classification: only 401/403/404 redirect, 503/500/network errors surface inline
  assert.equal(shouldRedirectRunsError({ status: 401 }), true);
  assert.equal(shouldRedirectRunsError({ status: 403 }), true);
  assert.equal(shouldRedirectRunsError({ status: 404 }), true);
  assert.equal(shouldRedirectRunsError({ status: 503 }), false);
  assert.equal(shouldRedirectRunsError({ status: 500 }), false);
  assert.equal(shouldRedirectRunsError(new Error("Failed to fetch")), false);
  assert.equal(shouldRedirectRunsError(null), false);

  assert.equal(
    formatRunsError(new Error("  画布运行记录服务暂不可用  ")),
    "画布运行记录服务暂不可用",
  );
  assert.equal(formatRunsError(new Error("")), "加载生成历史失败，请重试");
  assert.equal(formatRunsError("unexpected"), "加载生成历史失败，请重试");

  // Initial loading state must never render empty copy
  assert.deepEqual(
    resolveHistoryModalState({
      runs: [],
      loading: true,
      loaded: false,
      error: "",
    }),
    { kind: "loading", items: [], error: "" },
  );
  assert.deepEqual(
    resolveHistoryModalState({
      runs: [],
      loading: false,
      loaded: false,
      error: "",
    }),
    { kind: "loading", items: [], error: "" },
  );

  // 503 / failure before or after load shows explicit error state, never empty state
  assert.deepEqual(
    resolveHistoryModalState({
      runs: [],
      loading: false,
      loaded: false,
      error: "后端暂时不可用",
    }),
    { kind: "error", items: [], error: "后端暂时不可用" },
  );
  assert.deepEqual(
    resolveHistoryModalState({
      runs: [],
      loading: false,
      loaded: true,
      error: "服务暂时不可用",
    }),
    { kind: "error", items: [], error: "服务暂时不可用" },
  );

  // Only a clean successful load with no non-audio runs shows empty state
  assert.deepEqual(
    resolveHistoryModalState({
      runs: [],
      loading: false,
      loaded: true,
      error: "",
    }),
    { kind: "empty", items: [], error: "" },
  );
  const audioRun = makeJob({ id: 21, kind: "audio", result: "voice-1" });
  assert.deepEqual(
    resolveHistoryModalState({
      runs: [audioRun],
      loading: false,
      loaded: true,
      error: "",
    }),
    { kind: "empty", items: [], error: "" },
  );

  // Successful runs render as list (filtering out audio) and keep surfacing poll errors if they occur later
  const imgRun = makeJob({ id: 22, kind: "image", result: "img-22" });
  assert.deepEqual(
    resolveHistoryModalState({
      runs: [audioRun, imgRun],
      loading: false,
      loaded: true,
      error: "",
    }),
    { kind: "list", items: [imgRun], error: "" },
  );
  assert.deepEqual(
    resolveHistoryModalState({
      runs: [imgRun],
      loading: false,
      loaded: true,
      error: "后端暂时不可用",
    }),
    { kind: "list", items: [imgRun], error: "后端暂时不可用" },
  );
});

test("#106 viewport focus shortcuts prefer physical Digit1/Digit2 codes and ignore empty selections", () => {
  const n1 = newNode("image", 100, 100, 1);
  const n2 = newNode("video", 500, 100, 1);

  assert.deepEqual(resolveFocusTargets([n1, n2], []), []);
  assert.deepEqual(resolveFocusTargets([n1, n2], ["deleted-node"]), []);
  assert.deepEqual(resolveFocusTargets([n1, n2], [n2.id, n2.id, "missing", n1.id]), [
    n2.id,
    n1.id,
  ]);

  // US keyboard layout
  assert.equal(
    matchViewportFocusShortcut({
      shiftKey: true,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      code: "Digit1",
      key: "!",
    }),
    "fit-all",
  );
  assert.equal(
    matchViewportFocusShortcut({
      shiftKey: true,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      code: "Digit2",
      key: "@",
    }),
    "fit-selected",
  );

  // Chinese IME / non-US layouts where e.key is full-width, Process, or '"'
  assert.equal(
    matchViewportFocusShortcut({
      shiftKey: true,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      code: "Digit1",
      key: "！",
    }),
    "fit-all",
  );
  assert.equal(
    matchViewportFocusShortcut({
      shiftKey: true,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      code: "Digit2",
      key: '"',
    }),
    "fit-selected",
  );
  assert.equal(
    matchViewportFocusShortcut({
      shiftKey: true,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      code: "Digit2",
      key: "Process",
    }),
    "fit-selected",
  );

  // Fallback compatibility when synthetic events only provide e.key
  assert.equal(
    matchViewportFocusShortcut({
      shiftKey: true,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      key: "!",
    }),
    "fit-all",
  );
  assert.equal(
    matchViewportFocusShortcut({
      shiftKey: true,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      key: "@",
    }),
    "fit-selected",
  );

  // Reject modifier combinations and non-Shift presses
  for (const extra of [
    { metaKey: true, ctrlKey: false, altKey: false },
    { metaKey: false, ctrlKey: true, altKey: false },
    { metaKey: false, ctrlKey: false, altKey: true },
  ]) {
    assert.equal(
      matchViewportFocusShortcut({
        shiftKey: true,
        ...extra,
        code: "Digit1",
        key: "!",
      }),
      null,
    );
    assert.equal(
      matchViewportFocusShortcut({
        shiftKey: true,
        ...extra,
        code: "Digit2",
        key: "@",
      }),
      null,
    );
  }
  assert.equal(
    matchViewportFocusShortcut({
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      code: "Digit2",
      key: "2",
    }),
    null,
  );
});

test("#108 narration text/instruction inputs coalesce keystrokes via edit-session hooks while discrete actions keep undo entries", async () => {
  const root = process.cwd();
  const narrationSource = await readFile(
    join(root, "apps/web/canvas-editor/Narration.tsx"),
    "utf8",
  );
  const workspaceSource = await readFile(
    join(root, "apps/web/canvas-editor/CanvasWorkspace.tsx"),
    "utf8",
  );

  // Verify Narration wires focus/change(history=false)/blur/unmount and commits session before discrete actions
  assert.match(narrationSource, /onFocus=\{\(\) => onEditStart\?\.\(\)\}/);
  assert.match(
    narrationSource,
    /onChange=\{\(e\) => onChange\(\{ narration_text: e\.target\.value \}, false\)\}/,
  );
  assert.match(
    narrationSource,
    /onChange=\{\(e\) =>\s*onChange\(\{ narration_instruction: e\.target\.value \}, false\)\s*\}/,
  );
  assert.match(narrationSource, /onBlur=\{\(\) => onEditEnd\?\.\(\)\}/);
  assert.match(narrationSource, /onEditEndRef\.current\?\.\(\)/);
  assert.match(workspaceSource, /onEditStart=\{doc\.begin\}/);
  assert.match(workspaceSource, /onEditEnd=\{doc\.end\}/);
  assert.match(
    workspaceSource,
    /onChange=\{\(\s*patch\s*,\s*history\s*\)\s*=>\s*edit\(\s*shot\.id\s*,\s*patch\s*,\s*history\s*\)\}/,
  );
});

test("#110 #111 mobile composer/toolbar flags and canvas-overrides.css rules are wired without modifying pinned canvas.css", async () => {
  const textNode = newNode("text", 0, 0, 1);
  const imageNode = newNode("image", 0, 0, 1);
  const videoNode = newNode("video", 0, 0, 1);
  const stickyNode = newNode("sticky", 0, 0, 1);

  assert.equal(isCanvasComposerOpen(null, null), false);
  assert.equal(isCanvasComposerOpen(stickyNode, null), false);
  assert.equal(isCanvasComposerOpen(imageNode, null), true);
  assert.equal(isCanvasComposerOpen(videoNode, null), true);
  assert.equal(isCanvasComposerOpen(textNode, null), true);
  assert.equal(isCanvasComposerOpen(textNode, textNode.id), false);

  assert.equal(hasCanvasSelectionToolbar(null, null), false);
  assert.equal(hasCanvasSelectionToolbar(stickyNode, null), true);
  assert.equal(hasCanvasSelectionToolbar(imageNode, null), true);
  assert.equal(hasCanvasSelectionToolbar(textNode, textNode.id), false);

  const root = process.cwd();
  const overridesCss = await readFile(
    join(root, "apps/web/canvas-editor/canvas-overrides.css"),
    "utf8",
  );
  const editorSource = await readFile(
    join(root, "apps/web/canvas-editor/CanvasEditor.tsx"),
    "utf8",
  );

  assert.match(editorSource, /import "\.\/canvas-overrides\.css";/);
  assert.match(overridesCss, /@media \(max-width: 760px\)/);
  assert.match(
    overridesCss,
    /\.canvas-workspace\[data-composer-open="true"\] \.insert-toolbar/,
  );
  assert.match(overridesCss, /\.react-flow__panel\.react-flow__minimap/);
  assert.match(
    overridesCss,
    /\.canvas-workspace \.selection-toolbar \.color-menu\s*\{[\s\S]*left:\s*auto;[\s\S]*right:\s*0;[\s\S]*max-width:\s*calc\(100vw - 24px\);/,
  );
});

test("#44 resolveBatchShots filters video nodes, preserves order, deduplicates existing shots, and switches multi-toolbar state", async () => {
  const existingVideo = newNode("video", 0, 0, 1);
  const videoA = newNode("video", 400, 0, 2);
  const sticky = newNode("sticky", 800, 0, 1);
  const image = newNode("image", 1200, 0, 1);
  const text = newNode("text", 1600, 0, 1);
  const plugin = newNode("plugin", 2000, 0, 1);
  const videoB = newNode("video", 2400, 0, 3);
  const unselectedVideo = newNode("video", 2800, 0, 4);
  const nodes = [
    existingVideo,
    videoA,
    sticky,
    image,
    text,
    plugin,
    videoB,
    unselectedVideo,
  ];

  // Non-video multi-selection exposes no video shot targets
  assert.deepEqual(
    resolveBatchShots(
      nodes,
      [sticky.id, image.id, text.id, plugin.id],
      [existingVideo.id],
    ),
    {
      videoIds: [],
      addedIds: [],
      nextShots: [existingVideo.id],
      allInShots: false,
    },
  );

  // Mixed selection keeps only selected video nodes in stable document order and skips existing shots
  const mixed = resolveBatchShots(
    nodes,
    [
      videoB.id,
      sticky.id,
      existingVideo.id,
      image.id,
      videoA.id,
      videoA.id,
      "missing-node",
    ],
    [existingVideo.id],
  );
  assert.deepEqual(mixed, {
    videoIds: [existingVideo.id, videoA.id, videoB.id],
    addedIds: [videoA.id, videoB.id],
    nextShots: [existingVideo.id, videoA.id, videoB.id],
    allInShots: false,
  });

  // Once all selected videos are in shots, allInShots flips true so toolbar shows "查看镜头列表"
  const afterAdd = resolveBatchShots(
    nodes,
    [videoB.id, sticky.id, existingVideo.id, videoA.id],
    mixed.nextShots,
  );
  assert.deepEqual(afterAdd, {
    videoIds: [existingVideo.id, videoA.id, videoB.id],
    addedIds: [],
    nextShots: [existingVideo.id, videoA.id, videoB.id],
    allInShots: true,
  });

  // Single video + sticky multi-selection also works both before and after adding
  const oneVideoAndSticky = resolveBatchShots(nodes, [videoA.id, sticky.id], []);
  assert.deepEqual(oneVideoAndSticky, {
    videoIds: [videoA.id],
    addedIds: [videoA.id],
    nextShots: [videoA.id],
    allInShots: false,
  });
  assert.equal(
    resolveBatchShots(nodes, [videoA.id, sticky.id], [videoA.id]).allInShots,
    true,
  );

  // Verify CanvasWorkspace multi-toolbar wires ListVideo, atomic updateShots, and notify feedback
  const root = process.cwd();
  const workspaceSource = await readFile(
    join(root, "apps/web/canvas-editor/CanvasWorkspace.tsx"),
    "utf8",
  );
  assert.match(
    workspaceSource,
    /className="multi-toolbar"[\s\S]*?batchShots\.videoIds\.length > 0[\s\S]*?icon=\{ListVideo\}[\s\S]*?batchShots\.allInShots \? "查看镜头列表" : "加入镜头列表"/,
  );
  assert.match(
    workspaceSource,
    /notify\(`已将 \$\{addedIds\.length\} 个视频加入镜头列表`\)/,
  );
});

test("CanvasWorkspace merges multi-select toolbars, deduplicates shot-list views, auto-hides empty proposal dock, and removes hardcoded MiniMax H3", async () => {
  const root = process.cwd();
  const workspaceSource = await readFile(
    join(root, "apps/web/canvas-editor/CanvasWorkspace.tsx"),
    "utf8",
  );

  // 1. Single multi-select toolbar: .fm-multi-bar removed, actions merged into .multi-toolbar
  assert.doesNotMatch(workspaceSource, /fm-multi-bar/);
  assert.match(
    workspaceSource,
    /className="multi-toolbar"[\s\S]*?batchShots\.videoIds\.length > 0[\s\S]*?icon=\{ListVideo\}[\s\S]*?batchShots\.allInShots \? "查看镜头列表" : "加入镜头列表"[\s\S]*?建工作流组[\s\S]*?预检并批量生成/,
  );

  // 2. Deduplicated shot-list view & top-bar actions
  assert.doesNotMatch(workspaceSource, /setShotList/);
  assert.doesNotMatch(workspaceSource, /<Modal\s+title="镜头列表"/);
  assert.equal(
    workspaceSource.match(/<ShotList\b/g)?.length ?? 0,
    1,
    "ShotList must be mounted in only one place",
  );
  assert.equal(
    workspaceSource.match(/<Composition\b/g)?.length ?? 0,
    1,
    "Composition must be mounted in only one place",
  );
  assert.match(
    workspaceSource,
    /className="fm-view-switch"[\s\S]*?画布[\s\S]*?分屏[\s\S]*?镜头列表/,
  );
  assert.doesNotMatch(
    workspaceSource,
    /className="global-tools"[\s\S]*?icon=\{ListVideo\}[\s\S]*?<\/header>/,
  );
  assert.doesNotMatch(
    workspaceSource,
    /className="global-tools"[\s\S]*?icon=\{FolderOpen\}[\s\S]*?label="所有画布"[\s\S]*?<\/header>/,
  );
  assert.match(
    workspaceSource,
    /className="project-heading"[\s\S]*?label="所有画布"/,
  );
  assert.match(
    workspaceSource,
    /className="cv-menu project-menu"[\s\S]*?所有画布/,
  );
  assert.match(
    workspaceSource,
    /setViewMode\(\(m\)\s*=>\s*\(m\s*===\s*"canvas"\s*\?\s*"split"\s*:\s*m\)\)/,
  );

  // 3. Quietly fetch pending proposals, hide empty Agent dock trigger, and drop legacy skills modal
  assert.doesNotMatch(workspaceSource, /SkillEditorModal|skillsModal|onOpenSkills/);
  assert.match(
    workspaceSource,
    /\/api\/canvases\/\$\{project\.id\}\/proposals\?workspace=\$\{project\.workspace\}/,
  );
  assert.match(workspaceSource, /\(pendingProposals\s*>\s*0\s*\|\|\s*agentDock\)/);
  assert.match(workspaceSource, /fm-with-agent-dock/);

  // 4. No hardcoded "MiniMax H3" in CanvasWorkspace.tsx
  assert.doesNotMatch(workspaceSource, /["']MiniMax H3["']/);
});

test("resolveCinePopoverSide bounds floating CinematographyPanel within unobstructed canvas viewport across right, left, and top placements", () => {
  // Roomy center in Canvas View -> fits cleanly on the right (460 + 520 + 352 = 1332 <= 1428)
  assert.equal(
    resolveCinePopoverSide({
      composerLeft: 460,
      composerWidth: 520,
      windowWidth: 1440,
      viewMode: "canvas",
      agentDock: false,
    }),
    "right",
  );

  // Right-edge node in Canvas View -> right would clip (896 + 520 + 352 = 1768 > 1428), left fits (896 - 352 = 544 >= 76)
  assert.equal(
    resolveCinePopoverSide({
      composerLeft: 896,
      composerWidth: 520,
      windowWidth: 1440,
      viewMode: "canvas",
      agentDock: false,
    }),
    "left",
  );

  // Left-edge node in Split View -> right clips into docked storyboard (76 + 520 + 352 = 948 > 908)
  // AND left would clip offscreen at x = -276px (76 - 352 = -276 < 76) -> falls back to "top"
  assert.equal(
    resolveCinePopoverSide({
      composerLeft: 76,
      composerWidth: 520,
      windowWidth: 1440,
      viewMode: "split",
      agentDock: false,
    }),
    "top",
  );

  // Split View with composer shifted right enough for left placement (440 - 352 = 88 >= 76)
  assert.equal(
    resolveCinePopoverSide({
      composerLeft: 440,
      composerWidth: 520,
      windowWidth: 1440,
      viewMode: "split",
      agentDock: false,
    }),
    "left",
  );

  // Wide 1920px Split View with left-side node -> right fits cleanly before docked storyboard (100 + 520 + 352 = 972 <= 1388)
  assert.equal(
    resolveCinePopoverSide({
      composerLeft: 100,
      composerWidth: 520,
      windowWidth: 1920,
      viewMode: "split",
      agentDock: false,
    }),
    "right",
  );

  // Agent dock open in Canvas View reduces rightLimit (1440 - 400 - 12 = 1028), flipping center composer to "left"
  assert.equal(
    resolveCinePopoverSide({
      composerLeft: 460,
      composerWidth: 520,
      windowWidth: 1440,
      viewMode: "canvas",
      agentDock: true,
    }),
    "left",
  );

  // Exact boundary checks for rightLimit and leftLimit = 76
  assert.equal(
    resolveCinePopoverSide({
      composerLeft: 556,
      composerWidth: 520,
      windowWidth: 1440,
      dockedWidth: 0,
    }),
    "right", // 556 + 520 + 352 === 1428 === 1440 - 12
  );
  assert.equal(
    resolveCinePopoverSide({
      composerLeft: 428,
      composerWidth: 520,
      windowWidth: 1024,
      dockedWidth: 0,
    }),
    "left", // right fails (1300 > 1012), left hits exact 428 - 352 === 76
  );
  assert.equal(
    resolveCinePopoverSide({
      composerLeft: 427,
      composerWidth: 520,
      windowWidth: 1024,
      dockedWidth: 0,
    }),
    "top", // 427 - 352 = 75 < 76 -> "top"
  );
});

test("CanvasWorkspace centralizes <= 1100px agentDock mutual exclusion inside setViewMode for every split transition", async () => {
  const root = process.cwd();
  const workspaceSource = await readFile(
    join(root, "apps/web/canvas-editor/CanvasWorkspace.tsx"),
    "utf8",
  );

  const setViewModeMatch = workspaceSource.match(
    /const setViewMode = useCallback\([\s\S]*?\n  \);/,
  );
  assert.ok(setViewModeMatch, "CanvasWorkspace.tsx must define setViewMode via useCallback");
  const setViewModeBody = setViewModeMatch[0];

  assert.match(
    setViewModeBody,
    /resolved\s*===\s*"split"\s*&&\s*typeof window\s*!==\s*"undefined"\s*&&\s*window\.innerWidth\s*<=\s*1100[\s\S]*?setAgentDock\(false\)/,
    "setViewMode must dismiss agentDock whenever resolved === 'split' on <= 1100px viewports",
  );

  // Every view mode change must route through setViewMode rather than bypassing setViewModeState directly
  assert.equal(
    workspaceSource.match(/\bsetViewModeState\(/g)?.length ?? 0,
    1,
    "setViewModeState must only be called inside setViewMode",
  );
});
