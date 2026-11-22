import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { Queue, QueueEvents } from "bullmq";
import sharp from "sharp";
import type { StudioState } from "../../apps/web/studio/state.js";
import type { Manifest } from "@fumiao/plugin-sdk/index.js";
import type { Platform } from "@fumiao/platform/platform.js";
import { redisConnection } from "@fumiao/platform/redis.js";

type Replica = {
  api: string;
  web: string;
  processes: { api: number; web: number; worker: number };
};

function throughNext(web: string) {
  let session = "";
  async function request(
    path: string,
    options: {
      method?: string;
      data?: unknown;
      cookie?: string;
      workspace?: number;
    } = {},
  ) {
    const { data, method = data === undefined ? "GET" : "POST" } = options;
    const response = await fetch(web + path, {
      method,
      redirect: "manual",
      headers: {
        origin: web,
        cookie: options.cookie ?? session,
        ...(data === undefined ? {} : { "content-type": "application/json" }),
        ...(options.workspace === undefined
          ? {}
          : { "x-workspace-id": String(options.workspace) }),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(response.headers.get("x-fumiao-web"), "next", response.url);
    return response;
  }
  return {
    request,
    useSession(cookie: string) {
      session = cookie;
    },
    async json<T>(
      path: string,
      options?: Parameters<typeof request>[1],
      status = 200,
    ) {
      const response = await request(path, options);
      const text = await response.text();
      assert.equal(response.status, status, `${response.url}: ${text}`);
      return JSON.parse(text) as T;
    },
  };
}

async function until<T>(label: string, probe: () => Promise<T | undefined>) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result !== undefined) return result;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

export async function verifyStudioReplicas(
  p: Platform,
  replicas: [Replica, Replica],
  user: { name: string; password: string },
  redisUrl: string,
  s3: {
    endpoint: string;
    bucket: string;
    objects(): Promise<{ Key?: string }[]>;
  },
) {
  const pids = replicas.flatMap(({ processes }) => [
    processes.api,
    processes.web,
    processes.worker,
  ]);
  assert.equal(new Set(pids).size, 6);
  pids.forEach((pid) => {
    assert.ok(Number.isInteger(pid) && pid > 1);
    process.kill(pid, 0);
  });
  for (const { api } of replicas) {
    const health = await fetch(api + "/health", {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { service: "fumiao", ok: true });
  }
  console.log(
    replicas
      .map(
        ({ api, web, processes }, i) =>
          `Replica ${i + 1}: Next ${web} (pid ${processes.web}) -> Nest ${api} (pid ${processes.api}); worker pid ${processes.worker}`,
      )
      .join("\n"),
  );

  const manifest: Manifest = JSON.parse(
    await readFile("plugins/example-studio/manifest.json", "utf8"),
  );
  const key = randomUUID();
  const png = await sharp({
    create: { width: 24, height: 24, channels: 3, background: "#84aabe" },
  })
    .png()
    .toBuffer();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls: string[] = [];
  const errors: unknown[] = [];
  let active = 0;
  let peak = 0;
  const provider = createServer(async (req, res) => {
    try {
      assert.equal(req.headers.authorization, "Bearer " + key);
      if (req.url === "/health") {
        res.writeHead(204).end();
        return;
      }
      assert.equal(req.method, "POST");
      assert.equal(req.url, "/submit");
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      assert.equal(body.model, manifest.models[0].id);
      assert.equal(body.kind, "image");
      assert.equal(req.headers["idempotency-key"], body.jobId);
      assert.equal(body.idempotencyKey, body.jobId);
      calls.push(body.jobId);
      peak = Math.max(peak, ++active);
      await gate;
      active--;
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          state: "completed",
          artifacts: [
            { url: `data:image/png;base64,${png.toString("base64")}` },
          ],
        }),
      );
    } catch (error) {
      errors.push(error);
      res.writeHead(500).end();
    }
  }).listen(0, "127.0.0.1");
  const connection = redisConnection(redisUrl);
  const queue = new Queue("fumiao-jobs", { connection });
  const events = new QueueEvents(queue.name, { connection });
  const attempts: string[] = [];
  events.on("completed", ({ jobId }) => attempts.push(jobId));
  try {
    await Promise.all([once(provider, "listening"), events.waitUntilReady()]);
    const workers = await until("two BullMQ generation consumers", async () => {
      const workers = await queue.getWorkers();
      return workers.length === 2 ? workers : undefined;
    });
    assert.equal(new Set(workers.map(({ id }) => id)).size, 2);
    console.log(
      `Shared Redis generation consumers: ${workers.map(({ id }) => id).join(", ")}`,
    );

    const [a, b] = replicas.map(({ web }) => throughNext(web));
    const login = await a.request("/api/login", { data: user });
    assert.equal(login.status, 200, await login.text());
    const session = login.headers.get("set-cookie")?.split(";")[0];
    assert.match(session ?? "", /^fm_session=/);
    a.useSession(session!);
    b.useSession(session!);
    const state = (client: typeof a, cookie?: string, workspace?: number) =>
      client.json<StudioState>("/api/state", { cookie, workspace });
    const [initial, second] = await Promise.all([state(a), state(b)]);
    assert.equal(initial.me.name, user.name);
    assert.equal(second.me.id, initial.me.id);
    const workspace = initial.workspace_id;
    assert.ok(Number.isSafeInteger(workspace) && workspace > 0);
    assert.equal(second.workspace_id, workspace);

    const endpoint = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;
    await a.json("/api/admin/plugins", { data: { manifest, endpoint } }, 201);
    const { id: connectionId } = await b.json<{ id: string }>(
      "/api/admin/connections",
      {
        data: {
          name: "Loopback replica provider",
          pluginId: manifest.id,
          version: manifest.version,
          config: { apiKey: key },
        },
      },
      201,
    );
    const updateLimit = (revision: number, concurrency: number) =>
      a.json("/api/admin/connections/" + connectionId, {
        method: "PUT",
        data: { revision, enabled: true, concurrency },
      });
    await updateLimit(1, 1);
    const credit = 100;
    await b.json("/api/admin/credits/adjust", {
      data: {
        workspace,
        amount: credit,
        note: "Replica acceptance",
        uid: randomUUID(),
      },
    });
    const before = await state(a);
    assert.deepEqual(before.credits, {
      workspace,
      balance: credit,
      available: credit,
      reserved: 0,
    });
    const imagePath = "/api/image-jobs";
    const model = manifest.models[0].id;
    const draft = (uid: string) => ({
      uid,
      model,
      prompt: "隔离多副本验收",
      ratio: "1:1",
      resolution: "1K",
      image_quality: "low",
      refs: [],
      asset_packs: [],
      parent: null,
      price_revision: before.pricing.revision,
    });
    const repeated = randomUUID();
    const uids = [
      repeated,
      repeated,
      repeated,
      repeated,
      ...Array.from({ length: 4 }, () => randomUUID()),
    ];
    const submit = (client: typeof a, uid: string) =>
      client.json<{ id: number }>(imagePath, { data: draft(uid), workspace });
    const accepted = await Promise.all(
      uids.map((uid, i) => submit(i % 2 ? b : a, uid)),
    );
    const repeatedId = accepted[0].id;
    assert.deepEqual(
      accepted.slice(0, 4).map(({ id }) => id),
      Array(4).fill(repeatedId),
    );
    const ids = new Set(accepted.map(({ id }) => id));
    assert.equal(ids.size, 5);
    assert.ok([...ids].every((id) => Number.isSafeInteger(id) && id > 0));
    const publicIds = [...ids].sort((x, y) => x - y);

    const jobs = async () =>
      (
        await p.db.query<{
          id: string;
          public_id: number;
          state: string;
          attempts: number;
          price: number;
        }>(
          `SELECT id, public_id::int, state, attempts::int, price::int FROM jobs ORDER BY public_id`,
        )
      ).rows;
    const pending = await jobs();
    assert.deepEqual(
      pending.map(({ public_id }) => public_id),
      publicIds,
    );
    const amount = 5;
    assert.ok(pending.every(({ price }) => price === amount));
    const reserved = await state(b);
    assert.deepEqual(reserved.credits, {
      workspace,
      balance: credit,
      available: credit - amount * ids.size,
      reserved: amount * ids.size,
    });
    for (const id of ids)
      assert.deepEqual(
        reserved.credit_history
          .filter((l) => l.job === id)
          .map((l) => [l.action, l.amount]),
        [["reserve", amount]],
      );

    const first = await until(
      "first provider submission",
      async () => calls[0],
    );
    assert.equal(await queue.getJobState(first), "active");
    const observed = attempts.length;
    const blocked = await until(
      "a second BullMQ consumer attempting a queued job at the connection limit",
      async () => {
        const skipped = (await jobs()).find(
          (job) =>
            job.state === "queued" && attempts.slice(observed).includes(job.id),
        );
        return skipped?.id;
      },
    );
    assert.notEqual(blocked, first);
    assert.equal(await queue.getJobState(first), "active");
    assert.equal(active, 1);
    assert.equal(peak, 1);
    assert.equal(calls.length, 1);
    assert.equal(
      (await jobs()).filter(({ state }) => state !== "queued").length,
      1,
    );
    console.log(
      "Connection limit 1: one provider call held; the other BullMQ consumer attempted a queued job without claiming a second provider slot.",
    );

    // With one local slot per worker, two simultaneous submissions can only
    // occur across processes. Keep the first response held for this control.
    await updateLimit(2, 2);
    const concurrent = await until(
      "simultaneous provider submissions from both workers",
      async () => calls[1],
    );
    assert.notEqual(concurrent, first);
    assert.equal(await queue.getJobState(first), "active");
    assert.equal(await queue.getJobState(concurrent), "active");
    assert.equal(active, 2);
    assert.equal(peak, 2);
    console.log(
      "Connection limit 2: both one-slot workers held live provider submissions simultaneously.",
    );
    release();

    const settled = await until(
      "all original generation jobs to settle",
      async () => {
        const current = await state(b);
        assert.ok(
          !current.jobs.some(
            ({ status }) => status === "failed" || status === "cancelled",
          ),
          JSON.stringify(current.jobs),
        );
        return [...ids].every(
          (id) => current.jobs.find((j) => j.id === id)?.status === "done",
        )
          ? current
          : undefined;
      },
    );
    const completed = await jobs();
    assert.equal(completed.length, ids.size);
    assert.ok(
      completed.every((job) => job.state === "completed" && job.attempts === 1),
    );
    assert.deepEqual([...calls].sort(), completed.map(({ id }) => id).sort());
    assert.deepEqual(errors, []);
    assert.equal(peak, 2);
    assert.deepEqual(settled.credits, {
      workspace,
      balance: credit - amount * ids.size,
      available: credit - amount * ids.size,
      reserved: 0,
    });
    for (const id of ids)
      assert.deepEqual(
        settled.credit_history
          .filter((l) => l.job === id)
          .map((l) => [l.action, l.amount]),
        [
          ["spend", amount],
          ["reserve", amount],
        ],
      );
    assert.deepEqual(await submit(b, repeated), { id: repeatedId });
    assert.deepEqual((await state(a)).credits, settled.credits);
    const { rows: ledger } = await p.db.query(
      `SELECT j.public_id::int, l.action, l.amount::int FROM ledger l
      JOIN jobs j ON j.id=l.job_id ORDER BY j.public_id,l.action`,
    );
    assert.deepEqual(
      ledger,
      publicIds.flatMap((public_id) =>
        ["hold", "spend"].map((action) => ({ public_id, action, amount })),
      ),
    );

    const inv = await a.json<{ code: string }>("/api/invite-codes", {
      data: { name: "Replica isolation" },
    });
    const registration = await b.request("/api/register", {
      cookie: "",
      data: {
        name: "replica-member",
        nickname: "隔离用户",
        password: randomUUID(),
        code: inv.code,
      },
    });
    assert.equal(registration.status, 200, await registration.text());
    const foreign = registration.headers.get("set-cookie")?.split(";")[0];
    assert.match(foreign ?? "", /^fm_session=/);
    const foreignState = await state(a, foreign);
    assert.notEqual(foreignState.workspace_id, workspace);
    assert.deepEqual(foreignState.jobs, []);
    await b.json("/api/state", { cookie: foreign, workspace }, 403);

    const outputs = (
      await p.db.query<{
        public_id: number;
        media: string;
        object_key: string;
      }>(
        `SELECT j.public_id::int, a.public_id AS media, a.object_key
      FROM jobs j JOIN job_assets ja ON j.id=ja.job_id JOIN assets a ON ja.asset_id=a.id
      WHERE ja.role='output' ORDER BY j.public_id`,
      )
    ).rows;
    assert.deepEqual(
      outputs.map(({ public_id }) => public_id),
      completed.map(({ public_id }) => public_id),
    );
    assert.deepEqual(
      (await s3.objects()).map(({ Key }) => Key).sort(),
      outputs.map(({ object_key }) => object_key).sort(),
    );
    for (const output of outputs) {
      assert.equal(
        settled.jobs.find((job) => job.id === output.public_id)?.result,
        output.media,
      );
      const path = "/media/" + output.media;
      for (const client of [a, b]) {
        const response = await client.request(path);
        assert.equal(response.status, 307, path);
        const location = response.headers.get("location");
        assert.ok(location);
        const signed = new URL(location);
        assert.equal(signed.origin, s3.endpoint);
        assert.equal(signed.pathname, `/${s3.bucket}/${output.object_key}`);
        assert.match(
          signed.searchParams.get("X-Amz-Signature") ?? "",
          /^[\da-f]{64}$/,
        );
        await response.body?.cancel();
        const file = await fetch(signed, {
          redirect: "error",
          signal: AbortSignal.timeout(5000),
        });
        assert.equal(file.status, 200);
        assert.equal(file.headers.get("content-type"), "image/png");
        assert.deepEqual(Buffer.from(await file.bytes()), png);
        for (const [cookie, code] of [
          [foreign!, 404],
          ["", 401],
        ] as const) {
          const denied = await client.request(path, { cookie });
          assert.equal(denied.status, code);
          assert.equal(denied.headers.get("location"), null);
          await denied.body?.cancel();
        }
      }
      const unsigned = await fetch(
        `${s3.endpoint}/${s3.bucket}/${output.object_key}`,
        { redirect: "error", signal: AbortSignal.timeout(5000) },
      );
      assert.equal(unsigned.status, 403);
      await unsigned.body?.cancel();
    }
    console.log(
      `Verified ${uids.length} concurrent HTTP submissions -> ${ids.size} jobs, provider calls, private objects, reserves and spends; shared session and cross-workspace denial through both replicas.`,
    );
  } finally {
    release();
    provider.closeAllConnections();
    await Promise.all([
      events.close(),
      queue.close(),
      new Promise<void>((done) => provider.close(() => done())),
    ]);
  }
}
