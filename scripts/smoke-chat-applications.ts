import { chatImportTables } from "../tests/helpers/chat-import.js";
import type { Actor } from "../packages/platform/src/platform.js";
import { StudioCatalog } from "../packages/platform/src/catalog.js";
import { museCanvas } from "../plugins/muse/src/canvas.js";
import { flowCanvas } from "../plugins/flow/src/canvas.js";
import { gpuCanvas } from "../plugins/gpu/src/canvas.js";
import { imagesCanvas } from "../plugins/images/src/canvas.js";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { databaseFixture } from "../tests/helpers/database.js";
import {
  importLegacy,
  type LegacyExport,
} from "../packages/platform/src/importer.js";
import { OriginalChatApplications } from "../packages/original-api/src/chat-applications.js";
import {
  OriginalCanvases,
  canvasConflict,
} from "../packages/original-api/src/canvases.js";
import { OriginalChats } from "../packages/original-api/src/chats.js";
import { DomainError } from "../packages/platform/src/security.js";
import { one } from "../packages/platform/src/db.js";
const python =
  process.env.STUDIO_PYTHON ||
  resolve(".runtime-advanced/original/.venv/bin/python");
const f = await databaseFixture();
try {
  execFileSync(python, ["scripts/chat-applications-fixtures.py", f.directory], {
    stdio: "pipe",
    timeout: 180000,
  });
  const data: LegacyExport = JSON.parse(
    await readFile(join(f.directory, "export.json"), "utf8"),
  );
  const messages = data.tables.chat_messages;
  data.tables.chat_messages = [];
  await importLegacy(f.p, data, join(f.directory, "runtime/media"));
  for (const m of messages)
    await f.db.query(
      `INSERT INTO chat_messages(public_id,conversation_id,role,author_id,content,state,model,created,context,superseded) SELECT $1,c.id,$3,NULL,$4,$5,'',$6,'{}',$7 FROM chat_conversations c WHERE c.public_id=$2`,
      [
        m.id,
        m.conversation,
        m.role,
        Buffer.from(m.content),
        m.state,
        m.created,
        !!m.superseded,
      ],
    );
  await f.db.query(
    "SELECT setval(pg_get_serial_sequence('chat_messages','public_id'),max(public_id)) FROM chat_messages",
  );
  await f.p.registry.installBuiltins(f.db);
  await f.db.transaction(async (sql) => {
    for (const plugin of [museCanvas, flowCanvas, gpuCanvas, imagesCanvas])
      await new StudioCatalog(f.db).activate(sql, plugin.manifest);
  });
  const cases = JSON.parse(
    await readFile(join(f.directory, "cases.json"), "utf8"),
  );
  const actors = (await f.db.query("SELECT * FROM users ORDER BY public_id"))
    .rows as Actor[];
  const service = new OriginalChatApplications(f.p, () => 1800000000),
    canvases = new OriginalCanvases(f.p, () => 1800000000),
    chats = new OriginalChats(f.p, () => 1800000000);
  const aliases = new Map<string, string>();
  function normalize(v: any): any {
    if (typeof v === "string") return aliases.get(v) ?? v;
    if (Array.isArray(v)) return v.map(normalize);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, normalize(x)]),
      );
    return v;
  }
  for (const c of cases) {
    if (c.action === "state") {
      await f.db.query("UPDATE chat_messages SET state=$1 WHERE public_id=4", [
        c.state,
      ]);
      continue;
    }
    if (c.action === "save") {
      assert.deepEqual(
        await canvases.save(actors[0], c.project, c.body),
        c.result,
      );
      continue;
    }
    if (c.name === "deleted conversation")
      await chats.remove(actors[0], c.chat);
    let actual: any,
      status = 200;
    try {
      actual = await service.apply(
        actors[c.user],
        c.chat,
        c.body,
        c.workspace ? String(c.workspace) : undefined,
      );
    } catch (e: any) {
      if (e instanceof DomainError) {
        status = e.status;
        actual = { detail: "detail" in e ? e.detail : e.message };
      } else if (e instanceof Error && e.message === "Internal Server Error") {
        status = 500;
        actual = e.message;
      } else {
        throw e;
      }
    }
    assert.equal(
      status,
      c.status,
      c.name + JSON.stringify(actual).slice(0, 200),
    );
    if (
      status === 200 &&
      c.body.mode !== "replace" &&
      !aliases.has(c.result.applied_node)
    ) {
      assert.match(actual.applied_node, /^[a-f0-9]{32}$/, c.name);
      assert.ok(!aliases.has(actual.applied_node), c.name);
      const alias = "$node" + aliases.size;
      aliases.set(c.result.applied_node, alias);
      aliases.set(actual.applied_node, alias);
    }
    assert.deepEqual(normalize(actual), normalize(c.result), c.name);
  }
  const final = JSON.parse(
    await readFile(join(f.directory, "final.json"), "utf8"),
  );
  const tables = await chatImportTables(f.db);
  for (const name of ["chat_applications", "canvas_chat_links"] as const) {
    const sorted = (rows: any[]) =>
      rows
        .map((r) => JSON.stringify(normalize(r), Object.keys(r).sort()))
        .sort();
    assert.deepEqual(
      sorted(tables[name]),
      sorted(final.tables[name]),
      name + " persisted oracle equality",
    );
  }
  const cid = cases[0].chat,
    key = cases[0].body.project;
  await f.db.query(
    "UPDATE chat_conversations SET deleted_at=NULL WHERE public_id=$1",
    [cid],
  );
  const body = () => ({
    uid: randomUUID(),
    message: 1,
    project: key,
    expected_revision: 0,
  });
  const snap = async () => ({
    canvas: await canvases.get(actors[0], key),
    raw: await one(
      f.db,
      `SELECT c.document,c.updated,c.last_editor,d.revision,d.updated_at
        FROM canvas_documents c JOIN documents d ON d.id=c.project_id WHERE d.public_id=$1`,
      [key],
    ),
    audit: (await f.db.query("SELECT * FROM chat_applications ORDER BY uid"))
      .rows,
    links: (await f.db.query("SELECT * FROM canvas_chat_links ORDER BY node"))
      .rows,
    refs: (await f.db.query("SELECT * FROM canvas_media_refs ORDER BY node"))
      .rows,
    assets: (
      await f.db.query(
        "SELECT * FROM document_assets ORDER BY document_id,asset_id",
      )
    ).rows,
    packs: (
      await f.db.query(
        "SELECT * FROM document_pack_refs ORDER BY document_id,pack_id",
      )
    ).rows,
    nodes: (
      await f.db.query(
        "SELECT n.* FROM canvas_nodes n JOIN documents d ON d.id=n.project_id WHERE d.public_id=$1 ORDER BY node",
        [key],
      )
    ).rows,
  });
  // Force reference reconciliation to remove an obsolete relation; a late failure must restore it.
  await f.db.query(
    `INSERT INTO canvas_media_refs(project_id,node,asset_id) SELECT d.id,'obsolete',a.id FROM documents d CROSS JOIN assets a WHERE d.public_id=$1 LIMIT 1`,
    [key],
  );
  await f.db.query(
    "INSERT INTO document_assets(document_id,asset_id) SELECT project_id,asset_id FROM canvas_media_refs",
  );
  await f.db.query(
    `INSERT INTO documents(id,workspace_id,owner_id,kind,title,body)
      SELECT gen_random_uuid(),workspace_id,owner_id,'pack','Obsolete pack','{}'
      FROM documents WHERE public_id=$1`,
    [key],
  );
  await f.db.query(
    `INSERT INTO document_pack_refs(document_id,pack_id)
      SELECT d.id,p.id FROM documents d JOIN documents p USING(workspace_id)
      WHERE d.public_id=$1 AND p.kind='pack'`,
    [key],
  );
  const before = await snap();
  assert.equal(before.refs.length, 1);
  assert.equal(before.assets.length, 1);
  assert.equal(before.packs.length, 1);
  assert.deepEqual(
    before.nodes.map((n) => n.node).sort(),
    before.canvas.document.nodes.map((n: any) => n.id).sort(),
  );
  await f.db.query(
    "CREATE FUNCTION reject_adoption() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'late adoption failure'; END $$",
  );
  await f.db.query(
    "CREATE TRIGGER reject_adoption BEFORE INSERT ON chat_applications FOR EACH ROW EXECUTE FUNCTION reject_adoption()",
  );
  const concurrent = { ...body(), expected_revision: before.canvas.revision };
  const later = new OriginalChatApplications(f.p, () => 1800000001.5);
  await assert.rejects(
    later.apply(actors[0], cid, concurrent),
    /late adoption failure/,
  );
  assert.deepEqual(await snap(), before);
  await f.db.query("DROP TRIGGER reject_adoption ON chat_applications");
  const same = await Promise.all([
    service.apply(actors[0], cid, concurrent),
    service.apply(actors[0], cid, concurrent),
  ]);
  assert.deepEqual(same[0], same[1]);
  const applied = await snap();
  assert.equal(applied.canvas.revision, before.canvas.revision + 1);
  assert.equal(applied.nodes.length, before.nodes.length + 1);
  assert.equal(applied.audit.length, before.audit.length + 1);
  assert.equal(applied.links.length, before.links.length + 1);
  assert.deepEqual([applied.refs, applied.assets, applied.packs], [[], [], []]);

  // Use another conversation so only the canvas lock can serialize these edits.
  const otherChat = await one(
    f.db,
    `INSERT INTO chat_conversations(workspace_id,owner_id,model,created,updated)
      SELECT workspace_id,owner_id,model,created,updated FROM chat_conversations
      WHERE public_id=$1 RETURNING id,public_id`,
    [cid],
  );
  const otherMessage = await one(
    f.db,
    `INSERT INTO chat_messages(conversation_id,role,state,content,created)
      SELECT $1,role,state,content,created FROM chat_messages WHERE public_id=1
      RETURNING public_id`,
    [otherChat.id],
  );
  const otherBody = { ...body(), message: Number(otherMessage.public_id) };
  const rev = same[0].revision;
  const different = await Promise.allSettled([
    service.apply(actors[0], cid, { ...body(), expected_revision: rev }),
    service.apply(actors[0], otherChat.public_id, {
      ...otherBody,
      expected_revision: rev,
    }),
  ]);
  assert.equal(different.filter((r) => r.status === "fulfilled").length, 1);
  const stale = different.find((r) => r.status === "rejected");
  assert.equal(stale?.reason.status, 409);
  assert.equal(stale.reason.message, canvasConflict);
  const second = await canvases.create(actors[0], { title: "other" });
  const freshUid = randomUUID();
  const currentRevision = (await canvases.get(actors[0], key)).revision;
  const fresh = await Promise.allSettled([
    service.apply(actors[0], otherChat.public_id, {
      ...otherBody,
      uid: freshUid,
      project: second.id,
      expected_revision: 1,
    }),
    service.apply(actors[0], cid, {
      ...body(),
      uid: freshUid,
      expected_revision: currentRevision,
    }),
  ]);
  assert.equal(fresh.filter((r) => r.status === "fulfilled").length, 1);
  const conflict = fresh.find((r) => r.status === "rejected");
  assert.equal(conflict?.reason.status, 409);
  assert.equal(conflict.reason.message, "该采用标识已使用");
  const collision = await Promise.allSettled([
    service.apply(actors[0], cid, {
      ...body(),
      uid: concurrent.uid,
      project: second.id,
      expected_revision: 1,
    }),
    service.apply(actors[0], cid, concurrent),
  ]);
  assert.equal(collision[0].status, "rejected");
  assert.equal(collision[1].status, "fulfilled");
  if (process.env.TEST_DATABASE_URL) {
    // Hold an uncommitted soft deletion. Adoption must wait for the same row
    // and then see the deletion, as it does behind SQLite's write transaction.
    const beforeDelete = await snap();
    const { request, blocked } = await f.db.transaction(async (sql) => {
      await sql.query(
        "UPDATE chat_conversations SET deleted_at=1,revision=revision+1 WHERE id=$1",
        [otherChat.id],
      );
      const holder = await one(sql, "SELECT pg_backend_pid() AS pid");
      const request = Promise.allSettled([
        service.apply(actors[0], otherChat.public_id, {
          ...otherBody,
          uid: randomUUID(),
          expected_revision: beforeDelete.canvas.revision,
        }),
      ]);
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const waiter = await one(
          f.db,
          `SELECT 1 FROM pg_stat_activity
            WHERE $1::int = ANY(pg_blocking_pids(pid)) LIMIT 1`,
          [holder.pid],
        );
        if (waiter) return { request, blocked: true };
        if (await Promise.race([request.then(() => true), delay(10, false)]))
          break;
      }
      return { request, blocked: false };
    });
    const [result] = await request;
    assert.equal(result.status, "rejected", "adoption raced past deletion");
    assert.equal(result.reason.status, 404);
    assert.equal(result.reason.message, "对话已删除");
    assert.ok(
      blocked,
      "PostgreSQL did not observe the adoption waiting on deletion",
    );
    assert.deepEqual(await snap(), beforeDelete);
  }
  await canvases.remove(actors[0], key);
  const history = await one(
    f.db,
    "SELECT * FROM chat_applications WHERE uid=$1",
    [concurrent.uid],
  );
  assert.equal(history.project_id, null);
  assert.equal(history.project_public_id, key);
  await assert.rejects(
    service.apply(actors[0], cid, concurrent),
    /画布不存在或已删除/,
  );
  const restored = await canvases.create(actors[0], {
    title: "restored public identity",
  });
  await f.db.query("UPDATE documents SET public_id=$2 WHERE public_id=$1", [
    restored.id,
    key,
  ]);
  const replay = await service.apply(actors[0], cid, concurrent);
  assert.equal(replay.applied_node, same[0].applied_node);
  assert.deepEqual(replay.document.nodes, []);
  assert.equal(
    (
      await one(f.db, "SELECT project_id FROM chat_applications WHERE uid=$1", [
        concurrent.uid,
      ])
    ).project_id,
    null,
  );
  if (process.env.TEST_DATABASE_URL)
    console.log(
      "PostgreSQL concurrent UID/revision and soft-delete checks passed",
    );
  console.log(
    `chat applications: ${cases.length} oracle operations (${cases.filter((c: any) => !c.action).length} exact FastAPI apply responses), late rollback, UID/revision checks and deletion history passed`,
  );
} finally {
  await f.cleanup();
}

