import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { imageSettingsFixture } from "../tests/helpers/image-settings.js";
import { one } from "../packages/platform/src/db.js";
const directory = await mkdtemp(
  join(tmpdir(), "fumiao-image-settings-oracle-"),
);
let f: Awaited<ReturnType<typeof imageSettingsFixture>> | undefined;
try {
  execFileSync(
    process.env.STUDIO_PYTHON ||
      resolve(".runtime-advanced/original/.venv/bin/python"),
    ["scripts/image-settings-fixtures.py", directory],
    { stdio: "pipe", timeout: 180000 },
  );
  const data = JSON.parse(
      await readFile(join(directory, "manifest.json"), "utf8"),
    ),
    failures: any[] = [];
  f = await imageSettingsFixture();
  const hidden = (
    await f.db.query("SELECT id FROM studio_catalog WHERE hidden")
  ).rows.map((r) => r.id);
  for (const c of data.cases) {
    f.requests.length = 0;
    f.setWire(c.wire ?? { raw: "{}" });
    await f.db.query("UPDATE studio_policy SET flags=$1,revision=$2", [
      JSON.stringify(data.initial.enabled),
      data.initial.revision,
    ]);
    await f.db.query("UPDATE original_state_settings SET image_enabled=true");
    await f.db.query("UPDATE studio_catalog SET hidden=id=ANY($1::text[])", [
      [...hidden, ...(c.hidden ?? [])],
    ]);
    await f.db.query("UPDATE connections SET config=$1 WHERE id=$2", [
      f.p.vault.seal({
        ...f.config,
        apiKey: c.configured === false ? "invalid" : f.config.apiKey,
      }),
      f.connection,
    ]);
    const actual = await f.request(
        c.method,
        c.path,
        c.body,
        c.actor ?? 0,
        c.origin,
      ),
      policy = await f.catalog.policy(),
      enabled: boolean = (
        await one(f.db, "SELECT image_enabled FROM original_state_settings")
      ).image_enabled;
    try {
      assert.deepEqual(actual, c.expected, c.name);
      assert.deepEqual(policy, c.policy, c.name + " policy");
      assert.equal(enabled, c.enabled, c.name + " global images");
      assert.deepEqual(f.requests, c.requests, c.name + " provider calls");
    } catch (error) {
      failures.push({
        name: c.name,
        error: String(error),
        actual,
        expected: c.expected,
      });
    }
  }
  await mkdir(".runtime-advanced/image-settings-parity", { recursive: true });
  const report = {
    passed: !failures.length,
    scenarios: data.cases.length,
    failures,
  };
  await writeFile(
    ".runtime-advanced/image-settings-parity/report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  assert.equal(failures.length, 0, JSON.stringify(failures, null, 2));
  console.log("Original image settings HTTP parity: " + JSON.stringify(report));
} finally {
  await f?.cleanup();
  await rm(directory, { recursive: true, force: true });
}
