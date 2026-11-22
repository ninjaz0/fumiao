import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
import type {
  ProviderPlugin,
  QueueContext,
} from "@fumiao/plugin-sdk/index.js";

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
