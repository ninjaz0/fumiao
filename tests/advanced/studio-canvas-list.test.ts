import assert from "node:assert/strict";
import test from "node:test";
import type { Sql } from "../../packages/platform/src/db.js";
import { canvasesFixture } from "../helpers/canvases.js";

test("Studio canvas list resolves covers in order with a constant number of reads", async (t) => {
  const f = await canvasesFixture();
  try {
    const image = await f.asset("a".repeat(32));
    const newer = await f.asset("b".repeat(32));
    const fallback = await f.asset("c".repeat(32));
    const video = await f.asset("d".repeat(32), "video");
    const first = await f.canvases.create(f.admin, {});
    f.setTime(1800000001);
    const second = await f.canvases.create(f.admin, {});
    const hidden = await f.canvases.create(f.member, {});

    const chosen = await f.job(1, "image", "completed", image.id);
    await f.job(2, "image", "completed", newer.id);
    await f.job(3, "video", "completed", video.id);
    await f.job(4, "image", "queued");
    const deleted = await f.job(5, "image", "completed", newer.id);
    await f.job(6, "image", "completed");
    await f.db.query(
      "INSERT INTO job_assets(job_id,asset_id,role) VALUES($1,$2,'output')",
      [chosen.id, newer.id],
    );
    await f.db.query(
      "UPDATE assets SET created_at=to_timestamp(0) WHERE id IN ($1,$2)",
      [image.id, newer.id],
    );
    await f.link(first.id, "shared", 1);
    await f.link(first.id, "shared", 2);
    await f.link(first.id, "deleted", 5);
    await f.link(first.id, "deleted", 2);
    await f.link(first.id, "queued", 1);
    await f.link(first.id, "queued", 4);
    await f.link(first.id, "no-output", 6);
    await f.link(first.id, "latest", 1);
    await f.link(first.id, "latest", 2);
    await f.link(first.id, "latest", 5);
    await f.link(second.id, "shared", 3);
    await f.link(hidden.id, "shared", 1);

    const node = (id: string, type = "image", other = {}) => ({
      id,
      type,
      x: 0,
      y: 0,
      ...other,
    });
    const nodes = [
      node("queued", "image", { media_id: fallback.public_id }),
      node("shared", "image", { active_job: 1 }),
      node("no-output", "image", { media_id: fallback.public_id }),
      node("deleted", "image", { active_job: 5, media_id: fallback.public_id }),
      node("latest"),
      node("pinned-empty", "image", { use_media: true }),
      node("pinned", "image", { use_media: true, media_id: image.public_id }),
      node("past-limit", "image", { media_id: fallback.public_id }),
    ];
    f.setTime(1800000000);
    await f.canvases.save(f.admin, first.id, {
      expected_revision: 1,
      title: "First",
      document: { nodes },
    });
    f.setTime(1800000001);
    await f.canvases.save(f.admin, second.id, {
      expected_revision: 1,
      title: "Second",
      document: { nodes: [node("shared", "video"), node("text", "text")] },
    });
    await f.canvases.save(f.member, hidden.id, {
      expected_revision: 1,
      title: "Hidden",
      document: { nodes: [node("shared")] },
    });

    const transaction = f.db.transaction.bind(f.db);
    let reads = 0;
    t.mock.method(f.db, "transaction", (fn: (sql: Sql) => Promise<unknown>) =>
      transaction((sql) =>
        fn({
          query(statement, params) {
            if (/^(SELECT|WITH)\b/.test(statement)) reads++;
            return sql.query(statement, params);
          },
        }),
      ),
    );
    const list = async (blanks: number) => {
      reads = 0;
      const { projects } = await f.canvases.list(
        f.admin,
        String(f.workspace.public_id),
      );
      assert.deepEqual(
        projects.map(({ id, covers, count, can_delete }) => ({
          id,
          covers,
          count,
          can_delete,
        })),
        [
          {
            id: second.id,
            count: 2,
            can_delete: true,
            covers: [{ id: video.public_id, type: "video" }],
          },
          {
            id: first.id,
            count: nodes.length + blanks,
            can_delete: true,
            covers: [
              { id: image.public_id, type: "image" },
              { id: fallback.public_id, type: "image" },
              { id: newer.public_id, type: "image" },
              { id: image.public_id, type: "image" },
            ],
          },
        ],
      );
      return reads;
    };

    await f.db.query("UPDATE jobs SET deleted_at=now() WHERE id=$1", [
      deleted.id,
    ]);
    const small = await list(0);
    const blanks = Array.from({ length: 40 }, (_, i) => node(`blank-${i}`));
    await f.db.query("UPDATE jobs SET deleted_at=NULL WHERE id=$1", [
      deleted.id,
    ]);
    f.setTime(1800000000);
    await f.canvases.save(f.admin, first.id, {
      expected_revision: 2,
      title: "First",
      document: { nodes: [...blanks, ...nodes] },
    });
    await f.db.query("UPDATE jobs SET deleted_at=now() WHERE id=$1", [
      deleted.id,
    ]);
    const large = await list(blanks.length);
    assert.deepEqual([small, large], [3, 3]);
    await assert.rejects(
      f.canvases.list(f.admin, String(f.memberSpace.public_id)),
      { status: 403 },
    );
  } finally {
    await f.cleanup();
  }
});
