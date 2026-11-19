/** Compare pinned FastAPI responses and settlement with real, isolated PostgreSQL. */
import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createServer as createHttpsServer } from "node:https";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { setTimeout as delay } from "node:timers/promises";
import { createOriginalApp } from "../apps/api/src/original.js";
import { createApp } from "../apps/api/src/main.js";
import type { OriginalActor } from "../packages/original-api/src/identity.js";
import { StudioCatalog } from "../packages/platform/src/catalog.js";
import { migrate, one } from "../packages/platform/src/db.js";
import {
  importLegacy,
  legacyId,
  type LegacyExport,
} from "../packages/platform/src/importer.js";
import { gpuText } from "../plugins/gpu/src/text.js";
import {
  activateCanvasRunPlugins,
  canvasRunPlugins,
} from "../tests/helpers/canvas-runs.js";
import { databaseFixture } from "../tests/helpers/database.js";

if (!process.env.TEST_DATABASE_URL)
  throw new Error("Set TEST_DATABASE_URL to an isolated PostgreSQL instance");
const python =
  process.env.STUDIO_PYTHON ||
  resolve(".runtime-advanced/original/.venv/bin/python");
const runtime = await mkdtemp(join(tmpdir(), "fumiao-recharge-"));
const origin = "http://localhost:3000";
const base = "/api/recharge";
const start = Math.floor(Date.now() / 1000);
const configs = {
  alipay: {
    gateway: "",
    pid: "101",
    key: randomBytes(24).toString("hex"),
    cid: "channel*~",
  },
  usdt_plasma: {
    gateway: "",
    pid: "202",
    key: randomBytes(24).toString("hex"),
  },
};
const checks: string[] = [];
type Method = keyof typeof configs;
type Actor = "admin" | "member";
type Backend = {
  url: string;
  sessions: Partial<Record<Actor, string>>;
  aliases: Map<string, string>;
};
type RequestOptions = {
  method?: string;
  actor?: Actor;
  body?: object;
  raw?: string | Uint8Array<ArrayBuffer>;
  contentType?: string;
  headers?: Record<string, string>;
};
type Verification = {
  trade: string;
  amount: string;
  pid?: string;
  redirect?: boolean;
};
const zpay = new Map<string, Verification>();
const epusdtPaid = new Set<string>();
const gatewayCalls = new Map<string, number>();
const createdCalls = new Map<string, number>();
const expiry = (start + 3_600) * 1000;
let gate: Promise<void> | undefined;
let raceTrade = "";
let gatewayUrl: string;
let legacy: ChildProcess | undefined;
let app: Awaited<ReturnType<typeof createOriginalApp>> | undefined;
let management: Awaited<ReturnType<typeof createApp>> | undefined;
let legacyLogs = "";
let gatewayError: unknown;
const fixtures: Awaited<ReturnType<typeof databaseFixture>>[] = [];
let server: ReturnType<typeof createHttpsServer> | undefined;

function sign(fields: Record<string, string>, method: Method) {
  const text = Object.keys(fields)
    .sort()
    .filter((key) => fields[key] !== "")
    .map((key) => key + "=" + fields[key])
    .join("&");
  const key = configs[method].key;
  return method === "alipay"
    ? createHash("md5")
        .update(text + key)
        .digest("hex")
    : createHmac("sha256", key).update(text).digest("hex");
}

function callback(
  id: string,
  trade: string,
  amount: string,
  method: Method = "alipay",
): Record<string, string> {
  return method === "alipay"
    ? {
        pid: configs.alipay.pid,
        out_trade_no: id,
        trade_no: trade,
        money: amount,
        trade_status: "TRADE_SUCCESS",
        type: "alipay",
      }
    : {
        pid: configs.usdt_plasma.pid,
        order_id: id,
        trade_id: trade,
        amount,
        status: "2",
        token: "usdt",
      };
}

function signed(fields: Record<string, string>, method: Method) {
  return {
    ...fields,
    [method === "alipay" ? "sign" : "signature"]: sign(
      fields,
      method,
    ).toUpperCase(),
  };
}

function notifyRequest(
  fields: Record<string, string>,
  method: Method,
  kind = "GET",
) {
  const values = signed(fields, method);
  const path = base + "/notify/" + method;
  if (kind === "GET")
    return [path + "?" + new URLSearchParams(values), {}] as const;
  if (kind === "form")
    return [
      path,
      {
        method: "POST",
        raw: new URLSearchParams(values).toString(),
        contentType: "application/x-www-form-urlencoded",
      },
    ] as const;
  // Exercise Decimal normalization of raw exponent notation and exact amount arithmetic.
  const { amount, status, pid, ...rest } = values;
  return [
    path,
    {
      method: "POST",
      raw:
        JSON.stringify(rest).slice(0, -1) +
        `,"amount":${amount}.000e0,"status":${status},"pid":${pid}}`,
      contentType: "application/json",
    },
  ] as const;
}

async function request(
  backend: Backend,
  path: string,
  options: RequestOptions = {},
) {
  const headers = new Headers(options.headers);
  if (options.actor) headers.set("cookie", backend.sessions[options.actor]!);
  if (options.contentType || options.body)
    headers.set("content-type", options.contentType || "application/json");
  const response = await fetch(backend.url + path, {
    method: options.method || (options.body ? "POST" : "GET"),
    headers,
    body: options.raw ?? (options.body && JSON.stringify(options.body)),
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  const type = response.headers.get("content-type");
  const text = await response.text();
  return {
    status: response.status,
    body: type === "application/json" ? JSON.parse(text) : text,
    type,
    location:
      response.headers.get("location")?.replace(backend.url, "<backend>") ??
      null,
    allow: response.headers.get("allow"),
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}

function normalize(value: any, backend: Backend): any {
  if (Array.isArray(value))
    return value.map((item) => normalize(item, backend));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        if (
          typeof item === "number" &&
          ["created", "expires", "paid"].includes(key) &&
          item >= start &&
          item !== expiry / 1000
        ) {
          assert.ok(Number.isInteger(item) && item <= start + 1850, key);
          return [key, "<current epoch>"];
        }
        return [key, normalize(item, backend)];
      }),
    );
  if (typeof value === "string") {
    let text = value;
    for (const [id, alias] of backend.aliases)
      text = text.replaceAll(id, alias);
    // Checkout signatures were already compared against the independent test signer.
    return text.replace(/([?&]sign=)[0-9a-f]{32}/g, "$1<signature>");
  }
  return value;
}

