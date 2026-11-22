import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { OriginalIdentity } from "@fumiao/original-api/identity.js";
import { one } from "@fumiao/platform/db.js";
import {
  hostLimits,
  publicAddress,
  type HttpTransport,
} from "@fumiao/platform/plugin-host.js";
import { PluginPages } from "@fumiao/platform/plugin-pages.js";
import { programLimits, runProgram } from "@fumiao/platform/plugin-program.js";
import { StudioPackages } from "@fumiao/platform/studio-packages.js";
import {
  contributesSchema,
  contributionProblems,
} from "@fumiao/plugin-sdk/contributions.js";
import { databaseFixture } from "../helpers/database.js";

const echo = async (name: string, args: unknown[]) => ({ name, args });
const failure = (status: number, message?: string) => (error: unknown) => {
  assert.equal((error as { status?: number }).status, status);
  if (message) assert.equal((error as Error).message, message);
  return true;
};

test("programs may be async, see only granted host functions and stay inside their limits", async () => {
  assert.equal(await runProgram("{ f(x){ return x + 1 } }", "f", [1]), 2);
  assert.deepEqual(
    await runProgram(
      "{ async f(x, host){ return [x, await host.data.get('k'), typeof host.http, typeof __host] } }",
      "f",
      [1],
      ["data.get"],
      echo,
    ),
    [1, { name: "data.get", args: ["k"] }, "undefined", "undefined"],
  );
  // The guest learns that a call failed, not why the host failed.
  assert.equal(
    await runProgram(
      "{ async f(host){ try { await host.data.get(1) } catch (e) { return e.message } } }",
      "f",
      [],
      ["data.get"],
      async () => {
        throw new Error("postgres://secret");
      },
    ),
    "宿主调用失败",
  );
  for (const source of [
    "{ f(){ for(;;){} } }",
    "{ async f(host){ await host.data.get(1); for(;;){} } }",
    "{ f(){ const a = []; for(;;) a.push(new Array(1e5).fill(1)) } }",
    "{ f(){ throw new Error('x') } }",
    "{ f(){ return new Promise(() => {}) } }",
    "{ async f(host){ for (let i = 0; i < 40; i++) await host.data.get(i) } }",
  ])
    await assert.rejects(
      runProgram(source, "f", [], ["data.get"], echo),
      failure(400),
      source,
    );
  const wall = programLimits.wallMs;
  programLimits.wallMs = 200;
  try {
    let aborted = false;
    await assert.rejects(
      runProgram(
        "{ async f(host){ return host.data.get(1) } }",
        "f",
        [],
        ["data.get"],
        (_name, _args, signal) =>
          new Promise((_, reject) =>
            signal.addEventListener("abort", () => {
              aborted = true;
              reject(new Error("aborted"));
            }),
          ),
      ),
      failure(408),
    );
    assert.equal(aborted, true, "the host call is cancelled with the program");
  } finally {
    programLimits.wallMs = wall;
  }
});

test("only public addresses and declared https origins are reachable", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
    "::ffff:a00:1",
    "::ffff:808:808",
    "fd00::1",
    "fe80::1",
    "not-an-address",
  ])
    assert.equal(publicAddress(address), false, address);
  for (const address of [
    "8.8.8.8",
    "1.1.1.1",
    "::ffff:8.8.8.8",
    "2606:4700:4700::1111",
  ])
    assert.equal(publicAddress(address), true, address);
  const problems = (value: object) =>
    contributionProblems(contributesSchema.parse({ version: 1, ...value }), {
      mode: "request",
      hasProgram: false,
    });
  assert.deepEqual(
    problems({
      hostCapabilities: ["http", "data"],
      http: { origins: ["https://api.example.com"] },
    }),
    [],
  );
  assert.match(problems({ hostCapabilities: ["http"] }).join(), /同时声明/);
  assert.match(
    problems({ http: { origins: ["https://api.example.com"] } }).join(),
    /同时声明/,
  );
  for (const origin of [
    "http://api.example.com",
    "https://api.example.com/v1",
    "https://user@api.example.com",
    "api.example.com",
  ])
    assert.match(
      problems({
        hostCapabilities: ["http"],
        http: { origins: [origin] },
      }).join(),
      /只接受 https 源/,
      origin,
    );
});

