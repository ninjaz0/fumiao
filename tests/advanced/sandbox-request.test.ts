import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  RequestLifecycleError,
  ArtifactDownloadError,
  type Execution,
  manifestSchema,
} from "@fumiao/plugin-sdk/index.js";
import {
  ProviderBodyTooLarge,
  type chatHttp,
} from "@fumiao/plugin-sdk/chat-transport.js";
import { sandboxRequest } from "@fumiao/platform/sandbox-request.js";

test("Muse uses bounded JSON policies for signed submissions, large frozen references, retry decisions, clocks and download recovery", async () => {
  const release = JSON.parse(
    await readFile("plugins/muse/muse.fmplugin.json", "utf8"),
  );
  let status = 200,
    bytes = Buffer.from("{}"),
    calls = 0;
  const requests: { url: URL; options: Parameters<typeof chatHttp>[1] }[] = [];
  const probe: typeof chatHttp = async (url, options) => {
    assert.ok(options.lookup);
    requests.push({ url, options });
    calls++;
    return {
      status,
      headers: {},
      body: (async function* () {
        yield bytes;
      })(),
      close() {},
    };
  };
  const adapter = await sandboxRequest(
    manifestSchema.parse(release.manifest),
    release.studioProgram,
    probe,
  );
  const config = { baseUrl: "https://1.1.1.1/tenant", apiKey: "scoped-key" };
  const signal = new AbortController().signal;
  const data = "data:image/png;base64," + "A".repeat(3 * 1024 * 1024);
  const observations: unknown[] = [];
  const e: Execution = {
    kind: "video",
    model: "muse-video",
    config,
    signal,
    jobId: randomUUID(),
    idempotencyKey: randomUUID(),
    input: {
      prompt: "<Picture １２>",
      params: { ratio: "9:16", seconds: 6 },
      references: [{ id: "fixture", mime: "image/png", url: data }],
    },
    reportProviderNote: async (n) => {
      observations.push(n);
    },
    reportProviderClock: async (c) => {
      observations.push(c);
    },
    reportTiming: async (t) => {
      observations.push(t);
    },
  };
  const id = "task_" + "f".repeat(32);
  bytes = Buffer.from(JSON.stringify({ id, status: "queued", created_at: 12 }));
  assert.deepEqual(await adapter.submit(e), { state: "pending", remoteId: id });
  const { options, url } = requests[0];
  assert.equal(url.href, config.baseUrl + "/v1/videos");
  assert.equal(options.key, config.apiKey);
  assert.equal(options.idempotencyKey, e.idempotencyKey.replaceAll("-", ""));
  assert.deepEqual(options.body, {
    model: e.model,
    prompt: "[图１２]",
    aspect_ratio: "9:16",
    images: [data],
    timeout: 600,
    duration: 6,
  });
  assert.deepEqual(observations.splice(0), [
    "等待 Muse 空闲账号",
    { state: "queued", created_at: 12 },
  ]);
  async function rejects(
    run: () => Promise<unknown>,
    action: string,
    note?: string,
  ) {
    await assert.rejects(
      run,
      (error) =>
        error instanceof RequestLifecycleError &&
        error.disposition.action === action &&
        (!note ||
          ("note" in error.disposition && error.disposition.note === note)),
    );
  }
  status = 429;
  await assert.rejects(
    adapter.submit(e),
    (error) =>
      error instanceof RequestLifecycleError &&
      error.disposition.action === "retry" &&
      error.disposition.delaySeconds === 60,
  );
  status = 400;
  await rejects(() => adapter.submit(e), "fail", "Muse 拒绝了生成参数或参考图");
  status = 200;
  bytes = Buffer.from('{"id":"invalid"}');
  await rejects(
    () => adapter.submit(e),
    "fail",
    "Muse 提交结果待确认，请联系管理员核对后再重试",
  );
  status = 404;
  await rejects(
    () => adapter.inspect!(e, id),
    "fail",
    "Muse 中的任务记录已不存在，结果未确认；请检查后再重新生成",
  );
  status = 200;
  bytes = Buffer.from("[1]");
  await rejects(() => adapter.inspect!(e, id), "poll");
  bytes = Buffer.from(
    '{"status":"processing","started_at":"unknown"}',
    "utf16le",
  );
  assert.deepEqual(await adapter.inspect!(e, id), {
    state: "pending",
    remoteId: id,
  });
  assert.deepEqual(observations.splice(0), [
    { state: "running", started_at_reported: true },
    { job_phase: "generating" },
    "Muse 生成中",
  ]);
  bytes = Buffer.from('{"status":"done","data":[]}');
  await rejects(
    () => adapter.inspect!(e, id),
    "fail",
    "Muse 未返回可下载的成品",
  );
  const download = (url: string) =>
    adapter.downloadArtifact!({ config, url, recovering: false }, signal);
  const before = calls;
  await assert.rejects(
    download("https://elsewhere.example/v1/media/image.png"),
    (error) =>
      error instanceof ArtifactDownloadError && error.disposition === "failed",
  );
  assert.equal(calls, before);
  status = 503;
  await assert.rejects(
    download("https://muse.nvmes.com/v1/media/image.png"),
    (error) =>
      error instanceof ArtifactDownloadError && error.disposition === "retry",
  );
  assert.equal(
    requests.at(-1)!.url.href,
    config.baseUrl + "/v1/media/image.png",
  );
  const count = calls;
  for (const baseUrl of ["http://127.0.0.1", "https://127.0.0.1"]) {
    assert.equal(await adapter.health({ ...config, baseUrl }, signal), false);
  }
  assert.equal(calls, count);

  let readyBody: unknown = {
      status: "ready",
      accounts: 4,
      browser_running: true,
    },
    queueReply: { status: number; body: unknown } = {
      status: 404,
      body: null,
    };
  const queueProbe: typeof chatHttp = async (url, options) => {
    assert.ok(options.lookup);
    let replyStatus = 200;
    let payload: unknown = {};
    if (url.pathname.endsWith("/readyz")) payload = readyBody;
    else if (url.pathname.endsWith("/v1/models"))
      payload = { data: [{ id: "muse-video" }] };
    else if (url.pathname.endsWith("/v1/queue")) {
      if (queueReply.body === "__CONNECTION_ERROR__")
        throw new Error("ECONNRESET");
      replyStatus = queueReply.status;
      payload = queueReply.body;
    }
    return {
      status: replyStatus,
      headers: {},
      body: (async function* () {
        if (payload === "__OVERSIZED__") {
          const buf = Buffer.alloc(2 * 1024 ** 2 + 16, 65);
          if (
            options.maxResponseBytes !== undefined &&
            buf.length > options.maxResponseBytes
          )
            throw new ProviderBodyTooLarge();
          yield buf;
        } else if (payload !== null) {
          yield Buffer.from(JSON.stringify(payload));
        }
      })(),
      close() {},
    };
  };
  const legacyRelease = JSON.parse(
    await readFile("plugins/muse/package/legacy-2.0.0.fmplugin.json", "utf8"),
  );
  const legacyAdapter = await sandboxRequest(
    manifestSchema.parse(legacyRelease.manifest),
    legacyRelease.studioProgram,
    queueProbe,
  );
  const healthAdapter = await sandboxRequest(
    manifestSchema.parse(release.manifest),
    release.studioProgram,
    queueProbe,
  );
  assert.deepEqual(await healthAdapter.queueHealth!(config, signal), {
    ready: true,
    capacity: 4,
    maintenance: 0,
    tasks: [],
  });
  readyBody = { status: "ready", accounts: 30 };
  assert.equal((await healthAdapter.queueHealth!(config, signal)).capacity, 16);
  readyBody = { status: "ready", accounts: [1, 2, 3] };
  assert.equal((await healthAdapter.queueHealth!(config, signal)).capacity, 3);
  for (const badAccounts of [0, -2, false, [], {}, null, ""]) {
    readyBody = { status: "ready", accounts: badAccounts };
    assert.deepEqual(await healthAdapter.queueHealth!(config, signal), {
      ready: false,
    });
  }
  for (const compatAccounts of ["2", true, { primary: 1 }, 1.5]) {
    readyBody = { status: "ready", accounts: compatAccounts };
    queueReply = { status: 200, body: { capacity: 3 } };
    const expectedQueue = await legacyAdapter.queueHealth!(config, signal);
    assert.deepEqual(expectedQueue, {
      ready: true,
      capacity: 3,
      maintenance: 0,
      tasks: [],
    });
    assert.deepEqual(
      await healthAdapter.queueHealth!(config, signal),
      expectedQueue,
    );
    queueReply = { status: 404, body: null };
    const expectedFallback = await legacyAdapter.queueHealth!(config, signal);
    assert.deepEqual(expectedFallback, {
      ready: true,
      capacity: 1,
      maintenance: 0,
      tasks: [],
    });
    assert.deepEqual(
      await healthAdapter.queueHealth!(config, signal),
      expectedFallback,
    );
  }
  readyBody = { status: "ready", accounts: 4 };
  queueReply = {
    status: 200,
    body: { tasks: [{ id: "ext-1", prompt: "secret" }] },
  };
  assert.deepEqual(await healthAdapter.queueHealth!(config, signal), {
    ready: true,
    capacity: 4,
    maintenance: 0,
    tasks: [{ id: "ext-1" }],
  });
  queueReply = {
    status: 200,
    body: { capacity: 2, maintenance: 1, tasks: [{ id: "ext-1" }] },
  };
  assert.deepEqual(await healthAdapter.queueHealth!(config, signal), {
    ready: true,
    capacity: 2,
    maintenance: 1,
    tasks: [{ id: "ext-1" }],
  });
  for (const invalidCap of [null, "2.5", 9.9, 2.5, "", []]) {
    queueReply = {
      status: 200,
      body: { capacity: invalidCap, tasks: [{ id: "ext-1" }] },
    };
    assert.deepEqual(await healthAdapter.queueHealth!(config, signal), {
      ready: true,
      capacity: 1,
      maintenance: 0,
      tasks: [],
    });
  }
  queueReply = {
    status: 200,
    body: { capacity: 4, maintenance: 1.5, tasks: [{ id: "ext-1" }] },
  };
  assert.deepEqual(await healthAdapter.queueHealth!(config, signal), {
    ready: true,
    capacity: 1,
    maintenance: 0,
    tasks: [],
  });
  for (const nonObjectBody of [[{ id: "ext-1" }], "ok", 123, true]) {
    queueReply = { status: 200, body: nonObjectBody };
    assert.deepEqual(await healthAdapter.queueHealth!(config, signal), {
      ready: true,
      capacity: 1,
      maintenance: 0,
      tasks: [],
    });
  }
  // status 200 exceeding 2 MiB causes sandboxRequest read() to return { status: 200, text: null }
  queueReply = { status: 200, body: "__OVERSIZED__" };
  assert.deepEqual(await healthAdapter.queueHealth!(config, signal), {
    ready: true,
    capacity: 1,
    maintenance: 0,
    tasks: [],
  });
  // 5xx / 429 / 401 / 403 / transport errors on /v1/queue must NOT expand to multi-account fallbackCapacity (12)
  // while wiping maintenance and external tasks; only 404 indicates an absent /v1/queue endpoint.
  readyBody = { status: "ready", accounts: 12 };
  for (const degradedQueue of [
    { status: 500, body: { detail: "internal error" } },
    { status: 502, body: null },
    { status: 503, body: null },
    { status: 429, body: null },
    { status: 401, body: null },
    { status: 403, body: null },
    { status: 0, body: "__CONNECTION_ERROR__" },
  ]) {
    queueReply = degradedQueue;
    assert.deepEqual(await healthAdapter.queueHealth!(config, signal), {
      ready: true,
      capacity: 1,
      maintenance: 0,
      tasks: [],
    });
  }
  queueReply = { status: 404, body: null };
  assert.deepEqual(await healthAdapter.queueHealth!(config, signal), {
    ready: true,
    capacity: 12,
    maintenance: 0,
    tasks: [],
  });

  // Item 1: release compatibility gate (queue.version = 2) + conservative 8-slot cap on old-host untyped requestCapacity arguments
  assert.equal(legacyRelease.manifest.queue.version, 1);
  assert.equal(release.manifest.queue.version, 2);
  const eightUntypedJobs = Array.from({ length: 8 }, (_, idx) => ({
    status: "running",
    remoteId: `task_${idx}`,
  })) as any;
  assert.equal(
    healthAdapter.requestCapacity!({
      jobs: eightUntypedJobs,
      health: { ready: true, capacity: 12, checked: 100 },
      stamp: 105,
    }),
    8,
    "old-host untyped requestCapacity arguments must conservatively cap at 8",
  );
  const eightTypedImages = Array.from({ length: 8 }, (_, idx) => ({
    id: idx + 1,
    node: null,
    model: "muse-image",
    kind: "image" as const,
    status: "running",
    remoteId: `task_${idx}`,
    input: { prompt: "", params: {}, references: [] },
  }));
  assert.equal(
    healthAdapter.requestCapacity!({
      job: { kind: "image", model: "muse-image" },
      jobs: eightTypedImages,
      health: { ready: true, capacity: 12, checked: 100 },
      stamp: 105,
    }),
    8,
  );
  assert.equal(
    healthAdapter.requestCapacity!({
      job: { kind: "video", model: "muse-video" },
      jobs: eightTypedImages,
      health: { ready: true, capacity: 12, checked: 100 },
      stamp: 105,
    }),
    12,
  );

  // Item 2: queueHealth preserves public task kind and deducts external image occupancy
  queueReply = {
    status: 200,
    body: {
      capacity: 12,
      tasks: [
        { id: "ext-img", kind: "image", prompt: "secret" },
        { id: "ext-vid", kind: "video", apiKey: "secret" },
      ],
    },
  };
  const typedHealth = await healthAdapter.queueHealth!(config, signal);
  assert.deepEqual(typedHealth, {
    ready: true,
    capacity: 12,
    maintenance: 0,
    tasks: [
      { id: "ext-img", kind: "image" },
      { id: "ext-vid", kind: "video" },
    ],
  });
  const sevenLocalImages = eightTypedImages.slice(0, 7);
  // 7 local images + 1 external image -> 8th local image (9th total) must be blocked (capacity 7), video still sees 11
  assert.equal(
    healthAdapter.requestCapacity!({
      job: { kind: "image", model: "muse-image" },
      jobs: sevenLocalImages,
      health: {
        ready: true,
        capacity: 12,
        checked: 100,
        tasks: [{ id: "ext-img", kind: "image" } as any],
      },
      stamp: 105,
    }),
    7,
  );
  assert.equal(
    healthAdapter.requestCapacity!({
      job: { kind: "video", model: "muse-video" },
      jobs: sevenLocalImages,
      health: {
        ready: true,
        capacity: 12,
        checked: 100,
        tasks: [{ id: "ext-img", kind: "image" } as any],
      },
      stamp: 105,
    }),
    11,
  );
  // 7 local images + 1 external video -> 8th local image is allowed (capacity 8)
  assert.equal(
    healthAdapter.requestCapacity!({
      job: { kind: "image", model: "muse-image" },
      jobs: sevenLocalImages,
      health: {
        ready: true,
        capacity: 12,
        checked: 100,
        tasks: [{ id: "ext-vid", kind: "video" } as any],
      },
      stamp: 105,
    }),
    8,
  );
  // 7 local images + 1 untyped external task -> conservatively treated as potential image (capacity 7), video sees 11
  assert.equal(
    healthAdapter.requestCapacity!({
      job: { kind: "image", model: "muse-image" },
      jobs: sevenLocalImages,
      health: {
        ready: true,
        capacity: 12,
        checked: 100,
        tasks: [{ id: "ext-untyped" }],
      },
      stamp: 105,
    }),
    7,
  );
  assert.equal(
    healthAdapter.requestCapacity!({
      job: { kind: "video", model: "muse-video" },
      jobs: sevenLocalImages,
      health: {
        ready: true,
        capacity: 12,
        checked: 100,
        tasks: [{ id: "ext-untyped" }],
      },
      stamp: 105,
    }),
    11,
  );

  // Online scale-down across connectionLimits, shared upstream capacity, and image capacity + conservative unknown remaining
  const makeVidJob = (id: number, status: "running" | "queued") => ({
    id,
    node: null,
    connection: "conn-1",
    model: "muse-video",
    kind: "video" as const,
    status,
    remoteId: status === "running" ? `task_${id}` : null,
    input: { prompt: "", params: { ratio: "16:9", seconds: 5 }, references: [] },
  });
  const makeImgJob = (id: number, status: "running" | "queued") => ({
    id,
    node: null,
    connection: "conn-1",
    model: "muse-image",
    kind: "image" as const,
    status,
    remoteId: status === "running" ? `task_${id}` : null,
    input: { prompt: "", params: { ratio: "1:1" }, references: [] },
  });
  const mkQueueTools = (remMap: Record<number, any>, dur = 30) =>
    ({
      supports: () => true,
      schedule: () => ({}),
      features: (j: any) => ({
        kind: j.kind,
        model: j.model,
        executor: "muse-api",
        workflow: "muse2api-native-v1",
        width: 0,
        height: 0,
        native_ratio: "16:9",
        seconds: 5,
        steps: 0,
        video_mode: j.kind === "video" ? "t2v" : "image",
        quality: "native",
        refs: 0,
        ref_pixels: 0,
        hardware: "muse-api",
        profile: {},
        runtime_id: "",
        cold: null,
      }),
      estimate: () => ({
        low: dur,
        median: dur,
        high: dur,
        source: "history",
        samples: 10,
        confidence: "high",
        version: 4,
      }),
      planning: () => ({
        low: dur,
        median: dur,
        high: dur,
        source: "history",
        samples: 10,
        confidence: "high",
        version: 4,
      }),
      remaining: (j: any) => remMap[j.id],
    }) as any;

  // 1) Connection concurrency scaled down 3 -> 2 on 4-account upstream with remaining 5s, 10s, 20s:
  //    4th video must wait for 2nd completion (10s, NOT 5s!), 5th video waits for 3rd completion (20s)
  const scaleDownConnPlans = healthAdapter.queuePlan!(
    {
      jobs: [
        makeVidJob(1, "running"),
        makeVidJob(2, "running"),
        makeVidJob(3, "running"),
        makeVidJob(4, "queued"),
        makeVidJob(5, "queued"),
      ],
      nodes: [],
      runs: {},
      history: [],
      stamp: 105,
      health: { ready: true, capacity: 4, checked: 100 },
      imageEnabled: true,
      connectionLimits: { "conn-1": 2 },
    },
    mkQueueTools({
      1: { low: 5, median: 5, high: 5, overdue: false },
      2: { low: 10, median: 10, high: 10, overdue: false },
      3: { low: 20, median: 20, high: 20, overdue: false },
    }),
  );
  assert.equal(scaleDownConnPlans[4].low, 10);
  assert.equal(scaleDownConnPlans[4].median, 10);
  assert.equal(scaleDownConnPlans[4].high, 10);
  assert.equal(scaleDownConnPlans[5].median, 20);

  // 2) Upstream shared capacity reduced to 2 (maintenance: 2 on 4 accounts) with out-of-order remaining 20s, 5s, 10s:
  const scaleDownSharedPlans = healthAdapter.queuePlan!(
    {
      jobs: [
        makeVidJob(1, "running"),
        makeVidJob(2, "running"),
        makeVidJob(3, "running"),
        makeVidJob(4, "queued"),
        makeVidJob(5, "queued"),
      ],
      nodes: [],
      runs: {},
      history: [],
      stamp: 105,
      health: { ready: true, capacity: 4, maintenance: 2, checked: 100 },
      imageEnabled: true,
      connectionLimits: { "conn-1": 16 },
    },
    mkQueueTools({
      1: { low: 20, median: 20, high: 20, overdue: false },
      2: { low: 5, median: 5, high: 5, overdue: false },
      3: { low: 10, median: 10, high: 10, overdue: false },
    }),
  );
  assert.equal(scaleDownSharedPlans[4].median, 10);
  assert.equal(scaleDownSharedPlans[5].median, 20);

  // 3) Image capacity reduced to 2 (6 external images on 12-account pool) while 3 local images run (5s, 10s, 20s):
  //    4th local image waits 10s, while local video sees open shared lanes (median 0)
  const scaleDownImgPlans = healthAdapter.queuePlan!(
    {
      jobs: [
        makeImgJob(1, "running"),
        makeImgJob(2, "running"),
        makeImgJob(3, "running"),
        makeImgJob(4, "queued"),
        makeVidJob(5, "queued"),
      ],
      nodes: [],
      runs: {},
      history: [],
      stamp: 105,
      health: {
        ready: true,
        capacity: 12,
        checked: 100,
        tasks: Array.from({ length: 6 }, (_, idx) => ({
          id: `ext_img_${idx}`,
          kind: "image" as const,
        })),
      },
      imageEnabled: true,
      connectionLimits: { "conn-1": 16 },
    },
    mkQueueTools({
      1: { low: 5, median: 5, high: 5, overdue: false },
      2: { low: 10, median: 10, high: 10, overdue: false },
      3: { low: 20, median: 20, high: 20, overdue: false },
    }),
  );
  assert.equal(scaleDownImgPlans[4].median, 10);
  assert.equal(scaleDownImgPlans[5].median, 0);

  // 4) Conservative handling of unknown remaining times during scale-down:
  //    - K=2 with [5s, 10s, null]: 1 slot opens at 10s (even if null hangs forever), so 4th gets 10s and 5th chains on that working lane at 10+30=40s
  //    - K=2 with [5s, null, null] (or K=1 with [5s, null]): all K lanes remain blocked by unknown jobs -> observing
  const oneUnknownPlans = healthAdapter.queuePlan!(
    {
      jobs: [
        makeVidJob(1, "running"),
        makeVidJob(2, "running"),
        makeVidJob(3, "running"),
        makeVidJob(4, "queued"),
        makeVidJob(5, "queued"),
      ],
      nodes: [],
      runs: {},
      history: [],
      stamp: 105,
      health: { ready: true, capacity: 4, checked: 100 },
      imageEnabled: true,
      connectionLimits: { "conn-1": 2 },
    },
    mkQueueTools({
      1: { low: 5, median: 5, high: 5, overdue: false },
      2: { low: 10, median: 10, high: 10, overdue: false },
      3: { source: "none" },
    }),
  );
  assert.equal(oneUnknownPlans[4].source, "queue");
  assert.equal(oneUnknownPlans[4].median, 10);
  assert.equal(oneUnknownPlans[5].source, "queue");
  assert.equal(oneUnknownPlans[5].median, 40);

  const singleSlotUnknownPlans = healthAdapter.queuePlan!(
    {
      jobs: [
        makeVidJob(1, "running"),
        makeVidJob(2, "running"),
        makeVidJob(3, "queued"),
      ],
      nodes: [],
      runs: {},
      history: [],
      stamp: 105,
      health: { ready: true, capacity: 4, checked: 100 },
      imageEnabled: true,
      connectionLimits: { "conn-1": 1 },
    },
    mkQueueTools({
      1: { low: 5, median: 5, high: 5, overdue: false },
      2: { source: "none" },
    }),
  );
  assert.equal(singleSlotUnknownPlans[3].source, "none");
  assert.equal(singleSlotUnknownPlans[3].reason, "observing");

  const twoUnknownPlans = healthAdapter.queuePlan!(
    {
      jobs: [
        makeVidJob(1, "running"),
        makeVidJob(2, "running"),
        makeVidJob(3, "running"),
        makeVidJob(4, "queued"),
      ],
      nodes: [],
      runs: {},
      history: [],
      stamp: 105,
      health: { ready: true, capacity: 4, checked: 100 },
      imageEnabled: true,
      connectionLimits: { "conn-1": 2 },
    },
    mkQueueTools({
      1: { low: 5, median: 5, high: 5, overdue: false },
      2: { source: "none" },
      3: { low: 0, median: 0, high: 0, overdue: true },
    }),
  );
  assert.equal(twoUnknownPlans[4].source, "none");
  assert.equal(twoUnknownPlans[4].reason, "observing");
});

