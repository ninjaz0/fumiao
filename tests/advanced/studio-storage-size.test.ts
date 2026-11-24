import assert from "node:assert/strict";
import test from "node:test";
import { formatStorageBytes } from "../../apps/web/studio/storage-size.js";

test("Studio storage distinguishes small nonzero usage from zero", () => {
  assert.equal(formatStorageBytes(118_525), "118.5 KB");
  assert.equal(formatStorageBytes(1), "1 B");
  assert.equal(formatStorageBytes(0), "0 B");
});

test("Studio storage scales to MB and GB", () => {
  assert.equal(formatStorageBytes(1_500_000), "1.5 MB");
  assert.equal(formatStorageBytes(1_500_000_000), "1.5 GB");
});
