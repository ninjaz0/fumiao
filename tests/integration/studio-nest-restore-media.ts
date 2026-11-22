import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import sharp from "sharp";
import { StudioCatalog } from "@fumiao/platform/catalog.js";
import { one } from "@fumiao/platform/db.js";
import type { Actor, Platform } from "@fumiao/platform/platform.js";
import { QueueHealthPoller } from "@fumiao/platform/queue-health.js";
import { flowCanvas } from "@fumiao/plugin-flow/canvas.js";
import { flowCanvasRuns } from "@fumiao/plugin-flow/canvas-runs.js";
import { flowText } from "@fumiao/plugin-flow/text.js";
import { gpuText } from "@fumiao/plugin-gpu/text.js";
import { museText } from "@fumiao/plugin-muse/text.js";
import { wavFixture } from "../helpers/timing.js";
import type { StudioClient } from "./studio-nest-restore.js";

const museDone = "task_" + "a".repeat(32);
const museMissing = "task_" + "b".repeat(32);
const flowModel = "flow:veo-3.1-quality-4s-landscape";
const voice = "breeze-tts-2";
const token = () => randomBytes(32).toString("base64url");
const wav = wavFixture();
for (let offset = 44; offset < wav.length; offset += 2)
  wav.writeInt16LE(Math.round(1024 * Math.sin(offset / 17)), offset);

export async function until<T>(
  label: string,
  probe: () => Promise<T | undefined>,
  ms = 12_000,
) {
  const deadline = Date.now() + ms;
  do {
    const result = await probe();
    if (result !== undefined) return result;
    await delay(150);
  } while (Date.now() < deadline);
  throw new Error(label + " timed out");
}

export type FixtureMedia = {
  id: string;
  key: string;
  bytes: Buffer;
  mime: string;
};

