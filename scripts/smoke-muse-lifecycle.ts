import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { museLifecycleFixture } from "../tests/helpers/muse-lifecycle.js";
import { one } from "../packages/platform/src/db.js";
const directory = await mkdtemp(join(tmpdir(), "fumiao-muse-lifecycle-"));
let f: Awaited<ReturnType<typeof museLifecycleFixture>> | undefined;
try {
  const cases = JSON.parse(
    execFileSync(
      process.env.STUDIO_PYTHON ||
        resolve(".runtime-advanced/original/.venv/bin/python"),
      ["scripts/muse-lifecycle-fixtures.py", directory],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    ),
  );
  f = await museLifecycleFixture();
  let snapshots = 0;
  for (const c of cases) {
    f.requests.length = 0;
    f.downloads.length = 0;
    const job = await f.create("muse-" + c.kind);
    await f.db.query("UPDATE jobs SET input=$2 WHERE id=$1", [
      job.id,
      JSON.stringify({
        ...job.input,
        prompt: "图 <Picture 1> / <Picture １２> / <Picture ١> / <Picture -1>",
        params: { ratio: "16:9", seconds: c.kind === "video" ? 5 : 0 },
        references: c.missingRef
          ? ["00000000-0000-4000-8000-000000000000"]
          : [],
      }),
    ]);
    for (let i = 0; i < c.actions.length; i++) {
      f.setWire(c.actions[i]);
      await f.executor.execute(job.id);
      assert.deepEqual(
        await f.snapshot(job.id),
        c.snapshots[i],
        c.name + " / " + i,
      );
      snapshots++;
    }
    assert.deepEqual(
      f.requests.map(({ idempotency, ...r }) => r),
      c.requests.map(({ timeout, ...r }: any) => r),
      c.name + " request",
    );
    assert.deepEqual(f.downloads, c.downloads, c.name + " download");
    const current = await one(f.db, "SELECT * FROM jobs WHERE id=$1", [job.id]);
    if (
      ["queued", "dispatching", "running", "finalizing"].includes(current.state)
    )
      await f.db.transaction((sql) => f!.p.settle(sql, current, "cancelled"));
  }
  await mkdir(".runtime-advanced/muse-lifecycle-parity", { recursive: true });
  await writeFile(
    ".runtime-advanced/muse-lifecycle-parity/report.json",
    JSON.stringify({ passed: true, cases: cases.length, snapshots }, null, 2) +
      "\n",
  );
  console.log(
    `Original Muse lifecycle: ${cases.length} scenarios, ${snapshots} state/credit/timing snapshots passed`,
  );
} finally {
  await f?.cleanup();
  await rm(directory, { recursive: true, force: true });
}
