import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { databaseFixture } from "../helpers/database.js";
import { createOriginalApp } from "../../apps/api/src/original.js";
import { one, migrate, type Sql } from "@fumiao/platform/db.js";
import {
  packPurposes,
  ReferencePacks,
} from "@fumiao/platform/packs.js";
import { legacyId } from "@fumiao/platform/importer.js";
import { OriginalIdentity } from "@fumiao/original-api/identity.js";
import { OriginalPacks } from "@fumiao/original-api/packs.js";
import { PluginRegistry } from "@fumiao/platform/plugins.js";
import type { ProviderPlugin } from "@fumiao/plugin-sdk/index.js";

const provider: ProviderPlugin = {
  manifest: {
    id: "pack-test",
    version: "1.0.0",
    contractVersion: 1,
    label: "Pack fixture",
    mode: "request",
    configSchema: { type: "object" },
    models: [
      {
        id: "image",
        label: "Image",
        kind: "image",
        inputSchema: {
          type: "object",
          "x-references": { max: 9, types: ["image"] },
        },
      },
    ],
  },
  health: async () => true,
  submit: async () => {
    throw new Error("Provider must not be called");
  },
};
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
  await identity.bootstrap({
    name: "admin",
    nickname: "管理员",
    password: "pack-test-password",
  });
  const admin = await identity.actor(
    await identity.login(
      { name: "admin", password: "pack-test-password" },
      "test",
    ),
  );
  const member = await f.db.transaction((sql) =>
    f.p.createUser(sql, "member", "成员", "pack-test-password", "member"),
  );
  const team = await one(
    f.db,
    "SELECT id,public_id FROM workspaces WHERE kind='team'",
  );
  await f.db.query("INSERT INTO members(workspace_id,user_id) VALUES($1,$2)", [
    team.id,
    member.id,
  ]);
  const png = await sharp({
    create: { width: 11, height: 17, channels: 3, background: "#348964" },
  })
    .png()
    .toBuffer();
  const assets = [];
  for (let i = 0; i < 2; i++) {
    const a = await f.p.upload(admin, team.id, png, "image/png");
    assets.push(await one(f.db, "SELECT * FROM assets WHERE id=$1", [a.id]));
  }
  const packs = new OriginalPacks(f.p),
    draft = {
      name: " 主角 A ",
      purpose: "subject",
      description: " 蓝色衣服 ",
      media: assets.map((a) => a.public_id),
    };
  return {
    ...f,
    identity,
    admin,
    member,
    team,
    assets,
    packs,
    draft,
    selected: String(team.public_id),
  };
}
test("reference packs preserve shared edits, revisions, ordered media and canvas deletion guards", async () => {
  const f = await fixture();
  try {
    const pack = await f.packs.save(f.admin, f.draft, f.selected);
    assert.equal(pack.name, "主角 A");
    assert.equal(pack.description, "蓝色衣服");
    assert.deepEqual(pack.media, f.draft.media);
    await assert.rejects(
      f.packs.save(
        f.member,
        { ...f.draft, expected_revision: 1 },
        String(f.member.workspaceId),
        pack.id,
      ),
      { status: 400 },
    );
    const privateSpace = await one(
      f.db,
      "SELECT public_id FROM workspaces WHERE id=$1",
      [f.member.workspaceId],
    );
    await assert.rejects(
      f.packs.save(
        f.member,
        { ...f.draft, expected_revision: 1 },
        String(privateSpace.public_id),
        pack.id,
      ),
      { status: 404 },
    );
    const edited = await f.packs.save(
      f.member,
      {
        ...f.draft,
        description: "红色衣服",
        media: [...f.draft.media].reverse(),
        expected_revision: 1,
      },
      f.selected,
      pack.id,
    );
    assert.equal(edited.revision, 2);
    assert.equal(edited.owner, Number(f.admin.public_id));
    assert.deepEqual(edited.media, [...f.draft.media].reverse());
    await assert.rejects(
      f.packs.save(
        f.admin,
        { ...f.draft, expected_revision: 1 },
        f.selected,
        pack.id,
      ),
      { status: 409, message: "素材包已被修改，请重新打开后编辑" },
    );
    await assert.rejects(f.packs.remove(f.member, pack.id, f.selected), {
      status: 403,
    });
    await assert.rejects(f.p.deleteAsset(f.admin, f.assets[0].id), {
      status: 409,
    });
    const canvas = randomUUID();
    await f.p.saveDocument(f.admin, f.team.id, {
      id: canvas,
      kind: "canvas",
      title: "画布",
      revision: 0,
      body: {
        nodes: [{ id: "shot", asset_packs: [{ id: pack.id, revision: 1 }] }],
      },
      assets: [],
    });
    await assert.rejects(f.packs.remove(f.admin, pack.id, f.selected), {
      status: 409,
      message: "素材包正在画布中使用，请先在相关节点移除引用",
    });
    const internal = await one(
      f.db,
      "SELECT id FROM documents WHERE public_id=$1",
      [pack.id],
    );
    await assert.rejects(f.p.deleteDocument(f.admin, internal.id), {
      status: 409,
    });
    await assert.rejects(
      f.db.query("UPDATE documents SET deleted=true WHERE id=$1", [
        internal.id,
      ]),
      { code: "P1003" },
    );
    await f.p.deleteDocument(f.admin, canvas);
    assert.deepEqual(await f.packs.remove(f.admin, pack.id, f.selected), {
      ok: true,
    });
    assert.deepEqual((await f.packs.list(f.admin, f.selected)).packs, []);
    await f.p.deleteAsset(f.admin, f.assets[0].id);
  } finally {
    await f.cleanup();
  }
});

