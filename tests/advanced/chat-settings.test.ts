import test from "node:test";
import assert from "node:assert/strict";
import { chatSettingsFixture } from "../helpers/chat-settings.js";
import { ChatProviders } from "../../packages/platform/src/chat-providers.js";
import { one } from "../../packages/platform/src/db.js";
import { chatStreaming } from "../../plugins/chat/src/stream.js";
const key = "sk-abcdefghijklmnop",
  encoded = Buffer.from(JSON.stringify({ key }));
test("Original chat settings preserve admin ordering, encrypt credentials and delegate provider probes without creating jobs or charges", async () => {
  const f = await chatSettingsFixture();
  try {
    await f.reset();
    assert.deepEqual(await f.settings.read(f.admin), {
      providers: {
        deepseek: { label: "DeepSeek", configured: false },
        openai: { label: "OpenAI", configured: false },
      },
    });
    for (const [actor, status] of [
      [1, 403],
      [2, 401],
    ])
      assert.equal(
        (
          await f.request(
            "PUT",
            "/api/admin/chat/deepseek",
            { invalid: true },
            actor,
          )
        ).status,
        status,
      );
    assert.equal(
      (await f.request("PUT", "/api/admin/chat/missing", {})).status,
      400,
    );
    assert.equal(
      (await f.request("PUT", "/api/admin/chat/missing", { key })).status,
      404,
    );
    assert.equal(
      (await f.request("POST", "/api/admin/chat/openai/test")).status,
      409,
    );
    const before = await f.catalog.policy();
    assert.deepEqual(
      (await f.request("PUT", "/api/admin/chat/deepseek", { key })).body,
      { configured: true },
    );
    const stored = await one(
      f.db,
      "SELECT config,revision FROM connections WHERE id=$1",
      [f.ids.deepseek],
    );
    assert.ok(!stored.config.includes(key));
    assert.equal(f.p.vault.open(stored.config).apiKey, key);
    assert.deepEqual(await f.catalog.policy(), before);
    const models = (
      await f.db.query(
        "SELECT provider_model FROM models WHERE connection_id=$1",
        [f.ids.deepseek],
      )
    ).rows;
    assert.deepEqual(
      models.map((m) => m.provider_model),
      ["deepseek-flash"],
    );
    f.wire.setWire("probe", { raw: '{"data":[{"id":"deepseek-flash"}]}' });
    assert.deepEqual(
      (
        await f.request("POST", "/api/admin/chat/deepseek/test", {
          ignored: true,
        })
      ).body,
      { ok: true },
    );
    assert.equal(f.wire.requests[0].authorization, "Bearer " + key);
    assert.equal(f.wire.requests[0].path, "/models");
    f.wire.setWire("probe", { raw: "invalid" });
    const malformed = await f.request("POST", "/api/admin/chat/deepseek/test");
    assert.equal(malformed.status, 500);
    assert.equal(malformed.body, "Internal Server Error");
    assert.equal(malformed.contentType, "text/plain; charset=utf-8");
    assert.equal(
      Number((await one(f.db, "SELECT count(*) FROM jobs")).count),
      0,
    );
    assert.ok(
      !(await f.db.query("SELECT * FROM audit_events")).rows.some((r) =>
        JSON.stringify(r).includes(key),
      ),
    );
  } finally {
    await f.cleanup();
  }
});
test("OpenAI fallback is ephemeral, model access respects workspace flags, and ambiguous connections fail closed", async () => {
  const f = await chatSettingsFixture();
  try {
    await f.reset({}, key);
    const resolved = (await new ChatProviders(f.p).read(f.db)).get("openai")!;
    assert.equal(resolved.configured, true);
    assert.equal(resolved.config.apiKey, key);
    assert.equal(resolved.storedConfig.apiKey, "");
    const config = await f.settings.config(f.admin);
    assert.deepEqual(Object.keys(config.models), ["gpt-4.1"]);
    assert.ok(!JSON.stringify(config).includes(key));
    await f.db.query(
      "UPDATE studio_policy SET flags=jsonb_set(flags,'{gpt-4.1}','false')",
    );
    assert.deepEqual((await f.settings.config(f.admin)).models, {});
    await f.settings.save(f.admin, "openai", encoded);
    await f.reset({ openai: key }, "");
    assert.equal(
      (await new ChatProviders(f.p).read(f.db)).get("openai")!.configured,
      true,
    );
    await f.p.createConnection(f.admin, {
      name: "duplicate",
      pluginId: chatStreaming.manifest.id,
      version: chatStreaming.manifest.version,
      config: f.wire.config("gpt-4.1"),
    });
    await assert.rejects(f.settings.read(f.admin), { status: 503 });
    assert.equal(f.wire.requests.length, 0);
  } finally {
    await f.cleanup();
  }
});
test("Concurrent first chat saves create one connection, preserve provider identity and reject stale Advanced edits", async () => {
  const f = await chatSettingsFixture();
  try {
    await f.db.query("DELETE FROM models WHERE connection_id=$1", [
      f.ids.deepseek,
    ]);
    await f.db.query("DELETE FROM connections WHERE id=$1", [f.ids.deepseek]);
    const before = await f.catalog.policy();
    await Promise.all(
      Array.from({ length: 5 }, () =>
        f.settings.save(f.admin, "deepseek", encoded),
      ),
    );
    const row = (await new ChatProviders(f.p).read(f.db)).get("deepseek")!.row!;
    assert.equal(row.revision, 5);
    assert.equal(row.enabled, true);
    assert.equal(
      (
        await f.db.query("SELECT id FROM connections WHERE plugin_id=$1", [
          chatStreaming.manifest.id,
        ])
      ).rows.length,
      2,
    );
    assert.deepEqual(await f.catalog.policy(), before);
    await assert.rejects(
      f.p.updateConnection(f.admin, row.id, {
        revision: row.revision,
        enabled: true,
        concurrency: 1,
        config: f.wire.config("gpt-4.1"),
      }),
      { status: 400 },
    );
    await assert.rejects(
      f.p.updateConnection(f.admin, row.id, {
        revision: 1,
        enabled: true,
        concurrency: 1,
      }),
      { status: 409 },
    );
    assert.equal(f.wire.requests.length, 0);
  } finally {
    await f.cleanup();
  }
});

