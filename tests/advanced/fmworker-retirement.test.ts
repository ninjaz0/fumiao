import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { createServer } from "node:http";
import { join } from "node:path";
import test from "node:test";
import { Queue, QueueEvents, Worker } from "bullmq";
import { createOriginalApp } from "../../apps/api/src/original.js";
import { OriginalIdentity } from "@fumiao/original-api/identity.js";
import { one } from "@fumiao/platform/db.js";
import { Operations } from "@fumiao/platform/operations.js";
import { Executor } from "@fumiao/platform/executor.js";
import { QueueHealthPoller } from "@fumiao/platform/queue-health.js";
import { GpuGateway } from "@fumiao/platform/gpu.js";
import { PluginRegistry } from "@fumiao/platform/plugins.js";
import { hash, secret } from "@fumiao/platform/security.js";
import { flow } from "@fumiao/plugin-flow/index.js";
import { flowText } from "@fumiao/plugin-flow/text.js";
import { gpu } from "@fumiao/plugin-gpu/index.js";
import { gpuText } from "@fumiao/plugin-gpu/text.js";
import { databaseFixture } from "../helpers/database.js";
import { wavFixture } from "../helpers/timing.js";

const retiredGpu = {
  ...gpu.manifest,
  version: "1.12.0",
  fmworkerResources: [{ kind: "breeze", models: ["breeze-tts-2"] }],
};
const retiredFlow = {
  ...flow.manifest,
  version: "1.13.0",
  fmworkerResources: [
    { kind: "flow", models: flow.manifest.models.map(({ id }) => id) },
  ],
};
const flowModel = "flow:veo-3.1-quality-4s-landscape";
const extendModel = "flow:veo-3.1-quality-extend-8s-landscape";
const audioModel = "breeze-tts-2";
const historicalSchema = "030_retired_flow_origin.sql";

async function oldVersion(
  f: Awaited<ReturnType<typeof databaseFixture>>,
  manifest: typeof retiredGpu,
) {
  await f.db.query(
    "INSERT INTO plugin_versions(id,version,manifest) VALUES($1,$2,$3)",
    [manifest.id, manifest.version, JSON.stringify(manifest)],
  );
}

test("new installs reject retired declarations and restart keeps prior versions readable and inert", async () => {
  const f = await databaseFixture(historicalSchema);
  try {
    await f.p.registry.installBuiltins(f.db, true);
    assert.equal(
      await one(
        f.db,
        "SELECT id FROM plugin_versions WHERE manifest ? 'fmworkerResources'",
      ),
      undefined,
    );
    const rejected = {
      status: 400,
      message: "fmWorker 资源能力已退役，无法安装此插件",
    };
    for (const manifest of [retiredGpu, retiredFlow]) {
      // Reject the declaration before schema parsing can strip an unknown key.
      await assert.rejects(f.p.registry.install(f.db, manifest), rejected);
      await assert.rejects(
        f.p.registry.install(
          f.db,
          { ...manifest, fmworkerResources: [] },
          "http://127.0.0.1:9",
        ),
        rejected,
      );
      await oldVersion(f, manifest);
    }
    f.p.registry = new PluginRegistry();
    await f.p.registry.installBuiltins(f.db, true);
    for (const manifest of [retiredGpu, retiredFlow]) {
      const stored = await one(
        f.db,
        "SELECT manifest FROM plugin_versions WHERE id=$1 AND version=$2",
        [manifest.id, manifest.version],
      );
      assert.deepEqual(stored.manifest, JSON.parse(JSON.stringify(manifest)));
      const adapter = await f.p.registry.resolve(
        f.db,
        manifest.id,
        manifest.version,
      );
      assert.equal(adapter.retired, true);
      assert.equal(adapter.manifest.version, manifest.version);
      assert.deepEqual(adapter.manifest.models, manifest.models);
      assert.equal(await adapter.health({}, AbortSignal.timeout(1000)), false);
      await assert.rejects(
        adapter.submit({} as Parameters<typeof adapter.submit>[0]),
        /已退役/,
      );
      assert.equal(Object.hasOwn(adapter.manifest, "fmworkerResources"), false);
      const { fmworkerResources: _, ...replacement } = manifest;
      await assert.rejects(f.p.registry.install(f.db, replacement), {
        status: 409,
      });
    }
    for (const driver of [gpuText, flowText])
      assert.equal(
        await f.p.registry.resolve(
          f.db,
          driver.manifest.id,
          driver.manifest.version,
        ),
        driver,
      );
  } finally {
    await f.cleanup();
  }
});