test("Studio lists packs in order with a fixed database read count", async (t) => {
  const f = await fixture();
  t.after(() => f.cleanup());
  const app = await createOriginalApp(f.p);
  t.after(() => app.close());
  await app.listen(0, "127.0.0.1");
  const token = await f.identity.login(
    { name: "member", password: "pack-test-password" },
    "list-fixture",
  );
  const endpoint = (await app.getUrl()) + "/api/asset-packs";
  let reads = 0;
  const countReads = (sql: Sql): Sql => ({
    query(statement, params) {
      if (/^SELECT\b/i.test(statement)) reads++;
      return sql.query(statement, params);
    },
  });
  const transaction = f.db.transaction.bind(f.db);
  t.mock.method(
    f.db,
    "query",
    countReads({ query: f.db.query.bind(f.db) }).query,
  );
  t.mock.method(f.db, "transaction", (fn: (sql: Sql) => Promise<unknown>) =>
    transaction((sql) => fn(countReads(sql))),
  );
  const list = async (selected = f.selected) => {
    reads = 0;
    const response = await fetch(endpoint, {
      headers: { Cookie: "fm_session=" + token, "X-Workspace-Id": selected },
    });
    return { status: response.status, body: await response.json(), reads };
  };

  assert.deepEqual(await list(), {
    status: 200,
    body: { packs: [], purposes: packPurposes },
    reads: 3,
  });
  const first = await f.packs.save(f.admin, f.draft, f.selected);
  const onePack = await list();
  assert.equal(onePack.status, 200);
  assert.deepEqual(onePack.body, { packs: [first], purposes: packPurposes });
  const second = await f.packs.save(
    f.member,
    { ...f.draft, name: "反向\0引用", media: [...f.draft.media].reverse() },
    f.selected,
  );
  const personal = await one(
    f.db,
    "SELECT id,public_id FROM workspaces WHERE kind='personal' AND owner_id=$1",
    [f.admin.id],
  );
  const emptyKey = "e".repeat(32);
  const updated = 1_700_000_000;
  await f.db.query(
    `INSERT INTO documents(id,workspace_id,owner_id,kind,title,body,updated_at,public_id,deleted)
     VALUES (gen_random_uuid(),$1,$2,'pack','Empty','{}',to_timestamp($5 - 1),$4,false),
            (gen_random_uuid(),$1,$2,'pack','Deleted','{}',to_timestamp($5),'11111111111111111111111111111111',true),
            (gen_random_uuid(),$3,$2,'pack','Private','{}',to_timestamp($5),'22222222222222222222222222222222',false)`,
    [f.team.id, f.admin.id, personal.id, emptyKey, updated],
  );
  await f.db.query(
    "UPDATE documents SET updated_at=to_timestamp($1) WHERE public_id=ANY($2::text[])",
    [updated, [first.id, second.id]],
  );
  const multiple = await list();
  assert.equal(multiple.status, 200);
  assert.deepEqual(multiple.body, {
    packs: [
      ...[first, second]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((pack) => ({ ...pack, updated })),
      {
        id: emptyKey,
        workspace: Number(f.team.public_id),
        owner: Number(f.admin.public_id),
        name: "Empty",
        purpose: "subject",
        description: "",
        revision: 1,
        updated: updated - 1,
        media: [],
      },
    ],
    purposes: packPurposes,
  });
  assert.equal((await list(String(personal.public_id))).status, 403);

  await f.db.query("UPDATE documents SET body=$2 WHERE public_id=$1", [
    emptyKey,
    JSON.stringify({ assets: [randomUUID()] }),
  ]);
  const invalid = await list();
  assert.equal(invalid.status, 409);
  assert.deepEqual(invalid.body, { detail: "素材包引用已失效" });

  await f.db.query("DELETE FROM members WHERE workspace_id=$1 AND user_id=$2", [
    f.team.id,
    f.member.id,
  ]);
  assert.equal((await list()).status, 403);
  await assert.rejects(f.packs.packs.list(f.member, f.team.id), {
    status: 404,
  });
  assert.equal(onePack.reads, 4);
  assert.equal(multiple.reads, onePack.reads);
});

