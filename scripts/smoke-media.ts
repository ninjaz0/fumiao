/** Original media transport against a real pinned Python runtime and an isolated Nest database. */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { StudioCatalog } from "../packages/platform/src/catalog.js";
import { gpuReferences } from "../plugins/gpu/src/references.js";
import { databaseFixture } from "../tests/helpers/database.js";
import { importLegacy } from "../packages/platform/src/importer.js";
import { createOriginalApp } from "../apps/api/src/original.js";
const f = await databaseFixture(),
  python =
    process.env.STUDIO_PYTHON ||
    resolve(".runtime-advanced/original/.venv/bin/python");
const reservation = createServer();
await new Promise<void>((r) => reservation.listen(0, "127.0.0.1", r));
const port = (reservation.address() as any).port;
await new Promise<void>((r) => reservation.close(() => r()));
const origin = "http://localhost:3000",
  previous = process.env.PUBLIC_URL;
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
  stream.on("data", (chunk) => (logs = (logs + chunk).slice(-4000)));
const urls = [`http://127.0.0.1:${port}`, ""],
  admin = ["", ""],
  member = ["", ""],
  checks: string[] = [];
let app: Awaited<ReturnType<typeof createOriginalApp>> | undefined;
async function request(
  index: number,
  path: string,
  options: {
    method?: string;
    json?: unknown;
    bytes?: Buffer;
    cookie?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const response = await fetch(urls[index] + path, {
    method:
      options.method ||
      (options.json !== undefined || options.bytes ? "POST" : "GET"),
    headers: {
      cookie: options.cookie ?? admin[index],
      Origin: origin,
      ...(options.json !== undefined
        ? { "Content-Type": "application/json" }
        : options.bytes
          ? { "Content-Type": "application/octet-stream" }
          : {}),
      ...options.headers,
    },
    body:
      options.json !== undefined
        ? JSON.stringify(options.json)
        : options.bytes
          ? new Uint8Array(options.bytes)
          : undefined,
  });
  return {
    status: response.status,
    headers: response.headers,
    bytes: Buffer.from(await response.arrayBuffer()),
  };
}
async function json(
  index: number,
  path: string,
  body: unknown,
  method = "POST",
  cookie = admin[index],
  headers: Record<string, string> = {},
) {
  const r = await request(index, path, { method, json: body, cookie, headers });
  assert.equal(r.status, 200, r.bytes.toString());
  return { ...r, body: JSON.parse(r.bytes.toString()) };
}
async function pair(
  label: string,
  path: string,
  status = 200,
  options: {
    method?: string;
    json?: unknown;
    headers?: Record<string, string>;
    sessions?: string[];
    bytes?: Buffer;
    multipart?: boolean;
  } = {},
) {
  const r = await Promise.all(
    [0, 1].map((i) =>
      request(i, path, { ...options, cookie: options.sessions?.[i] }),
    ),
  );
  for (const v of r)
    assert.equal(
      v.status,
      status,
      label + ": " + v.bytes.toString().slice(0, 150),
    );
  for (const header of [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "content-disposition",
    "cache-control",
    "allow",
  ]) {
    if (options.multipart && header === "content-type") continue;
    assert.equal(
      r[1].headers.get(header),
      r[0].headers.get(header),
      label + " " + header,
    );
  }
  if (options.multipart) {
    const normalized = r.map((v) =>
      v.bytes
        .toString("latin1")
        .replaceAll(
          v.headers.get("content-type")!.split("boundary=")[1],
          "BOUNDARY",
        ),
    );
    assert.equal(normalized[1], normalized[0], label);
  } else assert.deepEqual(r[1].bytes, r[0].bytes, label);
  checks.push(label);
  return r;
}
try {
  let ready = false;
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(urls[0] + "/health")).ok) {
        ready = true;
        break;
      }
    } catch {}
    if (legacy.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, logs);
  const credentials = JSON.parse(
    await readFile(join(f.directory, "credentials.json"), "utf8"),
  );
  const login = await json(0, "/api/login", credentials);
  admin[0] = login.headers.get("set-cookie")!.split(";")[0];
  const invitation = (
    await json(0, "/api/invite-codes", { name: "media fixture", team_id: 1 })
  ).body;
  const memberCredentials = {
    name: "MediaMember",
    nickname: "素材成员",
    password: "media-test-password",
    code: invitation.code,
  };
  member[0] = (await json(0, "/api/register", memberCredentials)).headers
    .get("set-cookie")!
    .split(";")[0];
  const png = await sharp({
    create: { width: 37, height: 29, channels: 3, background: "#45a378" },
  })
    .png()
    .toBuffer();
  const jpeg = await sharp({
    create: { width: 31, height: 43, channels: 3, background: "#a44578" },
  })
    .jpeg()
    .toBuffer();
  async function upload(bytes: Buffer, cookie: string, workspace: number) {
    const r = await request(0, "/api/assets", {
      bytes,
      cookie,
      headers: { "X-Workspace-Id": String(workspace) },
    });
    assert.equal(r.status, 200, r.bytes.toString());
    return JSON.parse(r.bytes.toString()).id as string;
  }
  const team = await upload(png, admin[0], 1),
    personal = await upload(jpeg, admin[0], 2),
    memberTeam = await upload(png, member[0], 1);
  const spacesResponse = await request(0, "/api/workspaces", {
    cookie: member[0],
  });
  const memberSpace = JSON.parse(
    spacesResponse.bytes.toString(),
  ).workspaces.find((w: any) => w.kind === "personal").id;
  const memberPrivate = await upload(png, member[0], memberSpace);
  const output = await upload(jpeg, admin[0], 1),
    batchOwn = await upload(png, admin[0], 1),
    batchOther = await upload(png, member[0], 1);
  function sourceSql(statement: string, params: unknown[] = []) {
    execFileSync(
      python,
      [
        "-c",
        "import sqlite3,json,sys; db=sqlite3.connect(sys.argv[1]); db.execute('PRAGMA foreign_keys=ON'); value=json.load(sys.stdin); db.execute(value['sql'],value['params']); db.commit()",
        join(f.directory, "data/studio.sqlite"),
      ],
      {
        input: JSON.stringify({ sql: statement, params }),
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
  }
  sourceSql("UPDATE media SET kind='image' WHERE id=?", [output]);
  const singleOutput = await upload(png, admin[0], 1);
  sourceSql("UPDATE media SET kind='image' WHERE id=?", [singleOutput]);
  // Synthetic video metadata is sufficient for the frame provenance contract;
  // no decoder/provider is invoked when recording a browser-extracted frame.
  const videoSource = await upload(png, admin[0], 1);
  sourceSql("UPDATE media SET kind='video' WHERE id=?", [videoSource]);
  const importedFrameResponse = await request(0, "/api/assets", {
    bytes: png,
    headers: {
      "X-Workspace-Id": "1",
      "X-Frame-Source": videoSource,
      "X-Frame-Time": "1.25",
    },
  });
  assert.equal(importedFrameResponse.status, 200);
  const importedFrame = JSON.parse(importedFrameResponse.bytes.toString()).id;
  for (const [id, status, result, refs] of [
    [301, "done", output, [team]],
    [302, "failed", null, [output]],
    [303, "failed", null, []],
    [304, "done", singleOutput, []],
  ] as const)
    sourceSql(
      "INSERT INTO jobs(id,uid,owner,prompt,refs,status,created,updated,result,workspace,kind,model) VALUES(?,?,1,'fixture',?,?,1700000000,1700000000,?,1,'image','fixture')",
      [id, "fixture-" + id, JSON.stringify(refs), status, result],
    );
  sourceSql(
    "INSERT INTO favorites(id,user,job,created) VALUES(71,1,301,1700000001)",
  );
  sourceSql(
    "INSERT INTO favorites(id,user,media,created) VALUES(72,1,?,1700000002)",
    [team],
  );
  const avatar = await request(0, "/api/me/avatar", {
    method: "PUT",
    bytes: jpeg,
  });
  assert.equal(avatar.status, 200);
  const avatarPath = JSON.parse(avatar.bytes.toString()).avatar_url;
  const packAsset = await upload(png, admin[0], 1);
  const packDraft = {
    name: "主角 A",
    purpose: "subject",
    description: "蓝色上衣",
    media: [packAsset],
  };
  const importedPack = (
    await json(0, "/api/asset-packs", packDraft, "POST", admin[0], {
      "X-Workspace-Id": "1",
    })
  ).body;
  await json(
    0,
    "/api/asset-packs/" + importedPack.id,
    { ...packDraft, description: "红色上衣", expected_revision: 1 },
    "PUT",
    admin[0],
    { "X-Workspace-Id": "1" },
  );
  const packCanvas = (
    await json(0, "/api/canvases", { template: "product" }, "POST", admin[0], {
      "X-Workspace-Id": "1",
    })
  ).body;
  const packNode = packCanvas.document.nodes.find(
    (n: any) => n.id === "shot-1",
  );
  packNode.asset_packs = [{ id: importedPack.id, revision: 2 }];
  await json(
    0,
    "/api/canvases/" + packCanvas.id + "/document",
    {
      expected_revision: 1,
      title: packCanvas.title,
      document: packCanvas.document,
    },
    "PUT",
    admin[0],
    { "X-Workspace-Id": "1" },
  );
  const referencePath = join(f.directory, "reference.mkv");
  execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-nostdin",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=96x64:rate=25:duration=2",
      "-f",
      "lavfi",
      "-i",
      "sine=duration=2:sample_rate=44100",
      "-c:v",
      "libx264",
      "-threads",
      "2",
      "-c:a",
      "pcm_s16le",
      referencePath,
    ],
    { stdio: "pipe" },
  );
  const referenceBytes = await readFile(referencePath);
  const referenceResponse = await request(0, "/api/h3/references?kind=video", {
    bytes: referenceBytes,
    headers: {
      "X-Workspace-Id": "1",
      "X-File-Name": encodeURIComponent("片段.mkv"),
    },
  });
  assert.equal(
    referenceResponse.status,
    200,
    referenceResponse.bytes.toString(),
  );
  const importedReference = JSON.parse(referenceResponse.bytes.toString());
  const exportPath = join(f.directory, "export.json");
  execFileSync(
    python,
    [
      "scripts/export-legacy.py",
      "--database",
      join(f.directory, "data/studio.sqlite"),
      "--output",
      exportPath,
      "--source",
      "media-test",
      "--include-registration-codes",
    ],
    { stdio: "pipe" },
  );
  const snapshot = JSON.parse(await readFile(exportPath, "utf8"));
  await assert.rejects(
    importLegacy(f.p, snapshot, join(f.directory, "data/objects")),
    {
      status: 400,
      message:
        "导出文件缺少头像清单或头像目录，请重新导出并设置 LEGACY_AVATARS",
    },
  );
  assert.equal(
    Number((await f.db.query("SELECT count(*) FROM users")).rows[0].count),
    0,
  );
  await importLegacy(f.p, snapshot, join(f.directory, "data/objects"), {
    avatars: join(f.directory, "data/avatars"),
  });
  const referenceExport = snapshot.tables.h3_reference_media.find(
    (r: any) => r.media === importedReference.id,
  );
  assert.ok(referenceExport);
  const importedReferenceRow = (
    await f.db.query(
      "SELECT r.*,a.public_id FROM asset_reference_media r JOIN assets a ON a.id=r.asset_id WHERE a.public_id=$1",
      [importedReference.id],
    )
  ).rows[0];
  assert.equal(importedReferenceRow.seconds, referenceExport.seconds);
  assert.equal(importedReferenceRow.fps, referenceExport.fps);
  assert.equal(importedReferenceRow.has_audio, !!referenceExport.has_audio);
  assert.equal(importedReferenceRow.name, referenceExport.name);
  assert.equal(importedReferenceRow.plugin_id, null);
  assert.equal(importedReferenceRow.plugin_version, null);
  checks.push(
    "reference export/import retains duration, fps, audio and Unicode name under the mapped UUID",
  );
  await f.db.transaction((sql) =>
    new StudioCatalog(f.db).activate(sql, gpuReferences.manifest),
  );
  const object = (
    await f.db.query("SELECT * FROM assets WHERE public_id=$1", [team])
  ).rows[0];
  assert.notEqual(object.id.replaceAll("-", ""), team);
  assert.deepEqual(Buffer.from(await f.p.storage.read(object.object_key)), png);
  checks.push(
    "import retains original media IDs, bytes and private avatar files",
  );
  const provenance = (
    await f.db.query(
      `SELECT p.source_public_id,p.frame_seconds,s.public_id AS source
    FROM asset_provenance p JOIN assets a ON a.id=p.asset_id JOIN assets s ON s.id=p.source_id WHERE a.public_id=$1`,
      [importedFrame],
    )
  ).rows[0];
  assert.deepEqual(provenance, {
    source_public_id: videoSource,
    frame_seconds: 1.25,
    source: videoSource,
  });
  checks.push(
    "import retains frame time and maps source media to its internal UUID",
  );
  app = await createOriginalApp(f.p);
  await app.listen(0, "127.0.0.1");
  urls[1] = await app.getUrl();
  admin[1] = (await json(1, "/api/login", credentials)).headers
    .get("set-cookie")!
    .split(";")[0];
  member[1] = (await json(1, "/api/login", memberCredentials)).headers
    .get("set-cookie")!
    .split(";")[0];
  await pair("anonymous private media", "/media/" + team, 401, {
    sessions: ["", ""],
  });
  await pair("missing media", "/media/not-an-id", 404);
  await pair("original URL and exact media bytes", "/media/" + team);
  await pair(
    "imported video reference retains exact normalized bytes",
    "/media/" + importedReference.id,
  );
  await pair(
    "imported video reference range",
    "/media/" + importedReference.id,
    206,
    { headers: { Range: "bytes=16-47" } },
  );
  await pair("member reads shared media", "/media/" + team, 200, {
    sessions: member,
  });
  await pair(
    "personal media ignores unrelated selection",
    "/media/" + personal + "?workspace=1",
  );
  await pair(
    "member cannot read administrator personal media",
    "/media/" + personal,
    404,
    { sessions: member },
  );
  await pair(
    "administrator cannot read member personal media",
    "/media/" + memberPrivate,
    404,
  );
  await pair(
    "invalid download query validates before authentication",
    "/media/" + team + "?download=invalid",
    422,
    { sessions: ["", ""] },
  );
  await pair(
    "original download filename",
    "/media/" + personal + "?download=yes",
  );
  await pair(
    "original download query takes last value",
    "/media/" + team + "?download=true&download=false",
  );
  await pair("HEAD method stays unchanged", "/media/" + team, 405, {
    method: "HEAD",
  });
  for (const range of [
    "bytes=0-15",
    "bytes=13-",
    "bytes=-9",
    "bytes=0-999999",
    "bytes=3-4,0-2",
    "bytes=1-4,2-9",
    "bytes=0-1,9-13",
    "bytes=0-1,bad,20-22",
    "bytes=+0-+4",
    "bytes=1_0-1_4",
  ]) {
    const multipart =
      range === "bytes=0-1,9-13" || range === "bytes=0-1,bad,20-22";
    await pair("range " + range, "/media/" + team, 206, {
      headers: { Range: range },
      multipart,
    });
  }
  for (const [range, status] of [
    ["bad", 400],
    ["items=0-1", 400],
    ["bytes=-", 400],
    ["bytes=bad", 400],
    ["bytes=20-10", 400],
    ["bytes=-0", 416],
    ["bytes=999999999999999999999999-", 416],
  ] as const)
    await pair("range error " + range, "/media/" + team, status, {
      headers: { Range: range },
    });
  await pair("too many ranges use complete file", "/media/" + team, 200, {
    headers: { Range: "bytes=" + Array(101).fill("0-1").join(",") },
  });
  await pair("mismatched If-Range uses complete file", "/media/" + team, 200, {
    headers: { Range: "bytes=0-2", "If-Range": '"stale"' },
  });
  const full = await pair("repeatable file validator", "/media/" + team);
  assert.equal(
    full[1].headers.get("etag"),
    full[0].headers.get("etag"),
    "import preserves source media validator",
  );
  assert.equal(
    full[1].headers.get("last-modified"),
    full[0].headers.get("last-modified"),
  );
  for (const header of ["etag", "last-modified"]) {
    const responses = await Promise.all(
      [0, 1].map((i) =>
        request(i, "/media/" + team, {
          headers: {
            Range: "bytes=0-2",
            "If-Range": full[i].headers.get(header)!,
          },
        }),
      ),
    );
    assert.ok(responses.every((r) => r.status === 206));
    assert.deepEqual(responses[0].bytes, responses[1].bytes);
    checks.push("If-Range " + header);
  }
  await pair("public builtin avatar", "/avatars/alpine.svg", 200, {
    sessions: ["", ""],
  });
  await pair("unknown builtin avatar", "/avatars/unknown.svg", 404, {
    sessions: ["", ""],
  });
  await pair("private avatar requires session", avatarPath, 401, {
    sessions: ["", ""],
  });
  await pair("imported avatar retains exact bytes", avatarPath);
  await pair("other signed-in users can see profile avatar", avatarPath, 200, {
    sessions: member,
  });
  await pair(
    "missing avatar",
    "/avatars/uploads/" + "0".repeat(32) + ".webp",
    404,
  );
  await pair("avatar range", avatarPath, 206, {
    headers: { Range: "bytes=0-13" },
  });
  await pair(
    "wrong selected workspace refuses delete",
    "/api/assets/" + personal,
    404,
    { method: "DELETE", headers: { "X-Workspace-Id": "1" } },
  );
  await pair(
    "member cannot delete another member asset",
    "/api/assets/" + team,
    403,
    { method: "DELETE", headers: { "X-Workspace-Id": "1" }, sessions: member },
  );
  await pair(
    "administrator still cannot delete personal asset",
    "/api/assets/" + memberPrivate,
    404,
    { method: "DELETE", headers: { "X-Workspace-Id": "1" } },
  );
  await pair(
    "owner removes shared reference",
    "/api/assets/" + memberTeam,
    200,
    { method: "DELETE", headers: { "X-Workspace-Id": "1" }, sessions: member },
  );
  await pair("deleted reference cannot be read", "/media/" + memberTeam, 404);
  await pair(
    "repeat deletion reports missing",
    "/api/assets/" + memberTeam,
    404,
    { method: "DELETE" },
  );
  await pair("switch profile back to builtin", "/api/me", 200, {
    method: "PATCH",
    json: { avatar: "builtin:alpine" },
  });
  await pair("replaced avatar loses access", avatarPath, 404);
  assert.equal(
    Number(
      (await f.db.query("SELECT count(*) FROM avatar_objects")).rows[0].count,
    ),
    0,
  );
  const libraryOptions = { method: "PUT", headers: { "X-Workspace-Id": "1" } };
  const favorite = async (
    label: string,
    keys: unknown,
    value: unknown = true,
    status = 200,
    sessions = admin,
  ) =>
    pair(label, "/api/favorites", status, {
      ...libraryOptions,
      json: { keys, favorite: value },
      sessions,
    });
  const deletion = async (
    label: string,
    keys: string[],
    status = 200,
    sessions = admin,
  ) =>
    pair(label, "/api/assets/batch-delete", status, {
      method: "POST",
      headers: libraryOptions.headers,
      json: { keys },
      sessions,
    });
  await favorite("import preserves favorite identity and ordering", [
    "job:301",
  ]);
  await favorite("generated asset favorite has canonical job identity", [
    "asset:" + output,
    "job:301",
  ]);
  const adminActor = await f.p.actor(admin[1].slice("fm_session=".length));
  const outputRow = (
    await f.db.query("SELECT id FROM assets WHERE public_id=$1", [output])
  ).rows[0];
  const teamRow = (
    await f.db.query("SELECT id FROM workspaces WHERE public_id=1")
  ).rows[0];
  assert.ok(
    (await f.p.favorites(adminActor, teamRow.id)).some(
      (r) => r.asset_id === outputRow.id,
    ),
  );
  await f.p.favorite(adminActor, outputRow.id, false);
  await json(
    0,
    "/api/favorites",
    { keys: ["job:301"], favorite: false },
    "PUT",
    admin[0],
    libraryOptions.headers,
  );
  await favorite(
    "Advanced and original favorite changes share canonical job records",
    ["asset:" + output],
  );
  await favorite(
    "private favorites for each member",
    ["asset:" + team],
    "yes",
    200,
    member,
  );
  await favorite("favorites ignore a repeated selection", [
    "asset:" + batchOwn,
    "asset:" + batchOwn,
  ]);
  await favorite(
    "favorites reject missing selection atomically",
    ["asset:" + batchOther, "job:9999"],
    true,
    404,
  );
  await favorite("failed favorite change left no partial write", [
    "asset:" + batchOwn,
  ]);
  await favorite(
    "unfinished works cannot be favorited",
    ["job:302"],
    true,
    409,
  );
  await favorite("unfavorite ignores deleted items", ["job:9999"], false);
  await favorite(
    "favorites reject malformed identifiers",
    ["job:01"],
    true,
    400,
  );
  await favorite(
    "favorites reject another personal workspace",
    ["asset:" + personal],
    true,
    404,
  );
  await favorite("favorites validate empty array before auth", [], true, 422, [
    "",
    "",
  ]);
  await favorite("favorites validate element types", [7, null], true, 422);
  await favorite("favorites validate boolean", ["job:301"], "perhaps", 422);
  await favorite(
    "favorites limit selection size",
    Array(201).fill("job:301"),
    true,
    422,
  );
  await favorite("favorites require a list", "job:301", true, 422);
  await pair("favorites missing fields", "/api/favorites", 422, {
    ...libraryOptions,
    json: {},
  });

  async function tickets(keys: string[], sessions = admin) {
    const values = await Promise.all(
      [0, 1].map((i) =>
        json(
          i,
          "/api/assets/batch-download",
          { keys },
          "POST",
          sessions[i],
          libraryOptions.headers,
        ),
      ),
    );
    assert.equal(values[0].body.filename, values[1].body.filename);
    for (const v of values)
      assert.match(v.body.url, /^\/api\/downloads\/[a-zA-Z0-9_-]+$/);
    return values.map((v) => v.body.url as string);
  }
  const archiveUrls = await tickets([
    "job:301",
    "asset:" + output,
    "asset:" + team,
    "asset:" + team,
  ]);
  const archives = await Promise.all(
    [0, 1].map((i) => request(i, archiveUrls[i])),
  );
  for (const r of archives) assert.equal(r.status, 200, r.bytes.toString());
  assert.deepEqual(
    archives[1].bytes,
    archives[0].bytes,
    "exact streaming ZIP format, entries and original bytes",
  );
  for (const h of [
    "content-type",
    "content-disposition",
    "x-accel-buffering",
    "cache-control",
    "content-length",
  ])
    assert.equal(archives[1].headers.get(h), archives[0].headers.get(h), h);
  checks.push(
    "batch archive preserves canonical selection, exact ZIP bytes and headers",
  );
  for (const [sessions, status] of [
    [member, 403],
    [["", ""], 401],
  ] as const) {
    const denied = await Promise.all(
      [0, 1].map((i) => request(i, archiveUrls[i], { cookie: sessions[i] })),
    );
    assert.ok(denied.every((r) => r.status === status));
    assert.deepEqual(denied[1].bytes, denied[0].bytes);
    checks.push("download ticket access " + status);
  }
  await pair("unknown download ticket", "/api/downloads/missing", 410);
  await pair(
    "unfinished selection cannot download",
    "/api/assets/batch-download",
    409,
    {
      method: "POST",
      json: { keys: ["job:302"] },
      headers: libraryOptions.headers,
    },
  );
  await pair(
    "missing selection cannot download",
    "/api/assets/batch-download",
    404,
    {
      method: "POST",
      json: { keys: ["job:9999"] },
      headers: libraryOptions.headers,
    },
  );
  sourceSql("UPDATE downloads SET expires=0");
  await f.db.query("UPDATE download_tickets SET expires_at=to_timestamp(0)");
  const expired = await Promise.all(
    [0, 1].map((i) => request(i, archiveUrls[i])),
  );
  assert.ok(expired.every((r) => r.status === 410));
  assert.deepEqual(expired[1].bytes, expired[0].bytes);
  checks.push("expired download tickets");

  await deletion(
    "batch ownership failure is atomic",
    ["asset:" + batchOther, "asset:" + batchOwn],
    403,
    member,
  );
  await deletion(
    "batch preserves request-order permission errors",
    ["asset:" + batchOwn, "invalid"],
    403,
    member,
  );
  await pair("failed batch kept earlier owned asset", "/media/" + batchOther);
  await deletion(
    "batch protects references from unselected jobs",
    ["job:301"],
    409,
  );
  await pair("failed batch kept generated result", "/media/" + output);
  sourceSql("UPDATE jobs SET status='queued' WHERE id=303");
  await f.db.query("UPDATE jobs SET state='queued' WHERE public_id=303");
  await deletion(
    "batch refuses unfinished jobs without partial deletion",
    ["asset:" + batchOwn, "job:303"],
    409,
  );
  const removeJob = (
    label: string,
    id: string,
    status: number,
    headers: Record<string, string> = {},
    sessions = admin,
    method = "DELETE",
  ) =>
    pair(label, `/api/jobs/${id}`, status, {
      method,
      headers: { "X-Workspace-Id": "1", ...headers },
      sessions,
    });
  await removeJob(
    "job deletion validates paths before authentication",
    "invalid",
    422,
    {},
    ["", ""],
  );
  await removeJob("job deletion requires authentication", "304", 401, {}, [
    "",
    "",
  ]);
  await removeJob(
    "job deletion preserves allowed method",
    "304",
    405,
    {},
    admin,
    "GET",
  );
  await removeJob(
    "job deletion checks missing tasks before workspace selection",
    "999999",
    404,
    { "X-Workspace-Id": "invalid" },
  );
  await removeJob(
    "job deletion rejects another selected workspace",
    "304",
    404,
    { "X-Workspace-Id": "2" },
  );
  await removeJob(
    "job deletion preserves version ownership",
    "304",
    403,
    {},
    member,
  );
  await removeJob("job deletion refuses queued tasks", "303", 409);
  await removeJob(
    "job deletion protects references from existing versions",
    "301",
    409,
  );
  const cancel = (
    label: string,
    id: string,
    status: number,
    headers: Record<string, string> = {},
    sessions = admin,
    method = "POST",
  ) =>
    pair(label, `/api/jobs/${id}/cancel`, status, {
      method,
      headers: { "X-Workspace-Id": "1", ...headers },
      sessions,
    });
  await cancel(
    "withdrawal validates the path before authentication",
    "invalid",
    422,
    {},
    ["", ""],
  );
  await cancel("withdrawal requires a session", "303", 401, {}, ["", ""]);
  await cancel(
    "withdrawal rejects another HTTP method",
    "303",
    405,
    {},
    admin,
    "GET",
  );
  await cancel(
    "withdrawal checks missing tasks before workspace selection",
    "999999",
    404,
    { "X-Workspace-Id": "invalid" },
  );
  await cancel("withdrawal rejects an invalid workspace", "303", 400, {
    "X-Workspace-Id": "invalid",
  });
  await cancel("withdrawal rejects a missing workspace", "303", 403, {
    "X-Workspace-Id": "999999",
  });
  await cancel(
    "withdrawal cannot cross into a different selected workspace",
    "303",
    404,
    { "X-Workspace-Id": "2" },
  );
  await cancel(
    "withdrawal cannot manage another member's version",
    "303",
    403,
    {},
    member,
  );
  await cancel("withdrawal refuses completed tasks", "301", 409);
  await cancel("withdrawal refuses failed tasks", "302", 409);
  // Build matching held credits in these disposable fixtures; never call a provider.
  sourceSql(
    "UPDATE credit_accounts SET balance=balance+3,reserved=reserved+3 WHERE workspace=1",
  );
  sourceSql(
    "INSERT INTO credit_charges(job,workspace,owner,amount,price_key,price_revision,state,created) VALUES(303,1,1,3,'fixture',1,'held',1700000000)",
  );
  await f.db.query(
    "UPDATE wallets SET balance=balance+3,held=held+3 WHERE workspace_id=(SELECT id FROM workspaces WHERE public_id=1)",
  );
  await f.db.query("UPDATE jobs SET price=3 WHERE public_id=303");
  await cancel("withdrawal releases a queued task", "+303", 200);
  await cancel("withdrawal rejects an already cancelled task", "303", 409);
  const wallets = await Promise.all(
    [0, 1].map(async (i) => {
      const value = await request(i, "/api/credits", {
        headers: { "X-Workspace-Id": "1" },
      });
      assert.equal(value.status, 200);
      return JSON.parse(value.bytes.toString()).wallet;
    }),
  );
  assert.deepEqual(wallets[1], wallets[0]);
  assert.equal(wallets[0].reserved, 0);
  checks.push("withdrawal retains balance and releases reserved credits once");
  sourceSql("UPDATE jobs SET status='failed' WHERE id=303");
  await f.db.query("UPDATE jobs SET state='failed' WHERE public_id=303");
  await deletion("selected jobs and their references delete together", [
    "job:301",
    "asset:" + output,
    "job:302",
    "asset:" + team,
  ]);
  await deletion("batch deletion ignores already deleted entries", [
    "job:301",
    "asset:" + output,
    "asset:" + team,
  ]);
  await pair("batch-deleted output is inaccessible", "/media/" + output, 404);
  await favorite(
    "deletion clears private favorites across users",
    ["job:9999"],
    false,
    200,
    member,
  );
  assert.equal(
    Number(
      (
        await f.db.query(
          "SELECT count(*) FROM jobs WHERE deleted_at IS NOT NULL",
        )
      ).rows[0].count,
    ),
    2,
  );
  checks.push("deleted task tombstones retain accepted request identities");
  await removeJob("single job deletion removes completed output", "+304", 200);
  await removeJob("single job deletion rejects a deleted task", "304", 404);
  await pair(
    "single job output is no longer readable",
    "/media/" + singleOutput,
    404,
  );
  await removeJob(
    "single job deletion accepts a settled task without output",
    "303",
    200,
  );
  // New writes exercise the Node worker, rather than only reading imported files.
  for (const [label, bytes, status, error] of [
    ["empty upload", Buffer.alloc(0), 400, "文件为空"],
    [
      "corrupt upload",
      Buffer.from("not an image"),
      400,
      "无法读取图片，文件可能已损坏或格式不受支持",
    ],
    ["oversized upload", Buffer.alloc((16 << 20) + 1), 413, "文件过大"],
  ] as const) {
    const responses = await Promise.all(
      [0, 1].map((i) =>
        request(i, "/api/assets", {
          bytes,
          headers: { "X-Workspace-Id": "1" },
        }),
      ),
    );
    for (const response of responses) {
      assert.equal(response.status, status, label);
      assert.deepEqual(JSON.parse(response.bytes.toString()), {
        detail: error,
      });
    }
    checks.push(label);
  }
  await pair(
    "anonymous upload authenticates before decoding",
    "/api/assets",
    401,
    { method: "POST", bytes: Buffer.from("invalid"), sessions: ["", ""] },
  );
  await pair("raw upload ignores JSON content type", "/api/assets", 400, {
    method: "POST",
    bytes: Buffer.from("{invalid json"),
    headers: {
      "Content-Type": "application/json",
      "X-Workspace-Id": "invalid",
    },
  });
  const uploaded = await Promise.all(
    [0, 1].map((i) =>
      request(i, "/api/assets", {
        bytes: png,
        headers: { "Content-Type": "application/json", "X-Workspace-Id": "1" },
      }),
    ),
  );
  const uploadBodies = uploaded.map((r) => {
    assert.equal(r.status, 200, r.bytes.toString());
    return JSON.parse(r.bytes.toString());
  });
  assert.deepEqual(
    { ...uploadBodies[1], id: "ID" },
    { ...uploadBodies[0], id: "ID" },
  );
  for (let i = 0; i < 2; i++) {
    assert.match(uploadBodies[i].id, /^[a-f0-9]{32}$/);
    assert.deepEqual(
      (await request(i, "/media/" + uploadBodies[i].id)).bytes,
      png,
    );
  }
  checks.push(
    "Node image upload preserves original response, public identity and passthrough bytes",
  );
  for (const [label, headers, status] of [
    ["upload checks selected workspace", { "X-Workspace-Id": "9999" }, 403],
    [
      "frame source requires both headers",
      { "X-Workspace-Id": "1", "X-Frame-Time": "2" },
      400,
    ],
    [
      "frame source must be a video",
      {
        "X-Workspace-Id": "1",
        "X-Frame-Time": "2",
        "X-Frame-Source": batchOwn,
      },
      404,
    ],
  ] as const)
    await pair(label, "/api/assets", status, {
      method: "POST",
      bytes: png,
      headers,
    });
  for (const value of ["-1", "3600.01", "nan", "inf", "0x10", ""]) {
    await pair("invalid frame time " + value, "/api/assets", 400, {
      method: "POST",
      bytes: png,
      headers: {
        "X-Workspace-Id": "1",
        "X-Frame-Source": videoSource,
        "X-Frame-Time": value,
      },
    });
  }
  const frames = await Promise.all(
    [0, 1].map((i) =>
      request(i, "/api/assets", {
        bytes: png,
        headers: {
          "X-Workspace-Id": "1",
          "X-Frame-Source": videoSource,
          "X-Frame-Time": "1_2.5e1",
        },
      }),
    ),
  );
  const frameBodies = frames.map((r) => {
    assert.equal(r.status, 200, r.bytes.toString());
    return JSON.parse(r.bytes.toString());
  });
  assert.deepEqual(
    { ...frameBodies[1], id: "ID" },
    { ...frameBodies[0], id: "ID" },
  );
  const frameRow = (
    await f.db.query(
      `SELECT p.source_public_id,p.frame_seconds FROM asset_provenance p
    JOIN assets a ON a.id=p.asset_id WHERE a.public_id=$1`,
      [frameBodies[1].id],
    )
  ).rows[0];
  assert.deepEqual(frameRow, {
    source_public_id: videoSource,
    frame_seconds: 125,
  });
  checks.push(
    "frame uploads preserve Python numeric syntax and record private provenance",
  );
  const beforeFull = Number(
    (await f.db.query("SELECT count(*) FROM assets")).rows[0].count,
  );
  sourceSql("UPDATE media SET size=20000000000 WHERE id=?", [videoSource]);
  const savedQuota = (await f.db.query("SELECT quota FROM storage_capacity"))
    .rows[0].quota;
  await f.db.query("UPDATE storage_capacity SET quota=used+reserved");
  try {
    await pair(
      "full storage rejects converted upload atomically",
      "/api/assets",
      507,
      { method: "POST", bytes: png, headers: { "X-Workspace-Id": "1" } },
    );
    await pair(
      "full storage rejects converted video reference atomically",
      "/api/h3/references?kind=video",
      507,
      {
        method: "POST",
        bytes: referenceBytes,
        headers: { "X-Workspace-Id": "1" },
      },
    );
    assert.equal(
      Number((await f.db.query("SELECT count(*) FROM assets")).rows[0].count),
      beforeFull,
    );
  } finally {
    sourceSql("UPDATE media SET size=? WHERE id=?", [png.length, videoSource]);
    await f.db.query("UPDATE storage_capacity SET quota=$1", [savedQuota]);
  }
  const avatars = await Promise.all(
    [0, 1].map((i) =>
      request(i, "/api/me/avatar", { method: "PUT", bytes: png }),
    ),
  );
  const profiles = avatars.map((r) => {
    assert.equal(r.status, 200, r.bytes.toString());
    return JSON.parse(r.bytes.toString());
  });
  assert.deepEqual(
    { ...profiles[1], avatar: "UPLOAD", avatar_url: "URL" },
    { ...profiles[0], avatar: "UPLOAD", avatar_url: "URL" },
  );
  const avatarImages = await Promise.all(
    [0, 1].map(async (i) => {
      assert.match(profiles[i].avatar, /^upload:[a-f0-9]{32}$/);
      const response = await request(i, profiles[i].avatar_url);
      assert.equal(response.status, 200);
      return sharp(response.bytes).raw().toBuffer({ resolveWithObject: true });
    }),
  );
  assert.deepEqual(avatarImages[1], avatarImages[0]);
  checks.push(
    "Node avatar upload preserves profile contract and exact decoded pixels",
  );
  for (const [label, bytes, status] of [
    ["empty avatar upload", Buffer.alloc(0), 400],
    ["oversized avatar upload", Buffer.alloc((5 << 20) + 1), 413],
  ] as const)
    await pair(label, "/api/me/avatar", status, { method: "PUT", bytes });
  const packHeaders = { "X-Workspace-Id": "1" };
  await pair(
    "imported pack keeps source revision, order, metadata and time",
    "/api/asset-packs",
    200,
    { headers: packHeaders },
  );
  await pair(
    "imported canvas protects pack deletion",
    "/api/asset-packs/" + importedPack.id,
    409,
    { method: "DELETE", headers: packHeaders },
  );
  await pair(
    "pack reference protects source image",
    "/api/assets/" + packAsset,
    409,
    { method: "DELETE", headers: packHeaders },
  );
  await pair(
    "pack listing is private to selected workspace",
    "/api/asset-packs",
    200,
    { headers: { "X-Workspace-Id": "2" } },
  );
  await pair("anonymous pack listing", "/api/asset-packs", 401, {
    sessions: ["", ""],
  });
  for (const [label, body, status] of [
    ["missing pack body", {}, 422],
    ["pack rejects extra fields", { ...packDraft, unexpected: true }, 422],
    ["pack name must be a string", { ...packDraft, name: 3 }, 422],
    ["pack name cannot be empty", { ...packDraft, name: "" }, 422],
    ["pack name length", { ...packDraft, name: "人".repeat(61) }, 422],
    ["blank pack name", { ...packDraft, name: "  " }, 400],
    ["unknown pack purpose", { ...packDraft, purpose: "other" }, 422],
    ["pack purpose type", { ...packDraft, purpose: 3 }, 422],
    [
      "pack description length",
      { ...packDraft, description: "x".repeat(2001) },
      422,
    ],
    ["empty pack media", { ...packDraft, media: [] }, 422],
    [
      "too many pack media",
      { ...packDraft, media: Array(10).fill(packAsset) },
      422,
    ],
    ["pack media element type", { ...packDraft, media: [1] }, 422],
    [
      "duplicate pack media",
      { ...packDraft, media: [packAsset, packAsset] },
      400,
    ],
    ["unknown pack media", { ...packDraft, media: ["0".repeat(32)] }, 404],
    [
      "pack excludes generated video",
      { ...packDraft, media: [videoSource] },
      404,
    ],
    [
      "pack rejects private workspace media",
      { ...packDraft, media: [personal] },
      404,
    ],
    [
      "pack expected revision range",
      { ...packDraft, expected_revision: 0 },
      422,
    ],
  ] as const)
    await pair(label, "/api/asset-packs", status, {
      method: "POST",
      json: body,
      headers: packHeaders,
    });
  await pair(
    "pack update requires matching revision",
    "/api/asset-packs/" + importedPack.id,
    409,
    { method: "PUT", json: packDraft, headers: packHeaders },
  );
  await pair(
    "old pack revision rejected",
    "/api/asset-packs/" + importedPack.id,
    409,
    {
      method: "PUT",
      json: { ...packDraft, expected_revision: 1 },
      headers: packHeaders,
    },
  );
  await pair(
    "pack cannot be updated in another workspace",
    "/api/asset-packs/" + importedPack.id,
    404,
    {
      method: "PUT",
      json: { ...packDraft, expected_revision: 2 },
      headers: { "X-Workspace-Id": "2" },
    },
  );
  const newPacks = await Promise.all(
    [0, 1].map((i) =>
      json(
        i,
        "/api/asset-packs",
        { ...packDraft, name: "  新角色  ", description: "  细节  " },
        "POST",
        admin[i],
        packHeaders,
      ),
    ),
  );
  const packValues = newPacks.map((r) => r.body);
  for (const p of packValues) {
    assert.match(p.id, /^[a-f0-9]{32}$/);
    assert.equal(p.revision, 1);
    assert.ok(Math.abs(p.updated - Date.now() / 1000) < 5);
  }
  assert.deepEqual(
    { ...packValues[1], id: "ID", updated: 0 },
    { ...packValues[0], id: "ID", updated: 0 },
  );
  checks.push(
    "new pack keeps original trimmed fields, public ID and update time contract",
  );
  for (let i = 0; i < 2; i++) {
    const denied = await request(i, "/api/asset-packs/" + packValues[i].id, {
      method: "DELETE",
      cookie: member[i],
      headers: packHeaders,
    });
    assert.equal(denied.status, 403);
    assert.deepEqual(JSON.parse(denied.bytes.toString()), {
      detail: "只有创建者或管理员可以删除素材包",
    });
  }
  checks.push("shared members cannot delete another creator's pack");
  const edits = await Promise.all(
    [0, 1].map((i) =>
      json(
        i,
        "/api/asset-packs/" + packValues[i].id,
        { ...packDraft, name: "同组编辑", expected_revision: "1.0" },
        "PUT",
        member[i],
        packHeaders,
      ),
    ),
  );
  assert.deepEqual(
    { ...edits[1].body, id: "ID", updated: 0 },
    { ...edits[0].body, id: "ID", updated: 0 },
  );
  checks.push(
    "shared members can edit a pack with the original integer coercion",
  );
  for (let i = 0; i < 2; i++)
    assert.deepEqual(
      (
        await json(
          i,
          "/api/asset-packs/" + packValues[i].id,
          undefined,
          "DELETE",
          admin[i],
          packHeaders,
        )
      ).body,
      { ok: true },
    );
  checks.push("pack creator can delete a pack outside canvases");
  for (const [label, path, status, sessions, bytes, headers] of [
    [
      "missing reference kind",
      "/api/h3/references",
      422,
      ["", ""],
      Buffer.from("x"),
      {},
    ],
    [
      "unknown reference kind",
      "/api/h3/references?kind=photo",
      422,
      ["", ""],
      Buffer.from("x"),
      {},
    ],
    [
      "reference authentication",
      "/api/h3/references?kind=video",
      401,
      ["", ""],
      referenceBytes,
      {},
    ],
    [
      "empty reference body",
      "/api/h3/references?kind=audio",
      400,
      admin,
      Buffer.alloc(0),
      {},
    ],
    [
      "corrupt video reference",
      "/api/h3/references?kind=video",
      400,
      admin,
      Buffer.from("broken"),
      {},
    ],
    [
      "raw JSON content type bypasses JSON parsing",
      "/api/h3/references?kind=video",
      400,
      admin,
      Buffer.from("broken"),
      { "Content-Type": "application/json" },
    ],
    [
      "unknown reference workspace",
      "/api/h3/references?kind=video",
      403,
      admin,
      referenceBytes,
      { "X-Workspace-Id": "999999" },
    ],
    [
      "foreign personal reference workspace",
      "/api/h3/references?kind=video",
      403,
      member,
      referenceBytes,
      { "X-Workspace-Id": "2" },
    ],
  ] as const)
    await pair(label, path, status, {
      method: "POST",
      sessions: [...sessions],
      bytes,
      headers,
    });
  for (const [kind, name, selection] of [
    [
      "video",
      encodeURIComponent("../文件夹/片段+测试.mkv"),
      "&workspace=9999&workspace=1",
    ],
    ["audio", "../bad%FF%20+%00%1Fname.wav", ""],
    ["video", encodeURIComponent("字😀".repeat(80) + ".mp4"), ""],
    ["audio", "a/./..//", ""],
  ]) {
    const responses = await Promise.all(
      [0, 1].map((i) =>
        request(i, "/api/h3/references?kind=ignored&kind=" + kind + selection, {
          bytes: referenceBytes,
          headers: {
            "X-File-Name": name,
            ...(selection ? {} : { "X-Workspace-Id": "1" }),
          },
        }),
      ),
    );
    const values = responses.map((r) => {
      assert.equal(r.status, 200, r.bytes.toString());
      return JSON.parse(r.bytes.toString());
    });
    assert.deepEqual({ ...values[1], id: "ID" }, { ...values[0], id: "ID" });
    const data = await Promise.all(
      [0, 1].map((i) => request(i, "/media/" + values[i].id)),
    );
    for (const r of data) assert.equal(r.status, 200);
    assert.deepEqual(data[1].bytes, data[0].bytes);
    const info = (
      await f.db.query(
        "SELECT r.* FROM asset_reference_media r JOIN assets a ON a.id=r.asset_id WHERE a.public_id=$1",
        [values[1].id],
      )
    ).rows[0];
    assert.equal(info.plugin_id, gpuReferences.manifest.id);
    assert.equal(info.plugin_version, "1.4.0");
    assert.equal(info.seconds, values[1].seconds);
    assert.equal(info.fps, kind === "video" ? 24 : 0);
    for (const i of [0, 1]) {
      const denied = await request(i, "/media/" + values[i].id, { cookie: "" });
      assert.equal(denied.status, 401);
      const removed = await request(i, "/api/assets/" + values[i].id, {
        method: "DELETE",
        headers: { "X-Workspace-Id": "1" },
      });
      assert.equal(removed.status, 200, removed.bytes.toString());
    }
    assert.equal(
      (
        await f.db.query(
          "SELECT * FROM asset_reference_media WHERE asset_id=$1",
          [info.asset_id],
        )
      ).rows.length,
      0,
    );
    checks.push(
      "reference " +
        kind +
        " upload preserves metadata, filenames, bytes, private access and deletion " +
        checks.length,
    );
  }
  await mkdir(".runtime-advanced/media-parity", { recursive: true });
  await writeFile(
    ".runtime-advanced/media-parity/report.json",
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
    "Original/Nest media parity: " + checks.length + " checks passed",
  );
} finally {
  await app?.close();
  legacy.kill("SIGTERM");
  await new Promise<void>((r) => {
    if (legacy.exitCode !== null) r();
    else {
      const timer = setTimeout(() => {
        legacy.kill("SIGKILL");
        r();
      }, 5000);
      legacy.once("exit", () => {
        clearTimeout(timer);
        r();
      });
    }
  });
  if (previous === undefined) delete process.env.PUBLIC_URL;
  else process.env.PUBLIC_URL = previous;
  await f.cleanup();
}
