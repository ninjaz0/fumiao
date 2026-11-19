import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  Estimator,
  elapsedDetail,
  remaining,
  planningPrediction,
} from "../packages/platform/src/timing-math.js";
import { timingFeaturesSchema } from "../packages/plugin-sdk/src/timing.js";
import { imagesTiming } from "../plugins/images/src/timing.js";
import { museTiming } from "../plugins/muse/src/timing.js";
import { flowTiming } from "../plugins/flow/src/timing.js";
import { gpuTiming } from "../plugins/gpu/src/timing.js";
import { randomUUID } from "node:crypto";
import { timingFixture } from "../tests/helpers/timing.js";
import { JobTiming } from "../packages/platform/src/timing.js";
import { one } from "../packages/platform/src/db.js";
const directory = await mkdtemp(join(tmpdir(), "fumiao-timing-")),
  failures: string[] = [];
try {
  execFileSync(
    resolve(".runtime-advanced/original/.venv/bin/python"),
    ["scripts/timing-fixtures.py", directory],
    { stdio: "pipe" },
  );
  const { cases, features, lifecycle } = JSON.parse(
    await readFile(join(directory, "manifest.json"), "utf8"),
  );
  execFileSync(
    resolve(".runtime-advanced/original/.venv/bin/python"),
    [
      "scripts/export-legacy.py",
      "--database",
      join(directory, "timing.sqlite"),
      "--output",
      join(directory, "export.json"),
      "--source",
      "timing-fixture",
    ],
    { stdio: "pipe" },
  );
  const exported = await readFile(join(directory, "export.json"), "utf8"),
    archive = JSON.parse(exported);
  assert.equal(archive.tables.job_runs.length, 2);
  assert.ok(archive.tables.job_runs.every((r: any) => !("run_key" in r)));
  assert.ok(!exported.includes("secret-sentinel"));
  assert.throws(
    () =>
      execFileSync(
        resolve(".runtime-advanced/original/.venv/bin/python"),
        [
          "scripts/export-legacy.py",
          "--database",
          join(directory, "active.sqlite"),
          "--output",
          join(directory, "active-export.json"),
          "--source",
          "timing-fixture",
        ],
        { stdio: "pipe" },
      ),
    /尚有未结算任务/,
  );
  for (const c of cases) {
    const actual =
      c.operation === "estimate"
        ? new Estimator(c.samples, c.policy).estimate(c.target, c.node)
        : c.operation === "remaining"
          ? remaining(c.run, c.stamp)
          : c.operation === "elapsed"
            ? elapsedDetail(c.run, c.stamp)
            : planningPrediction(
                new Estimator(c.samples, c.policy),
                c.target,
                c.node,
                c.runs,
                c.stamp,
              );
    try {
      assert.deepEqual(actual, c.expected);
    } catch (e) {
      failures.push(c.name + ": " + String(e));
    }
  }
  const plugins = [imagesTiming, museTiming, flowTiming, gpuTiming];
  for (const f of features) {
    const plugin = plugins.find((p) =>
      p.manifest.models.some((m) => m.id === f.context.model),
    )!;
    try {
      assert.deepEqual(
        timingFeaturesSchema.parse(plugin.timingFeatures!(f.context)),
        f.expected,
      );
    } catch (e) {
      failures.push("features " + f.context.model + ": " + String(e));
    }
  }
  const fixture = await timingFixture();
  let lifecycleStates = 0;
  try {
    const t = new JobTiming(fixture.p);
    for (const c of lifecycle) {
      const job = await fixture.create();
      job.created_at = new Date(1000000);
      job.lease_token = randomUUID();
      // Keep each sequence's history isolated, just like the Python oracle.
      await fixture.db.query("DELETE FROM job_runs");
      for (let i = 0; i < c.actions.length; i++) {
        const [op, stamp, arg] = c.actions[i];
        await fixture.db.transaction(async (sql) => {
          await one(sql, "SELECT id FROM jobs WHERE id=$1 FOR UPDATE", [
            job.id,
          ]);
          if (op === "start") {
            await t.start(sql, job, job.state === "queued", c.node, stamp);
            job.state = "running";
          } else if (op === "observe") await t.observe(sql, job.id, arg, stamp);
          else if (op === "phase") await t.phase(sql, job.id, arg, stamp);
          else if (op === "end") {
            await t.end(sql, job, arg, stamp);
            job.state = arg;
          } else if (op === "queue") {
            job.state = "queued";
            job.lease_token = randomUUID();
          }
        });
        const actual = (
          await fixture.db.query(
            "SELECT * FROM job_runs WHERE job=$1 ORDER BY id",
            [job.id],
          )
        ).rows.map((r) => {
          for (const key of [
            "id",
            "job",
            "run_key",
            "node",
            "kind",
            "model",
            "plugin_id",
            "plugin_version",
            "policy",
          ])
            delete r[key];
          return r;
        });
        lifecycleStates++;
        try {
          assert.deepEqual(actual, c.snapshots[i]);
        } catch (e) {
          failures.push("lifecycle " + c.name + " " + i + ": " + String(e));
        }
      }
    }
  } finally {
    await fixture.cleanup();
  }
  const report = {
    passed: !failures.length,
    math: cases.length,
    features: features.length,
    lifecycleStates,
    failures,
  };
  await mkdir(".runtime-advanced/timing-parity", { recursive: true });
  await writeFile(
    ".runtime-advanced/timing-parity/report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
