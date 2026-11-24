import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { createOriginalApp } from "../../apps/api/src/original.js";
import { Postgres } from "../../packages/platform/src/db.js";
import { canvasesFixture } from "../helpers/canvases.js";

const sizes = [1, 20, 50, 200];
const warmups = 20;
type ExportCase = {
  shots: number;
  id: string;
  revision: number;
  samples: number[];
  statements: number;
};
const iterations = Number(process.env.BENCH_ITERATIONS ?? 100);
assert(Number.isSafeInteger(iterations) && iterations > 0);
const [mode, directory] = process.argv.slice(2);
assert(
  (mode === "record" || mode === "compare") && directory,
  "Usage: tsx tests/integration/shot-pack-bench.ts <record|compare> <existing output directory>",
);
const url = process.env.TEST_DATABASE_URL;
assert(url, "Use a dedicated local TEST_DATABASE_URL with pg_stat_statements");
const db = new Postgres(url);
const statistics = async () =>
  (
    await db.query<{ calls: number }>(
      `SELECT coalesce(sum(calls),0)::int AS calls FROM pg_stat_statements
      WHERE dbid = (SELECT oid FROM pg_database WHERE datname=current_database())
        AND query NOT LIKE '%FROM pg_stat_statements%'`,
    )
  ).rows[0].calls;
const percentile = (samples: number[], p: number) =>
  [...samples]
    .sort((a, b) => a - b)
    [Math.ceil(samples.length * p) - 1].toFixed(2);

try {
  await statistics();
  const f = await canvasesFixture();
  let app: Awaited<ReturnType<typeof createOriginalApp>> | undefined;
  try {
    const sources = [];
    for (let i = 0; i < Math.max(...sizes); i++) {
      const key = (i + 1).toString(16).padStart(32, "0");
      const video = await f.asset(key, "video", f.team, f.member);
      const bytes = Buffer.from(`shot fixture ${i}\n`);
      await f.p.storage.put(key, bytes, video.mime);
      await f.db.query("UPDATE assets SET object_key=$1,size=$2 WHERE id=$3", [
        key,
        bytes.length,
        video.id,
      ]);
      if (i % 4 !== 3)
        await f.job(i + 1, "video", "completed", video.id, f.team, f.member);
      sources.push(key);
    }
    const cases: ExportCase[] = [];
    for (const shots of sizes) {
      const canvas = await f.canvases.create(
        f.member,
        { title: "Shot pack benchmark" },
        String(f.team.public_id),
      );
      const nodes = sources.slice(0, shots).map((media_id, i) => ({
        id: `shot-${i}`,
        type: "video",
        x: 0,
        y: 0,
        ...(i % 4 === 3 ? { media_id, use_media: true } : {}),
        ...(i % 4 === 1 ? { active_job: i + 1 } : {}),
      }));
      for (let i = 0; i < nodes.length; i++)
        if (i % 4 !== 3)
          await f.link(canvas.id, nodes[i].id, i + 1, "{}", f.member);
      const saved = await f.canvases.save(f.member, canvas.id, {
        expected_revision: canvas.revision,
        title: canvas.title,
        document: { nodes, shots: nodes.map(({ id }) => id).reverse() },
      });
      cases.push({
        shots,
        id: canvas.id,
        revision: saved.revision,
        samples: [],
        statements: 0,
      });
    }
    app = await createOriginalApp(f.p);
    await app.listen(0, "127.0.0.1");
    const origin = await app.getUrl();
    const login = await fetch(origin + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "member", password: "canvas-storage-fixture" }),
    });
    assert.equal(login.status, 200);
    const headers = {
      Cookie: login.headers.getSetCookie()[0].split(";")[0],
      "Content-Type": "application/json",
    };
    await login.arrayBuffer();
    const request = async ({ id, revision }: ExportCase) => {
      const start = performance.now();
      const response = await fetch(
        `${origin}/api/canvases/${id}/shots/download`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ expected_revision: revision }),
        },
      );
      const ticket = await response.json();
      const ms = performance.now() - start;
      assert.equal(response.status, 200, JSON.stringify(ticket));
      return { ms, ticket };
    };
    for (let i = 0; i < warmups; i++)
      for (const item of cases) await request(item);
    for (const item of cases) {
      const before = await statistics();
      const { ticket } = await request(item);
      item.statements = (await statistics()) - before;
      const response = await fetch(origin + ticket.url, { headers });
      assert.equal(response.status, 200);
      const zip = Buffer.from(await response.arrayBuffer());
      const filename = join(directory, `${item.shots}-shots.zip`);
      if (mode === "record") await writeFile(filename, zip);
      else assert.deepEqual(zip, await readFile(filename));
      assert.equal(ticket.filename, `弗淼-镜头-${item.shots}项.zip`);
    }
    for (let i = 0; i < iterations; i++)
      for (let j = 0; j < cases.length; j++) {
        const item = cases[(i + j) % cases.length];
        item.samples.push((await request(item)).ms);
      }
    console.log(
      `Authenticated loopback HTTP POST; ${warmups} warmups and ${iterations} timed requests per size; ZIPs ${mode === "record" ? "recorded" : "byte-identical to baseline"}`,
    );
    console.table(
      cases.map(({ shots, samples, statements }) => ({
        shots,
        statements,
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
