import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { databaseFixture } from "../helpers/database.js";
import { StudioCatalog } from "../../packages/platform/src/catalog.js";
import { CanvasModels } from "../../packages/platform/src/canvas-models.js";
import { StudioPackages } from "../../packages/platform/src/studio-packages.js";
import { OriginalIdentity } from "../../packages/original-api/src/identity.js";
import { migrate } from "../../packages/platform/src/db.js";
import { museCanvas } from "../../plugins/muse/src/canvas.js";
import { flowCanvas } from "../../plugins/flow/src/canvas.js";
import { gpuCanvas } from "../../plugins/gpu/src/canvas.js";
import { imagesCanvas } from "../../plugins/images/src/canvas.js";
import { museLifecycle } from "../../plugins/muse/src/lifecycle.js";
import type { Manifest } from "../../packages/plugin-sdk/src/index.js";
const plugins = [museCanvas, flowCanvas, gpuCanvas, imagesCanvas];
async function activated() {
  const f = await databaseFixture();
  try {
    await f.p.registry.installBuiltins(f.db);
    await assert.rejects(CanvasModels.read(f.db), /原画布插件尚未完整启用/);
    const catalog = new StudioCatalog(f.db);
    await f.db.transaction(async (sql) => {
      for (const p of plugins) await catalog.activate(sql, p.manifest);
    });
    return { ...f, catalog };
  } catch (error) {
    await f.cleanup();
    throw error;
  }
}
test("Canvas contracts use explicitly active versions and keep prior plugin manifests immutable", async () => {
  const f = await activated();
  try {
    const rules = await CanvasModels.read(f.db);
    rules.validate("video", { model: "", ratio: "21:9", seconds: 15 });
    assert.throws(
      () => rules.validate("video", { model: "", ratio: "16:9", seconds: 6 }),
      /MiniMax H3 时长选项无效/,
    );
    assert.throws(
      () =>
        rules.validate("video", {
          model: "muse-video",
          ratio: "1:1",
          seconds: 7,
        }),
      /Muse 画幅选项无效/,
    );
    await f.db.query("UPDATE studio_policy SET flags='{}'::jsonb");
    (await CanvasModels.read(f.db)).validate("video", {
      model: "muse-video",
      ratio: "16:9",
      seconds: 6,
    });
    assert.equal(rules.template({}), "");
    assert.equal(
      rules.template({ "MiniMax H3": true, "muse-video": true }),
      "MiniMax H3",
    );
    assert.equal(rules.template({ "muse-video": true }), "muse-video");
    assert.equal(museLifecycle.manifest.canvas, undefined);
    await f.db.transaction((sql) =>
      f.catalog.activate(sql, museLifecycle.manifest),
    );
    assert.throws(
      () =>
        rules.validate("image", {
          model: "muse-video",
          ratio: "16:9",
          seconds: 5,
        }),
      /节点模型与生成类型不匹配/,
    );
    await f.p.registry.installBuiltins(f.db);
    assert.throws(() => new CanvasModels([]), /原画布插件尚未完整启用/);
    await assert.rejects(CanvasModels.read(f.db), /原画布插件尚未完整启用/);
    const changed = structuredClone(museCanvas.manifest);
    changed.canvas!.models[0].ratios!.error = "changed";
    await assert.rejects(
      f.p.registry.install(f.db, changed),
      /同一插件版本内容不可修改/,
    );
    for (const p of plugins) {
      assert.ok(p.manifest.queue!.timingVersions.includes(p.manifest.version));
      const resolved = await f.p.registry.resolve(
        f.db,
        p.manifest.id,
        p.manifest.version,
      );
      assert.equal(resolved.submit, p.submit);
    }
  } finally {
    await f.cleanup();
  }
});

