import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test, { type TestContext } from "node:test";
import { OriginalIdentity } from "../../packages/original-api/src/identity.js";
import { one } from "../../packages/platform/src/db.js";
import {
  PluginSettingsStore,
  type SettingsTarget,
} from "../../packages/platform/src/plugin-settings.js";
import {
  packageFile,
  StudioPackages,
  type PackageFile,
} from "../../packages/platform/src/studio-packages.js";
import { StudioUpdates } from "../../packages/platform/src/studio-updates.js";
import { databaseFixture } from "../helpers/database.js";

async function setup(t: TestContext) {
  const f = await databaseFixture();
  t.after(f.cleanup);
  await f.p.registry.initializeStudio(f.db, false);
  const identity = new OriginalIdentity(f.p);
  const credentials = { name: "admin", password: randomUUID() };
  await identity.bootstrap({ ...credentials, nickname: "插件测试" });
  const actor = await identity.actor(
    await identity.login(credentials, "fixture"),
  );
  return { ...f, actor, packages: new StudioPackages(f.p) };
}

async function remoteFile() {
  const manifest = JSON.parse(
    await readFile("plugins/example-studio/manifest.json", "utf8"),
  );
  return {
    format: 1,
    id: manifest.id,
    label: manifest.label,
    version: "1.0.0",
    adapterVersion: manifest.version,
    remote: { manifest, endpoint: "http://127.0.0.1:1" },
  };
}
const page = {
  id: "status",
  title: "状态",
  scopes: ["plugin"],
  program: "({view(){return {schema:1,title:'状态',blocks:[]}}})",
};
const objectSchema = { type: "object" };
const schema = (field: string) => ({
  type: "object",
  required: [field],
  additionalProperties: false,
  properties: { [field]: { type: "string", default: "默认" } },
});

test("preview and import reject conflicting formats and invalid contribution permissions", async (t) => {
  const { actor, packages, p, db } = await setup(t);
  const file = await remoteFile();
  const conflict = {
    ...file,
    settingsPage: { title: "旧格式", render: "()=>({})" },
    contributes: { version: 1 },
  };
  assert.equal(packageFile.safeParse(conflict).success, false);
  const both = (value: unknown, message: RegExp) =>
    Promise.all([
      assert.rejects(packages.preview(actor, value), { status: 400, message }),
      assert.rejects(packages.install(actor, value, 1), {
        status: 400,
        message,
      }),
    ]);
  await both(conflict, /contributes.*settingsPage/);
  await both({ ...conflict, settingsPage: null }, /contributes.*settingsPage/);
  await packages.install(actor, {
    ...file,
    contributes: { version: 1, settingsPages: [page] },
  });
  const upgrade = (fields: object) => ({
    ...file,
    version: "1.1.0",
    contributes: { version: 1, ...fields },
  });
  await both(upgrade({ settingsPages: [page, page] }), /设置页标识重复/);
  await both(
    upgrade({
      settingsPages: [{ ...page, audience: "member", scopes: ["services"] }],
    }),
    /成员设置页不能读取/,
  );
  await both(
    upgrade({
      settingsPages: [
        {
          ...page,
          actions: [{ id: "pair", kind: "host", operation: "nodes.pair" }],
        },
      ],
    }),
    /需要宿主能力/,
  );
  await both(
    upgrade({
      settings: {
        global: {
          type: "object",
          properties: { key: { type: "string", writeOnly: true } },
        },
      },
    }),
    /密钥字段/,
  );
  await both(
    upgrade({
      settings: {
        global: { type: "object", properties: { x: { $ref: "#/missing" } } },
      },
    }),
    /全站设置的 JSON Schema 无效/,
  );
  await both(
    upgrade({ settings: { global: { type: "object", $async: true } } }),
    /仅支持同步 JSON Schema/,
  );
  await both(upgrade({ hostCapabilities: ["nodes"] }), /节点能力需要 pull/);
  await both(
    {
      ...upgrade({ hostCapabilities: ["nodes"] }),
      program: "({plan(){return {}}})",
      remote: {
        ...file.remote,
        manifest: { ...file.remote.manifest, mode: "pull" },
      },
    },
    /NodeManagement/,
  );
  assert.equal((await packages.list(actor))[0].version, file.version);
  await assert.rejects(p.registry.nodeExtension(db), { status: 404 });
});