const backends: Backend[] = [];
async function compare(
  label: string,
  path: string | ((backend: Backend, index: number) => string),
  options:
    RequestOptions | ((backend: Backend, index: number) => RequestOptions) = {},
  status = 200,
  alias?: string,
) {
  const results = await Promise.all(
    backends.map(async (backend, index) => {
      const result = await request(
        backend,
        typeof path === "string" ? path : path(backend, index),
        typeof options === "function" ? options(backend, index) : options,
      );
      if (alias) {
        assert.match(result.body.id, /^FM[0-9a-f]{26}$/);
        backend.aliases.set(result.body.id, alias);
      }
      const { cookie: _, ...publicResult } = result;
      return publicResult;
    }),
  );
  for (const result of results)
    assert.equal(
      result.status,
      status,
      label + " " + JSON.stringify(result.body),
    );
  assert.deepEqual(
    normalize(results[1], backends[1]),
    normalize(results[0], backends[0]),
    label,
  );
  checks.push(label);
  return results;
}

async function login(backend: Backend, name: Actor, password: string) {
  const result = await request(backend, "/api/login", {
    body: { name, password },
    headers: { origin },
  });
  assert.equal(result.status, 200);
  assert.ok(result.cookie?.startsWith("fm_session="));
  backend.sessions[name] = result.cookie;
}

async function configure(backend: Backend, entries = configs) {
  for (const [method, config] of Object.entries(entries)) {
    const result = await request(backend, "/api/admin/payments/" + method, {
      method: "PUT",
      actor: "admin",
      headers: { origin },
      body: { config, enabled: true },
    });
    assert.equal(result.status, 200);
    assert.deepEqual(JSON.parse(result.body), { ok: true });
  }
}

async function fingerprint(
  fixture: Awaited<ReturnType<typeof databaseFixture>>,
  publicLedger = false,
) {
  return await one(
    fixture.db,
    `
    SELECT (SELECT jsonb_agg(to_jsonb(w) ORDER BY workspace_id) FROM wallets w) AS wallets,
           (SELECT jsonb_agg(to_jsonb(l) ORDER BY public_id) FROM ledger l WHERE NOT $1 OR l.public_id IS NOT NULL) AS ledger
  `,
    [publicLedger],
  );
}

function notice(
  backend: Backend,
  id: string,
  trade: string,
  amount: string,
  method: Method = "alipay",
  format = "GET",
) {
  const [path, options] = notifyRequest(
    callback(id, trade, amount, method),
    method,
    format,
  );
  return request(backend, path, options);
}

async function stop(child: ChildProcess) {
  if (child.exitCode === null && child.signalCode === null && child.pid) {
    const done = once(child, "exit");
    child.kill();
    await done;
  }
}

