import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { timingFixture } from "../tests/helpers/timing.js";
import { JobTiming } from "../packages/platform/src/timing.js";
import {
  elapsedDetail,
  remaining,
} from "../packages/platform/src/timing-math.js";
import { museClock, museClockReport } from "../plugins/muse/src/clock.js";
import { one } from "../packages/platform/src/db.js";
const directory = await mkdtemp(join(tmpdir(), "fumiao-provider-clock-")),
  failures: string[] = [];
try {
  execFileSync(
    resolve(".runtime-advanced/original/.venv/bin/python"),
    ["scripts/provider-clock-fixtures.py", directory],
    { stdio: "pipe" },
  );
  const cases = JSON.parse(
    await readFile(join(directory, "provider-clock.json"), "utf8"),
  );
  const f = await timingFixture({
    ...museClock,
    manifest: {
      ...museClock.manifest,
      configSchema: { type: "object" },
      models: museClock.manifest.models.map(({ studio, ...m }) => m),
    },
  });
  let states = 0;
  try {
    const t = new JobTiming(f.p);
    for (const c of cases) {
      const job = await f.create("muse-video");
      job.created_at = new Date(1000000);
      job.lease_token = randomUUID();
      await f.db.query("DELETE FROM job_runs");
      await t.start(f.db, job, true, undefined, 1100);
      const keys = Object.keys(c.initial);
      await f.db.query(
        "UPDATE job_runs SET " +
          keys.map((k, i) => k + "=$" + (i + 1)).join(",") +
          ",predicted=$" +
          (keys.length + 1),
        [
          ...keys.map((k) =>
            k === "details" ? JSON.stringify(c.initial[k]) : c.initial[k],
          ),
          JSON.stringify(c.predicted),
        ],
      );
      for (let i = 0; i < c.actions.length; i++) {
        const [stamp, raw] = c.actions[i];
        await f.db.transaction(async (sql) => {
          await one(sql, "SELECT id FROM jobs WHERE id=$1 FOR UPDATE", [
            job.id,
          ]);
          await t.providerClock(sql, job.id, museClockReport(raw), stamp);
        });
        const row = (await t.current(f.db, job.id))!,
          actual = {
            record: Object.fromEntries(keys.map((k) => [k, (row as any)[k]])),
            timing: elapsedDetail(row, stamp),
            eta: remaining(row, stamp),
          };
        states++;
        try {
          assert.deepEqual(actual, c.snapshots[i]);
          assert.ok(!JSON.stringify(actual).includes("private-sentinel"));
        } catch (e) {
          failures.push(c.name + ": " + i + ": " + String(e));
        }
      }
    }
  } finally {
    await f.cleanup();
  }
  const report = {
    passed: !failures.length,
    scenarios: cases.length,
    states,
    failures,
  };
  await mkdir(".runtime-advanced/provider-clock-parity", { recursive: true });
  await writeFile(
    ".runtime-advanced/provider-clock-parity/report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
