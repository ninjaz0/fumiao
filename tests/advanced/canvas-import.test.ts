import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { databaseFixture } from "../helpers/database.js";
import {
  canvasImportDraft,
  canvasImportTables,
} from "../helpers/canvas-import.js";
import {
  importLegacy,
  legacyId,
} from "@fumiao/platform/importer.js";
import { validateCanvasImport } from "@fumiao/platform/import-canvases.js";
import { canonical } from "@fumiao/platform/plugins.js";
import { one } from "@fumiao/platform/db.js";
import { OriginalCanvases } from "@fumiao/original-api/canvases.js";
import { OriginalMedia } from "@fumiao/original-api/media.js";
import type { OriginalActor } from "@fumiao/original-api/identity.js";
const sorted = (rows: unknown[]) => rows.map(canonical).sort();
async function objects(
  f: Awaited<ReturnType<typeof databaseFixture>>,
  d: ReturnType<typeof canvasImportDraft>,
) {
  for (const row of d.tables.media)
    await writeFile(join(f.directory, row.id), Buffer.alloc(0));
}
test("Canvas import preserves complete native history, raw documents, deleted task replays and detached exports", async () => {
  const f = await databaseFixture(),
    d = canvasImportDraft();
  d.tables.canvas_job_links[0].inputs =
    d.tables.canvas_job_links[0].inputs.replace(
      /}\s*$/,
      ', "params": {"legacy":9007199254740993} }',
    );
  try {
    d.tables.jobs[0].prompt = "历史\0中文😀\\u0000\ufeff";
    d.tables.jobs[0].audio_settings = JSON.stringify({
      instruction: "instruction\0\ufeff",
    });
    d.tables.jobs[0].reference_packs = JSON.stringify([
      { name: "pack\0中文", description: "\\u0000" },
    ]);
    await objects(f, d);
    await importLegacy(f.p, d, f.directory);
    assert.equal(
      (
        await one(f.db, "SELECT input FROM jobs WHERE public_id=$1", [
          d.tables.jobs[0].id,
        ])
      ).input.prompt,
      d.tables.jobs[0].prompt,
    );
    assert.equal(
      (
        await one(
          f.db,
          "SELECT payload FROM legacy_records WHERE collection='jobs' AND legacy_id=$1",
          [String(d.tables.jobs[0].id)],
        )
      ).payload.prompt,
      d.tables.jobs[0].prompt,
    );
    const actual = await canvasImportTables(f.db);
    for (const [name, records] of Object.entries(actual))
      assert.deepEqual(sorted(records), sorted(d.tables[name]), name);
    const raw = (
      await f.db.query(
        "SELECT collection,payload,workspace_id FROM legacy_canvas_records",
      )
    ).rows;
    for (const [name, records] of Object.entries(actual))
      assert.deepEqual(
        sorted(
          raw
            .filter((r) => r.collection === name)
            .map((r) => JSON.parse(Buffer.from(r.payload).toString())),
        ),
        sorted(records),
        name + " archive",
      );
    assert.ok(raw.every((r) => r.workspace_id));
    const admin = (await one(
        f.db,
        "SELECT * FROM users WHERE public_id=7",
      )) as OriginalActor,
      member = (await one(
        f.db,
        "SELECT * FROM users WHERE public_id=42",
      )) as OriginalActor,
      canvases = new OriginalCanvases(f.p);
    const p = await canvases.get(admin, "c".repeat(32));
    assert.equal(p.title, "原画布\0😀");
    assert.deepEqual(
      p.document,
      JSON.parse(d.tables.canvas_projects[0].document),
    );
    await assert.rejects(canvases.get(member, p.id), { status: 404 });
    await assert.rejects(canvases.get(member, "d".repeat(32)), { status: 404 });
    assert.equal((await canvases.get(admin, "d".repeat(32))).owner, 42);
    assert.equal(
      (await one(f.db, "SELECT count(*)::int AS n FROM document_pack_refs")).n,
      1,
    );
    assert.equal(
      (await one(f.db, "SELECT count(*)::int AS n FROM outbox")).n,
      0,
    );
    assert.equal(
      (await one(f.db, "SELECT count(*)::int AS n FROM chat_outbox")).n,
      0,
    );
    assert.equal(
      (await one(f.db, "SELECT sum(held)::int AS n FROM wallets")).n,
      0,
    );
    assert.equal(
      (
        await one(
          f.db,
          "SELECT count(*)::int AS n FROM connections WHERE enabled",
        )
      ).n,
      0,
    );
    const before = await canvasImportTables(f.db);
    assert.equal((await importLegacy(f.p, d, "unused")).alreadyImported, true);
    assert.deepEqual(await canvasImportTables(f.db), before);
    assert.equal(
      Number(
        (
          await one(
            f.db,
            "SELECT nextval(pg_get_serial_sequence('jobs','public_id')) AS id",
          )
        ).id,
      ),
      20,
      "deleted task 19 is still named by the batch and cannot be allocated to a new job",
    );
    const asset = legacyId(d.source, "asset", "b".repeat(32));
    await assert.rejects(
      f.db.transaction((sql) => new OriginalMedia(f.p).protect(sql, asset)),
      { status: 409 },
    );
    const ref = legacyId(d.source, "asset", "a".repeat(32));
    await f.db.transaction((sql) => new OriginalMedia(f.p).protect(sql, ref));
    await f.db.query(
      "UPDATE storyboard_exports SET state='running' WHERE public_id=$1",
      ["2".repeat(32)],
    );
    await assert.rejects(
      f.db.transaction((sql) => new OriginalMedia(f.p).protect(sql, ref)),
      {
        status: 409,
        message: "素材正在合成中，请稍后重试",
      },
    );
    await f.db.query(
      "UPDATE storyboard_exports SET state='failed' WHERE public_id=$1",
      ["2".repeat(32)],
    );
    const link = await one(
      f.db,
      "INSERT INTO canvas_job_links(project_id,node,owner_id,uid,inputs,created) VALUES($1,'new',$2,$3,$4,9) RETURNING id",
      [
        legacyId(d.source, "canvas", p.id),
        admin.id,
        randomUUID(),
        Buffer.from("{}"),
      ],
    );
    assert.equal(Number(link.id), 46);
    assert.equal(
      Number(
        (
          await one(
            f.db,
            "SELECT nextval(pg_get_serial_sequence('storyboard_exports','ordinal')) AS id",
          )
        ).id,
      ),
      31,
    );
    await canvases.remove(admin, p.id);
    assert.equal(
      (await one(f.db, "SELECT count(*)::int AS n FROM canvas_job_links")).n,
      0,
    );
    assert.equal(
      (await one(f.db, "SELECT count(*)::int AS n FROM canvas_run_batches")).n,
      0,
    );
    const exports = (
      await f.db.query("SELECT state,project_id FROM storyboard_exports")
    ).rows;
    assert.deepEqual(exports, [
      { state: "done", project_id: null },
      { state: "done", project_id: null },
    ]);
    assert.equal(
      (await one(f.db, "SELECT count(*)::int AS n FROM storyboard_export_refs"))
        .n,
      0,
    );
    // Idempotent import is never a restore over newer application changes.
    await importLegacy(f.p, d, "unused");
    await assert.rejects(canvases.get(admin, p.id), { status: 404 });
  } finally {
    await f.cleanup();
  }
});

