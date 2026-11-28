/** Exercise Studio with disposable services and loopback providers. */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { connect, createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Queue } from "bullmq";
import sharp from "sharp";
import { OriginalIdentity } from "@fumiao/original-api/identity.js";
import { StudioCatalog } from "@fumiao/platform/catalog.js";
import { one } from "@fumiao/platform/db.js";
import type { Actor, Platform } from "@fumiao/platform/platform.js";
import { runtime } from "@fumiao/platform/runtime.js";
import { chatStreaming } from "@fumiao/plugin-chat/stream.js";
import { flowText } from "@fumiao/plugin-flow/text.js";
import { gpuText } from "@fumiao/plugin-gpu/text.js";
import { imagesText } from "@fumiao/plugin-images/text.js";
import { museText } from "@fumiao/plugin-muse/text.js";
import { chatProviderFixture } from "../helpers/chat-provider.js";
import { prepareModelAccess } from "./studio-model-access.js";
import { modelProviderFixture, type ModelProvider } from "./studio-model-access-provider.js";
import { studioBrowser } from "./studio-nest-browser.js";
import { verifyStudioHTTPS } from "./studio-nest-https.js";
import { studioPayment } from "./studio-nest-payment.js";
import {
  backupStudioObjects,
  restoreStudioObjects,
  restoreSnapshot,
  prepareStudioRestore,
} from "./studio-nest-restore.js";
import { mediaProviderFixture } from "./studio-nest-restore-media.js";
import { auditRoutes } from "./studio-nest-routes.js";
import { verifyDirectorDesk } from "./studio-director-desk.js";
import { verifyRemoteProvider } from "./studio-remote-provider.js";
import { verifyStudioReplicas } from "./studio-nest-replicas.js";

const host = "127.0.0.1";
const restoring = process.argv.includes("--restore");
const https = process.argv.includes("--https");
const directorDesk = process.argv.includes("--director-desk");
const remoteProvider = process.argv.includes("--remote-provider");
const replicas = process.argv.includes("--replicas");
const useS3 = restoring || replicas || process.argv.includes("--s3");
const nextDist = process.env.FUMIAO_NEXT_DIST || ".next";
await access(resolve("apps/web", nextDist, "BUILD_ID")).catch(() => {
  throw new Error("Build the Next production app first with pnpm build");
});

const directory = await mkdtemp(join(tmpdir(), "fumiao-nest-studio-"));
const previewRuntime = join(directory, "preview");
const children: ChildProcess[] = [];
const user = {
  name: "studio-audit",
  nickname: "本机验收",
  password: randomBytes(18).toString("base64url"),
};
const media = join(directory, "objects");
const node = process.execPath;
const typescript = ["--import", "tsx"];
const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, TMPDIR: directory };
const shutdown = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => shutdown.abort());
let modelProvider: ModelProvider | undefined;
let logs = "";
let p: Platform | undefined;
let provider: Awaited<ReturnType<typeof chatProviderFixture>> | undefined;
let browser: Awaited<ReturnType<typeof studioBrowser>> | undefined;
let payment: Awaited<ReturnType<typeof studioPayment>> | undefined;
let mediaProvider: Awaited<ReturnType<typeof mediaProviderFixture>> | undefined;

function launch(command: string, args: string[], childEnv = env, cwd?: string) {
  shutdown.signal.throwIfAborted();
  const child = spawn(command, args, {
    env: childEnv,
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (data) => (logs = (logs + data).slice(-8000)));
  child.on("error", (error) => (logs += "\n" + error.message));
  return child;
}

async function run(command: string, args: string[], childEnv = env) {
  const [code] = await once(launch(command, args, childEnv), "exit");
  assert.equal(code, 0, `${command} exited with ${code}`);
}

async function refused(
  args: string[],
  childEnv: NodeJS.ProcessEnv,
  reason: RegExp,
) {
  const child = launch(node, [...typescript, ...args], childEnv);
  let output = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => (output += chunk.toString()));
  const [code] = await once(child, "exit");
  assert.equal(code, 1, output);
  assert.match(output, reason);
}

async function stop(child: ChildProcess) {
  if (
    child.exitCode !== null ||
    child.signalCode !== null ||
    child.pid === undefined
  )
    return;
  const closed = once(child, "exit");
  const timer = setTimeout(() => child.kill("SIGKILL"), 7000);
  try {
    child.kill("SIGTERM");
    await closed;
  } finally {
    clearTimeout(timer);
  }
}

async function freePorts(count: number) {
  const servers = Array.from({ length: count }, () =>
    createServer().listen(0, host),
  );
  try {
    await Promise.all(servers.map((server) => once(server, "listening")));
    return servers.map((server) => (server.address() as AddressInfo).port);
  } finally {
    await Promise.all(
      servers.map(
        (server) => new Promise<void>((done) => server.close(() => done())),
      ),
    );
  }
}

async function eventually(
  label: string,
  probe: () => Promise<boolean>,
  child?: ChildProcess,
) {
  for (let attempt = 0; attempt < 100; attempt++) {
    shutdown.signal.throwIfAborted();
    if (
      child &&
      (child.exitCode !== null || child.signalCode !== null || !child.pid)
    )
      break;
    if (await probe().catch(() => false)) return;
    await delay(150);
  }
  throw new Error(label + " did not become ready");
}