test("task pack expansion freezes ordered references and descriptions before later edits and idempotent retries", async () => {
  const f = await fixture();
  try {
    f.p.registry = new PluginRegistry([provider]);
    await f.p.registry.installBuiltins(f.db);
    const c = await f.p.createConnection(f.admin, {
      name: "test",
      pluginId: provider.manifest.id,
      version: "1.0.0",
      config: {},
    });
    await f.p.updateConnection(f.admin, c.id, {
      revision: 1,
      enabled: true,
      concurrency: 1,
    });
    const m = await one(f.db, "SELECT id FROM models WHERE connection_id=$1", [
      c.id,
    ]);
    await f.p.setModel(f.admin, m.id, { enabled: true, price: 7 });
    await f.db.query("UPDATE wallets SET balance=100 WHERE workspace_id=$1", [
      f.team.id,
    ]);
    const id = randomUUID();
    const name = "\ufeff主角\0A😀";
    const description =
      "蓝色\0衣服 /media/" + f.assets[0].public_id + " \\u0000";
    const draft = {
      id,
      kind: "pack",
      title: "\u001c" + name + "\u0085",
      revision: 0,
      body: { purpose: "subject", description: " " + description + " " },
      assets: f.assets.map((a) => a.id),
    };
    await f.p.saveDocument(f.admin, f.team.id, draft);
    await assert.rejects(
      f.p.saveDocument(f.admin, f.team.id, {
        ...draft,
        title: "\ud800",
        revision: 1,
      }),
      { status: 400 },
    );
    const [document] = await f.p.documents(f.admin, f.team.id, "pack");
    assert.equal(document.title, name);
    assert.equal(document.body.description, description);
    assert.equal(document.revision, 1);
    assert.ok(!Object.hasOwn(document, "pack_text"));
    const [pack] = (await f.packs.list(f.admin, f.selected)).packs;
    assert.equal(pack.name, name);
    assert.equal(pack.description, description);
    const request = {
      key: randomUUID(),
      modelId: m.id,
      prompt: "缓慢向前走",
      references: [f.assets[0].id],
      referencePacks: [{ id, revision: 1 }],
    };
    const job = await f.p.submit(f.admin, f.team.id, request),
      row = await one(f.db, "SELECT * FROM jobs WHERE id=$1", [job.id]);
    assert.deepEqual(
      row.input.references,
      f.assets.map((a) => a.id),
    );
    assert.equal(
      row.input.prompt,
      `缓慢向前走\n\n${name}（人物外观，<Picture 1>, <Picture 2>）：${description}`,
    );
    assert.deepEqual(row.reference_packs, [
      {
        id: pack.id,
        revision: 1,
        name,
        purpose: "subject",
        description,
        media: f.draft.media,
      },
    ]);
    await f.packs.save(
      f.member,
      { ...f.draft, description: "红色衣服", expected_revision: 1 },
      f.selected,
      pack.id,
    );
    assert.deepEqual(await f.p.submit(f.admin, f.team.id, request), job);
    await assert.rejects(
      f.p.submit(f.admin, f.team.id, { ...request, key: randomUUID() }),
      { status: 409, message: "素材包“主角 A”已更新，请重新选择后生成" },
    );
    assert.deepEqual(
      await one(f.db, "SELECT * FROM jobs WHERE id=$1", [job.id]),
      row,
    );
    assert.equal(Number((await f.p.wallet(f.admin, f.team.id)).held), 7);
    await f.packs.remove(f.admin, pack.id, f.selected);
    assert.deepEqual(await f.p.submit(f.admin, f.team.id, request), job);
    await assert.rejects(f.p.deleteAsset(f.admin, f.assets[0].id), {
      status: 409,
    });
  } finally {
    await f.cleanup();
  }
});

