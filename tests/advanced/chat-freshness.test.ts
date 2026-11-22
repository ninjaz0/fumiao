import assert from "node:assert/strict";
import { test } from "node:test";
import { chatFreshness } from "../../apps/web/canvas-editor/chat/freshness.js";

test("chat freshness accepts initial snapshots and rejects delayed older revisions", () => {
  const accept = chatFreshness();
  assert.equal(accept({ id: "chat", revision: 2 }), true);
  assert.equal(accept({ id: "chat", revision: 3 }), true);
  assert.equal(accept({ id: "chat", revision: 2 }), false);
  assert.equal(accept({ id: "chat", revision: 1 }), false);
  assert.equal(accept({ id: "chat", revision: 3 }), true);
});

test("equal revisions allow streaming messages and conversations have independent watermarks", () => {
  const accept = chatFreshness();
  assert.equal(accept({ id: "first", revision: 5 }), true);
  assert.equal(accept({ id: "first", revision: 5 }), true);
  assert.equal(accept({ id: "second", revision: 1 }), true);
  assert.equal(chatFreshness()({ id: "first", revision: 1 }), true);
});

test("a deleted revision rejects stale list entries and snapshots until a newer restore", () => {
  const accept = chatFreshness();
  const original = { id: "chat", revision: 1, updated: 1 };
  accept(original);
  const started = accept.startList();
  assert.equal(accept.remove({ id: "chat", revision: 2 }), true);
  assert.deepEqual(accept.reconcile([original], [], started), []);
  assert.equal(accept(original), false);
  assert.equal(accept({ id: "chat", revision: 2 }), false);
  const restored = { id: "chat", revision: 3, updated: 1 };
  assert.equal(accept(restored), true);
  assert.equal(accept.remove({ id: "chat", revision: 2 }), false);
  assert.deepEqual(accept.reconcile([original], [restored], started), [restored]);
});

test("a list predating restore cannot remove it, but a later empty list can", () => {
  const accept = chatFreshness();
  accept.remove({ id: "chat", revision: 2 });
  const started = accept.startList();
  const restored = { id: "chat", revision: 3, updated: 1 };
  accept(restored);
  assert.deepEqual(accept.reconcile([], [restored], started), [restored]);
  assert.deepEqual(accept.reconcile([restored], [restored], accept.startList()), [restored]);
  assert.deepEqual(accept.reconcile([], [restored], accept.startList()), []);
});

test("list reconciliation discovers remote chats and drops genuinely absent chats", () => {
  const accept = chatFreshness();
  const old = { id: "old", revision: 1, updated: 1 };
  const remote = { id: "remote", revision: 1, updated: 1 };
  accept(old);
  assert.deepEqual(accept.reconcile([remote], [old], accept.startList()), [remote]);
  assert.deepEqual(accept.reconcile([], [remote], accept.startList()), []);
});

test("a stale list retains newer known metadata without affecting other entries", () => {
  const accept = chatFreshness();
  const newer = { id: "chat", revision: 4, updated: 4 };
  accept(newer);
  assert.deepEqual(accept.reconcile([{ id: "chat", revision: 1, updated: 1 }], [newer], accept.startList()), [newer]);
  assert.deepEqual(accept.reconcile([], [], accept.startList()), []);
});

test("reconciliation sorts retained chats and incoming chats by updated descending", () => {
  const accept = chatFreshness();
  const started = accept.startList();
  const retained = { id: "retained", revision: 3, updated: 30 };
  const older = { id: "older", revision: 1, updated: 10 };
  const newest = { id: "newest", revision: 1, updated: 40 };
  accept(retained);
  assert.deepEqual(accept.reconcile([newest, older], [retained], started), [newest, retained, older]);
});
