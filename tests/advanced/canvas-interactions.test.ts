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
    /className="cv-menu project-menu\b[^"]*"[\s\S]*?所有画布/,
  );
  assert.match(
    workspaceSource,
    /setViewMode\(\(m\)\s*=>\s*\(m\s*===\s*"canvas"\s*\?\s*"split"\s*:\s*m\)\)/,
  );

  // 3. Fetch pending proposals badge, integrate FloatingCanvasAgent without legacy skills modal
  assert.doesNotMatch(workspaceSource, /SkillEditorModal|skillsModal|onOpenSkills/);
  assert.match(
    workspaceSource,
    /\/api\/canvases\/\$\{project\.id\}\/proposals\?workspace=\$\{project\.workspace\}/,
  );
  assert.match(workspaceSource, /pendingProposals\s*>\s*0/);
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
    /resolved\s*!==\s*"canvas"\s*&&\s*typeof window\s*!==\s*"undefined"\s*&&\s*window\.innerWidth\s*<=\s*1100[\s\S]*?setAgentDock\(false\)/,
    "setViewMode must dismiss agentDock whenever resolved !== 'canvas' (split or list) on <= 1100px viewports",
  );

  // Every view mode change must route through setViewMode rather than bypassing setViewModeState directly
  assert.equal(
    workspaceSource.match(/\bsetViewModeState\(/g)?.length ?? 0,
    1,
    "setViewModeState must only be called inside setViewMode",
  );
});

