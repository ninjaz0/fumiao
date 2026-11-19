import assert from "node:assert/strict";
import test from "node:test";
import { additionalBrowserOrigins } from "../../apps/api/src/browser-origins.js";

test("secondary browser origins use exact scheme, host and port", () => {
  const origins = additionalBrowserOrigins(
    "http://localhost:3000, https://studio.example.test:7443",
  );
  assert.equal(origins.size, 2);
  assert.ok(origins.has("http://localhost:3000"));
  assert.ok(origins.has("https://studio.example.test:7443"));
  assert.ok(!origins.has("https://studio.example.test"));
  assert.ok(!origins.has("null"));
  assert.equal(additionalBrowserOrigins("").size, 0);
  for (const invalid of [
    "*",
    "null",
    "ftp://example.test",
    "https://*.example.test",
    "https://example.test/path",
  ])
    assert.throws(() => additionalBrowserOrigins(invalid));
});
