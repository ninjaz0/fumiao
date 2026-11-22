import { readFile } from "node:fs/promises";
import { StudioPackages } from "@fumiao/platform/studio-packages.js";
import assert from "node:assert/strict";
import test from "node:test";
import { OriginalIdentity } from "@fumiao/original-api/identity.js";
import { OriginalState } from "@fumiao/original-api/state.js";
import { StudioCatalog } from "@fumiao/platform/catalog.js";
import { migrate } from "@fumiao/platform/db.js";
import { studioPluginProfile } from "@fumiao/platform/studio-plugin-profile.js";
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
        const pkg = (await registry.studioPackages()).find(
          (p) => p.manifest.id === id,
        )!;
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

test("legacy seed models stay out of Studio settings until their plugin is installed", async () => {
  const f = await databaseFixture("032_quarantine_retired_flow_sources.sql");
  try {
    const { registry } = f.p;
    await registry.installBuiltins(f.db, true);
    const catalog = new StudioCatalog(f.db);
    const key = "muse-video|5";
    const initial = await catalog.prices();
    const values = Object.fromEntries(
      initial.items.map(({ key, amount }) => [key, amount]),
    );
    assert.ok(Object.hasOwn(values, key));
    values[key] = 734;
    const prices = await f.db.transaction((sql) =>
      catalog.savePrices(sql, values, initial.revision),
    );

    await migrate(f.db);
    await registry.initializeStudio(f.db, false);
    assert.equal(await studioPluginProfile(f.db), "compatible");
    assert.deepEqual(await catalog.catalog(f.db), {});
    assert.deepEqual(await catalog.groups(f.db), {});
    assert.deepEqual(await catalog.prices(), {
      items: [],
      revision: prices.revision,
    });
    const identity = new OriginalIdentity(f.p);
    const user = { name: "admin", password: "plugin-upgrade-test" };
    await identity.bootstrap({ ...user, nickname: "管理员" });
    const actor = await identity.actor(await identity.login(user, "fixture"));
    const state = await new OriginalState(f.p).read(actor);
    assert.deepEqual(state.model_forms, {});
    assert.deepEqual(state.model_access, {});
    assert.deepEqual(state.model_policy.enabled, {});
    assert.deepEqual(state.images.models, {});
    const file = JSON.parse(
      await readFile("plugins/muse/muse.fmplugin.json", "utf8"),
    );
    const packages = new StudioPackages(f.p);
    await packages.install(actor, file);
    const visible = await catalog.prices();
    assert.deepEqual(
      new Set(visible.items.map((item) => item.model)),
      new Set(["muse-image", "muse-video"]),
    );
    assert.equal(visible.items.find((item) => item.key === key)?.amount, 734);
    const edits = Object.fromEntries(
      visible.items.map((item) => [
        item.key,
        item.key === key ? 735 : item.amount,
      ]),
    );
    await f.db.transaction((sql) =>
      catalog.savePrices(sql, edits, visible.revision),
    );
    assert.equal(
      (await catalog.prices()).items.find((item) => item.key === key)?.amount,
      735,
    );
    const [installed] = await packages.list(actor);
    await packages.change(actor, file.id, installed.revision, "remove");
    assert.deepEqual((await catalog.prices()).items, []);
    await packages.install(actor, file);
    assert.equal(
      (await catalog.prices()).items.find((item) => item.key === key)?.amount,
      735,
    );
  } finally {
    await f.cleanup();
  }
});