test("Flow's installed sandbox streams split and large results, scopes service credentials and preserves recovery decisions", async () => {
  const release = JSON.parse(
    await readFile("plugins/flow/flow.fmplugin.json", "utf8"),
  );
  const config = {
    baseUrl: "https://1.1.1.1/tenant",
    publicUrl: "https://flow.example/proxy",
    apiKey: "fixture-key",
  };
  let chunks: Buffer[] = [],
    status = 200,
    disconnect = false;
  const sent: { url: string; options: Parameters<typeof chatHttp>[1] }[] = [];
  const send: typeof chatHttp = async (url, options) => {
    assert.ok(options.lookup);
    sent.push({ url: url.href, options });
    return {
      status,
      headers: {},
      body: (async function* () {
        for (const chunk of chunks) yield chunk;
        if (disconnect) throw new Error("socket closed");
      })(),
      close() {},
    };
  };
  const adapter = await sandboxRequest(
    manifestSchema.parse(release.manifest),
    release.studioProgram,
    send,
  );
  const notes: string[] = [];
  const e: Execution = {
    kind: "video",
    model: "flow:veo-3.1-quality-4s-landscape",
    config,
    jobId: randomUUID(),
    idempotencyKey: randomUUID(),
    signal: new AbortController().signal,
    input: {
      prompt: "画面",
      params: { source_media_id: "original" },
      references: [
        { id: "ref", mime: "image/png", url: "data:image/png;base64,AAAA" },
      ],
    },
    reportProviderNote: async (note) => {
      notes.push(note);
    },
  };
  const event = (content: string) =>
    Buffer.from(
      "data: " + JSON.stringify({ choices: [{ delta: { content } }] }) + "\n",
    );
  const resultUrl = "https://storage.googleapis.com/test?x=1&y=2";
  const wire = event(
    '<video data-media-id="asset/7" src="https://storage.googleapis.com/test?x=1&amp;y=2">',
  );
  const expected = {
    state: "completed",
    artifacts: [{ url: resultUrl }],
    usage: { flow_media_id: "asset/7" },
  };
  chunks = [
    wire.subarray(0, 9),
    wire.subarray(9, 15),
    wire.subarray(15),
    Buffer.from("data: [DONE]\ndata: bad\n"),
  ];
  assert.deepEqual(await adapter.submit(e), expected);
  assert.deepEqual(notes, ["Flow 正在生成"]);
  assert.equal(sent[0].url, config.baseUrl + "/v1/chat/completions");
  assert.equal(sent[0].options.key, config.apiKey);
  assert.equal(sent[0].options.readMs, 600000);
  assert.deepEqual(sent[0].options.forwarded, {
    host: "flow.example",
    scheme: "https",
  });
  assert.deepEqual((sent[0].options.body as any).messages[0].content, [
    { type: "text", text: "画面" },
    { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
    { type: "image_url", image_url: { url: "extend://original" } },
  ]);
  // One near-limit record, with non-ASCII content forcing a wide guest string.
  chunks = [event("界" + ".".repeat(7 * 1024 ** 2)), wire];
  assert.deepEqual(await adapter.submit(e), expected);
  const rejects = (message: string) =>
    assert.rejects(
      adapter.submit(e),
      (err) =>
        err instanceof RequestLifecycleError &&
        err.disposition.action === "fail" &&
        err.disposition.note === message,
    );
  chunks = [Buffer.alloc(8 * 1024 ** 2 + 1, 65)];
  await rejects("Flow 返回内容过大，未保存结果");
  chunks = [
    wire,
    Buffer.concat([
      Buffer.from("data: [DONE]\n"),
      Buffer.alloc(8 * 1024 ** 2 + 1),
    ]),
  ];
  assert.deepEqual(await adapter.submit(e), expected);
  chunks = [
    Buffer.from("data: "),
    Buffer.from(JSON.stringify({ error: { message: "captcha" } }), "utf16le"),
    Buffer.from("\n"),
  ];
  await rejects("Flow 验证码服务未通过，请管理员检查 YesCaptcha 配置与余额");
  chunks = [Buffer.from('data: {"choices":false}\n')];
  await rejects("Flow 生成或保存失败，请从后台检查结果后重试");
  chunks = [Buffer.from("private provider diagnostic: quota")];
  status = 429;
  await rejects("Flow 账号额度不足或当前模型不可用，请管理员检查账号");
  chunks = [];
  status = 200;
  disconnect = true;
  await rejects(
    "与 Flow 的连接中断，生成结果未确认；请核对后台记录后再重新生成",
  );
  disconnect = false;
  chunks = [Buffer.from("media")];
  const download = (url: string, recovering = false) =>
    adapter.downloadArtifact!({ config, url, recovering }, e.signal);
  for (const url of [resultUrl, "https://image.googleusercontent.com/x"]) {
    assert.equal(Buffer.from(await download(url)).toString(), "media");
    assert.equal(sent.at(-1)?.url, url);
    assert.equal(sent.at(-1)?.options.key, undefined);
    assert.equal(sent.at(-1)?.options.forwarded, undefined);
  }
  await download(config.publicUrl + "/tmp/cached.mp4");
  assert.equal(sent.at(-1)?.url, config.baseUrl + "/tmp/cached.mp4");
  assert.equal(sent.at(-1)?.options.key, config.apiKey);
  assert.equal(sent.at(-1)?.options.forwarded, undefined);
  const before = sent.length;
  for (const url of [
    "https://googleusercontent.com/x",
    "https://image.googleusercontent.com.example/x",
    "https://flow-content.google:8443/x",
    "http://127.0.0.1/x",
  ]) {
    await assert.rejects(download(url), /媒体地址不受支持/);
    await assert.rejects(download(url, true), /从后台检查生成结果/);
  }
  assert.equal(sent.length, before);
});
