import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { forecastQueue } from "../packages/platform/src/queue.js";
import { roundHundredths } from "../packages/platform/src/queue-math.js";
import { Estimator, type Run } from "../packages/platform/src/timing-math.js";
import { gpuQueue } from "../plugins/gpu/src/queue.js";
import { museQueue } from "../plugins/muse/src/queue.js";
import { flowQueue } from "../plugins/flow/src/queue.js";
import { imagesQueue } from "../plugins/images/src/queue.js";
import type { TimingFeatures } from "../packages/plugin-sdk/src/index.js";
const directory = await mkdtemp(join(tmpdir(), "fumiao-queue-")),
  failures: string[] = [];
try {
  // Pure copies metadata from the first member of a frozenset when merging
  // cache modes. That order varies by interpreter hash seed. Compare complete
  // snapshots against actual untouched Python outputs, never drop fields from
  // the candidate equality check or substitute a mocked reference algorithm.
  const seeds = ["0", "1", "2", "3", "4", "5", "6", "7"],
    oracles = [];
  for (const seed of seeds) {
    execFileSync(
      resolve(".runtime-advanced/original/.venv/bin/python"),
      ["scripts/queue-fixtures.py", directory],
      { stdio: "pipe", env: { ...process.env, PYTHONHASHSEED: seed } },
    );
    oracles.push(
      JSON.parse(await readFile(join(directory, "queue.json"), "utf8")),
    );
  }
  const { cases, rounds } = oracles[0],
    variableCases: string[] = [];
  const stableFields = (value: any) =>
    JSON.parse(
      JSON.stringify(value, (key, v) =>
        ["samples", "confidence", "source"].includes(key) ? undefined : v,
      ),
    );
  const plugins = [gpuQueue, imagesQueue, museQueue, flowQueue];
  let jobs = 0;
  for (const c of cases) {
    const before = JSON.stringify(c),
      actual: Record<string, any> = {};
    for (const plugin of plugins) {
      const owned = c.jobs.filter((j: any) =>
        plugin.manifest.models.some((m) => m.id === j.model),
      );
      const context = {
        jobs: owned,
        nodes: c.nodes,
        runs: c.runs,
        history: c.history,
        stamp: c.stamp,
        health:
          plugin === museQueue ? c.muse : plugin === flowQueue ? c.flow : {},
        imageEnabled: c.imageEnabled,
      };
      const runs = Object.fromEntries(
        Object.entries(c.runs).map(([key, r]: [string, any]) => [
          key,
          { ...r, node: r.node === null ? null : String(r.node) },
        ]),
      );
      const estimator = {
        policy: plugin.manifest.timing!,
        estimate: (f: TimingFeatures, node: string | null = null) => {
          const key = node ?? "None",
            entry = Object.hasOwn(c.costs, key) ? c.costs[key] : c.costs["*"];
          const value =
            typeof entry === "object" && entry !== null
              ? "cold" in entry
                ? entry[f.cold ? "cold" : "warm"]
                : entry[String(f.seconds)]
              : entry;
          return value == null
            ? { source: "none", samples: 0 }
            : {
                source: "history",
                samples: 8,
                confidence: "medium",
                low: value,
                median: value,
                high: value,
              };
        },
      };
      const measured = new Estimator(
        c.history.map((r: any) => ({
          ...r,
          node: r.node === null ? null : String(r.node),
        })) as Run[],
        plugin.manifest.timing!,
      );
      Object.assign(
        actual,
        forecastQueue(
          plugin,
          context,
          runs,
          c.historical ? measured : estimator,
        ),
      );
    }
    jobs += Object.keys(actual).length;
    try {
      const variants: Record<string, any>[] = oracles.map(
        (o) => o.cases.find((v: any) => v.name === c.name).expected,
      );
      for (const variant of variants)
        assert.deepEqual(
          stableFields(variant),
          stableFields(c.expected),
          "reference hash seed changed scheduling or numeric predictions",
        );
      if (
        variants.some((v) => JSON.stringify(v) !== JSON.stringify(c.expected))
      )
        variableCases.push(c.name);
      const value = JSON.parse(JSON.stringify(actual));
      let matched = false;
      for (const variant of variants)
        try {
          assert.deepEqual(value, variant);
          matched = true;
          break;
        } catch {}
      if (!matched) assert.deepEqual(value, c.expected);
      assert.equal(
        JSON.stringify(c),
        before,
        "planner mutated its input snapshot",
      );
    } catch (e) {
      failures.push(c.name + ": " + String(e));
    }
  }
  for (const r of rounds)
    try {
      assert.equal(roundHundredths(r.value), r.expected);
    } catch (e) {
      failures.push("round " + r.value + ": " + String(e));
    }
  const report = {
    passed: !failures.length,
    scenarios: cases.length,
    jobs,
    rounding: rounds.length,
    referenceHashSeeds: seeds,
    variableMetadataCases: variableCases,
    failures,
  };
  await mkdir(".runtime-advanced/queue-parity", { recursive: true });
  await writeFile(
    ".runtime-advanced/queue-parity/report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
