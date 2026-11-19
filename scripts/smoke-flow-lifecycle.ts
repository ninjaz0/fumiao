import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { flowLifecycleFixture } from "../tests/helpers/flow-lifecycle.js";
import { flowSafeError } from "../plugins/flow/src/lifecycle.js";
import { flowUnescape } from "../plugins/flow/src/html.js";
const directory = await mkdtemp(join(tmpdir(), "fumiao-flow-lifecycle-"));
let f: Awaited<ReturnType<typeof flowLifecycleFixture>> | undefined;
try {
  const data = JSON.parse(
    execFileSync(
      process.env.STUDIO_PYTHON ||
        resolve(".runtime-advanced/original/.venv/bin/python"),
      ["scripts/flow-lifecycle-fixtures.py", directory],
      { encoding: "utf8", maxBuffer: 8 * 1024 ** 2 },
    ),
  );
  for (const c of data.safe)
    assert.equal(
      flowSafeError(c.status, c.text),
      c.expected,
      JSON.stringify(c),
    );
  for (const c of data.entities)
    assert.equal(flowUnescape(c.text), c.expected, JSON.stringify(c));
  f = await flowLifecycleFixture();
  for (const c of data.cases) {
    f.requests.length = 0;
    f.downloads.length = 0;
    f.setWire({ ...c.wire, chunkSize: c.name === "multibyte" ? 1 : 32768 });
    await f.db.query("UPDATE wallets SET balance=10000 WHERE workspace_id=$1", [
      f.wid,
    ]);
    const j = await f.create(c.model),
      references = c.missing
        ? ["00000000-0000-4000-8000-000000000000"]
        : c.refs
          ? [await f.reference()]
          : [];
    await f.db.query("UPDATE jobs SET input=$2,original_view=$3 WHERE id=$1", [
      j.id,
      JSON.stringify({
        ...j.input,
        prompt: "图 <Picture 1> / 多行\n生成",
        params: c.source ? { source_media_id: "project/source:1" } : {},
        references,
      }),
      JSON.stringify(c.source ? { actual: { flow_source_job: 71 } } : {}),
    ]);
    await f.executor.execute(j.id);
    assert.deepEqual(await f.snapshot(j.id), c.expected, c.name);
    assert.deepEqual(
      f.requests,
      c.requests.map(({ timeout, ...r }: any) => r),
      c.name + " request",
    );
    assert.deepEqual(f.downloads, c.downloads, c.name + " output");
  }
  await mkdir(".runtime-advanced/flow-lifecycle-parity", { recursive: true });
  const report = {
    passed: true,
    scenarios: data.cases.length,
    errorMappings: data.safe.length,
    htmlEntities: data.entities.length,
  };
  await writeFile(
    ".runtime-advanced/flow-lifecycle-parity/report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log("Original Flow lifecycle parity: " + JSON.stringify(report));
} finally {
  await f?.cleanup();
  await rm(directory, { recursive: true, force: true });
}
