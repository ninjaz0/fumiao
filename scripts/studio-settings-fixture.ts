import assert from "node:assert/strict";
import {
  execFile,
  execFileSync,
  spawn,
  type ChildProcess,
} from "node:child_process";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as httpsServer } from "node:https";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { Queue, QueueEvents, Worker } from "bullmq";
import { createOriginalApp } from "../apps/api/src/original.js";
import { StudioCatalog } from "../packages/platform/src/catalog.js";
import { Executor } from "../packages/platform/src/executor.js";
import {
  importLegacy,
  legacyId,
  type LegacyExport,
} from "../packages/platform/src/importer.js";
import { Payments } from "../packages/platform/src/payments.js";
import { chatStreaming } from "../plugins/chat/src/stream.js";
import { flowState } from "../plugins/flow/src/state.js";
import { flowText } from "../plugins/flow/src/text.js";
import { gpuState } from "../plugins/gpu/src/state.js";
import { gpuText } from "../plugins/gpu/src/text.js";
import { imagesState } from "../plugins/images/src/state.js";
import { imagesSettings } from "../plugins/images/src/settings.js";
import { museState } from "../plugins/muse/src/state.js";
import { museText } from "../plugins/muse/src/text.js";
import { databaseFixture } from "../tests/helpers/database.js";

export type Backend = {
  web: string;
  admin: string;
  member: string;
  memberPassword: string;
};

