import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import express from "express";
import { Readable } from "node:stream";
import { once } from "node:events";
import { readdir } from "node:fs/promises";
import { loseUploadAcknowledgement } from "../helpers/upload-acknowledgement.js";
import { databaseFixture } from "../helpers/database.js";
import { one, type Sql } from "../../packages/platform/src/db.js";
import { OriginalIdentity } from "../../packages/original-api/src/identity.js";
import { OriginalMedia } from "../../packages/original-api/src/media.js";
import { OriginalLibrary } from "../../packages/original-api/src/library.js";
import { zipStream } from "../../packages/original-api/src/zip.js";
import { sendFile } from "../../packages/original-api/src/files.js";
import { PluginRegistry } from "../../packages/platform/src/plugins.js";
import { createOriginalApp } from "../../apps/api/src/original.js";
import type { ProviderPlugin } from "../../packages/plugin-sdk/src/index.js";
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
for (const offline of [false, true]) {
  test(`committed image survives acknowledgement loss with database ${offline ? "offline" : "available"}`, async () => {
    const f = await fixture();
    const app = await createOriginalApp(f.p);
    try {
      await app.listen(0, "127.0.0.1");
      const url = await app.getUrl();
      const headers = {
        Cookie: "fm_session=" + f.token,
        "X-Workspace-Id": "1",
      };
      const response = await loseUploadAcknowledgement(
        f.db,
        async () =>
          fetch(url + "/api/assets", {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/octet-stream" },
            body: new Uint8Array(f.bytes),
          }),
        offline,
      );

      const { rows } = await f.db.query(
        "SELECT public_id, state, object_key, metadata FROM assets",
      );
      assert.equal(rows.length, 1);
      const [asset] = rows;
      assert.equal(asset.state, "ready");
      assert.deepEqual(
        Buffer.from(await f.p.storage.read(asset.object_key)),
        f.bytes,
      );
      assert.equal(response.status, offline ? 500 : 200);
      assert.deepEqual(
        await response.json(),
        offline
          ? { detail: "请求处理失败" }
          : { id: asset.public_id, ...asset.metadata.originalImport },
      );
      const media = url + "/media/" + asset.public_id;
      assert.equal((await fetch(media)).status, 401);
      const read = await fetch(media, { headers });
      assert.equal(read.status, 200);
      assert.deepEqual(Buffer.from(await read.arrayBuffer()), f.bytes);
    } finally {
      await app.close();
      await f.cleanup();
    }
  });
}

test(
  "an image whose commit is still in flight remains readable once published",
  {
    skip: !process.env.TEST_DATABASE_URL, // Two independent connections are required.
  },
  async () => {
    const f = await fixture();
    const app = await createOriginalApp(f.p);
    const transaction = f.db.transaction.bind(f.db);
    const allowCommit = deferred();
    let pending: Promise<unknown> | undefined;
    try {
      await app.listen(0, "127.0.0.1");
      const url = await app.getUrl();
      const headers = {
        Cookie: "fm_session=" + f.token,
        "X-Workspace-Id": "1",
      };
      f.db.transaction = (run) => {
        const clientDisconnected = deferred();
        const committing = transaction(async (sql) => {
          const result = await run(sql);
          if (await one(sql, "SELECT 1 FROM assets LIMIT 1")) {
            clientDisconnected.resolve();
            await allowCommit.promise;
          }
          return result;
        });
        pending = committing;
        return Promise.race([
          committing,
          clientDisconnected.promise.then(() => {
            throw new Error("synthetic disconnect while commit is pending");
          }),
        ]);
      };
      const response = await fetch(url + "/api/assets", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/octet-stream" },
        body: new Uint8Array(f.bytes),
        signal: AbortSignal.timeout(10000),
      });
      assert.equal(response.status, 500);
      assert.equal(await one(f.db, "SELECT 1 FROM assets"), undefined);
      allowCommit.resolve();
      await pending;
      const asset = await one(f.db, "SELECT public_id FROM assets");
      const read = await fetch(url + "/media/" + asset.public_id, { headers });
      assert.equal(read.status, 200);
      assert.deepEqual(Buffer.from(await read.arrayBuffer()), f.bytes);
    } finally {
      allowCommit.resolve();
      await pending;
      f.db.transaction = transaction;
      await app.close();
      await f.cleanup();
    }
  },
);

test("equal image uploads have independent public IDs, access and deletion", async () => {
  const f = await fixture();
  const app = await createOriginalApp(f.p);
  try {
    await app.listen(0, "127.0.0.1");
    const url = await app.getUrl();
    const headers = { Cookie: "fm_session=" + f.token, "X-Workspace-Id": "1" };
    async function upload() {
      const response = await fetch(url + "/api/assets", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/octet-stream" },
        body: new Uint8Array(f.bytes),
      });
      assert.equal(response.status, 200);
      const asset = await response.json();
      assert.match(asset.id, /^[0-9a-f]{32}$/);
      return String(asset.id);
    }
    const first = await upload();
    const second = await upload();
    assert.notEqual(first, second);
    const removed = await fetch(url + "/api/assets/" + first, {
      method: "DELETE",
      headers,
    });
    assert.equal(removed.status, 200);
    assert.deepEqual(await removed.json(), { ok: true });
    const gone = await fetch(url + "/media/" + first, { headers });
    assert.equal(gone.status, 404);
    assert.equal(gone.headers.get("location"), null);
    const anonymous = await fetch(url + "/media/" + second);
    assert.equal(anonymous.status, 401);
    const surviving = await fetch(url + "/media/" + second, { headers });
    assert.equal(surviving.status, 200);
    assert.deepEqual(Buffer.from(await surviving.arrayBuffer()), f.bytes);
  } finally {
    await app.close();
    await f.cleanup();
  }
});

