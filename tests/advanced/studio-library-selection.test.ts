import assert from "node:assert/strict";
import test from "node:test";
import { identityBodies } from "../../packages/original-api/src/contracts.js";
import { parseBody } from "../../packages/original-api/src/validation.js";
import {
  allAssetsSelected,
  selectAllAssets,
} from "../../apps/web/studio/library-selection.js";

const visible = Array.from({ length: 205 }, (_, i) => `asset:${i + 1}`);

test("select all caps existing selections outside the first 200", () => {
  const selected = selectAllAssets([visible[204]], visible);
  assert.equal(selected.length, 200);
  assert.ok(selected.includes(visible[204]));
});

test("select all over 200 is checked and toggles off", () => {
  const selected = selectAllAssets([], visible);
  assert.equal(selected.length, 200);
  assert.equal(allAssetsSelected(selected, visible), true);
  assert.deepEqual(selectAllAssets(selected, visible), []);
});

test("select all handles ordinary and empty lists", () => {
  const small = visible.slice(0, 3);
  assert.deepEqual(selectAllAssets([], small), small);
  assert.deepEqual(selectAllAssets(small, small), []);
  assert.deepEqual(selectAllAssets([], []), []);
  assert.equal(allAssetsSelected([], []), false);
});

test("bulk API accepts capped selections and rejects empty or oversized input", () => {
  const keys = selectAllAssets([visible[204]], visible);
  assert.deepEqual(parseBody({ keys }, identityBodies.assetKeys), { keys });
  for (const invalid of [[], visible]) {
    assert.throws(
      () => parseBody({ keys: invalid }, identityBodies.assetKeys),
      {
        status: 422,
      },
    );
  }
});

test("deselecting clears visible selections beyond the first 200", () => {
  const selected = selectAllAssets([visible[204]], visible);
  assert.equal(allAssetsSelected(selected, visible), true);
  assert.deepEqual(selectAllAssets(selected, visible), []);
});
