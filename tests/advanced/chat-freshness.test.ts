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
