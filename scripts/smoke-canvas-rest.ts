/** Compare the opt-in Canvas REST operations over loopback HTTP. */
import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createOriginalApp } from "../apps/api/src/original.js";
import { canvasesFixture } from "../tests/helpers/canvases.js";
import { verifyCanvasRunsHttp } from "./canvas-runs-http-cases.js";
import { verifyStoryboardHttp } from "./storyboard-http-cases.js";

const canvases = "/api/canvases";
const origin = "http://localhost:3000";
const python =
  process.env.STUDIO_PYTHON ||
  resolve(".runtime-advanced/original/.venv/bin/python");
const runtime = await mkdtemp(join(tmpdir(), "fumiao-canvas-rest-"));
const existingOrigin = process.env.PUBLIC_URL;
const epoch = Math.floor(Date.now() / 1000);
const checks: string[] = [];
const storyboard = process.argv.includes("--storyboard");
const pause = join(runtime, "pause-storyboard-probe");
let fixture: Awaited<ReturnType<typeof canvasesFixture>> | undefined;
let app: Awaited<ReturnType<typeof createOriginalApp>> | undefined;
let legacy: ChildProcess | undefined;
let logs = "";

export type Backend = {
  url: string;
  sessions: Partial<Record<"admin" | "member", string>>;
  aliases: Map<string, string>;
};
type RequestOptions = {
  actor?: "admin" | "member";
  body?: unknown;
  raw?: string | Buffer;
  contentType?: string;
  origin?: string;
  workspace?: string;
  headers?: Record<string, string>;
};
export async function request(
  backend: Backend,
  method: string,
  path: string,
  options: RequestOptions = {},
) {
  const headers = new Headers({
    origin: options.origin ?? origin,
    ...options.headers,
  });
  if (options.actor) headers.set("cookie", backend.sessions[options.actor]!);
  if (options.workspace !== undefined)
    headers.set("x-workspace-id", options.workspace);
  if (options.contentType || options.body !== undefined)
    headers.set("content-type", options.contentType ?? "application/json");
  // Uvicorn closes the socket after an unhandled error, even after sending its 500.
  // Use a fresh connection per comparison so the next request cannot reuse it.
  headers.set("connection", "close");
  const payload = options.raw ?? JSON.stringify(options.body);
  const response = await fetch(backend.url + path, {
    method,
    headers,
    redirect: "manual",
    body:
      payload === undefined ? undefined : Uint8Array.from(Buffer.from(payload)),
    signal: AbortSignal.timeout(20_000),
  });
  const type = response.headers.get("content-type");
  const location = response.headers.get("location");
  const bytes = Buffer.from(await response.arrayBuffer());
  const text = bytes.toString();
  return {
    status: response.status,
    type,
    allow: response.headers.get("allow"),
    location: location ? location.replace(backend.url, "") : null,
    cookie: response.headers.get("set-cookie")?.split(";")[0],
    body: text && type === "application/json" ? JSON.parse(text) : text,
    text,
    bytes,
    headers: response.headers,
  };
}
function normalize(value: any, backend: Backend): any {
  if (Array.isArray(value))
    return value.map((part) => normalize(part, backend));
  if (!value || typeof value !== "object") return value;
  const result = { ...value };
  if (typeof result.id === "string" && backend.aliases.has(result.id))
    result.id = backend.aliases.get(result.id);
  for (const field of ["created", "updated"])
    if (Object.hasOwn(result, field)) {
      assert.ok(Number.isInteger(result[field]), field);
      assert.ok(
        result[field] >= epoch && result[field] <= Date.now() / 1000,
        field,
      );
      result[field] = "<epoch>";
    }
  if (result.projects) {
    const sorted = [...result.projects].sort(
      (a, b) => b.updated - a.updated || b.id.localeCompare(a.id, "en"),
    );
    assert.deepEqual(result.projects, sorted, "updated DESC, id DESC");
    // Successful creates mint independent IDs, so same-second ties may order differently.
    result.projects = result.projects
      .map((project: any) => normalize(project, backend))
      .sort((a: any, b: any) => a.id.localeCompare(b.id, "en"));
  }
  return result;
}
function comparable(
  response: Awaited<ReturnType<typeof request>>,
  backend: Backend,
) {
  const {
    cookie: _,
    text: _text,
    bytes: _bytes,
    headers: _headers,
    body,
    ...rest
  } = response;
  return { ...rest, body: normalize(body, backend) };
}

