import assert from "node:assert/strict";
import test from "node:test";
import { OriginalIdentity } from "../../packages/original-api/src/identity.js";
import { OriginalState } from "../../packages/original-api/src/state.js";
import { StudioCatalog } from "../../packages/platform/src/catalog.js";
import { migrate } from "../../packages/platform/src/db.js";
import { studioPluginProfile } from "../../packages/platform/src/studio-plugin-profile.js";
import { databaseFixture } from "../helpers/database.js";

for (const id of ["muse", "flow"]) {
  test(
    "a fresh Studio can install only " +
      id +
      " and retain its catalog on restart",
    async () => {
      const f = await databaseFixture();
      try {
        const { registry } = f.p;
        await registry.initializeStudio(f.db, false);
        const identity = new OriginalIdentity(f.p);
        const user = { name: "admin", password: "isolated-studio-password" };
        await identity.bootstrap({ ...user, nickname: "插件测试" });
        const actor = await identity.actor(
          await identity.login(user, "fixture"),
        );
        const read = () => new OriginalState(f.p).read(actor);
        assert.deepEqual((await read()).model_catalog, {});
        const pkg = registry
          .studioPackages()
          .find((p) => p.manifest.id === id)!;
        const version = pkg.manifest.version;
        const install = () =>
          f.db.transaction((sql) =>
            registry.installStudioPackage(sql, id, version),
          );
        await Promise.all([install(), install()]);
        const before = await read();
        assert.deepEqual(
          Object.keys(before.model_catalog).sort(),
          pkg.manifest.models
            .filter((m) => m.studio)
            .map((m) => m.id)
            .sort(),
        );
        assert.deepEqual(before.gpu_models, {});
        const payload = {
          name: id,
          pluginId: id,
          version,
          config: { baseUrl: "http://127.0.0.1", apiKey: "local-test" },
        };
        const { id: connection } = await f.p.createConnection(
          actor,
          payload,
          true,
        );
        await assert.rejects(f.p.createConnection(actor, payload, true), {
          status: 409,
        });
        await f.p.updateConnection(actor, connection, {
          revision: 1,
          enabled: true,
          concurrency: 1,
        });
        await registry.initializeStudio(f.db, false);
        const after = await read();
        assert.deepEqual(after.pricing, before.pricing);
        assert.deepEqual(after.model_catalog, before.model_catalog);
        assert.equal(after[id].configured, true);
      } finally {
        await f.cleanup();
      }
    },
  );
}

test("upgrading an existing Fumiao catalog retains its model entries, prices and revision", async () => {
  const f = await databaseFixture("032_quarantine_retired_flow_sources.sql");
  try {
    const { registry } = f.p;
    await registry.installBuiltins(f.db, true);
    const catalog = new StudioCatalog(f.db);
    const models = await catalog.catalog(f.db);
    const initial = await catalog.prices();
    const values = Object.fromEntries(
      initial.items.map(({ key, amount }) => [key, amount]),
    );
    values[initial.items[0].key] = 734;
    const prices = await f.db.transaction((sql) =>
      catalog.savePrices(sql, values, initial.revision),
    );

    await migrate(f.db);
    await registry.initializeStudio(f.db, false);
    assert.equal(await studioPluginProfile(f.db), "compatible");
    assert.deepEqual(await catalog.catalog(f.db), models);
    assert.deepEqual(await catalog.prices(), prices);
  } finally {
    await f.cleanup();
  }
});
