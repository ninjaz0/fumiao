import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createOriginalApp } from "../../apps/api/src/original.js";
import { Postgres } from "../../packages/platform/src/db.js";
import { canvasesFixture } from "../helpers/canvases.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const outputDirectory = process.argv[2];
assert(
  databaseUrl && outputDirectory,
  "Set TEST_DATABASE_URL to an idle, dedicated PostgreSQL database with pg_stat_statements enabled and pass an existing output directory.",
);
process.env.FUMIAO_PAYMENT_AUTOSTART = "0";

const stats = new Postgres(databaseUrl);
const fixture = await canvasesFixture();
const app = await createOriginalApp(fixture.p);
try {
  await app.listen(0, "127.0.0.1");
  const url = await app.getUrl();
  const login = await fetch(url + "/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "admin",
      password: "canvas-storage-fixture",
    }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie()[0].split(";")[0];
  await login.arrayBuffer();
  async function list() {
    const response = await fetch(url + "/api/canvases", {
      headers: { cookie },
    });
    assert.equal(response.status, 200);
    return Buffer.from(await response.arrayBuffer());
  }
  const statements = async () =>
    Number(
      (
        await stats.query(
          `SELECT coalesce(sum(calls),0) AS total FROM pg_stat_statements
           WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database())
             AND query NOT LIKE '%FROM pg_stat_statements%'`,
        )
      ).rows[0].total,
    );
  const still = await fixture.asset("a".repeat(32));
  const movie = await fixture.asset("b".repeat(32), "video");
  let seeded = 0;
  for (const canvases of [5, 50]) {
    while (seeded < canvases) {
      const i = ++seeded;
      fixture.setTime(1800000000 + i);
      const canvas = await fixture.canvases.create(fixture.admin, {
        title: `Benchmark canvas ${i}`,
      });
      const node = (id: string, type: string) => ({ id, type, x: 0, y: 0 });
      await fixture.canvases.save(fixture.admin, canvas.id, {
        title: canvas.title,
        expected_revision: 1,
        document: {
          nodes: [
            ...Array.from({ length: 32 }, (_, n) =>
              node(`blank-${n}`, n % 2 ? "image" : "video"),
            ),
            node("generated-image", "image"),
            node("generated-video", "video"),
            {
              ...node("pinned-image", "image"),
              use_media: true,
              media_id: still.public_id,
            },
          ],
        },
      });
      await fixture.job(i * 3 - 2, "image", "completed", still.id);
      await fixture.job(i * 3 - 1, "video", "completed", movie.id);
      await fixture.job(i * 3, "video", "queued");
      await fixture.link(canvas.id, "generated-image", i * 3 - 2);
      await fixture.link(canvas.id, "generated-video", i * 3 - 1);
      await fixture.link(canvas.id, "blank-0", i * 3);
      await fixture.db.query(
        "UPDATE documents SET public_id=$1 WHERE public_id=$2",
        [i.toString(16).padStart(32, "0"), canvas.id],
      );
    }
    const warmups = 30;
    const iterations = 100;
    const expected = await list();
    const { projects } = JSON.parse(expected.toString());
    assert.equal(projects.length, canvases);
    for (const project of projects) {
      assert.equal(project.count, 35);
      assert.deepEqual(project.covers, [
        { id: still.public_id, type: "image" },
        { id: movie.public_id, type: "video" },
        { id: still.public_id, type: "image" },
      ]);
    }
    for (let i = 0; i < warmups; i++) await list();
    const before = await statements();
    const times: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      const body = await list();
      times.push(performance.now() - start);
      assert(body.equals(expected));
    }
    const queries = (await statements()) - before;
    times.sort((a, b) => a - b);
    const percentile = (p: number) => times[Math.ceil(p * times.length) - 1];
    await writeFile(
      join(outputDirectory, `canvases-${canvases}.json`),
      expected,
    );
    console.log(
      JSON.stringify({
        canvases,
        warmups,
        iterations,
        statementsPerRequest: queries / iterations,
        p50Ms: percentile(0.5).toFixed(2),
        p95Ms: percentile(0.95).toFixed(2),
      }),
    );
  }
} finally {
  await app.close();
  await fixture.cleanup();
  await stats.close();
}