export async function mediaProviderFixture() {
  const png = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "#6945be" },
  })
    .png()
    .toBuffer();
  const { stdout: mp4 } = await promisify(execFile)(
    "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=64x36:r=12",
      "-t",
      "4",
      "-c:v",
      "mpeg4",
      "-movflags",
      "frag_keyframe+empty_moov",
      "-f",
      "mp4",
      "pipe:1",
    ],
    { encoding: "buffer", timeout: 10_000 },
  );
  const requests: { target: boolean; call: string }[] = [];
  let target = false;
  const server = createServer(async (req, res) => {
    try {
      const [provider, ...segments] = req.url!.slice(1).split("/");
      const path = "/" + segments.join("/");
      const atTarget = target;
      const log = (call: string) => requests.push({ target: atTarget, call });
      const json = (body: unknown) =>
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify(body));
      if (req.method === "GET") {
        if (["/readyz", "/v1/models", "/v1/queue", "/health"].includes(path)) {
          assert.ok(
            ["Bearer " + provider, "Bearer rotated"].includes(
              req.headers.authorization!,
            ),
          );
        } else assert.equal(req.headers.authorization, "Bearer " + provider);
        if (path === "/v1/models") return json({ data: [{ id: "fixture" }] });
        if (provider === "muse") {
          if (path === "/readyz") return json({ status: "ready", accounts: 3 });
          if (path === "/v1/queue") return json({ capacity: 3 });
          if (path === "/v1/media/result.png") {
            log(path);
            return res.writeHead(200, { "content-type": "image/png" }).end(png);
          }
          const id = segments.at(-1);
          assert.equal(path, "/v1/images/tasks/" + id);
          assert.ok(id === museDone || id === museMissing);
          log(path);
          if (!atTarget) return; // Hold the poll while the source worker has a lease.
          if (id === museMissing) return res.writeHead(404).end();
          return json({
            status: "completed",
            url: origin + "/muse/v1/media/result.png",
          });
        }
        assert.ok(
          ["flow-saved", "flow-missing", "flow-unknown"].includes(provider),
        );
        if (path === "/health")
          return json({ backend_running: true, has_active_tokens: true });
        assert.equal(path, "/tmp/result.mp4");
        log(provider + path);
        if (!atTarget) return; // The receipt commits before the worker asks for these bytes.
        if (provider === "flow-missing") return res.writeHead(404).end();
        assert.equal(provider, "flow-saved");
        return res.writeHead(200, { "content-type": "video/mp4" }).end(mp4);
      }
      assert.equal(req.method, "POST");
      assert.equal(req.headers.authorization, "Bearer " + provider);
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (provider === "muse") {
        assert.equal(path, "/v1/images/tasks");
        assert.match(
          req.headers["idempotency-key"] as string,
          /^[a-f0-9]{32}$/,
        );
        const prompt = body.prompt;
        assert.ok(
          ["Muse confirmed", "Muse missing", "Muse unknown"].includes(prompt),
        );
        log(prompt);
        if (prompt === "Muse unknown") return;
        return json({
          id: prompt === "Muse confirmed" ? museDone : museMissing,
          status: "queued",
        });
      }
      assert.equal(path, "/v1/chat/completions");
      assert.equal(body.stream, true);
      assert.equal(body.model, "veo-3.1-quality-4s-landscape");
      assert.equal(body.messages[0].content[0].text, provider);
      assert.ok(
        ["flow-saved", "flow-missing", "flow-unknown"].includes(provider),
      );
      log(provider);
      res.writeHead(200, { "content-type": "text/event-stream" });
      if (provider === "flow-unknown") return res.flushHeaders();
      const content = `<video src="${origin}/${provider}/tmp/result.mp4" data-media-id="restore-flow-result"></video>`;
      return res.end(
        `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`,
      );
    } catch (error) {
      requests.push({ target, call: "unexpected: " + String(error) });
      res.destroy();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  return {
    png,
    mp4,
    config(provider: string) {
      const baseUrl = origin + "/" + provider;
      return { baseUrl, publicUrl: baseUrl, apiKey: provider };
    },
    calls(atTarget: boolean) {
      return requests
        .filter((r) => r.target === atTarget)
        .map((r) => r.call)
        .sort();
    },
    recover() {
      target = true;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

type Job = {
  id: number;
  path: string;
  draft: { uid: string; model: string; prompt: string };
};

const jobRow = (p: Platform, job: Job) =>
  one(p.db, "SELECT * FROM jobs WHERE public_id=$1", [job.id]);

function pairedNode(client: StudioClient, secret: string) {
  async function call(
    path: string,
    method: string,
    body?: unknown,
    ticket?: string,
    status = 200,
  ) {
    const audio = body instanceof Uint8Array;
    return client.json(
      await client.request("/agent/" + path, method, body, {
        cookie: "",
        authorization: "Bearer " + secret,
        ...(ticket ? { "x-job-ticket": ticket } : {}),
        ...(audio
          ? {
              "content-type": "audio/wav",
              "x-sha256": createHash("sha256").update(body).digest("hex"),
            }
          : {}),
      }),
      status,
    );
  }
  const path = (job: Job, suffix: string) => `jobs/${job.id}/${suffix}`;
  return {
    enroll: (code: string) => call("enroll", "POST", { code, secret }),
    claim: async () => (await call("claim", "POST")).job,
    ready: () =>
      call("heartbeat", "POST", { stage: "ready", ready_models: [voice] }),
    beat: async (ticket: string) =>
      (await call("heartbeat", "POST", { stage: "busy", ticket })).held,
    receipt: (job: Job, ticket: string, status = 200) =>
      call(path(job, "receipt"), "GET", undefined, ticket, status),
    deliver: (job: Job, ticket: string, status = 200) =>
      call(path(job, "result"), "PUT", wav, ticket, status),
  };
}

export async function prepareStudioMediaRestore(
  source: Platform,
  client: StudioClient,
  admin: Actor,
  provider: Awaited<ReturnType<typeof mediaProviderFixture>>,
) {
  for (const [model, price] of [
    ["muse-image", 2],
    [flowModel, 3],
    [voice, 1],
  ]) {
    await source.db.query(
      "UPDATE studio_prices SET amount=$2 WHERE model_id=$1",
      [model, price],
    );
  }
  async function enable(
    { manifest }: typeof museText,
    name: string,
    config: Record<string, unknown> = {},
    concurrency = 1,
  ) {
    const { id } = await source.createConnection(admin, {
      name,
      pluginId: manifest.id,
      version: manifest.version,
      config,
    });
    await source.updateConnection(admin, id, {
      revision: 1,
      enabled: true,
      concurrency,
    });
    await new QueueHealthPoller(source).refresh(id);
    return id;
  }
  async function submit(
    path: string,
    model: string,
    prompt: string,
  ): Promise<Job> {
    const draft = { uid: randomUUID(), model, prompt };
    const { id } = await client.write(path, draft);
    assert.ok(Number.isSafeInteger(id) && id > 0);
    return { id, path, draft };
  }
  const expireGpuLease = (p: Platform, job: Job) =>
    p.db.query(
      "UPDATE jobs SET lease_until=now()-interval '2 seconds' WHERE public_id=$1 AND state='running' AND lease_token IS NOT NULL RETURNING id",
      [job.id],
    );
  const waitForSourceCall = (call: string) =>
    until(
      "Source " + call,
      async () => (provider.calls(false).includes(call) ? true : undefined),
      25_000,
    );
  await enable(gpuText, "Restore ordinary GPU");

  async function flowJob(plugin: typeof flowText, name: string, call: string) {
    // Flow serializes generation per connection and Studio projects one
    // connection per active version. Stage jobs across real catalog upgrades.
    await source.db.transaction((sql) =>
      new StudioCatalog(source.db).activate(sql, plugin.manifest),
    );
    const connection = await enable(plugin, name, provider.config(name));
    const job = await submit("/api/jobs", flowModel, name);
    await waitForSourceCall(call);
    // Rotate the credentials after the worker reaches the checkpoint so
    // recovery has to use the accepted job's config snapshot.
    await source.updateConnection(admin, connection, {
      revision: 2,
      enabled: false,
      concurrency: 1,
      config: { ...provider.config(name), apiKey: "rotated" },
    });
    return job;
  }
  const missingFlow = await flowJob(
    flowCanvas,
    "flow-missing",
    "flow-missing/tmp/result.mp4",
  );
  const unknownFlow = await flowJob(
    flowCanvasRuns,
    "flow-unknown",
    "flow-unknown",
  );
  const savedFlow = await flowJob(
    flowText,
    "flow-saved",
    "flow-saved/tmp/result.mp4",
  );

  async function enroll(name: string) {
    const { command } = await client.write("/api/pairs", {
      name,
      models: [voice],
    });
    const code = / ([A-Za-z0-9_-]{43})$/.exec(command)?.[1];
    assert.ok(code);
    const secret = token();
    const node = pairedNode(client, secret);
    assert.deepEqual(await node.enroll(code), { ok: true, models: [voice] });
    return { secret, node };
  }
  const liveNode = await enroll("Restore GPU live");
  const expiredNode = await enroll("Restore GPU expired");
  const exhaustedNode = await enroll("Restore GPU exhausted");
  const gpuJob = (prompt: string) => submit("/api/audio-jobs", voice, prompt);
  const claim = async (
    node: ReturnType<typeof pairedNode>,
    job: Job,
    attempts: number,
  ) => {
    await node.ready();
    const assignment = await node.claim();
    assert.equal(assignment?.id, job.id);
    assert.equal(assignment.attempts, attempts);
    assert.match(assignment.ticket, /^[A-Za-z0-9_-]+$/);
    return assignment.ticket as string;
  };
  const live = await gpuJob("GPU live lease");
  const liveTicket = await claim(liveNode.node, live, 1);
  const expired = await gpuJob("GPU reassigned lease");
  const expiredTicket = await claim(expiredNode.node, expired, 1);
  const exhausted = await gpuJob("GPU exhausted lease");
  const exhaustedFirst = await claim(exhaustedNode.node, exhausted, 1);
  assert.equal((await expireGpuLease(source, exhausted)).rows.length, 1);
  const exhaustedTicket = await claim(exhaustedNode.node, exhausted, 2);
  assert.notEqual(exhaustedTicket, exhaustedFirst);

  const muse = await enable(
    museText,
    "Restore Muse",
    provider.config("muse"),
    3,
  );
  const museJob = (prompt: string) =>
    submit("/api/image-jobs", "muse-image", prompt);
  const checked = await museJob("Muse confirmed");
  const missing = await museJob("Muse missing");
  const unknown = await museJob("Muse unknown");
  const pollDone = "/v1/images/tasks/" + museDone;
  const pollMissing = "/v1/images/tasks/" + museMissing;
  await Promise.all(
    [pollDone, pollMissing, "Muse unknown"].map(waitForSourceCall),
  );
  await source.updateConnection(admin, muse, {
    revision: 2,
    enabled: true,
    concurrency: 3,
    config: { ...provider.config("muse"), apiKey: "rotated" },
  });

  const jobs = [
    {
      job: checked,
      plugin: museText,
      checkpoint: "running",
      remote: museDone,
      output: { bytes: provider.png, mime: "image/png" },
      runs: ["done"],
    },
    {
      job: missing,
      plugin: museText,
      checkpoint: "running",
      remote: museMissing,
      note: "Muse 中的任务记录已不存在，结果未确认；请检查后再重新生成",
      runs: ["failed"],
    },
    {
      job: unknown,
      plugin: museText,
      checkpoint: "dispatching",
      note: "Muse 提交结果待确认，请联系管理员核对后再重试",
      uncertain: true,
      runs: ["interrupted"],
    },
    {
      job: savedFlow,
      plugin: flowText,
      checkpoint: "finalizing",
      output: { bytes: provider.mp4, mime: "video/mp4" },
      runs: ["done"],
    },
    {
      job: missingFlow,
      plugin: flowCanvas,
      checkpoint: "finalizing",
      note: "Flow 成品保存失败，请从后台检查生成结果",
      runs: ["failed"],
    },
    {
      job: unknownFlow,
      plugin: flowCanvasRuns,
      checkpoint: "dispatching",
      note: "服务重启，Flow 生成结果未确认；请核对后台记录后再重新生成",
      uncertain: true,
      runs: ["interrupted"],
    },
    {
      job: live,
      plugin: gpuText,
      checkpoint: "running",
      ticket: liveTicket,
      output: { bytes: wav, mime: "audio/wav" },
      runs: ["done"],
    },
    {
      job: expired,
      plugin: gpuText,
      checkpoint: "running",
      ticket: expiredTicket,
      output: { bytes: wav, mime: "audio/wav" },
      runs: ["interrupted", "done"],
    },
    {
      job: exhausted,
      plugin: gpuText,
      checkpoint: "running",
      ticket: exhaustedTicket,
      note: "实例连续中断，请重新生成",
      runs: ["interrupted", "interrupted"],
    },
  ];
  const sourceCalls = [
    "Muse confirmed",
    "Muse missing",
    "Muse unknown",
    pollDone,
    pollMissing,
    "flow-saved",
    "flow-missing",
    "flow-unknown",
    "flow-saved/tmp/result.mp4",
    "flow-missing/tmp/result.mp4",
  ].sort();
  const targetCalls = [
    pollDone,
    pollMissing,
    "/v1/media/result.png",
    "flow-saved/tmp/result.mp4",
    "flow-missing/tmp/result.mp4",
  ].sort();
  const ledger = async (p: Platform, id: string) =>
    (
      await p.db.query(
        "SELECT action,amount FROM ledger WHERE job_id=$1 ORDER BY public_id",
        [id],
      )
    ).rows;

  return {
    async checkpoint() {
      // Move only two GPU deadlines across the same cutoff used by the pinned
      // reaper. Keep the third lease live to exercise reconnect without a retry.
      for (const job of [expired, exhausted])
        assert.equal((await expireGpuLease(source, job)).rows.length, 1);
      assert.deepEqual(provider.calls(false), sourceCalls);
      for (const spec of jobs) {
        const row = await jobRow(source, spec.job);
        assert.equal(row.state, spec.checkpoint, spec.job.draft.prompt);
        assert.equal(row.plugin_id, spec.plugin.manifest.id);
        assert.equal(row.plugin_version, spec.plugin.manifest.version);
        assert.equal(row.attempts, spec.job === exhausted ? 2 : 1);
        assert.ok(row.lease_token);
        assert.equal(
          row.lease_until > new Date(),
          ![expired, exhausted].includes(spec.job),
        );
        assert.equal(row.original_gpu_ticket, spec.ticket ?? null);
        if (spec.ticket) assert.ok(row.remote_id);
        else assert.equal(row.remote_id, spec.remote ?? null);
        const flowReceipt =
          spec.checkpoint === "finalizing"
            ? {
                state: "completed",
                artifacts: [
                  {
                    url:
                      provider.config(spec.job.draft.prompt).baseUrl +
                      "/tmp/result.mp4",
                  },
                ],
                usage: { flow_media_id: "restore-flow-result" },
              }
            : null;
        assert.deepEqual(row.receipt, flowReceipt);
        assert.equal(row.request_uncertain, false);
        assert.equal(row.result, null);
        assert.deepEqual(await ledger(source, row.id), [
          { action: "hold", amount: row.price },
        ]);
      }
    },
    async verify(target: Platform, recovered: StudioClient) {
      const liveAgent = pairedNode(recovered, liveNode.secret);
      const oldAgent = pairedNode(recovered, expiredNode.secret);
      const exhaustedAgent = pairedNode(recovered, exhaustedNode.secret);
      assert.equal(await liveAgent.beat(liveTicket), true);
      const liveAssignment = await liveAgent.claim();
      assert.equal(liveAssignment.id, live.id);
      assert.equal(liveAssignment.ticket, liveTicket);
      assert.equal(liveAssignment.attempts, 1);
      assert.deepEqual(await liveAgent.receipt(live, liveTicket), {
        delivered: false,
      });
      async function deliver(
        node: ReturnType<typeof pairedNode>,
        job: Job,
        ticket: string,
      ) {
        const saved = await node.deliver(job, ticket);
        assert.equal(saved.ok, true);
        assert.match(saved.id, /^[0-9a-f]{32}$/);
        assert.deepEqual(await node.receipt(job, ticket), { delivered: true });
        assert.deepEqual(await node.deliver(job, ticket), saved);
        return saved.id as string;
      }
      const liveResult = await deliver(liveAgent, live, liveTicket);
      const replacement = await claim(liveAgent, expired, 2);
      assert.notEqual(replacement, expiredTicket);
      const rejected = { detail: "该任务已由其他实例接管或已结束" };
      async function reject(
        node: ReturnType<typeof pairedNode>,
        job: Job,
        ticket: string,
      ) {
        assert.equal(await node.beat(ticket), false);
        assert.deepEqual(await node.receipt(job, ticket, 409), rejected);
        assert.deepEqual(await node.deliver(job, ticket, 409), rejected);
      }
      await reject(oldAgent, expired, expiredTicket);
      const retryResult = await deliver(liveAgent, expired, replacement);
      await liveAgent.ready();
      assert.equal(await liveAgent.claim(), null);
      await reject(exhaustedAgent, exhausted, exhaustedTicket);

      for (const spec of jobs) {
        await until(
          spec.job.draft.prompt + " settled after restore",
          async () => {
            const row = await jobRow(target, spec.job);
            return ["completed", "failed"].includes(row.state)
              ? row
              : undefined;
          },
          85_000,
        );
      }
      const { jobs: visible } = await recovered.read("/api/state");
      let spent = 0;
      const outputs: FixtureMedia[] = [];
      for (const spec of jobs) {
        const { job, output, note, runs, uncertain } = spec;
        const row = await jobRow(target, job);
        assert.equal(
          row.state,
          output ? "completed" : "failed",
          job.draft.prompt,
        );
        assert.equal(
          row.request_uncertain,
          Boolean(uncertain),
          job.draft.prompt,
        );
        assert.equal(row.error, note ?? null);
        assert.equal(row.attempts, runs.length);
        assert.equal(row.lease_token, null);
        assert.equal(row.lease_until, null);
        assert.equal(row.receipt, null);
        assert.deepEqual(await ledger(target, row.id), [
          { action: "hold", amount: row.price },
          { action: output ? "spend" : "refund", amount: row.price },
        ]);
        assert.deepEqual(
          (
            await target.db.query(
              "SELECT status FROM job_runs WHERE job=$1 ORDER BY id",
              [row.id],
            )
          ).rows.map(({ status }) => status),
          runs,
        );
        const assets = (
          await target.db.query(
            "SELECT a.id,a.public_id,a.object_key,a.mime FROM job_assets r JOIN assets a ON a.id=r.asset_id WHERE r.job_id=$1 AND r.role='output'",
            [row.id],
          )
        ).rows;
        const view = visible.find((v: { id: number }) => v.id === job.id);
        assert.ok(view, job.draft.prompt);
        assert.equal(view.status, output ? "done" : "failed");
        assert.equal(view.note, note ?? "");
        assert.equal(view.result, assets[0]?.public_id ?? null);
        assert.equal(assets.length, output ? 1 : 0);
        if (output) {
          const [asset] = assets;
          assert.deepEqual(row.result.assets, [asset.id]);
          assert.equal(asset.mime, output.mime);
          if (job === live) assert.equal(asset.public_id, liveResult);
          if (job === expired) assert.equal(asset.public_id, retryResult);
          if (job === savedFlow)
            assert.equal(view.actual.flow_media_id, "restore-flow-result");
          spent += Number(row.price);
          outputs.push({
            id: asset.public_id,
            key: asset.object_key,
            ...output,
          });
        } else {
          assert.equal(row.result, null);
        }
      }
      return { spent, outputs };
    },
    async replay(recovered: StudioClient) {
      for (const { job } of jobs)
        assert.deepEqual(await recovered.write(job.path, job.draft), {
          id: job.id,
        });
      assert.deepEqual(provider.calls(false), sourceCalls);
      assert.deepEqual(provider.calls(true), targetCalls);
    },
  };
}