try {
  process.env.PUBLIC_URL = origin;
  const f = (fixture = await canvasesFixture());
  const portProbe = createServer();
  await new Promise<void>((ready) => portProbe.listen(0, "127.0.0.1", ready));
  const { port } = portProbe.address() as AddressInfo;
  await new Promise<void>((closed) => portProbe.close(() => closed()));
  const env = { ...process.env };
  if (storyboard) {
    assert.ok(
      env.TEST_DATABASE_URL && env.TEST_REDIS_URL,
      "Use isolated PostgreSQL and Redis for storyboard HTTP parity",
    );
    env.STORYBOARD_TEST_FFPROBE = execFileSync("which", ["ffprobe"], {
      encoding: "utf8",
    }).trim();
    env.STORYBOARD_TEST_PAUSE = pause;
    env.PATH = runtime + delimiter + env.PATH;
    await writeFile(
      join(runtime, "ffprobe"),
      '#!/bin/sh\nwhile [ -f "$STORYBOARD_TEST_PAUSE" ]; do sleep 0.05; done\nexec "$STORYBOARD_TEST_FFPROBE" "$@"\n',
      { mode: 0o700 },
    );
  }
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
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  for (const stream of [legacy.stdout!, legacy.stderr!])
    stream.on("data", (chunk) => (logs = (logs + chunk).slice(-12_000)));
  legacy.on("error", (error) => (logs += error.message));

  app = await createOriginalApp(f.p);
  await app.listen(0, "127.0.0.1");
  const original: Backend = {
    url: "http://127.0.0.1:" + port,
    sessions: {},
    aliases: new Map(),
  };
  const target: Backend = {
    url: await app.getUrl(),
    sessions: {},
    aliases: new Map(),
  };
  const backends = [original, target];
  let ready = false;
  for (let attempt = 0; attempt < 100 && legacy.exitCode === null; attempt++) {
    const result = await request(original, "GET", canvases).catch(
      () => undefined,
    );
    if (result?.status === 401) {
      ready = true;
      break;
    }
    await delay(50);
  }
  assert.ok(ready, "pinned original HTTP server started");

  async function login(
    backend: Backend,
    actor: "admin" | "member",
    password: string,
  ) {
    const response = await request(backend, "POST", "/api/login", {
      body: { name: actor, password },
    });
    assert.equal(response.status, 200, actor);
    assert.ok(response.cookie?.startsWith("fm_session="));
    backend.sessions[actor] = response.cookie;
  }
  const password = "canvas-storage-fixture";
  const credentials = JSON.parse(
    await readFile(join(runtime, "credentials.json"), "utf8"),
  );
  await Promise.all([
    login(original, "admin", credentials.password),
    login(target, "admin", password),
  ]);
  assert.equal(
    (
      await request(original, "POST", "/api/users", {
        actor: "admin",
        body: { name: "member", nickname: "成员", password },
      })
    ).status,
    200,
  );
  const team = String(f.team.public_id);
  const memberId = Number(f.member.public_id);
  const personal = String(f.workspace.public_id);
  const memberSpace = String(f.memberSpace.public_id);
  async function setTeamMembers(members: number[], revision: number) {
    for (const backend of backends)
      assert.equal(
        (
          await request(backend, "PATCH", "/api/workspaces/" + team, {
            actor: "admin",
            body: { name: f.team.name, members, expected_revision: revision },
          })
        ).status,
        200,
        backend.url,
      );
  }
  await setTeamMembers([memberId], 1);
  await Promise.all(
    backends.map((backend) => login(backend, "member", password)),
  );

  async function compare(
    label: string,
    method: string,
    path: string | ((backend: Backend) => string),
    status: number,
    options: RequestOptions = {},
    alias?: string,
  ) {
    const results = await Promise.all(
      backends.map(async (backend) => {
        const response = await request(
          backend,
          method,
          typeof path === "string" ? path : path(backend),
          options,
        );
        assert.equal(
          response.status,
          status,
          label +
            " " +
            backend.url +
            ": " +
            JSON.stringify(response.body).slice(0, 1200),
        );
        if (alias) {
          assert.match(response.body.id, /^[a-f0-9]{32}$/);
          backend.aliases.set(response.body.id, alias);
        }
        return comparable(response, backend);
      }),
    );
    assert.deepEqual(results[1], results[0], label);
    checks.push(label);
    return results[1].body;
  }
  const project =
    (alias: string, suffix = "") =>
    (backend: Backend) => {
      const id = [...backend.aliases].find(([, name]) => name === alias)?.[0];
      assert.ok(id, alias);
      return canvases + "/" + id + suffix;
    };
  const missing = canvases + "/missing";
  const admin = { actor: "admin" } as const;
  const member = { actor: "member" } as const;
  const invalidDoc = {
    expected_revision: 0,
    title: "",
    document: {
      nodes: [{ id: "not valid", type: "audio", y: 999999, extra: true }],
    },
    extra: true,
  };
  const save = (
    revision: number,
    title = "团队修改",
    document: object = {},
  ) => ({
    expected_revision: revision,
    title,
    document,
  });
  const node = (id: string, type: string, values = {}) => ({
    id,
    type,
    x: 0,
    y: 0,
    ...values,
  });

  for (const [method, path] of [
    ["GET", canvases],
    ["GET", missing],
    ["DELETE", missing],
    ["POST", missing + "/duplicate"],
  ])
    await compare("anonymous " + method + " " + path, method, path, 401);
  await compare("origin guard precedes malformed JSON", "POST", canvases, 403, {
    origin: "https://untrusted.invalid",
    raw: "{",
    contentType: "application/json",
  });
  await compare(
    "origin guard precedes unsupported method",
    "PATCH",
    canvases,
    403,
    { origin: "https://untrusted.invalid" },
  );
  await compare(
    "unsupported method precedes body decoding",
    "DELETE",
    canvases,
    405,
    { raw: "{", contentType: "application/json" },
  );
  await compare("HEAD shares original method rejection", "HEAD", missing, 405);
  await compare("document only allows PUT", "POST", missing + "/document", 405);
  await compare(
    "duplicate only allows POST",
    "GET",
    missing + "/duplicate",
    405,
  );
  await compare(
    "slash redirects without reading body",
    "POST",
    canvases + "/?workspace=0",
    307,
    { raw: "{", contentType: "application/json" },
  );
  await compare("case-sensitive route", "GET", "/API/CANVASES", 404);
  await compare(
    "encoded slash is a path separator",
    "GET",
    canvases + "/a%2Fb",
    404,
  );
  await compare(
    "opaque project ID with a literal percent",
    "GET",
    canvases + "/a%252Fb",
    404,
    admin,
  );
  await compare(
    "opaque project ID with a NUL",
    "GET",
    canvases + "/%00",
    404,
    admin,
  );
  await compare("missing create body", "POST", canvases, 422);
  await compare("explicit null create body", "POST", canvases, 422, {
    body: null,
  });
  await compare("missing save body", "PUT", missing + "/document", 422);
  await compare(
    "structural validation precedes missing session/project",
    "PUT",
    missing + "/document",
    422,
    { body: invalidDoc },
  );
  await compare(
    "unknown fields rejected with vendor JSON",
    "POST",
    canvases,
    422,
    { body: { extra: true }, contentType: "application/vnd.fumiao+json" },
  );
  for (const raw of [
    "{",
    '{"title":',
    '{"title":"😀",}',
    '{"title":"\\q"}',
    "{} {}",
    '{"x": [1,]}',
  ])
    await compare("malformed JSON " + raw, "POST", canvases, 422, {
      raw,
      contentType: "application/json",
    });
  await compare(
    "no content type retains raw input in error",
    "POST",
    canvases,
    422,
    { raw: "{}" },
  );
  await compare(
    "explicit non-JSON retains raw input in error",
    "PUT",
    missing + "/document",
    422,
    { raw: "{}", contentType: "text/plain" },
  );
  await compare("unreadable JSON bytes", "POST", canvases, 400, {
    raw: Buffer.from([0x81]),
    contentType: "application/json",
  });
  await compare("unreadable raw validation error", "POST", canvases, 500, {
    raw: Buffer.from([0x81]),
    contentType: "text/plain",
  });
  await compare("non-finite input error", "POST", canvases, 500, {
    raw: '{"title":Infinity}',
    contentType: "application/json",
  });
  await compare(
    "duplicate JSON key takes the last value",
    "POST",
    canvases,
    401,
    { raw: '{"title":NaN,"title":"ok"}', contentType: "application/json" },
  );
  await compare("UTF-16 JSON reaches authentication", "POST", canvases, 401, {
    raw: Buffer.from("\uFEFF{}", "utf16le"),
    contentType: "application/json",
  });
  await compare(
    "JSON valid but blank title needs a session",
    "POST",
    canvases,
    401,
    { body: { title: " " } },
  );
  await compare(
    "valid save body needs a session before title checks",
    "PUT",
    missing + "/document",
    401,
    { body: save(1, " ") },
  );
  await compare(
    "blank title precedes inaccessible workspace",
    "POST",
    canvases,
    400,
    { ...admin, workspace: "invalid", body: { title: "\u001c\u3000" } },
  );
  await compare(
    "blank save title precedes missing project",
    "PUT",
    missing + "/document",
    400,
    { ...admin, body: save(1, " ") },
  );
  await compare(
    "invalid workspace needs a session",
    "GET",
    canvases + "?workspace=bad",
    401,
  );
  await compare(
    "invalid workspace has original 400",
    "GET",
    canvases + "?workspace=bad",
    400,
    admin,
  );
  await compare(
    "signed 64-bit workspace overflow",
    "GET",
    canvases + "?workspace=9223372036854775808",
    500,
    admin,
  );
  await compare(
    "unassigned workspace within signed 64-bit range",
    "GET",
    canvases + "?workspace=9007199254740993",
    403,
    admin,
  );
  await compare(
    "empty workspace header falls back to query",
    "GET",
    canvases + "?workspace=0_０" + team,
    200,
    { ...admin, workspace: "" },
  );
  await compare(
    "workspace header overrides last query value",
    "GET",
    canvases + "?workspace=" + memberSpace + "&workspace=bad",
    200,
    { ...admin, workspace: team },
  );
  await compare(
    "last query workspace overrides first value",
    "GET",
    canvases + "?workspace=bad&workspace=" + memberSpace,
    403,
    admin,
  );
  await compare(
    "admin cannot select member's personal space",
    "POST",
    canvases,
    403,
    { ...admin, workspace: memberSpace, body: {} },
  );

  const first = await compare(
    "default project document",
    "POST",
    canvases,
    200,
    { ...admin, body: {} },
    "personal",
  );
  assert.equal(first.workspace, Number(personal));
  assert.ok(!Object.hasOwn(first.document, "shots"));
  const template = await compare(
    "explicit workspace and template",
    "POST",
    canvases,
    200,
    {
      ...admin,
      workspace: team,
      body: { template: "portrait", ratio: "9:16" },
    },
    "team",
  );
  assert.equal(template.document.shots.length, 6);
  assert.equal(template.workspace, Number(team));
  await compare(
    "member uses their personal default",
    "POST",
    canvases,
    200,
    { ...member, body: { title: "成员私有" } },
    "private",
  );
  await compare(
    "admin cannot read member's personal project",
    "GET",
    project("private"),
    404,
    admin,
  );
  await compare(
    "member cannot read admin's personal project",
    "GET",
    project("personal"),
    404,
    member,
  );
  await compare(
    "member cannot delete admin's personal project",
    "DELETE",
    project("personal"),
    404,
    member,
  );
  await compare(
    "read ignores invalid workspace selection",
    "GET",
    project("team", "?workspace=bad"),
    200,
    member,
  );
  await compare(
    "save schema precedes project access",
    "PUT",
    project("personal", "/document"),
    422,
    { ...member, body: invalidDoc },
  );
  await compare(
    "project access precedes revision check",
    "PUT",
    project("personal", "/document"),
    404,
    { ...member, body: save(999) },
  );
  await compare(
    "missing project precedes revision check",
    "PUT",
    missing + "/document",
    404,
    { ...admin, body: save(999) },
  );
  await compare(
    "revision check precedes invalid graph",
    "PUT",
    project("team", "/document"),
    409,
    { ...member, body: save(999, "冲突", { shots: ["missing"] }) },
  );
  await compare(
    "invalid graph at current revision",
    "PUT",
    project("team", "/document"),
    400,
    { ...member, body: save(1, "有误", { shots: ["missing"] }) },
  );
  await compare(
    "team member cannot delete admin's canvas",
    "DELETE",
    project("team"),
    403,
    member,
  );
  const largeText = "😀".repeat(12_000);
  const largeDocument = {
    nodes: Array.from({ length: 70 }, (_, index) =>
      node("large-" + index, "text", { text: largeText }),
    ),
  };
  const large = await compare(
    "valid canvas document above the generic 3 MiB parser limit",
    "PUT",
    project("personal", "/document"),
    200,
    { ...admin, body: save(1, "较长文档", largeDocument) },
  );
  assert.equal(large.document.nodes.at(-1).text, largeText);

  // Seed matching media metadata without a provider, upload, or object-store request.
  const localAsset = "a".repeat(32);
  const foreignAsset = "b".repeat(32);
  execFileSync(python, [
    "-c",
    "import sqlite3,sys\nwith sqlite3.connect(sys.argv[1]) as db:\n" +
      "    for key, wid in ((sys.argv[2], sys.argv[4]), (sys.argv[3], sys.argv[5])):\n" +
      "        db.execute(\"insert into media(id,kind,owner,workspace,size,mime) values(?,'ref',?,?,0,'image/png')\", (key, sys.argv[6], wid))",
    join(runtime, "data", "studio.sqlite"),
    localAsset,
    foreignAsset,
    team,
    memberSpace,
    String(memberId),
  ]);
  await f.asset(localAsset, "ref", f.team, f.member);
  await f.asset(foreignAsset, "ref", f.memberSpace, f.member);
  const text = "\u0000 😀 /media/" + localAsset;
  const saved = await compare(
    "member save preserves text, defaults, and explicit shots",
    "PUT",
    project("team", "/document?workspace=invalid"),
    200,
    {
      ...member,
      workspace: personal,
      body: {
        ...save(1, " \u3000团队\u0000😀 ", {
          nodes: [
            node("note", "text", { text, x: "1.50" }),
            node("cover", "image", { media_id: localAsset }),
          ],
          edges: [{ id: "prompt", source: "note", target: "cover" }],
          shots: [],
        }),
        expected_revision: "1",
      },
    },
  );
  assert.equal(saved.revision, 2);
  assert.equal(saved.document.nodes[0].text, text);
  assert.deepEqual(saved.document.shots, []);
  await compare(
    "foreign media rejected even when editor owns it",
    "PUT",
    project("team", "/document"),
    404,
    {
      ...member,
      body: save(2, "越界", {
        nodes: [node("cover", "image", { media_id: foreignAsset })],
      }),
    },
  );
  await compare(
    "duplicate media roles produce original plain 500",
    "PUT",
    project("team", "/document"),
    500,
    {
      ...member,
      body: save(2, "回滚", {
        nodes: [
          node("cover", "image", {
            media_id: localAsset,
            params: { h3_refs: [localAsset] },
          }),
        ],
      }),
    },
  );
  const stored = await compare(
    "failed saves preserve the revision/editor/document",
    "GET",
    project("team"),
    200,
    admin,
  );
  assert.equal(stored.last_editor, memberId);
  assert.equal(stored.revision, 2);
  assert.deepEqual(stored.document, saved.document);
  const copy = await compare(
    "duplicate ignores malformed body and workspace selection",
    "POST",
    project("team", "/duplicate?workspace=" + memberSpace),
    200,
    {
      ...member,
      raw: "{",
      contentType: "application/json",
    },
    "copy",
  );
  assert.equal(copy.owner, memberId);
  assert.equal(copy.revision, 1);
  assert.equal(copy.workspace, Number(team));
  assert.equal(copy.document.nodes[1].use_media, true);
  const list = await compare(
    "team list includes covers, counts and delete permissions",
    "GET",
    canvases,
    200,
    { ...member, workspace: team },
  );
  assert.deepEqual(
    list.projects.map((p: any) => [p.id, p.count, p.covers, p.can_delete]),
    [
      ["copy", 2, [{ id: localAsset, type: "image" }], true],
      ["team", 2, [{ id: localAsset, type: "image" }], false],
    ],
  );
  assert.ok(list.projects.every((p: any) => !Object.hasOwn(p, "document")));
  await compare(
    "owner delete ignores malformed body",
    "DELETE",
    project("copy"),
    200,
    { ...member, raw: "{", contentType: "application/json" },
  );
  await compare(
    "duplicate of deleted project has original 404",
    "POST",
    project("copy", "/duplicate"),
    404,
    member,
  );

  for (const backend of backends) {
    const results = await Promise.all(
      ["race A", "race B"].map((title) =>
        request(backend, "PUT", project("team", "/document")(backend), {
          ...member,
          body: save(2, title, {
            nodes: [node("race", "text", { text: title })],
            shots: null,
          }),
        }),
      ),
    );
    assert.deepEqual(
      results.map((r) => r.status).sort(),
      [200, 409],
      backend.url,
    );
    const winner = results.find((r) => r.status === 200)!;
    const conflict = results.find((r) => r.status === 409)!;
    assert.deepEqual(conflict.body, {
      detail:
        "画布已被其他成员修改。你的修改已保留，请重新载入或下载本地副本。",
    });
    const result = await request(
      backend,
      "GET",
      project("team")(backend),
      member,
    );
    assert.equal(result.body.revision, 3);
    assert.equal(result.body.title, winner.body.title);
    assert.deepEqual(result.body.document, winner.body.document);
    assert.ok(!Object.hasOwn(result.body.document, "shots"));
  }
  checks.push(
    "concurrent HTTP saves have one committed winner on each backend",
  );
  await compare(
    "team owner delete",
    "DELETE",
    project("team", "?workspace=bad"),
    200,
    admin,
  );
  await compare(
    "repeat delete has original 404",
    "DELETE",
    project("team"),
    404,
    admin,
  );
  await compare(
    "member can select their team as the default",
    "POST",
    "/api/workspaces/" + team + "/select",
    200,
    member,
  );
  await compare(
    "creation follows the new team default",
    "POST",
    canvases,
    200,
    { ...member, body: { title: "退出后无权访问" } },
    "former-team",
  );
  await setTeamMembers([], 2);
  await compare(
    "revoked membership blocks even the canvas owner",
    "DELETE",
    project("former-team"),
    404,
    member,
  );
  await compare(
    "revoked membership blocks explicit team selection",
    "GET",
    canvases + "?workspace=" + team,
    403,
    member,
  );
  await compare(
    "team admin may delete a canvas owned by a former member",
    "DELETE",
    project("former-team"),
    200,
    admin,
  );
  const latest = await compare(
    "revoked default falls back to member's personal workspace",
    "GET",
    canvases,
    200,
    member,
  );
  assert.deepEqual(
    latest.projects.map((p: any) => p.id),
    ["private"],
  );

  await setTeamMembers([memberId], 3);
  const context = {
    f,
    original,
    target,
    runtime,
    python,
    team,
    personal,
    memberSpace,
    request,
    compare,
    project,
    checks,
  };
  await verifyCanvasRunsHttp(context);
  if (storyboard) await verifyStoryboardHttp(context, pause);

  console.log(
    "Original canvas REST parity:",
    JSON.stringify({
      cases: checks.length,
      database: process.env.TEST_DATABASE_URL ? "PostgreSQL" : "PGlite",
      passed: true,
    }),
  );
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  if (existingOrigin === undefined) delete process.env.PUBLIC_URL;
  else process.env.PUBLIC_URL = existingOrigin;
  if (storyboard) await rm(pause, { force: true });
  const stopped =
    legacy?.pid && legacy.exitCode === null && legacy.signalCode === null
      ? once(legacy, "exit")
      : undefined;
  if (stopped) legacy!.kill("SIGTERM");
  await Promise.allSettled([app?.close(), stopped]);
  await Promise.all([
    fixture?.cleanup(),
    rm(runtime, { recursive: true, force: true }),
  ]);
}