test("Invalid canvas histories fail before object copying and cannot cross workspaces", async () => {
  const f = await databaseFixture();
  try {
    let copies = 0;
    f.p.storage.put = async () => {
      copies++;
      throw Error("must not copy");
    };
    const changes: [
      string,
      (d: ReturnType<typeof canvasImportDraft>) => void,
    ][] = [
      [
        "version",
        (d) => {
          delete d.canvasVersion;
        },
      ],
      [
        "partial",
        (d) => {
          delete d.tables.canvas_run_batches;
        },
      ],
      [
        "active export",
        (d) => {
          d.tables.storyboard_exports[0].state = "running";
        },
      ],
      [
        "malformed document",
        (d) => {
          d.tables.canvas_projects[0].document = "[]";
        },
      ],
      [
        "unsafe node job",
        (d) => {
          d.tables.canvas_projects[0].document =
            '{"nodes":[{"id":"v","type":"video","x":0,"y":0,"active_job":9007199254740993}]}';
        },
      ],
      [
        "surrogate title",
        (d) => {
          d.tables.canvas_projects[0].title = "\ud800";
        },
      ],
      [
        "missing owner",
        (d) => {
          d.tables.canvas_projects[0].owner = 999;
        },
      ],
      [
        "missing editor",
        (d) => {
          d.tables.canvas_projects[0].last_editor = 999;
        },
      ],
      [
        "cross-space owner",
        (d) => {
          d.tables.canvas_projects[0].owner = 42;
        },
      ],
      [
        "cross-space media",
        (d) => {
          d.tables.media[1].workspace = 85;
        },
      ],
      [
        "cross-space task",
        (d) => {
          d.tables.jobs[0].workspace = 85;
        },
      ],
      [
        "cross-space pack",
        (d) => {
          d.tables.asset_packs[0].workspace = 20;
        },
      ],
      [
        "missing ref",
        (d) => {
          d.tables.canvas_media_refs[0].media = "9".repeat(32);
        },
      ],
      [
        "missing link task",
        (d) => {
          d.tables.canvas_job_links[0].job = 99;
        },
      ],
      [
        "duplicate link",
        (d) => {
          d.tables.canvas_job_links[1].id = 12;
        },
      ],
      [
        "duplicate link uid",
        (d) => {
          d.tables.canvas_job_links[1].uid = d.tables.canvas_job_links[0].uid;
        },
      ],
      [
        "wrong batch child",
        (d) => {
          d.tables.canvas_job_links[0].uid = randomUUID();
        },
      ],
      [
        "missing batch charge",
        (d) => {
          d.tables.credit_charges.pop();
        },
      ],
      [
        "unsettled charge",
        (d) => {
          d.tables.credit_charges[0].state = "held";
        },
      ],
      [
        "wrong total",
        (d) => {
          d.tables.canvas_run_batches[0].result =
            '{"ids":[11,19],"count":2,"credits":19}';
        },
      ],
      [
        "wrong deleted link",
        (d) => {
          d.tables.canvas_job_links[0].job = null;
        },
      ],
      [
        "cross-space export",
        (d) => {
          d.tables.storyboard_exports[0].workspace = 90;
        },
      ],
      [
        "missing export",
        (d) => {
          d.tables.storyboard_export_refs[0].export = "f".repeat(32);
        },
      ],
      [
        "duplicate export order",
        (d) => {
          d.tables.storyboard_exports[0].original_order = 20;
        },
      ],
      [
        "bad snapshot",
        (d) => {
          d.tables.storyboard_exports[0].snapshot = "{}";
        },
      ],
      [
        "nonvideo output",
        (d) => {
          d.tables.storyboard_exports[0].result = "a".repeat(32);
        },
      ],
      [
        "unexpected property",
        (d) => {
          d.tables.canvas_projects[0].api_key = "never-copy";
        },
      ],
    ];
    for (const [name, change] of changes) {
      const d = canvasImportDraft();
      change(d);
      await assert.rejects(
        importLegacy(f.p, d, "missing"),
        (e: any) => e.status === 400 || e.status === 409,
        name,
      );
      assert.equal(
        (await one(f.db, "SELECT count(*)::int AS n FROM users")).n,
        0,
        name,
      );
      assert.equal(
        (await one(f.db, "SELECT count(*)::int AS n FROM legacy_imports")).n,
        0,
        name,
      );
    }
    assert.equal(copies, 0);
    const stale = canvasImportDraft();
    stale.tables.canvas_projects[0].document = JSON.stringify({
      nodes: [
        {
          id: "v",
          type: "video",
          x: 0,
          y: 0,
          media_id: "f".repeat(32),
          active_job: 999,
        },
      ],
    });
    assert.doesNotThrow(
      () => validateCanvasImport(stale.tables, 1),
      "original historical missing resources are not new cross-space references",
    );
  } finally {
    await f.cleanup();
  }
});

