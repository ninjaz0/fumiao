import { seedLegacyPackage, legacyPackage } from "../helpers/legacy-studio.js";
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createOriginalApp } from "../../apps/api/src/original.js";
import { OriginalIdentity } from "@fumiao/original-api/identity.js";
import { one } from "@fumiao/platform/db.js";
import { databaseFixture } from "../helpers/database.js";
import type { PluginPageEntry } from "@fumiao/plugin-sdk/contributions.js";

const echo = `({view(input){return {schema:1,title:'输入',blocks:[{type:'text',text:JSON.stringify(input)}]}}})`;
const page = (id: string, extra: object = {}) => ({
  id,
  title: id,
  program: echo,
  ...extra,
});
const formSchema = {
  type: "object",
  additionalProperties: false,
  properties: { style: { type: "string", enum: ["A", "B"], default: "A" } },
};

async function setup(t: TestContext) {
  const f = await databaseFixture();
  t.after(() => f.cleanup());
  await f.p.registry.initializeStudio(f.db, false);
  const identity = new OriginalIdentity(f.p),
    password = randomUUID();
  await identity.bootstrap({ name: "admin", nickname: "测试管理员", password });
  const session = await identity.login({ name: "admin", password }, "fixture");
  const admin = await identity.actor(session);
  const member = await f.db.transaction((sql) =>
    f.p.createUser(sql, "member", "测试成员", password, "member"),
  );
  const memberSession = await identity.login(
    { name: "member", password },
    "fixture",
  );
  const file = await legacyPackage("gpu");
  await seedLegacyPackage(f.p, file);
  const app = await createOriginalApp(f.p);
  await app.listen(0, "127.0.0.1");
  t.after(() => app.close());
  const base = await app.getUrl();
  const team = await one(f.db, "SELECT * FROM workspaces WHERE kind='team'");
  await f.db.query("INSERT INTO members(workspace_id,user_id) VALUES($1,$2)", [
    team.id,
    member.id,
  ]);
  const personal = await one(
    f.db,
    "SELECT public_id FROM workspaces WHERE owner_id=$1 AND kind='personal'",
    [admin.id],
  );
  const url = (path: string) =>
    path.startsWith("/") ? path : "/api/plugins/gpu/pages/" + path;
  const call = async (
    path: string,
    body: unknown = {},
    token = session,
    workspace = team.public_id,
  ) => {
    const res = await fetch(base + url(path), {
      method: path === "/api/state" ? "GET" : "POST",
      headers: {
        cookie: "fm_session=" + token,
        "content-type": "application/json",
        "x-workspace-id": String(workspace),
      },
      ...(path === "/api/state"
        ? {}
        : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    });
    return { status: res.status, data: await res.json() };
  };
  const ok = async (...args: Parameters<typeof call>) => {
    const res = await call(...args);
    assert.equal(res.status, 200, JSON.stringify(res.data));
    return res.data;
  };
  const contributes = (value: unknown) =>
    f.db.query(
      `UPDATE studio_package_releases SET package=(package-'settingsPage') || jsonb_build_object('contributes',$1::jsonb) WHERE id='gpu'`,
      [JSON.stringify(value)],
    );
  return {
    ...f,
    admin,
    member,
    memberSession,
    team,
    personal,
    session,
    file,
    call,
    ok,
    contributes,
  };
}

test("Studio lists installed pages in group/order/title order and authorizes direct views", async (t) => {
  const f = await setup(t);
  await f.contributes({
    version: 1,
    settingsPages: [
      page("admin", { order: 3, title: "Beta" }),
      page("first", { order: 3, title: "Alpha" }),
      page("summary", { audience: "member", group: "account", order: 70 }),
      page("later", { group: "billing", order: 0 }),
      page("active", { visibleWhen: "enabled" }),
      page("bad", {
        program:
          "({view(){return {schema:1,title:'x',blocks:[{type:'text',text:'x',html:'invalid'}]}}})",
      }),
    ],
  });
  await f.db.query(
    `INSERT INTO studio_package_releases VALUES('extra','2.0.0',$1)`,
    [
      JSON.stringify({
        contributes: {
          version: 1,
          settingsPages: [page("tools", { order: 2 })],
        },
      }),
    ],
  );
  await f.db.query(
    "INSERT INTO studio_packages(id,version,removing) VALUES('extra','2.0.0',true)",
  );
  const keys = async (token: string) =>
    (
      (await f.ok("/api/state", {}, token)).plugin_pages as PluginPageEntry[]
    ).map((p) => p.key);
  assert.deepEqual(await keys(f.session), [
    "plugin:gpu:summary",
    "plugin:extra:tools",
    "plugin:gpu:first",
    "plugin:gpu:admin",
    "plugin:gpu:bad",
    "plugin:gpu:later",
  ]);
  assert.deepEqual(await keys(f.memberSession), ["plugin:gpu:summary"]);
  assert.deepEqual(
    JSON.parse(
      (await f.ok("summary/view", {}, f.memberSession)).blocks[0].text,
    ),
    {},
  );
  assert.equal(
    (await f.call("summary/view", {}, f.memberSession, f.personal.public_id))
      .status,
    403,
  );
  assert.equal((await f.call("admin/view", {}, f.memberSession)).status, 403);
  assert.equal((await f.call("active/view")).status, 404);
  assert.equal((await f.call("missing/view")).status, 404);
  assert.equal((await f.call("admin/view", { jobs: [1] })).status, 400);
  assert.equal((await f.call("admin/view", {}, "")).status, 401);
  assert.deepEqual(await f.call("bad/view"), {
    status: 422,
    data: { detail: "插件设置页输出无效" },
  });
  await f.db.query("UPDATE studio_packages SET enabled=true WHERE id='gpu'");
  assert.ok((await keys(f.session)).includes("plugin:gpu:active"));
  await f.db.query(
    "UPDATE studio_packages SET installed=false,removing=false WHERE id='extra'",
  );
  assert.ok(!(await keys(f.session)).includes("plugin:extra:tools"));
  assert.equal(
    (await f.call("/api/plugins/extra/pages/tools/view")).status,
    404,
  );
});

test("scope projection restricts member jobs to the caller and workspace and exposes only declared fields", async (t) => {
  const f = await setup(t);
  await f.contributes({
    version: 1,
    settings: { workspace: formSchema },
    settingsPages: [
      page("admin", {
        scopes: ["plugin", "models", "services", "jobs", "settings"],
      }),
      page("member", {
        audience: "member",
        scopes: ["plugin", "jobs", "settings"],
      }),
      page("latest", {
        scopes: ["jobs"],
        program: `({view({jobs}) {return {schema:1,title:"任务",blocks:[{type:"text",text:JSON.stringify(jobs.map(j=>j.id))}]}}})`,
      }),
    ],
  });
  const insertJob = async (owner: string, wid: string) =>
    one(
      f.db,
      `INSERT INTO jobs(id,workspace_id,owner_id,model_id,connection_id,plugin_id,plugin_version,
    config_snapshot,provider_model,kind,input,idempotency_key,request_hash,price,state)
    SELECT gen_random_uuid(),$1,$2,m.id,c.id,c.plugin_id,c.plugin_version,'SECRET CONFIG',m.provider_model,m.kind,
    '{"prompt":"SECRET PROMPT","media":"SECRET ASSET"}',gen_random_uuid()::text,'hash',0,'queued'
    FROM models m JOIN connections c ON c.id=m.connection_id WHERE c.plugin_id='gpu' LIMIT 1 RETURNING public_id::float8 AS id`,
      [wid, owner],
    );
  const own = await insertJob(f.member.id, f.team.id);
  await insertJob(f.member.id, f.member.workspaceId);
  await insertJob(f.admin.id, f.team.id);
  const member = JSON.parse(
    (await f.ok("member/view", {}, f.memberSession)).blocks[0].text,
  );
  assert.deepEqual(Object.keys(member).sort(), ["jobs", "plugin", "settings"]);
  assert.equal(member.plugin.pending, 1);
  assert.deepEqual(
    member.jobs.map((j: { id: number }) => j.id),
    [own.id],
  );
  assert.deepEqual(member.settings, {
    global: null,
    workspace: { values: { style: "A" }, revision: 0 },
  });
  const admin = JSON.parse((await f.ok("admin/view")).blocks[0].text);
  assert.equal(admin.jobs.length, 3);
  assert.equal(admin.plugin.pending, 3);
  for (const j of admin.jobs)
    assert.deepEqual(Object.keys(j).sort(), [
      "createdAt",
      "id",
      "model",
      "node",
      "status",
    ]);
  assert.ok(admin.models.length);
  for (const m of admin.models)
    assert.deepEqual(Object.keys(m).sort(), ["enabled", "id", "kind", "label"]);
  assert.ok(admin.services.length);
  for (const c of admin.services)
    assert.deepEqual(Object.keys(c).sort(), ["enabled", "id", "name"]);
  assert.doesNotMatch(JSON.stringify(admin), /SECRET|测试成员|测试管理员/);
  await f.db.query(
    `INSERT INTO jobs(id,workspace_id,owner_id,model_id,connection_id,plugin_id,plugin_version,
    config_snapshot,provider_model,kind,input,idempotency_key,request_hash,price,state)
    SELECT gen_random_uuid(),j.workspace_id,j.owner_id,j.model_id,j.connection_id,j.plugin_id,j.plugin_version,
      j.config_snapshot,j.provider_model,j.kind,j.input,gen_random_uuid()::text,'hash',0,'queued'
    FROM jobs j CROSS JOIN generate_series(1,101) WHERE j.public_id=$1`,
    [own.id],
  );
  const latest = JSON.parse((await f.ok("latest/view")).blocks[0].text);
  assert.equal(latest.length, 100);
  assert.deepEqual(
    latest,
    [...latest].sort((a, b) => b - a),
  );
  assert.ok(!latest.includes(own.id));
});

test("settings and program actions validate, serialize first writes, roll back partial writes, and audit once", async (t) => {
  const f = await setup(t);
  const program = `({view(input){return {schema:1,title:"设置",blocks:[{type:"text",text:JSON.stringify(input)}]}},
    action(id,payload,input){
      if(id==="throw") throw Error("PRIVATE STACK");
      if(id==="invalid") return {extra:"PRIVATE OUTPUT"};
      if(id==="both") return {settings:{global:{style:"B"},workspace:{style:"invalid"}}};
      return {settings:{workspace:payload},notice:"原修订号 "+input.settings.workspace.revision}
    }})`;
  await f.contributes({
    version: 1,
    settings: { global: formSchema, workspace: formSchema },
    settingsPages: [
      page("edit", {
        program,
        scopes: ["settings"],
        actions: [
          { kind: "settings", scope: "global", id: "save" },
          ...["apply", "throw", "invalid", "both"].map((id) => ({
            id,
            kind: "program",
          })),
        ],
      }),
      page("member", { audience: "member" }),
      page("hidden", {
        visibleWhen: "enabled",
        actions: [{ id: "off", kind: "program" }],
      }),
    ],
  });
  let calls = 0;
  const action = async (
    path: string,
    body: unknown = {},
    token = f.session,
    workspace = f.team.public_id,
  ) => {
    calls++;
    return f.call(path, body, token, workspace);
  };
  const save = "edit/actions/save",
    valid = { revision: 0, payload: { style: "B" } };
  const statuses = await Promise.all([
    action(save, valid),
    action(save, valid),
  ]);
  assert.deepEqual(statuses.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    (
      await action(save, {
        revision: 1,
        payload: { secret: "PRIVATE PAYLOAD" },
      })
    ).status,
    400,
  );
  assert.equal((await action(save, { payload: { style: "A" } })).status, 400);
  assert.equal(
    (await action(save, { revision: 1, unexpected: true })).status,
    400,
  );
  assert.equal((await action(save, "{bad")).status, 400);
  assert.equal((await action(save, valid, f.memberSession)).status, 403);
  assert.equal(
    (await action(save, valid, f.memberSession, f.personal.public_id)).status,
    403,
  );
  assert.equal((await action("member/actions/save")).status, 403);
  assert.equal((await action("edit/actions/missing")).status, 404);
  assert.equal((await action("hidden/actions/off")).status, 404);
  assert.deepEqual(
    await action("edit/actions/apply", { payload: valid.payload }),
    {
      status: 200,
      data: { notice: "原修订号 0", refresh: true },
    },
  );
  assert.equal((await action("edit/actions/apply", valid)).status, 409);
  assert.equal(
    (await action("edit/actions/both", { revision: 1 })).status,
    400,
  );
  assert.equal((await action("edit/actions/invalid")).status, 422);
  assert.deepEqual(await action("edit/actions/throw"), {
    status: 422,
    data: { detail: "插件操作程序执行失败" },
  });
  const settings = async (workspace = f.team.public_id) =>
    JSON.parse(
      (await f.ok("edit/view", {}, f.session, workspace)).blocks[0].text,
    ).settings;
  assert.deepEqual(await settings(), {
    global: { values: { style: "B" }, revision: 1 },
    workspace: { values: { style: "B" }, revision: 1 },
  });
  assert.deepEqual((await settings(f.personal.public_id)).workspace, {
    values: { style: "A" },
    revision: 0,
  });
  const { rows } = await f.db.query(
    "SELECT * FROM studio_plugin_audit ORDER BY id",
  );
  assert.equal(rows.length, calls);
  assert.equal(rows.filter((r) => r.outcome === "succeeded").length, 2);
  assert.equal(rows.filter((r) => r.outcome === "failed").length, 2);
  assert.ok(
    rows.every(
      (r) => r.plugin_id === "gpu" && r.package_version === f.file.version,
    ),
  );
  assert.ok(
    rows.some(
      (r) =>
        r.kind === "settings" &&
        r.outcome === "rejected" &&
        r.actor_id === f.member.id &&
        r.workspace_id === f.team.id,
    ),
  );
  assert.ok(
    rows.some(
      (r) =>
        r.kind === "program" &&
        r.action_id === "apply" &&
        r.outcome === "succeeded",
    ),
  );
  assert.doesNotMatch(JSON.stringify(rows), /PRIVATE|style/);
});

test("legacy GPU view and package-bound node operations use the installed adapter", async (t) => {
  const f = await setup(t);
  const state = await f.ok("/api/state");
  assert.equal(state.gpu_node_settings.id, "gpu");
  assert.deepEqual(state.plugin_pages, [
    {
      key: "plugin:gpu:nodes",
      plugin: "gpu",
      page: "nodes",
      title: "GPU 节点",
      icon: "gpu",
      group: "account",
      order: 0,
      audience: "admin",
      legacy: true,
      version: f.file.version,
    },
  ]);
  const panel = await f.ok("nodes/view");
  assert.equal(panel.title, "GPU 实例");
  assert.ok(
    panel.add.options.some((o: { value: string }) => o.value === "MiniMax H3"),
  );
  assert.equal((await f.call("nodes/view", {}, f.memberSession)).status, 403);
  assert.deepEqual(await f.ok("nodes/actions/suggest-name"), {
    value: "弗淼001",
    refresh: false,
  });
  const pair = await f.ok("nodes/actions/pair", {
    payload: { name: "测试节点", models: ["MiniMax H3"] },
  });
  assert.equal(pair.refresh, true);
  assert.ok(pair.result.title.includes("测试节点"));
  const code = pair.result.value.split(" ").at(-1);
  assert.ok(code.length > 30);
  const enrolled = await f.ok("/agent/enroll", {
    code,
    secret: randomUUID() + randomUUID(),
  });
  const node = await one(
    f.db,
    "SELECT public_id::float8 AS id FROM gpu_nodes WHERE name='测试节点'",
  );
  assert.ok(enrolled);
  assert.equal((await f.ok("nodes/view")).rows[0].id, node.id);
  for (const target of [0, -3, 1.5, "1e2", {}, null])
    assert.equal((await f.call("nodes/actions/drain", { target })).status, 400);
  for (const op of ["drain", "resume", "stop", "remove"])
    assert.deepEqual(
      await f.ok("nodes/actions/" + op, { target: String(node.id) }),
      { refresh: true },
    );
  assert.equal(
    (await f.call("nodes/actions/resume", { target: node.id })).status,
    404,
  );
  assert.deepEqual((await f.ok("nodes/view")).rows, []);
  const { rows } = await f.db.query(
    "SELECT * FROM studio_plugin_audit ORDER BY id",
  );
  assert.equal(rows.length, 13);
  assert.equal(rows.filter((r) => r.outcome === "succeeded").length, 6);
  assert.ok(rows.every((r) => r.kind === "host"));
  assert.equal(rows.at(-1)?.target, String(node.id));
  assert.ok(!JSON.stringify(rows).includes(code));
  // Exercise native writes when the success audit cannot commit.
  await f.db.query(
    `ALTER TABLE studio_plugin_audit ADD CHECK (action_id!='pair' OR outcome!='succeeded') NOT VALID`,
  );
  const before = await one(f.db, "SELECT count(*) FROM gpu_pairings");
  assert.equal(
    (
      await f.call("nodes/actions/pair", {
        payload: { name: "回滚", models: ["MiniMax H3"] },
      })
    ).status,
    500,
  );
  assert.deepEqual(
    await one(f.db, "SELECT count(*) FROM gpu_pairings"),
    before,
  );
  assert.deepEqual(
    await one(
      f.db,
      "SELECT outcome FROM studio_plugin_audit ORDER BY id DESC LIMIT 1",
    ),
    { outcome: "failed" },
  );
});
