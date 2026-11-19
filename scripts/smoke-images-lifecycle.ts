import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  imagesLifecycleFixture,
  imagesModel,
} from "../tests/helpers/images-lifecycle.js";
import { one } from "../packages/platform/src/db.js";
const directory = await mkdtemp(join(tmpdir(), "fumiao-images-lifecycle-"));
let f: Awaited<ReturnType<typeof imagesLifecycleFixture>> | undefined;
try {
  execFileSync(
    process.env.STUDIO_PYTHON ||
      resolve(".runtime-advanced/original/.venv/bin/python"),
    ["scripts/images-lifecycle-fixtures.py", directory],
    { stdio: "pipe", timeout: 180000 },
  );
  const data = JSON.parse(
      await readFile(join(directory, "manifest.json"), "utf8"),
    ),
    failures: any[] = [];
  f = await imagesLifecycleFixture();
  for (const c of data.cases) {
    f.requests.length = 0;
    const wire = { ...c.wire };
    if (wire.file)
      wire.raw = JSON.stringify({
        data: [
          {
            b64_json: (await readFile(join(directory, wire.file))).toString(
              "base64",
            ),
          },
        ],
        usage: wire.usage === undefined ? {} : wire.usage,
      });
    f.setWire(wire);
    await f.db.query("UPDATE wallets SET balance=10000 WHERE workspace_id=$1", [
      f.wid,
    ]);
    const j = await f.create(imagesModel),
      references: string[] = c.missing
        ? ["00000000-0000-4000-8000-000000000000"]
        : [];
    for (const mime of c.refs) {
      const id = await f.reference(mime);
      references.push(id);
      if (c.readFailure)
        await f.p.storage.remove(
          (await one(f.db, "SELECT object_key FROM assets WHERE id=$1", [id]))
            .object_key,
        );
    }
    await f.db.query("UPDATE jobs SET input=$2 WHERE id=$1", [
      j.id,
      JSON.stringify({
        ...j.input,
        prompt: c.prompt,
        params: {
          size: "1536x864",
          quality: "medium",
          safety_identifier: c.safety,
        },
        references,
      }),
    ]);
    await f.executor.execute(j.id);
    const actual = await f.snapshot(j.id),
      expected = c.expected;
    if (expected.providerResponse)
      expected.providerResponse.usageJson = JSON.stringify(
        JSON.parse(expected.providerResponse.usageJson),
      );
    try {
      assert.deepEqual(actual, expected, c.name);
      assert.deepEqual(f.requests, c.requests, c.name + " request");
      if (c.wire.file && actual.output) {
        const output = await one(
          f.db,
          "SELECT a.object_key FROM assets a JOIN job_assets ja ON ja.asset_id=a.id WHERE ja.job_id=$1 AND ja.role='output'",
          [j.id],
        );
        assert.deepEqual(
          Buffer.from(await f.p.storage.read(output.object_key)),
          await readFile(join(directory, c.wire.file)),
          c.name + " original bytes",
        );
      }
    } catch (error) {
      failures.push({ name: c.name, error: String(error), actual, expected });
    }
    if (c.missing)
      await f.p.db.transaction(async (sql) =>
        f!.p.settle(
          sql,
          await one(sql, "SELECT * FROM jobs WHERE id=$1 FOR UPDATE", [j.id]),
          "cancelled",
        ),
      );
  }
  await mkdir(".runtime-advanced/images-lifecycle-parity", { recursive: true });
  const report = {
    passed: !failures.length,
    scenarios: data.cases.length,
    imageFiles: data.imageFiles,
    failures,
  };
  await writeFile(
    ".runtime-advanced/images-lifecycle-parity/report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  assert.equal(failures.length, 0, JSON.stringify(failures, null, 2));
  console.log("Original image lifecycle parity: " + JSON.stringify(report));
} finally {
  await f?.cleanup();
  await rm(directory, { recursive: true, force: true });
}
