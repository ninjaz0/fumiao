import test from "node:test";
import assert from "node:assert/strict";
import { canvasesFixture } from "../helpers/canvases.js";
import { OriginalCanvases } from "../../packages/original-api/src/canvases.js";
import { one } from "../../packages/platform/src/db.js";
import { OriginalMedia } from "../../packages/original-api/src/media.js";
import { ReferencePacks } from "../../packages/platform/src/packs.js";
import { chatCanvasContext } from "../../packages/original-api/src/chat-canvas.js";
import {
  canvasDocumentBytes,
  canvasVoiceIds,
} from "../../packages/original-api/src/canvas-values.js";
import { parseCanvasDocument } from "../../packages/original-api/src/canvas-draft.js";
const node = (id: string, type = "text", other: any = {}) => ({
  id,
  type,
  x: 0,
  y: 0,
  ...other,
});
test("Copied voice IDs retain the original two-value set order, including hash collisions", () => {
  assert.deepEqual(canvasVoiceIds(5, 3), [3, 5]);
  assert.deepEqual(canvasVoiceIds(7, 15), [7, 15]);
  assert.deepEqual(canvasVoiceIds(15, 7), [15, 7]);
  assert.deepEqual(canvasVoiceIds(9, 1), [9, 1]);
  assert.deepEqual(canvasVoiceIds(null, 3), [3]);
  assert.deepEqual(canvasVoiceIds(3, 3), [3]);
});
test("Native canvas keeps original UTF-8 text and public keys, isolated from prototype writes", async () => {
  const f = await canvasesFixture();
  try {
    const p = await f.canvases.create(f.admin, {
      title: "\u001c 原画布😀\u0000 \u3000",
    });
    assert.equal(p.title, "原画布😀\u0000");
    const content = "不要改写 /media/" + "a".repeat(32) + " 😀\u0000\n";
    const saved = await f.canvases.save(f.admin, p.id, {
      expected_revision: 1,
      title: p.title,
      document: {
        nodes: [node("n", "text", { text: content, title: "节点\u0000" })],
      },
    });
    assert.equal(saved.revision, 2);
    const got = await f.canvases.get(f.admin, p.id);
    assert.equal(got.document.nodes[0].text, content);
    const row = await one(f.db, "SELECT * FROM documents WHERE public_id=$1", [
      p.id,
    ]);
    assert.deepEqual(row.body, { originalCanvas: 1 });
    assert.deepEqual(
      await f.p.documents(f.admin, f.workspace.id, "canvas"),
      [],
    );
    await assert.rejects(
      f.p.saveDocument(f.admin, f.workspace.id, {
        id: row.id,
        kind: "canvas",
        title: "overwrite",
        revision: 2,
        body: {},
      }),
      { status: 409 },
    );
    await assert.rejects(f.p.deleteDocument(f.admin, row.id), { status: 409 });
    const context = await f.db.transaction((sql) =>
      chatCanvasContext(f.p, sql, f.admin, f.workspace.id, {
        project: p.id,
        node: "n",
        expected_revision: 2,
        writeback: true,
      }),
    );
    assert.equal(context.text, content);
    assert.equal(context.title, "节点\u0000");
    assert.equal((await f.canvases.get(f.admin, p.id)).revision, 2);
    await assert.rejects(
      f.canvases.save(f.admin, p.id, {
        expected_revision: 2,
        title: "ok",
        document: { nodes: [node("n", "text", { text: "\ud800" })] },
      }),
    );
    assert.deepEqual(await f.canvases.get(f.admin, p.id), got);
    let stamp = 1800000100;
    const timed = await new OriginalCanvases(f.p, () => stamp++).create(
      f.admin,
      {},
    );
    assert.equal(timed.created, 1800000100);
    assert.equal(timed.updated, 1800000101);
  } finally {
    await f.cleanup();
  }
});
test("Canvas saves protect references and roll back document, revision and relations together", async () => {
  const f = await canvasesFixture();
  try {
    const a = await f.asset("a".repeat(32)),
      b = await f.asset("b".repeat(32));
    const p = await f.canvases.create(f.admin, {}),
      media = new OriginalMedia(f.p),
      packs = new ReferencePacks(f.db);
    const pack = await f.db.transaction((sql) =>
      packs.save(sql, f.admin, f.workspace.id, {
        name: "参考包",
        purpose: "subject",
        description: "",
        media: [b.public_id],
        expected_revision: null,
      }),
    );
    const doc = {
      nodes: [
        node("n", "image", {
          media_id: a.public_id,
          asset_packs: [{ id: pack.public_id, revision: 999 }],
        }),
      ],
    };
    await f.canvases.save(f.admin, p.id, {
      expected_revision: 1,
      title: "保留",
      document: doc,
    });
    await assert.rejects(
      f.db.transaction((sql) => media.protect(sql, a.id)),
      /素材正在画布中使用/,
    );
    await assert.rejects(
      f.db.transaction((sql) =>
        packs.remove(sql, f.admin, pack.public_id, f.workspace.id),
      ),
      /素材包正在画布中使用/,
    );
    const before = await f.canvases.get(f.admin, p.id);
    await assert.rejects(
      f.canvases.save(f.admin, p.id, {
        expected_revision: 2,
        title: "不得提交",
        document: {
          nodes: [
            node("n", "image", {
              media_id: a.public_id,
              params: { h3_refs: [a.public_id] },
            }),
          ],
        },
      }),
      { code: "23505" },
    );
    assert.deepEqual(await f.canvases.get(f.admin, p.id), before);
    assert.equal(
      (await f.db.query("SELECT * FROM document_pack_refs")).rows.length,
      1,
    );
    await f.db.query(
      "CREATE FUNCTION reject_canvas_save() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected save failure'; END $$; CREATE TRIGGER canvas_fail BEFORE UPDATE ON canvas_documents FOR EACH ROW EXECUTE FUNCTION reject_canvas_save();",
    );
    await assert.rejects(
      f.canvases.save(f.admin, p.id, {
        expected_revision: 2,
        title: "no",
        document: {},
      }),
      /injected save failure/,
    );
    assert.deepEqual(await f.canvases.get(f.admin, p.id), before);
    assert.equal(
      (await f.db.query("SELECT * FROM canvas_media_refs")).rows.length,
      1,
    );
    await f.db.query(
      "DROP TRIGGER canvas_fail ON canvas_documents; DROP FUNCTION reject_canvas_save();",
    );
    await f.canvases.save(f.admin, p.id, {
      expected_revision: 2,
      title: "cleared",
      document: {},
    });
    await f.db.transaction((sql) => media.protect(sql, a.id));
    await f.db.transaction((sql) =>
      packs.remove(sql, f.admin, pack.public_id, f.workspace.id),
    );
  } finally {
    await f.cleanup();
  }
});
test("Linked output protection follows current canvas nodes, including outputs completed after the last save", async () => {
  const f = await canvasesFixture();
  try {
    const p = await f.canvases.create(f.admin, {}),
      a = await f.asset("a".repeat(32), "video"),
      media = new OriginalMedia(f.p);
    await f.canvases.save(f.admin, p.id, {
      expected_revision: 1,
      title: "movie",
      document: { nodes: [node("v", "video")] },
    });
    const job = await f.job(1, "video", "queued");
    await f.link(p.id, "v", 1);
    await f.db.query(
      "UPDATE jobs SET state='completed',result=$2 WHERE id=$1",
      [job.id, JSON.stringify({ assets: [a.id] })],
    );
    await f.db.query(
      "INSERT INTO job_assets(job_id,asset_id,role) VALUES($1,$2,'output')",
      [job.id, a.id],
    );
    assert.equal(
      (await f.db.query("SELECT * FROM document_assets")).rows.length,
      0,
    );
    await assert.rejects(
      f.db.transaction((sql) => media.protect(sql, a.id)),
      /素材正在画布中使用/,
    );
    assert.deepEqual((await f.canvases.list(f.admin)).projects[0].covers, [
      { id: a.public_id, type: "video" },
    ]);
    const copy = await f.canvases.duplicate(f.admin, p.id);
    assert.equal(copy.document.nodes[0].media_id, a.public_id);
    assert.equal(copy.document.nodes[0].use_media, true);
    await f.canvases.remove(f.admin, copy.id);
    await f.canvases.save(f.admin, p.id, {
      expected_revision: 2,
      title: "removed",
      document: {},
    });
    await f.db.transaction((sql) => media.protect(sql, a.id));
  } finally {
    await f.cleanup();
  }
});
test("Team editing retains personal privacy and concurrent revisions have one winner", async () => {
  const f = await canvasesFixture();
  try {
    const privateCanvas = await f.canvases.create(f.member, {});
    await assert.rejects(f.canvases.get(f.admin, privateCanvas.id), {
      status: 404,
    });
    const p = await f.canvases.create(f.admin, {}, String(f.team.public_id));
    const results = await Promise.allSettled(
      [f.admin, f.member].map((u, i) =>
        f.canvases.save(u, p.id, {
          expected_revision: 1,
          title: "edit" + i,
          document: { nodes: [node("n", "text", { text: String(i) })] },
        }),
      ),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const failure = results.find(
      (r) => r.status === "rejected",
    ) as PromiseRejectedResult;
    assert.equal(failure.reason.status, 409);
    assert.equal((await f.canvases.get(f.member, p.id)).revision, 2);
    await assert.rejects(f.canvases.remove(f.member, p.id), { status: 403 });
    const copy = await f.canvases.duplicate(f.member, p.id);
    assert.equal(copy.workspace, Number(f.team.public_id));
    assert.equal(copy.owner, Number(f.member.public_id));
    await f.canvases.remove(f.member, copy.id);
    await f.canvases.remove(f.admin, p.id);
    assert.equal(
      (await f.canvases.list(f.admin, String(f.team.public_id))).projects
        .length,
      0,
    );
    await assert.rejects(f.canvases.get(f.admin, p.id), { status: 404 });
  } finally {
    await f.cleanup();
  }
});

test("Concurrent canvas creation cannot exceed the original per-workspace limit", async () => {
  const f = await canvasesFixture();
  try {
    for (let i = 0; i < 199; i++) await f.canvases.create(f.admin, {});
    const results = await Promise.allSettled([
      f.canvases.create(f.admin, {}),
      f.canvases.create(f.admin, {}),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const error = (
      results.find((r) => r.status === "rejected") as PromiseRejectedResult
    ).reason;
    assert.equal(error.status, 409);
    assert.equal(error.message, "画布数量已达 200，请先整理旧画布");
    assert.equal((await f.canvases.list(f.admin)).projects.length, 200);
    const separate = await f.canvases.create(f.member, {});
    assert.equal(separate.workspace, Number(f.memberSpace.public_id));
  } finally {
    await f.cleanup();
  }
});

test(
  "A duplicate blocked by a concurrent save reads the committed raw document after acquiring the parent lock",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const f = await canvasesFixture();
    const transaction = f.db.transaction.bind(f.db);
    let release!: () => void,
      locked!: () => void,
      started!: (pid: number) => void;
    const gate = new Promise<void>((r) => (release = r)),
      held = new Promise<void>((r) => (locked = r)),
      reader = new Promise<number>((r) => (started = r));
    let writer: Promise<void> | undefined,
      duplicate: ReturnType<typeof f.canvases.duplicate> | undefined;
    try {
      const p = await f.canvases.create(f.admin, { title: "旧内容" });
      writer = transaction(async (sql) => {
        const row = await one(
          sql,
          "SELECT id FROM documents WHERE public_id=$1 FOR UPDATE",
          [p.id],
        );
        locked();
        await gate;
        await sql.query(
          "UPDATE canvas_documents SET title=$2,document=$3 WHERE project_id=$1",
          [
            row.id,
            Buffer.from("新内容"),
            canvasDocumentBytes(
              parseCanvasDocument({
                nodes: [node("n", "text", { text: "已提交\u0000" })],
              }),
            ),
          ],
        );
        await sql.query(
          "UPDATE documents SET revision=revision+1 WHERE id=$1",
          [row.id],
        );
      });
      await held;
      f.db.transaction = (fn) =>
        transaction((sql) =>
          fn({
            query: async (statement, params = []) => {
              if (
                statement ===
                "SELECT id FROM documents WHERE public_id=$1 AND kind='canvas' AND NOT deleted FOR UPDATE"
              )
                started(
                  Number(
                    (await one(sql, "SELECT pg_backend_pid() AS pid")).pid,
                  ),
                );
              return sql.query(statement, params);
            },
          }),
        );
      duplicate = f.canvases.duplicate(f.admin, p.id);
      const pid = await reader;
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        const state = await one(
          f.db,
          "SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",
          [pid],
        );
        if (state?.wait_event_type === "Lock") {
          waiting = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 10));
      }
      assert.ok(
        waiting,
        "the duplicate really waited on the writer's row lock",
      );
      release();
      await writer;
      const result = await duplicate;
      assert.equal(result.title, "新内容 副本");
      assert.equal(result.document.nodes[0].text, "已提交\u0000");
    } finally {
      release();
      await Promise.allSettled([writer, duplicate]);
      f.db.transaction = transaction;
      await f.cleanup();
    }
  },
);
