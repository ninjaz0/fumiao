import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import express from "express";
import { Readable } from "node:stream";
import { once } from "node:events";
import { readdir, writeFile } from "node:fs/promises";
import { databaseFixture } from "../helpers/database.js";
import { one, type Sql } from "@fumiao/platform/db.js";
import { StudioCatalog } from "@fumiao/platform/catalog.js";
import { OriginalIdentity } from "@fumiao/original-api/identity.js";
import { OriginalMedia } from "@fumiao/original-api/media.js";
import { OriginalLibrary, archiveEntry } from "@fumiao/original-api/library.js";
import { OriginalStateRecords } from "@fumiao/original-api/state-records.js";
import { zipStream } from "@fumiao/original-api/zip.js";
import { sendFile } from "@fumiao/original-api/files.js";
import { S3Storage } from "@fumiao/platform/storage.js";
import { S3Client } from "@aws-sdk/client-s3";
import { PluginRegistry } from "@fumiao/platform/plugins.js";
import { gpuReferences } from "@fumiao/plugin-gpu/references.js";
import { createOriginalApp } from "../../apps/api/src/original.js";
import type { ProviderPlugin } from "@fumiao/plugin-sdk/index.js";
const password = "media-fixture-password";
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture() {
  const f = await databaseFixture(),
    identity = new OriginalIdentity(f.p);
  await identity.bootstrap({ name: "admin", nickname: "管理员", password });
  const token = await identity.login({ name: "admin", password }, "fixture"),
    admin = await identity.actor(token);
  const member = await f.db.transaction((sql) =>
    f.p.createUser(sql, "member", "成员", password, "member"),
  );
  const team = await one(f.db, "SELECT id FROM workspaces WHERE kind='team'");
  await f.db.query("INSERT INTO members(workspace_id,user_id) VALUES($1,$2)", [
    team.id,
    member.id,
  ]);
  const bytes = await sharp({
    create: { width: 17, height: 13, channels: 3, background: "#7a3f9d" },
  })
    .png()
    .toBuffer();
  async function asset(owner = admin, wid = team.id) {
    const result = await f.p.upload(owner, wid, bytes, "image/png");
    return one(f.db, "SELECT * FROM assets WHERE id=$1", [result.id]);
  }
  return {
    ...f,
    identity,
    token,
    admin,
    member,
    team: team.id,
    bytes,
    asset,
    media: new OriginalMedia(f.p),
  };
}
test("original and Advanced deletion enforce ownership, live references and storage accounting", async () => {
  const f = await fixture();
  try {
    const a = await f.asset(),
      initial = Number(
        (
          await one(f.db, "SELECT storage_used FROM workspaces WHERE id=$1", [
            f.team,
          ])
        ).storage_used,
      );
    await assert.rejects(f.media.remove(f.member, a.public_id, "1"), {
      status: 403,
      message: "只能删除自己的素材",
    });
    await assert.rejects(f.p.deleteAsset(f.member, a.id), { status: 403 });
    const document = randomUUID();
    await f.p.saveDocument(f.admin, f.team, {
      id: document,
      kind: "pack",
      title: "素材包",
      revision: 0,
      body: {},
      assets: [a.id],
    });
    await assert.rejects(f.media.remove(f.admin, a.public_id, "1"), {
      status: 409,
      message: "素材正在素材包中使用，请先从素材包移除",
    });
    assert.deepEqual(
      Buffer.from(await f.p.storage.read(a.object_key)),
      f.bytes,
    );
    await f.p.deleteDocument(f.admin, document);
    const canvas = randomUUID();
    await f.p.saveDocument(f.admin, f.team, {
      id: canvas,
      kind: "canvas",
      title: "画布",
      revision: 0,
      body: {},
      assets: [a.id],
    });
    await assert.rejects(f.media.remove(f.admin, a.public_id, "1"), {
      status: 409,
      message: "素材正在画布中使用，请先从相关画布移除",
    });
    await f.db.query("UPDATE documents SET deleted=true WHERE id=$1", [canvas]);
    assert.deepEqual(await f.media.remove(f.admin, a.public_id, "1"), {
      ok: true,
    });
    assert.equal(
      Number(
        (
          await one(f.db, "SELECT storage_used FROM workspaces WHERE id=$1", [
            f.team,
          ])
        ).storage_used,
      ),
      initial - Number(a.size),
    );
    await assert.rejects(f.p.storage.stat(a.object_key));
    assert.equal(
      await one(f.db, "SELECT * FROM assets WHERE id=$1", [a.id]),
      undefined,
    );
  } finally {
    await f.cleanup();
  }
});
test("accepted task inputs remain protected after settlement and generated outputs are not reference deletions", async () => {
  const f = await fixture();
  try {
    const plugin: ProviderPlugin = {
      manifest: {
        id: "media-fixture",
        version: "1.0.0",
        contractVersion: 1,
        label: "Fixture",
        mode: "pull",
        configSchema: { type: "object" },
        models: [
          {
            id: "fixture",
            label: "Fixture",
            kind: "image",
            inputSchema: { type: "object" },
          },
        ],
      },
      health: async () => true,
      submit: async () => {
        throw new Error("Fixture must not execute");
      },
    };
    f.p.registry = new PluginRegistry([plugin]);
    await f.p.registry.installBuiltins(f.db);
    const c = await f.p.createConnection(f.admin, {
      name: "fixture",
      pluginId: plugin.manifest.id,
      version: "1.0.0",
      config: {},
    });
    await f.p.updateConnection(f.admin, c.id, {
      revision: 1,
      enabled: true,
      concurrency: 1,
    });
    const model = await one(
      f.db,
      "SELECT id FROM models WHERE connection_id=$1",
      [c.id],
    );
    await f.p.setModel(f.admin, model.id, { enabled: true, price: 3 });
    await f.db.transaction((sql) =>
      f.p.credit(sql, f.team, 30, randomUUID(), "adjust"),
    );
    const a = await f.asset(),
      request = {
        modelId: model.id,
        key: randomUUID(),
        prompt: "fixture",
        references: [a.id],
      },
      job = await f.p.submit(f.admin, f.team, request);
    await assert.rejects(f.media.remove(f.admin, a.public_id, "1"), {
      status: 409,
      message: "仍有作品或任务引用这张图，请先删除相关版本",
    });
    await f.p.cancel(f.admin, job.id);
    await assert.rejects(f.media.remove(f.admin, a.public_id, "1"), {
      status: 409,
    });
    const output = await f.asset();
    await f.db.query("UPDATE assets SET original_kind='image' WHERE id=$1", [
      output.id,
    ]);
    await assert.rejects(f.media.remove(f.admin, output.public_id, "1"), {
      status: 404,
      message: "素材不存在",
    });
    const wallet = await one(
      f.db,
      "SELECT * FROM wallets WHERE workspace_id=$1",
      [f.team],
    );
    assert.equal(Number(wallet.balance), 30);
    assert.equal(Number(wallet.held), 0);
    const before = (await f.db.query("SELECT * FROM ledger ORDER BY public_id"))
      .rows;
    const library = new OriginalLibrary(f.p);
    const publicJob = await one(
      f.db,
      "SELECT public_id FROM jobs WHERE id=$1",
      [job.id],
    );
    assert.deepEqual(
      await library.remove(
        f.admin,
        { keys: ["job:" + publicJob.public_id, "asset:" + a.public_id] },
        "1",
      ),
      { deleted: 2 },
    );
    assert.deepEqual(
      await f.p.submit(f.admin, f.team, request),
      job,
      "a removed task cannot spend twice on retry",
    );
    assert.deepEqual(
      (await f.db.query("SELECT * FROM ledger ORDER BY public_id")).rows,
      before,
    );
    assert.deepEqual(await f.p.jobs(f.admin, f.team), []);
    await assert.rejects(f.p.cancel(f.admin, job.id), { status: 404 });
    const paidRequest = { ...request, key: randomUUID(), references: [] },
      paid = await f.p.submit(f.admin, f.team, paidRequest);
    await f.db.transaction(async (sql) => {
      await sql.query(
        "INSERT INTO job_assets(job_id,asset_id,role) VALUES($1,$2,'output')",
        [paid.id, output.id],
      );
      await f.p.settle(
        sql,
        await one(sql, "SELECT * FROM jobs WHERE id=$1 FOR UPDATE", [paid.id]),
        "completed",
        { assets: [output.id] },
      );
    });
    const paidJob = await one(f.db, "SELECT public_id FROM jobs WHERE id=$1", [
      paid.id,
    ]);
    await f.p.favorite(f.admin, output.id, true);
    assert.deepEqual(await library.favorites(f.db, f.admin, f.team), [
      "job:" + paidJob.public_id,
    ]);
    const ledger = (await f.db.query("SELECT * FROM ledger ORDER BY public_id"))
      .rows;
    await library.remove(f.admin, { keys: ["asset:" + output.public_id] }, "1");
    assert.deepEqual(await f.p.submit(f.admin, f.team, paidRequest), paid);
    assert.deepEqual(
      (await f.db.query("SELECT * FROM ledger ORDER BY public_id")).rows,
      ledger,
    );
    assert.equal(
      Number(
        (
          await one(f.db, "SELECT balance FROM wallets WHERE workspace_id=$1", [
            f.team,
          ])
        ).balance,
      ),
      27,
    );
    assert.deepEqual(await f.p.favorites(f.admin, f.team), []);
  } finally {
    await f.cleanup();
  }
});