test("PR #223 Item 4: resolveNextShotVideoModel avoids text-only video models like flow:veo-3.1-lite-4s-landscape and hides first-frame action when no model accepts a single image", async () => {
  const typesMod = (await import("../../apps/web/canvas-editor/types.js")) as Record<
    string,
    any
  >;
  assert.equal(typeof typesMod.resolveNextShotVideoModel, "function");
  assert.equal(typeof typesMod.videoModelAcceptsSingleFirstFrame, "function");

  const flowCatalog = {
    "flow:veo-3.1-lite-4s-landscape": {
      kind: "video",
      label: "Veo 3.1 - Lite · 4s · 16:9",
      provider: "flow",
      mode: "t2v",
      ratio: "16:9",
      seconds: 4,
      resolution: "原生",
      min_refs: 0,
      max_refs: 0,
    },
    "flow:veo-3.1-lite-i2v-4s-landscape": {
      kind: "video",
      label: "Veo 3.1 - Lite I2V · 4s · 16:9",
      provider: "flow",
      mode: "i2v",
      ratio: "16:9",
      seconds: 4,
      resolution: "原生",
      min_refs: 1,
      max_refs: 2,
    },
    "flow:veo-3.1-lite-extend-8s-landscape": {
      kind: "video",
      label: "Veo 3.1 - Lite Extend · 8s · 16:9",
      provider: "flow",
      mode: "extend",
      ratio: "16:9",
      seconds: 8,
      resolution: "原生",
      min_refs: 0,
      max_refs: 0,
    },
    "muse-video-v1": {
      kind: "video",
      label: "Muse Video V1",
      provider: "muse",
    },
  };
  const studioMock = {
    video_models: {
      "flow:veo-3.1-lite-4s-landscape": "Veo 3.1 - Lite · 4s · 16:9",
      "flow:veo-3.1-lite-i2v-4s-landscape": "Veo 3.1 - Lite I2V · 4s · 16:9",
      "flow:veo-3.1-lite-extend-8s-landscape":
        "Veo 3.1 - Lite Extend · 8s · 16:9",
      "muse-video-v1": "Muse Video V1",
    },
    model_catalog: flowCatalog,
    model_forms: {
      "flow:veo-3.1-lite-4s-landscape": {
        fields: {},
        tiers: [],
        references: { min: 0, max: 0 },
        canvas: true,
      },
      "flow:veo-3.1-lite-i2v-4s-landscape": {
        fields: {},
        tiers: [],
        references: { min: 1, max: 2 },
        canvas: true,
      },
      "flow:veo-3.1-lite-extend-8s-landscape": {
        fields: {},
        tiers: [],
        references: { min: 0, max: 0 },
        canvas: true,
      },
      "muse-video-v1": {
        fields: {},
        tiers: [],
        references: { min: 0, max: 4 },
        canvas: true,
      },
    },
  };

  // Text-only t2v and extend models do NOT accept a single extracted first-frame image
  assert.equal(
    typesMod.videoModelAcceptsSingleFirstFrame(
      studioMock,
      "flow:veo-3.1-lite-4s-landscape",
      () => true,
    ),
    false,
  );
  assert.equal(
    typesMod.videoModelAcceptsSingleFirstFrame(
      studioMock,
      "flow:veo-3.1-lite-extend-8s-landscape",
      () => true,
    ),
    false,
  );
  assert.equal(
    typesMod.videoModelAcceptsSingleFirstFrame(
      studioMock,
      "flow:veo-3.1-lite-i2v-4s-landscape",
      () => true,
    ),
    true,
  );

  // Source node using flow:veo-3.1-lite-4s-landscape switches cleanly to matching i2v sibling
  assert.equal(
    typesMod.resolveNextShotVideoModel(
      studioMock,
      "flow:veo-3.1-lite-4s-landscape",
      { ratio: "16:9", seconds: 4 },
      () => true,
    ),
    "flow:veo-3.1-lite-i2v-4s-landscape",
  );

  // If i2v sibling is disabled, falls back to another enabled first-frame-capable video model
  assert.equal(
    typesMod.resolveNextShotVideoModel(
      studioMock,
      "flow:veo-3.1-lite-4s-landscape",
      { ratio: "16:9", seconds: 4 },
      (m: string) => m !== "flow:veo-3.1-lite-i2v-4s-landscape",
    ),
    "muse-video-v1",
  );

  // If ONLY text-only / extend models are available, returns "" so UI hides "用作下一镜头首帧"
  assert.equal(
    typesMod.resolveNextShotVideoModel(
      studioMock,
      "flow:veo-3.1-lite-4s-landscape",
      { ratio: "16:9", seconds: 4 },
      (m: string) =>
        m === "flow:veo-3.1-lite-4s-landscape" ||
        m === "flow:veo-3.1-lite-extend-8s-landscape",
    ),
    "",
  );

  // Round 2 Item 4: Unified resolveNextShotContinuation governs BOTH ShotList and Preview Modal availability & target-model copy
  assert.equal(typeof typesMod.resolveNextShotContinuation, "function");
  const labelOf = (id: string) =>
    (studioMock.model_catalog as Record<string, any>)[id]?.label || id;

  // 1) No candidate accepts a single image -> returns null (both ShotList and Preview hide/disable continuation)
  assert.equal(
    typesMod.resolveNextShotContinuation(
      studioMock,
      "flow:veo-3.1-lite-4s-landscape",
      { ratio: "16:9", seconds: 4 },
      (m: string) => m === "flow:veo-3.1-lite-4s-landscape",
      labelOf,
    ),
    null,
  );

  // 2) Candidate differs from source text-only model -> switched=true and both ShotList title & Preview copy surface actual target model label!
  const switchedCont = typesMod.resolveNextShotContinuation(
    studioMock,
    "flow:veo-3.1-lite-4s-landscape",
    { ratio: "16:9", seconds: 4 },
    () => true,
    labelOf,
  );
  assert.ok(switchedCont);
  assert.equal(switchedCont.model, "flow:veo-3.1-lite-i2v-4s-landscape");
  assert.equal(switchedCont.switched, true);
  assert.match(switchedCont.shotTitle, /Veo 3\.1 - Lite I2V/);
  assert.match(switchedCont.previewHint, /Veo 3\.1 - Lite I2V/);

  // 3) Same model accepts a single image -> switched=false, still surfaces model label consistently
  const sameCont = typesMod.resolveNextShotContinuation(
    studioMock,
    "muse-video-v1",
    { ratio: "16:9", seconds: 5 },
    () => true,
    labelOf,
  );
  assert.ok(sameCont);
  assert.equal(sameCont.model, "muse-video-v1");
  assert.equal(sameCont.switched, false);
  assert.match(sameCont.shotTitle, /Muse Video/);

  const shotListSrc = await readFile(
    join(process.cwd(), "apps/web/canvas-editor/ShotList.tsx"),
    "utf8",
  );
  assert.match(shotListSrc, /tailContinuation/);
});

