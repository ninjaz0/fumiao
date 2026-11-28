import { canvasRunsFixture } from "../helpers/canvas-runs.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canvasNodeEntries } from "@fumiao/platform/canvas-node-plugins.js";
import { StudioPackages } from "@fumiao/platform/studio-packages.js";
import { StudioUpdates } from "@fumiao/platform/studio-updates.js";
import { runCanvasPlugin } from "@fumiao/original-api/canvas-plugin-runs.js";
import { canvasesFixture } from "../helpers/canvases.js";

const legacyShotPrompt = () =>
  readFile(
    "tests/fixtures/legacy-shot-prompt.fmplugin.json",
    "utf8",
  ).then(JSON.parse);

const sample = async () => ({ ...(await legacyShotPrompt()), id: "test-canvas-node" });

test("retired shot-prompt nodes preserve saved output and reject new runs", async (t) => {
  const f = await canvasesFixture();
  t.after(f.cleanup);
  const file = await legacyShotPrompt();
  const packages = new StudioPackages(f.p);
  await f.db.query(
    "INSERT INTO studio_package_releases (id, version, package) VALUES ($1, $2, $3)",
    [file.id, file.version, file],
  );
  await f.db.query(
    "INSERT INTO studio_packages (id, version, enabled, update_url) VALUES ($1, $2, false, $3)",
    [file.id, file.version, "https://example.invalid/retired-update.json"],
  );
  assert.deepEqual(await canvasNodeEntries(f.db), []);
  assert.equal((await packages.list(f.admin)).some((pkg) => pkg.id === file.id), false);
  await assert.rejects(packages.preview(f.admin, file), { status: 409 });
  await assert.rejects(packages.install(f.admin, file), { status: 409 });
  await assert.rejects(packages.change(f.admin, file.id, 1, "enable"), { status: 409 });
  const updates = new StudioUpdates(f.p);
  await assert.rejects(
    updates.configure(f.admin, file.id, { revision: 1, url: "https://example.com/update.json" }),
    { status: 409 },
  );
  await assert.rejects(updates.check(file.id), { status: 409 });
  await updates.due();
  const [pkgRow] = (
    await f.db.query("SELECT checked_at FROM studio_packages WHERE id = $1", [file.id])
  ).rows;
  assert.equal(pkgRow.checked_at, null, "retired plugin must not be polled by StudioUpdates.due()");

  const pluginNodeSrc = await readFile("apps/web/canvas-editor/PluginNode.tsx", "utf8");
  assert.match(pluginNodeSrc, /此示例插件节点已停用，仍可查看和复制已保存的输出/);

  const { program: _, ...node } = file.contributes.canvasNodes[0];
  const extension = {
    definition: { ...node, plugin: file.id, version: file.version },
    values: { framing: "全景" },
    result: { prompt: "全景：日出" },
  };
  const project = await f.canvases.create(f.admin, {});
  const saved = await f.canvases.save(f.admin, project.id, {
    title: project.title,
    expected_revision: project.revision,
    document: {
      nodes: [
        { id: "text", type: "text", x: 0, y: 0, text: "日出" },
        { id: "shot", type: "plugin", x: 350, y: 0, extension },
      ],
      edges: [{ id: "input", source: "text", target: "shot", targetPort: "script" }],
    },
  });
  await assert.rejects(
    runCanvasPlugin(f.canvases, f.admin, project.id, "shot", {
      expected_revision: saved.revision,
      uid: randomUUID(),
    }),
    { status: 409 },
  );
  assert.deepEqual((await f.canvases.get(f.admin, project.id)).document.nodes[1].extension, extension);
});

test("canvas ports resolve a sandbox node from the saved revision and replay the same run once", async (t) => {
  const f = await canvasesFixture();
  t.after(f.cleanup);
  const pkgs = new StudioPackages(f.p);
  const file = await sample();
  await pkgs.install(f.admin, file);
  assert.equal((await canvasNodeEntries(f.db)).length, 0);
  await pkgs.change(f.admin, file.id, 1, "enable");
  const [definition] = await canvasNodeEntries(f.db);
  assert.equal("program" in definition, false);
  const project = await f.canvases.create(f.admin, {});
  const input = {
    id: "text",
    type: "text",
    x: 0,
    y: 0,
    text: "山谷\u0000清晨",
  };
  const plugin = {
    id: "compose",
    type: "plugin",
    x: 350,
    y: 0,
    extension: { definition, values: { framing: "特写" } },
  };
  const native = { id: "video", type: "video", x: 680, y: 0 };
  const nodes = [input, plugin, native];
  const edges = [
    { id: "in", source: "text", target: "compose", targetPort: "script" },
    { id: "out", source: "compose", sourcePort: "prompt", target: "video" },
  ];
  const save = (document: unknown, revision = 1) =>
    f.canvases.save(f.admin, project.id, {
      expected_revision: revision,
      title: project.title,
      document,
    });
  for (const invalid of [
    { nodes, edges: [{ ...edges[0], targetPort: "wrong" }] },
    { nodes, edges: [edges[0], { ...edges[0], id: "again" }] },
    { nodes, edges: [{ ...edges[1], sourcePort: "absent" }] },
    {
      nodes: [
        {
          ...plugin,
          extension: { ...plugin.extension, values: { framing: "invalid" } },
        },
      ],
    },
    {
      nodes: [
        {
          ...plugin,
          extension: {
            ...plugin.extension,
            definition: { ...definition, inputs: [] },
          },
        },
      ],
    },
  ])
    await assert.rejects(save(invalid));
  const saved = await save({ nodes, edges });
  const body = { uid: randomUUID(), expected_revision: saved.revision };
  const execute = (actor = f.admin, request = body) =>
    runCanvasPlugin(f.canvases, actor, project.id, "compose", request);
  await assert.rejects(execute(f.member), { status: 404 });
  await assert.rejects(execute(f.admin, { ...body, expected_revision: 1 }), {
    status: 409,
  });
  const [first, replayed] = await Promise.all([execute(), execute()]);
  assert.deepEqual(first, replayed);
  assert.equal(
    first.document.nodes[1].extension.result.prompt,
    "特写：山谷\u0000清晨",
  );
  assert.equal(
    (await f.db.query("SELECT node,package_version FROM canvas_plugin_runs"))
      .rows.length,
    1,
  );
  const copy = await f.canvases.duplicate(f.admin, project.id);
  assert.deepEqual(
    copy.document.nodes[1].extension,
    first.document.nodes[1].extension,
  );
  await pkgs.change(f.admin, file.id, 2, "remove");
  assert.deepEqual(await canvasNodeEntries(f.db), []);
  await assert.rejects(
    execute(f.admin, { uid: randomUUID(), expected_revision: first.revision }),
    { status: 409 },
  );
  assert.deepEqual(
    (await save(first.document, first.revision)).document.nodes[1].extension,
    first.document.nodes[1].extension,
  );
});