type Reply = { status: number; body: any; cookie: string | undefined };
function requester(url: string) {
  return async (
    path: string,
    options: {
      method?: string;
      cookie?: string;
      token?: string;
      ticket?: string;
      json?: object;
      bytes?: Uint8Array;
    } = {},
  ): Promise<Reply> => {
    const { method, cookie, token, ticket, json, bytes } = options;
    const res = await fetch(url + path, {
      method: method || (json ? "POST" : "GET"),
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(ticket ? { "X-Job-Ticket": ticket } : {}),
        ...(json ? { "Content-Type": "application/json" } : {}),
        ...(bytes
          ? {
              "Content-Type": "application/octet-stream",
              "X-SHA256": createHash("sha256").update(bytes).digest("hex"),
            }
          : {}),
      },
      body: bytes ? new Uint8Array(bytes) : json && JSON.stringify(json),
      signal: AbortSignal.timeout(15000),
    });
    return {
      status: res.status,
      body: res.headers.get("content-type")?.includes("application/json")
        ? await res.json()
        : Buffer.from(await res.arrayBuffer()),
      cookie: res.headers.getSetCookie()[0]?.split(";")[0],
    };
  };
}

test("old contribution credentials and jobs cannot dispatch or settle through Nest or the GPU agent protocol", async () => {
  const f = await databaseFixture(historicalSchema);
  let nest: Awaited<ReturnType<typeof createOriginalApp>> | undefined;
  try {
    await f.p.registry.installBuiltins(f.db, true);
    await oldVersion(f, retiredGpu);
    const identity = new OriginalIdentity(f.p);
    const credentials = { name: "retirement-admin", password: secret() };
    await identity.bootstrap({ ...credentials, nickname: "Synthetic admin" });
    const token = await identity.login(credentials, "retirement");
    const admin = await identity.actor(token);
    const member = await f.db.transaction((sql) =>
      f.p.createUser(
        sql,
        "retired-node-owner",
        "Synthetic member",
        secret(),
        "member",
      ),
    );
    const wallet = await one(
      f.db,
      "SELECT default_workspace AS id FROM users WHERE id=$1",
      [admin.id],
    );
    await f.db.transaction((sql) =>
      f.p.credit(sql, wallet.id, 100, randomUUID(), "recharge"),
    );
    await f.db.query("UPDATE studio_prices SET amount=10");
    const nodeConnection = await f.p.createConnection(admin, {
      name: "Paired loopback GPU",
      pluginId: gpuText.manifest.id,
      version: gpuText.manifest.version,
      config: {},
    });
    await f.p.updateConnection(admin, nodeConnection.id, {
      revision: 1,
      enabled: true,
      concurrency: 1,
    });
    const oldDriver = randomUUID();
    await f.db.query(
      "INSERT INTO connections(id,name,plugin_id,plugin_version,config,enabled,fmworker_resource_driver) VALUES($1,'Retired driver',$2,$3,$4,false,true)",
      [oldDriver, retiredGpu.id, retiredGpu.version, f.p.vault.seal({})],
    );
    const oldToken = secret();
    const gateway = new GpuGateway(f.p);
    const node = await gateway.addNode(
      f.db,
      oldDriver,
      member.id,
      "Retired fixture node",
      [audioModel],
      hash(oldToken),
    );
    await f.db.query(
      "INSERT INTO fmworker_resources(node_id,kind,enabled) VALUES($1,'breeze',true)",
      [node],
    );
    const cookie = "fm_session=" + token;
    nest = await createOriginalApp(f.p);
    await nest.listen(0, "127.0.0.1");
    const request = requester(await nest.getUrl());
    const pair = await request("/api/pairs", {
      cookie,
      json: { name: "Paired control", models: [audioModel] },
    });
    assert.equal(pair.status, 200);
    const code = pair.body.command.split(" ").at(-1);
    const reused = await request("/agent/enroll", {
      json: { code, secret: oldToken },
    });
    assert.equal(reused.status, 500);
    assert.equal(reused.body.toString(), "Internal Server Error");
    const rejectedInstall = await request("/api/admin/plugins", {
      cookie,
      json: { manifest: retiredGpu, endpoint: "http://127.0.0.1:9" },
    });
    assert.deepEqual(
      [rejectedInstall.status, rejectedInstall.body.detail],
      [400, "fmWorker 资源能力已退役，无法安装此插件"],
    );
    const pairedToken = secret();
    assert.equal(
      (
        await request("/agent/enroll", {
          json: {
            code,
            secret: pairedToken,
          },
        })
      ).status,
      200,
    );
    const registration = await request("/agent/registration", {
      token: pairedToken,
    });
    assert.equal(registration.status, 200);
    const pairedNode = await one(
      f.db,
      "SELECT id FROM gpu_nodes WHERE public_id=$1",
      [registration.body.id],
    );
    const makeAudio = (uid: string) =>
      request("/api/audio-jobs", {
        cookie,
        json: {
          uid,
          model: audioModel,
          prompt: "local synthetic audio",
          seed: 9,
        },
      });
    const old = await makeAudio(randomUUID());
    assert.equal(old.status, 200);
    const oldJob = await one(f.db, "SELECT id FROM jobs WHERE public_id=$1", [
      old.body.id,
    ]);
    const oldTicket = secret();
    const lease = randomUUID();
    await f.db.query(
      "INSERT INTO fmworker_assignments(job_id,ticket,node_id,owner_id,reward_bps,protocol_ticket) VALUES($1,$2,$3,$4,5000,$5)",
      [oldJob.id, lease, node, member.id, oldTicket],
    );
    await f.db.query(
      "UPDATE jobs SET remote_id=$2,lease_token=$3,lease_until=now()-interval '10 minutes',state='running',original_gpu_ticket=$4 WHERE id=$1",
      // Include the ticket on an ordinary node to exercise the assignment fence
      // independently of the retired node's rejected credential.
      [oldJob.id, pairedNode.id, lease, oldTicket],
    );
    const snapshot = async () => {
      const r = await one(
        f.db,
        `SELECT
        (SELECT jsonb_agg(w ORDER BY workspace_id) FROM wallets w) AS wallets,
        (SELECT count(*) FROM ledger) AS ledger,
        (SELECT count(*) FROM fmworker_rewards) AS rewards,
        (SELECT count(*) FROM fmworker_usage) AS usage,
        (SELECT count(*) FROM fmworker_verifications) AS verifications,
        (SELECT count(*) FROM fmworker_resources) AS resources,
        (SELECT count(*) FROM fmworker_assignments) AS assignments,
        (SELECT to_jsonb(j) FROM jobs j WHERE id=$1) AS old_job`,
        [oldJob.id],
      );
      return r;
    };
    const before = await snapshot();
    for (const [method, path] of [
      ["GET", "/api/admin/fmworker/config"],
      ["PUT", "/api/admin/fmworker/config"],
      ["GET", "/api/fmworker/account"],
      ["GET", "/api/fmworker/history"],
      ["GET", "/api/fmworker/flow-verification"],
      ["POST", "/api/fmworker/resources"],
      ["PUT", "/api/fmworker/resources/1"],
      ["DELETE", "/api/fmworker/resources/1"],
      ["POST", "/fmworker/heartbeat"],
      ["POST", "/fmworker/usage"],
      ["POST", "/fmworker/claim"],
      ["PUT", "/fmworker/jobs/1/result"],
      ["POST", "/fmworker/jobs/1/verification"],
      ["GET", "/fmworker/jobs/1/verification/" + randomUUID()],
    ])
      assert.equal(
        (
          await request(path, {
            method,
            cookie,
            token: oldToken,
            ticket: oldTicket,
          })
        ).status,
        404,
        path,
      );
    const oldAssignment = "/agent/jobs/" + old.body.id;
    for (const [method, path, json] of [
      ["GET", "/agent/registration"],
      ["POST", "/agent/heartbeat", { stage: "ready" }],
      ["POST", "/agent/claim"],
      ["GET", oldAssignment + "/receipt"],
      ["GET", oldAssignment + "/ref/" + "a".repeat(32)],
      ["POST", oldAssignment + "/error", { stage: "error", detail: "late" }],
      ["PUT", oldAssignment + "/result"],
    ] as const)
      assert.equal(
        (
          await request(path, {
            method,
            token: oldToken,
            ticket: oldTicket,
            json,
          })
        ).status,
        403,
        path,
      );
    for (const [method, part, json] of [
      ["GET", "/receipt"],
      ["GET", "/ref/" + "a".repeat(32)],
      ["POST", "/error", { stage: "error", detail: "late" }],
      ["PUT", "/result"],
    ] as const)
      assert.equal(
        (
          await request(oldAssignment + part, {
            method,
            token: pairedToken,
            ticket: oldTicket,
            json,
          })
        ).status,
        409,
      );
    const oldNode = await one(
      f.db,
      "SELECT public_id FROM gpu_nodes WHERE id=$1",
      [node],
    );
    assert.equal(
      (
        await request("/api/nodes/" + oldNode.public_id + "/resume", {
          method: "POST",
          cookie,
        })
      ).status,
      404,
    );
    const executor = new Executor(f.p);
    await executor.recover();
    assert.equal(await executor.claim(oldJob.id), undefined);
    assert.deepEqual(await snapshot(), before);
    await f.db.query(
      "UPDATE jobs SET state='queued',lease_token=NULL,lease_until=NULL WHERE id=$1",
      [oldJob.id],
    );
    assert.equal(
      (
        await request("/agent/heartbeat", {
          token: pairedToken,
          json: { stage: "ready", ready_models: [audioModel] },
        })
      ).status,
      200,
    );
    assert.deepEqual(
      (await request("/agent/claim", { method: "POST", token: pairedToken }))
        .body,
      { job: null },
    );

    const uid = randomUUID();
    const ordinary = await makeAudio(uid);
    assert.equal(ordinary.status, 200);
    assert.deepEqual(await makeAudio(uid), ordinary);
    const claimed = (
      await request("/agent/claim", { method: "POST", token: pairedToken })
    ).body.job;
    assert.equal(claimed.id, ordinary.body.id);
    const wav = wavFixture();
    for (let i = 44; i < wav.length; i += 2) wav.writeInt16LE(1100, i);
    const resultPath = "/agent/jobs/" + claimed.id + "/result";
    const result = {
      method: "PUT",
      token: pairedToken,
      ticket: claimed.ticket,
      bytes: wav,
    };
    const delivered = await request(resultPath, result);
    assert.equal(delivered.status, 200, JSON.stringify(delivered.body));
    assert.deepEqual(await request(resultPath, result), delivered);
    assert.deepEqual(
      (await request("/media/" + delivered.body.id, { cookie })).body,
      wav,
    );
    const failed = await makeAudio(randomUUID());
    assert.equal(failed.status, 200);
    const second = (
      await request("/agent/claim", { method: "POST", token: pairedToken })
    ).body.job;
    assert.equal(second.id, failed.body.id);
    assert.equal(
      (
        await request("/agent/jobs/" + second.id + "/error", {
          token: pairedToken,
          ticket: second.ticket,
          json: { stage: "error", detail: "synthetic error" },
        })
      ).status,
      200,
    );
    const ledger = async (job: number) =>
      (
        await f.db.query(
          "SELECT l.action FROM ledger l JOIN jobs j ON j.id=l.job_id WHERE j.public_id=$1 ORDER BY l.public_id",
          [job],
        )
      ).rows.map(({ action }) => action);
    assert.deepEqual(await ledger(claimed.id), ["hold", "spend"]);
    assert.deepEqual(await ledger(second.id), ["hold", "refund"]);
    assert.deepEqual(await ledger(old.body.id), ["hold"]);
    assert.deepEqual(
      await one(
        f.db,
        "SELECT balance::int,held::int FROM wallets WHERE workspace_id=$1",
        [wallet.id],
      ),
      {
        balance:
          Number(
            (before.wallets as any[]).find((w) => w.workspace_id === wallet.id)
              .balance,
          ) - 10,
        held: 10,
      },
    );
    const after = await snapshot();
    for (const key of [
      "rewards",
      "usage",
      "verifications",
      "resources",
      "assignments",
    ])
      assert.equal(after[key], before[key], key);
    assert.deepEqual(
      (after.wallets as any[]).filter((w) => w.workspace_id !== wallet.id),
      (before.wallets as any[]).filter((w) => w.workspace_id !== wallet.id),
    );
  } finally {
    await nest?.close();
    await f.cleanup();
  }
});