test("the real transport refuses names and literals that lead inside", async (t) => {
  const origins = [
    "https://localhost:9",
    "https://127.0.0.1:9",
    "https://[::1]:9",
    "https://169.254.169.254",
    "https://[::ffff:a00:1]:9",
  ];
  const f = await setup(
    t,
    { hostCapabilities: ["http", "data"], http: { origins } },
    false,
  );
  for (const origin of origins)
    assert.equal(
      (await f.act("probe", { url: origin + "/latest/meta-data" })).notice,
      "请求地址指向内部网络",
      origin,
    );
});

const program = `({
  async view(input, host) {
    const saved = host.data ? await host.data.get("last") : "no data capability";
    return { schema: 1, title: "t", blocks: [{ type: "text", text: JSON.stringify({ saved, canFetch: !!(host.http && host.http.fetch), canPut: !!(host.data && host.data.put) }) }] };
  },
  async action(id, payload, input, host) {
    if (id === "fetch") {
      const r = await host.http.fetch(payload.url, payload.init);
      await host.data.put("last", { status: r.status, json: r.json }, payload.options);
      return { notice: "HTTP " + r.status };
    }
    if (id === "probe") {
      try { await host.http.fetch(payload.url); } catch (e) { return { notice: e.message }; }
      return { notice: "reached" };
    }
    if (id === "store") {
      await host.data.put(payload.key, payload.value, payload.options);
      return { notice: (await host.data.list("", payload.options)).keys.join(",") };
    }
    if (id === "remove") return { notice: String(await host.data.delete(payload.key)) };
    if (id === "fill") {
      const write = i => host.data.put("big/" + i, payload.value);
      if (payload.parallel) await Promise.all(Array.from({length: payload.count}, (_,i) => write(i)));
      else for (let i = 0; i < payload.count; i++) await write(i);
      return {};
    }
    if (id === "fail") {
      await host.data.put("partial", 1);
      throw new Error("after write");
    }
  }
})`;

async function setup(t: TestContext, contributes: object, fake = true) {
  const f = await databaseFixture();
  t.after(() => f.cleanup());
  await f.p.registry.initializeStudio(f.db, false);
  const identity = new OriginalIdentity(f.p),
    password = randomUUID();
  await identity.bootstrap({ name: "admin", nickname: "测试管理员", password });
  const admin = await identity.actor(
    await identity.login({ name: "admin", password }, "fixture"),
  );
  const packages = new StudioPackages(f.p);
  await packages.install(
    admin,
    JSON.parse(
      await readFile("plugins/gpu/package/legacy-1.0.0.fmplugin.json", "utf8"),
    ),
  );
  await f.db.query(
    `UPDATE studio_package_releases SET package=(package-'settingsPage') || jsonb_build_object('contributes',$1::jsonb) WHERE id='gpu'`,
    [
      JSON.stringify({
        version: 1,
        settingsPages: [
          {
            id: "tools",
            title: "工具",
            program,
            actions: ["fetch", "probe", "store", "remove", "fill", "fail"].map(
              (id) => ({
                id,
                kind: "program",
              }),
            ),
          },
        ],
        ...contributes,
      }),
    ],
  );
  const requests: {
    url: string;
    method: string;
    headers: object;
    body?: string;
  }[] = [];
  const transport: HttpTransport = async (url, init) => {
    requests.push({ url: url.href, ...init });
    return {
      status: 201,
      contentType: "application/json",
      body: Buffer.from(JSON.stringify({ echoed: init.body ?? null })),
    };
  };
  const pages = new PluginPages(f.p, fake ? transport : undefined);
  const workspace = (
    await one(
      f.db,
      "SELECT public_id FROM workspaces WHERE owner_id=$1 AND kind='personal'",
      [admin.id],
    )
  ).public_id;
  const view = async () =>
    JSON.parse(
      ((await pages.view(admin, String(workspace), "gpu", "tools")) as any)
        .blocks[0].text,
    );
  const act = (id: string, payload: object = {}) =>
    pages.action(admin, String(workspace), "gpu", "tools", id, { payload });
  const audit = async () =>
    (
      await f.db.query(
        "SELECT action_id,outcome,detail FROM studio_plugin_audit ORDER BY id",
      )
    ).rows;
  return { ...f, admin, packages, requests, view, act, audit };
}

