import test from "node:test";
import assert from "node:assert/strict";
import { canvasesFixture } from "../helpers/canvases.js";
import { OriginalCanvases } from "@fumiao/original-api/canvases.js";
import { one } from "@fumiao/platform/db.js";
import { OriginalMedia } from "@fumiao/original-api/media.js";
import { ReferencePacks } from "@fumiao/platform/packs.js";
import { chatCanvasContext } from "@fumiao/original-api/chat-canvas.js";
import {
  canvasDocumentBytes,
  canvasVoiceIds,
} from "@fumiao/original-api/canvas-values.js";
import { parseCanvasDocument } from "@fumiao/original-api/canvas-draft.js";
import { museLifecycle } from "@fumiao/plugin-muse/lifecycle.js";
import { databaseFixture } from "../helpers/database.js";
import { hash } from "@fumiao/platform/security.js";
import {
  OriginalIdentity,
  type OriginalActor,
} from "@fumiao/original-api/identity.js";
const node = (id: string, type = "text", other: any = {}) => ({
  id,
  type,
  x: 0,
  y: 0,
  ...other,
});
test("Shot pack export bounds SQL reads and preserves the ordered private archive", async () => {
  const f = await canvasesFixture();
  try {
    const canvas = await f.canvases.create(
      f.member,
      { title: "Shots" },
      String(f.team.public_id),
    );
    const pinned = await f.asset("1".repeat(32), "video", f.team, f.member);
    const first = await f.asset("2".repeat(32), "video", f.team, f.member);
    const latest = await f.asset("3".repeat(32), "video", f.team, f.member);
    await f.db.query("UPDATE assets SET mime='video/webm' WHERE id=$1", [
      latest.id,
    ]);
    await f.job(1001, "video", "completed", first.id, f.team, f.member);
    await f.job(1002, "video", "completed", latest.id, f.team, f.member);
    await f.job(1003, "video", "running", undefined, f.team, f.member);
    await f.link(canvas.id, "chosen", 1001, "{}", f.member);
    await f.link(canvas.id, "chosen", 1002, "{}", f.member);
    await f.link(canvas.id, "latest", 1001, "{}", f.member);
    await f.link(canvas.id, "latest", 1002, "{}", f.member);
    await f.link(canvas.id, "pinned", 1003, "{}", f.member);
    const pin = { media_id: pinned.public_id, use_media: true };
    const nodes = [
      node("pinned", "video", pin),
      node("chosen", "video", { active_job: 1001 }),
      node("latest", "video"),
      node("fallback", "video", { media_id: pinned.public_id }),
      ...Array.from({ length: 20 }, (_, i) => node(`reuse-${i}`, "video", pin)),
    ];
    const shots = [
      "latest",
      "fallback",
      "chosen",
      "pinned",
      ...nodes.slice(4).map(({ id }) => id),
    ];
    const saved = await f.canvases.save(f.member, canvas.id, {
      expected_revision: canvas.revision,
      title: canvas.title,
      document: { nodes, shots },
    });
    const transaction = f.db.transaction;
    let statements = 0;
    f.db.transaction = (run) =>
      transaction((sql) =>
        run({
          query: (statement, params) => {
            statements++;
            return sql.query(statement, params);
          },
        }),
      );
    const body = { expected_revision: saved.revision };
    const ticket = await f.canvases.downloadShots(f.member, canvas.id, body);
    const row = await one(
      f.db,
      "SELECT owner_id,manifest FROM download_tickets WHERE key_hash=$1",
      [hash(ticket.url.split("/").at(-1)!)],
    );
    assert.equal(row.owner_id, f.member.id);
    assert.equal(ticket.filename, "弗淼-镜头-24项.zip");
    assert.deepEqual(
      row.manifest,
      [
        latest.public_id,
        pinned.public_id,
        first.public_id,
        ...Array(21).fill(pinned.public_id),
      ].map((key, i) => ({
        key,
        name: `镜头-${String(i + 1).padStart(3, "0")}.${i === 0 ? "webm" : "mp4"}`,
        size: 0,
      })),
    );
    const successfulStatements = statements;
    await assert.rejects(
      f.canvases.downloadShots(f.member, canvas.id, { expected_revision: 1 }),
      { status: 409 },
    );
    await f.db.query("UPDATE assets SET mime='image/avif' WHERE id=$1", [
      latest.id,
    ]);
    await f.db.query("UPDATE assets SET original_kind='ref' WHERE id=$1", [
      pinned.id,
    ]);
    await assert.rejects(
      f.canvases.downloadShots(f.member, canvas.id, body),
      { status: 400, message: "不支持下载此文件类型" },
    );
    await f.db.query("UPDATE assets SET mime='video/webm' WHERE id=$1", [
      latest.id,
    ]);
    await assert.rejects(
      f.canvases.downloadShots(f.member, canvas.id, body),
      { status: 409, message: "镜头 02 还没有可导出的视频" },
    );
    await f.db.query("UPDATE assets SET workspace_id=$1 WHERE id=$2", [
      f.memberSpace.id,
      latest.id,
    ]);
    await assert.rejects(
      f.canvases.downloadShots(f.member, canvas.id, body),
      { status: 404, message: "内容不存在或无权访问" },
    );
    assert(
      successfulStatements <= 10,
      `Expected at most 10 SQL statements, got ${successfulStatements}`,
    );
  } finally {
    await f.cleanup();
  }
});
test("Shot pack export preserves legacy active-job handling", async (t) => {
  const f = await canvasesFixture();
  try {
    const canvas = await f.canvases.create(f.admin, { title: "Legacy shots" });
    const asset = await f.asset("1".repeat(32), "video");
    const legacyJob = 2 ** 63;
    const body = { expected_revision: canvas.revision };
    const installDocument = (firstMedia: string | null, use_media: boolean) =>
      f.db.query(
        `UPDATE canvas_documents c SET document=$2
        FROM documents d WHERE c.project_id=d.id AND d.public_id=$1`,
        [
          canvas.id,
          canvasDocumentBytes(
            parseCanvasDocument({
              nodes: [
                node("first", "video", { media_id: firstMedia }),
                node("legacy", "video", {
                  active_job: legacyJob,
                  media_id: asset.public_id,
                  use_media,
                }),
              ],
              shots: ["first", "legacy"],
            }),
          ),
        ],
      );
    await t.test("ignores the unused job ID on a pinned shot", async () => {
      await installDocument(asset.public_id, true);
      const result = await f.canvases.downloadShots(f.admin, canvas.id, body);
      assert.equal(result.filename, "弗淼-镜头-2项.zip");
    });
    await t.test("does not let a later job lookup mask an earlier missing video", async () => {
      await installDocument(null, false);
      await assert.rejects(f.canvases.downloadShots(f.admin, canvas.id, body), {
        status: 409,
        message: "镜头 01 还没有可导出的视频",
      });
      await installDocument(asset.public_id, false);
      await assert.rejects(f.canvases.downloadShots(f.admin, canvas.id, body), {
        code: "22003",
      });
    });
  } finally {
    await f.cleanup();
  }
});
test(
  "Shot pack export keeps first errors and rechecks membership after an asset lock wait",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const f = await canvasesFixture();
    const transaction = f.db.transaction;
    let locked!: () => void, release!: () => void;
    const held = new Promise<void>((resolve) => (locked = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    let writer: Promise<void> | undefined;
    let exporting: ReturnType<typeof f.canvases.downloadShots> | undefined;
    try {
      const canvas = await f.canvases.create(
        f.member,
        { title: "Shots" },
        String(f.team.public_id),
      );
      const first = await f.asset("1".repeat(32), "video", f.team, f.member);
      const second = await f.asset("2".repeat(32), "video", f.team, f.member);
      const saved = await f.canvases.save(f.member, canvas.id, {
        expected_revision: canvas.revision,
        title: canvas.title,
        document: {
          nodes: [first, second].map(({ public_id }, i) =>
            node(`shot-${i}`, "video", { media_id: public_id, use_media: true }),
          ),
          shots: ["shot-0", "shot-1"],
        },
      });
      await f.db.query("UPDATE assets SET mime='video/quicktime' WHERE id=$1", [
        first.id,
      ]);
      writer = transaction(async (sql) => {
        await sql.query("SELECT id FROM assets WHERE id=$1 FOR UPDATE", [second.id]);
        locked();
        await gate;
      });
      await Promise.race([held, writer]);
      const body = { expected_revision: saved.revision };
      let readerPid: number;
      f.db.transaction = (fn) =>
        transaction(async (sql) => {
          await sql.query("SET LOCAL statement_timeout='3s'");
          readerPid = (await one(sql, "SELECT pg_backend_pid() AS pid")).pid;
          return fn(sql);
        });
      const waitForAssetLock = async (request: NonNullable<typeof exporting>) => {
        let finished = false;
        const finish = () => {
          finished = true;
        };
        void request.then(finish, finish);
        for (let i = 0; i < 100 && !finished; i++) {
          const state = await one(
            f.db,
            "SELECT wait_event_type,query FROM pg_stat_activity WHERE pid=$1",
            [readerPid!],
          );
          if (
            state?.wait_event_type === "Lock" &&
            state.query.includes("FOR SHARE")
          )
            return true;
          await new Promise((r) => setTimeout(r, 10));
        }
        return false;
      };
      const revokeAndUnlock = async () => {
        await f.db.query(
          "DELETE FROM members WHERE workspace_id=$1 AND user_id=$2",
          [f.team.id, f.member.id],
        );
        release();
        await writer;
      };
      exporting = f.canvases.downloadShots(f.member, canvas.id, body);
      // If the later row blocks us, membership may change before the first error is checked.
      if (await waitForAssetLock(exporting)) await revokeAndUnlock();
      await assert.rejects(exporting, {
        status: 400,
        message: "不支持下载此文件类型",
      });
      await f.db.query("UPDATE assets SET mime='video/mp4' WHERE id=$1", [
        first.id,
      ]);
      exporting = f.canvases.downloadShots(f.member, canvas.id, body);
      assert.ok(
        await waitForAssetLock(exporting),
        "export really waited for the asset row lock",
      );
      await revokeAndUnlock();
      await assert.rejects(exporting, {
        status: 404,
        message: "内容不存在或无权访问",
      });
      const tickets = await one(f.db, "SELECT count(*)::int AS n FROM download_tickets");
      assert.equal(tickets.n, 0);
    } finally {
      release();
      await Promise.allSettled([writer, exporting]);
      await f.cleanup();
    }
  },
);
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
test("Canvas saves replace the node index with exactly the saved node IDs", async () => {
  const f = await canvasesFixture();
  try {
    const project = await f.canvases.create(f.admin, {});
    const indexed = async () =>
      (
        await f.db.query(
          "SELECT node FROM canvas_nodes WHERE project_id=(SELECT id FROM documents WHERE public_id=$1) ORDER BY node",
          [project.id],
        )
      ).rows.map((row) => row.node);
    assert.deepEqual(await indexed(), []);
    const first = await f.canvases.save(f.admin, project.id, {
      expected_revision: project.revision,
      title: "Index",
      document: { nodes: [node("removed"), node("retained")] },
    });
    assert.deepEqual(await indexed(), ["removed", "retained"]);
    const second = await f.canvases.save(f.admin, project.id, {
      expected_revision: first.revision,
      title: "Index",
      document: {
        nodes: [node("retained", "text", { text: "updated" }), node("added")],
      },
    });
    assert.deepEqual(await indexed(), ["added", "retained"]);
    const before = await f.canvases.get(f.admin, project.id);
    await assert.rejects(
      f.canvases.save(f.admin, project.id, {
        expected_revision: second.revision,
        title: "Rejected",
        document: { nodes: [node("duplicate"), node("duplicate")] },
      }),
      { status: 400 },
    );
    assert.deepEqual(await indexed(), ["added", "retained"]);
    assert.deepEqual(await f.canvases.get(f.admin, project.id), before);
    await f.canvases.save(f.admin, project.id, {
      expected_revision: second.revision,
      title: "Empty",
      document: { nodes: [] },
    });
    assert.deepEqual(await indexed(), []);
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

test("Manual canvas edits save without full canvas plugins while keeping optimistic locks, explicit model rules and isolation", async () => {
  // Case 1: Builtins installed without activating any canvas plugin versions.
  const bare = await databaseFixture();
  try {
    await bare.p.registry.installBuiltins(bare.db);
    const identity = new OriginalIdentity(bare.p);
    await identity.bootstrap({
      name: "admin",
      nickname: "管理员",
      password: "bare-canvas-password",
    });
    const admin = (await one(
      bare.db,
      "SELECT * FROM users WHERE name='admin'",
    )) as OriginalActor;
    const canvases = new OriginalCanvases(bare.p, () => 1800000000);
    const created = await canvases.create(admin, { title: "空白画布" });
    const saved = await canvases.save(admin, created.id, {
      expected_revision: 1,
      title: "仅改名加便签",
      document: {
        nodes: [
          node("s1", "sticky", {
            title: "便签",
            text: "纯手工记录",
            color: "yellow",
          }),
          node("t1", "text", { title: "文本", text: "分镜草稿" }),
          node("i1", "image"),
          node("v1", "video"),
        ],
      },
    });
    assert.equal(saved.revision, 2);
    assert.equal(saved.title, "仅改名加便签");
    assert.equal(saved.document.nodes.length, 4);
    assert.equal((await canvases.get(admin, created.id)).title, "仅改名加便签");
    await assert.rejects(
      canvases.save(admin, created.id, {
        expected_revision: 1,
        title: "过期版本",
        document: {},
      }),
      { status: 409 },
    );
    await assert.rejects(
      canvases.save(admin, created.id, {
        expected_revision: 2,
        title: "未启用模型",
        document: {
          nodes: [node("v1", "video", { params: { model: "muse-video" } })],
        },
      }),
      { status: 503, message: "原画布插件尚未完整启用" },
    );
    await assert.rejects(
      canvases.save(admin, created.id, {
        expected_revision: 2,
        title: "未知模型",
        document: {
          nodes: [node("v1", "video", { params: { model: "missing-model" } })],
        },
      }),
      { status: 400, message: "节点模型与生成类型不匹配" },
    );
  } finally {
    await bare.cleanup();
  }

  // Case 2: One plugin lacks canvas policy while others remain active; resource/media isolation still enforced.
  const f = await canvasesFixture();
  try {
    await f.db.transaction((sql) =>
      f.catalog.activate(sql, museLifecycle.manifest),
    );
    const privateAsset = await f.asset(
      "c".repeat(32),
      "ref",
      f.memberSpace,
      f.member,
    );
    const p = await f.canvases.create(f.admin, { title: "初始画布" });
    const saved = await f.canvases.save(f.admin, p.id, {
      expected_revision: 1,
      title: "重命名画布",
      document: {
        nodes: [node("s1", "sticky", { text: "只放便签" })],
      },
    });
    assert.equal(saved.revision, 2);
    await assert.rejects(
      f.canvases.save(f.admin, p.id, {
        expected_revision: 2,
        title: "跨空间素材",
        document: {
          nodes: [node("i1", "image", { media_id: privateAsset.public_id })],
        },
      }),
      { status: 404 },
    );
    await assert.rejects(
      f.canvases.save(f.admin, p.id, {
        expected_revision: 2,
        title: "默认视频参数仍受校验",
        document: {
          nodes: [node("v1", "video", { params: { model: "", seconds: 6 } })],
        },
      }),
      { status: 400, message: "MiniMax H3 时长选项无效" },
    );
  } finally {
    await f.cleanup();
  }
});