test("update-source review compares each page, action, audience, visibility and settings scope", async (t) => {
  const { p, packages, actor } = await setup(t);
  const file = await remoteFile();
  const form = {
    ...page,
    id: "config",
    title: "配置",
    actions: [{ id: "save", kind: "settings", scope: "global" }],
  };
  const contributes = {
    version: 1,
    settings: { global: objectSchema },
    settingsPages: [{ ...page, visibleWhen: "enabled" }, form],
  };
  const first = { ...file, contributes };
  const initial = (await packages.preview(actor, first)).changes.join("\n");
  assert.match(initial, /状态.*管理员.*启用时可见.*读取：插件信息.*操作：无/);
  assert.match(initial, /配置.*save · 保存全站设置/);
  assert.match(initial, /设置范围：全站/);
  await packages.install(actor, first);
  const next = {
    ...file,
    version: "2.0.0",
    contributes: {
      version: 1,
      settings: { global: objectSchema, workspace: objectSchema },
      settingsPages: [
        { ...page, audience: "member", scopes: ["models", "plugin"] },
        { ...form, actions: [{ ...form.actions[0], scope: "workspace" }] },
        {
          ...page,
          id: "jobs",
          title: "最近任务",
          scopes: ["jobs", "services", "settings"],
          actions: [{ id: "run", kind: "program" }],
        },
      ],
    },
  };
  let payload: { version: string; settingsPage?: object } = next;
  const hash = () =>
    createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const server = createServer((req, res) =>
    res.end(
      JSON.stringify(
        req.url === "/release.json"
          ? payload
          : {
              id: file.id,
              version: payload.version,
              notes: "",
              package: "release.json",
              sha256: hash(),
            },
      ),
    ),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const updates = new StudioUpdates(p);
  await updates.configure(actor, file.id, {
    revision: 1,
    url:
      "http://127.0.0.1:" +
      (server.address() as AddressInfo).port +
      "/update.json",
  });
  await updates.check(file.id);
  const reviewed = await updates.review(actor, file.id);
  assert.deepEqual(reviewed, await packages.preview(actor, next));
  const lines = reviewed.changes.join("\n");
  assert.match(
    lines,
    /状态.*成员（扩大）.*安装后可见（扩大）.*插件模型（新增）、插件信息；/,
  );
  assert.match(lines, /配置.*save · 保存工作区设置（新增）/);
  assert.match(
    lines,
    /最近任务.*（新增）.*任务记录.*服务连接.*插件设置.*run · 运行页面程序/,
  );
  assert.match(lines, /设置范围：全站、工作区（新增）/);
  await updates.check(file.id, { actor, revision: 2, sha256: hash() });
  assert.doesNotMatch(
    (await packages.preview(actor, next)).changes.join("\n"),
    /（新增）|（扩大）/,
  );
  payload = {
    ...next,
    settingsPage: { title: "冲突", render: "()=>null" },
    version: "3.0.0",
  };
  await updates.check(file.id);
  await assert.rejects(updates.review(actor, file.id), {
    status: 400,
    message: /contributes.*settingsPage/,
  });
});

test("node binding follows normalized capabilities across legacy and page-less GPU releases", async (t) => {
  const { p, db, actor, packages } = await setup(t);
  const legacy: PackageFile = JSON.parse(
    await readFile("plugins/gpu/gpu.fmplugin.json", "utf8"),
  );
  const preview = await packages.preview(actor, legacy);
  assert.equal(preview.nodes, true);
  assert.match(
    preview.changes.join("\n"),
    /GPU 节点.*管理员.*节点状态.*配对节点.*移除节点/,
  );
  await packages.install(actor, legacy);
  const binding = await p.registry.nodeExtension(db);
  assert.ok(binding.NodeManagement);
  const { settingsPage, ...rest } = legacy;
  assert.ok(settingsPage);
  const next = {
    ...rest,
    version: "2.0.0",
    contributes: { version: 1, hostCapabilities: ["nodes"] },
  };
  assert.doesNotMatch(
    (await packages.preview(actor, next)).changes.join("\n"),
    /节点管理（新增）/,
  );
  await packages.install(actor, next, 1);
  assert.deepEqual(await p.registry.nodeExtension(db, legacy.id), binding);
  await assert.rejects(p.registry.nodeExtension(db, "unrelated"), {
    status: 404,
  });
  await packages.install(
    actor,
    {
      ...rest,
      version: "3.0.0",
      contributes: { version: 1, settingsPages: [page] },
    },
    2,
  );
  await assert.rejects(p.registry.nodeExtension(db), { status: 404 });
  const stored = await one(
    db,
    "SELECT package FROM studio_package_releases WHERE id=$1 AND version=$2",
    [legacy.id, legacy.version],
  );
  assert.deepEqual(stored.package, legacy);
});

test("upgrade is atomic and rollback restores snapshots while migrating newly saved workspace settings", async (t) => {
  const { db, actor, packages } = await setup(t);
  const file = await remoteFile();
  const first = {
    ...file,
    contributes: {
      version: 1,
      settings: {
        global: { ...schema("old"), $id: "https://fixture.test/style" },
        workspace: {
          ...schema("old"),
          properties: { old: { type: "string", minLength: 1 } },
        },
        migrate: "(v) => ({old:v.current})",
      },
    },
  };
  const second = {
    ...file,
    version: "2.0.0",
    contributes: {
      version: 1,
      settings: {
        global: { ...schema("current"), $id: "https://fixture.test/style" },
        workspace: schema("current"),
        migrate:
          "(v, {scope,from,to}) => ({current: [v.old,scope,from,to].join('/')})",
      },
    },
  };
  const store = new PluginSettingsStore();
  const global: SettingsTarget = {
    pluginId: file.id,
    scope: "global",
    workspaceId: null,
  };
  const workspace: SettingsTarget = {
    pluginId: file.id,
    scope: "workspace",
    workspaceId: (await one(db, "SELECT id FROM workspaces WHERE kind='team'"))
      .id,
  };
  const rows = async () =>
    (
      await db.query(
        "SELECT * FROM studio_plugin_settings WHERE plugin_id=$1 ORDER BY scope",
        [file.id],
      )
    ).rows;
  await packages.install(actor, first);
  await db.transaction((sql) =>
    store.write(sql, {
      ...global,
      declaration: first.contributes.settings,
      packageVersion: first.version,
      values: { old: "原值" },
      revision: 0,
      actorId: actor.id,
    }),
  );
  const before = await rows();
  const initialPolicy = await one(db, "SELECT revision FROM studio_policy");
  for (const migrate of ["() => { throw Error() }", "() => ({current:17})"]) {
    await assert.rejects(
      packages.install(
        actor,
        {
          ...second,
          contributes: {
            version: 1,
            settings: { ...second.contributes.settings, migrate },
          },
        },
        1,
      ),
      { status: 400, message: /插件设置迁移/ },
    );
    assert.deepEqual(await rows(), before);
    assert.deepEqual(
      await one(db, "SELECT revision FROM studio_policy"),
      initialPolicy,
    );
    assert.equal(
      await one(
        db,
        "SELECT 1 FROM studio_package_releases WHERE id=$1 AND version=$2",
        [file.id, second.version],
      ),
      undefined,
    );
    const [pkg] = await packages.list(actor);
    assert.equal(pkg.version, first.version);
    assert.equal(pkg.revision, 1);
  }
  await packages.install(actor, second, 1);
  await packages.install(actor, second, 1);
  assert.deepEqual(await store.read(db, global, second.contributes.settings), {
    values: { current: "原值/global/1.0.0/2.0.0" },
    revision: 2,
  });
  const saveWorkspace = (current: string, revision: number) =>
    db.transaction((sql) =>
      store.write(sql, {
        ...workspace,
        declaration: second.contributes.settings,
        packageVersion: second.version,
        values: { current },
        revision,
        actorId: actor.id,
      }),
    );
  await saveWorkspace("", 0);
  const beforeRollback = await rows();
  await assert.rejects(packages.install(actor, first, 2, true), {
    status: 400,
    message: /设置迁移结果不符合新版本声明/,
  });
  assert.deepEqual(await rows(), beforeRollback);
  assert.equal((await packages.list(actor))[0].version, second.version);
  await saveWorkspace("新工作区", 1);
  await packages.install(actor, first, 2, true);
  assert.deepEqual(await store.read(db, global, first.contributes.settings), {
    values: { old: "原值" },
    revision: 3,
  });
  assert.deepEqual(
    await store.read(db, workspace, first.contributes.settings),
    { values: { old: "新工作区" }, revision: 3 },
  );
  assert.ok((await rows()).every((r) => r.package_version === first.version));
});

test("settings survive disable and pending removal, then reinstall starts from defaults", async (t) => {
  const { p, db, actor, packages } = await setup(t);
  const file = await remoteFile();
  const declaration = { global: schema("style") };
  const release = {
    ...file,
    contributes: { version: 1, settings: declaration },
  };
  await packages.install(actor, release);
  const { id: service } = await p.createConnection(
    actor,
    {
      pluginId: file.id,
      version: file.adapterVersion,
      name: "测试服务",
      config: { apiKey: "test" },
    },
    true,
  );
  const store = new PluginSettingsStore();
  const target: SettingsTarget = {
    pluginId: file.id,
    scope: "global",
    workspaceId: null,
  };
  await db.transaction((sql) =>
    store.write(sql, {
      ...target,
      declaration,
      packageVersion: file.version,
      values: { style: "已保存" },
      revision: 0,
      actorId: actor.id,
    }),
  );
  const read = () => store.read(db, target, declaration);
  const revision = async () => (await packages.list(actor))[0].revision;
  await packages.change(actor, file.id, await revision(), "disable");
  const saved = { values: { style: "已保存" }, revision: 1 };
  assert.deepEqual(await read(), saved);
  const job = await one(
    db,
    `INSERT INTO jobs(id,workspace_id,owner_id,model_id,connection_id,plugin_id,plugin_version,
    package_version,config_snapshot,provider_model,kind,input,idempotency_key,request_hash,price,state)
    SELECT gen_random_uuid(),w.id,$1,m.id,c.id,c.plugin_id,c.plugin_version,$2,c.config,m.provider_model,m.kind,'{}','fixture','fixture',0,'running'
    FROM connections c JOIN models m ON m.connection_id=c.id CROSS JOIN workspaces w WHERE c.id=$3 LIMIT 1 RETURNING id`,
    [actor.id, file.version, service],
  );
  await packages.change(actor, file.id, await revision(), "remove");
  await packages.finishRemovals();
  assert.ok((await packages.list(actor))[0].removing);
  assert.deepEqual(await read(), saved);
  await db.query("UPDATE jobs SET state='completed' WHERE id=$1", [job.id]);
  await packages.finishRemovals();
  assert.deepEqual(await packages.list(actor), []);
  await packages.install(actor, release);
  assert.deepEqual(await read(), { values: { style: "默认" }, revision: 0 });
});
