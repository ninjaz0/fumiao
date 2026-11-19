import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createOriginalApp } from "../apps/api/src/original.js";
import type { databaseFixture } from "../tests/helpers/database.js";
import { one } from "../packages/platform/src/db.js";
import { OriginalIdentity } from "../packages/original-api/src/identity.js";
import { StudioCatalog } from "../packages/platform/src/catalog.js";
import { gpuState } from "../plugins/gpu/src/state.js";
import { museState } from "../plugins/muse/src/state.js";
import { flowState } from "../plugins/flow/src/state.js";
import { imagesState } from "../plugins/images/src/state.js";

export async function verifyFullState(
  f: Awaited<ReturnType<typeof databaseFixture>>,
  source: (sql: string, params?: unknown[]) => Record<string, any>[],
  url: string,
  credentials: { name: string; password: string },
  cookies: string[],
  personal: number,
  python: string,
) {
  const checks: string[] = [],
    identity = new OriginalIdentity(f.p),
    catalog = new StudioCatalog(f.db);
  await f.p.registry.installBuiltins(f.db);
  const previousPolicy = source(
      "SELECT value FROM settings WHERE key='model_policy'",
    )[0],
    prices = source(
      "SELECT value FROM settings WHERE key='credit_price_revision'",
    )[0];
  for (const plugin of [gpuState, museState, flowState, imagesState])
    await f.db.transaction((sql) => catalog.activate(sql, plugin.manifest));
  await f.db.query("UPDATE studio_policy SET revision=$1,price_revision=$2", [
    JSON.parse(previousPolicy.value).revision,
    Number(prices.value),
  ]);
  const tokens: string[] = [];
  for (const name of [credentials.name, "state-member"])
    tokens.push(
      await identity.login(
        { name, password: credentials.password },
        "state-fixture",
      ),
    );
  const admin = await identity.actor(tokens[0]),
    app = await createOriginalApp(f.p);
  await app.listen(0, "127.0.0.1");
  const origins = [url, await app.getUrl()];
  async function request(
    i: number,
    path: string,
    actor = 0,
    workspace: number | string = 1,
    body?: unknown,
    method?: string,
  ) {
    const response = await fetch(origins[i] + path, {
      method: method || (body === undefined ? "GET" : "POST"),
      headers: {
        origin: "http://localhost:3000",
        cookie:
          actor < 0
            ? ""
            : i === 0
              ? cookies[actor]
              : "fm_session=" + tokens[actor],
        "X-Workspace-Id": String(workspace),
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }
  async function compare(
    label: string,
    actor = 0,
    workspace: number | string = 1,
    status = 200,
    alignTiming = false,
  ) {
    const [original, next] = await Promise.all([
      request(0, "/api/state", actor, workspace),
      request(1, "/api/state", actor, workspace),
    ]);
    assert.equal(
      original.status,
      status,
      label + " original " + JSON.stringify(original.body),
    );
    assert.equal(
      next.status,
      status,
      label + " next " + JSON.stringify(next.body),
    );
    if (status === 200) {
      assert.ok(
        Math.abs(original.body.server_time - next.body.server_time) < 5,
        "real server clocks",
      );
      original.body.server_time = next.body.server_time;
      if (alignTiming) {
        // Compare moving clocks at one timestamp with the unmodified pinned
        // timing implementation; every non-clock HTTP field remains untouched.
        const timing = JSON.parse(
          execFileSync(
            python,
            [
              "-c",
              `import os,sys,json,sqlite3
os.environ['FUMIAO_DATA']=sys.argv[2]
sys.path.insert(0,sys.argv[1])
import timing
with sqlite3.connect('file:'+sys.argv[2]+'/studio.sqlite?mode=ro',uri=True) as con:
 con.row_factory=sqlite3.Row
 con.execute('BEGIN')
 jobs=[dict(r) for r in con.execute('SELECT * FROM jobs ORDER BY id DESC')]
 timing.attach(con,jobs,float(sys.argv[3]))
 print(json.dumps({str(j['id']):{k:j[k] for k in ('timing','eta') if k in j} for j in jobs}))`,
              join(f.directory, "app"),
              join(f.directory, "data"),
              String(next.body.server_time),
            ],
            { stdio: ["ignore", "pipe", "pipe"] },
          ).toString(),
        );
        for (const j of original.body.jobs) Object.assign(j, timing[j.id]);
      }
      if (actor === 0) {
        for (const value of [original.body.disk_free, next.body.disk_free])
          assert.ok(
            Number.isSafeInteger(value) && value > 0,
            "actual filesystem free space",
          );
        // Separate temporary runtimes share a filesystem, but request timing changes free bytes.
        assert.ok(
          Math.abs(original.body.disk_free - next.body.disk_free) <
            128 * 1024 * 1024,
        );
        original.body.disk_free = next.body.disk_free;
      }
    }
    assert.deepEqual(next.body, original.body, label);
    assert.ok(!JSON.stringify(next.body).includes("sk-state-fixture"));
    checks.push(label);
    return next.body;
  }
  try {
    await compare("admin complete historical state");
    await compare("member complete team state", 1);
    await compare("member complete personal state", 1, personal);
    await compare("anonymous rejected", -1, 1, 401);
    await compare(
      "administrator cannot read another personal workspace",
      0,
      personal,
      403,
    );
    await compare("malformed workspace", 0, "nope", 400);
    await compare("missing workspace", 1, 999, 403);
    const post = await Promise.all([
      request(0, "/api/state", 0, 1, {}, "POST"),
      request(1, "/api/state", 0, 1, {}, "POST"),
    ]);
    assert.deepEqual(post[1], post[0]);
    assert.equal(post[0].status, 405);
    checks.push("state method contract");
    const connections: Record<string, string> = {};
    for (const plugin of [gpuState, museState, flowState, imagesState]) {
      const c = await f.p.createConnection(admin, {
        name: plugin.manifest.id,
        pluginId: plugin.manifest.id,
        version: plugin.manifest.version,
        config:
          plugin.manifest.mode === "pull"
            ? {}
            : { baseUrl: "http://127.0.0.1:9", apiKey: "sk-state-fixture" },
      });
      await f.p.updateConnection(admin, c.id, {
        revision: 1,
        enabled: true,
        concurrency: 1,
      });
      connections[plugin.manifest.id] = c.id;
    }
    for (const [file, contents] of [
      [
        "muse.env",
        "FUMIAO_MUSE_URL=http://127.0.0.1:9\nFUMIAO_MUSE_KEY=sk-state-fixture\n",
      ],
      [
        "flow.env",
        "FUMIAO_FLOW_URL=http://127.0.0.1:9\nFUMIAO_FLOW_KEY=sk-state-fixture\n",
      ],
      ["openai.env", "OPENAI_API_KEY=sk-state-fixture\n"],
    ])
      await writeFile(join(f.directory, "data", file), contents, {
        mode: 0o600,
      });
    await compare("configured providers do not disclose credentials");
    const disabled = { uid: randomUUID(), prompt: "fixture" };
    const rejected = await Promise.all([
      request(0, "/api/image-jobs", 0, 1, disabled),
      request(1, "/api/image-jobs", 0, 1, disabled),
    ]);
    assert.deepEqual(rejected[1], rejected[0]);
    assert.equal(rejected[0].status, 503);
    checks.push(
      "disabled image configuration rejects submission before billing",
    );
    for (const [age, ready] of [
      [0, true],
      [100, true],
      [0, false],
    ] as const) {
      const health = { ready, checked: Date.now() / 1000 - age };
      for (const name of ["muse", "flow"]) {
        source(
          "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
          [name + "_health", JSON.stringify(health)],
        );
        await f.db.query(
          "UPDATE connections SET queue_health=$2,queue_health_revision=revision WHERE id=$1",
          [connections[name], JSON.stringify(health)],
        );
      }
      await compare(`provider health ready=${ready} age=${age}`);
    }
    source("UPDATE credit_accounts SET balance=1000");
    await f.db.query("UPDATE wallets SET balance=1000");
    source("UPDATE credit_prices SET amount=1");
    await f.db.query("UPDATE studio_prices SET amount=1");
    source("UPDATE settings SET value=? WHERE key='openai_images'", [
      '{"enabled":true}',
    ]);
    await f.db.query("UPDATE original_state_settings SET image_enabled=true");
    const tasks: number[] = [];
    const flowModel = Object.entries(await catalog.catalog()).find(
      ([id, model]) =>
        id.startsWith("flow:") &&
        model.kind === "video" &&
        !model.hidden &&
        model.min_refs === 0,
    )![0];
    for (const [kind, model, workspace, actor] of [
      ["video", "MiniMax H3", 1, 0],
      ["video", "muse-video", 1, 0],
      ["image", "muse-image", 1, 0],
      ["image", "gpt-image-2.6-sunburst", 1, 0],
      ["audio", "breeze-tts-2", 1, 0],
      ["video", "MiniMax H3", personal, 1],
      ["video", flowModel, 1, 0],
    ] as const) {
      const body = { uid: randomUUID(), prompt: "状态对照", model, seed: 42 };
      const path = kind === "video" ? "/api/jobs" : `/api/${kind}-jobs`;
      const original = await request(0, path, actor, workspace, body),
        next = await request(1, path, actor, workspace, body);
      assert.equal(original.status, 200, JSON.stringify(original));
      assert.deepEqual(next, original);
      const row = source("SELECT created,updated FROM jobs WHERE id=?", [
        original.body.id,
      ])[0];
      await f.db.query(
        "UPDATE jobs SET created_at=to_timestamp($2),updated_at=to_timestamp($3) WHERE public_id=$1",
        [original.body.id, row.created, row.updated],
      );
      const entry = source(
        "SELECT created FROM credit_ledger WHERE job=? ORDER BY id DESC LIMIT 1",
        [original.body.id],
      )[0];
      await f.db.query(
        "UPDATE ledger SET created_at=to_timestamp($2) WHERE job_id=(SELECT id FROM jobs WHERE public_id=$1)",
        [original.body.id, entry.created],
      );
      tasks.push(original.body.id);
    }
    await compare("complete active queues and billing");
    await compare(
      "cross-workspace queue ahead without private content",
      1,
      personal,
    );
    const policy = JSON.parse(
      source("SELECT value FROM settings WHERE key='model_policy'")[0].value,
    );
    const body = {
      model: "MiniMax H3",
      enabled: false,
      expected_revision: policy.revision,
    };
    const changed = await Promise.all([
      request(0, "/api/settings/models", 0, 1, body, "PATCH"),
      request(1, "/api/settings/models", 0, 1, body, "PATCH"),
    ]);
    assert.equal(changed[0].status, 200, JSON.stringify(changed));
    assert.deepEqual(changed[1], changed[0]);
    await compare("disabled model notes and image enable synchronization");
    await compare("member disabled model access", 1, personal);
    // Construct equivalent observed phases without invoking a provider. Clock
    // projections are checked against Python at the common server timestamp.
    for (const [index, phases] of [
      [0, ["preparing", "uploading", "validating"]],
      [1, ["queued", "preparing", "generating", "finalizing"]],
      [3, ["generating"]],
      [6, ["generating", "finalizing"]],
    ] as const) {
      const id = tasks[index],
        job = await one(f.db, "SELECT * FROM jobs WHERE public_id=$1", [id]),
        plugin = [gpuState, museState, imagesState, flowState].find(
          (p) => p.manifest.id === job.plugin_id,
        )!;
      const features = plugin.timingFeatures!({
          model: job.provider_model,
          kind: job.kind,
          input: { ...job.input, references: [] },
        }),
        created = source("SELECT created FROM jobs WHERE id=?", [id])[0]
          .created;
      for (const phase of phases) {
        const note =
          index === 0
            ? ["uploading", "validating"].includes(phase)
              ? "正在回传并校验成片"
              : ""
            : index === 1
              ? phase === "queued"
                ? "等待 Muse 空闲账号"
                : phase === "preparing"
                  ? "正在准备 Muse"
                  : phase === "finalizing"
                    ? "正在保存 Muse 成品"
                    : "Muse 生成中"
              : index === 3
                ? "正在生成图片"
                : "Flow 正在生成";
        source(
          "UPDATE jobs SET status='running',attempts=1,note=?,lease=9999999999 WHERE id=?",
          [note, id],
        );
        source("DELETE FROM job_runs WHERE job=?", [id]);
        source(
          "INSERT INTO job_runs(job,run_key,attempt,node,kind,model,features,created,queued,started,status,phase) VALUES(?,?,1,NULL,?,?,?,?,?,?,'running',?)",
          [
            id,
            randomUUID(),
            job.kind,
            job.provider_model,
            JSON.stringify(features),
            created,
            created,
            phase === "queued" ? null : created,
            phase,
          ],
        );
        await f.db.query(
          "UPDATE jobs SET state=$2,attempts=1,remote_id=$3,lease_until=to_timestamp(9999999999) WHERE id=$1",
          [
            job.id,
            index === 1 && phase === "finalizing" ? "finalizing" : "running",
            index === 1 ? "fixture-upstream-id" : null,
          ],
        );
        await f.db.query("DELETE FROM job_runs WHERE job=$1", [job.id]);
        await f.db.query(
          `INSERT INTO job_runs(job,run_key,attempt,plugin_id,plugin_version,policy,kind,model,features,created,queued,started,status,phase) VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$9,$10,'running',$11)`,
          [
            job.id,
            randomUUID(),
            job.plugin_id,
            job.plugin_version,
            JSON.stringify(plugin.manifest.timing),
            job.kind,
            job.provider_model,
            JSON.stringify(features),
            created,
            phase === "queued" ? null : created,
            phase,
          ],
        );
        await compare(`${job.plugin_id} observed ${phase}`, 0, 1, 200, true);
      }
    }
    await mkdir(".runtime-advanced/state-parity", { recursive: true });
    await writeFile(
      ".runtime-advanced/state-parity/report.json",
      JSON.stringify({ passed: true, checks }, null, 2) + "\n",
    );
    console.log(
      `Original/Nest full state parity: ${checks.length} complete HTTP snapshots and contracts passed`,
    );
  } finally {
    await app.close();
  }
}
