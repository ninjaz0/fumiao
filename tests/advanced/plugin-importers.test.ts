import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import sharp from "sharp";
import { databaseFixture } from "../helpers/database.js";
import { one } from "@fumiao/platform/db.js";
import { StudioPackages } from "@fumiao/platform/studio-packages.js";
import type { HttpTransport } from "@fumiao/platform/plugin-host.js";
import { OriginalMedia } from "@fumiao/original-api/media.js";
import { OriginalIdentity } from "@fumiao/original-api/identity.js";
import { OriginalCanvases } from "@fumiao/original-api/canvases.js";
import {
  PluginImports,
  importersFor,
} from "@fumiao/original-api/plugin-importers.js";

test("installed importers create private assets and native projects, deduplicate retries and roll back rejected projects", async (t) => {
  const f = await databaseFixture();
  t.after(f.cleanup);
  await f.p.registry.initializeStudio(f.db, false);
  const identity = new OriginalIdentity(f.p);
  const credentials = { name: "admin", password: randomUUID() };
  await identity.bootstrap({ ...credentials, nickname: "管理员" });
  const admin = await identity.actor(
    await identity.login(credentials, "import"),
  );
  const other = { name: "member", password: randomUUID() };
  await identity.createMember(admin, other);
  const member = await identity.actor(
    await identity.login(other, "import-member"),
  );
  const space = await identity.activeWorkspace(f.db, admin);
  const pkg = JSON.parse(
    await readFile(
      "plugins/example-importers/example-importers.fmplugin.json",
      "utf8",
    ),
  );
  const packages = new StudioPackages(f.p);
  const restricted = {
    ...pkg.contributes.importers[1],
    id: "project",
    audience: "admin",
    program: "({ plan({source}) { return JSON.parse(source); } })",
  };
  pkg.contributes.importers.push(restricted);
  await packages.install(admin, pkg);
  assert.deepEqual(await importersFor(f.db, member), []);
  await packages.change(admin, pkg.id, 1, "enable");
  assert.deepEqual(
    (await importersFor(f.db, member)).map((i) => i.id),
    ["image", "story"],
  );
  const bytes = await sharp({
    create: { width: 16, height: 16, channels: 3, background: "#0088cc" },
  })
    .png()
    .toBuffer();
  const samples = await mkdtemp(join(tmpdir(), "fumiao-import-samples-"));
  t.after(() => rm(samples, { recursive: true, force: true }));
  const movie = join(samples, "clip.mkv");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    "color=size=96x64:rate=24:duration=2",
    "-f",
    "lavfi",
    "-i",
    "sine=duration=2",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-c:a",
    "pcm_s16le",
    movie,
  ]);
  const clip = await readFile(movie);
  const requests: string[] = [];
  const http: HttpTransport = async (url) => {
    requests.push(url.pathname);
    return {
      status: url.pathname === "/missing" ? 404 : 200,
      contentType: "application/octet-stream",
      body: url.pathname === "/clip" ? clip : bytes,
    };
  };
  const host = new PluginImports(f.p, http),
    url = "https://raw.githubusercontent.com/cover";
  const input = (source: string) => ({
    requestId: randomUUID(),
    source,
    version: pkg.version,
  });
  const run = (
    id: string,
    body: ReturnType<typeof input>,
    actor = admin,
    workspace = String(space.public_id),
  ) => host.run(actor, workspace, pkg.id, id, body, AbortSignal.timeout(30000));
  const story = input(
    JSON.stringify({ title: "海面", shots: ["日出", "渔船"] }),
  );
  const [a, b] = await Promise.all([run("story", story), run("story", story)]);
  assert.deepEqual(a, b);
  assert.ok(a.canvas);
  const canvas = new OriginalCanvases(f.p);
  const project = await canvas.get(admin, a.canvas.id);
  assert.equal(project.title, "海面");
  assert.deepEqual(project.document.shots, ["shot-0", "shot-1"]);
  assert.equal(project.document.nodes.length, 4);
  await assert.rejects(canvas.get(member, a.canvas.id));
  await assert.rejects(
    run("story", { ...story, source: "changed" }),
    /请求编号/,
  );
  await assert.rejects(run("story", story, member), /工作区/);
  const memberSpace = await identity.activeWorkspace(f.db, member);
  await assert.rejects(
    run("project", story, member, String(memberSpace.public_id)),
    /无权/,
  );
  await assert.rejects(
    run("story", { ...story, requestId: randomUUID(), version: "0.1.0" }),
    /插件已更新/,
  );
  const image = input(url);
  const first = await run("image", image);
  assert.deepEqual(await run("image", image), first);
  assert.deepEqual(requests, ["/cover"]);
  const asset = await one(
    f.db,
    "SELECT owner_id,workspace_id,mime,original_kind,object_key FROM assets WHERE public_id=$1",
    [first.assets[0].id],
  );
  await assert.rejects(
    new OriginalMedia(f.p).resource(f.db, member, first.assets[0].id),
    /无权/,
  );
  assert.equal(asset.owner_id, admin.id);
  assert.equal(asset.workspace_id, space.id);
  assert.match(asset.mime, /^image\//);
  const decoded = await sharp(
    await f.p.storage.read(asset.object_key),
  ).metadata();
  assert.equal(decoded.width, 16);
  assert.equal(asset.original_kind, "ref");
  const original = await readdir(f.directory);
  const media = { key: "cover", kind: "image", url };
  const plan = {
    target: "canvas",
    assets: [media],
    canvas: {
      title: "引用",
      nodes: [{ id: "n", type: "image", x: 0, y: 0, image: "cover" }],
      edges: [],
    },
  };
  const imported = await run("project", input(JSON.stringify(plan)));
  assert.ok(imported.canvas);
  const refs = await canvas.get(admin, imported.canvas.id);
  assert.equal(refs.document.nodes[0].media_id, imported.assets[0].id);
  const stored = await readdir(f.directory);
  assert.ok(stored.length > original.length);
  const invalid = {
    ...plan,
    canvas: {
      ...plan.canvas,
      edges: [{ id: "loop", source: "n", target: "n" }],
    },
  };
  await assert.rejects(run("project", input(JSON.stringify(invalid))));
  const partial = {
    ...plan,
    assets: [
      media,
      {
        ...media,
        key: "missing",
        url: "https://raw.githubusercontent.com/missing",
      },
    ],
  };
  await assert.rejects(
    run("project", input(JSON.stringify(partial))),
    /完整文件/,
  );
  const calls = requests.length;
  await assert.rejects(
    run("image", input("https://unapproved.example/cover")),
    /导入失败/,
  );
  assert.equal(requests.length, calls);
  assert.deepEqual(await readdir(f.directory), stored);
  assert.equal(
    Number((await one(f.db, "SELECT count(*) AS n FROM assets")).n),
    2,
  );
  assert.equal(
    Number((await one(f.db, "SELECT count(*) AS n FROM canvas_documents")).n),
    2,
  );
  assert.equal(
    Number(
      (await one(f.db, "SELECT count(*) AS n FROM studio_action_receipts")).n,
    ),
    3,
  );
  const tracks = await run(
    "project",
    input(
      JSON.stringify({
        target: "canvas",
        canvas: { title: "媒体样片", nodes: [] },
        assets: ["audio", "video"].map((kind) => ({
          kind,
          key: kind,
          name: "样片",
          url: "https://raw.githubusercontent.com/clip",
        })),
      }),
    ),
  );
  for (const track of tracks.assets) {
    const record = await one(
      f.db,
      "SELECT a.mime,a.object_key,r.seconds,r.name FROM assets a JOIN asset_reference_media r ON r.asset_id=a.id WHERE a.public_id=$1",
      [track.id],
    );
    assert.equal(
      record.mime,
      track.kind === "video" ? "video/mp4" : "audio/wav",
    );
    assert.ok(record.seconds >= 1 && record.seconds <= 3);
    assert.equal(record.name, "样片");
    await assert.rejects(
      new OriginalMedia(f.p).resource(f.db, member, track.id),
      /无权/,
    );
    const chunks = [];
    for await (const part of await f.p.storage.stream(record.object_key, 1, 4))
      chunks.push(part);
    assert.equal(Buffer.concat(chunks).length, 4);
  }
  await packages.change(admin, pkg.id, 2, "disable");
  assert.deepEqual(await run("image", image), first);
  await assert.rejects(run("image", input(url)), /未启用/);
});