const remote: Manifest = {
  id: "external-canvas",
  version: "1.0.0",
  contractVersion: 1,
  label: "外部画布模型",
  mode: "request",
  configSchema: { type: "object" },
  models: [
    {
      id: "external-video",
      label: "外部视频",
      kind: "video",
      inputSchema: { type: "object" },
      studio: {
        order: 1000,
        priceOrder: 1000,
        descriptor: { kind: "video", label: "外部视频" },
        prices: [
          {
            tier: "native",
            label: "原生",
            amount: 1,
            match: { type: "object" },
          },
        ],
      },
    },
  ],
  canvas: {
    version: 1,
    models: [
      {
        model: "external-video",
        kind: "video",
        templatePriority: 999,
        durations: { values: [7], error: "外部模型时长无效" },
      },
    ],
  },
};
test("External plugins declare canvas rules without core provider branches or upstream requests", async () => {
  const f = await activated();
  try {
    await f.p.registry.install(f.db, remote, "http://127.0.0.1:1");
    const rules = await CanvasModels.read(f.db);
    rules.validate("video", {
      model: "external-video",
      ratio: "16:9",
      seconds: 7,
    });
    assert.throws(
      () =>
        rules.validate("video", {
          model: "external-video",
          ratio: "16:9",
          seconds: 5,
        }),
      /外部模型时长无效/,
    );
    assert.equal(rules.template({ "external-video": true }), "external-video");
    const next = structuredClone(remote);
    next.version = "1.1.0";
    next.canvas!.models[0].durations!.values = [8];
    await f.p.registry.install(f.db, next, "http://127.0.0.1:1");
    (await CanvasModels.read(f.db)).validate("video", {
      model: "external-video",
      ratio: "16:9",
      seconds: 7,
    });
    await f.db.transaction((sql) => f.catalog.activate(sql, next));
    (await CanvasModels.read(f.db)).validate("video", {
      model: "external-video",
      ratio: "16:9",
      seconds: 8,
    });
    const ambiguous = structuredClone(next);
    ambiguous.version = "1.2.0";
    ambiguous.canvas!.models[0].defaultForKind = true;
    await f.p.registry.install(f.db, ambiguous, "http://127.0.0.1:1");
    await f.db.transaction((sql) => f.catalog.activate(sql, ambiguous));
    await assert.rejects(CanvasModels.read(f.db), /画布默认模型存在歧义/);
  } finally {
    await f.cleanup();
  }
});
test("Invalid canvas declarations fail installation without registering a partial catalog", async () => {
  const f = await databaseFixture();
  try {
    for (const mutate of [
      (m: Manifest) => {
        m.canvas!.models[0].model = "missing";
      },
      (m: Manifest) => {
        m.canvas!.models[0].kind = "image";
      },
      (m: Manifest) => {
        m.canvas!.models.push(m.canvas!.models[0]);
      },
      (m: Manifest) => {
        delete m.models[0].studio;
      },
      (m: Manifest) => {
        m.canvas!.models[0].templatePriority = -1;
      },
      (m: Manifest) => {
        m.canvas!.version = 2 as 1;
      },
    ]) {
      const invalid = structuredClone(remote);
      mutate(invalid);
      await assert.rejects(
        f.p.registry.install(f.db, invalid, "http://127.0.0.1:1"),
      );
      assert.equal(
        (await f.db.query("SELECT * FROM plugin_versions")).rows.length,
        0,
      );
      assert.equal(
        (await f.db.query("SELECT * FROM studio_catalog")).rows.length,
        0,
      );
    }
  } finally {
    await f.cleanup();
  }
});

