import assert from "node:assert/strict";
import test from "node:test";
import {
  VIRTUALIZATION_NODE_THRESHOLD,
  buildNodeHandles,
  computeGridGap,
  computeOverlayPositions,
  draftEquals,
  indexRunsByNode,
  reconcileRuns,
  resolveNodeFromIndex,
  shouldVirtualizeCanvas,
  studioFingerprint,
} from "../../apps/web/canvas-editor/performance.js";
import {
  newNode,
  resolveNode,
  type CanvasNode,
  type Draft,
  type Job,
  type Studio,
} from "../../apps/web/canvas-editor/types.js";
import { VideoThumbnailScheduler } from "../../apps/web/canvas-editor/videoThumbnails.js";

function makeJob(overrides: Partial<Job>): Job {
  return {
    id: 1,
    owner: 1,
    kind: "video",
    status: "done",
    result: "media-1",
    note: "",
    prompt: "prompt",
    refs: [],
    width: 1280,
    height: 720,
    created: 1700000000,
    seconds: 5,
    quality: 480,
    ratio: "16:9",
    image_quality: "medium",
    model: "MiniMax H3",
    ...overrides,
  };
}

test("shouldVirtualizeCanvas preserves small-canvas drag behavior and virtualizes large canvases", () => {
  assert.equal(shouldVirtualizeCanvas(3, true), false);
  assert.equal(shouldVirtualizeCanvas(VIRTUALIZATION_NODE_THRESHOLD, true), false);
  assert.equal(shouldVirtualizeCanvas(3, false), true);
  assert.equal(
    shouldVirtualizeCanvas(VIRTUALIZATION_NODE_THRESHOLD + 1, true),
    true,
  );
  assert.equal(shouldVirtualizeCanvas(187, true), true);
});

test("buildNodeHandles precomputes handle bounds for every node type", () => {
  const text = { ...newNode("text", 0, 0, 1), width: 300, height: 200 };
  const sticky = { ...newNode("sticky", 0, 0, 1), width: 280, height: 220 };
  const image = { ...newNode("image", 0, 0, 1), width: 320, height: 240 };
  const video = { ...newNode("video", 0, 0, 1), width: 320, height: 180 };

  assert.deepEqual(buildNodeHandles(text, false), [
    { type: "source", position: "right", x: 300, y: 100, width: 0, height: 0 },
  ]);
  assert.deepEqual(buildNodeHandles(sticky, false), []);
  assert.deepEqual(buildNodeHandles(image, false), [
    { type: "target", position: "left", x: 0, y: 120, width: 0, height: 0 },
    { type: "source", position: "right", x: 320, y: 120, width: 0, height: 0 },
  ]);
  assert.deepEqual(buildNodeHandles(video, false), [
    { type: "target", position: "left", x: 0, y: 90, width: 0, height: 0 },
  ]);
  assert.deepEqual(buildNodeHandles(video, true), [
    { type: "target", position: "left", x: 0, y: 90, width: 0, height: 0 },
    { type: "source", position: "right", x: 320, y: 90, width: 0, height: 0 },
  ]);

  const pluginNode: CanvasNode = {
    ...newNode("plugin", 0, 0, 1),
    width: 320,
    height: 240,
    extension: {
      definition: {
        id: "n1",
        plugin: "p1",
        version: "1.0.0",
        title: "Plugin",
        inputs: [
          { id: "in1", title: "In 1", kind: "text" },
          { id: "in2", title: "In 2", kind: "image" },
        ],
        outputs: [{ id: "out1", title: "Out 1", kind: "text" }],
        fields: [],
      },
      values: {},
    },
  };
  assert.deepEqual(buildNodeHandles(pluginNode, false), [
    { id: "in1", type: "target", position: "left", x: 0, y: 80, width: 0, height: 0 },
    { id: "in2", type: "target", position: "left", x: 0, y: 160, width: 0, height: 0 },
    { id: "out1", type: "source", position: "right", x: 320, y: 120, width: 0, height: 0 },
  ]);
});

