import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { OriginalIdentity } from "@fumiao/original-api/identity.js";
import { StudioCatalog } from "@fumiao/platform/catalog.js";
import { createOriginalApp } from "../../apps/api/src/original.js";
import { databaseFixture } from "../helpers/database.js";

test("管理员明确上架、关联和切换线路；不同请求竞写及批量失败均保持一致", async (t) => {
  const f = await databaseFixture();
  t.after(f.cleanup);
  const identity = new OriginalIdentity(f.p);
  const password = "publication-fixture";
  await identity.bootstrap({ name: "admin", nickname: "管理员", password });
  const cookie = await identity.login({ name: "admin", password }, "test");
  const requests: string[] = [];
  const app = await createOriginalApp(f.p, {
    modelAccessHttp: async (url, init) => {
      requests.push(init.method + " " + url.pathname);
      return {
        status: 200,
        contentType: "application/json",
        body: Buffer.from('{"data":[]}'),
      };
    },
  });
  await app.listen(0, "127.0.0.1");
  t.after(() => app.close());
  async function call(method: string, path: string, body?: unknown) {
    const res = await fetch(
      (await app.getUrl()) + "/api/admin/model-access" + path,
      {
        method,
        headers: {
          Cookie: "fm_session=" + cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    return { status: res.status, data: await res.json() };
  }
  async function draft(upstream: string, price: string | null) {
    const c = await call("POST", "/connections", {
      base_url: "https://1.1.1.1/v1",
      api_key: "demo",
    });
    assert.equal(c.status, 200);
    const id = randomUUID();
    const d = await call("PUT", "/drafts/" + id, {
      connection_id: c.data.id,
      connection_revision: 1,
      expected_revision: 0,
      upstream_id: upstream,
      purpose: "image",
      price,
    });
    assert.equal(d.status, 200);
    return { draft_id: id, draft_revision: 1 };
  }
  const a = await draft("same", "0.125001"),
    b = await draft("same", "10"),
    c = await draft("alias", "3"),
    incomplete = await draft("unfinished", null);
  const publish = (items: unknown[], uid = randomUUID()) =>
    call("POST", "/publications", { uid, items });
  const uid = randomUUID(),
    first = [{ ...a, action: "create", label: "镜头预演" }];
  const started = await publish(first, uid);
  assert.equal(started.status, 200);
  assert.deepEqual(await publish(first, uid), started);
  assert.equal((await publish([{ ...b, action: "create" }], uid)).status, 409);
  const id = started.data.items[0].catalog_id;
  assert.notEqual(id, "same");
  await f.p.registry.initializeStudio(f.db, false);
  assert.deepEqual(
    (await f.db.query("SELECT mode FROM studio_plugin_profile")).rows,
    [{ mode: "explicit" }],
  );
  assert.deepEqual(
    (await f.db.query("SELECT id FROM plugin_versions")).rows,
    [],
  );
  const { resolvePublishedRoute } =
    await import("@fumiao/platform/model-access/publication.js");
  const original = await resolvePublishedRoute(f.db, id);
  assert.deepEqual(original?.price, { kind: "image", unit: "0.125001" });
  const catalog = new StudioCatalog(f.db);
  assert.equal((await catalog.catalog())[id].label, "镜头预演");
  const priceRevision = (await catalog.prices()).revision;
  const separate = await publish([{ ...b, action: "create" }]);
  assert.equal(separate.status, 200);
  assert.notEqual(id, separate.data.items[0].catalog_id);
  const standby = {
    ...c,
    action: "standby",
    catalog_id: id,
    expected_revision: 1,
  };
  // Publication locks by catalog ID. Both IDs already exist, so the valid
  // standby is always written before the other model's missing price fails.
  const [firstCatalog, secondCatalog] = [
    id,
    separate.data.items[0].catalog_id,
  ].sort((a, b) => a.localeCompare(b));
  const beforeRollback = (await call("GET", "")).data.publications;
  assert.equal(
    (
      await publish([
        { ...standby, catalog_id: firstCatalog },
        {
          ...incomplete,
          action: "activate",
          catalog_id: secondCatalog,
          expected_revision: 1,
          replace_price: true,
        },
      ])
    ).status,
    400,
  );
  assert.deepEqual((await call("GET", "")).data.publications, beforeRollback);
  assert.equal(
    (await f.db.query("SELECT 1 FROM models WHERE provider_model='alias'")).rows
      .length,
    0,
  );
  const added = await publish([standby]);
  assert.equal(added.status, 200);
  assert.equal(
    (await resolvePublishedRoute(f.db, id))?.routeRevisionId,
    original?.routeRevisionId,
  );
  assert.equal((await catalog.prices()).revision, priceRevision + 1);
  const switchItem = { ...standby, action: "activate", expected_revision: 2 };
  const race = await Promise.all([
    publish([switchItem]),
    publish([switchItem]),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  const active = await resolvePublishedRoute(f.db, id);
  assert.equal(active?.upstreamId, "alias");
  assert.deepEqual(active?.price, original?.price);
  const restored = await publish([
    {
      action: "activate",
      route_revision_id: original!.routeRevisionId,
      catalog_id: id,
      expected_revision: 3,
    },
  ]);
  assert.equal(restored.status, 200);
  assert.equal((await resolvePublishedRoute(f.db, id))?.upstreamId, "same");
  assert.equal(
    (
      await publish([
        {
          action: "activate",
          route_revision_id: original!.routeRevisionId,
          catalog_id: separate.data.items[0].catalog_id,
          expected_revision: 1,
        },
      ])
    ).status,
    409,
  );
  assert.deepEqual(requests, []);
  const view = await call("GET", "");
  assert.equal(view.data.publications.length, 2);
  assert.equal(
    view.data.drafts.some((d: any) => d.id === incomplete.draft_id),
    true,
  );
});

test("旧对话逐个接管，旧价持续到切换，团队策略、借用密钥和旧包升级各有正确边界", async (t) => {
  const { chatSettingsFixture } = await import("../helpers/chat-settings.js");
  const { OriginalModelAccess } =
    await import("@fumiao/original-api/model-access.js");
  const { OriginalSettings } = await import("@fumiao/original-api/settings.js");
  const { ChatProviders } = await import("@fumiao/platform/chat-providers.js");
  const { Operations } = await import("@fumiao/platform/operations.js");
  const { resolveConnectionRevision } =
    await import("@fumiao/platform/model-access/connections.js");
  const { resolvePublishedRoute } =
    await import("@fumiao/platform/model-access/publication.js");
  const { one } = await import("@fumiao/platform/db.js");
  const f = await chatSettingsFixture();
  t.after(f.cleanup);
  const key = "sk-synthetic-donor-credential";
  await f.reset({ deepseek: "source-owned" }, key);
  const provider = (name: string) =>
    one(f.db, "SELECT * FROM connections WHERE id=$1", [f.ids[name]]);
  async function setAddress(name: string, baseUrl: string) {
    const row = await provider(name);
    await f.db.query("UPDATE connections SET config=$2 WHERE id=$1", [
      row.id,
      f.p.vault.seal({ ...f.p.vault.open(row.config), baseUrl }),
    ]);
  }
  await setAddress("openai", "https://api.openai.com/v1/");
  await setAddress("deepseek", "https://1.1.1.1/compat");
  const model = "gpt-4.1";
  const wid = randomUUID();
  await f.db.query(
    "INSERT INTO workspaces(id,name,owner_id,kind) VALUES($1,'test',$2,'team')",
    [wid, f.admin.id],
  );
  await f.db.query("INSERT INTO studio_workspace_policy VALUES($1,1,$2)", [
    wid,
    JSON.stringify({ [model]: false }),
  ]);
  const api = new OriginalModelAccess(new OriginalIdentity(f.p));
  const old = await provider("openai");
  const conn = await api.reuse(f.admin, {
    connection_id: old.id,
    expected_revision: old.revision,
  });
  assert.deepEqual(conn.credential_scope.upstream_ids, [model]);
  const id = randomUUID();
  const draft = {
    connection_id: conn.id,
    connection_revision: 1,
    expected_revision: 0,
    upstream_id: model,
  };
  await api.saveDraft(f.admin, id, { ...draft, purpose: "image", price: "0" });
  const activate = {
    action: "activate",
    catalog_id: model,
    expected_revision: 0,
    draft_id: id,
    draft_revision: 1,
  };
  const publish = (item: unknown) =>
    api.publish(f.admin, { uid: randomUUID(), items: [item] });
  await assert.rejects(
    publish({
      ...activate,
      action: "create",
      catalog_id: undefined,
      expected_revision: undefined,
    }),
    { status: 403 },
  );
  await api.saveDraft(f.admin, id, {
    ...draft,
    expected_revision: 1,
    purpose: "chat",
    chat_prices: { input: "0.000001", output: "0", cache_read: "0" },
  });
  assert.equal(
    (await f.catalog.prices()).items.find((p) => p.key === model + "|reply")
      ?.amount,
    1,
  );
  assert.equal(await resolvePublishedRoute(f.db, model), null);
  const { OriginalChats } = await import("@fumiao/original-api/chats.js");
  const chats = new OriginalChats(f.p);
  await f.db.query("UPDATE wallets SET balance=10");
  const { conversation } = await chats.create(f.admin, {});
  const oldTurn = randomUUID();
  await chats.send(f.admin, conversation.id, {
    uid: oldTurn,
    model,
    text: "原固定售价",
    expected_revision: conversation.revision,
    price_revision: (await f.catalog.prices()).revision,
  });
  const captured = () =>
    one(
      f.db,
      `SELECT t.plugin_id,t.plugin_version,t.config_snapshot,b.amount::text,b.price_key,b.price_revision
    FROM chat_turns t JOIN chat_charges b ON b.turn_id=t.id WHERE t.uid=$1`,
      [oldTurn],
    );
  const beforeSwitch = await captured();
  assert.equal(Number(beforeSwitch.amount), 1);
  assert.equal(beforeSwitch.price_key, model + "|reply");
  await publish({ ...activate, draft_revision: 2 });
  assert.deepEqual(await captured(), beforeSwitch);
  const route = await resolvePublishedRoute(f.db, model);
  assert.deepEqual(route?.price, {
    kind: "chat",
    input: "0.000001",
    output: "0",
    cache_read: "0",
    cache_write: null,
  });
  assert.equal((await f.catalog.effective(f.db, wid))[model], false);
  assert.equal(
    (await f.settings.config(f.admin)).models[model]?.label,
    "GPT-4.1",
  );
  const settings = new OriginalSettings(f.p);
  const pricing = await f.catalog.prices();
  assert.equal(
    pricing.items.some((p) => p.model === model),
    false,
  );
  assert.deepEqual(
    pricing.published?.find((p) => p.model === model)?.price,
    route?.price,
  );
  const values = Object.fromEntries(
    pricing.items.map((p) => [p.key, p.amount]),
  );
  await settings.prices(f.admin, {
    values,
    expected_revision: pricing.revision,
  });
  const remaining = await new ChatProviders(f.p).read(f.db);
  assert.equal(remaining.has("openai"), false);
  assert.deepEqual(remaining.get("deepseek")?.provider.models, [
    "deepseek-flash",
  ]);
  const ds = await provider("deepseek");
  const own = await api.reuse(f.admin, {
    connection_id: ds.id,
    expected_revision: ds.revision,
  });
  await new Operations(f.p).upgrade(f.admin, ds.id, {
    revision: ds.revision,
    version: ds.plugin_version,
    config: f.p.vault.open(ds.config),
  });
  assert.equal(
    (await f.db.query("SELECT * FROM models WHERE catalog_id=$1", [model])).rows
      .length,
    1,
  );
  assert.deepEqual(
    (await resolvePublishedRoute(f.db, model))?.price,
    route?.price,
  );
  const authorizations: string[] = [];
  const http = async (url: URL, init: { headers: Record<string, string> }) => {
    authorizations.push(init.headers.Authorization);
    return {
      status: 200,
      contentType: "application/json",
      body: Buffer.from("{}"),
    };
  };
  const client = await resolveConnectionRevision(
    f.db,
    f.p,
    conn.revision_id,
    http,
  );
  const signal = AbortSignal.timeout(1000);
  await assert.rejects(
    client.request({ endpoint: "images", method: "POST", model }, signal),
    { status: 403 },
  );
  await assert.rejects(
    api.edit(f.admin, conn.id, {
      expected_revision: 1,
      base_url: "https://1.1.1.1/changed",
    }),
    { status: 400 },
  );
  await assert.rejects(
    api.edit(f.admin, conn.id, {
      expected_revision: 1,
      base_url: "https://1.1.1.1/changed",
      api_key: key,
    }),
    { status: 400 },
  );
  await api.edit(f.admin, conn.id, { expected_revision: 1, enabled: false });
  await assert.rejects(resolvePublishedRoute(f.db, model), { status: 409 });
  const reply = () =>
    client.request(
      {
        endpoint: "chat/completions",
        method: "POST",
        model,
        content_type: "application/json",
        body: JSON.stringify({ model }),
      },
      signal,
    );
  await reply();
  await t.test(
    "第二个供钥候选出现后，解析和已取得客户端均拒绝发送",
    async () => {
      const duplicate = randomUUID();
      await f.db.query(
        `INSERT INTO connections(id,name,plugin_id,plugin_version,config)
      SELECT $2,'另一个来源',plugin_id,plugin_version,config FROM connections WHERE id=$1`,
        [f.connection, duplicate],
      );
      try {
        await assert.rejects(reply(), { status: 403 });
        await assert.rejects(
          resolveConnectionRevision(f.db, f.p, conn.revision_id, http),
          { status: 403 },
        );
      } finally {
        await f.db.query("UPDATE connections SET removed=true WHERE id=$1", [
          duplicate,
        ]);
      }
    },
  );
  await t.test(
    "供钥适配器不再确认配置后，已有密钥摘要不能授权发送",
    async () => {
      const donor = await one(
        f.db,
        "SELECT plugin_id,plugin_version FROM connections WHERE id=$1",
        [f.connection],
      );
      async function selectDonorVersion(version: string) {
        await f.db.transaction(async (sql) => {
          await sql.query(
            "UPDATE connections SET plugin_version=$2 WHERE id=$1",
            [f.connection, version],
          );
          await sql.query(
            "UPDATE studio_catalog SET plugin_version=$1 WHERE id='gpt-image-2.6-sunburst'",
            [version],
          );
        });
      }
      const { PluginRegistry } = await import("@fumiao/platform/plugins.js");
      const originalRegistry = f.p.registry;
      const prior = await originalRegistry.resolve(
        f.db,
        donor.plugin_id,
        donor.plugin_version,
      );
      let checked = 0;
      const upgraded = {
        ...prior,
        manifest: { ...prior.manifest, version: "2.0.0" },
        originalState: {
          ...prior.originalState!,
          configured(config: Record<string, unknown>) {
            checked++;
            return (
              prior.originalState!.configured(config) &&
              config.region === "approved"
            );
          },
        },
      };
      f.p.registry = new PluginRegistry([upgraded]);
      await f.p.registry.install(f.db, upgraded.manifest);
      await selectDonorVersion(upgraded.manifest.version);
      try {
        await assert.rejects(reply(), { status: 403 });
        await assert.rejects(
          resolveConnectionRevision(f.db, f.p, conn.revision_id, http),
          { status: 403 },
        );
        assert.equal(checked, 2);
      } finally {
        f.p.registry = originalRegistry;
        await selectDonorVersion(donor.plugin_version);
      }
    },
  );
  assert.deepEqual(authorizations, ["Bearer " + key]);
  await f.db.query("UPDATE connections SET config=$2 WHERE id=$1", [
    f.connection,
    f.p.vault.seal({ ...f.config, apiKey: "rotated" }),
  ]);
  await assert.rejects(reply(), { status: 403 });
  await f.db.query("UPDATE connections SET config=$2 WHERE id=$1", [
    ds.id,
    f.p.vault.seal({}),
  ]);
  await (
    await resolveConnectionRevision(f.db, f.p.vault, own.revision_id, http)
  ).request({ endpoint: "models", method: "GET" }, signal);
  assert.deepEqual(authorizations, ["Bearer " + key, "Bearer source-owned"]);
});

test("旧包升级与移除保留单一接管模型及其策略，自有密钥修订继续可用", async (t) => {
  const { legacyPackage, seedLegacyPackage } =
    await import("../helpers/legacy-studio.js");
  const { StudioPackages } =
    await import("@fumiao/platform/studio-packages.js");
  const { PluginRegistry } = await import("@fumiao/platform/plugins.js");
  const { readFile } = await import("node:fs/promises");
  const { OriginalModelAccess } =
    await import("@fumiao/original-api/model-access.js");
  const { resolvePublishedRoute } =
    await import("@fumiao/platform/model-access/publication.js");
  const { resolveConnectionRevision } =
    await import("@fumiao/platform/model-access/connections.js");
  const { one } = await import("@fumiao/platform/db.js");
  const f = await databaseFixture();
  t.after(f.cleanup);
  f.p.registry = new PluginRegistry(undefined, [], async (_url, init) => {
    assert.equal(init.method, "GET");
    return {
      status: 200,
      headers: {},
      body: (async function* () {
        yield Buffer.from('{"data":[]}');
      })(),
      close() {},
    };
  });
  await f.p.registry.initializeStudio(f.db, false);
  const password = randomUUID(),
    identity = new OriginalIdentity(f.p);
  await identity.bootstrap({ name: "admin", nickname: "admin", password });
  const actor = await identity.actor(
    await identity.login({ name: "admin", password }, "fixture"),
  );
  const pkg = await legacyPackage("compatible-chat");
  await seedLegacyPackage(f.p, pkg);
  const packages = new StudioPackages(f.p);
  const old = await f.p.createConnection(
    actor,
    {
      name: "旧对话",
      pluginId: pkg.id,
      version: pkg.adapterVersion,
      config: {
        provider: "openai",
        apiKey: "own-key",
        baseUrl: "https://1.1.1.1/v1",
      },
    },
    true,
  );
  await packages.change(actor, pkg.id, 1, "enable");
  const api = new OriginalModelAccess(identity);
  const c = await api.reuse(actor, {
    connection_id: old.id,
    expected_revision: 1,
  });
  const draft_id = randomUUID();
  const draft = {
    connection_id: c.id,
    connection_revision: 1,
    expected_revision: 0,
    upstream_id: "gpt-4.1",
    purpose: "chat",
    chat_prices: { input: "0", output: "1.23" },
  };
  await api.saveDraft(actor, draft_id, draft);
  await api.publish(actor, {
    uid: randomUUID(),
    items: [
      {
        action: "activate",
        catalog_id: "gpt-4.1",
        expected_revision: 0,
        draft_id,
        draft_revision: 1,
      },
    ],
  });
  const imageDraft = randomUUID();
  const selected = {
    purpose: "image",
    price: "2",
    upstream_id: "new-image",
    connection_id: c.id,
  };
  const publishImage = async (draftRevision: number) =>
    api.publish(actor, {
      uid: randomUUID(),
      items: [
        {
          action: "create",
          draft_id: imageDraft,
          draft_revision: draftRevision,
        },
      ],
    });
  await api.saveDraft(actor, imageDraft, {
    ...selected,
    connection_revision: 1,
    expected_revision: 0,
  });
  await assert.rejects(publishImage(1), { status: 403 });
  const httpCalls: string[] = [];
  const http = async (url: URL, init: { headers: Record<string, string> }) => {
    httpCalls.push(url.pathname);
    assert.equal(init.headers.Authorization, "Bearer explicit-media-key");
    return {
      status: 200,
      contentType: "application/json",
      body: Buffer.from("{}"),
    };
  };
  const oldClient = await resolveConnectionRevision(
    f.db,
    f.p.vault,
    c.revision_id,
    http,
  );
  const imageRequest = {
    endpoint: "images/generations",
    method: "POST",
    model: "new-image",
  } as const;
  await assert.rejects(
    oldClient.request(imageRequest, AbortSignal.timeout(1000)),
    { status: 403 },
  );
  await assert.rejects(
    oldClient.request(
      {
        endpoint: "chat/completions",
        method: "POST",
        model: "other",
        content_type: "application/json",
        body: '{"model":"other"}',
      },
      AbortSignal.timeout(1000),
    ),
    { status: 403 },
  );
  assert.deepEqual(httpCalls, []);
  // A draft deployment might already have persisted the broad initial grant.
  // Changing the original connection later supplies no evidence of a new grant.
  const historicalId = randomUUID();
  await f.db.query(
    `INSERT INTO model_access_connection_revisions(id,connection_id,revision,config,credential_scope)
    SELECT $2,connection_id,99,config,$3 FROM model_access_connection_revisions WHERE id=$1`,
    [
      c.revision_id,
      historicalId,
      JSON.stringify({
        endpoints: ["models", "chat/completions", "images/generations"],
        upstream_ids: null,
      }),
    ],
  );
  await f.db.query(
    "UPDATE connections SET revision=revision+1,config=$2 WHERE id=$1",
    [
      old.id,
      f.p.vault.seal({
        provider: "openai",
        apiKey: "rotated-original",
        baseUrl: "https://1.1.1.1/v1",
      }),
    ],
  );
  const unmarked = await resolveConnectionRevision(
    f.db,
    f.p,
    historicalId,
    http,
  );
  assert.deepEqual(unmarked.scope, {
    endpoints: ["models", "chat/completions"],
    upstream_ids: ["gpt-4.1"],
  });
  await assert.rejects(
    unmarked.request(imageRequest, AbortSignal.timeout(1000)),
    { status: 403 },
  );
  const replacement = await api.edit(actor, c.id, {
    expected_revision: 1,
    api_key: "explicit-media-key",
  });
  await api.saveDraft(actor, imageDraft, {
    ...selected,
    connection_revision: replacement.revision,
    expected_revision: 1,
  });
  await publishImage(2);
  const newClient = await resolveConnectionRevision(
    f.db,
    f.p.vault,
    replacement.revision_id,
    http,
  );
  await newClient.request(imageRequest, AbortSignal.timeout(1000));
  assert.deepEqual(httpCalls, ["/v1/images/generations"]);
  await assert.rejects(
    oldClient.request(imageRequest, AbortSignal.timeout(1000)),
    { status: 403 },
  );
  const route = await resolvePublishedRoute(f.db, "gpt-4.1");
  const next = JSON.parse(
    await readFile(
      "plugins/compatible-chat/compatible-chat.fmplugin.json",
      "utf8",
    ),
  );
  const revision = async () =>
    (
      await one(f.db, "SELECT revision FROM studio_packages WHERE id=$1", [
        pkg.id,
      ])
    ).revision;
  await packages.install(actor, next, await revision());
  assert.equal(
    (await one(f.db, "SELECT flags FROM studio_policy")).flags["gpt-4.1"],
    true,
  );
  assert.equal(
    (await f.db.query("SELECT id FROM models WHERE catalog_id='gpt-4.1'")).rows
      .length,
    1,
  );
  await packages.change(actor, pkg.id, await revision(), "remove");
  assert.deepEqual(await resolvePublishedRoute(f.db, "gpt-4.1"), route);
  const client = await resolveConnectionRevision(
    f.db,
    f.p.vault,
    c.revision_id,
    async (url, init) => {
      assert.equal(url.href, "https://1.1.1.1/v1/models");
      assert.equal(init.headers.Authorization, "Bearer own-key");
      return {
        status: 200,
        contentType: "application/json",
        body: Buffer.from("{}"),
      };
    },
  );
  await client.request(
    { endpoint: "models", method: "GET" },
    AbortSignal.timeout(1000),
  );
});
