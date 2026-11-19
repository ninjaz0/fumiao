/** Compare public state records with the real pinned Python API after an isolated import.
 * This intentionally does not claim that the complete Nest /api/state is implemented. */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { databaseFixture } from "../tests/helpers/database.js";
import { importLegacy, legacyId } from "../packages/platform/src/importer.js";
import { one } from "../packages/platform/src/db.js";
import {
  OriginalIdentity,
  type OriginalActor,
} from "../packages/original-api/src/identity.js";
import { OriginalStateRecords } from "../packages/original-api/src/state-records.js";
import { gpuTiming } from "../plugins/gpu/src/timing.js";
import { verifyFullState } from "./state-cases.js";

const f = await databaseFixture(),
  python =
    process.env.STUDIO_PYTHON ||
    resolve(".runtime-advanced/original/.venv/bin/python");
let legacy: ReturnType<typeof spawn> | undefined;
const checks: string[] = [];
try {
  await mkdir(join(f.directory, "data"));
  await writeFile(
    join(f.directory, "data/.dispatch-paused"),
    "isolated state import check\n",
  );
  const reservation = createServer();
  await new Promise<void>((r) => reservation.listen(0, "127.0.0.1", r));
  const port = (reservation.address() as any).port;
  await new Promise<void>((r) => reservation.close(() => r()));
  const origin = "http://localhost:3000",
    url = `http://127.0.0.1:${port}`;
  legacy = spawn(
    python,
    [
      "scripts/preview-original.py",
      "--port",
      String(port),
      "--public-url",
      origin,
      "--runtime-directory",
      f.directory,
      "--no-reuse-local-credentials",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let logs = "";
  for (const stream of [legacy.stdout, legacy.stderr])
    stream!.on("data", (b) => {
      logs = (logs + b).slice(-5000);
    });
  let ready = false;
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(url + "/health")).ok) {
        ready = true;
        break;
      }
    } catch {}
    if (legacy.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, logs);
  function source(sql: string, params: unknown[] = []): Record<string, any>[] {
    return JSON.parse(
      execFileSync(
        python,
        [
          "-c",
          "import sqlite3,json,sys; c=sqlite3.connect(sys.argv[1]); c.row_factory=sqlite3.Row; d=json.load(sys.stdin); r=[dict(x) for x in c.execute(d['sql'],d['params']).fetchall()]; c.commit(); print(json.dumps(r,ensure_ascii=False))",
          join(f.directory, "data/studio.sqlite"),
        ],
        {
          input: JSON.stringify({ sql, params }),
          stdio: ["pipe", "pipe", "pipe"],
        },
      ).toString(),
    );
  }
  async function request(
    path: string,
    cookie: string,
    workspace = 1,
    body?: unknown,
    bytes?: Buffer,
  ) {
    const response = await fetch(url + path, {
      method: body !== undefined || bytes ? "POST" : "GET",
      headers: {
        origin,
        cookie,
        "X-Workspace-Id": String(workspace),
        "Content-Type": bytes ? "application/octet-stream" : "application/json",
      },
      body: bytes
        ? new Uint8Array(bytes)
        : body === undefined
          ? undefined
          : JSON.stringify(body),
    });
    const value = await response.json();
    assert.equal(response.status, 200, path + ": " + JSON.stringify(value));
    return { value, headers: response.headers };
  }
  const credentials = JSON.parse(
    await readFile(join(f.directory, "credentials.json"), "utf8"),
  );
  const login = await request("/api/login", "", 1, credentials),
    adminCookie = login.headers.get("set-cookie")!.split(";")[0];
  const originalAdmin = source("SELECT * FROM users WHERE role='admin'")[0];
  source(
    "INSERT INTO users(name,nickname,salt,pw,role,active,avatar) SELECT 'state-member','',salt,pw,'member',1,'builtin:moon' FROM users WHERE id=?",
    [originalAdmin.id],
  );
  const member = source("SELECT * FROM users WHERE name='state-member'")[0];
  source("INSERT INTO workspace_members(workspace,user) VALUES(1,?)", [
    member.id,
  ]);
  const personal = source(
    "SELECT id FROM workspaces WHERE owner=? AND kind='personal'",
    [member.id],
  )[0].id;
  const memberLogin = await request("/api/login", "", 1, {
    name: "state-member",
    password: credentials.password,
  });
  const memberCookie = memberLogin.headers.get("set-cookie")!.split(";")[0];
  source(
    "INSERT INTO settings(key,value) VALUES('openai_images',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    [
      JSON.stringify({
        enabled: false,
        apiKey: "provider-sentinel-must-not-export",
      }),
    ],
  );
  const png = await sharp({
    create: { width: 32, height: 48, channels: 3, background: "#4478a2" },
  })
    .png()
    .toBuffer();
  const assets: string[] = [];
  for (let i = 0; i < 5; i++)
    assets.push(
      (
        await request(
          "/api/assets",
          i === 4 ? memberCookie : adminCookie,
          i === 4 ? personal : 1,
          undefined,
          png,
        )
      ).value.id,
    );
  source("DELETE FROM media WHERE id=?", [assets[1]]);
  source("UPDATE media SET kind='ref_video',mime='video/mp4' WHERE id=?", [
    assets[2],
  ]);
  source(
    "INSERT INTO h3_reference_media(media,seconds,fps,has_audio,name) VALUES(?,3.75,24,1,'参考视频')",
    [assets[2]],
  );
  source(
    "UPDATE media SET kind='ref_audio',mime='audio/wav',w=0,h=0 WHERE id=?",
    [assets[3]],
  );
  source(
    "INSERT INTO h3_reference_media(media,seconds,fps,has_audio,name) VALUES(?,2.125,0,0,'参考声音')",
    [assets[3]],
  );
  const profile = {
    backend: "cuda",
    gpu_name: "Synthetic GPU",
    vram_gib: 96,
    available_gpus: 1,
    used_gpus: 1,
    runtime: "fixture",
    driver: "",
    torch_version: "",
    precision: "bf16",
    attention: "sdpa",
    memory_mode: "",
    cpu_cores: 8,
    ram_gib: 64,
  };
  for (const [id, owner, control, stage] of [
    [17, originalAdmin.id, "active", "ready"],
    [29, member.id, "paused", "failed"],
    [41, member.id, "removed", "offline"],
  ])
    source(
      "INSERT INTO nodes(id,owner,name,key,deadline,lastseen,stage,detail,control,models,ready_models,profile) VALUES(?,?,?,?,9000,1000,?,?,?,?,?,?)",
      [
        id,
        owner,
        "合成节点 " + id,
        "node-key-sentinel-" + id,
        stage,
        "旧节点详情",
        control,
        '["MiniMax H3"]',
        '["MiniMax H3"]',
        JSON.stringify(profile),
      ],
    );
  for (const [
    id,
    status,
    workspace,
    owner,
    kind,
    model,
    result,
    attempts,
    node,
  ] of [
    [
      21,
      "done",
      1,
      originalAdmin.id,
      "image",
      "muse-image",
      assets[0],
      1,
      null,
    ],
    [34, "failed", 1, member.id, "video", "MiniMax H3", null, 2, 29],
    [55, "cancelled", 1, member.id, "audio", "GLM-TTS", null, 0, null],
    [
      68,
      "done",
      personal,
      member.id,
      "image",
      "muse-image",
      assets[4],
      1,
      null,
    ],
  ])
    source(
      `INSERT INTO jobs(id,uid,owner,workspace,prompt,refs,ratio,quality,seconds,sampling_steps,seed,width,height,parent,status,created,updated,result,note,node,kind,model,image_quality,attempts,audio_settings,h3_inputs,output_metadata,ticket,lease)
    VALUES(?,?,?,?,? ,?,'16:9',480,5,4,42,864,480,7,?,950,1000,?,?,?,?,?,'standard',?,'{}','{}',?,'ticket-sentinel-do-not-export',9000)`,
      [
        id,
        randomUUID(),
        owner,
        workspace,
        "合成历史 " + id,
        JSON.stringify([assets[workspace === personal ? 4 : 0]]),
        status,
        result,
        status === "failed" ? "实例连续中断，请重新生成" : "",
        node,
        kind,
        model,
        attempts,
        JSON.stringify(status === "done" ? { width: 32, height: 48 } : {}),
      ],
    );
  source("UPDATE jobs SET updated=NULL,note=NULL WHERE id=55");
  source("UPDATE media SET w=NULL,h=NULL WHERE id=?", [assets[3]]);
  const features = gpuTiming.timingFeatures!({
    model: "MiniMax H3",
    kind: "video",
    input: {
      prompt: "",
      params: { sampling_steps: 4, quality: 480, seconds: 5, ratio: "16:9" },
      references: [],
    },
  });
  for (const [id, attempt, status, started, finished, valid] of [
    [6, 1, "interrupted", 960, 975, 0],
    [9, 2, "failed", 980, 995, 0],
  ])
    source(
      `INSERT INTO job_runs(id,job,run_key,attempt,node,kind,model,features,created,queued,started,generating,finished,status,phase,details,valid)
      VALUES(?,34,?,?,29,'video','MiniMax H3',?,950,950,?,?,?,?,'generating','{}',?)`,
      [
        id,
        "run-key-sentinel-" + id,
        attempt,
        JSON.stringify(features),
        started,
        Number(started) + 5,
        finished,
        status,
        valid,
      ],
    );
  const before = await request("/api/state", adminCookie);
  const exportPath = join(f.directory, "export.json");
  execFileSync(
    python,
    [
      "scripts/export-legacy.py",
      "--database",
      join(f.directory, "data/studio.sqlite"),
      "--output",
      exportPath,
      "--source",
      "state-oracle",
      "--include-registration-codes",
    ],
    { stdio: "pipe" },
  );
  const exported = await readFile(exportPath, "utf8"),
    data = JSON.parse(exported);
  assert.equal(data.stateVersion, 1);
  assert.equal((await stat(exportPath)).mode & 0o777, 0o600);
  for (const marker of [
    "node-key-sentinel",
    "ticket-sentinel",
    "run-key-sentinel",
    "provider-sentinel",
  ])
    assert.ok(!exported.includes(marker), marker + " must not be exported");
  checks.push(
    "export uses owner-only permissions and excludes node, job, run and provider credentials",
  );
  await importLegacy(f.p, data, join(f.directory, "data/objects"));
  const records = new OriginalStateRecords(),
    identity = new OriginalIdentity(f.p);
  for (const [name, cookie, workspace] of [
    [credentials.name, adminCookie, 1],
    ["state-member", memberCookie, 1],
    ["state-member", memberCookie, personal],
  ] as const) {
    const expected = (await request("/api/state", cookie, workspace)).value;
    const actor = (await one(f.db, "SELECT * FROM users WHERE name=$1", [
      name,
    ])) as OriginalActor;
    await f.db.transaction(async (sql) => {
      const w = await identity.activeWorkspace(sql, actor, String(workspace));
      assert.deepEqual(
        await records.nodes(sql, actor, expected.server_time),
        expected.nodes,
      );
      assert.deepEqual(await records.assets(sql, w.id), expected.assets);
      assert.deepEqual(
        await records.archivedJobs(sql, w.id, expected.server_time),
        expected.jobs,
      );
    });
    checks.push(
      `${name}/${workspace}: exact nodes, assets and historical jobs, including timing and order`,
    );
  }
  const admin = (await one(f.db, "SELECT * FROM users WHERE id=$1", [
    legacyId("state-oracle", "user", originalAdmin.id),
  ])) as OriginalActor;
  await assert.rejects(
    identity.activeWorkspace(f.db, admin, String(personal)),
    { status: 403 },
  );
  checks.push("administrator cannot read another user's personal workspace");
  const setting = await one(
    f.db,
    "SELECT s.*,w.public_id FROM original_state_settings s JOIN workspaces w ON w.id=s.legacy_workspace_id",
  );
  assert.equal(Number(setting.public_id), before.value.legacy_workspace_id);
  assert.equal(setting.image_enabled, before.value.images.enabled);
  checks.push("legacy workspace and image enable flag survive migration");
  const after = await request("/api/state", adminCookie);
  assert.deepEqual(after.value.assets, before.value.assets);
  assert.deepEqual(after.value.jobs, before.value.jobs);
  assert.deepEqual(after.value.nodes, before.value.nodes);
  checks.push("export and import leave original state records unchanged");
  await mkdir(".runtime-advanced/state-import-parity", { recursive: true });
  await writeFile(
    ".runtime-advanced/state-import-parity/report.json",
    JSON.stringify(
      {
        passed: true,
        scope: "public record sections, not complete /api/state",
        checks,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Original state import parity: ${checks.length} checks passed (3 identity/workspace snapshots)`,
  );
  if (process.argv.includes("--full-state"))
    await verifyFullState(
      f,
      source,
      url,
      credentials,
      [adminCookie, memberCookie],
      personal,
      python,
    );
} finally {
  legacy?.kill("SIGTERM");
  if (legacy && legacy.exitCode === null)
    await new Promise<void>((r) => legacy!.once("exit", () => r()));
  await f.cleanup();
}
