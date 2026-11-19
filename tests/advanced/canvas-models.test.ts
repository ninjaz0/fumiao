import test from "node:test";
import assert from "node:assert/strict";
import { databaseFixture } from "../helpers/database.js";
import { StudioCatalog } from "../../packages/platform/src/catalog.js";
import { CanvasModels } from "../../packages/platform/src/canvas-models.js";
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
