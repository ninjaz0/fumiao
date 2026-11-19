import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { prepareNative, prepareInput } from "../plugins/gpu/src/inputs.js";
import {
  receiptReport,
  validateAudio,
  validateVideo,
} from "../plugins/gpu/src/artifacts.js";
const directory = await mkdtemp(join(tmpdir(), "fumiao-native-oracle-"));
try {
  execFileSync(
    process.env.STUDIO_PYTHON ||
      resolve(".runtime-advanced/original/.venv/bin/python"),
    ["scripts/native-fixtures.py", directory],
    { stdio: "pipe", timeout: 180000 },
  );
  const manifest = JSON.parse(
    await readFile(join(directory, "manifest.json"), "utf8"),
  );
  for (const c of manifest.inputs) {
    if (c.error)
      assert.throws(
        () => prepareInput(c.input, c.assets),
        { message: c.error },
        c.name,
      );
    else {
      assert.deepEqual(prepareNative(c.input, c.assets), c.native, c.name);
      const actual = prepareInput(c.input, c.assets);
      assert.deepEqual(
        {
          ratio: actual.params.ratio,
          w: actual.params.width,
          h: actual.params.height,
        },
        c.geometry,
        c.name + " geometry",
      );
    }
  }
  for (const c of manifest.reports)
    assert.deepEqual(receiptReport(c.raw), c.expected, c.raw);
  for (const c of manifest.media) {
    const run = async () =>
      c.kind === "audio"
        ? validateAudio(await readFile(join(directory, c.file)))
        : validateVideo(
            join(directory, c.file),
            {
              model: "MiniMax H3",
              kind: "video",
              params: c.job,
              references: [],
            },
            new AbortController().signal,
          );
    if (c.error) await assert.rejects(run, { message: c.error }, c.file);
    else {
      const r = await run();
      if (r) {
        const { mime, width, height, ...actual } = r;
        assert.deepEqual(actual, c.result, c.file);
      }
    }
  }
  await mkdir(".runtime-advanced/native-parity", { recursive: true });
  await writeFile(
    ".runtime-advanced/native-parity/report.json",
    JSON.stringify(
      {
        passed: true,
        inputCases: manifest.inputs.length,
        receiptCases: manifest.reports.length,
        mediaCases: manifest.media.length,
        clockSnapshots: manifest.clock_snapshots,
      },
      null,
      2,
    ),
  );
  console.log(
    `Original/native parity: ${manifest.inputs.length} inputs, ${manifest.reports.length} receipts, ${manifest.media.length} artifacts and ${manifest.clock_snapshots} worker clock snapshots passed`,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