test(
  "concurrent document saves acquire media protection before deletion",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const f = await fixture();
    const ready = deferred(),
      release = deferred(),
      deleting = deferred();
    let held = false;
    f.p.db = {
      ...f.db,
      transaction: (fn) =>
        f.db.transaction((sql) =>
          fn({
            query: async (statement, params) => {
              if (
                statement.includes("FROM assets WHERE public_id=$1") &&
                statement.includes("FOR UPDATE")
              )
                deleting.resolve();
              const result = await sql.query(statement, params);
              if (
                !held &&
                statement.includes("FROM assets WHERE id=$1") &&
                statement.includes("FOR KEY SHARE")
              ) {
                held = true;
                ready.resolve();
                await release.promise;
              }
              return result;
            },
          } as Sql),
        ),
    };
    try {
      const a = await f.asset();
      const save = f.p.saveDocument(f.admin, f.team, {
        id: randomUUID(),
        kind: "canvas",
        title: "并发引用",
        revision: 0,
        body: {},
        assets: [a.id],
      });
      await ready.promise;
      const remove = assert.rejects(f.media.remove(f.admin, a.public_id, "1"), {
        status: 409,
        message: "素材正在画布中使用，请先从相关画布移除",
      });
      await deleting.promise;
      release.resolve();
      await Promise.all([save, remove]);
      assert.ok(await one(f.db, "SELECT id FROM assets WHERE id=$1", [a.id]));
    } finally {
      release.resolve();
      await f.cleanup();
    }
  },
);