// A separate valid historical export includes settled turns and orphaned audits.
const h = await databaseFixture();
try {
  execFileSync(python, ["scripts/chat-import-fixtures.py", h.directory], {
    stdio: "pipe",
    timeout: 180000,
  });
  const data: LegacyExport = JSON.parse(
    await readFile(join(h.directory, "export.json"), "utf8"),
  );
  await importLegacy(h.p, data, join(h.directory, "runtime/media"));
  await h.db.query("UPDATE chat_conversations SET deleted_at=NULL");
  const svc = new OriginalChatApplications(h.p);
  for (const a of data.tables.chat_applications) {
    const actor = (await one(h.db, "SELECT * FROM users WHERE public_id=$1", [
      a.owner,
    ])) as Actor;
    const b = {
      uid: a.uid,
      message: a.message,
      project: a.project,
      expected_revision: 1,
      mode: a.mode,
    };
    const live = await one(h.db, "SELECT * FROM documents WHERE public_id=$1", [
      a.project,
    ]);
    if (live) {
      const result = await svc.apply(actor, a.conversation, b);
      assert.equal(result.applied_node, a.node);
    } else
      await assert.rejects(
        svc.apply(actor, a.conversation, b),
        /画布不存在或已删除/,
      );
  }
  console.log("Imported live and deleted-canvas historical UID replay passed");
} finally {
  await h.cleanup();
}
