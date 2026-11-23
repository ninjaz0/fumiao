import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { Postgres } from "@fumiao/platform/db.js";
import { archiveEntry } from "@fumiao/original-api/library.js";
import { libraryBulkFixture } from "../helpers/library-bulk.js";

const url = process.env.TEST_DATABASE_URL;
assert(
  url,
  "Set TEST_DATABASE_URL to local UTF-8 PostgreSQL with pg_stat_statements preloaded",
);
const db = new Postgres(url);
const iterations = Number(process.env.BENCH_ITERATIONS ?? 30);
assert(Number.isSafeInteger(iterations) && iterations > 0);
const stats = async () =>
  Number(
    (
      await db.query(
        `SELECT coalesce(sum(calls),0) AS calls FROM pg_stat_statements WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database()) AND query NOT LIKE '%pg_stat_statements%'`,
      )
    ).rows[0].calls,
  );
const percentile = (samples: number[], p: number) =>
  [...samples]
    .sort((a, b) => a - b)
    [Math.ceil(samples.length * p) - 1].toFixed(2);
try {
  await stats();
  const f = await libraryBulkFixture();
  try {
    const rows = [];
    for (const kind of ["ref", "job"] as const) {
      for (const size of [1, 200]) {
        const keys =
          kind === "ref"
            ? f.refs.slice(0, size).map((a) => `asset:${a.public_id}`)
            : f.jobs.slice(0, size).map((j) => `job:${j.row.public_id}`);
        const manifest =
          kind === "ref"
            ? f.refs
                .slice(0, size)
                .map((a, i) =>
                  archiveEntry(
                    a,
                    `${String(i + 1).padStart(3, "0")}-素材-${a.public_id.slice(0, 12)}`,
                  ),
                )
            : f.jobs
                .slice(0, size)
                .map((j, i) =>
                  archiveEntry(
                    j.output,
                    `${String(i + 1).padStart(3, "0")}-图片-${j.row.public_id}`,
                  ),
                );
        await f.verify(keys, [...keys].reverse(), manifest);
        for (const action of ["download", "favorite", "unfavorite"] as const) {
          const run = () =>
            action === "download"
              ? f.library.prepareDownload(f.admin, { keys })
              : f.library.changeFavorites(f.admin, {
                  keys,
                  favorite: action === "favorite",
                });
          const reset = () =>
            action === "download"
              ? Promise.resolve()
              : f.library.changeFavorites(f.admin, {
                  keys,
                  favorite: action !== "favorite",
                });
          for (let i = 0; i < 5; i++) {
            await reset();
            await run();
          }
          await reset();
          const before = await stats();
          await run();
          const statements = (await stats()) - before;
          const samples = [];
          for (let i = 0; i < iterations; i++) {
            await reset();
            const start = performance.now();
            await run();
            samples.push(performance.now() - start);
          }
          rows.push({
            kind,
            size,
            action,
            statements,
            "p50 ms": percentile(samples, 0.5),
            "p95 ms": percentile(samples, 0.95),
          });
        }
        await f.library.changeFavorites(f.admin, { keys, favorite: false });
      }
    }
    console.log(
      `Direct library calls; 5 warmups, ${iterations} samples; equality checks passed (favorites order and ticket manifest)`,
    );
    console.table(rows);
  } finally {
    await f.cleanup();
  }
} finally {
  await db.close();
}
