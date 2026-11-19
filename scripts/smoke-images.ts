import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { convertImage } from "../packages/image-import/src/convert.js";
const directory = await mkdtemp(join(tmpdir(), "fumiao-images-"));
const failures: string[] = [],
  checks: any[] = [];
try {
  execFileSync(
    resolve(".runtime-advanced/original/.venv/bin/python"),
    ["scripts/image-fixtures.py", directory],
    { stdio: "pipe" },
  );
  const manifest = JSON.parse(
    await readFile(join(directory, "manifest.json"), "utf8"),
  );
  await mkdir(join(directory, "actual"));
  for (const entry of manifest)
    for (const mode of ["reference", "avatar"] as const) {
      const target = join(directory, "actual", entry.name + "-" + mode),
        expected = entry[mode];
      try {
        const result = await convertImage(
          join(directory, entry.name),
          target,
          mode,
        );
        if (!expected.ok) {
          failures.push(
            `${entry.name} ${mode}: accepted, expected ${expected.error}`,
          );
          continue;
        }
        if (mode === "reference")
          for (const key of [
            "w",
            "h",
            "mime",
            "source_format",
            "converted",
            "resized",
            "first_frame",
          ] as const)
            if (result[key] !== expected[key])
              failures.push(
                `${entry.name} ${mode}: ${key} ${result[key]} != ${expected[key]}`,
              );
        const out = await sharp(target)
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true }),
          gold =
            mode === "reference" && !result.converted
              ? await sharp(join(directory, "expected", mode, entry.name))
                  .ensureAlpha()
                  .raw()
                  .toBuffer()
              : await readFile(
                  join(directory, "expected", mode, entry.name + ".rgba"),
                );
        if (out.data.length !== gold.length) {
          failures.push(`${entry.name} ${mode}: dimensions differ`);
          continue;
        }
        let sum = 0,
          max = 0,
          n = 0;
        for (let i = 0; i < gold.length; i++) {
          const diff = Math.abs(gold[i] - out.data[i]);
          sum += diff;
          max = Math.max(max, diff);
          if (diff) n++;
        }
        const exact = !(await readFile(target)).compare(
          await readFile(join(directory, "expected", mode, entry.name)),
        );
        checks.push({
          name: entry.name,
          mode,
          exact,
          mean: sum / gold.length,
          max,
          pixels: n,
        });
        if (mode === "reference" && !result.converted && !exact)
          failures.push(`${entry.name}: passthrough changed bytes`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (expected.ok || message !== expected.error)
          failures.push(
            `${entry.name} ${mode}: ${message}, expected ${expected.ok ? "success" : expected.error}`,
          );
        else checks.push({ name: entry.name, mode, error: message });
      }
    }
  await mkdir(".runtime-advanced/image-parity", { recursive: true });
  await writeFile(
    ".runtime-advanced/image-parity/report.json",
    JSON.stringify(
      {
        passed: !failures.length && checks.every((c) => !c.mean),
        contractsPassed: !failures.length,
        pixelExact: checks.every((c) => !c.mean),
        checks,
        failures,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        checks: checks.length,
        failures,
        pixelDifferences: checks
          .filter((c) => c.mean > 0)
          .map((c) => ({
            name: c.name,
            mode: c.mode,
            mean: c.mean,
            max: c.max,
          })),
      },
      null,
      2,
    ),
  );
  if (failures.length || checks.some((c) => c.mean > 0)) process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
