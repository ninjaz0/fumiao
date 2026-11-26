import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { flowLifecycleFixture, flowVideo } from "../helpers/flow-lifecycle.js";
import { museLifecycleFixture } from "../helpers/muse-lifecycle.js";
import { databaseFixture } from "../helpers/database.js";
import { PluginRegistry } from "@fumiao/platform/plugins.js";
import { QueueForecasts } from "@fumiao/platform/queue-snapshot.js";
import { GpuGateway } from "@fumiao/platform/gpu.js";
import { Executor } from "@fumiao/platform/executor.js";
import { Operations } from "@fumiao/platform/operations.js";
import { one } from "@fumiao/platform/db.js";
import { gpuQueue } from "@fumiao/plugin-gpu/queue.js";
import { gpuTiming } from "@fumiao/plugin-gpu/timing.js";
import { forecastQueue } from "@fumiao/platform/queue.js";
import { Estimator } from "@fumiao/platform/timing-math.js";
import { QueueHealthPoller } from "@fumiao/platform/queue-health.js";
import { museQueue } from "@fumiao/plugin-muse/queue.js";
import { flowQueue } from "@fumiao/plugin-flow/queue.js";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { StudioPackages } from "@fumiao/platform/studio-packages.js";
import { StudioCatalog } from "@fumiao/platform/catalog.js";
import { OriginalIdentity } from "@fumiao/original-api/identity.js";
import { OriginalGeneration } from "@fumiao/original-api/generation.js";
import { OriginalEstimates } from "@fumiao/original-api/estimate.js";
import { chatHttp } from "@fumiao/plugin-sdk/chat-transport.js";
import type { ProviderPlugin, QueueContext } from "@fumiao/plugin-sdk/index.js";

const plugin: ProviderPlugin = {
  ...gpuQueue,
  manifest: {
    ...gpuQueue.manifest,
    id: "queue-gpu",
    models: gpuQueue.manifest.models.map(({ studio, ...m }) => m),
  },
};
const old: ProviderPlugin = {
  ...gpuTiming,
  manifest: {
    ...gpuTiming.manifest,
    id: plugin.manifest.id,
    models: plugin.manifest.models,
  },
};
async function fixture() {
  const f = await databaseFixture();
  try {
    f.p.registry = new PluginRegistry([old, plugin]);
    await f.p.registry.installBuiltins(f.db);
    const admin = await f.p.bootstrap({
      name: "queue-admin",
      nickname: "Admin",
      password: "isolated-queue-password",
    });
    const member = await f.db.transaction((sql) =>
      f.p.createUser(
        sql,
        "queue-member",
        "Member",
        "isolated-queue-password",
        "member",
      ),
    );
    for (const user of [admin, member])
      await f.p.adjustCredits(admin, user.workspaceId, {
        amount: 10000,
        key: randomUUID(),
      });
    const { id: connection } = await f.p.createConnection(admin, {
      name: "queue fixture",
      pluginId: plugin.manifest.id,
      version: plugin.manifest.version,
      config: {},
    });
    await f.p.updateConnection(admin, connection, {
      revision: 1,
      enabled: true,
      concurrency: 2,
    });
    const models: Record<string, string> = {};
    for (const m of (
      await f.db.query("SELECT * FROM models WHERE connection_id=$1", [
        connection,
      ])
    ).rows) {
      models[m.provider_model] = m.id;
      await f.p.setModel(admin, m.id, { enabled: true, price: 1 });
    }
    const g = new GpuGateway(f.p),
      pair = await g.pair(admin, { connectionId: connection });
    const node = await g.enroll({
      code: pair.code,
      name: "fixture",
      models: Object.keys(models),
    });
    const create = async (
      user = admin,
      model = "MiniMax H3",
      params: Record<string, unknown> = {},
    ) =>
      f.p.submit(user, user.workspaceId, {
        key: randomUUID(),
        modelId: models[model],
        prompt: "private queue fixture",
        params,
      });
    const ready = () =>
      g.heartbeat(node.token, {
        context: {
          workflow: "h3-v6-native-inputs-turbo4",
          runtime_id: "fixture-boot",
          hardware: "fixture-device",
        },
        queue: {
          stage: "ready",
          ready_models: Object.keys(models),
          video_steps: [4, 20, 32, 50],
          can_accept: true,
        },
      });
    return {
      ...f,
      admin,
      member,
      connection,
      models,
      g,
      node,
      create,
      ready,
      q: new QueueForecasts(f.p),
    };
  } catch (e) {
    await f.cleanup();
    throw e;
  }
}

test("queue forecasts count predecessors across workspaces but reveal only authorized jobs", async () => {
  const f = await fixture();
  try {
    await f.ready();
    const a = await f.create(f.admin),
      b = await f.create(f.member);
    const initial = (await f.q.forWorkspace(f.member, f.member.workspaceId))
      .jobs;
    assert.deepEqual(Object.keys(initial), [b.id]);
    assert.equal(initial[b.id].eta.ahead, 1);
    assert.equal(initial[b.id].eta.reason, "observing");
    assert.ok(!JSON.stringify(initial).includes("private queue fixture"));
    await assert.rejects(
      f.q.forWorkspace(f.member, f.admin.workspaceId),
      /访问权限/,
    );
    await f.p.cancel(f.admin, a.id);
    const next = (await f.q.forWorkspace(f.member, f.member.workspaceId)).jobs[
      b.id
    ];
    assert.equal(next.eta.ahead, 0);
    assert.equal(next.eta.median, 0);
    assert.equal(next.eta.high, 5);
    assert.deepEqual(next.eta.node_ids, [
      Number(
        (
          await one(f.db, "SELECT public_id FROM gpu_nodes WHERE id=$1", [
            f.node.id,
          ])
        ).public_id,
      ),
    ]);
    await f.db.query("UPDATE models SET enabled=false WHERE id=$1", [
      f.models["MiniMax H3"],
    ]);
    assert.deepEqual(
      (await f.q.forWorkspace(f.member, f.member.workspaceId)).jobs[b.id].eta,
      { source: "none", reason: "model_paused", ahead: 0 },
    );
  } finally {
    await f.cleanup();
  }
});

test("GPU queue capability gates real claims by reported readiness and worker support", async () => {
  const f = await fixture();
  try {
    const fast = await f.create(f.admin, "MiniMax H3", { sampling_steps: 4 });
    assert.equal((await f.g.claim(f.node.token)).job, null);
    await f.g.heartbeat(f.node.token, {
      context: { workflow: "h3-v3-rocm-qkv-safe-standard20" },
      queue: {
        stage: "ready",
        ready_models: ["MiniMax H3"],
        video_steps: [20],
      },
    });
    assert.equal((await f.g.claim(f.node.token)).job, null);
    assert.equal(
      (await f.q.forWorkspace(f.admin, f.admin.workspaceId)).jobs[fast.id].eta
        .reason,
      "worker_update",
    );
    await f.ready();
    await f.db.query("UPDATE gpu_nodes SET control='paused' WHERE id=$1", [
      f.node.id,
    ]);
    assert.equal((await f.g.claim(f.node.token)).job, null);
    await f.db.query(
      "UPDATE gpu_nodes SET control='active',last_seen=now()-interval '76 seconds' WHERE id=$1",
      [f.node.id],
    );
    assert.equal((await f.g.claim(f.node.token)).job, null);
    await f.ready();
    const claimed = (await f.g.claim(f.node.token)).job!;
    assert.equal(claimed.id, fast.id);
    await f.db.query(
      "UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
      [fast.id],
    );
    await new Executor(f.p).recover();
    const next = await f.create(f.admin, "breeze-tts-2");
    await f.ready();
    assert.equal(
      (await f.g.claim(f.node.token)).job,
      null,
      "uncertain execution still occupies its physical node",
    );
    await new Operations(f.p).resolve(f.admin, fast.id, {
      action: "refund",
      reason: "Synthetic executor confirmed stopped",
    });
    assert.equal((await f.g.claim(f.node.token)).job!.id, next.id);
    await assert.rejects(
      f.g.heartbeat(f.node.token, {
        queue: { stage: "ready", ready_models: ["not-enrolled"] },
      }),
      /节点模型/,
    );
    await assert.rejects(
      f.g.heartbeat(f.node.token, {
        queue: { stage: "ready", ready_models: [], control: "active" },
      }),
    );
  } finally {
    await f.cleanup();
  }
});