test(
  "concurrent pack edits and the 200-pack admission limit have one winner",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const f = await fixture();
    try {
      const pack = await f.packs.save(f.admin, f.draft, f.selected);
      const edits = await Promise.allSettled(
        ["first", "second"].map((description) =>
          f.packs.save(
            f.admin,
            { ...f.draft, description, expected_revision: 1 },
            f.selected,
            pack.id,
          ),
        ),
      );
      assert.equal(edits.filter((r) => r.status === "fulfilled").length, 1);
      await f.db.query(
        `INSERT INTO documents(id,workspace_id,owner_id,kind,title,body) SELECT gen_random_uuid(),$1,$2,'pack','seed',$3 FROM generate_series(1,198)`,
        [
          f.team.id,
          f.admin.id,
          JSON.stringify({
            purpose: "subject",
            description: "",
            assets: [f.assets[0].id],
          }),
        ],
      );
      const creates = await Promise.allSettled(
        ["first", "second"].map((name) =>
          f.packs.save(f.admin, { ...f.draft, name }, f.selected),
        ),
      );
      assert.equal(creates.filter((r) => r.status === "fulfilled").length, 1);
      const failure = creates.find(
        (r) => r.status === "rejected",
      ) as PromiseRejectedResult;
      assert.equal(failure.reason.message, "素材包已达 200 个，请先整理");
      assert.equal(
        Number(
          (
            await one(
              f.db,
              "SELECT count(*) AS n FROM documents WHERE kind='pack' AND NOT deleted",
            )
          ).n,
        ),
        200,
      );
    } finally {
      await f.cleanup();
    }
  },
);

test(
  "canvas references and pack deletion serialize in both commit orders",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const f = await fixture();
    const release = deferred();
    try {
      const pack = await f.packs.save(f.admin, f.draft, f.selected),
        canvas = randomUUID();
      await f.p.saveDocument(f.admin, f.team.id, {
        id: canvas,
        kind: "canvas",
        title: "before",
        revision: 0,
        body: {},
        assets: [],
      });
      const refs = new ReferencePacks(f.db),
        locked = deferred(),
        deleting = deferred();
      const saving = f.db.transaction(async (sql) => {
        await refs.syncCanvas(sql, f.admin, f.team.id, canvas, {
          nodes: [{ asset_packs: [{ id: pack.id }] }],
        });
        locked.resolve();
        await release.promise;
      });
      await locked.promise;
      const removal = assert.rejects(
        f.db.transaction((sql) =>
          refs.remove(
            {
              query: (q, p) => {
                if (q.includes("FOR UPDATE")) deleting.resolve();
                return sql.query(q, p);
              },
            },
            f.admin,
            pack.id,
            f.team.id,
          ),
        ),
        { status: 409 },
      );
      await deleting.promise;
      release.resolve();
      await Promise.all([saving, removal]);
      await f.p.deleteDocument(f.admin, canvas);

      const otherCanvas = randomUUID(),
        deleted = deferred(),
        commitDelete = deferred(),
        reading = deferred();
      await f.p.saveDocument(f.admin, f.team.id, {
        id: otherCanvas,
        kind: "canvas",
        title: "before",
        revision: 0,
        body: {},
        assets: [],
      });
      const remove = f.db.transaction(async (sql) => {
        await refs.remove(sql, f.admin, pack.id, f.team.id);
        deleted.resolve();
        await commitDelete.promise;
      });
      await deleted.promise;
      const save = assert.rejects(
        f.db.transaction(async (sql) => {
          await sql.query("UPDATE documents SET title='after' WHERE id=$1", [
            otherCanvas,
          ]);
          await refs.syncCanvas(
            {
              query: (q, p) => {
                if (q.includes("FOR SHARE")) reading.resolve();
                return sql.query(q, p);
              },
            },
            f.admin,
            f.team.id,
            otherCanvas,
            { nodes: [{ asset_packs: [{ id: pack.id }] }] },
          );
        }),
        { status: 404 },
      );
      await reading.promise;
      commitDelete.resolve();
      await Promise.all([remove, save]);
      assert.equal(
        (
          await one(f.db, "SELECT title FROM documents WHERE id=$1", [
            otherCanvas,
          ])
        ).title,
        "before",
      );
      assert.equal(
        (
          await one(f.db, "SELECT count(*) AS n FROM document_pack_refs")
        ).n.toString(),
        "0",
      );
    } finally {
      release.resolve();
      await f.cleanup();
    }
  },
);