test("independent Flow HTTP generates and extends, settles once and refunds a rejected request with retired records present", async () => {
  const f = await databaseFixture(historicalSchema);
  const calls: any[] = [];
  let artifact: Uint8Array;
  let baseUrl: string;
  let downloads = 0;
  const provider = createServer(async (req, res) => {
    if (req.headers.authorization !== "Bearer fixture-flow") {
      res.writeHead(401).end();
      return;
    }
    if (req.url === "/health") {
      res.end(
        JSON.stringify({ backend_running: true, has_active_tokens: true }),
      );
      return;
    }
    if (req.url === "/v1/models") {
      res.end(JSON.stringify({ data: [{ id: "synthetic" }] }));
      return;
    }
    if (req.url === "/tmp/local.mp4") {
      downloads++;
      res.writeHead(200, { "Content-Type": "video/mp4" }).end(artifact);
      return;
    }
    if (req.url !== "/v1/chat/completions") {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    calls.push(body);
    if (body.messages[0].content[0].text === "reject fixture") {
      res.writeHead(400).end("{}");
      return;
    }
    const content = `<video src="${baseUrl}/tmp/local.mp4" data-media-id="fixture/account-owned"></video>`;
    const data = { choices: [{ delta: { content } }] };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(`data: ${JSON.stringify(data)}\n\ndata: [DONE]\n\n`);
  });
  let nest: Awaited<ReturnType<typeof createOriginalApp>> | undefined;
  let queue: Queue | undefined;
  let events: QueueEvents | undefined;
  let worker: Worker | undefined;
  try {
    const clip = join(f.directory, "local.mp4");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=64x32:r=10",
      "-t",
      "0.5",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      clip,
    ]);
    artifact = await readFile(clip);
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    const address = provider.address();
    assert.ok(address && typeof address !== "string");
    baseUrl = "http://127.0.0.1:" + address.port;
    await f.p.registry.installBuiltins(f.db, true);
    await oldVersion(f, retiredFlow);
    const identity = new OriginalIdentity(f.p);
    const credentials = { name: "flow-retirement-admin", password: secret() };
    await identity.bootstrap({
      ...credentials,
      nickname: "Synthetic Flow admin",
    });
    const token = await identity.login(credentials, "flow-retirement");
    const admin = await identity.actor(token);
    const workspace = await one(
      f.db,
      "SELECT default_workspace AS id FROM users WHERE id=$1",
      [admin.id],
    );
    await f.db.transaction((sql) =>
      f.p.credit(sql, workspace.id, 100, randomUUID(), "recharge"),
    );
    await f.db.query("UPDATE studio_prices SET amount=10");
    const owner = await f.db.transaction((sql) =>
      f.p.createUser(
        sql,
        "flow-archived-owner",
        "Synthetic member",
        secret(),
        "member",
      ),
    );
    const archivedConnection = randomUUID();
    await f.db.query(
      "INSERT INTO connections(id,name,plugin_id,plugin_version,config,enabled,fmworker_resource_driver) VALUES($1,'Retired Flow',$2,$3,$4,false,true)",
      [
        archivedConnection,
        retiredFlow.id,
        retiredFlow.version,
        f.p.vault.seal({}),
      ],
    );
    const archivedNode = await new GpuGateway(f.p).addNode(
      f.db,
      archivedConnection,
      owner.id,
      "Retired Flow node",
      [flowModel],
      hash(secret()),
    );
    await f.db.query(
      'UPDATE gpu_nodes SET last_seen=now(),queue_state=\'{ "stage": "ready" }\' WHERE id=$1',
      [archivedNode],
    );
    await f.db.query(
      "INSERT INTO fmworker_resources(node_id,kind,enabled,capabilities) VALUES($1,'flow',true,$2)",
      [archivedNode, JSON.stringify({ models: [flowModel] })],
    );
    const connection = await f.p.createConnection(admin, {
      name: "Loopback Flow",
      pluginId: flowText.manifest.id,
      version: flowText.manifest.version,
      config: { baseUrl, apiKey: "fixture-flow" },
    });
    await f.p.updateConnection(admin, connection.id, {
      revision: 1,
      enabled: true,
      concurrency: 1,
    });
    await new QueueHealthPoller(f.p).refresh(connection.id);
    const executor = new Executor(f.p);
    // The suite also runs without Redis. The isolated Redis run uses the same
    // BullMQ worker handler as the application.
    if (process.env.TEST_REDIS_URL) {
      const url = new URL(process.env.TEST_REDIS_URL);
      const connection = {
        host: url.hostname,
        port: Number(url.port || 6379),
        db: Number(url.pathname.slice(1) || 0),
        username: url.username || undefined,
        password: url.password || undefined,
        ...(url.protocol === "rediss:" ? { tls: {} } : {}),
      };
      const name = "flow-retirement-" + randomUUID();
      queue = new Queue(name, { connection });
      events = new QueueEvents(name, { connection });
      worker = new Worker(name, ({ data }) => executor.execute(data.id), {
        connection,
      });
      await events.waitUntilReady();
    }
    const execute = async (id: string) => {
      if (!queue || !events) {
        await executor.execute(id);
        return;
      }
      const queued = await queue.add("execute", { id });
      await queued.waitUntilFinished(events, 10000);
    };
    nest = await createOriginalApp(f.p);
    await nest.listen(0, "127.0.0.1");
    const request = requester(await nest.getUrl());
    const cookie = "fm_session=" + token;
    const submit = (json: object) => request("/api/jobs", { cookie, json });
    const load = (id: number) =>
      one(f.db, "SELECT * FROM jobs WHERE public_id=$1", [id]);
    const original = {
      uid: randomUUID(),
      model: flowModel,
      prompt: "local Flow generation",
    };
    const first = await submit(original);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.deepEqual(await submit(original), first);
    const job = await load(first.body.id);
    assert.ok((await executor.queueReady()).some(({ id }) => id === job.id));
    await execute(job.id);
    await execute(job.id);
    const completed = await load(first.body.id);
    assert.equal(completed.state, "completed", completed.error);
    assert.equal(completed.result.usage.flow_media_id, "fixture/account-owned");
    const asset = await one(f.db, "SELECT public_id FROM assets WHERE id=$1", [
      completed.result.assets[0],
    ]);
    assert.deepEqual(
      (await request("/media/" + asset.public_id, { cookie })).body,
      artifact,
    );
    assert.equal(calls.length, 1);
    assert.equal(downloads, 1);
    const extend = {
      model: extendModel,
      flow_source_job: first.body.id,
      prompt: "extend in the same HTTP account",
    };
    const normalExtension = await submit({ ...extend, uid: randomUUID() });
    assert.equal(
      normalExtension.status,
      200,
      JSON.stringify(normalExtension.body),
    );
    await execute((await load(normalExtension.body.id)).id);
    assert.equal((await load(normalExtension.body.id)).state, "completed");
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].messages[0].content.at(-1), {
      type: "image_url",
      image_url: { url: "extend://fixture/account-owned" },
    });

    // Model an extension frozen before cutover, with the original media
    // discovered to have come from the retired account. Both admission and
    // already-queued execution must keep the ID out of the HTTP provider.
    const frozenExtension = await submit({ ...extend, uid: randomUUID() });
    assert.equal(frozenExtension.status, 200);
    await f.db.query(
      `INSERT INTO fmworker_rewards(job_number,node_number,owner_id,workspace_id,units,credited,created)
       SELECT $1,n.public_id,u.id,u.default_workspace,5000,0,100
       FROM gpu_nodes n JOIN users u ON u.id=n.owner_id WHERE n.id=$2`,
      [first.body.id, archivedNode],
    );
    await f.db.query("UPDATE jobs SET original_view=$2 WHERE public_id=$1", [
      frozenExtension.body.id,
      JSON.stringify({
        unrelated: { flow_source_job: normalExtension.body.id },
        note: "NUL\0, unpaired \ud800 and literal \\u0000",
        actual: { flow_source_job: first.body.id },
      }),
    ]);
    const frozen = await load(frozenExtension.body.id);
    assert.equal((await submit({ ...extend, uid: randomUUID() })).status, 400);
    assert.ok(
      !(await executor.queueReady()).some(({ id }) => id === frozen.id),
    );
    await execute(frozen.id);
    assert.deepEqual(await load(frozenExtension.body.id), frozen);
    assert.equal(calls.length, 2);

    const operations = new Operations(f.p);
    await f.db.query("UPDATE jobs SET state='uncertain' WHERE id=$1", [
      frozen.id,
    ]);
    const resume = {
      action: "resume",
      reason: "isolated operator check",
      remoteId: "synthetic-id",
    };
    await assert.rejects(operations.resolve(admin, frozen.id, resume), {
      status: 409,
      message: "退役任务只能人工核对退款",
    });

    const quarantined = await submit({
      ...original,
      uid: randomUUID(),
      prompt: "synthetic job quarantined by the cutover",
    });
    assert.equal(quarantined.status, 200);
    const quarantinedId = (await load(quarantined.body.id)).id;
    await f.db.transaction(async (sql) => {
      await sql.query(
        "UPDATE jobs SET state='uncertain',request_uncertain=true WHERE id=$1",
        [quarantinedId],
      );
      await sql.query(
        "INSERT INTO job_events(job_id,state,detail) VALUES($1,'uncertain',$2)",
        [quarantinedId, JSON.stringify({ reason: "fmworker_retired" })],
      );
    });
    await assert.rejects(operations.resolve(admin, quarantinedId, resume), {
      status: 409,
      message: "退役任务只能人工核对退款",
    });

    const rejected = await submit({
      ...extend,
      flow_source_job: normalExtension.body.id,
      uid: randomUUID(),
      prompt: "reject fixture",
    });
    assert.equal(rejected.status, 200);
    await f.db.query("UPDATE jobs SET original_view=$2 WHERE public_id=$1", [
      rejected.body.id,
      JSON.stringify({
        unrelated: { flow_source_job: first.body.id },
        note: '\\u0000 {"actual":{"flow_source_job":42}}',
        actual: { flow_source_job: normalExtension.body.id },
      }),
    ]);
    await execute((await load(rejected.body.id)).id);
    assert.equal((await load(rejected.body.id)).state, "failed");
    assert.equal(calls.length, 3);
    assert.equal(downloads, 2);
    const refund = { action: "refund", reason: "isolated operator check" };
    assert.deepEqual(await operations.resolve(admin, quarantinedId, refund), {
      ok: true,
    });
    await assert.rejects(operations.resolve(admin, quarantinedId, refund), {
      status: 409,
    });
    const ledger = (
      await f.db.query(
        "SELECT action,amount::int FROM ledger WHERE job_id IS NOT NULL ORDER BY public_id",
      )
    ).rows;
    assert.deepEqual(
      ledger.map(({ action, amount }) => [action, amount]),
      [
        ["hold", 10],
        ["spend", 10],
        ["hold", 10],
        ["spend", 10],
        ["hold", 10],
        ["hold", 10],
        ["hold", 10],
        ["refund", 10],
        ["refund", 10],
      ],
    );
    assert.equal(
      Number((await one(f.db, "SELECT count(*) FROM fmworker_rewards")).count),
      1,
    );
    assert.deepEqual(
      await one(
        f.db,
        "SELECT balance::int,held::int FROM wallets WHERE workspace_id=$1",
        [owner.workspaceId],
      ),
      { balance: 0, held: 0 },
    );
  } finally {
    await nest?.close();
    await worker?.close();
    await events?.close();
    await queue?.obliterate();
    await queue?.close();
    if (provider.listening) {
      provider.closeAllConnections();
      await new Promise<void>((done) => provider.close(() => done()));
    }
    await f.cleanup();
  }
});