test("unsupported early jobs cannot starve a later eligible GPU model", async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 106; i++)
      await f.create(f.admin, "MiniMax H3", { sampling_steps: 4 });
    const audio = await f.create(f.admin, "breeze-tts-2");
    await f.g.heartbeat(f.node.token, {
      context: { workflow: "h3-v3-rocm-qkv-safe-standard20" },
      queue: {
        stage: "ready",
        ready_models: ["MiniMax H3", "breeze-tts-2"],
        video_steps: [20],
      },
    });
    assert.equal((await f.g.claim(f.node.token)).job!.id, audio.id);
  } finally {
    await f.cleanup();
  }
});

test("unapproved old timing versions remain uncertain instead of receiving new-version estimates", () => {
  const context: QueueContext = {
    jobs: [
      {
        id: 1,
        node: null,
        model: "MiniMax H3",
        kind: "video",
        status: "queued",
        pluginVersion: "1.0.0",
        input: { prompt: "", params: {}, references: [] },
      },
    ],
    nodes: [
      {
        id: 1,
        stage: "ready",
        control: "active",
        lastseen: 1000,
        ready_models: ["MiniMax H3"],
        workflow: "h3-v3-rocm-qkv-safe-standard20",
      },
    ],
    runs: {},
    history: [],
    stamp: 1000,
    health: {},
    imageEnabled: true,
  };
  const estimator = new Estimator([], plugin.manifest.timing!);
  estimator.estimate = () => ({
    source: "history",
    low: 1,
    median: 2,
    high: 3,
    samples: 8,
  });
  const plan = forecastQueue(plugin, context, {}, estimator)[1];
  assert.equal(plan.high, 5);
  assert.equal(plan.duration, undefined);
  assert.equal(plan.finish, undefined);
});

test("queue capabilities cannot be advertised without an installed local adapter", async () => {
  const f = await fixture();
  try {
    const manifest = {
      ...museQueue.manifest,
      id: "missing-queue-adapter",
      models: museQueue.manifest.models.map(({ studio, ...m }) => m),
    };
    await assert.rejects(
      f.p.registry.install(f.db, manifest, "http://127.0.0.1:1"),
      /本地计时和队列适配器/,
    );
    await assert.rejects(
      f.p.registry.install(f.db, manifest),
      /本地计时和队列适配器/,
    );
    assert.equal(
      Number(
        (
          await one(
            f.db,
            "SELECT count(*) AS n FROM plugin_versions WHERE id=$1",
            [manifest.id],
          )
        ).n,
      ),
      0,
    );
  } finally {
    await f.cleanup();
  }
});

