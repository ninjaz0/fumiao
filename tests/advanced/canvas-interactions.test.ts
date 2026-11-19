import test from "node:test";
import assert from "node:assert/strict";
import {
  PASTE_OFFSET,
  collectDownloadTargets,
  createClipboardSnapshot,
  hasDownloadableNodes,
  newNode,
  nextContextSelection,
  resolvePasteOffset,
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