const defaultCAs = getCACertificates("default");
const oldPublic = process.env.PUBLIC_URL;
const oldAutostart = process.env.FUMIAO_PAYMENT_AUTOSTART;
try {
  const key = join(runtime, "key.pem"),
    cert = join(runtime, "cert.pem");
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
      cert,
      "-keyout",
      key,
    ],
    { stdio: "ignore" },
  );
  setDefaultCACertificates([...defaultCAs, await readFile(cert, "utf8")]);
  server = createHttpsServer(
    { key: await readFile(key), cert: await readFile(cert) },
    async (req, res) => {
      const json = (body: object) =>
        res
          .setHeader("content-type", "application/json")
          .end(JSON.stringify(body));
      try {
        const url = new URL(req.url!, gatewayUrl);
        assert.equal(req.headers["user-agent"], "Fumiao-Payments/1.0");
        assert.equal(req.headers.accept, "*/*");
        if (url.pathname === "/api.php") {
          assert.equal(req.method, "GET");
          const oid = url.searchParams.get("out_trade_no")!;
          assert.equal(url.searchParams.get("act"), "order");
          assert.equal(url.searchParams.get("pid"), configs.alipay.pid);
          assert.equal(url.searchParams.get("key"), configs.alipay.key);
          gatewayCalls.set(oid, (gatewayCalls.get(oid) || 0) + 1);
          const verified = zpay.get(oid);
          if (verified?.redirect)
            return res
              .writeHead(302, { location: gatewayUrl + "/redirect-trap" })
              .end();
          return verified
            ? json({
                code: 1,
                status: 1,
                pid: verified.pid || configs.alipay.pid,
                out_trade_no: oid,
                type: "alipay",
                trade_no: verified.trade,
                money: verified.amount,
              })
            : json({ code: 1, status: 0 });
        }
        if (url.pathname.startsWith("/pay/check-status/")) {
          assert.equal(req.method, "GET");
          const trade = url.pathname.split("/").at(-1)!;
          gatewayCalls.set(trade, (gatewayCalls.get(trade) || 0) + 1);
          return json({
            status_code: 200,
            data: { trade_id: trade, status: epusdtPaid.has(trade) ? 2 : 1 },
          });
        }
        assert.equal(req.method, "POST");
        assert.equal(
          url.pathname,
          "/payments/gmpay/v1/order/create-transaction",
        );
        let form = "";
        for await (const part of req) form += part;
        const { signature, ...fields } = Object.fromEntries(
          new URLSearchParams(form),
        );
        assert.equal(signature, sign(fields, "usdt_plasma"));
        const id = fields.order_id;
        assert.deepEqual(fields, {
          pid: configs.usdt_plasma.pid,
          order_id: id,
          amount: fields.amount,
          currency: "cny",
          token: "usdt",
          network: "plasma",
          notify_url: origin + base + "/notify/usdt_plasma",
          redirect_url: origin + "/payments/return?order=" + id,
          name: `弗淼AIGC ${Number(fields.amount) * 10}积分`,
        });
        createdCalls.set(id, (createdCalls.get(id) || 0) + 1);
        if (fields.amount === "5.00") return res.writeHead(502).end();
        const trade = "ep_" + id;
        if (fields.amount === "7.00") {
          raceTrade = trade;
          await gate;
        }
        return json({
          status_code: 200,
          data: {
            order_id: id,
            amount: fields.amount,
            currency: "CNY",
            trade_id: trade,
            expiration_time: fields.amount === "11.00" ? start - 60 : expiry,
            payment_url: gatewayUrl + "/checkout/" + id,
          },
        });
      } catch (error) {
        gatewayError = error;
        return res.writeHead(500).end();
      }
    },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  gatewayUrl = "https://127.0.0.1:" + (server.address() as AddressInfo).port;
  for (const config of Object.values(configs)) config.gateway = gatewayUrl;
  const dataPath = join(runtime, "data");
  await mkdir(dataPath);
  await writeFile(join(dataPath, "payments.json"), JSON.stringify(configs), {
    mode: 0o600,
  });

  const probe = createServer().listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((done) => probe.close(() => done()));
  legacy = spawn(
    python,
    [
      "scripts/preview-original.py",
      "--port",
      String(port),
      "--public-url",
      origin,
      "--runtime-directory",
      runtime,
      "--no-reuse-local-credentials",
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        SSL_CERT_FILE: cert,
        NO_PROXY: "127.0.0.1,localhost",
        no_proxy: "127.0.0.1,localhost",
      },
    },
  );
  for (const stream of [legacy.stdout!, legacy.stderr!])
    stream.on("data", (part) => {
      legacyLogs = (legacyLogs + part).slice(-5000);
    });
  legacy.on("error", (error) => {
    legacyLogs += error.message;
  });
  const original: Backend = {
    url: "http://127.0.0.1:" + port,
    sessions: {},
    aliases: new Map(),
  };
  let ready = false;
  for (let attempt = 0; attempt < 120 && legacy.exitCode === null; attempt++) {
    if (
      (await request(original, base).catch(() => undefined))?.status === 401
    ) {
      ready = true;
      break;
    }
    await delay(50);
  }
  assert.ok(ready, "pinned FastAPI ready");
  const { password } = JSON.parse(
    await readFile(join(runtime, "credentials.json"), "utf8"),
  );
  const memberPassword = "recharge-fixture-member";
  await login(original, "admin", password);
  assert.equal(
    (
      await request(original, "/api/users", {
        actor: "admin",
        body: { name: "member", nickname: "成员", password: memberPassword },
      })
    ).status,
    200,
  );
  await login(original, "member", memberPassword);
  const adminSpaces = (
    await request(original, "/api/workspaces", { actor: "admin" })
  ).body;
  const workspace: number = adminSpaces.workspace_id;
  const team: number = adminSpaces.workspaces.find(
    (row: any) => row.kind === "team",
  ).id;
  const memberSpace: number = (
    await request(original, "/api/workspaces", { actor: "member" })
  ).body.workspace_id;
  const create = (
    yuan: number,
    method: Method,
    space = workspace,
    uid = randomUUID(),
  ): RequestOptions => ({
    actor: "admin",
    body: { yuan, method, workspace: space, uid },
    headers: { origin },
  });
  const historicalRequest = create(6, "alipay");
  const historical = await request(
    original,
    base + "/orders",
    historicalRequest,
  );
  assert.equal(historical.status, 200);
  const historicalId = historical.body.id;
  zpay.set(historicalId, { trade: "historical_trade", amount: "6.000" });
  assert.equal(
    (await notice(original, historicalId, "historical_trade", "6.00")).body,
    "success",
  );
  execFileSync(python, ["scripts/seed-recharge-history.py", dataPath]);
  const snapshotPath = join(runtime, "export.json");
  execFileSync(python, [
    "scripts/export-legacy.py",
    "--database",
    join(dataPath, "studio.sqlite"),
    "--source",
    "recharge-fixture",
    "--output",
    snapshotPath,
    "--include-registration-codes",
  ]);
  const snapshot: LegacyExport = JSON.parse(
    await readFile(snapshotPath, "utf8"),
  );
  assert.equal(snapshot.tables.recharge_orders.length, 36);

  const fresh = await databaseFixture();
  fixtures.push(fresh);
  await importLegacy(fresh.p, snapshot, runtime);
  assert.deepEqual(await importLegacy(fresh.p, snapshot, runtime), {
    alreadyImported: true,
  });
  const target = await databaseFixture("026_storyboard_object_cleanup.sql");
  fixtures.push(target);
  // Reproduce the previous import shape before running the upgrade on archived orders.
  await importLegacy(
    target.p,
    { ...snapshot, tables: { ...snapshot.tables, recharge_orders: [] } },
    runtime,
  );
  for (const order of snapshot.tables.recharge_orders)
    await target.db.query(
      "INSERT INTO legacy_records(source,collection,legacy_id,workspace_id,payload) VALUES($1,'recharge_orders',$2,$3,$4)",
      [
        snapshot.source,
        order.id,
        legacyId(snapshot.source, "workspace", order.workspace),
        order,
      ],
    );
  const imported = await fingerprint(target);
  await migrate(target.db);
  assert.deepEqual(await fingerprint(target), imported);
  assert.deepEqual(
    await fingerprint(fresh, true),
    await fingerprint(target, true),
  );
  assert.deepEqual(
    (
      await target.db.query(
        "SELECT * FROM original_recharge_orders ORDER BY id",
      )
    ).rows,
    (await fresh.db.query("SELECT * FROM original_recharge_orders ORDER BY id"))
      .rows,
  );
  assert.equal(
    Number(
      (await one(target.db, "SELECT count(*) FROM original_recharge_orders"))
        .count,
    ),
    36,
  );
  assert.equal(
    Number(
      (await one(target.db, "SELECT count(*) FROM payment_channels")).count,
    ),
    0,
  );
  process.env.PUBLIC_URL = origin;
  process.env.FUMIAO_PAYMENT_AUTOSTART = "0";
  app = await createOriginalApp(target.p);
  await app.listen(0, "127.0.0.1");
  const native: Backend = {
    url: await app.getUrl(),
    sessions: {},
    aliases: new Map(),
  };
  backends.push(original, native);
  await login(native, "admin", password);
  await login(native, "member", memberPassword);
  management = await createApp(target.p);
  await management.listen(0, "127.0.0.1");
  const adminBackend = { ...native, url: await management.getUrl() };
  const forbidden = await request(adminBackend, "/api/admin/payments/alipay", {
    method: "PUT",
    actor: "member",
    headers: { origin },
    body: { config: configs.alipay, enabled: true },
  });
  assert.equal(forbidden.status, 403);
  await configure(adminBackend);
  checks.push(
    "Advanced HTTP administration configures the shared encrypted channels",
  );
  assert.equal(
    (
      await request(native, base, {
        headers: { cookie: original.sessions.admin! },
      })
    ).status,
    401,
  );
  checks.push("FastAPI session is rejected by the NestJS API");

  const admin = { actor: "admin" } as const;
  const member = { actor: "member" } as const;
  const archivedRewards = await fresh.db.query(
    "SELECT payload FROM legacy_records WHERE source=$1 AND collection='fm_rewards'",
    [snapshot.source],
  );
  assert.deepEqual(
    archivedRewards.rows.map(({ payload }) => payload),
    snapshot.tables.fm_rewards,
  );
  assert.equal(archivedRewards.rows.length, 1);
  assert.equal(archivedRewards.rows[0].payload.credited, 0);
  checks.push(
    "historical fractional reward is archived without changing the consumption wallet",
  );
  const orders = base + "/orders";
  const oldPath = orders + "/" + historicalId;
  const lastPage = (
    await compare("imported history and gateway configuration", base, admin)
  )[0].body.orders;
  assert.equal(lastPage.length, 30);
  assert.equal(lastPage[0].id, historicalId);
  assert.equal(lastPage[0].state, "paid");
  const firstPage = (
    await compare(
      "exclusive original cursor",
      base + "?before=" + lastPage.at(-1).id,
      admin,
    )
  )[0].body.orders;
  assert.equal(firstPage.length, 6);
  const boundary = lastPage.at(-1).id;
  const pageAfterNul = await compare(
    "an original order ID sorts before the same ID plus NUL",
    base + "?before=" + encodeURIComponent(boundary + "\0suffix"),
    admin,
  );
  assert.equal(pageAfterNul[0].body.orders[0].id, boundary);
  assert.ok(
    firstPage.every(
      (order: any) => order.state === "expired" && !order.can_pay,
    ),
  );
  await compare("historical detail", oldPath, admin);
  await compare(
    "historical retry uses original UID",
    orders,
    historicalRequest,
  );
  await compare(
    "historical paid order has no checkout",
    oldPath + "/pay",
    admin,
    409,
  );
  await compare(
    "historical expired order has no checkout",
    firstPage[0].payment_url,
    admin,
    409,
  );
  await compare(
    "historical owner can read only their orders",
    oldPath,
    member,
    404,
  );
  await compare(
    "administrator cannot read another personal space",
    base + "?workspace=" + memberSpace,
    admin,
    403,
  );
  await compare(
    "selected workspace header wins",
    base + "?workspace=" + workspace,
    {
      ...admin,
      headers: { "x-workspace-id": String(team) },
    },
  );
  await compare(
    "historical UID cannot be used by another owner",
    orders,
    {
      ...member,
      body: { ...historicalRequest.body, workspace: memberSpace },
    },
    409,
  );
  const historicalCalls = gatewayCalls.get(historicalId);
  const [historicalNotify, historicalNotifyOptions] = notifyRequest(
    callback(historicalId, "historical_trade", "6.00"),
    "alipay",
  );
  await compare(
    "historical paid callback is idempotent",
    historicalNotify,
    historicalNotifyOptions,
  );
  assert.equal(gatewayCalls.get(historicalId), historicalCalls);
  assert.deepEqual(await fingerprint(target), imported);

  await compare("listing needs a session", base, {}, 401);
  await compare("order requires a session", oldPath, {}, 401);
  await compare("payment entry requires a session", oldPath + "/pay", {}, 401);
  await compare("malformed space selection", base + "?workspace=x", admin, 400);
  await compare(
    "invalid JSON before authentication",
    orders,
    { method: "POST", raw: "{", contentType: "application/json" },
    422,
  );
  await compare(
    "missing fields before authentication",
    orders,
    { body: {} },
    422,
  );
  await compare(
    "strict integers and UUID validation",
    orders,
    {
      method: "POST",
      raw: '{"yuan":2.0,"workspace":true,"method":34,"uid":17}',
      contentType: "application/json",
    },
    422,
  );
  await compare(
    "strict Yuan boundaries",
    orders,
    create(10_001, "alipay"),
    422,
  );
  await compare(
    "unavailable channel",
    orders,
    {
      ...create(1, "alipay"),
      body: {
        workspace,
        yuan: 1,
        method: "unknown",
        uid: randomUUID(),
      },
    },
    503,
  );
  await compare(
    "order workspace permission",
    orders,
    create(1, "alipay", memberSpace),
    403,
  );
  await compare(
    "untrusted write origin",
    orders,
    { ...create(1, "alipay"), headers: { origin: "https://test.invalid" } },
    403,
  );
  await compare("unsupported method", orders, {}, 405);
  await compare(
    "public browser return by Alipay order",
    "/payments/return?out_trade_no=" + historicalId,
    {},
    303,
  );
  await compare(
    "public return with unsafe order",
    "/payments/return?order=%2f%2fevil",
    {},
    303,
  );
  await compare(
    "trailing slash return",
    "/payments/return/?order=" + historicalId,
    {},
    307,
  );

  const alipay = create(2, "alipay");
  const aliIds = (
    await compare("Alipay order", orders, alipay, 200, "<alipay>")
  ).map((r) => r.body.id);
  const aliPath = (_backend: Backend, index: number) =>
    orders + "/" + aliIds[index];
  const checkout = await compare(
    "owned Alipay checkout redirects",
    (backend, index) => aliPath(backend, index) + "/pay",
    admin,
    303,
  );
  for (const result of checkout) {
    const url = new URL(result.location!);
    const {
      sign: signature,
      sign_type,
      ...fields
    } = Object.fromEntries(url.searchParams);
    assert.equal(url.origin, gatewayUrl);
    assert.equal(url.pathname, "/submit.php");
    assert.equal(sign_type, "MD5");
    assert.equal(signature, sign(fields, "alipay"));
    assert.deepEqual(fields, {
      pid: configs.alipay.pid,
      type: "alipay",
      out_trade_no: fields.out_trade_no,
      name: "弗淼AIGC 20积分",
      money: "2.00",
      notify_url: origin + base + "/notify/alipay",
      return_url: origin + "/payments/return",
      cid: configs.alipay.cid,
    });
    assert.ok(result.location?.includes("channel%2A~"));
  }
  await compare(
    "another user cannot open checkout",
    (backend, index) => aliPath(backend, index) + "/pay",
    member,
    404,
  );
  await compare("same UID returns the same order", orders, alipay);
  await compare(
    "same UID with changed amount",
    orders,
    {
      ...alipay,
      body: { ...alipay.body, yuan: 3 },
    },
    409,
  );

  for (const id of aliIds)
    zpay.set(id, { trade: "zpay_trade", amount: "2.00", redirect: true });
  const warned = (
    await compare("redirected gateway lookup fails closed", aliPath, admin)
  )[0].body;
  assert.match(warned.warning, /暂时无法查询/);
  await compare("detail lookup throttle", aliPath, admin);
  assert.deepEqual(
    aliIds.map((id) => gatewayCalls.get(id)),
    [1, 1],
  );

  const aliNotify = (index: number, extras: Record<string, string> = {}) =>
    signed(
      { ...callback(aliIds[index], "zpay_trade", "2.00"), ...extras },
      "alipay",
    );
  const notifyPath = base + "/notify/alipay";
  await compare(
    "unknown payment method",
    base + "/notify/constructor",
    {},
    400,
  );
  await compare(
    "duplicate query fields",
    (_, i) =>
      notifyPath + "?" + new URLSearchParams(aliNotify(i)) + "&%70id=101",
    {},
    400,
  );
  await compare(
    "duplicate escaped JSON fields",
    notifyPath,
    (_, i) => ({
      method: "POST",
      contentType: "application/json",
      raw: JSON.stringify(aliNotify(i)).slice(0, -1) + ',"\\u0070id":"101"}',
    }),
    400,
  );
  await compare(
    "duplicate form fields",
    notifyPath,
    (_, i) => ({
      method: "POST",
      raw: new URLSearchParams(aliNotify(i)).toString() + "&pid=101",
    }),
    400,
  );
  await compare(
    "oversize callback",
    notifyPath,
    {
      method: "POST",
      contentType: "application/json",
      raw: " ".repeat(16385),
    },
    400,
  );
  await compare(
    "too many callback fields",
    (_, i) =>
      notifyPath +
      "?" +
      new URLSearchParams(aliNotify(i)) +
      Array.from({ length: 51 }, (_, n) => "&extra" + n + "=").join(""),
    {},
    400,
  );
  await compare(
    "tampered callback signature",
    (_, i) =>
      notifyPath +
      "?" +
      new URLSearchParams({
        ...aliNotify(i),
        money: "20.00",
      }),
    {},
    400,
  );
  await compare(
    "signed callback amount mismatch",
    (_, i) =>
      notifyPath + "?" + new URLSearchParams(aliNotify(i, { money: "2.001" })),
    {},
    400,
  );
  await compare(
    "signed callback merchant mismatch",
    (_, i) =>
      notifyPath + "?" + new URLSearchParams(aliNotify(i, { pid: "999" })),
    {},
    400,
  );
  await compare(
    "signed callback invalid trade ID",
    (_, i) =>
      notifyPath +
      "?" +
      new URLSearchParams(aliNotify(i, { trade_no: "../bad" })),
    {},
    400,
  );
  await compare(
    "signed callback unpaid status",
    (_, i) =>
      notifyPath +
      "?" +
      new URLSearchParams(aliNotify(i, { trade_status: "WAIT_BUYER_PAY" })),
    {},
    400,
  );
  assert.deepEqual(
    aliIds.map((id) => gatewayCalls.get(id)),
    [1, 1],
  );
  assert.deepEqual(await fingerprint(target), imported);

  for (const id of aliIds)
    zpay.set(id, { trade: "zpay_trade", amount: "2.01" });
  await compare(
    "gateway-reported amount mismatch",
    (_, i) => notifyPath + "?" + new URLSearchParams(aliNotify(i)),
    {},
    400,
  );
  for (const id of aliIds)
    zpay.set(id, { trade: "different_trade", amount: "2.00" });
  await compare(
    "gateway-reported trade mismatch",
    (_, i) => notifyPath + "?" + new URLSearchParams(aliNotify(i)),
    {},
    400,
  );
  for (const id of aliIds)
    zpay.set(id, { trade: "zpay_trade", amount: "2.000" });
  for (const [i, backend] of backends.entries()) {
    const callbacks = await Promise.all(
      Array.from({ length: 6 }, () =>
        notice(backend, aliIds[i], "zpay_trade", "2.000", "alipay", "form"),
      ),
    );
    assert.ok(
      callbacks.every(
        (result) => result.status === 200 && result.body === "success",
      ),
    );
  }
  checks.push("6 concurrent signed form callbacks per backend settle once");
  await compare("settled Alipay order", aliPath, admin);
  await compare(
    "settled Alipay order blocks checkout",
    (backend, index) => aliPath(backend, index) + "/pay",
    admin,
    409,
  );

  const ep = create(4, "usdt_plasma");
  const epIds = (
    await compare(
      "EPusdt order and millisecond expiry",
      orders,
      ep,
      200,
      "<epusdt>",
    )
  ).map((r) => r.body.id);
  await compare(
    "EPusdt checkout",
    (_, i) => orders + "/" + epIds[i] + "/pay",
    admin,
    303,
  );
  await compare(
    "signed EPusdt JSON stays pending until verified",
    base + "/notify/usdt_plasma",
    (_, i) => {
      return notifyRequest(
        callback(epIds[i], "ep_" + epIds[i], "4", "usdt_plasma"),
        "usdt_plasma",
        "json",
      )[1];
    },
    400,
  );
  for (const id of epIds) epusdtPaid.add("ep_" + id);
  const ack = await compare(
    "signed EPusdt decimal JSON settles",
    base + "/notify/usdt_plasma",
    (_, i) => {
      return notifyRequest(
        callback(epIds[i], "ep_" + epIds[i], "4", "usdt_plasma"),
        "usdt_plasma",
        "json",
      )[1];
    },
  );
  assert.equal(ack[0].body, "ok");
  await compare(
    "settled EPusdt order",
    (_, i) => orders + "/" + epIds[i],
    admin,
  );

  const epFailure = create(5, "usdt_plasma");
  const recoveryIds = (
    await compare(
      "ambiguous EPusdt creation",
      orders,
      epFailure,
      200,
      "<unconfirmed>",
    )
  ).map((r) => {
    assert.equal(r.body.state, "unconfirmed");
    assert.equal(r.body.can_pay, false);
    return r.body.id;
  });
  await compare(
    "ambiguous create retry never resends gateway request",
    orders,
    epFailure,
  );
  assert.deepEqual(
    recoveryIds.map((id) => createdCalls.get(id)),
    [1, 1],
  );
  await compare(
    "unconfirmed checkout is blocked",
    (_, i) => orders + "/" + recoveryIds[i] + "/pay",
    admin,
    409,
  );
  epusdtPaid.add("recovered_trade");
  await compare(
    "unconfirmed EPusdt signed callback recovers without resubmission",
    (_, i) =>
      notifyRequest(
        callback(recoveryIds[i], "recovered_trade", "5.00", "usdt_plasma"),
        "usdt_plasma",
      )[0],
  );
  await compare(
    "unconfirmed EPusdt now paid",
    (_, i) => orders + "/" + recoveryIds[i],
    admin,
  );

  const pollIds = (
    await compare(
      "order created for authenticated polling",
      orders,
      create(3, "alipay"),
      200,
      "<polled>",
    )
  ).map((r) => r.body.id);
  for (const id of pollIds)
    zpay.set(id, { trade: "polled_trade", amount: "3.0" });
  await compare(
    "authenticated detail can settle a verified payment",
    (_, i) => orders + "/" + pollIds[i],
    admin,
  );
  assert.deepEqual(
    pollIds.map((id) => gatewayCalls.get(id)),
    [1, 1],
  );

  const beforeRace = create(7, "usdt_plasma");
  for (const backend of backends) {
    let release!: () => void;
    raceTrade = "";
    gate = new Promise<void>((done) => {
      release = done;
    });
    const creating = request(backend, orders, beforeRace);
    try {
      for (let attempt = 0; attempt < 150 && !raceTrade; attempt++)
        await delay(10);
      assert.ok(raceTrade);
      const id = raceTrade.slice(3);
      const retry = await request(backend, orders, beforeRace);
      assert.equal(retry.body.id, id);
      assert.equal(retry.body.can_pay, false);
      epusdtPaid.add(raceTrade);
      const notify = await notice(
        backend,
        id,
        raceTrade,
        "7.00",
        "usdt_plasma",
      );
      assert.equal(notify.body, "ok");
      backend.aliases.set(id, "<create-race>");
    } finally {
      release();
    }
    const result = await creating;
    assert.equal(result.status, 200);
    assert.equal(result.body.state, "paid");
    assert.equal(result.body.can_pay, false);
    assert.equal(createdCalls.get(result.body.id), 1);
  }
  checks.push(
    "callback wins race with gateway create response without reopening checkout",
  );

  const conflicts = await Promise.all(
    [8, 9].map(async (yuan) =>
      (
        await compare(
          "prepare competing trade " + yuan,
          orders,
          create(yuan, "alipay"),
          200,
          "<competing-" + yuan + ">",
        )
      ).map((r) => r.body.id),
    ),
  );
  for (const [i, backend] of backends.entries()) {
    const ids = conflicts.map((orders) => orders[i]);
    ids.forEach((id, index) =>
      zpay.set(id, { trade: "shared_trade", amount: 8 + index + ".00" }),
    );
    const replies = await Promise.all(
      ids.map((id, index) =>
        notice(backend, id, "shared_trade", 8 + index + ".00"),
      ),
    );
    assert.deepEqual(replies.map((r) => r.status).sort(), [200, 400]);
    const loser = replies.findIndex((r) => r.status === 400);
    zpay.set(ids[loser], {
      trade: "different_valid_trade",
      amount: 8 + loser + ".00",
    });
    assert.equal(
      (
        await notice(
          backend,
          ids[loser],
          "different_valid_trade",
          8 + loser + ".00",
        )
      ).status,
      200,
    );
  }
  checks.push("unique method/trade across concurrent different orders");

  const originalWallet = (await request(original, "/api/credits", admin)).body;
  const targetWallet = (await request(native, "/api/credits", admin)).body;
  assert.deepEqual(originalWallet.wallet, targetWallet.wallet);
  assert.equal(targetWallet.wallet.balance, 439);
  const actual = (
    await target.db.query(
      "SELECT l.original_uid,l.action,l.amount,l.balance_snapshot,l.held_snapshot,l.note,u.public_id AS actor FROM ledger l LEFT JOIN users u ON u.id=l.actor_id WHERE l.action='recharge' ORDER BY l.public_id",
    )
  ).rows;
  assert.equal(actual.length, 8);
  assert.deepEqual(
    actual.map((row) => Number(row.amount)).sort((a, b) => a - b),
    [20, 30, 40, 50, 60, 70, 80, 90],
  );
  assert.equal(Number(actual.at(-1)!.balance_snapshot), 439);
  assert.ok(
    actual.every(
      (row) =>
        Number(row.held_snapshot) === 0 &&
        row.note.endsWith(row.original_uid.slice("recharge:".length)),
    ),
  );
  checks.push(
    "real wallets agree and ledger snapshots have one row per payment",
  );

  const memberId = snapshot.tables.users.find(
    (user) => user.name === "member",
  )!.id;
  const { name: teamName, revision: teamRevision } =
    adminSpaces.workspaces.find((space: any) => space.id === team);
  const editTeam = (members: number[], revision: number): RequestOptions => ({
    ...admin,
    method: "PATCH",
    body: { name: teamName, members, expected_revision: revision },
  });
  await compare(
    "grant team access for recharge",
    "/api/workspaces/" + team,
    editTeam([memberId], teamRevision),
  );
  const lateIds = (
    await compare(
      "gateway-expired pending order",
      orders,
      {
        ...create(11, "usdt_plasma", team),
        ...member,
      },
      200,
      "<expired>",
    )
  ).map((result) => {
    assert.equal(result.body.state, "expired");
    assert.equal(result.body.can_pay, false);
    return result.body.id;
  });
  await compare(
    "administrator cannot read member's team order",
    (_, i) => orders + "/" + lateIds[i],
    admin,
    404,
  );
  await compare(
    "owner cannot open expired checkout",
    (_, i) => orders + "/" + lateIds[i] + "/pay",
    member,
    409,
  );
  await compare(
    "revoke team access",
    "/api/workspaces/" + team,
    editTeam([], teamRevision + 1),
  );
  await compare(
    "order owner also needs live team access",
    (_, i) => orders + "/" + lateIds[i],
    member,
    403,
  );
  for (const id of lateIds) epusdtPaid.add("ep_" + id);
  await compare(
    "verified late callback credits the original team",
    (_, i) =>
      notifyRequest(
        callback(lateIds[i], "ep_" + lateIds[i], "11.00", "usdt_plasma"),
        "usdt_plasma",
      )[0],
  );
  for (const backend of backends) {
    const result = await request(
      backend,
      "/api/credits?workspace=" + team,
      admin,
    );
    assert.equal(result.body.wallet.balance, 110);
  }

  const rollback = await request(native, orders, create(1, "alipay"));
  const rollbackId = rollback.body.id;
  zpay.set(rollbackId, { trade: "rollback_trade", amount: "1.00" });
  const beforeFailure = await fingerprint(target);
  await target.db.query(`
    CREATE FUNCTION fail_recharge_credit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.original_uid = 'recharge:${rollbackId}' THEN RAISE EXCEPTION 'test credit failure'; END IF;
      RETURN NEW;
    END; $$;
    CREATE TRIGGER fail_recharge_credit BEFORE INSERT ON ledger FOR EACH ROW EXECUTE FUNCTION fail_recharge_credit();
  `);
  assert.equal(
    (await notice(native, rollbackId, "rollback_trade", "1.00")).body,
    "fail",
  );
  const unsuccessful = await one(
    target.db,
    "SELECT * FROM original_recharge_orders WHERE id=$1",
    [rollbackId],
  );
  assert.equal(unsuccessful.state, "pending");
  assert.equal(unsuccessful.trade_id, null);
  assert.deepEqual(await fingerprint(target), beforeFailure);
  await target.db.query("DROP TRIGGER fail_recharge_credit ON ledger");
  assert.equal(
    (await notice(native, rollbackId, "rollback_trade", "1.00")).body,
    "success",
  );
  checks.push(
    "late ledger fault rolls back trade, order and wallet, then retries safely",
  );

  const originalRollback = await request(original, orders, create(1, "alipay"));
  assert.equal(originalRollback.status, 200);
  zpay.set(originalRollback.body.id, {
    trade: "rollback_trade",
    amount: "1.00",
  });
  assert.equal(
    (await notice(original, originalRollback.body.id, "rollback_trade", "1.00"))
      .body,
    "success",
  );

  // Four concurrent submissions share the owner-wide cap even across workspaces.
  for (const backend of backends) {
    const responses = await Promise.all(
      [workspace, team, workspace, team].map((space) =>
        request(backend, orders, create(1, "alipay", space)),
      ),
    );
    assert.deepEqual(
      responses.map((r) => r.status).sort(),
      [200, 200, 200, 409],
    );
    const teamOrder = responses.find(
      (r) => r.status === 200 && r.body.workspace === team,
    )!;
    assert.equal(
      (await request(backend, orders + "/" + teamOrder.body.id, member)).status,
      404,
    );
  }
  checks.push("concurrent order creation enforces owner-wide cap");

  // Replace the merchant while originals remain pending. Keep this replacement on loopback.
  const oldChannel = configs.alipay;
  const rotated = { ...configs, alipay: { ...oldChannel, pid: "303" } };
  await writeFile(join(dataPath, "payments.json"), JSON.stringify(rotated));
  await configure(adminBackend, rotated);
  const olderOrders = await Promise.all(
    backends.map((backend) => request(backend, base, admin)),
  );
  await compare(
    "merchant rotation rejects checkout for existing order",
    (_, i) =>
      olderOrders[i].body.orders.find((order: any) => order.can_pay)
        .payment_url,
    admin,
    503,
  );
  await compare(
    "merchant rotation rejects even an old valid signed paid callback",
    historicalNotify,
    historicalNotifyOptions,
    400,
  );

  // Use the same Nest listener, session and wallet that just settled the
  // loopback payment to generate a canvas narration via a paired agent.
  const actor = (await one(
    target.db,
    "SELECT * FROM users WHERE name='admin'",
  )) as OriginalActor;
  await activateCanvasRunPlugins(
    { ...target, catalog: new StudioCatalog(target.db), admin: actor },
    undefined,
    [
      gpuText,
      ...canvasRunPlugins.filter((plugin) => plugin.manifest.id !== "gpu"),
    ],
  );
  const model = "breeze-tts-2";
  await target.db.query("UPDATE studio_prices SET amount=1 WHERE key=$1", [
    model + "|standard",
  ]);
  const priceRevision = Number(
    (await one(target.db, "SELECT price_revision FROM studio_policy"))
      .price_revision,
  );
  const nest = async (path: string, options: RequestOptions = admin) => {
    const result = await request(native, path, options);
    assert.equal(result.status, 200, path + " " + JSON.stringify(result.body));
    return result.body;
  };
  assert.equal((await nest(orders + "/" + conflicts[0][1])).state, "paid");
  const before = (await nest("/api/credits")).wallet;
  const pair = await nest("/api/pairs", {
    ...admin,
    body: { name: "Paired canvas fixture", models: [model] },
  });
  const code = pair.command.split(" ").at(-1);
  assert.match(code, /^[A-Za-z0-9_-]{43}$/);
  const secret = randomBytes(32).toString("base64url");
  assert.deepEqual(await nest("/agent/enroll", { body: { code, secret } }), {
    ok: true,
    models: [model],
  });
  const headers = { Authorization: "Bearer " + secret };
  assert.deepEqual(
    await nest("/agent/heartbeat", {
      headers,
      body: { stage: "ready", ready_models: [model] },
    }),
    { control: "active", held: false, protocol: 2, execution_mode: "serial" },
  );
  const title = "同一服务中的画布旁白";
  const canvas = await nest("/api/canvases", { ...admin, body: { title } });
  const canvasPath = "/api/canvases/" + canvas.id;
  const document = {
    nodes: [{ id: "v", type: "video", x: 0, y: 0, narration_text: title }],
    edges: [],
  };
  const saved = await nest(canvasPath + "/document", {
    ...admin,
    method: "PUT",
    body: { expected_revision: canvas.revision, title, document },
  });
  const { id } = await nest(canvasPath + "/nodes/v/narration", {
    ...admin,
    body: {
      uid: randomUUID(),
      expected_revision: saved.revision,
      price_revision: priceRevision,
    },
  });
  const { job } = await nest("/agent/claim", { method: "POST", headers });
  assert.equal(job.id, id);
  assert.equal(job.prompt, title);
  assert.equal(job.model, model);
  const sound = join(runtime, "paired-canvas.wav");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=24000:duration=1",
    sound,
  ]);
  const wav = new Uint8Array(await readFile(sound));
  const assignment = { ...headers, "X-Job-Ticket": job.ticket };
  const agentPath = "/agent/jobs/" + id;
  const delivery: RequestOptions = {
    method: "PUT",
    headers: {
      ...assignment,
      "X-SHA256": createHash("sha256").update(wav).digest("hex"),
    },
    contentType: "audio/wav",
    raw: wav,
  };
  const delivered = await nest(agentPath + "/result", delivery);
  assert.ok(delivered.ok);
  assert.deepEqual(await nest(agentPath + "/result", delivery), delivered);
  assert.deepEqual(
    await nest(agentPath + "/receipt", { headers: assignment }),
    {
      delivered: true,
    },
  );
  const { runs } = await nest(canvasPath + "/runs");
  assert.ok(
    runs.some(
      (run: any) =>
        run.id === id && run.status === "done" && run.result === delivered.id,
    ),
  );
  const after = (await nest("/api/credits")).wallet;
  assert.equal(after.balance, before.balance - 1);
  assert.equal(after.reserved, before.reserved);
  assert.equal(
    await one(
      target.db,
      "SELECT job_number FROM fmworker_rewards WHERE job_number=$1",
      [id],
    ),
    undefined,
  );
  checks.push(
    "one Nest app settles mock payments and delivers paired GPU narration once without a contribution reward",
  );

  assert.ifError(gatewayError);
  console.log(
    `recharge: ${checks.length} checks passed with pinned FastAPI HTTP, isolated PostgreSQL and loopback HTTPS payment simulation`,
  );
  console.log(checks.join("\n"));
} catch (error) {
  console.error(legacyLogs);
  throw error;
} finally {
  await Promise.all([app?.close(), management?.close()]);
  if (legacy) await stop(legacy);
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((done) => server!.close(() => done()));
  }
  await Promise.all(fixtures.map((fixture) => fixture.cleanup()));
  await rm(runtime, { recursive: true, force: true });
  setDefaultCACertificates(defaultCAs);
  if (oldPublic === undefined) delete process.env.PUBLIC_URL;
  else process.env.PUBLIC_URL = oldPublic;
  if (oldAutostart === undefined) delete process.env.FUMIAO_PAYMENT_AUTOSTART;
  else process.env.FUMIAO_PAYMENT_AUTOSTART = oldAutostart;
}
