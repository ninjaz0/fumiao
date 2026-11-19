/** Compare original identity HTTP contracts using isolated Python and PostgreSQL state. */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { databaseFixture } from "../tests/helpers/database.js";
import { StudioCatalog } from "../packages/platform/src/catalog.js";
import { one } from "../packages/platform/src/db.js";
import { importLegacy } from "../packages/platform/src/importer.js";
import { createOriginalApp } from "../apps/api/src/original.js";
import {
  OriginalIdentity,
  avatars,
} from "../packages/original-api/src/identity.js";
const f = await databaseFixture(),
  python =
    process.env.STUDIO_PYTHON ||
    resolve(".runtime-advanced/original/.venv/bin/python");
const server = createServer();
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as any).port;
await new Promise<void>((r) => server.close(() => r()));
const origin = "http://localhost:3000",
  oldPublic = process.env.PUBLIC_URL;
process.env.PUBLIC_URL = origin;
const legacy = spawn(
  python,
  [
    "scripts/preview-original.py",
    "--port",
    String(port),
    "--public-url",
    origin,
    "--runtime-directory",
    f.directory,
    "--no-reuse-local-credentials",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let logs = "";
for (const stream of [legacy.stdout, legacy.stderr])
  stream.on("data", (c) => (logs = (logs + c).slice(-4000)));
legacy.on("error", (e) => (logs += e.message));
const urls = [`http://127.0.0.1:${port}`, ""],
  cookies = ["", ""],
  checks: string[] = [];
let app: Awaited<ReturnType<typeof createOriginalApp>> | undefined;
async function request(
  index: number,
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
  cookie = cookies[index],
  requestOrigin = origin,
  headers: Record<string, string> = {},
) {
  const r = await fetch(urls[index] + path, {
    method,
    headers: {
      cookie,
      Origin: requestOrigin,
      ...headers,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: r.status,
    body: await r.json(),
    cookie: r.headers.get("set-cookie"),
    headers: r.headers,
  };
}
function stable(value: any): any {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => k !== "created")
        .map(([k, v]) => [k, stable(v)]),
    );
  return value;
}
async function pair(
  label: string,
  path: string,
  body?: unknown,
  method?: string,
  status = 200,
  options: {
    dynamic?: boolean;
    bodies?: unknown[];
    sessions?: string[];
    origin?: string;
    headers?: Record<string, string>;
    paths?: string[];
    normalize?: (body: any, index: number) => unknown;
  } = {},
) {
  const responses = await Promise.all(
    [0, 1].map((i) =>
      request(
        i,
        options.paths?.[i] || path,
        options.bodies?.[i] ?? body,
        method,
        options.sessions?.[i],
        options.origin,
        options.headers,
      ),
    ),
  );
  for (const r of responses)
    assert.equal(r.status, status, label + ": " + JSON.stringify(r.body));
  const bodies = responses.map((r, index) =>
    stable(
      options.normalize
        ? options.normalize(structuredClone(r.body), index)
        : r.body,
    ),
  );
  if (options.dynamic)
    for (const body of bodies) {
      if (body.code) {
        assert.match(body.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
        delete body.code;
      }
      if (body.avatar) {
        assert.ok(avatars.includes(body.avatar.slice(8)));
        assert.equal(
          body.avatar_url,
          "/avatars/" + body.avatar.slice(8) + ".svg",
        );
        delete body.avatar;
        delete body.avatar_url;
      }
    }
  assert.deepEqual(bodies[1], bodies[0], label);
  for (const r of responses)
    if (
      r.cookie?.startsWith("fm_session=") &&
      !r.cookie.startsWith('fm_session=""') &&
      !r.cookie.startsWith("fm_session=;")
    ) {
      assert.match(r.cookie, /HttpOnly/i);
      assert.match(r.cookie, /SameSite=strict/i);
      assert.match(r.cookie, /Path=\//i);
    }
  checks.push(label);
  return responses;
}
try {
  let ready = false;
  for (let n = 0; n < 150; n++) {
    try {
      const r = await fetch(urls[0] + "/health");
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    if (legacy.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, "Original did not start: " + logs);
  const credentials = JSON.parse(
    await readFile(join(f.directory, "credentials.json"), "utf8"),
  );
  // Seed only this temporary reference instance, then migrate real records rather than empty tables.
  const seedLogin = await request(0, "/api/login", credentials);
  assert.equal(seedLogin.status, 200);
  cookies[0] = seedLogin.cookie!.split(";")[0];
  const seedInvite = await request(0, "/api/invite-codes", {
    name: "迁移前邀请码",
    grant_credits: true,
    initial_credits: 11,
    team_id: 1,
  });
  assert.equal(seedInvite.status, 200);
  const seedRegistration = await request(0, "/api/register", {
    name: "Imported",
    nickname: "迁移成员",
    password: "imported-test-password",
    code: seedInvite.body.code,
  });
  assert.equal(seedRegistration.status, 200);
  const seedAdjustment = {
    workspace: 2,
    amount: 100,
    note: "迁移前余额",
    uid: randomUUID(),
  };
  assert.equal(
    (await request(0, "/api/admin/credits/adjust", seedAdjustment)).status,
    200,
  );
  const initialModels = (await request(0, "/api/state")).body;
  assert.equal(
    (
      await request(
        0,
        "/api/settings/models",
        {
          model: "muse-video",
          enabled: false,
          expected_revision: initialModels.model_policy.revision,
        },
        "PATCH",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        0,
        "/api/settings/models",
        {
          model: "gpt-4.1",
          enabled: false,
          expected_revision: 0,
          workspace: 1,
        },
        "PATCH",
      )
    ).status,
    200,
  );
  const seedPrices = Object.fromEntries(
    initialModels.pricing.items.map((p: any) => [p.key, p.amount]),
  );
  seedPrices["MiniMax H3|480|5"] = 17;
  assert.equal(
    (
      await request(
        0,
        "/api/settings/prices",
        {
          values: seedPrices,
          expected_revision: initialModels.pricing.revision,
        },
        "PUT",
      )
    ).status,
    200,
  );
  // Only the disposable fixture is changed: exercise a user-hidden model separately from plugin defaults.
  execFileSync(python, [
    "-c",
    `import sqlite3,json,sys
con=sqlite3.connect(sys.argv[1])
con.execute("INSERT OR REPLACE INTO settings VALUES('hidden_model_ids',?)",(json.dumps(['muse-image']),))
p=json.loads(con.execute("SELECT value FROM settings WHERE key='model_policy'").fetchone()[0]);p['enabled']['muse-image']=False;p['revision']+=1
con.execute("UPDATE settings SET value=? WHERE key='model_policy'",(json.dumps(p),));con.commit()`,
    join(f.directory, "data/studio.sqlite"),
  ]);
  const redacted = join(f.directory, "redacted.json");
  execFileSync(
    python,
    [
      "scripts/export-legacy.py",
      "--database",
      join(f.directory, "data/studio.sqlite"),
      "--output",
      redacted,
      "--source",
      "identity-test",
    ],
    { stdio: "pipe" },
  );
  await assert.rejects(
    importLegacy(
      f.p,
      JSON.parse(await readFile(redacted, "utf8")),
      f.directory,
    ),
    {
      status: 400,
      message:
        "导出文件缺少邀请码，请使用 --include-registration-codes 重新导出",
    },
  );
  checks.push("redacted invitation import fails before changing data");
  cookies[0] = "";
  const snapshot = join(f.directory, "export.json");
  execFileSync(
    python,
    [
      "scripts/export-legacy.py",
      "--database",
      join(f.directory, "data/studio.sqlite"),
      "--output",
      snapshot,
      "--source",
      "identity-test",
      "--include-registration-codes",
    ],
    { stdio: "pipe" },
  );
  const snapshotData = JSON.parse(await readFile(snapshot, "utf8"));
  const inconsistent = structuredClone(snapshotData);
  inconsistent.tables.credit_accounts.find(
    (a: any) => a.workspace === 2,
  ).balance += 1;
  await assert.rejects(importLegacy(f.p, inconsistent, f.directory), {
    status: 409,
    message: "旧账本快照与钱包余额不一致",
  });
  assert.equal(
    Number((await f.db.query("SELECT count(*) FROM users")).rows[0].count),
    0,
  );
  checks.push("inconsistent wallet/history import leaves target empty");
  await importLegacy(f.p, snapshotData, join(f.directory, "data/media"));
  assert.equal(
    (await importLegacy(f.p, snapshotData, f.directory)).alreadyImported,
    true,
  );
  checks.push("complete import retries do not replay credits");
  app = await createOriginalApp(f.p);
  await app.listen(0, "127.0.0.1");
  urls[1] = await app.getUrl();
  assert.equal(
    Number((await f.db.query("SELECT count(*) FROM sessions")).rows[0].count),
    0,
  );
  const archived = JSON.stringify(
    (
      await f.db.query(
        "SELECT payload FROM legacy_records WHERE collection='registration_codes'",
      )
    ).rows,
  );
  assert.ok(!archived.includes(seedInvite.body.code));
  checks.push(
    "registration secrets are encrypted and original sessions are excluded",
  );
  await pair(
    "anonymous workspaces",
    "/api/workspaces",
    undefined,
    undefined,
    401,
  );
  await pair("foreign origin", "/api/login", credentials, undefined, 403, {
    origin: "https://untrusted.invalid",
  });
  await pair("public logout", "/api/logout", {}, undefined, 200);
  await pair("missing login fields", "/api/login", {}, undefined, 422);
  await pair("missing login body", "/api/login", undefined, "POST", 422);
  await pair("null login body", "/api/login", null, "POST", 422);
  await pair("non-object login body", "/api/login", [], undefined, 422);
  await pair(
    "validate before session lookup",
    "/api/workspaces",
    {},
    undefined,
    422,
  );
  await pair(
    "combined path and body errors",
    "/api/workspaces/invalid",
    {},
    "PATCH",
    422,
  );
  await pair("method not allowed", "/api/workspaces", undefined, "DELETE", 405);
  await pair(
    "wrong login types",
    "/api/login",
    { name: 1, password: null },
    undefined,
    422,
  );
  await pair(
    "wrong password",
    "/api/login",
    { ...credentials, password: "incorrect" },
    undefined,
    401,
  );
  const login = await pair("case-insensitive login", "/api/login", {
    ...credentials,
    name: credentials.name.toUpperCase(),
  });
  cookies.splice(0, 2, ...login.map((r) => r.cookie!.split(";")[0]));
  await pair("imported workspaces and default selection", "/api/workspaces");
  const catalog = new StudioCatalog(f.db);
  async function compareModels(label: string) {
    const reference = (await request(0, "/api/state")).body;
    assert.deepEqual(
      await catalog.catalog(),
      reference.model_catalog,
      label + " catalog",
    );
    assert.deepEqual(
      await catalog.runtime("pull"),
      reference.gpu_models,
      label + " GPU runtime",
    );
    assert.deepEqual(
      await catalog.groups(),
      reference.model_groups,
      label + " groups",
    );
    assert.deepEqual(
      await catalog.policy(),
      reference.model_policy,
      label + " policy",
    );
    assert.deepEqual(
      await catalog.prices(),
      reference.pricing,
      label + " prices",
    );
    const team = await one(f.db, "SELECT id FROM workspaces WHERE public_id=1");
    assert.deepEqual(
      await catalog.teamPolicy(f.db, team.id),
      reference.team_model_policies["1"],
      label + " team",
    );
    const selected = reference.workspace_id;
    const workspace = await one(
      f.db,
      "SELECT id FROM workspaces WHERE public_id=$1",
      [selected],
    );
    assert.deepEqual(
      await catalog.effective(f.db, workspace.id),
      reference.model_access,
      label + " effective",
    );
    checks.push(label);
    return reference;
  }
  let modelState = await compareModels(
    "imported catalog, groups, prices, hidden overrides and access",
  );
  await pair(
    "anonymous policy",
    "/api/settings/models",
    { model: "muse-video", enabled: true, expected_revision: 0 },
    "PATCH",
    401,
    { sessions: ["", ""] },
  );
  await pair(
    "invalid policy before authentication",
    "/api/settings/models",
    {},
    "PATCH",
    422,
    { sessions: ["", ""] },
  );
  await pair(
    "unknown model",
    "/api/settings/models",
    { model: "unknown", enabled: true, expected_revision: 0 },
    "PATCH",
    400,
  );
  await pair(
    "hidden model enable",
    "/api/settings/models",
    { model: "muse-image", enabled: true, expected_revision: 0 },
    "PATCH",
    400,
  );
  await pair(
    "personal model policy rejected",
    "/api/settings/models",
    { model: "muse-video", enabled: true, expected_revision: 0, workspace: 2 },
    "PATCH",
    404,
  );
  await pair(
    "stale global policy",
    "/api/settings/models",
    { model: "muse-video", enabled: true, expected_revision: 0 },
    "PATCH",
    409,
  );
  await pair(
    "stale team policy",
    "/api/settings/models",
    { model: "muse-video", enabled: true, expected_revision: 0, workspace: 1 },
    "PATCH",
    409,
  );
  const family = Object.keys(modelState.model_groups).find(
    (k) => modelState.model_groups[k].models.length > 1,
  )!;
  assert.ok(family);
  await pair(
    "plugin family switch",
    "/api/settings/models",
    {
      model: family,
      enabled: false,
      group: true,
      expected_revision: modelState.model_policy.revision,
    },
    "PATCH",
  );
  await pair(
    "original boolean and revision coercion",
    "/api/settings/models",
    {
      model: "muse-video",
      enabled: "yes",
      group: "off",
      expected_revision: String(modelState.model_policy.revision + 1),
    },
    "PATCH",
  );
  await pair(
    "team family switch",
    "/api/settings/models",
    {
      model: family,
      enabled: false,
      group: true,
      workspace: 1,
      expected_revision: modelState.team_model_policies["1"].revision,
    },
    "PATCH",
  );
  for (const invalid of ["invalid", 7, null, []])
    await pair(
      "invalid policy boolean " + JSON.stringify(invalid),
      "/api/settings/models",
      { model: "muse-video", enabled: invalid, expected_revision: 0 },
      "PATCH",
      422,
    );
  await pair(
    "stale price revision",
    "/api/settings/prices",
    { values: {}, expected_revision: 1 },
    "PUT",
    409,
  );
  await pair(
    "missing tiers",
    "/api/settings/prices",
    { values: {}, expected_revision: modelState.pricing.revision },
    "PUT",
    400,
  );
  await pair(
    "strict price types",
    "/api/settings/prices",
    {
      values: { one: true, two: "1", three: 1.5 },
      expected_revision: modelState.pricing.revision,
    },
    "PUT",
    422,
  );
  await pair(
    "price map type",
    "/api/settings/prices",
    { values: [], expected_revision: modelState.pricing.revision },
    "PUT",
    422,
  );
  const prices = Object.fromEntries(
    modelState.pricing.items.map((p: any) => [p.key, p.amount]),
  );
  await pair(
    "price range",
    "/api/settings/prices",
    {
      values: { ...prices, "muse-video|5": 0 },
      expected_revision: modelState.pricing.revision,
    },
    "PUT",
    400,
  );
  await pair(
    "save complete plugin tiers",
    "/api/settings/prices",
    {
      values: { ...prices, "muse-video|5": 31 },
      expected_revision: modelState.pricing.revision,
    },
    "PUT",
  );
  await pair("prices wrong method", "/api/settings/prices", {}, "POST", 405);
  await compareModels("edited catalog settings and effective permissions");
  const importedInvites = await pair(
    "imported invitation policy remains usable",
    "/api/invite-codes",
  );
  assert.deepEqual(importedInvites[0].body, importedInvites[1].body);
  const importedHistory = await pair(
    "imported ledger snapshots and IDs",
    "/api/credits",
  );
  assert.deepEqual(importedHistory[0].body, importedHistory[1].body);
  await pair(
    "imported adjustment retry is idempotent",
    "/api/admin/credits/adjust",
    seedAdjustment,
  );
  await pair(
    "changed imported adjustment is rejected",
    "/api/admin/credits/adjust",
    { ...seedAdjustment, note: "改变原因" },
    undefined,
    409,
  );
  await pair("administrator account names and balances", "/api/admin/credits");
  await pair(
    "invalid history cursor",
    "/api/credits?before=bad",
    undefined,
    undefined,
    422,
  );
  await pair(
    "invalid administrator workspace query",
    "/api/admin/credits?workspace=bad",
    undefined,
    undefined,
    422,
  );
  await pair(
    "invalid selected workspace",
    "/api/credits?workspace=bad",
    undefined,
    undefined,
    400,
  );
  await pair(
    "empty selected workspace",
    "/api/credits?workspace=",
    undefined,
    undefined,
    400,
  );
  await pair(
    "last repeated workspace parameter wins",
    "/api/credits?workspace=1&workspace=2",
  );
  await pair(
    "workspace header precedes query",
    "/api/credits?workspace=999999",
    undefined,
    undefined,
    200,
    { headers: { "X-Workspace-Id": "2" } },
  );
  await pair(
    "denied selected workspace",
    "/api/credits?workspace=999999",
    undefined,
    undefined,
    403,
  );
  const adjustment = {
    workspace: 2,
    amount: 43,
    note: " 测试调整 ",
    uid: randomUUID(),
  };
  await pair("credit adjustment", "/api/admin/credits/adjust", adjustment);
  await pair(
    "UUID normalization on duplicate adjustment",
    "/api/admin/credits/adjust",
    { ...adjustment, uid: adjustment.uid.toUpperCase() },
  );
  for (const [label, uid] of [
    ["compact", adjustment.uid.replaceAll("-", "")],
    ["braced", "{" + adjustment.uid + "}"],
    ["URN", "urn:uuid:" + adjustment.uid],
  ])
    await pair(
      label + " UUID preserves idempotency",
      "/api/admin/credits/adjust",
      { ...adjustment, uid },
    );
  await pair(
    "changed idempotent credit payload",
    "/api/admin/credits/adjust",
    { ...adjustment, amount: 44 },
    undefined,
    409,
  );
  await pair(
    "cross-workspace credit replay rejected",
    "/api/admin/credits/adjust",
    { ...adjustment, workspace: 1 },
    undefined,
    409,
  );
  await pair("credit history snapshots", "/api/credits");
  await pair("credit pagination boundary", "/api/credits?before=3");
  await pair("zero cursor follows original behavior", "/api/credits?before=0");
  await pair(
    "negative cursor follows original behavior",
    "/api/credits?before=-1",
  );
  await pair(
    "unknown admin history workspace",
    "/api/admin/credits?workspace=999999",
  );
  await pair(
    "deduct beyond available balance",
    "/api/admin/credits/adjust",
    { ...adjustment, uid: randomUUID(), amount: -1000 },
    undefined,
    409,
  );
  await pair(
    "zero adjustment",
    "/api/admin/credits/adjust",
    { ...adjustment, uid: randomUUID(), amount: 0 },
    undefined,
    400,
  );
  await pair(
    "oversized adjustment",
    "/api/admin/credits/adjust",
    { ...adjustment, uid: randomUUID(), amount: 1000000001 },
    undefined,
    400,
  );
  await pair(
    "blank adjustment reason",
    "/api/admin/credits/adjust",
    { ...adjustment, uid: randomUUID(), note: " " },
    undefined,
    400,
  );
  await pair(
    "strict integer adjustment",
    "/api/admin/credits/adjust",
    { ...adjustment, amount: "5" },
    undefined,
    422,
  );
  await pair(
    "invalid adjustment UUID",
    "/api/admin/credits/adjust",
    { ...adjustment, uid: "bad" },
    undefined,
    422,
  );
  await pair(
    "invalid adjustment UUID type",
    "/api/admin/credits/adjust",
    { ...adjustment, uid: 1 },
    undefined,
    422,
  );
  await pair(
    "UUID invalid character response",
    "/api/admin/credits/adjust",
    { ...adjustment, uid: "x".repeat(32) },
    undefined,
    422,
  );
  await pair(
    "UUID invalid grouping response",
    "/api/admin/credits/adjust",
    { ...adjustment, uid: "0000000-00000-0000-0000-000000000000" },
    undefined,
    422,
  );
  await pair(
    "invalid workspace id",
    "/api/workspaces/not-an-id/select",
    {},
    undefined,
    422,
  );
  await pair(
    "workspace denied",
    "/api/workspaces/999999/select",
    {},
    undefined,
    403,
  );
  const password = "identity-test-password";
  const members = await pair(
    "administrator creates member",
    "/api/users",
    { name: "Member", nickname: "成员", password },
    undefined,
    200,
    { dynamic: true },
  );
  const memberId = members[0].body.id;
  const teams = await pair(
    "team with deduplicated membership",
    "/api/workspaces",
    { name: "测试团队", members: [memberId, memberId] },
  );
  const teamId = teams[0].body.id;
  const invites = await pair(
    "registration code policy",
    "/api/invite-codes",
    {
      name: "注册测试",
      grant_credits: true,
      initial_credits: 37,
      team_id: teamId,
    },
    undefined,
    200,
    { dynamic: true },
  );
  const inviteId = invites[0].body.id;
  const registrations = invites.map((r) => ({
    name: "Registered",
    nickname: "注册成员",
    password,
    code: " " + r.body.code.toLowerCase() + " ",
  }));
  const registered = await pair(
    "registration signs in",
    "/api/register",
    undefined,
    "POST",
    200,
    { bodies: registrations },
  );
  const registeredCookies = registered.map((r) => r.cookie!.split(";")[0]);
  await pair(
    "member cannot edit model policy",
    "/api/settings/models",
    { model: "muse-video", enabled: true, expected_revision: 1 },
    "PATCH",
    403,
    { sessions: registeredCookies },
  );
  await pair(
    "member cannot edit prices",
    "/api/settings/prices",
    { values: {}, expected_revision: 1 },
    "PUT",
    403,
    { sessions: registeredCookies },
  );
  const registeredSpaces = await pair(
    "registration default team",
    "/api/workspaces",
    undefined,
    undefined,
    200,
    { sessions: registeredCookies },
  );
  const personalId = registeredSpaces[0].body.workspaces.find(
    (w: any) => w.kind === "personal",
  ).id;
  await pair(
    "registration ledger retains administrator and reason",
    "/api/credits?workspace=" + personalId,
    undefined,
    undefined,
    200,
    { sessions: registeredCookies },
  );
  await pair(
    "member cannot view credit administration",
    "/api/admin/credits",
    undefined,
    undefined,
    403,
    { sessions: registeredCookies },
  );
  await pair(
    "member cannot change credit balances",
    "/api/admin/credits/adjust",
    adjustment,
    undefined,
    403,
    { sessions: registeredCookies },
  );
  await pair(
    "duplicate registration",
    "/api/register",
    undefined,
    "POST",
    409,
    { bodies: registrations },
  );
  // Inspect the original ledger and the new ledger independently; never use paid provider calls.
  const oldBalance = JSON.parse(
    execFileSync(
      python,
      [
        "-c",
        "import sqlite3,json,sys; c=sqlite3.connect(sys.argv[1]);print(json.dumps(c.execute(\"SELECT a.balance FROM credit_accounts a JOIN workspaces w ON w.id=a.workspace JOIN users u ON u.id=w.owner WHERE u.name='Registered' AND w.kind='personal'\").fetchone()[0]))",
        join(f.directory, "data/studio.sqlite"),
      ],
      { encoding: "utf8" },
    ),
  );
  const newBalance = (
    await f.db.query(
      "SELECT balance FROM wallets a JOIN workspaces w ON w.id=a.workspace_id JOIN users u ON u.id=w.owner_id WHERE u.name='Registered' AND w.kind='personal'",
    )
  ).rows[0].balance;
  assert.equal(Number(newBalance), 37);
  assert.equal(oldBalance, 37);
  checks.push("registration credit is exactly 37");
  await pair(
    "team revision save",
    "/api/workspaces/" + teamId,
    { name: "更新团队", members: [memberId], expected_revision: 1 },
    "PATCH",
  );
  await pair(
    "stale team revision",
    "/api/workspaces/" + teamId,
    { name: "陈旧修改", members: [], expected_revision: 1 },
    "PATCH",
    409,
  );
  await pair(
    "revoked default falls back to personal",
    "/api/workspaces",
    undefined,
    undefined,
    200,
    { sessions: registeredCookies },
  );
  await pair(
    "revoked team cannot be selected",
    "/api/workspaces/" + teamId + "/select",
    {},
    undefined,
    403,
    { sessions: registeredCookies },
  );
  await pair(
    "invite revision save",
    "/api/invite-codes/" + inviteId,
    { name: "编辑名称", expected_revision: 1 },
    "PATCH",
    200,
    { dynamic: true },
  );
  await pair(
    "stale invite revision",
    "/api/invite-codes/" + inviteId,
    { enabled: false, expected_revision: 1 },
    "PATCH",
    409,
  );
  await pair(
    "strict invite input",
    "/api/invite-codes",
    { name: "invalid", initial_credits: "2", grant_credits: 1, extra: true },
    undefined,
    422,
  );
  await pair(
    "nullable invite policy rejected",
    "/api/invite-codes/" + inviteId,
    { name: null, expected_revision: 2 },
    "PATCH",
    400,
  );
  await pair(
    "blank team name",
    "/api/workspaces",
    { name: " ", members: [] },
    undefined,
    400,
  );
  await pair(
    "missing team members",
    "/api/workspaces",
    { name: "missing", members: [99999] },
    undefined,
    400,
  );
  await pair(
    "fractional member id",
    "/api/workspaces",
    { name: "invalid", members: [1.5] },
    undefined,
    422,
  );
  await pair(
    "invalid member id type",
    "/api/workspaces",
    { name: "invalid", members: ["broken", null] },
    undefined,
    422,
  );
  await pair(
    "too many member ids",
    "/api/workspaces",
    { name: "invalid", members: Array(501).fill(1) },
    undefined,
    422,
  );
  await pair(
    "duplicate team name",
    "/api/workspaces",
    { name: "更新团队", members: [] },
    undefined,
    409,
  );
  await pair(
    "member cannot administer",
    "/api/workspaces",
    { name: "denied" },
    undefined,
    403,
    { sessions: registeredCookies },
  );
  await pair(
    "profile edits",
    "/api/me",
    { nickname: "编辑昵称", avatar: "builtin:moon" },
    "PATCH",
    200,
    { sessions: registeredCookies },
  );
  await pair(
    "invalid avatar rejected",
    "/api/me",
    { avatar: "upload:fake" },
    "PATCH",
    400,
    { sessions: registeredCookies },
  );
  await pair(
    "wrong current password",
    "/api/me/password",
    { current_password: "wrong", password: "new-test-password" },
    undefined,
    400,
    { sessions: registeredCookies },
  );
  await pair(
    "own password change",
    "/api/me/password",
    { current_password: password, password: "new-test-password" },
    undefined,
    200,
    { sessions: registeredCookies },
  );
  await pair(
    "current session retained",
    "/api/workspaces",
    undefined,
    undefined,
    200,
    { sessions: registeredCookies },
  );
  const memberLogin = await pair("member login", "/api/login", {
    name: "member",
    password,
  });
  const memberCookies = memberLogin.map((r) => r.cookie!.split(";")[0]);
  await pair("disable member", "/api/users/" + memberId + "/disable", {});
  await pair(
    "disable is idempotent",
    "/api/users/" + memberId + "/disable",
    {},
  );
  await pair(
    "disabled sessions revoked",
    "/api/workspaces",
    undefined,
    undefined,
    401,
    { sessions: memberCookies },
  );
  await pair("disabling admin is a no-op", "/api/users/1/disable", {});
  await pair(
    "disabling absent member is a no-op",
    "/api/users/99999/disable",
    {},
  );
  await pair("retired invitation links", "/api/invites", {}, undefined, 410);
  const migratedRegistration = await pair(
    "old invitation registers after migration",
    "/api/register",
    {
      name: "AfterMigration",
      nickname: "迁移后注册",
      password,
      code: seedInvite.body.code.toLowerCase(),
    },
  );
  const migratedSessions = migratedRegistration.map(
    (r) => r.cookie!.split(";")[0],
  );
  const migratedPersonal: number[] = [];
  const migratedSpaces = await pair(
    "old invitation retains default team",
    "/api/workspaces",
    undefined,
    undefined,
    200,
    {
      sessions: migratedSessions,
      normalize: (body, index) => {
        // PostgreSQL sequences do not reuse numbers consumed by a rolled-back insert.
        // Existing imported IDs remain exact; newly assigned IDs are compared by resource identity.
        const personal = body.workspaces.find(
          (w: any) => w.kind === "personal",
        );
        assert.ok(Number.isSafeInteger(personal.id) && personal.id > 3);
        migratedPersonal[index] = personal.id;
        personal.id = "new-personal-workspace";
        return body;
      },
    },
  );
  const migratedCredits = await pair(
    "old invitation grants only its original amount",
    "/api/credits",
    undefined,
    undefined,
    200,
    {
      sessions: migratedSessions,
      paths: migratedPersonal.map((id) => "/api/credits?workspace=" + id),
      normalize: (body) => {
        body.wallet.workspace = "new-personal-workspace";
        for (const entry of body.history)
          entry.workspace = "new-personal-workspace";
        return body;
      },
    },
  );
  assert.equal(migratedCredits[1].body.wallet.balance, 11);
  const oldPolicies = await Promise.all(
    [0, 1].map((index) => request(index, "/api/invite-codes")),
  );
  const policy = oldPolicies.map((r) =>
    r.body.items.find((i: any) => i.id === seedInvite.body.id),
  );
  assert.deepEqual(policy[1], policy[0]);
  assert.equal(policy[1].uses, 2);
  checks.push("imported registration usage continues from its original count");
  const identity = new OriginalIdentity(f.p);
  assert.ok(await identity.actor(cookies[1].slice(11)));
  await mkdir(".runtime-advanced/identity-parity", { recursive: true });
  await writeFile(
    ".runtime-advanced/identity-parity/report.json",
    JSON.stringify(
      {
        passed: true,
        database: process.env.TEST_DATABASE_URL
          ? "PostgreSQL isolated schema"
          : "PGlite",
        checks,
      },
      null,
      2,
    ),
  );
  console.log(
    "Original/Nest identity parity: " + checks.length + " checks passed",
  );
} finally {
  if (oldPublic === undefined) delete process.env.PUBLIC_URL;
  else process.env.PUBLIC_URL = oldPublic;
  await app?.close();
  legacy.kill("SIGTERM");
  await new Promise<void>((r) => {
    if (legacy.exitCode !== null) r();
    else legacy.once("exit", () => r());
  });
  await f.cleanup();
}