test("resolveNodeFromIndex matches resolveNode across media, latest, active_job, and use_media", () => {
  const n1 = { ...newNode("video", 0, 0, 1), media_id: "direct-1" };
  const n2 = { ...newNode("video", 0, 0, 2), active_job: 101 };
  const n3 = { ...newNode("video", 0, 0, 3), media_id: "pinned-3", use_media: true };
  const runs: Job[] = [
    makeJob({ id: 102, canvas_node: n2.id, status: "running", result: null }),
    makeJob({ id: 101, canvas_node: n2.id, status: "done", result: "job-res-101" }),
    makeJob({ id: 103, canvas_node: n3.id, status: "done", result: "job-res-103" }),
  ];
  const byNode = indexRunsByNode(runs);
  for (const node of [n1, n2, n3]) {
    assert.deepEqual(resolveNodeFromIndex(node, byNode), resolveNode(node, runs));
  }
});

test("reconcileRuns keeps previous array and item references when polls are unchanged", () => {
  const job1 = makeJob({ id: 1, canvas_node: "a", status: "done", result: "m1" });
  const job2 = makeJob({ id: 2, canvas_node: "b", status: "running", result: null });
  const prev = [job1, job2];

  const sameCopy = [
    makeJob({ id: 1, canvas_node: "a", status: "done", result: "m1" }),
    makeJob({ id: 2, canvas_node: "b", status: "running", result: null }),
  ];
  assert.equal(reconcileRuns(prev, sameCopy), prev);

  const oneChanged = [
    makeJob({ id: 1, canvas_node: "a", status: "done", result: "m1" }),
    makeJob({ id: 2, canvas_node: "b", status: "done", result: "m2" }),
  ];
  const merged = reconcileRuns(prev, oneChanged);
  assert.notEqual(merged, prev);
  assert.equal(merged[0], job1, "unchanged job keeps exact reference");
  assert.equal(merged[1].result, "m2");
});

test("studioFingerprint ignores server_time ticks while detecting state changes", () => {
  const base = {
    server_time: 1000,
    workspace_id: 1,
    credits: { available: 100, reserved: 0 },
    jobs: [],
    assets: [],
  } as unknown as Studio;
  const ticked = { ...base, server_time: 1005 } as unknown as Studio;
  const changed = {
    ...base,
    server_time: 1005,
    credits: { available: 90, reserved: 10 },
  } as unknown as Studio;

  assert.equal(studioFingerprint(base), studioFingerprint(ticked));
  assert.notEqual(studioFingerprint(base), studioFingerprint(changed));
});

test("draftEquals matches JSON semantics while skipping unchanged node references", () => {
  const n1 = newNode("text", 10, 20, 1);
  const n2 = newNode("video", 400, 20, 1);
  const base: Draft = {
    title: "Test",
    document: { schemaVersion: 1, nodes: [n1, n2], edges: [] },
  };
  const identicalCopy: Draft = {
    title: "Test",
    document: { schemaVersion: 1, nodes: [n1, { ...n2 }], edges: [] },
  };
  const moved: Draft = {
    title: "Test",
    document: { schemaVersion: 1, nodes: [n1, { ...n2, x: 410 }], edges: [] },
  };
  const withEmptyShots: Draft = {
    title: "Test",
    document: { schemaVersion: 1, nodes: [n1, n2], edges: [], shots: [] },
  };

  assert.equal(draftEquals(base, identicalCopy), true);
  assert.equal(draftEquals(base, moved), false);
  assert.equal(draftEquals(base, withEmptyShots), false);
});

test("computeGridGap and computeOverlayPositions compute stable geometry", () => {
  assert.ok(computeGridGap(0.28) >= 16);
  assert.ok(computeGridGap(1) === 24);
  const pos = computeOverlayPositions({
    viewport: { x: 100, y: 120, zoom: 0.5 },
    windowSize: { w: 1440, h: 900 },
    node: { x: 200, y: 200, width: 320, height: 240, type: "video" },
    panelHeight: 270,
  });
  assert.ok(pos.toolbar && pos.composer);
  assert.equal(pos.toolbar.top, 220 - 82);
});