test("both protocols share canonical favorites and preserve per-user isolation", async () => {
  const f = await fixture();
  try {
    const library = new OriginalLibrary(f.p),
      a = await f.asset();
    await f.p.favorite(f.admin, a.id, true);
    assert.deepEqual(await library.favorites(f.db, f.admin, f.team), [
      "asset:" + a.public_id,
    ]);
    assert.deepEqual(await library.favorites(f.db, f.member, f.team), []);
    await library.changeFavorites(
      f.admin,
      { keys: ["asset:" + a.public_id], favorite: false },
      "1",
    );
    assert.deepEqual(await f.p.favorites(f.admin, f.team), []);
  } finally {
    await f.cleanup();
  }
});

test("ZIP streaming rejects incomplete or enlarged objects and closes every source", async () => {
  for (const size of [2, 4]) {
    const sources = [
      Readable.from([Buffer.from("abc")]),
      Readable.from([Buffer.from("later")]),
    ];
    const entries = [
      { key: "first", size, name: "001-素材.bin" },
      { key: "second", size: 5, name: "002-素材.bin" },
    ];
    await assert.rejects(async () => {
      for await (const chunk of zipStream(entries, sources)) void chunk;
    }, /Download source/);
    assert.ok(sources.every((s) => s.destroyed));
  }
});

test("private archive closes already opened sources when a later object is missing", async () => {
  const f = await fixture(),
    app = await createOriginalApp(f.p);
  try {
    const library = new OriginalLibrary(f.p),
      a = await f.asset(),
      b = await f.asset();
    const ticket = await library.prepareDownload(
      f.admin,
      { keys: ["asset:" + a.public_id, "asset:" + b.public_id] },
      "1",
    );
    await f.p.storage.remove(b.object_key);
    let opened: Readable | undefined;
    const real = f.p.storage.stream.bind(f.p.storage);
    f.p.storage.stream = async (key) => {
      const stream = await real(key);
      opened = stream;
      return stream;
    };
    await app.listen(0, "127.0.0.1");
    const response = await fetch((await app.getUrl()) + ticket.url, {
      headers: { cookie: "fm_session=" + f.token },
    });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      detail: "部分文件暂时无法读取，请重新选择下载",
    });
    assert.equal(opened?.destroyed, true);
  } finally {
    await app.close();
    await f.cleanup();
  }
});

test("an existing private download ticket stops working when membership is revoked", async () => {
  const f = await fixture(),
    app = await createOriginalApp(f.p);
  try {
    const library = new OriginalLibrary(f.p),
      a = await f.asset();
    const ticket = await library.prepareDownload(
      f.member,
      { keys: ["asset:" + a.public_id] },
      "1",
    );
    const token = await f.identity.login(
      { name: "member", password },
      "fixture",
    );
    const row = await one(f.db, "SELECT * FROM download_tickets");
    assert.notEqual(row.key_hash, ticket.url.split("/").at(-1));
    assert.equal(row.key_hash.length, 64);
    assert.ok(new Date(row.expires_at).getTime() <= Date.now() + 900000);
    await f.db.query(
      "DELETE FROM members WHERE workspace_id=$1 AND user_id=$2",
      [f.team, f.member.id],
    );
    let opened = false;
    f.p.storage.stream = async () => {
      opened = true;
      return Readable.from([]);
    };
    await app.listen(0, "127.0.0.1");
    const response = await fetch((await app.getUrl()) + ticket.url, {
      headers: { cookie: "fm_session=" + token },
    });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { detail: "内容不存在或无权访问" });
    assert.equal(opened, false);
  } finally {
    await app.close();
    await f.cleanup();
  }
});

