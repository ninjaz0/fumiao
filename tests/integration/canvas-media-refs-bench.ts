import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createOriginalApp } from "../../apps/api/src/original.js";
import { Postgres } from "../../packages/platform/src/db.js";
import { canvasesFixture } from "../helpers/canvases.js";

const sizes = [0, 1, 10, 50, 200];
const warmups = 20;
const iterations = Number(process.env.BENCH_ITERATIONS ?? 100);
assert(Number.isSafeInteger(iterations) && iterations > 0);
type Counts = { total: number; media: number };
const url = process.env.TEST_DATABASE_URL;
assert(
  url,
  "Set TEST_DATABASE_URL to a dedicated local PostgreSQL benchmark database",
);
const db = new Postgres(url);
const stats = () =>
  db
    .query<Counts>(
      `
    SELECT coalesce(sum(calls),0)::int AS total,
           coalesce(sum(calls) FILTER (WHERE query ~* '^((DELETE FROM|INSERT INTO) (canvas_media_refs|document_assets)|SELECT id FROM assets WHERE public_id[[:space:]]*=\\$[0-9]+$|WITH inserted_refs)'),0)::int AS media
    FROM pg_stat_statements
    WHERE dbid = (SELECT oid FROM pg_database WHERE datname=current_database())
      AND query NOT LIKE '%FROM pg_stat_statements%'
  `,
    )
    .then(({ rows }) => rows[0]);
const percentile = (samples: number[], p: number) =>
  [...samples]
    .sort((a, b) => a - b)
    [Math.ceil(samples.length * p) - 1].toFixed(2);

try {
  await stats();
  const f = await canvasesFixture();
  let app: Awaited<ReturnType<typeof createOriginalApp>> | undefined;
  try {
    const mediaIds: string[] = [];
    for (let i = 0; i < Math.max(...sizes); i++) {
      const asset = await f.asset(i.toString(16).padStart(32, "0"));
      mediaIds.push(asset.public_id);
    }
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
    const headers = { Cookie: cookie, "Content-Type": "application/json" };
    const cases = await Promise.all(
      sizes.map(async (refs) => {
        const canvas = await f.canvases.create(f.admin, { title: "Benchmark" });
        const document = {
          nodes: mediaIds.slice(0, refs).map((media_id, i) => ({
            id: `image-${i}`,
            type: "image",
            x: 0,
            y: 0,
            media_id,
          })),
        };
        return {
          refs,
          canvas,
          document,
          revision: canvas.revision,
          samples: [] as number[],
          counts: { total: 0, media: 0 },
        };
      }),
    );
    const save = async (item: (typeof cases)[number]) => {
      const body = JSON.stringify({
        expected_revision: item.revision,
        title: item.canvas.title,
        document: item.document,
      });
      const start = performance.now();
      const response = await fetch(
        `${origin}/api/canvases/${item.canvas.id}/document`,
        {
          method: "PUT",
          headers,
          body,
        },
      );
      const result = await response.json();
      const elapsed = performance.now() - start;
      assert.equal(response.status, 200, JSON.stringify(result));
      assert.equal(result.revision, ++item.revision);
      assert.equal(result.document.nodes.length, item.refs);
      return elapsed;
    };
    for (let i = 0; i < warmups; i++)
      for (const item of cases) await save(item);
    for (const item of cases) {
      const before = await stats();
      await save(item);
      const after = await stats();
      item.counts = {
        total: after.total - before.total,
        media: after.media - before.media,
      };
    }
    for (let i = 0; i < iterations; i++)
      for (let j = 0; j < cases.length; j++) {
        const item = cases[(i + j) % cases.length];
        item.samples.push(await save(item));
      }
    console.log(
      `Authenticated loopback HTTP PUT; ${warmups} warmups and ${iterations} timed saves per size`,
    );
    console.table(
      cases.map(({ refs, samples, counts }) => ({
        refs,
        ...counts,
        "p50 ms": percentile(samples, 0.5),
        "p95 ms": percentile(samples, 0.95),
      })),
    );
  } finally {
    await app?.close();
    await f.cleanup();
  }
} finally {
  await db.close();
}