test("a rolled-back deletion preserves the private bytes and authorized read", async () => {
  const f = await fixture();
  try {
    const asset = await f.asset();
    const transaction = f.db.transaction.bind(f.db);
    f.db.transaction = (run) =>
      transaction(async (sql) => {
        await run(sql);
        throw new Error("synthetic rollback before commit");
      });
    await assert.rejects(
      f.media.remove(f.admin, asset.public_id, "1"),
      /synthetic rollback/,
    );
    f.db.transaction = transaction;
    const visible = await f.media.resource(
      f.db,
      f.member,
      asset.public_id,
      f.team,
    );
    assert.deepEqual(
      Buffer.from(await f.p.storage.read(visible.object_key)),
      f.bytes,
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
for (const scenario of ["replacement", "shared", "offline"] as const) {
  test(`committed avatar survives acknowledgement loss: ${scenario}`, async () => {
    const f = await fixture();
    const app = await createOriginalApp(f.p);
    try {
      await app.listen(0, "127.0.0.1");
      const url = await app.getUrl();
      const headers = { Cookie: "fm_session=" + f.token };
      const upload = (bytes: Buffer) =>
        fetch(url + "/api/me/avatar", {
          method: "PUT",
          headers: { ...headers, "Content-Type": "application/octet-stream" },
          body: new Uint8Array(bytes),
        });
      const first = await upload(f.bytes);
      assert.equal(first.status, 200);
      const previous = await first.json();
      const old = await one(
        f.db,
        "SELECT object_key,sha256 FROM avatar_objects WHERE public_id=$1",
        [previous.avatar.slice(7)],
      );
      if (scenario === "shared")
        await f.db.query("UPDATE users SET avatar=$1 WHERE id=$2", [
          previous.avatar,
          f.member.id,
        ]);

      const offline = scenario === "offline";
      const replacement = await sharp(f.bytes).negate().png().toBuffer();
      const response = await loseUploadAcknowledgement(
        f.db,
        () => upload(replacement),
        offline,
        "avatar_objects",
      );
      const profile = f.identity.profile(await f.identity.actor(f.token));
      assert.notEqual(profile.avatar, previous.avatar);
      const image = await fetch(url + profile.avatar_url, { headers });
      assert.equal(image.status, 200);
      const saved = await one(
        f.db,
        "SELECT sha256 FROM avatar_objects WHERE public_id=$1",
        [profile.avatar.slice(7)],
      );
      assert.notEqual(saved.sha256, old.sha256);
      assert.equal(
        createHash("sha256")
          .update(await image.bytes())
          .digest("hex"),
        saved.sha256,
      );
      assert.equal(response.status, offline ? 500 : 200);
      assert.deepEqual(
        await response.json(),
        offline ? { detail: "请求处理失败" } : profile,
      );
      assert.equal((await fetch(url + profile.avatar_url)).status, 401);
      const oldImage = await fetch(url + previous.avatar_url, { headers });
      assert.equal(oldImage.status, scenario === "shared" ? 200 : 404);
      if (scenario === "shared")
        assert.equal(
          createHash("sha256")
            .update(await oldImage.bytes())
            .digest("hex"),
          old.sha256,
        );
      if (scenario === "replacement") {
        assert.equal(
          await one(f.db, "SELECT 1 FROM avatar_objects WHERE object_key=$1", [
            old.object_key,
          ]),
          undefined,
        );
        await assert.rejects(f.p.storage.stat(old.object_key));
      }
    } finally {
      await app.close();
      await f.cleanup();
    }
  });
}

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
    // A deferred check fails at COMMIT, after both the object and metadata were written.
    await f.db.query(`
      CREATE FUNCTION reject_image() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic commit rejection'; END $$;
      CREATE CONSTRAINT TRIGGER reject_image AFTER INSERT ON assets
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_image()`);
    assert.equal((await send("/api/assets", "POST")).status, 500);
    assert.deepEqual(await readdir(f.directory), []);
    assert.equal(await one(f.db, "SELECT 1 FROM assets"), undefined);
    await f.db.query("DROP TRIGGER reject_image ON assets");
    const previousAvatar = (await f.identity.actor(f.token)).avatar;
    await f.db
      .query(`CREATE CONSTRAINT TRIGGER reject_avatar AFTER INSERT ON avatar_objects
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_image()`);
    assert.equal((await send("/api/me/avatar", "PUT")).status, 500);
    assert.equal((await f.identity.actor(f.token)).avatar, previousAvatar);
    assert.equal(await one(f.db, "SELECT 1 FROM avatar_objects"), undefined);
    assert.deepEqual(await readdir(f.directory), []);
    await f.db.query("DROP TRIGGER reject_avatar ON avatar_objects");
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
