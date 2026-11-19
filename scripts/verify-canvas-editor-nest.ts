/** Browser coverage for the default editor over the PostgreSQL original protocol. */
import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile, stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { createServer, type AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import {
  chromium,
  expect,
  type APIRequestContext,
  type Browser,
  type Download,
  type Response,
} from "@playwright/test";
import { Queue, Worker, type ConnectionOptions } from "bullmq";
import sharp from "sharp";
import { createApp } from "../apps/api/src/main.js";
import { createOriginalApp } from "../apps/api/src/original.js";
import { ChatExecution } from "../packages/original-api/src/chat-execution.js";
import { ChatQueue } from "../packages/original-api/src/chat-queue.js";
import { ChatRuntime } from "../packages/original-api/src/chat-runtime.js";
import { OriginalChats } from "../packages/original-api/src/chats.js";
import { StoryboardQueue } from "../packages/original-api/src/storyboard-queue.js";
import { OriginalStoryboardExports } from "../packages/original-api/src/storyboard-exports.js";
import { StudioCatalog } from "../packages/platform/src/catalog.js";
import { one } from "../packages/platform/src/db.js";
import { Executor } from "../packages/platform/src/executor.js";
import {
  importLegacy,
  legacyId,
  type LegacyExport,
} from "../packages/platform/src/importer.js";
import { canonical, PluginRegistry } from "../packages/platform/src/plugins.js";
import type { ProviderPlugin } from "../packages/plugin-sdk/src/index.js";
import { chatStreaming } from "../plugins/chat/src/stream.js";
import { gpuCanvasRuns } from "../plugins/gpu/src/canvas-runs.js";
import { canvasRunPlugins } from "../tests/helpers/canvas-runs.js";
import { canvasImportTables } from "../tests/helpers/canvas-import.js";
import { chatProviderFixture } from "../tests/helpers/chat-provider.js";
import { databaseFixture } from "../tests/helpers/database.js";
import { verifyPortableReferences } from "./verify-canvas-portable-references.js";

assert.ok(
  process.env.TEST_DATABASE_URL && process.env.TEST_REDIS_URL,
  "Set TEST_DATABASE_URL and TEST_REDIS_URL to isolated test services",
);
const redis = new URL(process.env.TEST_REDIS_URL);
assert.match(redis.protocol, /^rediss?:$/);
const connection: ConnectionOptions = {
  host: redis.hostname,
  port: Number(redis.port || 6379),
  username: decodeURIComponent(redis.username) || undefined,
  password: decodeURIComponent(redis.password) || undefined,
  db: Number(redis.pathname.slice(1) || 0),
  ...(redis.protocol === "rediss:" ? { tls: {} } : {}),
  // Fail promptly if the test Redis disappears.
  retryStrategy: () => null,
};
const namespace = "test-canvas-editor-" + randomUUID();
const chatQueueName = namespace + "-chat";
const exportQueueName = namespace + "-exports";
const marker = "x-canvas-test-nest";
const portableReferences = process.argv.includes("--portable-references");
const timeout = 15_000;
const narration = "同一组历史画布上的新旁白。";
const question = "把原始文案改成慢慢推进的镜头。";
const replyParts = ["新的文案：", "镜头缓缓推进。"];
const reply = replyParts.join("");
const namedMedia = (id: number) => id.toString(16).padStart(32, "0");
const f = await databaseFixture();
const errors: string[] = [];
const providerCalls: {
  kind: string;
  prompt: string;
  refs: number;
  seed: unknown;
}[] = [];
let app: Awaited<ReturnType<typeof createOriginalApp>> | undefined;
let advanced: Awaited<ReturnType<typeof createApp>> | undefined;
let web: ChildProcess | undefined;
let browser: Browser | undefined;
let chatProvider: Awaited<ReturnType<typeof chatProviderFixture>> | undefined;
let generationQueue: Queue | undefined;
let generationWorker: Worker | undefined;
let chatQueue: ChatQueue | undefined;
let storyboardQueue: StoryboardQueue | undefined;
let step = "prepare isolated fixtures";

function ffmpeg(input: string, filename: string, output: string[] = []) {
  execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      input,
      ...output,
      join(f.directory, filename),
    ],
    { timeout },
  );
}
async function importHistory() {
  ffmpeg("color=blue:s=96x54:r=24:d=1", "shot.mp4", [
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
  ]);
  ffmpeg("sine=frequency=440:sample_rate=24000:duration=1", "voice.wav");
  await sharp({
    create: { width: 96, height: 54, channels: 3, background: "#58a1ac" },
  })
    .png()
    .toFile(join(f.directory, "ref.png"));
  const history = join(f.directory, "history");
  execFileSync(
    process.env.STUDIO_PYTHON ||
      resolve(".runtime-advanced/original/.venv/bin/python"),
    ["scripts/canvas-import-fixtures.py", history, f.directory],
    { timeout: 60_000, stdio: ["ignore", "pipe", "inherit"] },
  );
  const data: LegacyExport = JSON.parse(
    await readFile(join(history, "export.json"), "utf8"),
  );
  assert.equal(data.canvasVersion, 1);
  const objects = join(history, "runtime/media");
  await importLegacy(f.p, data, objects);
  assert.equal((await importLegacy(f.p, data, objects)).alreadyImported, true);
  const mapped = await canvasImportTables(f.db);
  for (const [table, rows] of Object.entries(mapped))
    assert.deepEqual(
      rows.map(canonical).sort(),
      data.tables[table].map(canonical).sort(),
      table,
    );
  return data;
}