test("VideoThumbnailScheduler enforces concurrency cap, priority order, deduplication, cancellation, pause/resume, and LRU", async () => {
  type Deferred = {
    mediaId: string;
    signal: AbortSignal;
    resolve: (url: string | null) => void;
    aborted: boolean;
  };
  const started: string[] = [];
  const inFlight = new Map<string, Deferred>();
  let peakActive = 0;
  const released: string[] = [];

  let clock = 1000;
  const scheduler = new VideoThumbnailScheduler(
    (mediaId, signal) => {
      started.push(mediaId);
      return new Promise<string | null>((resolve) => {
        const entry: Deferred = { mediaId, signal, resolve, aborted: false };
        inFlight.set(mediaId, entry);
        peakActive = Math.max(peakActive, inFlight.size);
        signal.addEventListener(
          "abort",
          () => {
            entry.aborted = true;
            inFlight.delete(mediaId);
            resolve(null);
          },
          { once: true },
        );
      });
    },
    {
      maxConcurrent: 2,
      maxCacheEntries: 3,
      failureCooldownMs: 30_000,
      now: () => clock,
      releaseUrl: (url) => released.push(url),
    },
  );

  // Pause prevents new extractions until resumed.
  scheduler.pause("viewport-move");
  const results = new Map<string, string | null>();
  const unsub1 = scheduler.subscribe("v1", () => 500, (u) => results.set("v1", u));
  const unsub2 = scheduler.subscribe("v2", () => 10, (u) => results.set("v2", u));
  const unsub3 = scheduler.subscribe("v3", () => 100, (u) => results.set("v3", u));
  const unsub4 = scheduler.subscribe("v4", () => 50, (u) => results.set("v4", u));
  // Duplicate subscription on v2 should share the same extraction.
  let dupResult: string | null = null;
  const unsub2Dup = scheduler.subscribe("v2", () => 5, (u) => {
    dupResult = u;
  });

  assert.equal(started.length, 0, "must not start while paused");

  // Resume starts highest-priority 2 items: v2 (priority 5) and v4 (priority 50).
  scheduler.resume("viewport-move");
  assert.deepEqual(started, ["v2", "v4"]);
  assert.equal(peakActive, 2);

  // Cancel v1 while queued: must never start.
  unsub1();

  // Cancel v4 while in-flight: must abort and immediately start v3!
  const d4 = inFlight.get("v4")!;
  unsub4();
  assert.equal(d4.aborted, true);
  assert.deepEqual(started, ["v2", "v4", "v3"]);
  assert.equal(scheduler.hasFailed("v4"), false, "aborted item must not be marked failed");

  // Complete v2 and v3.
  const d2 = inFlight.get("v2")!;
  inFlight.delete("v2");
  d2.resolve("blob:v2");
  const d3 = inFlight.get("v3")!;
  inFlight.delete("v3");
  d3.resolve("blob:v3");
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(results.get("v2"), "blob:v2");
  assert.equal(dupResult, "blob:v2");
  assert.equal(results.get("v3"), "blob:v3");
  assert.equal(scheduler.peek("v2"), "blob:v2");

  // Unsubscribe v2 and v3 so they become eligible for LRU eviction later.
  unsub2();
  unsub2Dup();
  unsub3();

  // Re-subscribing to previously aborted v4 works cleanly.
  const unsub4Retry = scheduler.subscribe("v4", () => 1, (u) => results.set("v4", u));
  const d4Retry = inFlight.get("v4")!;
  assert.ok(d4Retry);
  inFlight.delete("v4");
  d4Retry.resolve("blob:v4");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(results.get("v4"), "blob:v4");

  // Adding a 4th cached thumbnail evicts oldest unmounted entry (v3, since v2 was touched by peek!).
  const unsub5 = scheduler.subscribe("v5", () => 1, (u) => results.set("v5", u));
  const d5 = inFlight.get("v5")!;
  inFlight.delete("v5");
  d5.resolve("blob:v5");
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(released, ["blob:v3"]);

  // Failing extraction marks mediaId as failed during cooldown, then allows retry after cooldown.
  const unsubBad = scheduler.subscribe("bad", () => 1, (u) => results.set("bad", u));
  const dBad = inFlight.get("bad")!;
  inFlight.delete("bad");
  dBad.resolve(null);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(results.get("bad"), null);
  assert.equal(scheduler.hasFailed("bad"), true);
  unsubBad();
  clock += 30_000;
  assert.equal(scheduler.hasFailed("bad"), false);
  const unsubBadRetry = scheduler.subscribe("bad", () => 1, (u) => results.set("bad", u));
  const dBadRetry = inFlight.get("bad")!;
  assert.ok(dBadRetry);
  inFlight.delete("bad");
  dBadRetry.resolve("blob:bad-recovered");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(results.get("bad"), "blob:bad-recovered");
  unsubBadRetry();

  // Disposing revokes all remaining cached URLs.
  unsub4Retry();
  unsub5();
  scheduler.dispose();
  assert.equal(released.includes("blob:v2"), true);
  assert.equal(released.includes("blob:v4"), true);
  assert.equal(released.includes("blob:v5"), true);
  assert.equal(peakActive, 2);
});
