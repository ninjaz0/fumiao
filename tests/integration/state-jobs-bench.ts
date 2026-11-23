import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { writeFile, readFile } from "node:fs/promises";
import { createOriginalApp } from "../../apps/api/src/original.js";
import { Postgres } from "@fumiao/platform/db.js";
import { stateJobsFixture } from "../helpers/state-jobs.js";

const url = process.env.TEST_DATABASE_URL;
assert(
  url,
  "Set TEST_DATABASE_URL to a dedicated local PostgreSQL database with pg_stat_statements",
);
const iterations = Number(process.env.BENCH_ITERATIONS ?? 100);
assert(Number.isSafeInteger(iterations) && iterations > 0);
const warmups = 20;
const db = new Postgres(url);
const stats = async () =>
  (
    await db.query(`SELECT
  coalesce(sum(calls),0)::int AS statements, coalesce(sum(rows),0)::int AS rows
  FROM pg_stat_statements
  WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database())
    AND query LIKE 'SELECT j.%' AND query LIKE '%AS remote_studio%'
     OR (dbid=(SELECT oid FROM pg_database WHERE datname=current_database())
       AND query LIKE 'SELECT j.id,j.provider_model,j.connection_id,j.kind,%')`)
  ).rows[0];
const percentile = (values: number[], p: number) =>
  [...values]
    .sort((a, b) => a - b)
    [Math.ceil(values.length * p) - 1].toFixed(2);
try {
  await stats();
  const f = await stateJobsFixture();
  let app: Awaited<ReturnType<typeof createOriginalApp>> | undefined;
  try {
    const foreign = await f.job(1, "completed", true);
    await f.job(2, "queued", true);
    await f.job(3);
    await f.job(4, "completed");
    await f.db.query("DELETE FROM jobs WHERE id=$1", [foreign.id]);
    app = await createOriginalApp(f.p);
    await app.listen(0, "127.0.0.1");
    const origin = await app.getUrl();
    const login = await fetch(origin + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "admin",
        password: "canvas-storage-fixture",
      }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie()[0].split(";")[0];
    await login.arrayBuffer();
    const snapshots: string[] = [];
    const read = async () => {
      const start = performance.now();
      const response = await fetch(origin + "/api/state", {
        headers: { Cookie: cookie },
      });
      const body = await response.text();
      assert.equal(response.status, 200, body);
      return { elapsed: performance.now() - start, body };
    };
    console.log(
      `Authenticated loopback HTTP GET /api/state; ${warmups} warmups, ${iterations} samples per size`,
    );
    console.log(
      "| Foreign terminal jobs | p50 ms | p95 ms | Jobs rows returned/poll | Jobs statements/poll |",
    );
    console.log("| ---: | ---: | ---: | ---: | ---: |");
    let previous = 0;
    for (const size of [0, 1000, 10000]) {
      if (size > previous) {
        const template = await f.job(100000, "completed", true);
        await f.db.query(
          `INSERT INTO jobs(id,public_id,workspace_id,owner_id,model_id,connection_id,
          plugin_id,plugin_version,config_snapshot,provider_model,kind,input,idempotency_key,
          request_hash,price,state,original_view,created_at)
          SELECT gen_random_uuid(),100+n,workspace_id,owner_id,model_id,connection_id,
          plugin_id,plugin_version,config_snapshot,provider_model,kind,input,n::text,
          request_hash,price,CASE n%3 WHEN 0 THEN 'completed' WHEN 1 THEN 'failed' ELSE 'cancelled' END,
        original_view,created_at FROM jobs CROSS JOIN generate_series($2::int,$3::int) n WHERE id=$1`,
          [template.id, previous + 1, size],
        );
        await f.db.query("DELETE FROM jobs WHERE id=$1", [template.id]);
      }
      await f.db.query("ANALYZE jobs");
      for (let i = 0; i < warmups; i++) await read();
      const snapshot = JSON.parse((await read()).body);
      delete snapshot.server_time;
      delete snapshot.disk_free;
      snapshots.push(JSON.stringify(snapshot));
      const before = await stats();
      const samples: number[] = [];
      for (let i = 0; i < iterations; i++) samples.push((await read()).elapsed);
      const after = await stats();
      console.log(
        `| ${size} | ${percentile(samples, 0.5)} | ${percentile(samples, 0.95)} | ${(after.rows - before.rows) / iterations} | ${(after.statements - before.statements) / iterations} |`,
      );
      previous = size;
    }
    const output = JSON.stringify(snapshots, null, 2) + "\n";
    if (process.env.BENCH_COMPARE) {
      assert.equal(output, await readFile(process.env.BENCH_COMPARE, "utf8"));
      console.log(
        "Byte comparison: identical at all 3 sizes (only server_time/disk_free removed)",
      );
    }
    if (process.env.BENCH_OUTPUT)
      await writeFile(process.env.BENCH_OUTPUT, output);
  } finally {
    await app?.close();
    await f.cleanup();
  }
} finally {
  await db.close();
}