async function configureProviders(data: LegacyExport) {
  const bytes = {
    video: await readFile(join(f.directory, "shot.mp4")),
    audio: await readFile(join(f.directory, "voice.wav")),
  };
  const {
    artifactValidation,
    inputPreparation,
    referenceImports,
    originalState,
    ...manifest
  } = gpuCanvasRuns.manifest;
  const version = "1.99.0";
  // Keep the original submission policy, pricing and canvas model contract.
  // Only the test adapter execution and the node transport are synthetic.
  const mock: ProviderPlugin = {
    ...gpuCanvasRuns,
    manifest: {
      ...manifest,
      ...(portableReferences ? { referenceImports } : {}),
      version,
      mode: "request",
      originalState: { ...originalState!, recovery: undefined },
      queue: {
        ...manifest.queue!,
        timingVersions: [...manifest.queue!.timingVersions, version],
      },
    },
    async submit(request) {
      const { kind, input } = request;
      assert.ok(kind === "audio" || kind === "video");
      providerCalls.push({
        kind,
        prompt: input.prompt,
        refs: input.references.length,
        seed: input.params.seed,
      });
      const mime = kind === "audio" ? "audio/wav" : "video/mp4";
      return {
        state: "completed",
        artifacts: [
          { url: "data:" + mime + ";base64," + bytes[kind].toString("base64") },
        ],
      };
    },
  };
  const installed = await f.db.query<{ id: string; version: string }>(
    "SELECT id,version FROM plugin_versions WHERE endpoint IS NULL AND id<>'legacy-archive'",
  );
  const builtins = await Promise.all(
    installed.rows.map(({ id, version }) =>
      f.p.registry.resolve(f.db, id, version),
    ),
  );
  f.p.registry = new PluginRegistry([...builtins, mock]);
  await f.p.registry.install(f.db, mock.manifest);
  const catalog = new StudioCatalog(f.db);
  await f.db.transaction(async (sql) => {
    for (const plugin of [
      ...canvasRunPlugins.filter((plugin) => plugin.manifest.id !== "gpu"),
      mock,
      chatStreaming,
    ])
      await catalog.activate(sql, plugin.manifest);
  });
  const user = data.tables.users.find((row) => row.name === "admin")!;
  const actor = {
    id: legacyId(data.source, "user", user.id),
    name: user.name,
    nickname: user.nickname,
    role: user.role,
  };
  chatProvider = await chatProviderFixture();
  chatProvider.setWire("stream", {
    raw:
      [
        ...replyParts.map((content) => ({ choices: [{ delta: { content } }] })),
        {
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: { total_tokens: 20 },
        },
      ]
        .map((event) => "data: " + JSON.stringify(event) + "\n\n")
        .join("") + "data: [DONE]\n\n",
    chunks: [19, 27, 31],
  });
  for (const [plugin, config] of [
    [mock, {}],
    [chatStreaming, chatProvider.config()],
  ] as const) {
    const id = await f.p.createConnection(actor, {
      name: "Canvas browser fixture " + plugin.manifest.id,
      pluginId: plugin.manifest.id,
      version: plugin.manifest.version,
      config,
    });
    await f.p.updateConnection(actor, id.id, {
      revision: 1,
      enabled: true,
      concurrency: 2,
    });
  }
  return version;
}

async function nextPort() {
  const socket = createServer().listen(0, "127.0.0.1");
  await once(socket, "listening");
  const { port } = socket.address() as AddressInfo;
  await new Promise<void>((closed) => socket.close(() => closed()));
  return port;
}

async function downloaded(download: Download) {
  assert.equal(await download.failure(), null);
  return readFile((await download.path())!);
}

