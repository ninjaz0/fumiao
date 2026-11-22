import test from "node:test";
import assert from "node:assert/strict";
import { databaseFixture } from "../helpers/database.js";
import { one, type Sql } from "@fumiao/platform/db.js";
import { PluginRegistry } from "@fumiao/platform/plugins.js";
import { StudioCatalog } from "@fumiao/platform/catalog.js";
import { OriginalState } from "@fumiao/original-api/state.js";
import { OriginalIdentity } from "@fumiao/original-api/identity.js";
import { gpuState } from "@fumiao/plugin-gpu/state.js";
import { museState } from "@fumiao/plugin-muse/state.js";
import { flowState } from "@fumiao/plugin-flow/state.js";
import { imagesState } from "@fumiao/plugin-images/state.js";

test("admin state reads team members and model policies in a constant number of statements", async (t) => {
  const f = await databaseFixture();
  try {
    const identity = new OriginalIdentity(f.p),
      password = "team-reads-test-password";
    await identity.bootstrap({ name: "admin", nickname: "管理员", password });
    const admin = await identity.actor(
      await identity.login({ name: "admin", password }, "fixture"),
    );
    const plugins = [gpuState, museState, flowState, imagesState];
    f.p.registry = new PluginRegistry(plugins);
    await f.p.registry.installBuiltins(f.db);
    const catalog = new StudioCatalog(f.db);
    for (const p of plugins)
      await f.db.transaction((sql) => catalog.activate(sql, p.manifest));
    const [model] = Object.keys(await catalog.catalog());
    assert.ok(model);
    const state = new OriginalState(f.p),
      adminId = Number(admin.public_id);

    const transaction = f.db.transaction.bind(f.db);
    let reads = 0;
    t.mock.method(f.db, "transaction", (fn: (sql: Sql) => Promise<unknown>) =>
      transaction((sql) =>
        fn({
          query(statement, params) {
            if (/^\s*(SELECT|WITH)\b/.test(statement)) reads++;
            return sql.query(statement, params);
          },
        }),
      ),
    );
    const read = async () => {
      reads = 0;
      const out = await state.read(admin);
      return { reads, out };
    };

    const one_team = await read();
    const teams = one_team.out.workspaces.filter((w: any) => w.kind === "team");
    assert.equal(teams.length, 1);

    const created: number[] = [];
    for (let i = 0; i < 19; i++) {
      const space = await identity.createWorkspace(admin, {
        name: `Team ${i}`,
        members: i % 2 ? [adminId] : [],
      });
      created.push(space!.id);
    }
    await f.db.transaction((sql) =>
      catalog.savePolicy(sql, {
        model,
        group: false,
        enabled: false,
        workspace: created[0],
        expected_revision: 0,
      }),
    );

    const twenty = await read();
    const spaces = twenty.out.workspaces.filter((w: any) => w.kind === "team");
    assert.equal(spaces.length, 20);
    assert.equal(twenty.reads, one_team.reads);
    for (const [i, id] of created.entries()) {
      const space = spaces.find((w: any) => w.id === id);
      assert.deepEqual(space.members, i % 2 ? [adminId] : []);
      assert.equal(space.member_count, i % 2 ? 1 : 0);
    }
    const policies = twenty.out.team_model_policies;
    assert.deepEqual(
      Object.keys(policies),
      spaces.map((w: any) => String(w.id)),
    );
    assert.deepEqual(policies[String(created[0])], {
      revision: 1,
      enabled: { ...policies[String(created[1])].enabled, [model]: false },
    });
    assert.equal(policies[String(created[1])].revision, 0);
    assert.equal(policies[String(created[1])].enabled[model], true);
    const stored = await one(
      f.db,
      "SELECT count(*)::int AS n FROM studio_workspace_policy",
    );
    assert.equal(stored.n, 1);
  } finally {
    await f.cleanup();
  }
});
