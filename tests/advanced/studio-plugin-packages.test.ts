import { readFile } from "node:fs/promises";
import { StudioPackages } from "@fumiao/platform/studio-packages.js";
import { StudioUpdates } from "@fumiao/platform/studio-updates.js";
import assert from "node:assert/strict";
import test from "node:test";
import { OriginalIdentity } from "@fumiao/original-api/identity.js";
import { OriginalState } from "@fumiao/original-api/state.js";
import { StudioCatalog } from "@fumiao/platform/catalog.js";
import { migrate } from "@fumiao/platform/db.js";
import { studioPluginProfile } from "@fumiao/platform/studio-plugin-profile.js";
import {
  CAPACITY_SERVICE_CONCURRENCY,
  buildUpdateSourcePayload,
  defaultServiceConcurrency,
  parseServiceConcurrency,
} from "../../apps/web/studio/settings-plugins-helpers.js";
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

test("plugin settings helpers integrate with connection concurrency and update token clearing (#68, #70)", async () => {
  const f = await databaseFixture();
  try {
    const { registry } = f.p;
    await registry.initializeStudio(f.db, false);
    const identity = new OriginalIdentity(f.p);
    const user = { name: "admin", password: "plugin-settings-ux-test" };
    await identity.bootstrap({ ...user, nickname: "管理员" });
    const actor = await identity.actor(await identity.login(user, "fixture"));

    // #68: createConnection and updateConnection persist custom concurrency
    const museBuiltin = (await registry.studioPackages()).find(
      (p) => p.manifest.id === "muse",
    )!;
    await f.db.transaction((sql) =>
      registry.installStudioPackage(sql, "muse", museBuiltin.manifest.version),
    );
    const { id: connId } = await f.p.createConnection(
      actor,
      {
        name: "Muse 高并发节点",
        pluginId: "muse",
        version: museBuiltin.manifest.version,
        concurrency: 4,
        config: { baseUrl: "http://127.0.0.1", apiKey: "secret-key" },
      },
      true,
    );
    let [conn] = await f.p.studioConnections(actor);
    assert.equal(conn.id, connId);
    assert.equal(conn.concurrency, 4);

    await f.p.updateConnection(actor, connId, {
      revision: conn.revision,
      enabled: conn.enabled,
      preserveCredentials: true,
      concurrency: 12,
      config: { baseUrl: "http://127.0.0.1" },
    });
    [conn] = await f.p.studioConnections(actor);
    assert.equal(conn.concurrency, 12);

    // #70: configure update source with token, retain on blank save, clear on explicit clearToken
    const file = JSON.parse(
      await readFile(
        "plugins/example-reading-time/example-reading-time.fmplugin.json",
        "utf8",
      ),
    );
    const packages = new StudioPackages(f.p);
    const updates = new StudioUpdates(f.p);
    await packages.install(actor, file);

    const updateUrl = "https://updates.example.com/reading-time/update.json";
    const findPkg = async () =>
      (await packages.list(actor)).find((p) => p.id === file.id)!;
    let pkg = await findPkg();
    await updates.configure(actor, file.id, {
      revision: pkg.revision,
      ...buildUpdateSourcePayload({ url: updateUrl, token: "ro-secret-token" }),
    });
    pkg = await findPkg();
    assert.equal(pkg.updateUrl, updateUrl);
    assert.equal(pkg.hasUpdateToken, true);
    assert.doesNotMatch(JSON.stringify(pkg), /ro-secret-token/);

    // Blank token save preserves saved token on the same URL
    await updates.configure(actor, file.id, {
      revision: pkg.revision,
      ...buildUpdateSourcePayload({ url: updateUrl, token: "" }),
    });
    pkg = await findPkg();
    assert.equal(pkg.updateUrl, updateUrl);
    assert.equal(pkg.hasUpdateToken, true);

    // Explicit clearToken clears update_auth while keeping saved update_url intact even if draft URL was edited
    await updates.configure(actor, file.id, {
      revision: pkg.revision,
      ...buildUpdateSourcePayload({
        savedUrl: pkg.updateUrl,
        url: "",
        clearToken: true,
      }),
    });
    pkg = await findPkg();
    assert.equal(pkg.updateUrl, updateUrl);
    assert.equal(pkg.hasUpdateToken, false);
  } finally {
    await f.cleanup();
  }
});

test("capacity plugins expose defaultConcurrency 16 for new service forms while preserving saved concurrency on edits", async () => {
  const f = await databaseFixture();
  try {
    await f.p.registry.initializeStudio(f.db, false);
    const identity = new OriginalIdentity(f.p);
    const user = { name: "admin", password: "default-concurrency-test" };
    await identity.bootstrap({ ...user, nickname: "管理员" });
    const actor = await identity.actor(await identity.login(user, "fixture"));
    const packages = new StudioPackages(f.p);

    const museFile = JSON.parse(
      await readFile("plugins/muse/muse.fmplugin.json", "utf8"),
    );
    const flowFile = JSON.parse(
      await readFile("plugins/flow/flow.fmplugin.json", "utf8"),
    );
    await packages.install(actor, museFile);
    await packages.install(actor, flowFile);

    const allListed = await packages.list(actor);
    const musePkg = allListed.find((p) => p.id === "muse")!;
    const flowPkg = allListed.find((p) => p.id === "flow")!;
    assert.equal(musePkg.defaultConcurrency, CAPACITY_SERVICE_CONCURRENCY);
    assert.equal(musePkg.defaultConcurrency, 16);
    assert.equal(flowPkg.defaultConcurrency, 1);

    assert.equal(defaultServiceConcurrency(musePkg), 16);
    assert.equal(
      parseServiceConcurrency("", defaultServiceConcurrency(musePkg)),
      16,
    );
    assert.equal(defaultServiceConcurrency(flowPkg), 1);
    assert.equal(defaultServiceConcurrency({}), 1);
    assert.equal(defaultServiceConcurrency({ defaultConcurrency: 0 }), 1);

    for (const savedConcurrency of [1, 3]) {
      const existingService = { concurrency: savedConcurrency };
      const fallback =
        existingService?.concurrency ?? defaultServiceConcurrency(musePkg);
      assert.equal(fallback, savedConcurrency);
      assert.equal(parseServiceConcurrency("", fallback), savedConcurrency);
    }
  } finally {
    await f.cleanup();
  }
});
