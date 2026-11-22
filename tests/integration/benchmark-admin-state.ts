import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createOriginalApp } from "../../apps/api/src/original.js";
import { Postgres } from "../../packages/platform/src/db.js";
import { PluginRegistry } from "../../packages/platform/src/plugins.js";
import { StudioCatalog } from "../../packages/platform/src/catalog.js";
import { OriginalIdentity } from "../../packages/original-api/src/identity.js";
import { gpuState } from "../../plugins/gpu/src/state.js";
import { museState } from "../../plugins/muse/src/state.js";
import { flowState } from "../../plugins/flow/src/state.js";
import { imagesState } from "../../plugins/images/src/state.js";
import { databaseFixture } from "../helpers/database.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const outputDirectory = process.argv[2];
assert(
  databaseUrl && outputDirectory,
  "Set TEST_DATABASE_URL to an idle, dedicated PostgreSQL database with pg_stat_statements enabled and pass an existing output directory.",
);
process.env.FUMIAO_PAYMENT_AUTOSTART = "0";

const stats = new Postgres(databaseUrl);
const fixture = await databaseFixture();
const identity = new OriginalIdentity(fixture.p);
const password = "admin-state-benchmark";
await identity.bootstrap({ name: "admin", nickname: "管理员", password });
const plugins = [gpuState, museState, flowState, imagesState];
fixture.p.registry = new PluginRegistry(plugins);
await fixture.p.registry.installBuiltins(fixture.db);
const catalog = new StudioCatalog(fixture.db);
for (const plugin of plugins)
  await fixture.db.transaction((sql) => catalog.activate(sql, plugin.manifest));
const admin = await identity.actor(
  await identity.login({ name: "admin", password }, "benchmark"),
);
const members: number[] = [];
for (let i = 0; i < 3; i++) {
  await identity.createMember(admin, {
    name: `member${i}`,
    nickname: `成员${i}`,
    password,
  });
}
for (const row of (
  await fixture.db.query(
    "SELECT public_id FROM users WHERE name LIKE 'member%' ORDER BY public_id",
  )
).rows)
  members.push(Number(row.public_id));
const [model] = Object.keys(await catalog.catalog());

const app = await createOriginalApp(fixture.p);
try {
  await app.listen(0, "127.0.0.1");
  const url = await app.getUrl();
  const login = await fetch(url + "/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "admin", password }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie()[0].split(";")[0];
  await login.arrayBuffer();
  async function state() {
    const response = await fetch(url + "/api/state", { headers: { cookie } });
    assert.equal(response.status, 200);
    const { server_time, disk_free, ...rest } = await response.json();
    return JSON.stringify(rest);
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
  let teams = Number(
    (
      await fixture.db.query(
        "SELECT count(*) AS n FROM workspaces WHERE kind='team'",
      )
    ).rows[0].n,
  );
  for (const target of [1, 20]) {
    while (teams < target) {
      const space = await identity.createWorkspace(admin, {
        name: `Benchmark team ${++teams}`,
        members: members.slice(0, teams % (members.length + 1)),
      });
      if (teams === 2)
        await fixture.db.transaction((sql) =>
          catalog.savePolicy(sql, {
            model,
            group: false,
            enabled: false,
            workspace: space!.id,
            expected_revision: 0,
          }),
        );
    }
    // Pin random avatars and creation times so separate runs return comparable bytes.
    await fixture.db.query("UPDATE users SET avatar='builtin:waves'");
    await fixture.db.query(
      "UPDATE workspaces SET created_at='2026-01-01T00:00:00Z'",
    );
    const warmups = 20;
    const iterations = 100;
    const expected = await state();
    assert.equal(
      JSON.parse(expected).workspaces.filter((w: any) => w.kind === "team")
        .length,
      target,
    );
    for (let i = 0; i < warmups; i++) await state();
    const before = await statements();
    const times: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      const body = await state();
      times.push(performance.now() - start);
      assert.equal(body, expected);
    }
    const queries = (await statements()) - before;
    times.sort((a, b) => a - b);
    const percentile = (p: number) => times[Math.ceil(p * times.length) - 1];
    await writeFile(join(outputDirectory, `state-${target}.json`), expected);
    console.log(
      JSON.stringify({
        teams: target,
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