test("Chat upgrades retire models from the other provider and cannot change an existing provider identity", async () => {
  const { Operations } =
    await import("../../packages/platform/src/operations.js");
  const { chatStudio } = await import("../../plugins/chat/src/studio.js");
  const f = await chatSettingsFixture();
  try {
    await f.db.transaction((sql) =>
      f.catalog.activate(sql, chatStudio.manifest),
    );
    const legacy = await f.p.createConnection(f.admin, {
      name: "legacy-chat",
      pluginId: chatStudio.manifest.id,
      version: chatStudio.manifest.version,
      config: { baseUrl: f.wire.origin, apiKey: key },
    });
    const operations = new Operations(f.p);
    await operations.upgrade(f.admin, legacy.id, {
      revision: 1,
      version: "1.2.0",
      activateCatalog: true,
      config: f.wire.config("deepseek-flash"),
    });
    const models = (
      await f.db.query(
        "SELECT provider_model,catalog_id,enabled FROM models WHERE connection_id=$1 ORDER BY provider_model",
        [legacy.id],
      )
    ).rows;
    assert.deepEqual(models, [
      {
        provider_model: "deepseek-flash",
        catalog_id: "deepseek-flash",
        enabled: false,
      },
      { provider_model: "gpt-4.1", catalog_id: null, enabled: false },
    ]);
    assert.equal(
      (
        await one(f.db, "SELECT enabled FROM connections WHERE id=$1", [
          legacy.id,
        ])
      ).enabled,
      false,
    );
    await assert.rejects(
      operations.upgrade(f.admin, legacy.id, {
        revision: 2,
        version: "1.2.0",
        config: f.wire.config("gpt-4.1"),
      }),
      { status: 400 },
    );
    assert.equal(
      (
        await one(f.db, "SELECT revision FROM connections WHERE id=$1", [
          legacy.id,
        ])
      ).revision,
      2,
    );
    assert.equal(f.wire.requests.length, 0);
  } finally {
    await f.cleanup();
  }
});