async function listenReady(port: number) {
  const socket = connect(port, host);
  socket.setTimeout(500, () => socket.destroy(new Error("Connection timeout")));
  try {
    await once(socket, "connect");
    return true;
  } finally {
    socket.destroy();
  }
}

async function startSeaweed(ports: number[], cwd: string) {
  const [master, masterGrpc, volume, volumeGrpc, filer, filerGrpc, s3, s3Grpc] =
    ports;
  const bucket = "studio-" + randomUUID();
  const probeBucket = bucket + "-probe";
  const endpoint = `http://${host}:${s3}`;
  const region = "us-east-1";
  const credentials = {
    accessKeyId: randomBytes(10).toString("hex"),
    secretAccessKey: randomBytes(20).toString("hex"),
  };
  await mkdir(cwd, { mode: 0o700 });
  // Local files take precedence over host SeaweedFS configuration.
  for (const name of ["master", "volume", "security", "notification"])
    await writeFile(join(cwd, `${name}.toml`), "# Isolated test defaults\n");
  await writeFile(
    join(cwd, "filer.toml"),
    '[leveldb2]\nenabled = true\ndir = "./filerldb2"\n',
  );
  await writeFile(
    join(cwd, "s3.json"),
    JSON.stringify({
      identities: [
        {
          name: "studio",
          credentials: [
            {
              accessKey: credentials.accessKeyId,
              secretKey: credentials.secretAccessKey,
            },
          ],
          actions: ["Admin", "Read", "List", "Write"],
        },
      ],
    }),
    { mode: 0o600 },
  );
  const weed = process.env.STUDIO_WEED || "weed";
  const args = [
    "server",
    "-dir=.",
    `-ip=${host}`,
    `-ip.bind=${host}`,
    "-master.telemetry=false",
    "-master.volumeSizeLimitMB=128",
    "-volume.preStopSeconds=1",
    `-master.port=${master}`,
    `-master.port.grpc=${masterGrpc}`,
    `-volume.port=${volume}`,
    `-volume.port.grpc=${volumeGrpc}`,
    `-filer.port=${filer}`,
    `-filer.port.grpc=${filerGrpc}`,
    "-filer.localSocket=filer.sock",
    "-s3",
    "-s3.config=s3.json",
    "-s3.localSocket=s3.sock",
    "-s3.iam=false",
    "-s3.port.iceberg=0",
    "-s3.port.lance=0",
    `-s3.port=${s3}`,
    `-s3.port.grpc=${s3Grpc}`,
  ];
  const weedEnv = { ...env, HOME: cwd };
  const s3Env = {
    S3_BUCKET: bucket,
    S3_ENDPOINT: endpoint,
    S3_REGION: region,
    S3_PATH_STYLE: "true",
    STUDIO_MEDIA_ORIGIN: endpoint,
    AWS_ACCESS_KEY_ID: credentials.accessKeyId,
    AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
    AWS_CONFIG_FILE: join(cwd, "aws-config"),
    AWS_SHARED_CREDENTIALS_FILE: join(cwd, "aws-credentials"),
    AWS_EC2_METADATA_DISABLED: "true",
  };
  const openClient = () =>
    new S3Client({
      endpoint,
      region,
      credentials,
      forcePathStyle: true,
      maxAttempts: 1,
    });
  async function start(create: boolean) {
    const child = launch(
      weed.includes("/") ? resolve(weed) : weed,
      args,
      weedEnv,
      cwd,
    );
    try {
      await once(child, "spawn");
    } catch (cause) {
      throw new Error("Set STUDIO_WEED to a runnable SeaweedFS binary", {
        cause,
      });
    }
    const client = openClient();
    try {
      await eventually(
        "authenticated SeaweedFS S3 endpoint",
        async () => {
          const result = await client.send(new ListBucketsCommand({}), {
            abortSignal: AbortSignal.timeout(1000),
          });
          return (
            create ||
            result.Buckets?.some(({ Name }) => Name === bucket) === true
          );
        },
        child,
      );
      if (create)
        for (const name of [probeBucket, bucket])
          await client.send(new CreateBucketCommand({ Bucket: name }), {
            abortSignal: AbortSignal.timeout(5000),
          });
      // A timed-out S3 write can finish later. Keep readiness writes off the data bucket.
      const probe = { Bucket: probeBucket, Key: "readiness" };
      await eventually(
        "SeaweedFS writable private bucket",
        async () => {
          await client.send(new PutObjectCommand({ ...probe, Body: "ready" }), {
            abortSignal: AbortSignal.timeout(2000),
          });
          await client.send(new DeleteObjectCommand(probe), {
            abortSignal: AbortSignal.timeout(2000),
          });
          return true;
        },
        child,
      );
      return child;
    } finally {
      client.destroy();
    }
  }
  let child = await start(true);
  return {
    get child() {
      return child;
    },
    env: s3Env,
    endpoint,
    bucket,
    openClient,
    async restart() {
      await stop(child);
      child = await start(false);
      console.log("Restarted SeaweedFS with the existing private bucket");
    },
    async objects() {
      const client = openClient();
      try {
        const result = await client.send(
          new ListObjectsV2Command({ Bucket: bucket }),
          { abortSignal: AbortSignal.timeout(5000) },
        );
        assert.ok(!result.IsTruncated);
        return result.Contents ?? [];
      } finally {
        client.destroy();
      }
    },
  };
}

