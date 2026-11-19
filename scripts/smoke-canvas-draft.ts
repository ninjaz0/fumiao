import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  parseCanvasSave,
  canvasNewFields,
  canvasRevisionFields,
  canvasRunFields,
  canvasCandidatesFields,
} from "../packages/original-api/src/canvas-draft.js";
import {
  parseBody,
  ValidationError,
} from "../packages/original-api/src/validation.js";
const directory = await mkdtemp(join(tmpdir(), "fumiao-canvas-draft-"));
try {
  execFileSync(
    process.env.STUDIO_PYTHON ||
      resolve(".runtime-advanced/original/.venv/bin/python"),
    ["scripts/canvas-draft-fixtures.py", directory],
    { stdio: "pipe", timeout: 180000 },
  );
  const cases = JSON.parse(
      await readFile(join(directory, "manifest.json"), "utf8"),
    ),
    failures: any[] = [];
  for (const c of cases) {
    let status = 200,
      value: unknown;
    try {
      value =
        c.kind === "save"
          ? parseCanvasSave(c.value)
          : parseBody(
              c.value,
              (
                {
                  new: canvasNewFields,
                  revision: canvasRevisionFields,
                  run: canvasRunFields,
                  candidate: canvasCandidatesFields,
                } as any
              )[c.kind],
              true,
            );
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      status = error.status;
      value = { detail: error.detail };
    }
    try {
      assert.equal(status, c.status);
      assert.deepEqual(value, c.expected);
    } catch (error) {
      failures.push({ name: c.name, error: String(error).slice(0, 6000) });
    }
  }
  const report = {
    passed: !failures.length,
    scenarios: cases.length,
    failures,
  };
  await mkdir(".runtime-advanced/canvas-draft-parity", { recursive: true });
  await writeFile(
    ".runtime-advanced/canvas-draft-parity/report.json",
    JSON.stringify(report, null, 2),
  );
  console.log("Original canvas draft parity:", JSON.stringify(report));
  if (failures.length) process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