test("Late canvas import failure rolls back identity, references, history and audit as a unit; concurrent retries stay idempotent", async () => {
  const f = await databaseFixture(),
    d = canvasImportDraft();
  try {
    await objects(f, d);
    await f.db
      .query(`CREATE FUNCTION reject_canvas_archive() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture late canvas failure'; END $$;
      CREATE TRIGGER reject_canvas_archive BEFORE INSERT ON legacy_canvas_records FOR EACH ROW EXECUTE FUNCTION reject_canvas_archive();`);
    await assert.rejects(
      importLegacy(f.p, d, f.directory),
      /fixture late canvas failure/,
    );
    for (const table of [
      "users",
      "wallets",
      "assets",
      "documents",
      "document_pack_refs",
      "canvas_documents",
      "canvas_nodes",
      "canvas_media_refs",
      "canvas_job_links",
      "canvas_run_batches",
      "storyboard_exports",
      "storyboard_export_refs",
      "legacy_canvas_records",
      "legacy_imports",
    ])
      assert.equal(
        (await one(f.db, `SELECT count(*)::int AS n FROM ${table}`)).n,
        0,
        table,
      );
    await f.db.query(
      "DROP TRIGGER reject_canvas_archive ON legacy_canvas_records",
    );
    await Promise.all([
      importLegacy(f.p, d, f.directory),
      importLegacy(f.p, d, f.directory),
    ]);
    for (const [name, rows] of Object.entries(await canvasImportTables(f.db)))
      assert.deepEqual(sorted(rows), sorted(d.tables[name]), name);
    const changed = structuredClone(d);
    changed.tables.canvas_projects[0].title += " edited";
    await assert.rejects(importLegacy(f.p, changed, f.directory), /内容已变化/);
    assert.equal((await importLegacy(f.p, d, "unused")).alreadyImported, true);
  } finally {
    await f.cleanup();
  }
});