async function seed(platform: Platform) {
  const {
    rows: [admin],
  } = await platform.db.query<Actor>(
    "SELECT id,name,nickname,role FROM users WHERE name=$1",
    [user.name],
  );
  const workspace = await one(
    platform.db,
    "SELECT w.id FROM workspaces w JOIN users u ON u.default_workspace=w.id WHERE u.id=$1",
    [admin.id],
  );
  const catalog = new StudioCatalog(platform.db);
  await platform.db.transaction(async (sql) => {
    for (const plugin of [
      gpuText,
      museText,
      flowText,
      imagesText,
      chatStreaming,
    ])
      await catalog.activate(sql, plugin.manifest);
    await platform.credit(
      sql,
      workspace.id,
      100,
      "studio-audit-credit",
      "adjust",
    );
  });
  provider = await chatProviderFixture();
  provider.setWire("stream", {
    raw: [
      'data: {"choices":[{"delta":{"content":"隔离验收回复"}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"total_tokens":20}}',
      "data: [DONE]",
      "",
    ].join("\n\n"),
    chunks: [19, 47],
  });
  const connection = await platform.createConnection(admin, {
    name: "Loopback chat fixture",
    pluginId: chatStreaming.manifest.id,
    version: chatStreaming.manifest.version,
    config: provider.config(),
  });
  await platform.updateConnection(admin, connection.id, {
    revision: 1,
    enabled: true,
    concurrency: 1,
  });
}

