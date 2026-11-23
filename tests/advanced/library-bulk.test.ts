import test from "node:test";
import assert from "node:assert/strict";
import { libraryBulkFixture } from "../helpers/library-bulk.js";
import { canvasesFixture } from "../helpers/canvases.js";
import { archiveEntry, OriginalLibrary } from "@fumiao/original-api/library.js";

test("bulk library preserves mixed selection ordering and request-order errors", async () => {
  const f = await libraryBulkFixture();
  try {
    const ref = f.refs[0],
      { row: job, output } = f.jobs[0];
    await f.job(1001, "image", "completed", output.id);
    const keys = [
      `job:${job.public_id}`,
      `asset:${ref.public_id}`,
      `asset:${output.public_id}`,
      `job:${job.public_id}`,
    ];
    await f.verify(
      keys,
      [`asset:${ref.public_id}`, `job:${job.public_id}`],
      [
        archiveEntry(output, "001-图片-1"),
        archiveEntry(ref, "002-素材-" + ref.public_id.slice(0, 12)),
      ],
    );
    const missing = "job:999999",
      invalid = "invalid";
    const pending = await f.job(1002, "image", "running");
    const other = await f.asset("f".repeat(32), "ref", f.memberSpace, f.member);
    for (const favorite of [true, false]) {
      await assert.rejects(
        f.library.changeFavorites(f.admin, {
          keys: [missing, invalid],
          favorite,
        }),
        {
          status: favorite ? 404 : 400,
          message: favorite ? "部分资产已删除，请刷新后重试" : "资产标识无效",
        },
      );
    }
    for (const action of ["download", "favorite"] as const) {
      const run = (keys: string[]) =>
        action === "download"
          ? f.manifest(keys)
          : f.library.changeFavorites(f.admin, { keys, favorite: true });
      await assert.rejects(run([missing, invalid]), {
        status: 404,
        message: "部分资产已删除，请刷新后重试",
      });
      await assert.rejects(run([`job:${pending.public_id}`, invalid]), {
        status: 409,
        message:
          action === "download"
            ? "所选内容包含未生成完成的作品，暂时无法下载"
            : "只有已完成的作品可以收藏",
      });
      await assert.rejects(run([`asset:${other.public_id}`, invalid]), {
        status: 404,
        message: "内容不存在或无权访问",
      });
      await assert.rejects(run([invalid, missing]), {
        status: 400,
        message: "资产标识无效",
      });
    }
    await f.db.query("UPDATE jobs SET deleted_at=now() WHERE id=$1", [job.id]);
    assert.deepEqual(
      await f.library.changeFavorites(f.admin, {
        keys: [`job:${job.public_id}`, missing],
        favorite: false,
      }),
      { favorites: [] },
    );
    await assert.rejects(
      f.library.changeFavorites(f.admin, { keys: [], favorite: true }),
      { status: 422, message: "输入参数无效" },
    );
    assert.deepEqual(
      await f.library.favorites(f.db, f.admin, f.workspace.id),
      [],
    );
  } finally {
    await f.cleanup();
  }
});

test("bulk library query counts stay constant from 1 to 200 keys", async () => {
  const f = await libraryBulkFixture();
  try {
    let count = 0;
    const transaction = f.db.transaction.bind(f.db);
    f.db.transaction = (fn) =>
      transaction((sql) =>
        fn({
          query: (statement, params) => {
            count++;
            return sql.query(statement, params);
          },
        }),
      );
    for (const kind of ["ref", "job"] as const) {
      const all =
        kind === "ref"
          ? f.refs.map((a) => `asset:${a.public_id}`)
          : f.jobs.map((j) => `job:${j.row.public_id}`);
      for (const action of ["download", "favorite", "unfavorite"] as const) {
        const counts = [];
        for (const size of [1, 200]) {
          count = 0;
          if (action === "download")
            await f.library.prepareDownload(f.admin, {
              keys: all.slice(0, size),
            });
          else
            await f.library.changeFavorites(f.admin, {
              keys: all.slice(0, size),
              favorite: action === "favorite",
            });
          counts.push(count);
        }
        assert.equal(counts[1], counts[0], `${kind} ${action}: ${counts}`);
        assert(counts[1] <= 25, `${kind} ${action}: ${counts}`);
      }
    }
  } finally {
    await f.cleanup();
  }
});

test("favorites recheck membership after row locks before either write", async () => {
  const f = await canvasesFixture();
  try {
    const library = new OriginalLibrary(f.p);
    const asset = await f.asset("e".repeat(32), "ref", f.team, f.member);
    const keys = [`asset:${asset.public_id}`];
    const transaction = f.db.transaction.bind(f.db);
    for (const favorite of [true, false]) {
      if (!favorite) {
        await f.db.query(
          "INSERT INTO members(workspace_id,user_id) VALUES($1,$2)",
          [f.team.id, f.member.id],
        );
        await f.db.query(
          "INSERT INTO favorites(user_id,asset_id) VALUES($1,$2)",
          [f.member.id, asset.id],
        );
      }
      let revoked = false;
      f.db.transaction = (fn) =>
        transaction((sql) =>
          fn({
            query: async (statement, params) => {
              if (!revoked && statement.includes("ORDER BY id FOR KEY SHARE")) {
                await f.db.query(
                  "DELETE FROM members WHERE workspace_id=$1 AND user_id=$2",
                  [f.team.id, f.member.id],
                );
                revoked = true;
              }
              return sql.query(statement, params);
            },
          }),
        );
      await assert.rejects(
        library.changeFavorites(
          f.member,
          { keys, favorite },
          String(f.team.public_id),
        ),
        {
          status: 404,
          message: "内容不存在或无权访问",
        },
      );
      assert(revoked);
      assert.deepEqual(
        await library.favorites(f.db, f.member, f.team.id),
        favorite ? [] : keys,
      );
    }
  } finally {
    await f.cleanup();
  }
});