test("CanvasModels respects compatible/explicit profiles, listed packages, v3 submissions and allowIncomplete", async () => {
  // 1. Compatible profile hides unconfigured legacy seeds and allows partial catalogs.
  const compat = await databaseFixture(
    "032_quarantine_retired_flow_sources.sql",
  );
  try {
    await compat.p.registry.installBuiltins(compat.db, true);
    await migrate(compat.db);
    await compat.p.registry.initializeStudio(compat.db, false);
    const empty = await CanvasModels.read(compat.db);
    empty.validate("sticky", { model: "", ratio: "16:9", seconds: 5 });
    empty.validate("image", { model: "", ratio: "16:9", seconds: 5 });
    empty.validate("video", { model: "", ratio: "16:9", seconds: 5 });
    assert.throws(
      () =>
        empty.validate("video", {
          model: "muse-video",
          ratio: "16:9",
          seconds: 5,
        }),
      /节点模型与生成类型不匹配/,
    );
    const identity = new OriginalIdentity(compat.p);
    await identity.bootstrap({
      name: "admin",
      nickname: "管理员",
      password: "compat-password",
    });
    const actor = await identity.actor(
      await identity.login(
        { name: "admin", password: "compat-password" },
        "fixture",
      ),
    );
    const packages = new StudioPackages(compat.p);
    const museFile = JSON.parse(
      await readFile("plugins/muse/muse.fmplugin.json", "utf8"),
    );
    await packages.install(actor, museFile);
    const partial = await CanvasModels.read(compat.db);
    partial.validate("image", { model: "", ratio: "16:9", seconds: 5 });
    partial.validate("video", { model: "", ratio: "16:9", seconds: 5 });
    partial.validate("video", {
      model: "muse-video",
      ratio: "16:9",
      seconds: 5,
    });
    assert.throws(
      () =>
        partial.validate("video", {
          model: "muse-video",
          ratio: "1:1",
          seconds: 5,
        }),
      /Muse 画幅选项无效/,
    );
    assert.throws(
      () =>
        partial.validate("video", {
          model: "MiniMax H3",
          ratio: "16:9",
          seconds: 5,
        }),
      /节点模型与生成类型不匹配/,
    );
  } finally {
    await compat.cleanup();
  }

  // 2. Explicit profile accepts v3 remote plugins without canvas policy and excludes removed packages.
  const explicit = await databaseFixture();
  try {
    await explicit.p.registry.initializeStudio(explicit.db, false);
    const identity = new OriginalIdentity(explicit.p);
    await identity.bootstrap({
      name: "admin",
      nickname: "管理员",
      password: "explicit-password",
    });
    const actor = await identity.actor(
      await identity.login(
        { name: "admin", password: "explicit-password" },
        "fixture",
      ),
    );
    const packages = new StudioPackages(explicit.p);
    const extFile = JSON.parse(
      await readFile(
        "plugins/example-extension/example-extension.fmplugin.json",
        "utf8",
      ),
    );
    await packages.install(actor, extFile);
    const withV3 = await CanvasModels.read(explicit.db);
    withV3.validate("image", {
      model: "example-extension-image",
      ratio: "16:9",
      seconds: 5,
    });
    assert.throws(
      () =>
        withV3.validate("video", {
          model: "example-extension-image",
          ratio: "16:9",
          seconds: 5,
        }),
      /节点模型与生成类型不匹配/,
    );
    const [pkg] = await packages.list(actor);
    await packages.change(actor, extFile.id, pkg.revision, "remove");
    const afterRemove = await CanvasModels.read(explicit.db);
    afterRemove.validate("image", { model: "", ratio: "16:9", seconds: 5 });
    assert.throws(
      () =>
        afterRemove.validate("image", {
          model: "example-extension-image",
          ratio: "16:9",
          seconds: 5,
        }),
      /节点模型与生成类型不匹配/,
    );
  } finally {
    await explicit.cleanup();
  }

  // 3. allowIncomplete lets blank/non-model nodes pass while strictly rejecting incomplete explicit models.
  const incomplete = await databaseFixture();
  try {
    await incomplete.p.registry.installBuiltins(incomplete.db);
    await assert.rejects(
      CanvasModels.read(incomplete.db),
      /原画布插件尚未完整启用/,
    );
    const tolerant = await CanvasModels.read(incomplete.db, {
      allowIncomplete: true,
    });
    tolerant.validate("sticky", { model: "", ratio: "16:9", seconds: 5 });
    tolerant.validate("text", { model: "", ratio: "16:9", seconds: 5 });
    tolerant.validate("image", { model: "", ratio: "16:9", seconds: 5 });
    tolerant.validate("video", { model: "", ratio: "16:9", seconds: 5 });
    assert.throws(
      () =>
        tolerant.validate("video", {
          model: "muse-video",
          ratio: "16:9",
          seconds: 5,
        }),
      { status: 503, message: "原画布插件尚未完整启用" },
    );
    assert.throws(
      () =>
        tolerant.validate("image", {
          model: "muse-video",
          ratio: "16:9",
          seconds: 5,
        }),
      { status: 400, message: "节点模型与生成类型不匹配" },
    );
    assert.throws(
      () =>
        tolerant.validate("video", {
          model: "unknown-model",
          ratio: "16:9",
          seconds: 5,
        }),
      { status: 400, message: "节点模型与生成类型不匹配" },
    );
  } finally {
    await incomplete.cleanup();
  }
});