async function verifyStudio(
  platform: Platform,
  web: string,
  s3?: { endpoint: string; bucket: string },
) {
  let cookie = "";
  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const binary = body instanceof Uint8Array;
    const response = await fetch(web + path, {
      method,
      redirect: "manual",
      headers: {
        origin: web,
        cookie,
        ...(body !== undefined
          ? { "content-type": binary ? "image/png" : "application/json" }
          : {}),
        ...headers,
      },
      body: binary
        ? new Uint8Array(body)
        : body === undefined
          ? undefined
          : JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
    assert.equal(response.headers.get("x-fumiao-web"), "next", path);
    return response;
  }
  async function json(response: Response, status = 200) {
    const data = await response.json();
    assert.equal(
      response.status,
      status,
      response.url + " " + JSON.stringify(data).slice(0, 500),
    );
    return data;
  }

  const login = await request("/api/login", "POST", user);
  assert.deepEqual(await json(login), { ok: true });
  cookie = login.headers.get("set-cookie")!.split(";")[0];
  const state = await json(await request("/api/state"));
  assert.equal(state.me.name, user.name);
  assert.ok(Number.isSafeInteger(state.me.id) && state.me.id > 0);
  assert.ok(Number.isSafeInteger(state.workspace_id) && state.workspace_id > 0);
  const studio = await fetch(web + "/studio", { headers: { cookie } });
  assert.equal(studio.status, 200);
  const studioHTML = await studio.text();
  assert.match(studioHTML, /src="\/_next\/static\//);
  assert.doesNotMatch(
    studioHTML,
    /src="\/static\/(studio|theme|flowpicker|chat)\.js/,
  );
  const canvas = await json(
    await request("/api/canvases", "POST", { title: "隔离画布" }),
  );
  assert.match(canvas.id, /^[\da-f]{32}$/);

  const png = await sharp({
    create: { width: 24, height: 24, channels: 3, background: "#84aabe" },
  })
    .png()
    .toBuffer();
  const asset = await json(await request("/api/assets", "POST", png));
  assert.match(asset.id, /^[\da-f]{32}$/);
  const path = "/media/" + asset.id;
  const invite = await json(
    await request("/api/invite-codes", "POST", {
      name: "Isolated acceptance member",
      expires: null,
      grant_credits: false,
      initial_credits: 0,
      team_id: null,
    }),
  );
  const registered = await request(
    "/api/register",
    "POST",
    {
      name: "studio-member",
      nickname: "隔离成员",
      password: randomBytes(18).toString("base64url"),
      code: invite.code,
    },
    { cookie: "" },
  );
  const memberCookie = registered.headers.get("set-cookie")?.split(";")[0];
  await json(registered);
  assert.ok(memberCookie);
  const foreignWorkspace = {
    cookie: memberCookie,
    "X-Workspace-Id": String(state.workspace_id),
  };
  const member = await json(
    await request("/api/state", "GET", undefined, { cookie: memberCookie }),
  );
  assert.notEqual(member.workspace_id, state.workspace_id);
  await json(
    await request("/api/state", "GET", undefined, foreignWorkspace),
    403,
  );
  for (const key of [path, "/api/canvases/" + canvas.id]) {
    const denied = await request(key, "GET", undefined, {
      cookie: memberCookie,
    });
    assert.equal(denied.headers.get("location"), null);
    await json(denied, 404);
  }
  async function verifyMedia(platform: Platform) {
    const { object_key: key } = await one(
      platform.db,
      "SELECT object_key FROM assets WHERE public_id=$1",
      [asset.id],
    );
    assert.deepEqual(Buffer.from(await platform.storage.read(key)), png);
    const anonymous = await request(path, "GET", undefined, { cookie: "" });
    assert.equal(anonymous.headers.get("location"), null);
    await json(anonymous, 401);

    const preview = { "sec-fetch-dest": "image" };
    const first = await request(path, "GET", undefined, preview);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("cache-control"), "private, no-cache");
    assert.deepEqual(Buffer.from(await first.bytes()), png);
    const etag = first.headers.get("etag");
    assert.ok(etag);
    const conditional = { ...preview, "if-none-match": etag };
    const cached = await request(path, "GET", undefined, conditional);
    assert.equal(cached.status, 304);
    assert.equal(cached.headers.get("cache-control"), "private, no-cache");
    assert.equal(cached.headers.get("etag"), etag);
    assert.equal((await cached.bytes()).length, 0);
    const partial = await request(path, "GET", undefined, {
      ...preview,
      "if-none-match": '"older-version"',
      "if-modified-since": first.headers.get("last-modified")!,
      range: "bytes=2-5",
    });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get("content-range"), `bytes 2-5/${png.length}`);
    assert.deepEqual(Buffer.from(await partial.bytes()), png.subarray(2, 6));
    assert.ok(memberCookie);
    for (const [session, status] of [
      ["", 401],
      [memberCookie, 404],
    ] as const) {
      const denied = await request(path, "GET", undefined, {
        ...conditional,
        cookie: session,
      });
      assert.equal(denied.status, status);
      assert.equal(denied.headers.get("cache-control"), "private, no-store");
      await denied.body?.cancel();
    }
    const headers = { range: "bytes=0-7" };
    let range = await request(path, "GET", undefined, headers);
    if (s3) {
      assert.equal(
        range.status,
        307,
        "Expected a signed S3 redirect through Next",
      );
      await range.body?.cancel();
      const location = range.headers.get("location");
      assert.ok(location, "Missing signed media location");
      const signed = new URL(location);
      assert.equal(signed.origin, s3.endpoint);
      assert.equal(signed.pathname, `/${s3.bucket}/${key}`);
      assert.equal(
        signed.searchParams.get("X-Amz-Algorithm"),
        "AWS4-HMAC-SHA256",
      );
      assert.match(
        signed.searchParams.get("X-Amz-Signature") ?? "",
        /^[\da-f]{64}$/,
      );
      const options = {
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      } as const;
      const unsigned = await fetch(
        new URL(signed.pathname, s3.endpoint),
        options,
      );
      assert.equal(
        unsigned.status,
        403,
        "The S3 object must reject anonymous reads",
      );
      await unsigned.body?.cancel();
      range = await fetch(signed, { ...options, headers });
    } else {
      assert.equal((await stat(join(media, key))).mode & 0o777, 0o600);
    }
    assert.equal(range.status, 206);
    assert.equal(range.headers.get("content-range"), `bytes 0-7/${png.length}`);
    assert.deepEqual(Buffer.from(await range.bytes()), png.subarray(0, 8));
    return key;
  }
  const objectKey = await verifyMedia(platform);

  const { conversation } = await json(await request("/api/chats", "POST", {}));
  const conversationPath = "/api/chats/" + conversation.id;
  const chat = await json(await request("/api/chat/config"));
  const balance = (await json(await request("/api/credits"))).wallet.balance;
  const draft = {
    uid: randomUUID(),
    model: "deepseek-flash",
    text: "仅使用本地模拟服务",
    expected_revision: conversation.revision,
    price_revision: chat.pricing.revision,
  };
  const accepted = await json(
    await request(conversationPath + "/messages", "POST", draft),
  );
  const assistant = accepted.messages.at(-1);
  assert.equal(assistant.state, "running");
  const events = await request(conversationPath + "/events");
  assert.equal(events.status, 200);
  assert.match(events.headers.get("content-type")!, /^text\/event-stream/);
  const reader = events.body!.pipeThrough(new TextDecoderStream()).getReader();
  try {
    let frames = "";
    while (!frames.includes("隔离验收回复")) {
      const chunk = await reader.read();
      assert.ok(!chunk.done, "SSE ended before the local reply");
      frames += chunk.value;
    }
  } finally {
    await reader.cancel();
  }
  await eventually("settled BullMQ chat", async () => {
    const current = await json(await request(conversationPath));
    return (
      current.messages.at(-1).state === "complete" &&
      current.messages.at(-1).content === "隔离验收回复"
    );
  });
  const credits = async () => json(await request("/api/credits"));
  const replies = () =>
    provider!.requests.filter((item) => item.body?.stream).length;
  const after = await credits();
  assert.equal(after.wallet.reserved, 0);
  assert.ok(after.wallet.balance < balance);
  const ledgerActions = after.history
    .filter(
      (entry: { chat_turn: string }) => entry.chat_turn === assistant.turn,
    )
    .map((entry: { action: string }) => entry.action);
  assert.deepEqual(ledgerActions, ["spend", "reserve"]);
  async function verifyPluginVersion(platform: Platform) {
    assert.deepEqual(
      await one(
        platform.db,
        "SELECT plugin_id, plugin_version FROM chat_turns WHERE uid=$1",
        [draft.uid],
      ),
      {
        plugin_id: chatStreaming.manifest.id,
        plugin_version: chatStreaming.manifest.version,
      },
    );
  }
  await verifyPluginVersion(platform);
  await json(await request(conversationPath + "/messages", "POST", draft));
  assert.equal(replies(), 1);
  assert.deepEqual(await credits(), after);
  console.log(
    `Verified Studio login, state, canvas creation, ${s3 ? "private S3 upload, anonymous rejection and signed Range" : "private disk upload and Range"}, BullMQ chat SSE and one settlement`,
  );
  // The browser exercises another job and conversation against this workspace.
  const checkpoint = async () => ({
    canvases: await json(await request("/api/canvases")),
    credits: await credits(),
    providerReplies: replies(),
  });
  return {
    checkpoint,
    async verifyRestarted(
      platform: Platform,
      before: Awaited<ReturnType<typeof checkpoint>>,
    ) {
      const restored = await json(await request("/api/state"));
      assert.equal(restored.me.id, state.me.id);
      assert.equal(restored.workspace_id, state.workspace_id);
      assert.deepEqual(
        await json(await request("/api/canvases")),
        before.canvases,
      );
      assert.equal(await verifyMedia(platform), objectKey);
      await verifyPluginVersion(platform);
      const conversation = await json(await request(conversationPath));
      assert.equal(conversation.messages.at(-1).state, "complete");
      assert.equal(conversation.messages.at(-1).content, "隔离验收回复");
      assert.deepEqual(await credits(), before.credits);
      await json(await request(conversationPath + "/messages", "POST", draft));
      assert.equal(replies(), before.providerReplies);
      assert.deepEqual(await credits(), before.credits);
      await json(await request("/api/logout", "POST", {}));
      await json(await request("/api/workspaces"), 401);
    },
  };
}

