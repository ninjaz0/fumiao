import test from "node:test";
import assert from "node:assert/strict";
import { imageSettingsFixture } from "../helpers/image-settings.js";
import { one } from "@fumiao/platform/db.js";
import { imagesSettings } from "@fumiao/plugin-images/settings.js";
import { imagesLifecycle } from "@fumiao/plugin-images/lifecycle.js";
const body = { enabled: false, default_model: "gpt-image-2.6-sunburst" };
test("Original image settings preserve model-switch revision semantics, hidden models and simultaneous updates without storing credentials", async () => {
  const f = await imageSettingsFixture();
  try {
    const initial = await f.catalog.policy();
    await Promise.all(
      Array.from({ length: 5 }, () => f.settings.save(f.admin, "openai", body)),
    );
    const policy = await f.catalog.policy();
    assert.equal(policy.revision, initial.revision + 5);
    for (const id of imagesSettings.manifest.originalImageSettings!
      .controlledModels)
      assert.equal(policy.enabled[id], false);
    assert.equal(
      (await one(f.db, "SELECT image_enabled FROM original_state_settings"))
        .image_enabled,
      false,
    );
    const flowImage = await one(
      f.db,
      "SELECT id FROM studio_catalog WHERE descriptor->>'kind'='image' AND id LIKE 'flow:%' LIMIT 1",
    );
    await f.db.query(
      "UPDATE studio_catalog SET hidden=false,hidden_override=false WHERE id=$1",
      [flowImage.id],
    );
    await f.db.query(
      "UPDATE studio_policy SET flags=jsonb_set(flags,ARRAY[$1]::text[],'true')",
      [flowImage.id],
    );
    const response = await f.settings.save(f.admin, "openai", body);
    assert.equal(response.enabled, true);
    await f.db.query(
      "UPDATE studio_catalog SET hidden=true WHERE id='muse-image'",
    );
    const updated = await f.settings.save(f.admin, "openai", {
      ...body,
      enabled: true,
    });
    assert.equal(updated.models["muse-image"], undefined);
    assert.equal((await f.catalog.policy()).enabled["muse-image"], false);
    assert.ok(!JSON.stringify(updated).includes("sk-local"));
    assert.equal(f.requests.length, 0);
  } finally {
    await f.cleanup();
  }
});
test("Original image probe authenticates administrators, accepts any valid JSON, preserves safe errors and never creates a task", async () => {
  const f = await imageSettingsFixture();
  try {
    assert.equal(
      (await f.request("POST", "/api/settings/openai/check", {}, 1)).status,
      403,
    );
    assert.equal(
      (await f.request("POST", "/api/settings/openai/check", {}, 2)).status,
      401,
    );
    assert.equal(
      (
        await f.request(
          "POST",
          "/api/settings/openai/check",
          {},
          0,
          "https://foreign.example",
        )
      ).status,
      403,
    );
    for (const raw of ["{}", "[]", "null", "1", "NaN"]) {
      f.setWire({ raw });
      const r = await f.request("POST", "/api/settings/openai/check", {});
      assert.equal(r.status, 200);
      assert.deepEqual(r.body, { ok: true, model: body.default_model });
    }
    assert.ok(
      f.requests.every(
        (r) =>
          r.method === "GET" &&
          r.path === "/v1/models/" + body.default_model &&
          r.authorization === "Bearer sk-local-fixture" &&
          r.body === null,
      ),
    );
    f.setWire({ status: 401, raw: '{"error":{"code":"insufficient_quota"}}' });
    assert.deepEqual(
      (await f.request("POST", "/api/settings/openai/check", {})).body,
      { detail: "OpenAI API 额度不足，请管理员检查额度" },
    );
    f.setWire({ raw: "invalid" });
    const failed = await f.request("POST", "/api/settings/openai/check", {});
    assert.equal(failed.status, 500);
    assert.equal(failed.body, "Internal Server Error");
    assert.equal(failed.contentType, "text/plain; charset=utf-8");
    assert.equal(
      Number((await one(f.db, "SELECT count(*) FROM jobs")).count),
      0,
    );
    assert.equal(imagesLifecycle.manifest.originalImageSettings, undefined);
    await assert.rejects(
      f.p.registry.install(
        f.db,
        { ...imagesSettings.manifest, id: "remote-settings" },
        "https://plugin.example",
      ),
      { status: 400 },
    );
  } finally {
    await f.cleanup();
  }
});
test("Settings errors roll back policy changes and ambiguous connections never pick arbitrary credentials", async () => {
  const f = await imageSettingsFixture();
  try {
    await f.p.createConnection(f.admin, {
      name: "duplicate",
      pluginId: imagesSettings.manifest.id,
      version: imagesSettings.manifest.version,
      config: f.config,
    });
    const before = await f.catalog.policy();
    await assert.rejects(f.settings.save(f.admin, "openai", body), {
      status: 503,
    });
    assert.deepEqual(await f.catalog.policy(), before);
    assert.equal(
      (await f.request("POST", "/api/settings/openai/check", {})).status,
      503,
    );
    assert.equal(f.requests.length, 0);
  } finally {
    await f.cleanup();
  }
});