async function verify() {
  const data = await importHistory();
  const version = await configureProviders(data);
  const project = data.tables.canvas_projects.find((row) =>
    row.title.startsWith("原画布"),
  )!;
  const foreign = data.tables.canvas_projects.find(
    (row) => row.title === "私有",
  )!;
  const team = data.tables.canvas_projects.find(
    (row) => row.title === "原成员画布",
  )!;
  const workspace = String(project.workspace);
  const path = "/api/canvases/" + project.id;
  const editorPath = "/canvas/" + project.id;
  const clip = await readFile(join(f.directory, "shot.mp4"));
  const voice = await readFile(join(f.directory, "voice.wav"));
  const historicalVideo = data.tables.jobs.find(
    (row) => row.result === namedMedia(2),
  )!;
  const oldExport = data.tables.storyboard_exports.find(
    (row) => row.project === project.id && row.state === "done",
  )!;
  const before = data.tables.credit_accounts.find(
    (row) => row.workspace === project.workspace,
  )!.balance;
  const price = (key: string) => {
    const amount = data.tables.credit_prices.find(
      (row) => row.key === key,
    )?.amount;
    assert.ok(Number.isInteger(amount) && amount > 0, key);
    return Number(amount);
  };
  const videoCost = price("MiniMax H3|480|5");
  const voiceCost = price("breeze-tts-2|standard");
  const chatCost = price("deepseek-flash|reply");

  step = "start Nest, Next, and the isolated BullMQ workers";
  const executor = new Executor(f.p);
  generationQueue = new Queue("generation", { connection, prefix: namespace });
  generationWorker = new Worker(
    "generation",
    (job) => executor.execute(job.data.id),
    {
      connection,
      prefix: namespace,
      concurrency: 1,
    },
  );
  chatQueue = new ChatQueue(
    new ChatRuntime(new ChatExecution(new OriginalChats(f.p))),
    connection,
    {
      name: chatQueueName,
      onError: (error) => errors.push("chat worker: " + error.message),
    },
  );
  storyboardQueue = new StoryboardQueue(
    new OriginalStoryboardExports(f.p),
    connection,
    exportQueueName,
    (error) => errors.push("storyboard worker: " + String(error)),
  );
  generationQueue.on("error", (error) =>
    errors.push("generation queue: " + error.message),
  );
  generationWorker.on("error", (error) =>
    errors.push("generation worker: " + error.message),
  );
  generationWorker.on("failed", (_job, error) =>
    errors.push("generation job: " + error.message),
  );
  await Promise.all([
    generationWorker.waitUntilReady(),
    chatQueue.worker.waitUntilReady(),
    storyboardQueue.worker.waitUntilReady(),
  ]);

  const port = await nextPort();
  const origin = "http://127.0.0.1:" + port;
  process.env.PUBLIC_URL = origin;
  process.env.FUMIAO_PAYMENT_AUTOSTART = "0";
  app = await createOriginalApp(f.p);
  app
    .getHttpServer()
    .prependListener(
      "request",
      (_request: unknown, response: ServerResponse) => {
        response.setHeader(marker, namespace);
      },
    );
  await app.listen(0, "127.0.0.1");
  advanced = await createApp(f.p);
  await advanced.listen(0, "127.0.0.1");
  web = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "apps/web",
      "-p",
      String(port),
      "-H",
      "127.0.0.1",
    ],
    {
      env: {
        ...process.env,
        STUDIO_MODE: "original",
        STUDIO_CANVAS_EDITOR: undefined,
        LEGACY_API_INTERNAL_URL: await app.getUrl(),
        API_INTERNAL_URL: await advanced.getUrl(),
        FUMIAO_REPOSITORY_ROOT: process.cwd(),
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "ignore", "inherit"],
    },
  );
  await expect
    .poll(
      async () => {
        const response = await fetch(origin + "/health", {
          signal: AbortSignal.timeout(750),
        }).catch(() => null);
        await response?.body?.cancel();
        return response?.headers.get(marker);
      },
      { timeout },
    )
    .toBe(namespace);

  browser = await chromium.launch(
    portableReferences ? { args: ["--disable-partial-raster"] } : {},
  );
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const member = await browser.newContext({ baseURL: origin });
  const guest = await browser.newContext({ baseURL: origin });
  const page = await context.newPage();
  const requests: string[] = [];
  for (const tab of [page, await member.newPage()]) {
    tab.setDefaultTimeout(timeout);
    tab.on("pageerror", (error) => errors.push(error.message));
    tab.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin !== origin)
        errors.push("Unexpected browser origin: " + url.origin);
      requests.push(url.pathname);
    });
    tab.on("response", (response) => {
      const url = new URL(response.url());
      if (response.status() >= 500)
        errors.push(response.status() + " " + url.pathname);
      if (
        /^\/(?:api|media)\//.test(url.pathname) &&
        response.headers()[marker] !== namespace
      )
        errors.push("Missing Nest marker: " + url.pathname);
    });
  }
  const memberPage = member.pages()[0];
  const request = async (
    route: string,
    options: {
      client?: APIRequestContext;
      method?: string;
      data?: unknown;
      status?: number;
      space?: string;
      headers?: Record<string, string>;
    } = {},
  ) => {
    const {
      client = context.request,
      method = "GET",
      data,
      status = 200,
      space = workspace,
      headers,
    } = options;
    const response = await client.fetch(route, {
      method,
      data,
      maxRedirects: 0,
      headers: { "X-Workspace-Id": space, Origin: origin, ...headers },
    });
    assert.equal(
      response.status(),
      status,
      method +
        " " +
        route +
        " " +
        (response.status() === status ? "" : await response.text()),
    );
    assert.equal(response.headers()[marker], namespace, route);
    assert.equal(response.headers()["x-fumiao-web"], "next", route);
    return response;
  };
  const get = async (route: string) => (await request(route)).json();
  const post = async (route: string, data: unknown) =>
    (await request(route, { method: "POST", data })).json();
  const current = () => get(path);
  const credit = () => get("/api/credits");
  const click = (name: string) =>
    page.getByRole("button", { name, exact: true }).click();
  const close = (name: string | RegExp) =>
    page
      .getByRole("dialog", { name })
      .getByRole("button", { name: "关闭", exact: true })
      .click();
  const node = (id: string) => page.getByTestId("rf__node-" + id);
  const findNode = async (text: string) => {
    await click("搜索节点");
    const search = page.getByRole("dialog", { name: "搜索节点" });
    await search.getByRole("textbox").fill(text);
    await search.locator(".source-list").getByRole("button").click();
  };
  const changed = (route: string | RegExp, method = "POST") =>
    page.waitForResponse((r) => {
      const pathname = new URL(r.url()).pathname;
      return (
        (typeof route === "string"
          ? route === pathname
          : route.test(pathname)) && r.request().method() === method
      );
    });
  const checked = async (response: Response, status = 200) => {
    assert.equal(
      response.status(),
      status,
      response.url() +
        " " +
        (response.status() === status ? "" : await response.text()),
    );
    assert.equal(response.headers()[marker], namespace);
    return response;
  };
  const clickResponse = async (route: string, label: string) => {
    const [response] = await Promise.all([changed(route), click(label)]);
    return checked(response);
  };
  const wallet = async (balance: number, reserved: number) => {
    assert.deepEqual((await credit()).wallet, {
      workspace: project.workspace,
      balance,
      reserved,
      available: balance - reserved,
    });
  };
  const charges = async (
    ids: number[],
    cost: number,
    settled?: "spend" | "refund",
  ) => {
    const { history } = await credit();
    for (const id of ids) {
      assert.deepEqual(
        history
          .filter((row: any) => row.job === id)
          .map(({ action, amount }: any) => [action, amount]),
        settled
          ? [
              [settled, cost],
              ["reserve", cost],
            ]
          : [["reserve", cost]],
        "job " + id,
      );
    }
  };
  const dispatchGeneration = async (ids: number[]) => {
    const rows = await f.db.query(
      "SELECT id,public_id,plugin_version FROM jobs WHERE public_id=ANY($1::bigint[])",
      [ids],
    );
    assert.equal(rows.rows.length, ids.length);
    const ready = await executor.queueReady();
    for (const row of rows.rows) {
      assert.equal(row.plugin_version, version);
      assert.ok(
        ready.some((item) => item.id === row.id),
        "durable generation outbox: " + row.public_id,
      );
      await generationQueue!.add(
        "execute",
        { id: row.id },
        { jobId: row.id, removeOnComplete: true, removeOnFail: true },
      );
    }
    await expect
      .poll(
        async () =>
          (
            await f.db.query(
              "SELECT state FROM jobs WHERE public_id=ANY($1::bigint[]) ORDER BY public_id",
              [ids],
            )
          ).rows.map((row) => row.state),
        { timeout },
      )
      .toEqual(ids.map(() => "completed"));
  };

  step = "read mapped canvas history and enforce workspace access in Chromium";
  for (const [client, name] of [
    [context.request, "admin"],
    [member.request, "member"],
  ] as const)
    await request("/api/login", {
      client,
      method: "POST",
      data: { name, password: "canvas-import-fixture" },
    });
  if (portableReferences) {
    step = "compare portable H3 references to the public canvas bundle";
    ffmpeg("color=blue:s=96x54:r=24:d=3", "portable.mp4", [
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
    ]);
    await verifyPortableReferences({
      browser,
      origin,
      workspace,
      request,
      provenance: { [marker]: namespace, "x-fumiao-web": "next" },
      storageState: await context.storageState(),
      image: namedMedia(1),
      referenceVideo: await readFile(join(f.directory, "portable.mp4")),
    });
    return;
  }
  assert.ok(Array.isArray((await get("/api/recharge")).orders));
  assert.match((await get("/api/pairs/default-name")).name, /^弗淼\d+$/);
  await request("/agent/registration", { client: guest.request, status: 401 });
  const originalAgent = await request("/agent/heartbeat", {
    client: guest.request,
    method: "POST",
    data: { stage: "ready" },
    status: 401,
  });
  assert.deepEqual(await originalAgent.json(), { detail: "缺少实例凭据" });
  const v2Agent = await guest.request.post("/agent/v2/heartbeat");
  assert.equal(v2Agent.status(), 401);
  assert.equal(v2Agent.headers()["x-fumiao-web"], "next");
  assert.deepEqual(await v2Agent.json(), { message: "节点凭据失效" });
  const paymentReturn = await request("/payments/return", {
    client: guest.request,
    status: 303,
  });
  assert.equal(paymentReturn.headers().location, "/studio?recharge=history");
  const imported = await current();
  assert.equal(imported.title, project.title);
  assert.equal(imported.revision, project.revision);
  assert.deepEqual(imported.document, JSON.parse(project.document));
  const historicalRuns = await get(path + "/runs");
  assert.ok(
    historicalRuns.runs.some(
      (run: any) =>
        run.id === historicalVideo.id &&
        run.status === "done" &&
        run.result === historicalVideo.result,
    ),
  );
  const oldBatch = data.tables.canvas_run_batches.find(
    (row) => row.project === project.id,
  )!;
  const oldBatchReply = JSON.parse(oldBatch.result);
  assert.ok(
    historicalRuns.runs.some(
      (run: any) =>
        run.id === oldBatchReply.ids[0] &&
        run.batch.uid === oldBatch.uid &&
        run.status === "failed",
    ),
  );
  assert.ok(
    !historicalRuns.runs.some((run: any) => run.id === oldBatchReply.ids[1]),
  );
  assert.deepEqual(
    await post(path + "/nodes/old/candidates", {
      uid: oldBatch.uid,
      count: 2,
      expected_revision: 1,
      price_revision: 999,
    }),
    oldBatchReply,
  );
  const historicalLink = data.tables.canvas_job_links.find(
    (row) => row.job === historicalVideo.id,
  )!;
  assert.deepEqual(
    await post(path + "/nodes/v/runs", {
      uid: historicalLink.uid,
      expected_revision: 1,
      price_revision: 999,
    }),
    { id: historicalVideo.id },
  );
  const oldHistory = (await credit()).history;
  for (const entry of data.tables.credit_ledger.filter(
    (row) => row.workspace === project.workspace,
  )) {
    const row = oldHistory.find((row: any) => row.id === entry.id);
    assert.ok(row, "historical ledger " + entry.id);
    for (const key of [
      "job",
      "action",
      "amount",
      "balance",
      "reserved",
      "created",
      "note",
    ])
      assert.equal(row[key], entry[key], key);
  }
  await wallet(before, 0);
  assert.deepEqual(
    await (await request("/media/" + historicalVideo.result)).body(),
    clip,
  );
  const range = await request("/media/" + historicalVideo.result, {
    headers: { Range: "bytes=4-15" },
    status: 206,
  });
  assert.equal(range.headers()["content-range"], "bytes 4-15/" + clip.length);
  assert.deepEqual(await range.body(), clip.subarray(4, 16));
  assert.equal(
    await (
      await request("/api/storyboard-exports/" + oldExport.id + "/subtitles")
    ).text(),
    oldExport.subtitles,
  );
  const denied = await memberPage.goto(editorPath + "?workspace=" + workspace);
  assert.ok(denied?.ok());
  await expect(
    memberPage.getByRole("heading", { name: "画布暂时无法打开" }),
  ).toBeVisible();
  const own = await memberPage.goto("/canvas/" + foreign.id);
  assert.ok(own?.ok());
  await expect(
    memberPage.getByRole("textbox", { name: "画布名称" }),
  ).toHaveValue(foreign.title);
  const teamPacks = await (
    await request("/api/asset-packs", { space: String(team.workspace) })
  ).json();
  assert.ok(
    teamPacks.packs.some(
      (pack: any) =>
        pack.name === "历史包" && pack.media.includes(namedMedia(5)),
    ),
  );
  for (const route of [
    path,
    path + "/runs",
    path + "/exports",
    "/media/" + historicalVideo.result,
    "/api/storyboard-exports/" + oldExport.id + "/subtitles",
  ])
    await request(route, { client: member.request, status: 404 });
  await request(path + "/document", {
    client: member.request,
    method: "PUT",
    status: 404,
    data: {
      title: imported.title,
      expected_revision: imported.revision,
      document: imported.document,
    },
  });
  await request("/media/" + historicalVideo.result, {
    client: guest.request,
    status: 401,
  });
  await request("/api/state", { client: member.request, status: 403 });
  await request(path + "/document", {
    method: "PUT",
    status: 404,
    data: {
      title: imported.title,
      expected_revision: imported.revision,
      document: {
        nodes: [
          { id: "foreign", type: "image", x: 0, y: 0, media_id: namedMedia(4) },
        ],
      },
    },
  });
  assert.deepEqual(await current(), imported);

  step = "hydrate the React editor, exercise autosave and private asset upload";
  // Arrange the already imported nodes for reliable pointer interactions.
  const layout = {
    ...imported.document,
    nodes: imported.document.nodes.map((item: any) => ({
      ...item,
      x: item.id === "text" ? 100 : 495,
      y: 135,
      ...(item.id === "v" ? { params: { ...item.params, seed: 42 } } : {}),
    })),
  };
  const positioned = await (
    await request(path + "/document", {
      method: "PUT",
      data: {
        title: "历史画布",
        expected_revision: imported.revision,
        document: layout,
      },
    })
  ).json();
  const editor = await page.goto(editorPath);
  assert.ok(editor && editor.ok());
  const html = await editor.text();
  assert.match(html, /\/_next\/static\//);
  assert.doesNotMatch(
    html,
    /<script[^>]+\/static\/(?:canvas|chat|flowpicker)\.js/,
  );
  const title = page.getByRole("textbox", { name: "画布名称" });
  await expect(title).toHaveValue("历史画布");
  const save = changed(path + "/document", "PUT");
  await title.fill("迁移后的历史画布");
  await title.press("Enter");
  await checked(await save);
  assert.equal((await current()).revision, positioned.revision + 1);
  await page.reload();
  await expect(title).toHaveValue("迁移后的历史画布");
  const upload = changed("/api/assets");
  const chooser = page.waitForEvent("filechooser");
  await click("上传图片");
  await (await chooser).setFiles(join(f.directory, "ref.png"));
  const uploadedNode = async () =>
    (await current()).document.nodes.find(
      (item: any) => item.title === "ref.png",
    );
  await checked(await upload);
  await expect
    .poll(async () => (await uploadedNode())?.media_id)
    .toMatch(/^[a-f0-9]{32}$/);
  const uploadedId: string = (await uploadedNode()).media_id;
  const stored = await one(
    f.db,
    "SELECT id,object_key,workspace_id FROM assets WHERE public_id=$1",
    [uploadedId],
  );
  assert.equal(
    stored.workspace_id,
    legacyId(data.source, "workspace", project.workspace),
  );
  assert.equal(
    (await stat(join(f.directory, stored.object_key))).mode & 0o777,
    0o600,
  );
  const asset = await request("/media/" + uploadedId);
  assert.match(asset.headers()["content-type"], /^image\//);
  await request("/media/" + uploadedId, {
    client: member.request,
    status: 404,
  });
  const pack = await post("/api/asset-packs", {
    name: "浏览器参考素材",
    purpose: "subject",
    description: "本地测试图",
    media: [uploadedId],
  });
  await click("生成历史");
  const history = page.getByRole("dialog", { name: "生成历史" });
  await expect(history.getByText("两候选", { exact: true })).toBeVisible();
  await history.getByText("历史画面", { exact: true }).click();
  await click("素材包");
  await click("打开素材包 浏览器参考素材");
  await click("导入整个素材包");
  await expect
    .poll(
      async () =>
        (await current()).document.nodes.find((item: any) => item.id === "v")
          .asset_packs,
    )
    .toEqual([{ id: pack.id, revision: pack.revision }]);

  step = "submit, replay, cancel and settle generation and two candidates";
  const candidateRoute = path + "/nodes/v/candidates";
  const submit = async (label: string) => {
    const response = await clickResponse(candidateRoute, label);
    assert.equal(response.request().headers()["x-workspace-id"], workspace);
    return {
      result: await response.json(),
      draft: response.request().postDataJSON(),
    };
  };
  const single = await submit("生成");
  assert.equal(single.result.ids.length, 1);
  const cancelled = single.result.ids[0];
  assert.ok(
    cancelled >
      Math.max(...data.tables.credit_ledger.map((row) => row.job || 0)),
  );
  await wallet(before, videoCost);
  await charges(single.result.ids, videoCost);
  const replay = await Promise.all([
    post(candidateRoute, single.draft),
    post(candidateRoute, single.draft),
  ]);
  assert.deepEqual(replay, [single.result, single.result]);
  await charges(single.result.ids, videoCost);
  await wallet(before, videoCost);
  await clickResponse("/api/jobs/" + cancelled + "/cancel", "取消任务");
  await wallet(before, 0);
  await charges(single.result.ids, videoCost, "refund");
  assert.equal(providerCalls.length, 0);

  const generated = await submit("生成");
  await wallet(before, videoCost);
  await dispatchGeneration(generated.result.ids);
  await wallet(before - videoCost, 0);
  await charges(generated.result.ids, videoCost, "spend");
  await click("候选数量");
  await click("2 个候选");
  await click("生成");
  await expect(
    page.getByRole("dialog", { name: "生成两个候选" }),
  ).toBeVisible();
  const pair = await submit("确认生成 · " + 2 * videoCost);
  assert.equal(new Set(pair.result.ids).size, 2);
  await wallet(before - videoCost, 2 * videoCost);
  await charges(pair.result.ids, videoCost);
  await request(candidateRoute, {
    client: member.request,
    method: "POST",
    data: pair.draft,
    status: 404,
  });
  await dispatchGeneration(pair.result.ids);
  await wallet(before - 3 * videoCost, 0);
  await charges(pair.result.ids, videoCost, "spend");
  const runs = (await get(path + "/runs")).runs.filter((run: any) =>
    pair.result.ids.includes(run.id),
  );
  assert.deepEqual(
    runs.map((run: any) => [
      run.status,
      run.batch.uid,
      run.batch.index,
      run.batch.count,
    ]),
    [
      ["done", pair.draft.uid, 2, 2],
      ["done", pair.draft.uid, 1, 2],
    ],
  );
  assert.ok(runs.every((run: any) => run.refs.includes(uploadedId)));
  assert.ok(
    providerCalls.every(
      (call) => call.refs === 1 && call.prompt.includes(pack.name),
    ),
  );
  assert.deepEqual(providerCalls.map((call) => call.seed).sort(), [42, 42, 43]);
  const adopt = changed(path + "/document", "PUT");
  await page.getByRole("button", { name: "采用", exact: true }).first().click();
  await checked(await adopt);
  const adopted = (await current()).document.nodes.find(
    (item: any) => item.id === "v",
  ).active_job;
  assert.ok(pair.result.ids.includes(adopted));
  assert.deepEqual(await post(candidateRoute, pair.draft), pair.result);
  await click("已采用");
  await click("并排对比");
  const comparisonTitle = /^对比版本 ·/;
  const comparison = page.getByRole("dialog", { name: comparisonTitle });
  await expect(comparison).toBeVisible();
  const versions = comparison.locator("select");
  await expect(versions).toHaveCount(2);
  const selectedVersions = await versions.evaluateAll((items) =>
    items.map((item) => Number((item as HTMLSelectElement).value)),
  );
  assert.deepEqual([...selectedVersions].sort(), [...pair.result.ids].sort());
  await expect(comparison.locator("video")).toHaveCount(2);
  await expect
    .poll(
      () =>
        comparison
          .locator("video")
          .evaluateAll((players) =>
            players.every(
              (player) => (player as HTMLVideoElement).readyState >= 2,
            ),
          ),
      { timeout },
    )
    .toBe(true);
  await close(comparisonTitle);

  step = "generate and adopt narration";
  await click("镜头列表");
  await click("镜头 1 的旁白");
  await page.getByLabel("旁白文字").fill(narration);
  const spoken = await (
    await clickResponse(path + "/nodes/v/narration", "生成旁白 · " + voiceCost)
  ).json();
  await wallet(before - 3 * videoCost, voiceCost);
  await dispatchGeneration([spoken.id]);
  await wallet(before - 3 * videoCost - voiceCost, 0);
  await charges([spoken.id], voiceCost, "spend");
  await expect
    .poll(
      async () =>
        (await current()).document.nodes.find((item: any) => item.id === "v")
          .narration_job,
      { timeout },
    )
    .toBe(spoken.id);
  const spokenRun = (await get(path + "/runs")).runs.find(
    (run: any) => run.id === spoken.id,
  );
  assert.equal(spokenRun.prompt, narration);
  await expect(page.getByLabel("当前旁白")).toHaveAttribute(
    "src",
    "/media/" + spokenRun.result,
  );
  assert.deepEqual(
    await (await request("/media/" + spokenRun.result)).body(),
    voice,
  );

  step = "compose, replay and download the private export and shot package";
  const zipEvent = page.waitForEvent("download");
  await click("导出镜头包");
  const zip = await zipEvent;
  assert.match(zip.suggestedFilename(), /\.zip$/);
  assert.match(new URL(zip.url()).pathname, /^\/api\/downloads\//);
  const zipBytes = await downloaded(zip);
  assert.equal(zipBytes.readUInt32LE(0), 0x04034b50);
  assert.ok(zipBytes.includes(Buffer.from("镜头-001.mp4")));
  await request(new URL(zip.url()).pathname, {
    client: member.request,
    status: 403,
  });
  const exportRoute = path + "/exports";
  const accepted = await clickResponse(exportRoute, "合成预览");
  const started = await accepted.json();
  const exportDraft = accepted.request().postDataJSON();
  assert.equal(started.state, "queued");
  assert.deepEqual(await post(exportRoute, exportDraft), started);
  await storyboardQueue.dispatch();
  const srtLink = page.getByRole("link", { name: "字幕 SRT", exact: true });
  const srtPath = "/api/storyboard-exports/" + started.id + "/subtitles";
  const exportRow = page
    .locator(".composition-result")
    .filter({ has: srtLink.and(page.locator('[href="' + srtPath + '"]')) });
  await expect(exportRow).toBeVisible({ timeout: 25_000 });
  const completed = (await get(exportRoute)).exports.find(
    (row: any) => row.id === started.id,
  );
  assert.equal(completed.state, "done");
  assert.deepEqual(await post(exportRoute, exportDraft), completed);
  const captionEvent = page.waitForEvent("download");
  await exportRow.getByRole("link", { name: "字幕 SRT" }).click();
  const captions = await captionEvent;
  assert.equal(captions.suggestedFilename(), "subtitles.srt");
  assert.ok((await downloaded(captions)).toString().includes(narration));
  const mp4Event = page.waitForEvent("download");
  await exportRow.getByRole("link", { name: "MP4" }).click();
  const output = await downloaded(await mp4Event);
  assert.equal(output.toString("ascii", 4, 8), "ftyp");
  assert.notDeepEqual(output, clip);
  await exportRow.getByRole("button", { name: "预览" }).click();
  await expect(page.locator(".composition-preview track")).toHaveAttribute(
    "src",
    srtPath + "?format=vtt",
  );
  assert.match(
    await (await request(srtPath + "?format=vtt")).text(),
    /^WEBVTT/,
  );
  await request(srtPath, { client: member.request, status: 404 });
  await request("/media/" + completed.result, {
    client: member.request,
    status: 404,
  });
  await close("镜头列表");

  step = "stream a versioned chat reply and persist browser writeback";
  await findNode("原文");
  const draft = page.getByRole("textbox", { name: "文本生成要求" });
  await draft.fill(question);
  const sent = changed(/^\/api\/chats\/[^/]+\/messages$/);
  const events = changed(/^\/api\/chats\/[^/]+\/events$/, "GET");
  await click("生成文本");
  const turn = await checked(await sent);
  const conversation = (await turn.json()).conversation;
  const stream = await checked(await events);
  assert.match(stream.headers()["content-type"], /^text\/event-stream/);
  assert.equal(new URL(stream.url()).searchParams.get("workspace"), workspace);
  await wallet(before - 3 * videoCost - voiceCost, chatCost);
  const applied = changed("/api/chats/" + conversation.id + "/apply");
  await chatQueue.dispatch();
  const writeback = await checked(await applied);
  await expect(node("text").getByText(reply, { exact: true })).toBeVisible({
    timeout,
  });
  assert.equal(
    (await current()).document.nodes.find((item: any) => item.id === "text")
      .text,
    reply,
  );
  const conversationURL = "/api/chats/" + conversation.id;
  const snapshot = await get(conversationURL);
  const message = snapshot.messages.at(-1);
  assert.equal(message.state, "complete");
  assert.equal(message.content, reply);
  const chatCalls = chatProvider!.requests.filter((call) => call.body?.stream);
  assert.equal(chatCalls.length, 1);
  assert.equal(chatCalls[0].authorization, "Bearer sk-local-chat-fixture");
  assert.ok(JSON.stringify(chatCalls[0].body.messages).includes(question));
  const chatCharges = (await credit()).history.filter(
    (row: any) => row.chat_turn != null,
  );
  assert.deepEqual(
    chatCharges.map((row: any) => [row.action, row.amount]),
    [
      ["spend", chatCost],
      ["reserve", chatCost],
    ],
  );
  assert.equal(chatCharges[0].chat_turn, chatCharges[1].chat_turn);
  await wallet(before - 3 * videoCost - voiceCost - chatCost, 0);
  assert.deepEqual(
    (await post(conversationURL + "/messages", turn.request().postDataJSON()))
      .messages,
    snapshot.messages,
  );
  const written = await current();
  assert.deepEqual(
    await post(conversationURL + "/apply", writeback.request().postDataJSON()),
    { ...written, applied_node: "text" },
  );
  assert.equal((await current()).revision, written.revision);
  await request(conversationURL, { client: member.request, status: 403 });
  await request(conversationURL + "/events", {
    client: member.request,
    space: String(foreign.workspace),
    status: 404,
  });
  await page.reload();
  await expect(node("text").getByText(reply, { exact: true })).toBeVisible();
  await request("/api/logout", { method: "POST" });
  await page.reload();
  await expect(page).toHaveURL(origin + "/studio", { timeout });
  await request(path, { status: 401 });
  assert.ok(
    requests.some(
      (url) => url.startsWith("/_next/static/") && url.endsWith(".js"),
    ),
  );
  assert.deepEqual(
    requests.filter((url) =>
      /^\/static\/(?:canvas|chat|flowpicker)\.js$/.test(url),
    ),
    [],
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS React editor → Next → Nest → PostgreSQL/BullMQ: historical import, assets, generation, candidates, narration, export, SSE writeback, workspace access, idempotency and credit settlement",
  );
}

try {
  await verify();
} catch (error) {
  throw new Error(
    "Nest canvas browser verification failed: " +
      step +
      (errors.length ? "\n" + errors.join("\n") : ""),
    { cause: error },
  );
} finally {
  await browser?.close();
  if (web && web.exitCode === null && web.signalCode === null && web.pid) {
    const exited = once(web, "exit");
    web.kill("SIGTERM");
    await exited;
  }
  await Promise.all([app?.close(), advanced?.close()]);
  await Promise.all([
    generationWorker?.close(),
    chatQueue?.close(),
    storyboardQueue?.close(),
  ]);
  await generationQueue?.close();
  if (generationQueue) {
    const queues = [
      new Queue("generation", { connection, prefix: namespace }),
      new Queue(chatQueueName, { connection }),
      new Queue(exportQueueName, { connection }),
    ];
    await Promise.all(
      queues.map(async (queue) => {
        try {
          await queue.obliterate({ force: true });
        } finally {
          await queue.close();
        }
      }),
    );
  }
  await chatProvider?.cleanup();
  await f.cleanup();
}