const pgCommand = (name: string) =>
  process.env.PG_BINDIR ? join(process.env.PG_BINDIR, name) : name;

async function startData(
  [dbPort, redisPort, ...s3Ports]: number[],
  dataDirectory: string,
  dbUser: string,
  encryptionKey: string,
) {
  await mkdir(dataDirectory, { mode: 0o700 });
  const s3 = useS3
    ? await startSeaweed(s3Ports, join(dataDirectory, "seaweed"))
    : undefined;
  if (!s3) await mkdir(media, { mode: 0o700 });
  const postgresDirectory = join(dataDirectory, "postgres");
  const password = randomBytes(18).toString("hex");
  const passwordFile = join(dataDirectory, "db-password");
  const redisPassword = randomBytes(18).toString("hex") + "@:";
  const redisAcl = join(dataDirectory, "redis.acl");
  const redisDb = 3;
  await writeFile(redisAcl, `user default on >${redisPassword} ~* &* +@all\n`, {
    mode: 0o600,
  });
  await writeFile(passwordFile, password + "\n", { mode: 0o600 });
  await run(pgCommand("initdb"), [
    "-D",
    postgresDirectory,
    "--username=" + dbUser,
    "--auth=scram-sha-256",
    "--pwfile=" + passwordFile,
    "--no-locale",
    "--encoding=UTF8",
  ]);
  await rm(passwordFile);
  const startPostgres = () =>
    launch(pgCommand("postgres"), [
      "-D",
      postgresDirectory,
      "-h",
      host,
      "-p",
      String(dbPort),
      "-k",
      // A short socket path also works on macOS, where sockaddr is 104 bytes.
      directory,
    ]);
  const startRedis = () =>
    launch(process.env.REDIS_SERVER || "redis-server", [
      "--bind",
      host,
      "--port",
      String(redisPort),
      "--save",
      "",
      "--appendonly",
      "yes",
      "--maxmemory-policy",
      "noeviction",
      "--aclfile",
      redisAcl,
      "--dir",
      dataDirectory,
    ]);
  const postgres = startPostgres();
  const redis = startRedis();
  const profileEnv = {
    DATABASE_URL: `postgresql://${dbUser}:${password}@${host}:${dbPort}/postgres`,
    REDIS_URL: `redis://default:${encodeURIComponent(redisPassword)}@${host}:${redisPort}/${redisDb}`,
    ENCRYPTION_KEY: encryptionKey,
    ...(s3 ? s3.env : { MEDIA_DIRECTORY: media }),
  };
  await Promise.all([
    eventually("PostgreSQL", () => listenReady(dbPort), postgres),
    eventually("Redis", () => listenReady(redisPort), redis),
  ]);
  return {
    s3,
    postgres,
    redis,
    startPostgres,
    startRedis,
    profileEnv,
    redisPassword,
    redisDb,
  };
}