test("PR #223 Item 5: resolveCinePopoverPlacement considers both horizontal and vertical clearance across Split View top-composer, short viewports, and 760-960px widths", async () => {
  const typesMod = (await import("../../apps/web/canvas-editor/types.js")) as Record<
    string,
    any
  >;
  assert.equal(typeof typesMod.resolveCinePopoverPlacement, "function");

  // 1. Split View where composer sits near the top (composerTop = 96, height = 240, window 1280x820):
  // Neither right nor left fits, AND above only has 14px -> MUST place below ("bottom") instead of clipping off the top!
  const splitTop = typesMod.resolveCinePopoverPlacement({
    composerLeft: 96,
    composerTop: 96,
    composerWidth: 520,
    composerHeight: 240,
    windowWidth: 1280,
    windowHeight: 820,
    viewMode: "split",
    agentDock: false,
  });
  assert.equal(splitTop.side, "bottom");
  assert.ok(splitTop.maxHeight >= 220 && splitTop.maxHeight <= 360);

  // 2. Short viewport (e.g. 1024x480 in Split View) where neither right, left, top, nor bottom has >= 200px around a middle composer:
  // Uses viewport-clamped placement so header + close button stay 100% inside [safeTop, safeBottom]
  const shortViewport = typesMod.resolveCinePopoverPlacement({
    composerLeft: 88,
    composerTop: 140,
    composerWidth: 520,
    composerHeight: 220,
    windowWidth: 1024,
    windowHeight: 480,
    headerBottom: 60,
    viewMode: "split",
    agentDock: false,
  });
  assert.equal(shortViewport.side, "viewport");
  assert.ok(shortViewport.fixedTop >= 68);
  assert.ok(shortViewport.fixedTop + shortViewport.maxHeight <= 480 - 12);

  // 3. 760-960px tablet width (e.g. 840x800): CSS must align mobile drawer breakpoint to 760px, not 960px
  const tablet = typesMod.resolveCinePopoverPlacement({
    composerLeft: 120,
    composerTop: 420,
    composerWidth: 500,
    composerHeight: 240,
    windowWidth: 840,
    windowHeight: 800,
    viewMode: "canvas",
    agentDock: false,
  });
  assert.equal(tablet.side, "top");
  assert.ok(tablet.maxHeight >= 220);

  const overridesCss = await readFile(
    join(process.cwd(), "apps/web/canvas-editor/canvas-overrides.css"),
    "utf8",
  );
  assert.doesNotMatch(
    overridesCss,
    /@media\s*\(max-width:\s*960px\)\s*\{\s*\.fm-cine-popover/,
  );
  assert.match(
    overridesCss,
    /@media\s*\(max-width:\s*760px\)\s*\{[\s\S]*?\.fm-cine-popover/,
  );

  // Round 2 Item 5: resolveOptionMenuFloatingRect bounds OptionSelect listbox inside viewport without clipping on .fm-cine-popover overflow
  assert.equal(typeof typesMod.resolveOptionMenuFloatingRect, "function");
  // Upward menu ("光影" / "镜头" / "氛围") in floating CinematographyPanel on 1440x900 desktop stays fully within [safeTop, trigger.top - 5]
  const upwardDesktop = typesMod.resolveOptionMenuFloatingRect({
    triggerRect: { top: 680, bottom: 714, left: 260, width: 150 },
    windowWidth: 1440,
    windowHeight: 900,
    preferredDirection: "up",
    menuWidth: 180,
  });
  assert.equal(upwardDesktop.direction, "up");
  assert.equal(upwardDesktop.maxHeight, 320);
  assert.ok(
    typeof upwardDesktop.bottom === "number" &&
      900 - upwardDesktop.bottom - upwardDesktop.maxHeight >= 8,
    "upward menu top edge must remain inside viewport",
  );
  assert.equal(upwardDesktop.left, 260);

  // When trigger is near viewport top (e.g. top-docked popover at y=110) and preferredDirection="up" lacks room, auto-flips to "down"!
  const flippedDown = typesMod.resolveOptionMenuFloatingRect({
    triggerRect: { top: 110, bottom: 144, left: 100, width: 150 },
    windowWidth: 1280,
    windowHeight: 800,
    preferredDirection: "up",
  });
  assert.equal(flippedDown.direction, "down");
  assert.ok(typeof flippedDown.top === "number" && flippedDown.top >= 149);
  assert.equal(flippedDown.maxHeight, 320);

  const atRightEdge = typesMod.resolveOptionMenuFloatingRect({
    triggerRect: { top: 110, bottom: 144, left: 1130, width: 120 },
    windowWidth: 1280,
    windowHeight: 800,
    menuWidth: 180,
  });
  assert.equal(atRightEdge.left, 1092);
});

test("PR #223 Item 7: reconcileCanvasRightDocks collapses docked panel when resizing across 1100px breakpoint", async () => {
  const typesMod = (await import("../../apps/web/canvas-editor/types.js")) as Record<
    string,
    any
  >;
  assert.equal(typeof typesMod.reconcileCanvasRightDocks, "function");

  // Wide (>1100px): both split storyboard and docked agent coexist side-by-side
  assert.deepEqual(
    typesMod.reconcileCanvasRightDocks({
      prevWindowWidth: 1440,
      windowWidth: 1360,
      viewMode: "split",
      agentDock: true,
      prevAgentDockedWidth: 400,
      agentDockedWidth: 400,
    }),
    { closeAgentDock: false, switchSplitToCanvas: false },
  );

  // Shrinking window from 1360px -> 1040px (<= 1100px) while both are open collapses agentDock
  assert.deepEqual(
    typesMod.reconcileCanvasRightDocks({
      prevWindowWidth: 1360,
      windowWidth: 1040,
      viewMode: "split",
      agentDock: true,
      prevAgentDockedWidth: 400,
      agentDockedWidth: 400,
    }),
    { closeAgentDock: true, switchSplitToCanvas: false },
  );

  // Re-docking floating PiP agent (0 -> 400) while already <= 1100px in split view switches split -> canvas
  assert.deepEqual(
    typesMod.reconcileCanvasRightDocks({
      prevWindowWidth: 980,
      windowWidth: 980,
      viewMode: "split",
      agentDock: true,
      prevAgentDockedWidth: 0,
      agentDockedWidth: 400,
    }),
    { closeAgentDock: false, switchSplitToCanvas: true },
  );

  // Round 2 Item 7: <= 1100px mutual exclusion ALSO covers viewMode === "list" (镜头列表) across resize and re-docking, while > 1100px keeps side-by-side!
  assert.deepEqual(
    typesMod.reconcileCanvasRightDocks({
      prevWindowWidth: 1400,
      windowWidth: 1320,
      viewMode: "list",
      agentDock: true,
      prevAgentDockedWidth: 400,
      agentDockedWidth: 400,
    }),
    { closeAgentDock: false, switchSplitToCanvas: false },
  );
  assert.deepEqual(
    typesMod.reconcileCanvasRightDocks({
      prevWindowWidth: 1320,
      windowWidth: 1020,
      viewMode: "list",
      agentDock: true,
      prevAgentDockedWidth: 400,
      agentDockedWidth: 400,
    }),
    { closeAgentDock: true, switchSplitToCanvas: false },
  );
  assert.deepEqual(
    typesMod.reconcileCanvasRightDocks({
      prevWindowWidth: 980,
      windowWidth: 980,
      viewMode: "list",
      agentDock: true,
      prevAgentDockedWidth: 0,
      agentDockedWidth: 400,
    }),
    { closeAgentDock: false, switchSplitToCanvas: true },
  );
  const workspaceSrc = await readFile(
    join(process.cwd(), "apps/web/canvas-editor/CanvasWorkspace.tsx"),
    "utf8",
  );
  assert.doesNotMatch(
    workspaceSrc,
    /window\.innerWidth\s*<=\s*1100\s*&&\s*viewMode\s*===\s*["']split["']/,
  );
});

test("PR #223 Item 8: resolveEffectiveNarrationModel hides 音色描述 when node's saved commercial TTS model is disabled and falls back to edge-tts", async () => {
  const typesMod = (await import("../../apps/web/canvas-editor/types.js")) as Record<
    string,
    any
  >;
  assert.equal(typeof typesMod.resolveEffectiveNarrationModel, "function");

  const narrationSource = await readFile(
    join(process.cwd(), "apps/web/canvas-editor/Narration.tsx"),
    "utf8",
  );
  assert.match(narrationSource, /resolveEffectiveNarrationModel\(/);

  // Node saved historic "tts-1", which is now disabled (only "edge-tts" is in audioModels and activeModel="edge-tts")
  assert.equal(
    typesMod.resolveEffectiveNarrationModel({
      requestedModel: "tts-1",
      activeModel: "edge-tts",
      audioModels: [{ id: "edge-tts", label: "Edge 免费神经语音" }],
    }),
    "edge-tts",
  );

  // When "tts-1" IS enabled in audioModels, keep "tts-1"
  assert.equal(
    typesMod.resolveEffectiveNarrationModel({
      requestedModel: "tts-1",
      activeModel: "tts-1",
      audioModels: [
        { id: "tts-1", label: "OpenAI TTS-1" },
        { id: "edge-tts", label: "Edge 免费神经语音" },
      ],
    }),
    "tts-1",
  );
});

test("PR #223 Round 3 Item 2: resolveCanvasSpeechModels and quoteCanvasSpeechPlan honor authoritative server list, portable speech models, defaultModelIds, BGM exclusion, and distinct explicit models across narration, single-line dialogue, and batch dialogue", async () => {
  const typesMod = (await import("../../apps/web/canvas-editor/types.js")) as Record<
    string,
    any
  >;
  assert.equal(typeof typesMod.resolveCanvasSpeechModels, "function");
  assert.equal(typeof typesMod.quoteCanvasSpeechPlan, "function");

  const studioFixture = {
    canvas_speech_models: [
      "custom-default-tts",
      "tts-1",
      "gpt-4o-mini-tts",
      "portable-v3-tts",
      "edge-tts",
    ],
    canvas_speech_default_models: ["custom-default-tts"],
    model_forms: {
      "tts-1": { canvas: true },
      "gpt-4o-mini-tts": { canvas: true },
      "portable-v3-tts": { canvas: false },
      "custom-default-tts": { canvas: true },
      "edge-tts": { canvas: true },
      "bgm-v1": { canvas: true },
    },
    model_catalog: {
      "custom-default-tts": { kind: "audio", label: "插件声明默认语音" },
      "tts-1": { kind: "audio", label: "OpenAI TTS-1" },
      "gpt-4o-mini-tts": { kind: "audio", label: "GPT-4o Mini TTS" },
      "portable-v3-tts": { kind: "audio", label: "便携远程语音 v3" },
      "edge-tts": { kind: "audio", label: "Edge 免费语音" },
      "bgm-v1": { kind: "audio", label: "BGM 配乐", provider: "bgm-generator" },
    },
    model_access: {
      "custom-default-tts": true,
      "tts-1": true,
      "gpt-4o-mini-tts": true,
      "portable-v3-tts": true,
      "edge-tts": true,
      "bgm-v1": true,
    },
    model_policy: { revision: 1, enabled: {} },
    credits: { available: 2, reserved: 0 },
    pricing: {
      revision: 1,
      items: [
        { key: "custom-default-tts|standard", amount: 1 },
        { key: "tts-1|standard", amount: 2 },
        { key: "gpt-4o-mini-tts|expressive", amount: 3 },
        { key: "portable-v3-tts|standard", amount: 2 },
        { key: "edge-tts|free", amount: 0 },
        { key: "bgm-v1|standard", amount: 10 },
      ],
    },
  };

  const models = typesMod.resolveCanvasSpeechModels(studioFixture);
  assert.deepEqual(
    models.map((m: { id: string }) => m.id),
    [
      "custom-default-tts",
      "tts-1",
      "gpt-4o-mini-tts",
      "portable-v3-tts",
      "edge-tts",
    ],
  );

  // Authoritative server canvas_speech_models must NOT be second-guessed by local model_access / model_forms
  const authoritativeOnly = typesMod.resolveCanvasSpeechModels({
    canvas_speech_models: ["remote-v2-speech", "edge-tts"],
    model_catalog: {
      "remote-v2-speech": { kind: "audio", label: "远程语音 v2" },
      "edge-tts": { kind: "audio", label: "Edge 免费语音" },
    },
    model_access: {
      "remote-v2-speech": false,
      "edge-tts": true,
    },
    model_policy: { revision: 1, enabled: {} },
  });
  assert.deepEqual(
    authoritativeOnly.map((m: { id: string }) => m.id),
    ["remote-v2-speech", "edge-tts"],
  );

  const autoPlan = typesMod.quoteCanvasSpeechPlan({
    studio: studioFixture,
    node: {
      id: "n1",
      type: "video",
      narration_text: "自动默认模型测试",
      dialogue_lines: [{ id: "d1", speaker: "甲", text: "台词" }],
    },
    packs: [],
  });
  assert.equal(autoPlan.narration.activeModel, "custom-default-tts");
  assert.equal(autoPlan.narration.cost, 1);
  assert.equal(autoPlan.narration.unavailableReason, "");
  assert.equal(autoPlan.dialogue.batchCost, 1);
  assert.equal(autoPlan.dialogue.unavailableReason, "");

  const mixedPlan = typesMod.quoteCanvasSpeechPlan({
    studio: studioFixture,
    node: {
      id: "n2",
      type: "video",
      narration_model: "gpt-4o-mini-tts",
      narration_text: "旁白显式 3 积分",
      dialogue_lines: [
        { id: "l1", speaker: "林墨", text: "角色声线 2 积分" },
        { id: "l2", speaker: "路人", text: "免费 Edge 0 积分", model: "edge-tts" },
        { id: "l3", speaker: "旁观", text: "便携语音 2 积分", model: "portable-v3-tts" },
      ],
    },
    packs: [
      {
        id: "pack-linmo",
        name: "林墨",
        purpose: "subject",
        voice_profile: { model: "tts-1", voice_id: "alloy" },
      },
    ],
  });
  assert.equal(mixedPlan.narration.activeModel, "gpt-4o-mini-tts");
  assert.equal(mixedPlan.narration.cost, 3);
  assert.equal(mixedPlan.narration.unavailableReason, "当前空间积分不足");
  assert.equal(mixedPlan.dialogue.lineReasons.l1, "");
  assert.equal(mixedPlan.dialogue.lineReasons.l2, "");
  assert.equal(mixedPlan.dialogue.lineReasons.l3, "");
  assert.equal(mixedPlan.dialogue.batchCost, 4);
  assert.equal(mixedPlan.dialogue.unavailableReason, "当前空间积分不足");
});

test("PR #223 Round 3 Item 3: resolveCanvasWorkspaceTop reserves dedicated sub-header band when surface switcher stacks below header and keeps storyboard dock unobstructed", async () => {
  const typesMod = (await import("../../apps/web/canvas-editor/types.js")) as Record<
    string,
    any
  >;
  assert.equal(typeof typesMod.resolveCanvasWorkspaceTop, "function");

  assert.deepEqual(
    typesMod.resolveCanvasWorkspaceTop({
      rootTop: 0,
      headerBottom: 58,
      switcherTop: 14,
      switcherBottom: 50,
      switcherHeight: 36,
    }),
    { headerBottom: 58, workspaceTop: 58 },
  );

  assert.deepEqual(
    typesMod.resolveCanvasWorkspaceTop({
      rootTop: 0,
      headerBottom: 58,
      switcherTop: 64,
      switcherBottom: 100,
      switcherHeight: 36,
    }),
    { headerBottom: 58, workspaceTop: 106 },
  );

  assert.deepEqual(
    typesMod.resolveCanvasWorkspaceTop({
      rootTop: 0,
      headerBottom: 104,
      switcherTop: 110,
      switcherBottom: 146,
      switcherHeight: 36,
    }),
    { headerBottom: 104, workspaceTop: 152 },
  );

  const overridesCss = await readFile(
    join(process.cwd(), "apps/web/canvas-editor/canvas-overrides.css"),
    "utf8",
  );
  assert.match(
    overridesCss,
    /\.fm-docked-storyboard\s*\{[\s\S]*?top:\s*var\(\s*--fm-workspace-top,/,
  );
});

test("PR #223 Round 4 Items 3 & 4: quoteCanvasSpeechPlan scopes voice packs to current workspace (updated DESC, non-null profile stops speaker fallback) and handles multi-tier indeterminate fallback safely", async () => {
  const typesMod = (await import("../../apps/web/canvas-editor/types.js")) as Record<
    string,
    any
  >;

  const baseStudio = {
    workspace_id: 2,
    canvas_speech_models: ["breeze-tts-2", "tts-1", "edge-tts"],
    canvas_speech_default_models: ["breeze-tts-2"],
    model_forms: {},
    model_catalog: {
      "breeze-tts-2": { kind: "audio", label: "Breeze TTS 2" },
      "tts-1": { kind: "audio", label: "OpenAI TTS-1" },
      "edge-tts": { kind: "audio", label: "Edge 免费语音" },
    },
    model_access: {
      "breeze-tts-2": true,
      "tts-1": true,
      "edge-tts": true,
    },
    model_policy: { revision: 1, enabled: {} },
    credits: { available: 1, reserved: 0 },
    pricing: {
      revision: 1,
      items: [
        { key: "breeze-tts-2|standard", amount: 2 },
        { key: "tts-1|standard", amount: 3 },
        { key: "edge-tts|free", amount: 0 },
      ],
    },
  };

  // 1) External global pack (workspace: 1 !== 2) with same speaker name OR bound pack_id MUST be ignored!
  const externalGlobalPacks = [
    {
      id: "ext_global_pack_01",
      workspace: 1,
      scope: "global",
      name: "Speaker",
      purpose: "subject",
      updated: 9999,
      voice_profile: { model: "edge-tts", voice_id: "zh-CN-XiaoxiaoNeural" },
    },
  ];
  const extPlan = typesMod.quoteCanvasSpeechPlan({
    studio: baseStudio,
    node: {
      id: "shot1",
      type: "video",
      dialogue_lines: [
        { id: "by_name", speaker: "Speaker", text: "同名外部全局包不应生效" },
        {
          id: "by_id",
          speaker: "Other",
          pack_id: "ext_global_pack_01",
          text: "绑定外部全局包 ID 也不应跨空间读取声线",
        },
      ],
    },
    packs: externalGlobalPacks,
  });
  // Both resolve to workspace default "breeze-tts-2" (2 credits > 1 available -> blocked), NOT external "edge-tts"!
  assert.equal(extPlan.dialogue.lineModels.by_name, "breeze-tts-2");
  assert.equal(extPlan.dialogue.lineCosts.by_name, 2);
  assert.equal(extPlan.dialogue.lineReasons.by_name, "当前空间积分不足");
  assert.equal(extPlan.dialogue.lineModels.by_id, "breeze-tts-2");

  // Reverse direction: external global "Speaker" has paid tts-1 (3 credits), local default is free edge-tts -> must NOT block!
  const reverseExtPlan = typesMod.quoteCanvasSpeechPlan({
    studio: {
      ...baseStudio,
      canvas_speech_models: ["edge-tts", "tts-1"],
      canvas_speech_default_models: ["edge-tts"],
      credits: { available: 0, reserved: 0 },
    },
    node: {
      id: "shot1",
      type: "video",
      dialogue_lines: [{ id: "l1", speaker: "Speaker", text: "免费请求不应被外部包拦住" }],
    },
    packs: [
      {
        id: "ext_paid",
        workspace: 1,
        scope: "global",
        name: "Speaker",
        purpose: "subject",
        updated: 9999,
        voice_profile: { model: "tts-1" },
      },
    ],
  });
  assert.equal(reverseExtPlan.dialogue.lineModels.l1, "edge-tts");
  assert.equal(reverseExtPlan.dialogue.lineReasons.l1, "");
  assert.equal(reverseExtPlan.dialogue.unavailableReason, "");

  // 2) Local workspace (workspace: 2) subject packs:
  //    - Same speaker name picks highest `updated` DESC
  //    - Bound pack_id with non-null voice_profile { voice_id: "alloy" } (no model) stops speaker-name fallback!
  //    - Bound pack_id with null/empty voice_profile DOES fall back by speaker name!
  //    - Explicit line.model ALWAYS wins!
  const localPacks = [
    {
      id: "local_older",
      workspace: 2,
      name: "Speaker",
      purpose: "subject",
      updated: 100,
      voice_profile: { model: "tts-1" },
    },
    {
      id: "local_newer",
      workspace: 2,
      scope: "global",
      name: "Speaker",
      purpose: "subject",
      updated: 200,
      voice_profile: { model: "edge-tts" },
    },
    {
      id: "local_voice_only",
      workspace: 2,
      name: "Other",
      purpose: "subject",
      updated: 300,
      voice_profile: { voice_id: "alloy" },
    },
    {
      id: "local_no_profile",
      workspace: 2,
      name: "Other",
      purpose: "subject",
      updated: 300,
      voice_profile: null,
    },
  ];
  const localPlan = typesMod.quoteCanvasSpeechPlan({
    studio: { ...baseStudio, credits: { available: 10, reserved: 0 } },
    node: {
      id: "shot2",
      type: "video",
      dialogue_lines: [
        { id: "name_sort", speaker: "Speaker", text: "取 updated=200 的 edge-tts" },
        {
          id: "nonnull_profile",
          speaker: "Speaker",
          pack_id: "local_voice_only",
          text: "有 voice_id 无 model 时不再按同名回退到 Speaker",
        },
        {
          id: "null_profile",
          speaker: "Speaker",
          pack_id: "local_no_profile",
          text: "无 voice_profile 时继续按同名回退到 Speaker",
        },
        {
          id: "explicit_line",
          speaker: "Speaker",
          pack_id: "local_newer",
          model: "tts-1",
          text: "行级显式 model 优先",
        },
      ],
    },
    packs: localPacks,
  });
  assert.equal(localPlan.dialogue.lineModels.name_sort, "edge-tts");
  assert.equal(localPlan.dialogue.lineModels.nonnull_profile, "breeze-tts-2");
  assert.equal(localPlan.dialogue.lineModels.null_profile, "edge-tts");
  assert.equal(localPlan.dialogue.lineModels.explicit_line, "tts-1");

  // 3) Multi-tier pricing WITHOUT matcher/form info -> indeterminate: does NOT guess first tier (50) and does NOT falsely block!
  const indeterminatePlan = typesMod.quoteCanvasSpeechPlan({
    studio: {
      ...baseStudio,
      credits: { available: 10, reserved: 0 },
      pricing: {
        revision: 1,
        items: [
          { key: "breeze-tts-2|wav", amount: 50 },
          { key: "breeze-tts-2|standard", amount: 2 },
        ],
      },
    },
    node: {
      id: "shot3",
      type: "video",
      narration_text: "缺少计费参数时不猜测 50 积分也不误拦截",
      dialogue_lines: [{ id: "d1", speaker: "A", text: "交给服务端核定" }],
    },
    packs: [],
  });
  assert.equal(indeterminatePlan.narration.cost, null);
  assert.equal(indeterminatePlan.narration.costIndeterminate, true);
  assert.equal(indeterminatePlan.narration.unavailableReason, "");
  assert.equal(indeterminatePlan.dialogue.lineReasons.d1, "");
  assert.equal(indeterminatePlan.dialogue.unavailableReason, "");

  // 4) Items 5 & 6 CSS layout contracts: mobile .insert-toolbar & .selection-toolbar clear --fm-workspace-top,
  //    and .canvas-workspace .multi-toolbar clears --fm-workspace-top & centers in unobstructed width (--fm-right-obstruction)
  const root = process.cwd();
  const overridesCss = await readFile(
    join(root, "apps/web/canvas-editor/canvas-overrides.css"),
    "utf8",
  );
  const workspaceSource = await readFile(
    join(root, "apps/web/canvas-editor/CanvasWorkspace.tsx"),
    "utf8",
  );
  assert.match(
    overridesCss,
    /\.canvas-workspace\[data-composer-open="true"\] \.insert-toolbar\s*\{[\s\S]*?top:\s*calc\(var\(--fm-workspace-top,\s*96px\)\s*\+\s*6px\)/,
  );
  assert.match(
    overridesCss,
    /\.canvas-workspace \.multi-toolbar\s*\{[\s\S]*?top:\s*max\(74px,\s*calc\(var\(--fm-workspace-top,\s*60px\)\s*\+\s*8px\)\)[\s\S]*?--fm-right-obstruction/,
  );
  assert.match(workspaceSource, /"--fm-right-obstruction":\s*`\$\{rightObstruction\}px`/);
});

test("PR #223 Round 5: AssetPacks emits single onPackMutate before modal close/onRemovePack and CanvasWorkspace guards availablePacks refresh with read generation", async () => {
  const root = process.cwd();
  const assetPacksSource = await readFile(
    join(root, "apps/web/canvas-editor/AssetPacks.tsx"),
    "utf8",
  );
  const workspaceSource = await readFile(
    join(root, "apps/web/canvas-editor/CanvasWorkspace.tsx"),
    "utf8",
  );

  // Single optional mutation callback emitted on save, lock/unlock, scope, turnaround-views, & delete BEFORE mountedRef early-return and BEFORE onRemovePack
  assert.match(
    assetPacksSource,
    /onPackMutate\?:\(change:\{kind:'saved';pack:Pack\}\|\{kind:'deleted';id:string\}\)=>void;/,
  );
  assert.match(
    assetPacksSource,
    /const saved=\(await request\('\/api\/asset-packs'[\s\S]*?onPackMutate\?\.\(\{kind:'saved',pack:saved\}\);\s*if\(!mountedRef\.current\)return;/,
  );
  assert.match(
    assetPacksSource,
    /const toggleLock=async\(target:Pack\)=>\{[\s\S]*?const updated=\(await request\(`\/api\/asset-packs\/\$\{target\.id\}\/\$\{target\.locked\?'unlock':'lock'\}`,\{\},'POST'\)\) as Pack;\s*onPackMutate\?\.\(\{kind:'saved',pack:updated\}\);\s*if\(!mountedRef\.current\)return;/,
  );
  assert.match(
    assetPacksSource,
    /const toggleScope=async\(target:Pack\)=>\{[\s\S]*?const updated=\(await request\(`\/api\/asset-packs\/\$\{target\.id\}\/scope`,\{scope:nextScope\},'PUT'\)\) as Pack;\s*onPackMutate\?\.\(\{kind:'saved',pack:updated\}\);\s*if\(!mountedRef\.current\)return;/,
  );
  const genStart = assetPacksSource.indexOf("const generateTurnaround=");
  const bindStart = assetPacksSource.indexOf("const saveTurnaroundBindings=");
  assert.ok(genStart > 0 && bindStart > genStart);
  assert.doesNotMatch(
    assetPacksSource.slice(genStart, bindStart),
    /onPackMutate/,
  );
  assert.match(
    assetPacksSource.slice(bindStart),
    /const saveTurnaroundBindings=async\(target:Pack\)=>\{[\s\S]*?if\(res\?\.pack\)onPackMutate\?\.\(\{kind:'saved',pack:res\.pack\}\);\s*if\(!mountedRef\.current\)return;/,
  );
  assert.match(
    assetPacksSource,
    /await request\('\/api\/asset-packs\/'\+pack\.id,undefined,'DELETE'\);onPackMutate\?\.\(\{kind:'deleted',id:pack\.id\}\);if\(!mountedRef\.current\)return;[\s\S]*?else if\(wasSelected\)await onRemovePack\(pack\.id\);/,
  );

  // CanvasWorkspace wires onPackMutate + generation-guarded loadAvailablePacks while keeping importPack intact
  assert.match(workspaceSource, /const packsReadSeqRef = useRef\(0\);/);
  assert.match(workspaceSource, /seq === packsReadSeqRef\.current/);
  assert.match(workspaceSource, /onPackMutate=\{\(change\) => \{/);

  // Verify same-workspace duplicate-name packs flip speech quote when lock/scope/turnaround advances `updated`
  const typesMod = await import("../../apps/web/canvas-editor/types.js");
  const studioZeroBalance = {
    workspace_id: 2,
    canvas_speech_models: ["tts-1", "edge-tts"],
    canvas_speech_default_models: ["tts-1"],
    model_catalog: {
      "tts-1": { kind: "audio", label: "OpenAI TTS-1" },
      "edge-tts": { kind: "audio", label: "Edge 免费配音" },
    },
    model_access: { "tts-1": true, "edge-tts": true },
    model_policy: { revision: 1, enabled: { "tts-1": true, "edge-tts": true } },
    pricing: {
      revision: 1,
      items: [
        { key: "tts-1|standard", amount: 2 },
        { key: "edge-tts|free", amount: 0 },
      ],
    },
    credits: { available: 0, reserved: 0 },
  };
  const olderFree = {
    id: "p_free",
    workspace: 2,
    name: "主角",
    purpose: "subject",
    updated: 100,
    media: ["m1"],
    voice_profile: { model: "edge-tts" },
  };
  const newerPaid = {
    id: "p_paid",
    workspace: 2,
    name: "主角",
    purpose: "subject",
    updated: 101,
    media: ["m1"],
    voice_profile: { model: "tts-1" },
  };
  const beforeLock = typesMod.quoteCanvasSpeechPlan({
    studio: studioZeroBalance,
    node: { dialogue_lines: [{ id: "d1", speaker: "主角", text: "台词" }] },
    packs: [newerPaid, olderFree],
  });
  assert.equal(beforeLock.dialogue.lineModels.d1, "tts-1");
  assert.equal(beforeLock.dialogue.unavailableReason, "当前空间积分不足");

  // Locking olderFree bumps its `updated` to 102 -> onPackMutate moves it ahead with updated=102 -> free edge-tts selected!
  const lockedFree = { ...olderFree, locked: true, updated: 102 };
  const afterLock = typesMod.quoteCanvasSpeechPlan({
    studio: studioZeroBalance,
    node: { dialogue_lines: [{ id: "d1", speaker: "主角", text: "台词" }] },
    packs: [lockedFree, newerPaid],
  });
  assert.equal(afterLock.dialogue.lineModels.d1, "edge-tts");
  assert.equal(afterLock.dialogue.unavailableReason, "");
});
