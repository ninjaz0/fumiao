import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { chatProviderFixture } from "../tests/helpers/chat-provider.js";
import { chatContext } from "../packages/platform/src/chat-context.js";
const directory = await mkdtemp(join(tmpdir(), "fumiao-chat-provider-oracle-"));
let f: Awaited<ReturnType<typeof chatProviderFixture>> | undefined;
try {
  execFileSync(
    process.env.STUDIO_PYTHON ||
      resolve(".runtime-advanced/original/.venv/bin/python"),
    ["scripts/chat-provider-fixtures.py", directory],
    { stdio: "pipe", timeout: 180000 },
  );
  const data = JSON.parse(
      await readFile(join(directory, "manifest.json"), "utf8"),
    ),
    failures: any[] = [];
  f = await chatProviderFixture();
  for (const c of data.cases) {
    const actual = await f.run(c, data.messages);
    try {
      assert.deepEqual(actual, c.expected, c.name);
      assert.deepEqual(f.requests, c.requests, c.name + " provider requests");
    } catch (error) {
      failures.push({
        name: c.name,
        error: String(error),
        actual,
        expected: c.expected,
      });
    }
  }
  for (const c of data.contexts) {
    let actual;
    try {
      actual = { messages: chatContext(c.rows) };
    } catch {
      actual = { error: { kind: "generic" } };
    }
    try {
      assert.deepEqual(actual, c.expected, c.name);
    } catch (error) {
      failures.push({ name: c.name, error: String(error).slice(0, 2000) });
    }
  }
  await mkdir(".runtime-advanced/chat-provider-parity", { recursive: true });
  const report = {
    passed: !failures.length,
    scenarios: data.cases.length,
    contexts: data.contexts.length,
    failures,
  };
  await writeFile(
    ".runtime-advanced/chat-provider-parity/report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  assert.equal(failures.length, 0, JSON.stringify(failures, null, 2));
  console.log("Original chat provider parity: " + JSON.stringify(report));
} finally {
  await f?.cleanup();
  await rm(directory, { recursive: true, force: true });
}