test("private archive stops reading all sources after a client disconnect", async () => {
  const f = await fixture(),
    app = await createOriginalApp(f.p);
  try {
    const library = new OriginalLibrary(f.p),
      a = await f.asset(),
      b = await f.asset();
    const ticket = await library.prepareDownload(
      f.admin,
      { keys: ["asset:" + a.public_id, "asset:" + b.public_id] },
      "1",
    );
    await f.db.query(
      "UPDATE download_tickets SET manifest=jsonb_set(manifest,'{0,size}','67108864')",
    );
    let consumed = 0;
    const streams: Readable[] = [];
    f.p.storage.stream = async () => {
      const stream = Readable.from(
        (async function* () {
          for (let i = 0; i < 1024; i++) {
            await new Promise((r) => setTimeout(r, 2));
            consumed += 65536;
            yield Buffer.alloc(65536);
          }
        })(),
      );
      streams.push(stream);
      return stream;
    };
    await app.listen(0, "127.0.0.1");
    const response = await fetch((await app.getUrl()) + ticket.url, {
      headers: { cookie: "fm_session=" + f.token },
    });
    assert.equal(response.status, 200);
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    for (let i = 0; i < 50 && !streams.every((s) => s.destroyed); i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(streams.length, 2);
    assert.ok(streams.every((s) => s.destroyed));
    assert.ok(consumed < 2 * 1024 * 1024, "cancel must not drain an archive");
  } finally {
    await app.close();
    await f.cleanup();
  }
});
test("a shared imported avatar is removed only after its last profile reference changes", async () => {
  const f = await fixture();
  try {
    const key = randomUUID().replaceAll("-", ""),
      object = "avatar-" + randomUUID(),
      bytes = await sharp(f.bytes).webp().toBuffer();
    await f.p.storage.put(object, bytes, "image/webp");
    await f.db.query(
      "INSERT INTO avatar_objects(public_id,object_key,size,modified,sha256) VALUES($1,$2,$3,$4,$5)",
      [
        key,
        object,
        bytes.length,
        Date.now() / 1000,
        createHash("sha256").update(bytes).digest("hex"),
      ],
    );
    await f.db.query("UPDATE users SET avatar=$1 WHERE id=ANY($2::uuid[])", [
      "upload:" + key,
      [f.admin.id, f.member.id],
    ]);
    await f.identity.editProfile(f.admin, { avatar: "builtin:alpine" });
    assert.ok(
      await one(f.db, "SELECT * FROM avatar_objects WHERE public_id=$1", [key]),
    );
    await f.p.storage.stat(object);
    await f.identity.editProfile(f.member, { avatar: "builtin:moon" });
    assert.equal(
      await one(f.db, "SELECT * FROM avatar_objects WHERE public_id=$1", [key]),
      undefined,
    );
    await assert.rejects(f.p.storage.stat(object));
  } finally {
    await f.cleanup();
  }
});
test("private object-store redirects preserve download headers and are signed only after authorization", async () => {
  const f = await fixture(),
    app = await createOriginalApp(f.p);
  try {
    const own = await one(
        f.db,
        "SELECT id FROM workspaces WHERE owner_id=$1 AND kind='personal'",
        [f.admin.id],
      ),
      a = await f.asset(f.admin, own.id);
    const signed: any[] = [];
    f.p.storage.downloadUrl = async (key, response) => {
      signed.push({ key, response });
      return "https://objects.invalid/signed?ticket=fixture";
    };
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    const response = await fetch(
      base + "/media/" + a.public_id + "?download=1",
      { headers: { cookie: "fm_session=" + f.token }, redirect: "manual" },
    );
    assert.equal(response.status, 307);
    assert.equal(
      response.headers.get("location"),
      "https://objects.invalid/signed?ticket=fixture",
    );
    assert.equal(await response.text(), "");
    assert.equal(response.headers.get("content-type"), null);
    assert.deepEqual(signed, [
      {
        key: a.object_key,
        response: {
          mime: "image/png",
          filename: "弗淼-" + a.public_id.slice(0, 8) + ".png",
        },
      },
    ]);
    const member = await f.identity.login(
      { name: f.member.name, password },
      "member",
    );
    assert.equal(
      (
        await fetch(base + "/media/" + a.public_id, {
          headers: { cookie: "fm_session=" + member },
          redirect: "manual",
        })
      ).status,
      404,
    );
    assert.equal(signed.length, 1);
  } finally {
    await app.close();
    await f.cleanup();
  }
});
test("private file streams stop reading when a client disconnects", async () => {
  const app = express();
  let consumed = 0,
    closed = false;
  app.get("/file", (req, res) => {
    void sendFile(req, res, {
      size: 64 * 1024 * 1024,
      mime: "video/mp4",
      modified: 1,
      open: async (start = 0, end = 64 * 1024 * 1024 - 1) =>
        Readable.from(
          (async function* () {
            try {
              for (let p = start; p <= end; p += 65536) {
                await new Promise<void>((r) => setImmediate(r));
                const chunk = Buffer.alloc(Math.min(65536, end - p + 1));
                consumed += chunk.length;
                yield chunk;
              }
            } finally {
              closed = true;
            }
          })(),
        ),
    });
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const response = await fetch(
      "http://127.0.0.1:" + (server.address() as any).port + "/file",
    );
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    for (let i = 0; i < 50 && !closed; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(closed, true);
    assert.ok(
      consumed < 2 * 1024 * 1024,
      "disconnect must not drain the object",
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("original uploads clean partial objects and rolled-back metadata after storage, quota and account failures", async () => {
  const f = await fixture(),
    app = await createOriginalApp(f.p);
  try {
    await app.listen(0, "127.0.0.1");
    const url = await app.getUrl(),
      put = f.p.storage.put.bind(f.p.storage);
    const send = async (path: string, method: string) => {
      const response = await fetch(url + path, {
        method,
        headers: {
          Cookie: "fm_session=" + f.token,
          "X-Workspace-Id": "1",
          "Content-Type": "application/octet-stream",
        },
        body: new Uint8Array(f.bytes).buffer,
      });
      return { status: response.status, body: await response.json() };
    };
    f.p.storage.put = async (...args) => {
      await put(...args);
      throw new Error("synthetic partial write");
    };
    assert.equal((await send("/api/assets", "POST")).status, 500);
    assert.deepEqual(await readdir(f.directory), []);
    assert.equal((await f.db.query("SELECT * FROM assets")).rows.length, 0);
    f.p.storage.put = async (...args) => {
      await put(...args);
      await f.db.query("UPDATE storage_capacity SET quota=0");
    };
    assert.deepEqual(await send("/api/assets", "POST"), {
      status: 507,
      body: { detail: "空间不足，请先清理素材或作品" },
    });
    assert.deepEqual(await readdir(f.directory), []);
    assert.equal((await f.db.query("SELECT * FROM assets")).rows.length, 0);
    f.p.storage.put = async (...args) => {
      await put(...args);
      await f.db.query("UPDATE users SET active=false WHERE id=$1", [
        f.admin.id,
      ]);
    };
    assert.deepEqual(await send("/api/me/avatar", "PUT"), {
      status: 401,
      body: { detail: "请重新登录" },
    });
    assert.deepEqual(await readdir(f.directory), []);
    assert.equal(
      (await f.db.query("SELECT * FROM avatar_objects")).rows.length,
      0,
    );
  } finally {
    await app.close();
    await f.cleanup();
  }
});

test("generated MP4 media serves .mp4 ASCII fallback and UTF-8 filename* for local sendFile, inline save-as, and S3 downloadUrl", async () => {
  const f = await fixture(),
    app = await createOriginalApp(f.p),
    s3 = new S3Storage("private-fixture");
  s3.client.destroy();
  s3.client = new S3Client({
    endpoint: "https://objects.invalid",
    region: "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: "fixture-key",
      secretAccessKey: "fixture-secret",
    },
  });
  try {
    const mp4Bytes = Buffer.from("000000186674797069736f6d", "hex"),
      id = randomUUID(),
      key = randomUUID().replaceAll("-", ""),
      objectKey = "video-" + randomUUID();
    await f.p.storage.put(objectKey, mp4Bytes, "video/mp4");
    await f.db.query(
      "INSERT INTO assets(id,public_id,workspace_id,owner_id,object_key,mime,size,state,original_kind,metadata) VALUES($1,$2,$3,$4,$5,'video/mp4',$6,'ready','video','{}')",
      [id, key, f.team, f.admin.id, objectKey, mp4Bytes.length],
    );
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl(),
      cookie = { cookie: "fm_session=" + f.token },
      prefix = key.slice(0, 8),
      expectedAttachment = `attachment; filename="fumiao-${prefix}.mp4"; filename*=UTF-8''%E5%BC%97%E6%B7%BC-${prefix}.mp4`,
      expectedInline = `inline; filename="fumiao-${prefix}.mp4"; filename*=UTF-8''%E5%BC%97%E6%B7%BC-${prefix}.mp4`;

    const attachmentRes = await fetch(`${base}/media/${key}?download=true`, {
      headers: cookie,
    });
    assert.equal(attachmentRes.status, 200);
    assert.equal(attachmentRes.headers.get("content-type"), "video/mp4");
    assert.equal(
      attachmentRes.headers.get("content-disposition"),
      expectedAttachment,
    );
    assert.deepEqual(Buffer.from(await attachmentRes.arrayBuffer()), mp4Bytes);

    const inlineRes = await fetch(`${base}/media/${key}`, { headers: cookie });
    assert.equal(inlineRes.status, 200);
    assert.equal(inlineRes.headers.get("content-type"), "video/mp4");
    assert.equal(inlineRes.headers.get("content-disposition"), expectedInline);
    assert.deepEqual(Buffer.from(await inlineRes.arrayBuffer()), mp4Bytes);

    f.p.storage.downloadUrl = s3.downloadUrl.bind(s3);
    const s3Download = await fetch(`${base}/media/${key}?download=true`, {
      headers: cookie,
      redirect: "manual",
    });
    assert.equal(s3Download.status, 307);
    const signedDownload = new URL(s3Download.headers.get("location")!);
    assert.equal(
      signedDownload.searchParams.get("response-content-type"),
      "video/mp4",
    );
    assert.equal(
      signedDownload.searchParams.get("response-content-disposition"),
      expectedAttachment,
    );

    const s3Direct = await fetch(`${base}/media/${key}`, {
      headers: cookie,
      redirect: "manual",
    });
    assert.equal(s3Direct.status, 307);
    const signedDirect = new URL(s3Direct.headers.get("location")!);
    assert.equal(
      signedDirect.searchParams.get("response-content-disposition"),
      expectedInline,
    );

    const s3Embedded = await fetch(`${base}/media/${key}`, {
      headers: { ...cookie, "Sec-Fetch-Dest": "video" },
      redirect: "manual",
    });
    assert.equal(s3Embedded.status, 200);
    assert.equal(s3Embedded.headers.get("content-disposition"), expectedInline);
    await s3Embedded.arrayBuffer();
  } finally {
    s3.client.destroy();
    await app.close();
    await f.cleanup();
  }
});

test("uploaded reference videos with dotted original names preserve dot stems and end with .mp4", async () => {
  const f = await fixture(),
    app = await createOriginalApp(f.p);
  try {
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl(),
      cookie = { cookie: "fm_session=" + f.token },
      mp4Bytes = Buffer.from("000000186674797069736f6d", "hex");

    const cases = [
      {
        original: "my.clip.2026.11.mov",
        utf8: "my.clip.2026.11.mp4",
        ascii: "my.clip.2026.11.mp4",
      },
      {
        original: "scene.01.mp4",
        utf8: "scene.01.mp4",
        ascii: "scene.01.mp4",
      },
      {
        original: "test.v2",
        utf8: "test.v2.mp4",
        ascii: "test.v2.mp4",
      },
      {
        original: "2026.11.19.镜头1.mov",
        utf8: "2026.11.19.镜头1.mp4",
        ascii: "2026.11.19.1.mp4",
      },
      {
        original: "产品演示.1080p",
        utf8: "产品演示.1080p.mp4",
        ascii: "1080p.mp4",
      },
      {
        original: 'dir/sub\\quote"bad.v3.WEBM',
        utf8: "dir_sub_quotebad.v3.mp4",
        ascii: "dir_sub_quotebad.v3.mp4",
      },
    ];

    for (const item of cases) {
      const id = randomUUID(),
        key = randomUUID().replaceAll("-", ""),
        objectKey = "ref-video-" + randomUUID();
      await f.p.storage.put(objectKey, mp4Bytes, "video/mp4");
      await f.db.query(
        "INSERT INTO assets(id,public_id,workspace_id,owner_id,object_key,mime,size,state,original_kind,metadata) VALUES($1,$2,$3,$4,$5,'video/mp4',$6,'ready','ref_video','{}')",
        [id, key, f.team, f.admin.id, objectKey, mp4Bytes.length],
      );
      await f.db.query(
        "INSERT INTO asset_reference_media(asset_id,seconds,fps,has_audio,name) VALUES($1,5,24,true,$2)",
        [id, item.original],
      );

      const expectedEncoded = encodeURIComponent(item.utf8);
      const res = await fetch(`${base}/media/${key}?download=true`, {
        headers: cookie,
      });
      assert.equal(res.status, 200);
      assert.equal(
        res.headers.get("content-disposition"),
        `attachment; filename="${item.ascii}"; filename*=UTF-8''${expectedEncoded}`,
      );
      await res.arrayBuffer();

      const inline = await fetch(`${base}/media/${key}`, { headers: cookie });
      assert.equal(inline.status, 200);
      assert.equal(
        inline.headers.get("content-disposition"),
        `inline; filename="${item.ascii}"; filename*=UTF-8''${expectedEncoded}`,
      );
      await inline.arrayBuffer();
    }
  } finally {
    await app.close();
    await f.cleanup();
  }
});

test("official /api/h3/references upload path, parameterized/mixed-case legacy MIME, take..02.mov, and 304 revalidation preserve .mp4", async () => {
  const f = await fixture(),
    mp4Bytes = Buffer.from("000000186674797069736f6d", "hex");
  const refPlugin: ProviderPlugin = {
    ...gpuReferences,
    importReference: async (_input, output) => {
      await writeFile(output, mp4Bytes);
      return {
        seconds: 3,
        fps: 24,
        has_audio: true,
        w: 320,
        h: 180,
        mime: "video/mp4",
        size: mp4Bytes.length,
      };
    },
  };
  await f.p.registry.installBuiltins(f.db);
  f.p.registry = new PluginRegistry([refPlugin]);
  await f.db.transaction((sql) =>
    new StudioCatalog(f.db).activate(sql, gpuReferences.manifest),
  );
  const app = await createOriginalApp(f.p);
  try {
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl(),
      cookie = { cookie: "fm_session=" + f.token };

    // 1. Official /api/h3/references?kind=video upload path with multi-dot and consecutive-dot names
    for (const item of [
      {
        raw: "2026.11.19.镜头1.mov",
        utf8: "2026.11.19.镜头1.mp4",
        ascii: "2026.11.19.1.mp4",
      },
      {
        raw: "my.clip.2026.11.mov",
        utf8: "my.clip.2026.11.mp4",
        ascii: "my.clip.2026.11.mp4",
      },
      {
        raw: "take..02.mov",
        utf8: "take..02.mp4",
        ascii: "take..02.mp4",
      },
      {
        raw: "产品演示.1080p.mov",
        utf8: "产品演示.1080p.mp4",
        ascii: "1080p.mp4",
      },
    ]) {
      const uploadRes = await fetch(`${base}/api/h3/references?kind=video`, {
        method: "POST",
        headers: {
          Cookie: cookie.cookie,
          "X-Workspace-Id": "1",
          "X-File-Name": encodeURIComponent(item.raw),
          "Content-Type": "video/quicktime",
        },
        body: mp4Bytes,
      });
      assert.equal(uploadRes.status, 200);
      const uploaded = (await uploadRes.json()) as { id: string; name: string };
      assert.equal(uploaded.name, item.raw);

      const dl = await fetch(`${base}/media/${uploaded.id}?download=true`, {
        headers: cookie,
      });
      assert.equal(dl.status, 200);
      assert.equal(
        dl.headers.get("content-disposition"),
        `attachment; filename="${item.ascii}"; filename*=UTF-8''${encodeURIComponent(item.utf8)}`,
      );
      await dl.arrayBuffer();
    }

    // 2. Legacy parameterized or mixed-case MIME values (e.g. "video/mp4; codecs=avc1", "Video/MP4")
    for (const rawMime of [
      "video/mp4; codecs=avc1",
      ' Video/MP4 ; codecs="avc1.42E01E, mp4a.40.2" ',
      "VIDEO/MP4",
    ]) {
      const id = randomUUID(),
        key = randomUUID().replaceAll("-", ""),
        objectKey = "legacy-mime-" + randomUUID();
      await f.p.storage.put(objectKey, mp4Bytes, "video/mp4");
      await f.db.query(
        "INSERT INTO assets(id,public_id,workspace_id,owner_id,object_key,mime,size,state,original_kind,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,'ready','ref_video','{}')",
        [id, key, f.team, f.admin.id, objectKey, rawMime, mp4Bytes.length],
      );
      await f.db.query(
        "INSERT INTO asset_reference_media(asset_id,seconds,fps,has_audio,name) VALUES($1,4,24,true,'clip.v2.mp4')",
        [id],
      );

      assert.equal(
        archiveEntry({ public_id: key, size: mp4Bytes.length, mime: rawMime }, "001-素材").name,
        "001-素材.mp4",
      );

      const res = await fetch(`${base}/media/${key}?download=true`, {
        headers: cookie,
      });
      assert.equal(res.status, 200);
      assert.equal(
        res.headers.get("content-disposition"),
        "attachment; filename=\"clip.v2.mp4\"; filename*=UTF-8''clip.v2.mp4",
      );
      await res.arrayBuffer();
    }

    // 3. Pre-upgrade cached ETag does NOT short-circuit to dispositionless 304, and 304 carries Content-Disposition
    const cacheId = randomUUID(),
      cacheKey = randomUUID().replaceAll("-", ""),
      cacheObject = "cache-video-" + randomUUID(),
      modified = 1700000000;
    await f.p.storage.put(cacheObject, mp4Bytes, "video/mp4");
    await f.db.query(
      "INSERT INTO assets(id,public_id,workspace_id,owner_id,object_key,mime,size,state,original_kind,object_modified,metadata) VALUES($1,$2,$3,$4,$5,'video/mp4',$6,'ready','video',$7,'{}')",
      [cacheId, cacheKey, f.team, f.admin.id, cacheObject, mp4Bytes.length, modified],
    );
    const legacyEtag =
      '"' +
      createHash("md5")
        .update(`${modified.toFixed(1)}-${mp4Bytes.length}`)
        .digest("hex") +
      '"';
    const expectedInline = `inline; filename="fumiao-${cacheKey.slice(0, 8)}.mp4"; filename*=UTF-8''%E5%BC%97%E6%B7%BC-${cacheKey.slice(0, 8)}.mp4`;

    // Revalidating with pre-upgrade ETag must miss 304 and return fresh 200 with Content-Disposition + new ETag
    const upgradedFromLegacy = await fetch(`${base}/media/${cacheKey}`, {
      headers: {
        ...cookie,
        "If-None-Match": legacyEtag,
        "If-Modified-Since": new Date(modified * 1000).toUTCString(),
      },
    });
    assert.equal(upgradedFromLegacy.status, 200);
    assert.equal(
      upgradedFromLegacy.headers.get("content-disposition"),
      expectedInline,
    );
    const newEtag = upgradedFromLegacy.headers.get("etag")!;
    assert.ok(newEtag && newEtag !== legacyEtag);
    await upgradedFromLegacy.arrayBuffer();

    // Subsequent revalidation with new ETag returns 304 AND preserves Content-Disposition
    const revalidated304 = await fetch(`${base}/media/${cacheKey}`, {
      headers: { ...cookie, "If-None-Match": newEtag },
    });
    assert.equal(revalidated304.status, 304);
    assert.equal(
      revalidated304.headers.get("content-disposition"),
      expectedInline,
    );

    // If-Modified-Since-only 304 also carries Content-Disposition
    const imsOnly304 = await fetch(`${base}/media/${cacheKey}`, {
      headers: {
        ...cookie,
        "If-Modified-Since": new Date(modified * 1000).toUTCString(),
      },
    });
    assert.equal(imsOnly304.status, 304);
    assert.equal(imsOnly304.headers.get("content-disposition"), expectedInline);

    // 4. Archived legacy jobs expose real result_mime (e.g. video/webm vs video/mp4)
    const webmAssetId = randomUUID(),
      webmKey = "a".repeat(32);
    await f.p.storage.put("webm-" + webmAssetId, Buffer.from("1a45dfa3", "hex"), "video/webm");
    await f.db.query(
      "INSERT INTO assets(id,public_id,workspace_id,owner_id,object_key,mime,size,state,original_kind,metadata) VALUES($1,$2,$3,$4,$5,'video/webm',4,'ready','video','{}')",
      [webmAssetId, webmKey, f.team, f.admin.id, "webm-" + webmAssetId],
    );
    const legacyConn = randomUUID(),
      legacyModel = randomUUID(),
      legacyJob = randomUUID();
    await f.db.query(
      `INSERT INTO plugin_versions(id,version,manifest) VALUES('legacy-archive','1.0.0','{"id":"legacy-archive","version":"1.0.0","contractVersion":1,"label":"Archive","mode":"pull","models":[],"configSchema":{"type":"object"}}') ON CONFLICT DO NOTHING`,
    );
    await f.db.query(
      "INSERT INTO connections(id,name,plugin_id,plugin_version,config) VALUES($1,'Archive','legacy-archive','1.0.0',$2)",
      [legacyConn, f.p.vault.seal({})],
    );
    await f.db.query(
      "INSERT INTO models(id,connection_id,provider_model,label,kind,schema) VALUES($1,$2,'muse-video','Muse','video','{}')",
      [legacyModel, legacyConn],
    );
    await f.db.query(
      `INSERT INTO jobs(id,public_id,workspace_id,owner_id,model_id,connection_id,plugin_id,plugin_version,config_snapshot,provider_model,kind,input,idempotency_key,request_hash,price,state,result,attempts,original_view)
       VALUES($1,901,$2,$3,$4,$5,'legacy-archive','1.0.0',$6,'muse-video','video','{"prompt":"legacy webm"}','legacy-901','legacy-901',1,'completed',$7,1,$8)`,
      [
        legacyJob,
        f.team,
        f.admin.id,
        legacyModel,
        legacyConn,
        f.p.vault.seal({}),
        JSON.stringify({ assets: [webmAssetId] }),
        JSON.stringify({
          ratio: "16:9",
          quality: 480,
          seconds: 5,
          sampling_steps: 20,
          seed: 1,
          width: 864,
          height: 480,
          image_quality: null,
          audio_settings: {},
          h3_inputs: {},
          actual: {},
          refs: [],
        }),
      ],
    );
    const archived = await new OriginalStateRecords().archivedJobs(
      f.db,
      f.team,
      1800000000,
    );
    const archivedWebm = archived.find((j) => j.id === 901);
    assert.ok(archivedWebm);
    assert.equal(archivedWebm.result, webmKey);
    assert.equal(archivedWebm.result_mime, "video/webm");
  } finally {
    await app.close();
    await f.cleanup();
  }
});

test("single-item deletion of uploaded video and audio enforces ownership, job reference messages and reference-media cleanup", async () => {
  const f = await fixture();
  try {
    const plugin: ProviderPlugin = {
      manifest: {
        id: "av-media-fixture",
        version: "1.0.0",
        contractVersion: 1,
        label: "Fixture",
        mode: "pull",
        configSchema: { type: "object" },
        models: [
          {
            id: "fixture",
            label: "Fixture",
            kind: "video",
            inputSchema: { type: "object" },
          },
        ],
      },
      health: async () => true,
      submit: async () => {
        throw new Error("Fixture must not execute");
      },
    };
    f.p.registry = new PluginRegistry([plugin]);
    await f.p.registry.installBuiltins(f.db);
    const conn = await f.p.createConnection(f.admin, {
      name: "av-fixture",
      pluginId: plugin.manifest.id,
      version: "1.0.0",
      config: {},
    });
    await f.p.updateConnection(f.admin, conn.id, {
      revision: 1,
      enabled: true,
      concurrency: 1,
    });
    const model = await one(
      f.db,
      "SELECT id FROM models WHERE connection_id=$1",
      [conn.id],
    );
    await f.p.setModel(f.admin, model.id, { enabled: true, price: 1 });
    await f.db.transaction((sql) =>
      f.p.credit(sql, f.team, 20, randomUUID(), "adjust"),
    );

    for (const [kind, mime, expectedMessage] of [
      [
        "ref_video",
        "video/mp4",
        "仍有作品或任务引用这段视频，请先删除相关版本",
      ],
      [
        "ref_audio",
        "audio/wav",
        "仍有作品或任务引用这段音频，请先删除相关版本",
      ],
    ] as const) {
      const refAsset = await f.asset();
      await f.db.query(
        "UPDATE assets SET original_kind=$2, mime=$3 WHERE id=$1",
        [refAsset.id, kind, mime],
      );
      await f.db.query(
        "INSERT INTO asset_reference_media(asset_id,seconds,fps,has_audio,name) VALUES($1,4,24,true,'sample')",
        [refAsset.id],
      );
      await f.p.favorite(f.admin, refAsset.id, true);

      await assert.rejects(
        f.media.remove(f.member, refAsset.public_id, "1"),
        { status: 403, message: "只能删除自己的素材" },
      );

      const job = await f.p.submit(f.admin, f.team, {
        modelId: model.id,
        key: randomUUID(),
        prompt: "av-ref",
        references: [refAsset.id],
      });
      await assert.rejects(
        f.media.remove(f.admin, refAsset.public_id, "1"),
        { status: 409, message: expectedMessage },
      );

      await f.p.cancel(f.admin, job.id);
      await f.db.query("DELETE FROM job_assets WHERE job_id=$1", [job.id]);
      assert.deepEqual(
        await f.media.remove(f.admin, refAsset.public_id, "1"),
        { ok: true },
      );
      assert.equal(
        await one(
          f.db,
          "SELECT asset_id FROM asset_reference_media WHERE asset_id=$1",
          [refAsset.id],
        ),
        undefined,
      );
      assert.equal(
        await one(f.db, "SELECT * FROM assets WHERE id=$1", [refAsset.id]),
        undefined,
      );
    }
  } finally {
    await f.cleanup();
  }
});