export async function fetchAs(
  web: string,
  cookie: string,
  path: string,
  options: {
    workspace?: number;
    body?: object;
    method?: string;
    origin?: string;
  } = {},
) {
  return fetch(web + path, {
    method: options.method || (options.body ? "POST" : "GET"),
    headers: {
      cookie,
      Origin: options.origin || web,
      ...(options.workspace
        ? { "X-Workspace-Id": String(options.workspace) }
        : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body && JSON.stringify(options.body),
    redirect: "manual",
  });
}

type State = {
  me: {
    id: number;
    name: string;
    nickname: string;
    avatar: string;
    avatar_url: string;
  };
  workspace_id: number;
  workspaces: { id: number; kind: string }[];
  credits: { available: number; reserved: number };
  credit_history: { id: number; note: string }[];
};
export async function json<T = State>(
  response: Response,
  status = 200,
): Promise<T> {
  const body = await response.text();
  assert.equal(response.status, status, body.slice(0, 300));
  return JSON.parse(body);
}

export async function settingsFixture({
  nodes = false,
  gpu = false,
  billing = false,
  services,
}: { nodes?: boolean; gpu?: boolean; billing?: boolean; services?: string } = {}) {
  const redis = billing ? new URL(process.env.TEST_REDIS_URL!) : undefined;
  if (services) {
    const url = new URL(services);
    assert.equal(url.origin, services);
    assert.equal(url.protocol, "http:");
    assert.equal(url.hostname, "127.0.0.1");
  }
  const runtime = await mkdtemp(join(tmpdir(), "fumiao-studio-settings-"));
  // Other local processes can push free space across a displayed 0.1 GB boundary.
  const serviceDiskFree = 123_456_789_012;
  const processes: ChildProcess[] = [];
  const defaultCAs = getCACertificates("default");
  let nest: Awaited<ReturnType<typeof createOriginalApp>> | undefined;
  let db: Awaited<ReturnType<typeof databaseFixture>> | undefined;
  let logs = "";
  let gateway = "";
  let gatewayRequests = 0;
  const providerRequests: unknown[] = [];
  const paid = new Map<string, string>();
  const plasma = new Map<string, { paid: boolean; amount: string }>();
  const config = {
    alipay: { gateway: "", pid: "314", key: randomBytes(24).toString("hex") },
    usdt_plasma: {
      gateway: "",
      pid: "159",
      key: randomBytes(24).toString("hex"),
    },
  };
  const python =
    process.env.STUDIO_PYTHON ||
    resolve(".runtime-advanced/original/.venv/bin/python");
  const serverKey = join(runtime, "key.pem");
  const serverCert = join(runtime, "cert.pem");
  let fake: ReturnType<typeof httpsServer> | undefined;
  let gatewayFailure: unknown;
  const address = (
    server: { address(): AddressInfo | string | null },
    protocol = "http",
  ) => protocol + "://127.0.0.1:" + (server.address() as AddressInfo).port;
  async function reserve() {
    const server = createServer().listen(0, "127.0.0.1");
    await once(server, "listening");
    const url = address(server);
    await new Promise<void>((done) => server.close(() => done()));
    return url;
  }
  function launch(command: string, args: string[], env: NodeJS.ProcessEnv) {
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    processes.push(child);
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (part) => {
        logs = (logs + part).slice(-10000);
      });
    child.on("error", (error) => {
      logs += error.message;
    });
    return child;
  }
  async function ready(url: string, process: ChildProcess) {
    for (let i = 0; i < 200 && process.exitCode === null; i++) {
      try {
        const response = await fetch(url + "/health", {
          signal: AbortSignal.timeout(500),
        });
        await response.body?.cancel();
        if (response.ok) return;
      } catch {}
      await delay(100);
    }
    throw new Error("Settings server did not start\n" + logs);
  }
  async function next(web: string, api: string) {
    const child = launch(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "start",
        "apps/web",
        "-H",
        "127.0.0.1",
        "-p",
        new URL(web).port,
      ],
      {
        ...process.env,
        STUDIO_MODE: "original",
        LEGACY_API_INTERNAL_URL: api,
        FUMIAO_REPOSITORY_ROOT: process.cwd(),
        NEXT_TELEMETRY_DISABLED: "1",
      },
    );
    await ready(web, child);
  }
  async function login(web: string, body: object) {
    const response = await fetchAs(web, "", "/api/login", { body });
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    await json(response);
    assert.ok(cookie?.startsWith("fm_session="));
    return cookie!;
  }
  async function cleanup() {
    await Promise.all(
      processes.map(async (child) => {
        if (child.exitCode !== null || child.signalCode !== null || !child.pid)
          return;
        const exited = once(child, "exit");
        child.kill("SIGTERM");
        await exited;
      }),
    );
    await nest?.close();
    await db?.cleanup();
    if (fake) {
      fake.closeAllConnections();
      await new Promise<void>((done) => fake!.close(() => done()));
    }
    setDefaultCACertificates(defaultCAs);
    await rm(runtime, { recursive: true, force: true });
  }
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=IP:127.0.0.1",
        "-out",
        serverCert,
        "-keyout",
        serverKey,
      ],
      { stdio: "ignore" },
    );
    setDefaultCACertificates([
      ...defaultCAs,
      await readFile(serverCert, "utf8"),
    ]);
    fake = httpsServer(
      { key: await readFile(serverKey), cert: await readFile(serverCert) },
      async (req, res) => {
        function send(value: object) {
          res
            .setHeader("Content-Type", "application/json")
            .end(JSON.stringify(value));
        }
        try {
          const url = new URL(req.url!, gateway);
          if (billing && url.pathname === "/v1/videos") {
            assert.equal(req.method, "POST");
            assert.equal(
              req.headers.authorization,
              "Bearer fixture-admin-billing",
            );
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk);
            providerRequests.push(JSON.parse(Buffer.concat(chunks).toString()));
            res.writeHead(422).end();
            return;
          }
          ++gatewayRequests;
          if (url.pathname === "/api.php") {
            const id = url.searchParams.get("out_trade_no")!;
            assert.equal(url.searchParams.get("pid"), config.alipay.pid);
            assert.equal(url.searchParams.get("key"), config.alipay.key);
            const amount = paid.get(id);
            send(
              amount
                ? {
                    code: 1,
                    status: 1,
                    pid: config.alipay.pid,
                    out_trade_no: id,
                    type: "alipay",
                    trade_no: "local_" + id,
                    money: amount,
                  }
                : { code: 1, status: 0 },
            );
          } else if (
            url.pathname === "/payments/gmpay/v1/order/create-transaction"
          ) {
            let body = "";
            for await (const chunk of req) body += chunk;
            const fields = new URLSearchParams(body);
            const id = fields.get("order_id")!;
            const amount = fields.get("amount")!;
            assert.equal(fields.get("network"), "plasma");
            assert.equal(fields.get("pid"), config.usdt_plasma.pid);
            if (amount === "3.00") {
              res.writeHead(502).end();
              return;
            }
            plasma.set(id, { amount, paid: false });
            send({
              status_code: 200,
              data: {
                order_id: id,
                amount,
                currency: "CNY",
                trade_id: "local_" + id,
                expiration_time: Date.now() + 1800000,
                payment_url: gateway + "/checkout/" + id,
              },
            });
          } else if (url.pathname.startsWith("/pay/check-status/local_")) {
            const trade = url.pathname.split("/").at(-1)!;
            const record = plasma.get(trade.slice("local_".length));
            assert.ok(record);
            send({
              status_code: 200,
              data: { trade_id: trade, status: record.paid ? 2 : 1 },
            });
          } else {
            assert.fail("Unexpected request to fake gateway " + url.pathname);
          }
        } catch (error) {
          gatewayFailure = error;
          res.writeHead(500).end();
        }
      },
    ).listen(0, "127.0.0.1");
    await once(fake, "listening");
    gateway = address(fake, "https");
    for (const method of Object.values(config)) method.gateway = gateway;
    const [api, web, nativeWeb] = await Promise.all([
      reserve(),
      reserve(),
      reserve(),
    ]);
    const data = join(runtime, "data");
    await mkdir(data);
    await writeFile(join(data, "payments.json"), JSON.stringify(config), {
      mode: 0o600,
    });
    if (billing)
      await writeFile(
        join(data, "muse.env"),
        [
          "FUMIAO_MUSE_URL=" + gateway,
          "FUMIAO_MUSE_PUBLIC_URL=" + gateway,
          "FUMIAO_MUSE_KEY=fixture-admin-billing",
        ].join("\n"),
        { mode: 0o600 },
      );
    const legacy = launch(
      python,
      [
        ...(services
          ? [
              "scripts/studio-services-python.py",
              services,
              String(serviceDiskFree),
            ]
          : ["scripts/preview-original.py"]),
        "--port",
        new URL(api).port,
        "--public-url",
        web,
        "--runtime-directory",
        runtime,
        "--no-reuse-local-credentials",
      ],
      {
        ...process.env,
        SSL_CERT_FILE: serverCert,
        NO_PROXY: "127.0.0.1,localhost",
        no_proxy: "127.0.0.1,localhost",
      },
    );
    await ready(api, legacy);
    await next(web, api);
    const adminCredentials = JSON.parse(
      await readFile(join(runtime, "credentials.json"), "utf8"),
    );
    const admin = await login(web, adminCredentials);
    const adminMember = billing
      ? (await json(await fetchAs(web, admin, "/api/state"))).me.id
      : undefined;
    const memberCredentials = {
      name: "settings-member",
      password: randomBytes(18).toString("hex"),
    };
    const team = (
      await json<{ id: number }>(
        await fetchAs(web, admin, "/api/workspaces", {
          body: {
            name: "设置对照团队",
            members: adminMember ? [adminMember] : [],
          },
        }),
      )
    ).id;
    const otherTeam = billing
      ? (
          await json<{ id: number }>(
            await fetchAs(web, admin, "/api/workspaces", {
              body: { name: "独立对照团队", members: [] },
            }),
          )
        ).id
      : undefined;
    const code = (
      await json<{ code: string }>(
        await fetchAs(web, admin, "/api/invite-codes", {
          body: { name: "设置对照成员", team_id: team },
        }),
      )
    ).code;
    const registered = await fetchAs(web, "", "/api/register", {
      body: { ...memberCredentials, nickname: "设置对照成员", code },
    });
    const member = registered.headers.get("set-cookie")!.split(";")[0];
    await json(registered);
    const adminState = await json(await fetchAs(web, admin, "/api/state"));
    const memberState = await json(await fetchAs(web, member, "/api/state"));
    const personal = memberState.workspaces.find(
      (space) => space.kind === "personal",
    )!.id;
    assert.notEqual(personal, team);
    const database = join(data, "studio.sqlite");
    const sqlite = new DatabaseSync(database);
    const merchant = createHash("sha256")
      .update(gateway + "|" + config.alipay.pid)
      .digest("hex");
    const order = sqlite.prepare(
      "INSERT INTO recharge_orders(id,uid,owner,workspace,method,merchant,amount,credits,state,created,expires) VALUES(?,?,?,?,'alipay',?,?,?,'expired',?,?)",
    );
    const orderId = (index: number) =>
      "FM" + (1700000000 + index) + index.toString(16).padStart(16, "0");
    const insertOrder = (
      index: number,
      owner: number,
      workspace: number,
      yuan: number,
    ) =>
      order.run(
        orderId(index),
        randomUUID(),
        owner,
        workspace,
        merchant,
        yuan * 100,
        yuan * 10,
        1700000000 + index,
        1700001800 + index,
      );
    try {
      const ledger = sqlite.prepare(
        "INSERT INTO credit_ledger(workspace,actor,action,amount,balance,reserved,note,created) VALUES(?,?,?,?,1234,0,?,?)",
      );
      sqlite
        .prepare("UPDATE credit_accounts SET balance=1234 WHERE workspace=?")
        .run(team);
      if (gpu)
        sqlite.exec("UPDATE credit_prices SET amount=1 WHERE amount IS NULL");
      if (billing) {
        const policyRow = sqlite
          .prepare("SELECT value FROM settings WHERE key='model_policy'")
          .get()!;
        const policy = JSON.parse(String(policyRow.value));
        const { model_groups } = await json<{
          model_groups: Record<string, { models: string[] }>;
        }>(await fetchAs(web, admin, "/api/state"));
        const group = Object.values(model_groups).find(
          ({ models }) => models.length > 1,
        )!;
        policy.enabled[group.models[0]] = false;
        sqlite
          .prepare("UPDATE settings SET value=? WHERE key='model_policy'")
          .run(JSON.stringify(policy));
        sqlite
          .prepare(
            "UPDATE credit_prices SET amount=NULL WHERE key='MiniMax H3|480|5'",
          )
          .run();
      }
      if (services)
        sqlite.exec(
          "UPDATE credit_prices SET amount=1 WHERE key='MiniMax H3|480|5'",
        );
      for (let i = 0; i < 55; i++)
        ledger.run(
          team,
          adminState.me.id,
          ["adjust", "spend", "reserve", "refund", "recharge"][i % 5],
          17,
          "合成明细 " + i,
          1700000000 + i,
        );
      for (let i = 0; i < 35; i++)
        insertOrder(i, memberState.me.id, team, i + 1);
      insertOrder(35, memberState.me.id, personal, 999);
      insertOrder(36, adminState.me.id, team, 998);
    } finally {
      sqlite.close();
    }
    const exported = join(runtime, "export.json");
    execFileSync(python, [
      "scripts/export-legacy.py",
      "--database",
      database,
      "--output",
      exported,
      "--source",
      "settings-fixture",
      "--include-registration-codes",
    ]);
    const snapshot: LegacyExport = JSON.parse(await readFile(exported, "utf8"));
    db = await databaseFixture();
    if (services) db.p.storage.availableBytes = async () => serviceDiskFree;
    await db.p.registry.installBuiltins(db.db);
    const catalog = new StudioCatalog(db.db);
    for (const plugin of [
      nodes || services ? gpuText : gpuState,
      billing ? museText : museState,
      nodes ? flowText : flowState,
      services ? imagesSettings : imagesState,
      chatStreaming,
    ])
      await db.db.transaction((sql) => catalog.activate(sql, plugin.manifest));
    // Activate compatible plugin versions before restoring the captured revisions.
    await importLegacy(db.p, snapshot, data);
    const payments = new Payments(db.p);
    const operator = {
      id: legacyId(snapshot.source, "user", adminState.me.id),
      name: adminCredentials.name,
      nickname: adminState.me.nickname,
      role: "admin",
    };
    const imageConfig = (key?: string) => ({
      baseUrl: `${services}/image/`,
      apiKey: key ?? "unconfigured",
    });
    const imageConnection = services
      ? await db.p.createConnection(operator, {
          name: "Loopback image settings",
          pluginId: imagesSettings.manifest.id,
          version: imagesSettings.manifest.version,
          config: imageConfig(),
        })
      : undefined;
    if (services) {
      for (const [provider, suffix] of [
        ["deepseek", ""],
        ["openai", "v1/"],
      ]) {
        const connection = await db.p.createConnection(operator, {
          name: "Loopback chat " + provider,
          pluginId: chatStreaming.manifest.id,
          version: chatStreaming.manifest.version,
          config: {
            provider,
            baseUrl: `${services}/chat/${provider}/${suffix}`,
          },
        });
        await db.p.updateConnection(operator, connection.id, {
          revision: 1,
          enabled: true,
          concurrency: 1,
        });
      }
    }
    if (nodes) {
      for (const plugin of [gpuText, flowText]) {
        const { id } = await db.p.createConnection(operator, {
          name: plugin.manifest.id,
          pluginId: plugin.manifest.id,
          version: plugin.manifest.version,
          config:
            plugin.manifest.mode === "pull"
              ? {}
              : { baseUrl: "http://127.0.0.1:9", apiKey: "local-fixture" },
        });
        await db.p.updateConnection(operator, id, {
          revision: 1,
          enabled: true,
          concurrency: 1,
        });
      }
    }
    if (!nodes && (gpu || services)) {
      const { manifest } = services ? gpuText : gpuState;
      const connection = await db.p.createConnection(operator, {
        name: "Loopback GPU settings",
        pluginId: manifest.id,
        version: manifest.version,
        config: {},
      });
      await db.p.updateConnection(operator, connection.id, {
        revision: 1,
        enabled: true,
        concurrency: 2,
      });
    }
    if (billing) {
      const connection = await db.p.createConnection(operator, {
        name: "Loopback billing provider",
        pluginId: museText.manifest.id,
        version: museText.manifest.version,
        config: { baseUrl: gateway, apiKey: "fixture-admin-billing" },
      });
      await db.p.updateConnection(operator, connection.id, {
        revision: 1,
        enabled: true,
        concurrency: 1,
      });
      await db.db.query(
        "UPDATE connections SET queue_health=$2,queue_health_revision=revision WHERE id=$1",
        [
          connection.id,
          JSON.stringify({
            ready: true,
            checked: Date.now() / 1000,
            capacity: 1,
            maintenance: 0,
            tasks: [],
          }),
        ],
      );
    }
    async function configureNativePayments(enabled: boolean) {
      for (const [method, channel] of Object.entries(config))
        await payments.configure(operator, method, {
          config: channel,
          enabled,
        });
    }
    await configureNativePayments(true);
    const previousURL = process.env.PUBLIC_URL;
    const previousAuto = process.env.FUMIAO_PAYMENT_AUTOSTART;
    try {
      process.env.PUBLIC_URL = nativeWeb;
      process.env.FUMIAO_PAYMENT_AUTOSTART = "0";
      nest = await createOriginalApp(db.p);
    } finally {
      if (previousURL === undefined) delete process.env.PUBLIC_URL;
      else process.env.PUBLIC_URL = previousURL;
      if (previousAuto === undefined)
        delete process.env.FUMIAO_PAYMENT_AUTOSTART;
      else process.env.FUMIAO_PAYMENT_AUTOSTART = previousAuto;
    }
    nest
      .getHttpServer()
      .prependListener(
        "request",
        (_: unknown, response: import("node:http").ServerResponse) =>
          response.setHeader("x-settings-fixture", "nest"),
      );
    await nest.listen(0, "127.0.0.1");
    await next(nativeWeb, await nest.getUrl());

    const backends: Record<string, Backend> = {
      python: {
        web,
        admin,
        member,
        memberPassword: memberCredentials.password,
      },
      nest: {
        web: nativeWeb,
        admin: await login(nativeWeb, adminCredentials),
        member: await login(nativeWeb, memberCredentials),
        memberPassword: memberCredentials.password,
      },
    };
    async function setAdminRole(webOrigin: string, role: "admin" | "member") {
      if (webOrigin === web) {
        const sql = new DatabaseSync(database);
        try {
          sql
            .prepare("UPDATE users SET role=? WHERE id=?")
            .run(role, adminState.me.id);
        } finally {
          sql.close();
        }
      } else {
        assert.equal(webOrigin, nativeWeb);
        await db!.db.query("UPDATE users SET role=$1 WHERE id=$2", [
          role,
          operator.id,
        ]);
      }
    }
    return {
      backends,
      sqlitePath: database,
      platform: db.p,
      team,
      otherTeam,
      personal,
      orderId,
      gateway,
      cleanup,
      async dispatchBilling(webOrigin: string) {
        assert.ok(redis);
        const before = providerRequests.length;
        if (webOrigin === web) {
          await promisify(execFile)(
            python,
            [
              "-c",
              "import server, muse_provider; muse_provider.dispatch_one(1)",
            ],
            {
              env: {
                PATH: process.env.PATH,
                PYTHONPATH: join(runtime, "app"),
                FUMIAO_DATA: data,
                SSL_CERT_FILE: serverCert,
                NO_PROXY: "127.0.0.1",
              },
              timeout: 10000,
            },
          );
        } else {
          assert.equal(webOrigin, nativeWeb);
          const connection = {
            host: redis.hostname,
            port: Number(redis.port || 6379),
            username: decodeURIComponent(redis.username) || undefined,
            password: decodeURIComponent(redis.password) || undefined,
            db: Number(redis.pathname.slice(1) || 0),
            ...(redis.protocol === "rediss:" ? { tls: {} } : {}),
            retryStrategy: () => null,
          };
          const executor = new Executor(db!.p);
          await db!.db.query(
            "UPDATE connections SET queue_health=jsonb_set(queue_health,'{checked}',to_jsonb(extract(epoch from now()))) WHERE plugin_id=$1",
            [museText.manifest.id],
          );
          const ready = await executor.queueReady();
          assert.equal(ready.length, 1);
          const name = "studio-admin-billing-" + randomUUID();
          const queue = new Queue(name, { connection });
          const events = new QueueEvents(name, { connection });
          const worker = new Worker(
            name,
            (job) => executor.execute(job.data.id),
            { connection },
          );
          try {
            await events.waitUntilReady();
            const delivery = await queue.add(
              "execute",
              { id: ready[0].id },
              { jobId: ready[0].id },
            );
            await delivery.waitUntilFinished(events, 10000);
          } finally {
            await worker.close();
            await events.close();
            try {
              await queue.obliterate();
            } finally {
              await queue.close();
            }
          }
        }
        assert.ifError(gatewayFailure);
        assert.equal(providerRequests.length, before + 1);
        assert.equal(
          gatewayRequests,
          0,
          "billing settings must not initiate payments",
        );
        return providerRequests.at(-1);
      },
      async setImageCredential(webOrigin: string, key: string) {
        assert.ok(imageConnection);
        assert.match(key, /^sk-fixture-/);
        if (webOrigin === web) {
          await writeFile(join(data, "openai.env"), `OPENAI_API_KEY=${key}\n`, {
            mode: 0o600,
          });
        } else {
          assert.equal(webOrigin, nativeWeb);
          const {
            rows: [row],
          } = await db!.db.query(
            "SELECT revision FROM connections WHERE id=$1",
            [imageConnection.id],
          );
          await db!.p.updateConnection(operator, imageConnection.id, {
            revision: Number(row.revision),
            enabled: true,
            concurrency: 1,
            config: imageConfig(key),
          });
        }
      },
      async ageNode(webOrigin: string, id: number) {
        if (webOrigin === web) {
          const sql = new DatabaseSync(database);
          try {
            sql
              .prepare("UPDATE nodes SET lastseen=unixepoch()-76 WHERE id=?")
              .run(id);
          } finally {
            sql.close();
          }
        } else {
          assert.equal(webOrigin, nativeWeb);
          await db!.db.query(
            "UPDATE gpu_nodes SET last_seen=now()-interval '76 seconds' WHERE public_id=$1",
            [id],
          );
        }
      },
      demoteAdmin: (webOrigin: string) => setAdminRole(webOrigin, "member"),
      restoreAdmin: (webOrigin: string) => setAdminRole(webOrigin, "admin"),
      async expireInvite(webOrigin: string, id: number) {
        if (webOrigin === web) {
          const sql = new DatabaseSync(database);
          try {
            sql
              .prepare(
                "UPDATE registration_codes SET expires=1700000000 WHERE id=?",
              )
              .run(id);
          } finally {
            sql.close();
          }
        } else {
          assert.equal(webOrigin, nativeWeb);
          await db!.db.query(
            "UPDATE invites SET expires_at=to_timestamp(1700000000) WHERE public_id=$1",
            [id],
          );
        }
      },
      async disablePayments(webOrigin: string) {
        if (webOrigin === web)
          await writeFile(join(data, "payments.json"), "{}", { mode: 0o600 });
        else {
          assert.equal(webOrigin, nativeWeb);
          await configureNativePayments(false);
        }
      },
      async settle(
        web: string,
        id: string,
        method: keyof typeof config,
        amount: string,
      ) {
        const channel = config[method];
        const trade = "local_" + id;
        const fields: Record<string, string> =
          method === "alipay"
            ? {
                pid: channel.pid,
                out_trade_no: id,
                trade_no: trade,
                money: amount,
                trade_status: "TRADE_SUCCESS",
                type: "alipay",
              }
            : {
                pid: channel.pid,
                order_id: id,
                trade_id: trade,
                amount,
                status: "2",
                token: "usdt",
              };
        const unsigned = Object.keys(fields)
          .sort()
          .map((key) => key + "=" + fields[key])
          .join("&");
        if (method === "alipay") {
          paid.set(id, amount);
          fields.sign = createHash("md5")
            .update(unsigned + channel.key)
            .digest("hex");
        } else {
          const order = plasma.get(id);
          assert.equal(order?.amount, amount);
          order!.paid = true;
          fields.signature = createHmac("sha256", channel.key)
            .update(unsigned)
            .digest("hex");
        }
        const url =
          web +
          "/api/recharge/notify/" +
          method +
          "?" +
          new URLSearchParams(fields);
        for (let i = 0; i < 2; i++) {
          const response = await fetch(url);
          assert.equal(response.status, 200);
          assert.equal(
            await response.text(),
            method === "alipay" ? "success" : "ok",
          );
        }
      },
      verifyGateway() {
        assert.ifError(gatewayFailure);
        assert.ok(gatewayRequests > 0);
      },
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
