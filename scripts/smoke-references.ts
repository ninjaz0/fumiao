/** Exact H3 conversion metadata and bytes against the pinned, unmodified Pure code. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { normalizeReference } from "../plugins/gpu/src/reference-media.js";
import { roundDecimal } from "../packages/plugin-sdk/src/decimal.js";
const directory = await mkdtemp(join(tmpdir(), "fumiao-reference-oracle-"));
try {
  execFileSync(
    process.env.STUDIO_PYTHON ||
      resolve(".runtime-advanced/original/.venv/bin/python"),
    ["scripts/reference-fixtures.py", directory],
    { stdio: "pipe", timeout: 180000 },
  );
  const manifest = JSON.parse(
      await readFile(join(directory, "manifest.json"), "utf8"),
    ),
    checks = [];
  for (const entry of manifest.entries) {
    const output = join(
      directory,
      `actual-${entry.name}.${entry.kind === "video" ? "mp4" : "wav"}`,
    );
    if (entry.error)
      await assert.rejects(
        normalizeReference(
          join(directory, entry.name),
          output,
          entry.kind,
          new AbortController().signal,
        ),
        { message: entry.error },
        `${entry.name} ${entry.kind}`,
      );
    else {
      const result = await normalizeReference(
        join(directory, entry.name),
        output,
        entry.kind,
        new AbortController().signal,
      );
      assert.deepEqual(
        result,
        entry.result,
        `${entry.name} ${entry.kind} metadata`,
      );
      assert.deepEqual(
        await readFile(output),
        await readFile(join(directory, entry.output)),
        `${entry.name} ${entry.kind} bytes`,
      );
    }
    checks.push({
      file: entry.name,
      kind: entry.kind,
      result: entry.result || entry.error,
    });
  }
  for (const example of manifest.rounds)
    assert.equal(
      roundDecimal(example.value, example.digits),
      example.result,
      JSON.stringify(example),
    );
  await mkdir(".runtime-advanced/reference-parity", { recursive: true });
  await writeFile(
    ".runtime-advanced/reference-parity/report.json",
    JSON.stringify(
      { passed: true, checks, decimalChecks: manifest.rounds.length },
      null,
      2,
    ),
  );
  console.log(
    `Original/plugin reference parity: ${checks.length} codec cases and ${manifest.rounds.length} decimal checks passed`,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