test("provider health probes preserve readiness, capacity fallback and public-only task identifiers", async () => {
  let queueStatus = 200,
    accounts: unknown = 1,
    activeTokens = true,
    capacity: unknown = 3;
  const seen: string[] = [];
  const server = createServer((req, res) => {
    assert.equal(req.method, "GET");
    assert.equal(req.headers.authorization, "Bearer isolated-fixture-key");
    seen.push(req.url!);
    if (req.url === "/v1/queue") res.statusCode = queueStatus;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify(
        req.url === "/readyz"
          ? { status: "ready", accounts }
          : req.url === "/v1/models"
            ? { data: [{ id: "fixture" }] }
            : req.url === "/health"
              ? { backend_running: true, has_active_tokens: activeTokens }
              : {
                  capacity,
                  maintenance: 1,
                  tasks: [
                    {
                      id: "external",
                      prompt: "private upstream text",
                      apiKey: "private upstream credential",
                    },
                  ],
                },
      ),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const config = {
        baseUrl: `http://127.0.0.1:${(server.address() as any).port}`,
        apiKey: "isolated-fixture-key",
      },
      signal = AbortSignal.timeout(5000);
    assert.deepEqual(await museQueue.queueHealth!(config, signal), {
      ready: true,
      capacity: 3,
      maintenance: 1,
      tasks: [{ id: "external" }],
    });
    for (const value of [null, "2.5", "", []]) {
      capacity = value;
      assert.deepEqual(await museQueue.queueHealth!(config, signal), {
        ready: true,
        capacity: 1,
        maintenance: 0,
        tasks: [],
      });
    }
    capacity = " 2 ";
    assert.equal((await museQueue.queueHealth!(config, signal)).capacity, 2);
    queueStatus = 404;
    assert.deepEqual(await museQueue.queueHealth!(config, signal), {
      ready: true,
      capacity: 1,
      maintenance: 0,
      tasks: [],
    });
    for (const value of [0, [], {}, null]) {
      accounts = value;
      assert.deepEqual(await museQueue.queueHealth!(config, signal), {
        ready: false,
      });
    }
    assert.deepEqual(await flowQueue.queueHealth!(config, signal), {
      ready: true,
    });
    activeTokens = false;
    assert.deepEqual(await flowQueue.queueHealth!(config, signal), {
      ready: false,
    });
    assert.ok(
      seen.every((path) =>
        ["/readyz", "/v1/models", "/v1/queue", "/health"].includes(path),
      ),
    );
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("provider capacity and revision-fenced health constrain actual dispatch without resubmission", async () => {
  const f = await fixture();
  let posts = 0,
    calls = 0;
  let health: any = {
    ready: true,
    capacity: 2,
    maintenance: 0,
    tasks: [{ id: "external" }],
  };
  let probe = async () => {
    calls++;
    return health;
  };
  const request: ProviderPlugin = {
    ...museQueue,
    manifest: {
      ...museQueue.manifest,
      id: "capacity-provider",
      configSchema: { type: "object" },
      models: museQueue.manifest.models.map(({ studio, ...m }) => m),
    },
    queueHealth: () => probe(),
    submit: async () => ({ state: "pending", remoteId: "own-" + ++posts }),
  };
  try {
    await new QueueHealthPoller(f.p).refresh(f.connection);
    assert.deepEqual(
      await one(
        f.db,
        "SELECT queue_health,queue_refresh_token,queue_refresh_until FROM connections WHERE id=$1",
        [f.connection],
      ),
      {
        queue_health: {},
        queue_refresh_token: null,
        queue_refresh_until: null,
      },
      "plugins without a probe do not mutate snapshots",
    );
    f.p.registry = new PluginRegistry([old, plugin, request]);
    await f.p.registry.installBuiltins(f.db);
    const { id: c } = await f.p.createConnection(f.admin, {
      name: "capacity",
      pluginId: request.manifest.id,
      version: request.manifest.version,
      config: {},
    });
    await f.p.updateConnection(f.admin, c, {
      revision: 1,
      enabled: true,
      concurrency: 2,
    });
    const m = await one(
      f.db,
      "SELECT * FROM models WHERE connection_id=$1 AND kind='video'",
      [c],
    );
    await f.p.setModel(f.admin, m.id, { enabled: true, price: 1 });
    const create = () =>
      f.p.submit(f.admin, f.admin.workspaceId, {
        key: randomUUID(),
        modelId: m.id,
        prompt: "capacity fixture",
      });
    const a = await create(),
      b = await create(),
      executor = new Executor(f.p),
      poller = new QueueHealthPoller(f.p);
    await executor.execute(a.id);
    assert.equal(posts, 0, "no dispatch before authenticated health");
    await poller.refresh(c);
    await executor.execute(a.id);
    await executor.execute(b.id);
    assert.equal(posts, 1, "external task occupies one slot");
    let snapshot = (await f.q.forWorkspace(f.admin, f.admin.workspaceId)).jobs;
    assert.equal(
      snapshot[b.id].eta.reason,
      "observing",
      "running task without measured finish does not invent a free slot",
    );
    health = {
      ready: true,
      capacity: 2,
      maintenance: 0,
      tasks: [{ id: "own-1" }],
    };
    await f.db.query(
      "UPDATE connections SET queue_refresh_until=NULL WHERE id=$1",
      [c],
    );
    await poller.refresh(c);
    await executor.execute(b.id);
    assert.equal(posts, 2);
    assert.equal(
      Number((await f.p.wallet(f.admin, f.admin.workspaceId)).held),
      2,
    );
    // An old probe may finish after configuration changed; it must not publish a
    // usable snapshot for the new revision, and simultaneous pollers share a lease.
    let started!: () => void, release!: () => void;
    const entered = new Promise<void>((r) => (started = r)),
      gate = new Promise<void>((r) => (release = r));
    probe = async () => {
      calls++;
      started();
      await gate;
      return health;
    };
    await f.db.query(
      "UPDATE connections SET queue_refresh_until=NULL WHERE id=$1",
      [c],
    );
    const before = calls,
      refresh = poller.refresh(c);
    await entered;
    await poller.refresh(c);
    assert.equal(calls, before + 1);
    await f.p.updateConnection(f.admin, c, {
      revision: 2,
      enabled: true,
      concurrency: 3,
    });
    release();
    await refresh;
    const connection = await one(
      f.db,
      "SELECT revision,queue_health_revision FROM connections WHERE id=$1",
      [c],
    );
    assert.notEqual(connection.queue_health_revision, connection.revision);
    const third = await create();
    await executor.execute(third.id);
    assert.equal(posts, 2);
  } finally {
    await f.cleanup();
  }
});

test(
  "queue state reads use one PostgreSQL snapshot across concurrent worker changes",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const f = await fixture();
    try {
      await f.ready();
      const j = await f.create();
      let entered!: () => void,
        release!: () => void,
        blocked = false;
      const ready = new Promise<void>((r) => (entered = r)),
        gate = new Promise<void>((r) => (release = r));
      const original = f.p.db;
      f.p.db = {
        ...original,
        transaction: (fn) =>
          original.transaction((sql) =>
            fn({
              query: async (query, params) => {
                const result = await sql.query(query, params);
                if (
                  !blocked &&
                  query.includes("FROM jobs j JOIN connections")
                ) {
                  blocked = true;
                  entered();
                  await gate;
                }
                return result as any;
              },
            }),
          ),
      };
      const reading = f.q.forWorkspace(f.admin, f.admin.workspaceId);
      await ready;
      await f.db.query("UPDATE gpu_nodes SET control='paused' WHERE id=$1", [
        f.node.id,
      ]);
      release();
      assert.equal((await reading).jobs[j.id].eta.high, 5);
      f.p.db = original;
      assert.equal(
        (await f.q.forWorkspace(f.admin, f.admin.workspaceId)).jobs[j.id].eta
          .reason,
        "waiting_gpu",
      );
    } finally {
      await f.cleanup();
    }
  },
);

for (const provider of ["flow", "muse"]) {
  test(
    provider +
      " drains queued work using the old service after an address pause",
    async () => {
      const configs: Record<string, unknown>[] = [];
      let ready = false;
      const options: Partial<ProviderPlugin> = {
        async queueHealth(config) {
          configs.push(config);
          return { ready, capacity: 1 };
        },
      };
      const muse =
        provider === "muse"
          ? await museLifecycleFixture({
              ...options,
              downloadArtifact: async () =>
                sharp({
                  create: {
                    width: 16,
                    height: 16,
                    channels: 3,
                    background: "#345678",
                  },
                })
                  .png()
                  .toBuffer(),
            })
          : undefined;
      const f = muse ?? (await flowLifecycleFixture(options));
      try {
        const model = provider === "flow" ? flowVideo : "muse-image";
        const job = await f.create(model);
        // Reproduce the persisted state immediately after an adapter upgrade.
        await f.db.query(
          `INSERT INTO plugin_versions(id,version,manifest)
         SELECT id,'2.0.0',manifest || '{"version":"2.0.0"}'::jsonb FROM plugin_versions WHERE id=$1 AND version=$2`,
          [job.plugin_id, job.plugin_version],
        );
        await f.db.query(
          `UPDATE connections SET plugin_version='2.0.0', revision=revision+1, sandbox_address_pause='non-public',
         queue_health='{}' WHERE id=$1`,
          [f.connection],
        );
        await assert.rejects(() => f.create(model), /暂停接收新任务/);
        await new QueueHealthPoller(f.p).refresh(f.connection);
        assert.equal(configs.length, 0);
        // The current connection can be repaired while the old queue waits.
        await f.db.query(
          "UPDATE connections SET config=$2,revision=revision+1,sandbox_address_pause=NULL WHERE id=$1",
          [
            f.connection,
            f.p.vault.seal({
              baseUrl: "https://replacement.example",
              apiKey: "replacement",
            }),
          ],
        );
        await f.executor.execute(job.id);
        assert.equal(
          (await one(f.db, "SELECT state FROM jobs WHERE id=$1", [job.id]))
            .state,
          "queued",
        );
        assert.equal(f.requests.length, 0);
        ready = true;
        const restarted = new Executor(f.p);
        await Promise.all([
          restarted.execute(job.id),
          restarted.execute(job.id),
        ]);
        if (muse) {
          muse.setWire({
            body: { status: "completed", url: "/v1/media/result.png" },
          });
          await new Executor(f.p).execute(job.id);
        }
        const done = await one(
          f.db,
          "SELECT state,attempts,plugin_version,config_snapshot FROM jobs WHERE id=$1",
          [job.id],
        );
        assert.equal(done.state, "completed");
        assert.equal(done.attempts, 1);
        assert.equal(done.plugin_version, job.plugin_version);
        assert.equal(done.config_snapshot, job.config_snapshot);
        assert.equal(
          f.requests.filter((r) => provider === "flow" || r.method === "POST")
            .length,
          1,
        );
        assert.equal(configs.length, 2);
        assert.ok(
          configs.every(
            (c) =>
              c.apiKey === "local-fixture" &&
              String(c.baseUrl).startsWith("http://127.0.0.1:"),
          ),
        );
        assert.deepEqual(
          (
            await one(
              f.db,
              "SELECT queue_health FROM connections WHERE id=$1",
              [f.connection],
            )
          ).queue_health,
          {},
        );
        assert.equal(
          (
            await one(
              f.db,
              "SELECT count(*)::int AS n FROM ledger WHERE job_id=$1 AND action='hold'",
              [job.id],
            )
          ).n,
          1,
        );
        const wallet = await f.p.wallet(f.admin, f.wid);
        assert.equal(Number(wallet.balance), 9998);
        assert.equal(Number(wallet.held), 0);
      } finally {
        await f.cleanup();
      }
    },
  );
}

test("Muse 2.1 dispatches multi-account video jobs in parallel without /v1/queue and clamps forecasts to connection concurrency", async () => {
  const f = await databaseFixture();
  const videoPosts: { key: string; prompt: string }[] = [];
  let createdTasks = 0;
  let readyAccounts = 3;
  let queuePayload: Record<string, unknown> | null = null;
  const taskStatuses = new Map<string, Record<string, unknown>>();
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== "Bearer multi-account-key")
      return void res.writeHead(401).end();
    if (req.url === "/readyz")
      return void res.end(
        JSON.stringify({
          status: "ready",
          accounts: readyAccounts,
          browser_running: true,
        }),
      );
    if (req.url === "/v1/models")
      return void res.end('{"data":[{"id":"muse-video"},{"id":"muse-image"}]}');
    if (req.url === "/health")
      return void res.end('{"backend_running":true,"has_active_tokens":true}');
    if (req.url === "/v1/queue" && queuePayload !== null)
      return void res.end(JSON.stringify(queuePayload));
    if (req.method === "POST" && req.url === "/v1/videos") {
      const parts: Buffer[] = [];
      for await (const chunk of req) parts.push(chunk);
      const body = JSON.parse(Buffer.concat(parts).toString());
      const id = "task_" + String(++createdTasks).padStart(32, "0");
      videoPosts.push({
        key: String(req.headers["idempotency-key"]),
        prompt: body.prompt,
      });
      const now = Math.floor(Date.now() / 1000);
      taskStatuses.set(id, {
        id,
        status: "processing",
        phase: "generating",
        created_at: now,
        started_at: now,
        generating_at: now,
      });
      return void res.end(
        JSON.stringify({ id, status: "queued", created_at: now }),
      );
    }
    if (req.url?.startsWith("/v1/videos/task_")) {
      const id = req.url.slice("/v1/videos/".length);
      const state = taskStatuses.get(id);
      if (!state) return void res.writeHead(404).end();
      return void res.end(JSON.stringify(state));
    }
    // Standard muse2api has no /v1/queue endpoint -> 404
    res.writeHead(404).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base =
    "http://127.0.0.1:" + (server.address() as { port: number }).port;
  const sandboxSend: typeof chatHttp = (url, options) => {
    assert.equal(url.origin, "https://1.1.1.1");
    assert.ok(options.lookup);
    return chatHttp(new URL(url.pathname, base), {
      ...options,
      lookup: undefined,
    });
  };
  f.p.registry = new PluginRegistry(undefined, [], sandboxSend);
  try {
    await f.p.registry.initializeStudio(f.db, false);
    const identity = new OriginalIdentity(f.p);
    const creds = { name: "admin", password: "multi-account-password" };
    await identity.bootstrap({ ...creds, nickname: "管理员" });
    const actor = await identity.actor(await identity.login(creds, "fixture"));
    const packages = new StudioPackages(f.p);
    const musePkg = JSON.parse(
      await readFile("plugins/muse/muse.fmplugin.json", "utf8"),
    );
    const flowPkg = JSON.parse(
      await readFile("plugins/flow/flow.fmplugin.json", "utf8"),
    );
    await packages.install(actor, musePkg);
    await packages.install(actor, flowPkg);

    const { id: museConnId } = await f.p.createConnection(
      actor,
      {
        name: "Muse 多账号池",
        pluginId: "muse",
        version: musePkg.adapterVersion,
        config: { baseUrl: "https://1.1.1.1", apiKey: "multi-account-key" },
      },
      true,
    );
    const { id: flowConnId } = await f.p.createConnection(
      actor,
      {
        name: "Flow 默认单并发",
        pluginId: "flow",
        version: flowPkg.adapterVersion,
        config: { baseUrl: "https://1.1.1.1", apiKey: "multi-account-key" },
      },
      true,
    );
    const savedConns = await f.p.studioConnections(actor);
    assert.equal(
      savedConns.find((c) => c.id === museConnId)?.concurrency,
      16,
    );
    assert.equal(
      savedConns.find((c) => c.id === flowConnId)?.concurrency,
      1,
    );

    const catalog = new StudioCatalog(f.db);
    const prices = await catalog.prices();
    await f.db.transaction((sql) =>
      catalog.savePrices(
        sql,
        Object.fromEntries(prices.items.map((i) => [i.key, 2])),
        prices.revision,
      ),
    );
    const museListed = (await packages.list(actor)).find(
      (p) => p.id === "muse",
    )!;
    await packages.change(actor, "muse", museListed.revision, "enable");
    const ws = await one(
      f.db,
      "SELECT * FROM workspaces WHERE owner_id=$1 AND kind='personal'",
      [actor.id],
    );
    await f.db.transaction((sql) =>
      f.p.credit(sql, ws.id, 100, randomUUID(), "adjust"),
    );

    await new QueueHealthPoller(f.p).refresh(museConnId);
    const g = new OriginalGeneration(f.p);
    const submitVideo = async (label: string) => {
      const res = await g.submit(
        actor,
        await g.parse("video", {
          uid: randomUUID(),
          model: "muse-video",
          prompt: label,
          ratio: "16:9",
          seconds: 5,
        }),
        String(ws.public_id),
      );
      return one(f.db, "SELECT * FROM jobs WHERE public_id=$1", [res.id]);
    };

    const j1 = await submitVideo("镜头 1");
    const j2 = await submitVideo("镜头 2");
    const j3 = await submitVideo("镜头 3");
    const j4 = await submitVideo("镜头 4");

    await Promise.all([
      new Executor(f.p).execute(j1.id),
      new Executor(f.p).execute(j2.id),
      new Executor(f.p).execute(j3.id),
      new Executor(f.p).execute(j4.id),
    ]);

    assert.equal(videoPosts.length, 3, "all 3 accounts dispatch in parallel");
    const statesAfterSubmit = (
      await f.db.query(
        "SELECT id,state,remote_id FROM jobs WHERE id=ANY($1::uuid[])",
        [[j1.id, j2.id, j3.id, j4.id]],
      )
    ).rows;
    assert.equal(
      statesAfterSubmit.filter((r) => r.state === "running" && r.remote_id)
        .length,
      3,
    );
    assert.equal(
      statesAfterSubmit.filter((r) => r.state === "queued").length,
      1,
    );

    // Poll the 3 running jobs so their provider clocks advance phase -> generating
    for (const row of statesAfterSubmit.filter((r) => r.state === "running")) {
      await new Executor(f.p).execute(row.id);
    }

    // Settle one of the 3 running jobs via real poll failure to test connection.concurrency = 2 < accounts = 3
    const runningRows = statesAfterSubmit.filter((r) => r.state === "running");
    taskStatuses.set(runningRows[2].remote_id, {
      id: runningRows[2].remote_id,
      status: "failed",
    });
    await new Executor(f.p).execute(runningRows[2].id);

    const currentConn = (await f.p.studioConnections(actor)).find(
      (c) => c.id === museConnId,
    )!;
    await f.p.updateConnection(actor, museConnId, {
      revision: currentConn.revision,
      enabled: true,
      concurrency: 2,
    });
    await f.db.query(
      "UPDATE connections SET queue_refresh_until=NULL WHERE id=$1",
      [museConnId],
    );
    await new QueueHealthPoller(f.p).refresh(museConnId);

    // With 2 generating jobs and concurrency=2 (even though readyz.accounts=3):
    // 1) Executor must NOT dispatch the 4th queued job
    const queuedRow = statesAfterSubmit.find((r) => r.state === "queued")!;
    await new Executor(f.p).execute(queuedRow.id);
    assert.equal(videoPosts.length, 3);

    // 2) QueueForecasts and OriginalEstimates must clamp lanes to 2 (not 3),
    //    so neither reports an immediately free 3rd lane (median === 0).
    const forecast = await new QueueForecasts(f.p).forWorkspace(actor, ws.id);
    assert.notEqual(
      forecast.jobs[queuedRow.id].eta.median,
      0,
      "queued job must not see a phantom 3rd lane when connection.concurrency is 2",
    );
    assert.equal(forecast.jobs[queuedRow.id].eta.reason, "observing");

    const est = await new OriginalEstimates(f.p).read(
      actor,
      {
        kind: "video",
        model: "muse-video",
        ratio: "16:9",
        seconds: 5,
        sampling_steps: 20,
        refs: [],
      },
      String(ws.public_id),
    );
    assert.notEqual(
      est.queue?.median,
      0,
      "estimate must also clamp lanes to connection.concurrency=2",
    );
    assert.equal(est.queue?.reason, "observing");

    // When readyz.accounts = 5, external tasks = 2, and connection.concurrency = 2,
    // upstream still has 5 - 2 = 3 free accounts (>= connection.concurrency = 2).
    // With 0 running Fumiao jobs, QueueForecasts/OriginalEstimates must NOT subtract
    // external tasks AFTER clamping to concurrency (min(5, 2) - 2 = 0 -> false muse_busy).
    for (const r of runningRows.slice(0, 2)) {
      taskStatuses.set(r.remote_id, { id: r.remote_id, status: "failed" });
      await new Executor(f.p).execute(r.id);
    }
    readyAccounts = 5;
    queuePayload = { tasks: [{ id: "ext-1" }, { id: "ext-2" }] };
    await f.db.query(
      "UPDATE connections SET queue_refresh_until=NULL WHERE id=$1",
      [museConnId],
    );
    await new QueueHealthPoller(f.p).refresh(museConnId);

    const extForecast = await new QueueForecasts(f.p).forWorkspace(
      actor,
      ws.id,
    );
    assert.notEqual(
      extForecast.jobs[queuedRow.id].eta.reason,
      "muse_busy",
      "5 accounts - 2 external leaves 3 upstream slots (>= concurrency 2), so lane is open",
    );
    assert.equal(extForecast.jobs[queuedRow.id].eta.median, 0);

    const extEst = await new OriginalEstimates(f.p).read(
      actor,
      {
        kind: "video",
        model: "muse-video",
        ratio: "16:9",
        seconds: 5,
        sampling_steps: 20,
        refs: [],
      },
      String(ws.public_id),
    );
    assert.notEqual(extEst.queue?.reason, "muse_busy");
    assert.equal(extEst.queue?.median, 0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await f.cleanup();
  }
});

test("Muse 2.1.0 caps concurrent image admission and forecast lanes at 8 while preserving 12-account shared image+video capacity", async () => {
  const f = await databaseFixture();
  const pngBytes = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "#2266aa" },
  })
    .png()
    .toBuffer();
  let taskSeq = 0;
  let image429Count = 0;
  const tasks = new Map<
    string,
    { kind: "image" | "video"; status: string; phase?: string; url?: string }
  >();
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== "Bearer muse-12-key")
      return void res.writeHead(401).end();
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/readyz")
      return void res.end(
        JSON.stringify({
          status: "ready",
          accounts: 12,
          browser_running: true,
        }),
      );
    if (req.url === "/v1/models")
      return void res.end(
        JSON.stringify({
          data: [{ id: "muse-image" }, { id: "muse-video" }],
        }),
      );
    if (req.url === "/v1/media/done.png") {
      res.setHeader("Content-Type", "image/png");
      return void res.end(pngBytes);
    }
    if (req.method === "POST" && req.url === "/v1/images/tasks") {
      for await (const _ of req) {
        // drain
      }
      const activeImages = [...tasks.values()].filter(
        (t) =>
          t.kind === "image" && ["queued", "processing"].includes(t.status),
      ).length;
      if (activeImages >= 8) {
        image429Count++;
        res.statusCode = 429;
        return void res.end(
          JSON.stringify({ detail: "Image queue is full; retry later" }),
        );
      }
      taskSeq++;
      const id = `task_${String(taskSeq).padStart(32, "0")}`;
      const now = Math.floor(Date.now() / 1000);
      tasks.set(id, { kind: "image", status: "processing", phase: "generating" });
      res.statusCode = 202;
      return void res.end(
        JSON.stringify({ id, task_id: id, status: "queued", created_at: now }),
      );
    }
    if (req.method === "POST" && req.url === "/v1/videos") {
      for await (const _ of req) {
        // drain
      }
      taskSeq++;
      const id = `task_${String(taskSeq).padStart(32, "0")}`;
      const now = Math.floor(Date.now() / 1000);
      tasks.set(id, { kind: "video", status: "processing", phase: "generating" });
      return void res.end(
        JSON.stringify({ id, status: "queued", created_at: now }),
      );
    }
    if (req.url?.startsWith("/v1/images/tasks/task_")) {
      const id = req.url.slice("/v1/images/tasks/".length);
      const t = tasks.get(id);
      if (!t) return void res.writeHead(404).end();
      const now = Math.floor(Date.now() / 1000);
      return void res.end(
        JSON.stringify({
          id,
          status: t.status,
          ...(t.phase ? { phase: t.phase } : {}),
          ...(t.url ? { url: t.url } : {}),
          created_at: now,
          started_at: now,
          generating_at: now,
        }),
      );
    }
    if (req.url?.startsWith("/v1/videos/task_")) {
      const id = req.url.slice("/v1/videos/".length);
      const t = tasks.get(id);
      if (!t) return void res.writeHead(404).end();
      const now = Math.floor(Date.now() / 1000);
      return void res.end(
        JSON.stringify({
          id,
          status: t.status,
          ...(t.phase ? { phase: t.phase } : {}),
          created_at: now,
          started_at: now,
          generating_at: now,
        }),
      );
    }
    res.writeHead(404).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base =
    "http://127.0.0.1:" + (server.address() as { port: number }).port;
  const sandboxSend: typeof chatHttp = (url, options) => {
    assert.equal(url.origin, "https://1.1.1.1");
    assert.ok(options.lookup);
    return chatHttp(new URL(url.pathname, base), {
      ...options,
      lookup: undefined,
    });
  };
  f.p.registry = new PluginRegistry(undefined, [], sandboxSend);
  try {
    await f.p.registry.initializeStudio(f.db, false);
    const identity = new OriginalIdentity(f.p);
    const creds = { name: "admin", password: "muse-12-accounts-password" };
    await identity.bootstrap({ ...creds, nickname: "管理员" });
    const actor = await identity.actor(await identity.login(creds, "fixture"));
    const packages = new StudioPackages(f.p);
    const musePkg = JSON.parse(
      await readFile("plugins/muse/muse.fmplugin.json", "utf8"),
    );
    await packages.install(actor, musePkg);
    const { id: museConnId } = await f.p.createConnection(
      actor,
      {
        name: "Muse 12账号池",
        pluginId: "muse",
        version: musePkg.adapterVersion,
        config: { baseUrl: "https://1.1.1.1", apiKey: "muse-12-key" },
      },
      true,
    );
    const catalog = new StudioCatalog(f.db);
    const prices = await catalog.prices();
    await f.db.transaction((sql) =>
      catalog.savePrices(
        sql,
        Object.fromEntries(prices.items.map((i) => [i.key, 1])),
        prices.revision,
      ),
    );
    const museListed = (await packages.list(actor)).find(
      (p) => p.id === "muse",
    )!;
    await packages.change(actor, "muse", museListed.revision, "enable");
    const ws = await one(
      f.db,
      "SELECT * FROM workspaces WHERE owner_id=$1 AND kind='personal'",
      [actor.id],
    );
    await f.db.transaction((sql) =>
      f.p.credit(sql, ws.id, 200, randomUUID(), "adjust"),
    );

    // Seed calibration samples for muse-image (20s) and muse-video (60s)
    const timingPolicy = JSON.stringify(musePkg.manifest.timing);
    const imgFeatures = JSON.stringify({
      kind: "image",
      model: "muse-image",
      executor: "muse-api",
      workflow: "muse2api-native-v1",
      width: 0,
      height: 0,
      native_ratio: "1:1",
      seconds: 0,
      steps: 0,
      video_mode: "image",
      quality: "native",
      refs: 0,
      ref_pixels: 0,
      hardware: "muse-api",
      profile: {},
      runtime_id: "",
      cold: null,
    });
    const vidFeatures = JSON.stringify({
      kind: "video",
      model: "muse-video",
      executor: "muse-api",
      workflow: "muse2api-native-v1",
      width: 0,
      height: 0,
      native_ratio: "16:9",
      seconds: 5,
      steps: 0,
      video_mode: "t2v",
      quality: "native",
      refs: 0,
      ref_pixels: 0,
      hardware: "muse-api",
      profile: {},
      runtime_id: "",
      cold: null,
    });
    for (let i = 0; i < 6; i++) {
      await f.db.query(
        "INSERT INTO job_runs(run_key,attempt,plugin_id,plugin_version,policy,kind,model,features,created,started,finished,status,phase) VALUES($1,1,'muse',$2,$3,'image','muse-image',$4,$5,$5,$6,'done','done')",
        [randomUUID(), musePkg.adapterVersion, timingPolicy, imgFeatures, 1000 + i * 100, 1020 + i * 100],
      );
      await f.db.query(
        "INSERT INTO job_runs(run_key,attempt,plugin_id,plugin_version,policy,kind,model,features,created,started,finished,status,phase) VALUES($1,1,'muse',$2,$3,'video','muse-video',$4,$5,$5,$6,'done','done')",
        [randomUUID(), musePkg.adapterVersion, timingPolicy, vidFeatures, 2000 + i * 100, 2060 + i * 100],
      );
    }

    await new QueueHealthPoller(f.p).refresh(museConnId);
    const g = new OriginalGeneration(f.p);
    const submitImage = async (label: string) => {
      const res = await g.submit(
        actor,
        await g.parse("image", {
          uid: randomUUID(),
          model: "muse-image",
          prompt: label,
          ratio: "1:1",
          resolution: "1K",
        }),
        String(ws.public_id),
      );
      return one(f.db, "SELECT * FROM jobs WHERE public_id=$1", [res.id]);
    };
    const submitVideo = async (label: string) => {
      const res = await g.submit(
        actor,
        await g.parse("video", {
          uid: randomUUID(),
          model: "muse-video",
          prompt: label,
          ratio: "16:9",
          seconds: 5,
        }),
        String(ws.public_id),
      );
      return one(f.db, "SELECT * FROM jobs WHERE public_id=$1", [res.id]);
    };

    const images = [];
    for (let i = 1; i <= 9; i++) images.push(await submitImage(`图 ${i}`));
    const videos = [];
    for (let i = 1; i <= 4; i++) videos.push(await submitVideo(`视频 ${i}`));

    // 1) Forecast check before dispatch:
    //    - Images 1..8 start immediately (median 0)
    //    - 9th image must wait for one of the 8 image lanes (median > 0)
    //    - Videos 1..4 submitted AFTER 9th image still start immediately (median 0) on shared slots 9..12
    const preForecast = await new QueueForecasts(f.p).forWorkspace(actor, ws.id);
    for (const img of images.slice(0, 8)) {
      assert.equal(preForecast.jobs[img.id].eta.source, "queue");
      assert.equal(preForecast.jobs[img.id].eta.median, 0);
    }
    assert.equal(preForecast.jobs[images[8].id].eta.source, "queue");
    assert.ok(
      preForecast.jobs[images[8].id].eta.median > 0,
      `9th image must wait for 8-image cap, got median=${preForecast.jobs[images[8].id].eta.median}`,
    );
    for (const vid of videos) {
      assert.equal(preForecast.jobs[vid.id].eta.source, "queue");
      assert.equal(
        preForecast.jobs[vid.id].eta.median,
        0,
        "videos 1..4 must use remaining shared slots 9..12 without waiting behind 9th image",
      );
    }
    // 5th video candidate estimate sees all 12 shared slots occupied -> median > 0
    const estFifthVideo = await new OriginalEstimates(f.p).read(
      actor,
      {
        kind: "video",
        model: "muse-video",
        ratio: "16:9",
        seconds: 5,
        sampling_steps: 20,
        refs: [],
      },
      String(ws.public_id),
    );
    assert.ok((estFifthVideo.queue?.median ?? 0) > 0);

    // 2) Dispatch check:
    //    - Executor dispatches Images 1..8 and Videos 1..4 (12 active total)
    //    - 9th image remains queued locally with zero upstream 429s
    const executor = new Executor(f.p);
    for (const j of [...images, ...videos]) {
      await executor.execute(j.id);
    }
    assert.equal(image429Count, 0, "must never hit upstream 429 image limit");
    const afterDispatch = (
      await f.db.query(
        "SELECT id,kind,state,remote_id,request_retry_at FROM jobs WHERE id=ANY($1::uuid[])",
        [[...images, ...videos].map((j) => j.id)],
      )
    ).rows;
    const byId = new Map(afterDispatch.map((r) => [r.id, r]));
    for (const img of images.slice(0, 8)) {
      assert.equal(byId.get(img.id)!.state, "running");
    }
    assert.equal(byId.get(images[8].id)!.state, "queued");
    assert.equal(byId.get(images[8].id)!.request_retry_at, null);
    for (const vid of videos) {
      assert.equal(byId.get(vid.id)!.state, "running");
    }

    // 3) Advance generating phase on active jobs and verify live forecast still keeps 9th image waiting
    //    while 5th video candidate also waits on full 12 shared slots
    for (const j of [...images.slice(0, 8), ...videos]) {
      await executor.execute(j.id);
    }
    const liveForecast = await new QueueForecasts(f.p).forWorkspace(actor, ws.id);
    assert.ok(liveForecast.jobs[images[8].id].eta.median > 0);

    // 4) Complete Image 1 -> frees both 1 image slot and 1 shared slot -> 9th image dispatches cleanly
    const firstImgRemoteId = byId.get(images[0].id)!.remote_id;
    tasks.set(firstImgRemoteId, {
      kind: "image",
      status: "completed",
      url: "/v1/media/done.png",
    });
    await executor.execute(images[0].id);
    const doneFirst = await one(f.db, "SELECT state FROM jobs WHERE id=$1", [
      images[0].id,
    ]);
    assert.equal(doneFirst.state, "completed");

    await executor.execute(images[8].id);
    const ninthAfter = await one(f.db, "SELECT state FROM jobs WHERE id=$1", [
      images[8].id,
    ]);
    assert.equal(ninthAfter.state, "running");
    assert.equal(image429Count, 0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await f.cleanup();
  }
});

