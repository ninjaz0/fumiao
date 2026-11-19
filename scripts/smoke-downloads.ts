import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { museArtifactSource } from "../plugins/muse/src/download.js";
import { flowArtifactSource } from "../plugins/flow/src/download.js";
import { ArtifactDownloadError } from "../packages/plugin-sdk/src/index.js";

const directory = await mkdtemp(join(tmpdir(), "fumiao-download-oracle-"));
try {
  const cases = JSON.parse(
    execFileSync(
      process.env.STUDIO_PYTHON ||
        resolve(".runtime-advanced/original/.venv/bin/python"),
      ["scripts/download-fixtures.py", directory],
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
    ),
  );
  for (const c of cases) {
    let result;
    try {
      result = {
        expected: {
          ...(c.provider === "muse" ? museArtifactSource : flowArtifactSource)(
            c.url,
            c.config,
          ),
          timeout: c.provider === "muse" ? 45 : 90,
        },
      };
    } catch (error) {
      result = {
        error:
          error instanceof ArtifactDownloadError
            ? error.message
            : "Flow 生成或保存失败，请从后台检查结果后重试",
      };
    }
    assert.deepEqual(
      result,
      c.error ? { error: c.error } : { expected: c.expected },
      `${c.provider} ${c.url}`,
    );
  }
  await mkdir(".runtime-advanced/download-parity", { recursive: true });
  await writeFile(
    ".runtime-advanced/download-parity/report.json",
    JSON.stringify({ passed: true, cases: cases.length }, null, 2) + "\n",
  );
  console.log(
    `Original/provider artifact download parity: ${cases.length} URL, authorization, timeout and error cases passed`,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