test("migration restores imported pack identity and revision without overwriting edited or unrelated documents", async () => {
  const f = await databaseFixture("011_storage_capacity.sql");
  try {
    const user = randomUUID(),
      workspace = randomUUID(),
      source = "old-import",
      stamp = 1600000000;
    await f.db.query(
      "INSERT INTO users(id,name,nickname,password,role) VALUES($1,'imported','Imported','unused','admin')",
      [user],
    );
    await f.db.query(
      "INSERT INTO workspaces(id,name,owner_id,kind) VALUES($1,'imported',$2,'personal')",
      [workspace, user],
    );
    const media = "a".repeat(32),
      asset = legacyId(source, "asset", media);
    await f.db.query(
      "INSERT INTO assets(id,workspace_id,owner_id,object_key,mime,size,state) VALUES($1,$2,$3,'fixture','image/png',0,'ready')",
      [asset, workspace, user],
    );
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const key = String(i + 1).repeat(32),
        id = legacyId(source, "pack", key);
      ids.push(id);
      await f.db.query(
        "INSERT INTO documents(id,workspace_id,owner_id,kind,title,body,revision,updated_at) VALUES($1,$2,$3,'pack','Original',$4,$5,to_timestamp($6))",
        [
          id,
          workspace,
          user,
          JSON.stringify({
            purpose: "subject",
            description: "source",
            assets: i === 1 ? [] : [asset],
          }),
          i === 2 ? 3 : 1,
          stamp,
        ],
      );
      const payload = {
        id: key,
        name: "Original",
        purpose: "subject",
        description: "source",
        ...(i === 3 ? {} : { revision: 7, updated: stamp + 100 }),
      };
      await f.db.query(
        "INSERT INTO legacy_records(source,collection,legacy_id,payload) VALUES($1,'asset_packs',$2,$3)",
        [source, key, JSON.stringify(payload)],
      );
      await f.db.query(
        "INSERT INTO legacy_records(source,collection,legacy_id,payload) VALUES($1,'asset_pack_media',$2,$3)",
        [source, String(i), JSON.stringify({ pack: key, media, position: 0 })],
      );
    }
    const canvas = legacyId(source, "canvas", "5".repeat(32));
    await f.db.query(
      "INSERT INTO documents(id,workspace_id,owner_id,kind,title,body) VALUES($1,$2,$3,'canvas','Canvas',$4)",
      [
        canvas,
        workspace,
        user,
        JSON.stringify({
          nodes: [{ asset_packs: [{ id: "1".repeat(32), revision: 7 }] }],
        }),
      ],
    );
    await migrate(f.db);
    for (let i = 0; i < 4; i++) {
      const row = await one(
        f.db,
        "SELECT *,extract(epoch from updated_at)::integer AS stamp FROM documents WHERE id=$1",
        [ids[i]],
      );
      assert.equal(row.public_id, String(i + 1).repeat(32));
      assert.equal(row.revision, [7, 1, 3, 1][i]);
      assert.equal(row.stamp, i === 0 ? stamp + 100 : stamp);
      assert.equal(row.title, "Original");
      assert.equal(row.body.description, "source");
      assert.equal(row.pack_text, null);
      assert.deepEqual(row.body.assets, i === 1 ? [] : [asset]);
    }
    assert.deepEqual(
      (await f.db.query("SELECT document_id,pack_id FROM document_pack_refs"))
        .rows,
      [{ document_id: canvas, pack_id: ids[0] }],
    );
    await assert.rejects(
      f.db.query("UPDATE documents SET deleted=true WHERE id=$1", [ids[0]]),
      { code: "P1003" },
    );
    // Re-running normal migration leaves both source and user edits untouched.
    await migrate(f.db);
  } finally {
    await f.cleanup();
  }
});
