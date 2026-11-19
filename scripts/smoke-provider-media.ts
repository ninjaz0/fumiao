import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { museArtifacts } from "../plugins/muse/src/artifacts.js";
import { flowArtifacts } from "../plugins/flow/src/artifacts.js";
const directory = await mkdtemp(
  join(tmpdir(), "fumiao-provider-media-oracle-"),
);
try {
  execFileSync(
    process.env.STUDIO_PYTHON ||
      resolve(".runtime-advanced/original/.venv/bin/python"),
    ["scripts/provider-media-fixtures.py", directory],
    { stdio: "pipe", timeout: 180000 },
  );
  const cases = JSON.parse(
      await readFile(join(directory, "manifest.json"), "utf8"),
    ),
    failures = [];
  let checks = 0;
  for (const c of cases) {
    const data = await readFile(join(directory, c.file)),
      before = Buffer.from(data);
    for (const plugin of [museArtifacts, flowArtifacts])
      for (const recovering of [false, true]) {
        const job = {
            kind: c.kind,
            model: plugin.manifest.id,
            params: {},
            references: [],
            recovering,
          },
          run = () =>
            plugin.validateArtifact!(
              job,
              data,
              {},
              new AbortController().signal,
              async () => {},
            );
        try {
          if (c.failure) {
            const expected =
              plugin === museArtifacts
                ? c.failure.value
                  ? c.failure.message
                  : "Muse 成品保存失败，请检查后重新生成"
                : recovering
                  ? "Flow 成品保存失败，请从后台检查生成结果"
                  : c.failure.value
                    ? c.failure.message.replaceAll("Muse", "Flow")
                    : "Flow 生成或保存失败，请从后台检查结果后重试";
            await assert.rejects(run, { message: expected }, c.file);
          } else assert.deepEqual((await run()).metadata, c.metadata, c.file);
          assert.deepEqual(data, before, "media bytes must remain unchanged");
          checks++;
        } catch (error) {
          failures.push({
            file: c.file,
            provider: plugin.manifest.id,
            recovering,
            error: String(error),
          });
        }
      }
  }
  await mkdir(".runtime-advanced/provider-media-parity", { recursive: true });
  await writeFile(
    ".runtime-advanced/provider-media-parity/report.json",
    JSON.stringify(
      { passed: !failures.length, files: cases.length, checks, failures },
      null,
      2,
    ) + "\n",
  );
  assert.equal(failures.length, 0, JSON.stringify(failures, null, 2));
  console.log(
    `Original/provider media parity: ${cases.length} files, ${checks} validation and error cases passed`,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