async function writeProfile(
  path: string,
  configuration: Record<string, string>,
) {
  await writeFile(
    path,
    Object.entries(configuration)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}\n`)
      .join(""),
    { mode: 0o600 },
  );
}

async function start() {
  // Bind fresh services to loopback and ignore shell application settings.
  const [dbPort, redisPort, apiPort, webPort, ...extraPorts] = await freePorts(
    (useS3 ? 12 : 4) + (replicas ? 2 : 0),
  );
  const s3Ports = extraPorts.slice(0, 8);
  for (const key of Object.keys(process.env))
    if (/^(AWS|S3)_/.test(key)) delete process.env[key];
  const apiOrigin = `http://${host}:${apiPort}`;
  const webOrigin = `http://${host}:${webPort}`;
  const data = await startData(
    [dbPort, redisPort, ...s3Ports],
    join(directory, "source"),
    "studio",
    randomBytes(32).toString("base64"),
  );
  const { s3, startPostgres, startRedis, profileEnv, redisPassword, redisDb } =
    data;
  let { postgres, redis } = data;
  // The test-only database connection uses the same isolated settings.
  Object.assign(env, profileEnv, {
    API_HOST: host,
    PORT: String(apiPort),
    PUBLIC_URL: webOrigin,
  });
  Object.assign(process.env, env);
  const profile = join(directory, "studio.env");
  await writeProfile(profile, {
    ...profileEnv,
    ...(https ? { PUBLIC_URL: webOrigin } : {}),
  });
  if (
    !https &&
    !remoteProvider &&
    !directorDesk &&
    !replicas &&
    !process.argv.includes("--serve")
  )
    payment = await studioPayment(directory, webOrigin);
  const previewEnv = {
    PATH: env.PATH,
    TMPDIR: directory,
    STUDIO_PORT: String(webPort),
    LEGACY_API_PORT: String(apiPort),
    ...(https ? {} : { STUDIO_PUBLIC_URL: webOrigin }),
    STUDIO_RUNTIME_DIRECTORY: previewRuntime,
    FUMIAO_NEXT_DIST: nextDist,
  };
  const production = ["scripts/dev-studio.ts", "--production"];
  if (!https && !remoteProvider && !replicas && !process.argv.includes("--serve"))
    modelProvider = await modelProviderFixture();
  const nestEnv = {
    ...previewEnv,
    STUDIO_ENV_FILE: profile,
    ...(modelProvider ? {
      STUDIO_MODEL_FIXTURE: modelProvider.url,
      NODE_OPTIONS: "--import=" + new URL("./studio-model-access-transport.ts", import.meta.url).href,
    } : {}),
    ...(payment ? { NODE_EXTRA_CA_CERTS: payment.certificate } : {}),
    ...(replicas ? { WORKER_CONCURRENCY: "1" } : {}),
  };
  async function startPreview(configuration = nestEnv) {
    const processFile = join(
      configuration.STUDIO_RUNTIME_DIRECTORY,
      "studio-processes.json",
    );
    await rm(processFile, { force: true });
    const preview = launch(node, [...typescript, ...production], configuration);
    await eventually(
      "Studio supervisor",
      async () => (await stat(processFile)).isFile(),
      preview,
    );
    const processes = JSON.parse(await readFile(processFile, "utf8"));
    assert.equal(processes.supervisor, preview.pid);
    assert.equal(processes.backend, "nest");
    assert.equal(typeof processes.worker, "number");
    return preview;
  }
  const restartStorage = async () => {
    await p?.db.close();
    p = undefined;
    await stop(postgres);
    await stop(redis);
    postgres = startPostgres();
    redis = startRedis();
    await Promise.all([
      eventually("restarted PostgreSQL", () => listenReady(dbPort), postgres),
      eventually("restarted Redis", () => listenReady(redisPort), redis),
      s3?.restart(),
    ]);
    p = runtime();
  };
  const missing = join(directory, "missing-config.env");
  await writeFile(missing, "", { mode: 0o600 });
  await refused(
    production,
    { ...previewEnv, STUDIO_ENV_FILE: missing },
    /Studio configuration is missing DATABASE_URL, REDIS_URL, ENCRYPTION_KEY/,
  );
  await refused(
    production,
    nestEnv,
    /Studio has no active administrator/,
  );
  assert.equal(await listenReady(webPort).catch(() => false), false);
  await assert.rejects(access(join(previewRuntime, "original")));
  p = runtime();
  assert.equal(
    (await one(p.db, "SELECT count(*)::int AS count FROM users")).count,
    0,
  );
  assert.equal(
    (await one(p.db, "SELECT count(*)::int AS count FROM connections")).count,
    0,
  );
  // The existing workflow fixtures use built-in models. Plugin installation starts empty.
  if (!remoteProvider) await p.registry.installBuiltins(p.db, true);
  await run(node, [...typescript, "scripts/bootstrap.ts"], {
    ...env,
    ADMIN_NAME: user.name,
    ADMIN_NICKNAME: user.nickname,
    ADMIN_PASSWORD: user.password,
  });
  const [unusedRedis] = await freePorts(1);
  await refused(
    production,
    { ...nestEnv, REDIS_URL: `redis://${host}:${unusedRedis}` },
    /Studio could not reach BullMQ Redis/,
  );
  assert.equal(await listenReady(webPort).catch(() => false), false);
  await assert.rejects(access(join(previewRuntime, "original")));
  let preview = await startPreview();
  if (replicas) {
    assert.ok(s3);
    const [secondApi, secondWeb] = extraPorts.slice(8);
    const secondOrigin = `http://${host}:${secondWeb}`;
    const secondRuntime = join(directory, "preview-replica");
    await startPreview({
      ...nestEnv,
      STUDIO_PORT: String(secondWeb),
      LEGACY_API_PORT: String(secondApi),
      STUDIO_PUBLIC_URL: secondOrigin,
      STUDIO_RUNTIME_DIRECTORY: secondRuntime,
    });
    const pair = async (runtimeDirectory: string, api: string, web: string) => ({
      api,
      web,
      processes: JSON.parse(
        await readFile(join(runtimeDirectory, "studio-processes.json"), "utf8"),
      ),
    });
    await verifyStudioReplicas(
      p,
      [
        await pair(previewRuntime, apiOrigin, webOrigin),
        await pair(secondRuntime, `http://${host}:${secondApi}`, secondOrigin),
      ],
      user,
      profileEnv.REDIS_URL,
      s3,
    );
    return;
  }
  if (directorDesk) {
    await verifyDirectorDesk(p, webOrigin, user);
    return;
  }
  if (remoteProvider) {
    await verifyRemoteProvider(
      p,
      webOrigin,
      user,
      directory,
      profileEnv.REDIS_URL,
    );
    return;
  }
  await seed(p);

  if (https) {
    assert.ok(provider);
    await verifyStudioHTTPS(
      directory,
      webOrigin,
      user,
      provider,
      async (origin) => {
        await stop(preview);
        await writeProfile(profile, { ...profileEnv, PUBLIC_URL: origin });
        preview = await startPreview();
      },
    );
    return;
  }

  if (restoring) {
    assert.ok(s3 && payment && provider && modelProvider);
    mediaProvider = await mediaProviderFixture();
    const processes = JSON.parse(
      await readFile(join(previewRuntime, "studio-processes.json"), "utf8"),
    );
    let workerPaused = false;
    const verify = await prepareStudioRestore(
      p,
      webOrigin,
      s3,
      user,
      payment,
      provider,
      mediaProvider,
      () => prepareModelAccess(p!, webOrigin, user, modelProvider!),
      () => {
        process.kill(processes.worker, "SIGSTOP");
        workerPaused = true;
      },
    ).finally(() => {
      if (workerPaused) process.kill(processes.worker, "SIGKILL");
    });
    // The interruption leaves the claimed jobs' leases intact. Stop remaining writers.
    await stop(preview);
    for (const port of [webPort, apiPort])
      assert.equal(await listenReady(port).catch(() => false), false);
    assert.throws(() => process.kill(processes.worker, 0), { code: "ESRCH" });
    const before = await restoreSnapshot(p);
    const backup = join(directory, "backup");
    await mkdir(backup, { mode: 0o700 });
    const archive = join(backup, "studio.dump");
    const keyFile = join(backup, "encryption-key");
    await writeFile(keyFile, profileEnv.ENCRYPTION_KEY, { mode: 0o600 });
    await run(pgCommand("pg_dump"), [
      "--no-password",
      "--format=custom",
      "--file=" + archive,
      "--dbname=" + profileEnv.DATABASE_URL,
    ]);
    const expectedBackupKeys = [
      ...(await p.db.query<{ object_key: string }>("SELECT object_key FROM assets")).rows,
      ...(
        await p.db.query<{ object_key: string }>(
          "SELECT object_key FROM asset_derivatives WHERE state='ready'",
        )
      ).rows,
    ]
      .map(({ object_key }) => object_key)
      .sort();
    const objectCount = await backupStudioObjects(s3, backup, expectedBackupKeys);
    await p.db.close();
    p = undefined;
    await Promise.all([stop(postgres), stop(redis), stop(s3.child)]);
    for (const port of [dbPort, redisPort, Number(new URL(s3.endpoint).port)])
      assert.equal(await listenReady(port).catch(() => false), false);

    const [targetDb, targetRedis, targetApi, targetWeb, ...targetS3] =
      await freePorts(12);
    const target = await startData(
      [targetDb, targetRedis, ...targetS3],
      join(directory, "target"),
      "restored_studio",
      await readFile(keyFile, "utf8"),
    );
    assert.ok(target.s3 && target.s3.bucket !== s3.bucket);
    assert.notEqual(target.s3.endpoint, s3.endpoint);
    assert.notEqual(target.s3.env.AWS_ACCESS_KEY_ID, s3.env.AWS_ACCESS_KEY_ID);
    const targetProfile = join(directory, "restored.env");
    await writeProfile(targetProfile, target.profileEnv);
    const queue = new Queue("fumiao-chat", {
      skipMetasUpdate: true,
      connection: {
        host,
        port: targetRedis,
        password: target.redisPassword,
        db: target.redisDb,
      },
    });
    try {
      assert.deepEqual(await (await queue.client).scan(0, {}), ["0", []]);
    } finally {
      await queue.close();
    }
    assert.deepEqual(await target.s3.objects(), []);
    await run(pgCommand("pg_restore"), [
      "--no-password",
      "--single-transaction",
      "--exit-on-error",
      "--no-owner",
      "--no-privileges",
      "--dbname=" + target.profileEnv.DATABASE_URL,
      archive,
    ]);
    await restoreStudioObjects(target.s3, backup);
    Object.assign(process.env, target.profileEnv);
    p = runtime();
    const after = await restoreSnapshot(p);
    assert.notEqual(after.cluster, before.cluster);
    assert.deepEqual(after.rows, before.rows);
    console.log(
      `Restored pg_dump and ${objectCount} private S3 objects into a fresh cluster and bucket. Wallets, ledger, orders, sessions, and application rows match before starting the worker.`,
    );

    const restoredWeb = `http://${host}:${targetWeb}`;
    mediaProvider.recover();
    modelProvider.release();
    preview = await startPreview({
      ...nestEnv,
      STUDIO_PORT: String(targetWeb),
      LEGACY_API_PORT: String(targetApi),
      STUDIO_PUBLIC_URL: restoredWeb,
      STUDIO_RUNTIME_DIRECTORY: join(directory, "restored-preview"),
      STUDIO_ENV_FILE: targetProfile,
    });
    await verify(p, restoredWeb, target.s3);
    await stop(preview);
    return;
  }

  // The focused invocation uses the same gateway, browser and worker as the default suite.
  const nativeRestart = async () => {
    assert.ok(p && modelProvider);
    const verify = await prepareModelAccess(p, webOrigin, user, modelProvider);
    await stop(preview);
    modelProvider.release();
    preview = await startPreview();
    await verify(p, webOrigin);
  };
  if (process.argv.includes("--model-access")) {
    await nativeRestart();
    return;
  }
  const verifyOutage = await auditRoutes(
    p,
    webOrigin,
    apiOrigin,
    process.argv.includes("--routes"),
  );
  for (const filename of ["install.sh", "agent.tgz", "agent.tgz.sha256"]) {
    const response = await fetch(webOrigin + "/connect/" + filename);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),
      await readFile(join("plugins/gpu/distribution", filename)));
  }
  const checks = await verifyStudio(p, webOrigin, s3);
  shutdown.signal.throwIfAborted();
  if (process.argv.includes("--serve")) {
    const services = {
      postgres,
      redis,
      preview,
      ...(s3 ? { seaweed: s3.child } : {}),
    };
    for (const [name, child] of Object.entries(services))
      assert.ok(
        child.pid && child.exitCode === null && child.signalCode === null,
        name + " exited",
      );
    console.log(
      `Isolated Studio ${webOrigin}/studio\nSynthetic login ${user.name} / ${user.password}`,
    );
    await Promise.race([
      once(shutdown.signal, "abort"),
      ...Object.entries(services).map(async ([name, child]) => {
        const [code] = await once(child, "exit");
        if (!shutdown.signal.aborted)
          throw new Error(`${name} exited with ${code}`);
      }),
    ]);
  } else {
    browser = await studioBrowser(p, webOrigin, user, payment!, s3?.endpoint);
    const before = await checks.checkpoint();
    await stop(preview);
    const firstQueueEvent = async () => {
      const queue = new Queue("fumiao-chat", {
        connection: {
          host,
          port: redisPort,
          password: redisPassword,
          db: redisDb,
        },
      });
      try {
        const streams = await (
          await queue.client
        ).xread([{ key: queue.toKey("events"), id: "0-0" }], { COUNT: 1 });
        return streams?.[0]?.[1]?.[0]?.[0];
      } finally {
        await queue.close();
      }
    };
    const eventBeforeRestart = await firstQueueEvent();
    assert.match(eventBeforeRestart, /^\d+-\d+$/);
    const plugins = async (platform: Platform) =>
      (
        await platform.db.query(
          "SELECT id,plugin_id,plugin_version FROM connections ORDER BY id",
        )
      ).rows;
    const activeConnections = await plugins(p);
    await restartStorage();
    preview = await startPreview();
    assert.deepEqual(await plugins(p), activeConnections);
    assert.equal(await firstQueueEvent(), eventBeforeRestart);
    await browser.verifyRestarted(p);
    await checks.verifyRestarted(p, before);
    await nativeRestart();
    await stop(preview);
    console.log(
      "Verified restart persistence of PostgreSQL, Redis, provider version, private media and settlement, and logout",
    );

    // Keep Next up independently to audit the gateway when Nest is stopped.
    const web = launch(
      node,
      [
        "node_modules/next/dist/bin/next",
        "start",
        "apps/web",
        "-p",
        String(webPort),
        "-H",
        host,
      ],
      {
        ...previewEnv,
        API_INTERNAL_URL: apiOrigin,
        FUMIAO_REPOSITORY_ROOT: process.cwd(),
        NEXT_TELEMETRY_DISABLED: "1",
      },
    );
    await eventually("Next outage gateway", () => listenReady(webPort), web);
    await verifyOutage();
    const unavailable = await fetch(webOrigin + "/studio");
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.headers.get("retry-after"), "5");
  }
}

try {
  await start();
} catch (error) {
  if (!shutdown.signal.aborted) {
    console.error(logs);
    throw error;
  }
} finally {
  try {
    await Promise.all([browser?.close(), p?.db.close()]);
  } finally {
    try {
      for (const child of children.reverse()) await stop(child);
      await provider?.cleanup();
      await mediaProvider?.close();
      await modelProvider?.close();
      await payment?.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