test("Muse 2.1.0 deducts external image occupancy from 8-image cap while external video only consumes shared capacity, and isolates same-version edited endpoints", async () => {
  const f = await databaseFixture();
  const pngBytes = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "#448866" },
  })
    .png()
    .toBuffer();
  let seqA = 0;
  let activeOnA = 0;
  let maxConcurrentOnA = 0;
  const completedOnA = new Set<string>();
  const serverA = createServer(async (req, res) => {
    if (req.headers.authorization !== "Bearer key-endpoint-a")
      return void res.writeHead(401).end();
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/readyz")
      return void res.end(
        JSON.stringify({ status: "ready", accounts: 1, browser_running: true }),
      );
    if (req.url === "/v1/models")
      return void res.end(
        JSON.stringify({
          data: [{ id: "muse-image" }, { id: "muse-video" }],
        }),
      );
    if (req.url === "/v1/media/a.png") {
      res.setHeader("Content-Type", "image/png");
      return void res.end(pngBytes);
    }
    if (req.method === "POST" && req.url === "/v1/images/tasks") {
      for await (const _ of req) {
        // drain
      }
      seqA++;
      activeOnA++;
      maxConcurrentOnA = Math.max(maxConcurrentOnA, activeOnA);
      const id = `task_a${String(seqA).padStart(31, "0")}`;
      const now = Math.floor(Date.now() / 1000);
      res.statusCode = 202;
      return void res.end(
        JSON.stringify({ id, task_id: id, status: "queued", created_at: now }),
      );
    }
    if (req.url?.startsWith("/v1/images/tasks/task_")) {
      const id = req.url.slice("/v1/images/tasks/".length);
      const now = Math.floor(Date.now() / 1000);
      if (completedOnA.has(id))
        return void res.end(
          JSON.stringify({
            id,
            status: "completed",
            url: "/v1/media/a.png",
            created_at: now,
            started_at: now,
            generating_at: now,
          }),
        );
      return void res.end(
        JSON.stringify({
          id,
          status: "processing",
          phase: "generating",
          created_at: now,
          started_at: now,
          generating_at: now,
        }),
      );
    }
    res.writeHead(404).end();
  });

  let seqB = 0;
  let externalTasksB: { id: string; kind?: string }[] = [];
  let exposeQueueEndpointB = false;
  const tasksB = new Map<string, { kind: string; status: string }>();
  const serverB = createServer(async (req, res) => {
    if (req.headers.authorization !== "Bearer key-endpoint-b")
      return void res.writeHead(401).end();
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/readyz")
      return void res.end(
        JSON.stringify({ status: "ready", accounts: 12, browser_running: true }),
      );
    if (req.url === "/v1/models")
      return void res.end(
        JSON.stringify({
          data: [{ id: "muse-image" }, { id: "muse-video" }],
        }),
      );
    if (req.url === "/v1/queue") {
      if (!exposeQueueEndpointB) return void res.writeHead(404).end();
      const own = [...tasksB.entries()]
        .filter(([, v]) => v.status === "processing")
        .map(([id, v]) => ({ id, kind: v.kind }));
      return void res.end(
        JSON.stringify({
          capacity: 12,
          maintenance: 0,
          tasks: [...own, ...externalTasksB],
        }),
      );
    }
    if (
      req.method === "POST" &&
      (req.url === "/v1/images/tasks" || req.url === "/v1/videos")
    ) {
      for await (const _ of req) {
        // drain
      }
      seqB++;
      const kind = req.url === "/v1/images/tasks" ? "image" : "video";
      const id = `task_b${String(seqB).padStart(31, "0")}`;
      tasksB.set(id, { kind, status: "processing" });
      const now = Math.floor(Date.now() / 1000);
      res.statusCode = kind === "image" ? 202 : 200;
      return void res.end(
        JSON.stringify({ id, task_id: id, status: "queued", created_at: now }),
      );
    }
    if (
      req.url?.startsWith("/v1/images/tasks/task_") ||
      req.url?.startsWith("/v1/videos/task_")
    ) {
      const id = req.url.split("/").at(-1)!;
      const now = Math.floor(Date.now() / 1000);
      return void res.end(
        JSON.stringify({
          id,
          status: "processing",
          phase: "generating",
          created_at: now,
          started_at: now,
          generating_at: now,
        }),
      );
    }
    res.writeHead(404).end();
  });

  serverA.listen(0, "127.0.0.1");
  serverB.listen(0, "127.0.0.1");
  await Promise.all([once(serverA, "listening"), once(serverB, "listening")]);
  const baseA =
    "http://127.0.0.1:" + (serverA.address() as { port: number }).port;
  const baseB =
    "http://127.0.0.1:" + (serverB.address() as { port: number }).port;
  const sandboxSend: typeof chatHttp = (url, options) => {
    assert.ok(options.lookup);
    const targetBase = url.origin === "https://1.1.1.1" ? baseA : baseB;
    return chatHttp(new URL(url.pathname, targetBase), {
      ...options,
      lookup: undefined,
    });
  };
  f.p.registry = new PluginRegistry(undefined, [], sandboxSend);
  try {
    await f.p.registry.initializeStudio(f.db, false);
    const identity = new OriginalIdentity(f.p);
    const creds = { name: "admin", password: "endpoint-edit-password" };
    await identity.bootstrap({ ...creds, nickname: "管理员" });
    const actor = await identity.actor(await identity.login(creds, "fixture"));
    const packages = new StudioPackages(f.p);
    const musePkg = JSON.parse(
      await readFile("plugins/muse/muse.fmplugin.json", "utf8"),
    );
    await packages.install(actor, musePkg);
    const { id: connId } = await f.p.createConnection(
      actor,
      {
        name: "Muse 切换测试",
        pluginId: "muse",
        version: musePkg.adapterVersion,
        config: { baseUrl: "https://1.1.1.1", apiKey: "key-endpoint-a" },
      },
      true,
    );
    const catalog = new StudioCatalog(f.db);
    const prices = await catalog.prices();
    await f.db.transaction((sql) =>
      catalog.savePrices(
        sql,
        Object.fromEntries(prices.items.map((i) => [i.key, 1])),
        prices.revision,
      ),
    );
    const museListed = (await packages.list(actor)).find(
      (p) => p.id === "muse",
    )!;
    await packages.change(actor, "muse", museListed.revision, "enable");
    const ws = await one(
      f.db,
      "SELECT * FROM workspaces WHERE owner_id=$1 AND kind='personal'",
      [actor.id],
    );
    await f.db.transaction((sql) =>
      f.p.credit(sql, ws.id, 200, randomUUID(), "adjust"),
    );

    const timingPolicy = JSON.stringify(musePkg.manifest.timing);
    const imgFeatures = JSON.stringify({
      kind: "image",
      model: "muse-image",
      executor: "muse-api",
      workflow: "muse2api-native-v1",
      width: 0,
      height: 0,
      native_ratio: "1:1",
      seconds: 0,
      steps: 0,
      video_mode: "image",
      quality: "native",
      refs: 0,
      ref_pixels: 0,
      hardware: "muse-api",
      profile: {},
      runtime_id: "",
      cold: null,
    });
    const vidFeatures = JSON.stringify({
      kind: "video",
      model: "muse-video",
      executor: "muse-api",
      workflow: "muse2api-native-v1",
      width: 0,
      height: 0,
      native_ratio: "16:9",
      seconds: 5,
      steps: 0,
      video_mode: "t2v",
      quality: "native",
      refs: 0,
      ref_pixels: 0,
      hardware: "muse-api",
      profile: {},
      runtime_id: "",
      cold: null,
    });
    for (let i = 0; i < 6; i++) {
      await f.db.query(
        "INSERT INTO job_runs(run_key,attempt,plugin_id,plugin_version,policy,kind,model,features,created,started,finished,status,phase) VALUES($1,1,'muse',$2,$3,'image','muse-image',$4,$5,$5,$6,'done','done')",
        [
          randomUUID(),
          musePkg.adapterVersion,
          timingPolicy,
          imgFeatures,
          1000 + i * 100,
          1020 + i * 100,
        ],
      );
      await f.db.query(
        "INSERT INTO job_runs(run_key,attempt,plugin_id,plugin_version,policy,kind,model,features,created,started,finished,status,phase) VALUES($1,1,'muse',$2,$3,'video','muse-video',$4,$5,$5,$6,'done','done')",
        [
          randomUUID(),
          musePkg.adapterVersion,
          timingPolicy,
          vidFeatures,
          2000 + i * 100,
          2060 + i * 100,
        ],
      );
    }

    const g = new OriginalGeneration(f.p);
    const executor = new Executor(f.p);
    const submitImage = async (label: string) => {
      const res = await g.submit(
        actor,
        await g.parse("image", {
          uid: randomUUID(),
          model: "muse-image",
          prompt: label,
          ratio: "1:1",
          resolution: "1K",
        }),
        String(ws.public_id),
      );
      return one(f.db, "SELECT * FROM jobs WHERE public_id=$1", [res.id]);
    };
    const submitVideo = async (label: string) => {
      const res = await g.submit(
        actor,
        await g.parse("video", {
          uid: randomUUID(),
          model: "muse-video",
          prompt: label,
          ratio: "16:9",
          seconds: 5,
        }),
        String(ws.public_id),
      );
      return one(f.db, "SELECT * FROM jobs WHERE public_id=$1", [res.id]);
    };

    // --- Part 0: Editing ONLY publicUrl on 1-account Endpoint A still shares 1-account capacity ---
    await new QueueHealthPoller(f.p).refresh(connId);
    const pubA1 = await submitImage("Endpoint A publicUrl改前");
    const connInitial = (await f.p.studioConnections(actor)).find(
      (c) => c.id === connId,
    )!;
    await f.p.updateConnection(actor, connId, {
      revision: connInitial.revision,
      enabled: true,
      concurrency: 16,
      config: {
        baseUrl: "https://1.1.1.1",
        apiKey: "key-endpoint-a",
        publicUrl: "https://alias-a.example.com/muse",
      },
    });
    await f.db.query(
      "UPDATE connections SET queue_refresh_until=NULL WHERE id=$1",
      [connId],
    );
    await new QueueHealthPoller(f.p).refresh(connId);
    const pubA2 = await submitImage("Endpoint A publicUrl改后");

    await executor.execute(pubA1.id);
    await executor.execute(pubA1.id); // generating phase on Endpoint A
    await executor.execute(pubA2.id);
    assert.equal(
      maxConcurrentOnA,
      1,
      "editing only publicUrl must still share 1-account Endpoint A capacity",
    );
    assert.equal(
      (await one(f.db, "SELECT state FROM jobs WHERE id=$1", [pubA1.id])).state,
      "running",
    );
    assert.equal(
      (await one(f.db, "SELECT state FROM jobs WHERE id=$1", [pubA2.id])).state,
      "queued",
    );
    const pubAForecast = await new QueueForecasts(f.p).forWorkspace(
      actor,
      ws.id,
    );
    assert.ok(
      pubAForecast.jobs[pubA2.id].eta.median > 0,
      "post-publicUrl-edit queued job must see pre-edit running job occupying Endpoint A's 1 account",
    );

    const pubA1Remote = (
      await one(f.db, "SELECT remote_id FROM jobs WHERE id=$1", [pubA1.id])
    ).remote_id;
    completedOnA.add(pubA1Remote);
    activeOnA--;
    await executor.execute(pubA1.id);
    await executor.execute(pubA2.id);
    const pubA2Remote = (
      await one(f.db, "SELECT remote_id FROM jobs WHERE id=$1", [pubA2.id])
    ).remote_id;
    completedOnA.add(pubA2Remote);
    activeOnA--;
    await executor.execute(pubA2.id);
    assert.equal(maxConcurrentOnA, 1);

    // --- Part A (Item 3): Same-version edit from 1-account Endpoint A to 12-account Endpoint B ---
    const jobA1 = await submitImage("Endpoint A 图 1");
    const jobA2 = await submitImage("Endpoint A 图 2");

    const connBeforeEdit = (await f.p.studioConnections(actor)).find(
      (c) => c.id === connId,
    )!;
    await f.p.updateConnection(actor, connId, {
      revision: connBeforeEdit.revision,
      enabled: true,
      concurrency: 16,
      config: { baseUrl: "https://8.8.8.8", apiKey: "key-endpoint-b" },
    });
    await f.db.query(
      "UPDATE connections SET queue_refresh_until=NULL WHERE id=$1",
      [connId],
    );
    await new QueueHealthPoller(f.p).refresh(connId);
    assert.equal(
      (
        await one(f.db, "SELECT queue_health FROM connections WHERE id=$1", [
          connId,
        ])
      ).queue_health.capacity,
      12,
    );

    // QueueForecasts must NOT use Endpoint B's capacity=12 for jobA1/jobA2 frozen on Endpoint A
    const forecastAfterEdit = await new QueueForecasts(f.p).forWorkspace(
      actor,
      ws.id,
    );
    assert.equal(forecastAfterEdit.jobs[jobA1.id].eta.source, "none");
    assert.equal(forecastAfterEdit.jobs[jobA1.id].eta.reason, "observing");
    assert.equal(forecastAfterEdit.jobs[jobA2.id].eta.source, "none");
    assert.equal(forecastAfterEdit.jobs[jobA2.id].eta.reason, "observing");
    // Meanwhile OriginalEstimates for a new Endpoint B submission sees Endpoint B's 12 accounts -> median 0
    const estB = await new OriginalEstimates(f.p).read(
      actor,
      {
        kind: "image",
        model: "muse-image",
        ratio: "1:1",
        seconds: 5,
        sampling_steps: 20,
        refs: [],
      },
      String(ws.public_id),
    );
    assert.equal(estB.queue?.source, "queue");
    assert.equal(estB.queue?.median, 0);

    // Executor must probe Endpoint A (1 account) for jobA1/jobA2 and dispatch ONLY jobA1
    await executor.execute(jobA1.id);
    await executor.execute(jobA2.id);
    assert.equal(maxConcurrentOnA, 1, "must never concurrently send 2 jobs to 1-account Endpoint A");
    assert.equal(
      (await one(f.db, "SELECT state FROM jobs WHERE id=$1", [jobA1.id])).state,
      "running",
    );
    assert.equal(
      (await one(f.db, "SELECT state FROM jobs WHERE id=$1", [jobA2.id])).state,
      "queued",
    );

    // Finish jobA1 and jobA2 sequentially on Endpoint A
    const a1Remote = (
      await one(f.db, "SELECT remote_id FROM jobs WHERE id=$1", [jobA1.id])
    ).remote_id;
    completedOnA.add(a1Remote);
    activeOnA--;
    await executor.execute(jobA1.id);
    await executor.execute(jobA2.id);
    const a2Remote = (
      await one(f.db, "SELECT remote_id FROM jobs WHERE id=$1", [jobA2.id])
    ).remote_id;
    completedOnA.add(a2Remote);
    activeOnA--;
    await executor.execute(jobA2.id);
    assert.equal(maxConcurrentOnA, 1);

    // --- Part B (Item 2): External image vs external video occupancy on Endpoint B ---
    exposeQueueEndpointB = true;
    externalTasksB = [{ id: "ext-img-1", kind: "image" }];
    await f.db.query(
      "UPDATE connections SET queue_refresh_until=NULL WHERE id=$1",
      [connId],
    );
    await new QueueHealthPoller(f.p).refresh(connId);

    const bImages = [];
    for (let i = 1; i <= 8; i++) bImages.push(await submitImage(`B 图 ${i}`));
    const bVideo = await submitVideo("B 视频 1");

    // Dispatch 7 local images first and advance to generating
    for (const img of bImages.slice(0, 7)) {
      await executor.execute(img.id);
      await executor.execute(img.id);
    }
    await f.db.query(
      "UPDATE connections SET queue_refresh_until=NULL WHERE id=$1",
      [connId],
    );
    await new QueueHealthPoller(f.p).refresh(connId);

    // With 7 local images + 1 external image = 8 images on upstream:
    // - 8th local image (= 9th total image) predicts wait (median > 0) and stays queued on execute
    // - local video predicts immediate start (median === 0) and dispatches immediately
    const extImgForecast = await new QueueForecasts(f.p).forWorkspace(
      actor,
      ws.id,
    );
    assert.ok(
      extImgForecast.jobs[bImages[7].id].eta.median > 0,
      "8th local image must wait when 1 external image already occupies the 8th image slot",
    );
    assert.equal(extImgForecast.jobs[bVideo.id].eta.median, 0);

    await executor.execute(bImages[7].id);
    assert.equal(
      (await one(f.db, "SELECT state FROM jobs WHERE id=$1", [bImages[7].id]))
        .state,
      "queued",
    );
    await executor.execute(bVideo.id);
    assert.equal(
      (await one(f.db, "SELECT state FROM jobs WHERE id=$1", [bVideo.id]))
        .state,
      "running",
    );

    // Now switch external occupancy from external image to external video:
    // 8th local image now predicts immediate start (median === 0) and dispatches!
    externalTasksB = [{ id: "ext-vid-1", kind: "video" }];
    await f.db.query(
      "UPDATE connections SET queue_refresh_until=NULL WHERE id=$1",
      [connId],
    );
    await new QueueHealthPoller(f.p).refresh(connId);

    const extVidForecast = await new QueueForecasts(f.p).forWorkspace(
      actor,
      ws.id,
    );
    assert.equal(extVidForecast.jobs[bImages[7].id].eta.median, 0);
    await executor.execute(bImages[7].id);
    assert.equal(
      (await one(f.db, "SELECT state FROM jobs WHERE id=$1", [bImages[7].id]))
        .state,
      "running",
    );

    // --- Part C: Editing ONLY publicUrl on 12-account Endpoint B preserves shared 8-image cap across pre/post edit jobs ---
    await executor.execute(bImages[7].id); // advance 8th image to generating
    await executor.execute(bVideo.id); // advance video to generating
    externalTasksB = [];
    const connOnB = (await f.p.studioConnections(actor)).find(
      (c) => c.id === connId,
    )!;
    await f.p.updateConnection(actor, connId, {
      revision: connOnB.revision,
      enabled: true,
      concurrency: 16,
      config: {
        baseUrl: "https://8.8.8.8/",
        apiKey: "key-endpoint-b",
        publicUrl: "https://alias-b.example.com/muse",
      },
    });
    await f.db.query(
      "UPDATE connections SET queue_refresh_until=NULL WHERE id=$1",
      [connId],
    );
    await new QueueHealthPoller(f.p).refresh(connId);

    const bImage9AfterPubEdit = await submitImage("B publicUrl改后第9图");
    const bVideo2AfterPubEdit = await submitVideo("B publicUrl改后第2视频");
    const pubBForecast = await new QueueForecasts(f.p).forWorkspace(
      actor,
      ws.id,
    );
    assert.ok(
      pubBForecast.jobs[bImage9AfterPubEdit.id].eta.median > 0,
      "9th image after publicUrl-only edit must still wait behind the 8 active images on Endpoint B",
    );
    assert.equal(
      pubBForecast.jobs[bVideo2AfterPubEdit.id].eta.median,
      0,
      "video after publicUrl-only edit still sees open shared slots (9 < 12) on Endpoint B",
    );
    await executor.execute(bImage9AfterPubEdit.id);
    assert.equal(
      (
        await one(f.db, "SELECT state FROM jobs WHERE id=$1", [
          bImage9AfterPubEdit.id,
        ])
      ).state,
      "queued",
    );
    await executor.execute(bVideo2AfterPubEdit.id);
    assert.equal(
      (
        await one(f.db, "SELECT state FROM jobs WHERE id=$1", [
          bVideo2AfterPubEdit.id,
        ])
      ).state,
      "running",
    );
  } finally {
    serverA.closeAllConnections();
    serverB.closeAllConnections();
    await Promise.all([
      new Promise<void>((done) => serverA.close(() => done())),
      new Promise<void>((done) => serverB.close(() => done())),
    ]);
    await f.cleanup();
  }
});