test("a page action calls a declared service and keeps its result; views only read", async (t) => {
  const f = await setup(t, {
    hostCapabilities: ["http", "data"],
    http: { origins: ["https://api.example.com"] },
  });
  assert.deepEqual(await f.view(), {
    saved: null,
    canFetch: false,
    canPut: false,
  });
  const result = await f.act("fetch", {
    url: "https://api.example.com/v1/tags?x=1",
    init: { method: "POST", json: { a: 1 }, headers: { "X-Trace": "t" } },
  });
  assert.equal(result.notice, "HTTP 201");
  assert.deepEqual(f.requests, [
    {
      url: "https://api.example.com/v1/tags?x=1",
      method: "POST",
      headers: { "X-Trace": "t", "Content-Type": "application/json" },
      body: '{"a":1}',
    },
  ]);
  assert.deepEqual((await f.view()).saved, {
    status: 201,
    json: { echoed: '{"a":1}' },
  });
  // Everywhere the plugin did not ask to go.
  for (const [url, init] of [
    ["https://evil.example.com/", {}],
    ["http://api.example.com/", {}],
    ["https://api.example.com.evil.test/", {}],
    ["https://user:pw@api.example.com/", {}],
    ["https://api.example.com/", { headers: { Cookie: "a=b" } }],
    ["https://api.example.com/", { headers: { Host: "internal" } }],
    ["https://api.example.com/", { method: "GET", body: "x" }],
  ] as const)
    await assert.rejects(
      f.act("fetch", { url, init }),
      failure(422, "插件操作程序执行失败"),
      url + JSON.stringify(init).slice(0, 60),
    );
  // A limit the host enforced is reported as such.
  await assert.rejects(
    f.act("fetch", {
      url: "https://api.example.com/",
      init: { method: "POST", body: "x".repeat(300_000) },
    }),
    failure(422, "请求正文过大"),
  );
  assert.equal(f.requests.length, 1);
  assert.deepEqual(
    (await f.audit()).map((r) => [r.outcome, r.detail]).slice(0, 2),
    [
      ["succeeded", "http.fetch×1 data.put×1"],
      ["failed", "插件操作程序执行失败 · http.fetch×1"],
    ],
  );
});

test("plugin data is scoped, bounded, rolled back with a failed action and removed with the plugin", async (t) => {
  const f = await setup(t, { hostCapabilities: ["data"] });
  assert.equal(
    (await f.act("store", { key: "a/1", value: { n: 1 } })).notice,
    "a/1",
  );
  assert.equal(
    (
      await f.act("store", {
        key: "g",
        value: [1],
        options: { scope: "global" },
      })
    ).notice,
    "g",
  );
  await f.act("store", { key: "a/1", value: { n: 2 } });
  assert.deepEqual(
    (
      await f.db.query(
        "SELECT scope,key,value,workspace_id IS NULL AS global FROM studio_plugin_data ORDER BY key",
      )
    ).rows,
    [
      { scope: "workspace", key: "a/1", value: { n: 2 }, global: false },
      { scope: "global", key: "g", value: [1], global: true },
    ],
  );
  for (const payload of [
    { key: "../x", value: 1 },
    { key: "", value: 1 },
    { key: "k".repeat(201), value: 1 },
    { key: "k", value: "x".repeat(hostLimits.dataValueBytes) },
    { key: "k", value: 1, options: { scope: "elsewhere" } },
  ])
    await assert.rejects(f.act("store", payload), failure(422));
  // http was not declared, so the function does not exist for this plugin.
  await assert.rejects(
    f.act("fetch", { url: "https://api.example.com/" }),
    failure(422),
  );
  await assert.rejects(f.act("fail"), failure(422));
  assert.equal(
    await one(f.db, "SELECT 1 FROM studio_plugin_data WHERE key='partial'"),
    undefined,
    "a failed action leaves nothing behind",
  );
  const limit = hostLimits.dataPluginBytes;
  hostLimits.dataPluginBytes = 1000;
  try {
    for (const parallel of [false, true]) {
      await assert.rejects(
        f.act("fill", { count: 10, value: "x".repeat(200), parallel }),
        failure(422, "插件数据超过容量上限"),
      );
      assert.equal(await one(f.db, "SELECT 1 FROM studio_plugin_data WHERE key LIKE 'big/%'"), undefined);
    }
  } finally {
    hostLimits.dataPluginBytes = limit;
  }
  assert.equal((await f.act("remove", { key: "a/1" })).notice, "true");
  assert.equal((await f.act("remove", { key: "a/1" })).notice, "false");
  const { revision } = await one(
    f.db,
    "SELECT revision FROM studio_packages WHERE id='gpu'",
  );
  await f.packages.change(f.admin, "gpu", revision, "remove");
  await f.packages.finishRemovals();
  assert.equal(
    (await one(f.db, "SELECT count(*)::int AS n FROM studio_plugin_data")).n,
    0,
  );
});