test("a sandbox output feeds native video submission and its frozen job inputs", async (t) => {
  const f = await canvasRunsFixture();
  t.after(f.cleanup);
  const file = await sample();
  const pkgs = new StudioPackages(f.p);
  await pkgs.install(f.admin, file);
  await pkgs.change(f.admin, file.id, 1, "enable");
  const [definition] = await canvasNodeEntries(f.db);
  const project = await f.project(
    [
      { id: "source", type: "text", x: 0, y: 0, text: "夜间街道" },
      {
        id: "compose",
        type: "plugin",
        x: 300,
        y: 0,
        extension: { definition, values: { framing: "中景" } },
      },
      { id: "v", type: "video", x: 650, y: 0, prompt: "慢速平移" },
    ],
    [
      { id: "a", source: "source", target: "compose", targetPort: "script" },
      { id: "b", source: "compose", sourcePort: "prompt", target: "v" },
    ],
  );
  const view = await runCanvasPlugin(f.canvases, f.admin, project, "compose", {
    expected_revision: 2,
    uid: randomUUID(),
  });
  const job = await f.runs.generate(
    f.admin,
    project,
    "v",
    f.body({ expected_revision: view.revision }),
  );
  const [row] = (
    await f.db.query("SELECT input FROM jobs WHERE public_id=$1", [job.id])
  ).rows;
  assert.equal(row.input.prompt, "中景：夜间街道\n\n慢速平移");
});

test("canvas media ports validate workspace access and roll back failed outputs and plugin data together", async (t) => {
  const f = await canvasesFixture();
  t.after(f.cleanup);
  const packages = new StudioPackages(f.p);
  const file = await sample(),
    decl = file.contributes.canvasNodes[0];
  const local = await f.asset("a".repeat(32));
  const foreign = await f.asset("b".repeat(32), "ref", f.memberSpace, f.member);
  decl.inputs = [{ id: "input", title: "输入", kind: "image" }];
  decl.outputs = [{ id: "result", title: "输出", kind: "image" }];
  decl.fields = [];
  decl.program = `({ async run(_input, host) {
    await host.data.put("used", true);
    return {result: "${foreign.public_id}"};
  } })`;
  await assert.rejects(packages.preview(f.admin, file), /media/);
  file.contributes.hostCapabilities = ["data", "media"];
  await packages.install(f.admin, file);
  await packages.change(f.admin, file.id, 1, "enable");
  const [definition] = await canvasNodeEntries(f.db);
  const p = await f.canvases.create(f.admin, {});
  const nodes = [
    { id: "image", type: "image", x: 0, y: 0, media_id: local.public_id },
    {
      id: "plugin",
      type: "plugin",
      x: 300,
      y: 0,
      extension: { definition, values: {} },
    },
  ];
  const edges = [
    { id: "edge", source: "image", target: "plugin", targetPort: "input" },
  ];
  const doc = await f.canvases.save(f.admin, p.id, {
    title: p.title,
    expected_revision: 1,
    document: { nodes, edges },
  });
  await assert.rejects(
    runCanvasPlugin(f.canvases, f.admin, p.id, "plugin", {
      uid: randomUUID(),
      expected_revision: doc.revision,
    }),
    { status: 404 },
  );
  assert.equal((await f.canvases.get(f.admin, p.id)).revision, doc.revision);
  assert.deepEqual(
    (await f.db.query("SELECT node FROM canvas_plugin_runs")).rows,
    [],
  );
  assert.deepEqual(
    (
      await f.db.query(
        "SELECT key FROM studio_plugin_data WHERE plugin_id=$1",
        [file.id],
      )
    ).rows,
    [],
  );
});
