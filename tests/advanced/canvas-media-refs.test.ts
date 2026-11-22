import assert from "node:assert/strict";
import test from "node:test";
import { one, type Sql } from "../../packages/platform/src/db.js";
import { canvasesFixture } from "../helpers/canvases.js";

test("Studio canvas saves replace media relations in bounded statements", async (t) => {
  const f = await canvasesFixture();
  try {
    const canvas = await f.canvases.create(f.admin, {});
    const project = await one(
      f.db,
      "SELECT id FROM documents WHERE public_id=$1",
      [canvas.id],
    );
    const [a, b, c] = await Promise.all(
      ["a", "b", "c"].map((char) => f.asset(char.repeat(32))),
    );
    const image = (id: string, media_id?: string, h3_refs: string[] = []) => ({
      id,
      type: "image",
      x: 0,
      y: 0,
      media_id,
      params: { h3_refs },
    });
    const readRefs = async () => ({
      nodes: (
        await f.db.query(
          `SELECT r.node, a.public_id FROM canvas_media_refs r JOIN assets a ON a.id=r.asset_id
         WHERE r.project_id=$1 ORDER BY r.node, a.public_id`,
          [project.id],
        )
      ).rows.map((r) => [r.node, r.public_id]),
      document: (
        await f.db.query(
          `SELECT a.public_id FROM document_assets r JOIN assets a ON a.id=r.asset_id
         WHERE r.document_id=$1 ORDER BY a.public_id`,
          [project.id],
        )
      ).rows.map((r) => r.public_id),
    });
    const transaction = f.db.transaction.bind(f.db);
    let statements = 0;
    t.mock.method(f.db, "transaction", <T>(run: (sql: Sql) => Promise<T>) =>
      transaction((sql) =>
        run({
          query(statement, params) {
            if (
              /\b(canvas_media_refs|document_assets)\b|^SELECT id FROM assets WHERE public_id=\$1$/.test(
                statement,
              )
            )
              statements++;
            return sql.query(statement, params);
          },
        }),
      ),
    );
    let revision = canvas.revision;
    const save = (nodes: ReturnType<typeof image>[]) => {
      statements = 0;
      return f.canvases.save(f.admin, canvas.id, {
        expected_revision: revision,
        title: canvas.title,
        document: { nodes },
      });
    };

    revision = (await save([image("first", a.public_id)])).revision;
    const oneReference = statements;
    assert.deepEqual(await readRefs(), {
      nodes: [["first", a.public_id]],
      document: [a.public_id],
    });

    revision = (
      await save([
        image("first", a.public_id),
        image("second", c.public_id, [b.public_id, b.public_id]),
        image("third", a.public_id),
      ])
    ).revision;
    assert.equal(statements, oneReference);
    assert.equal(statements, 3);
    const before = {
      nodes: [
        ["first", a.public_id],
        ["second", b.public_id],
        ["second", c.public_id],
        ["third", a.public_id],
      ],
      document: [a.public_id, b.public_id, c.public_id],
    };
    assert.deepEqual(await readRefs(), before);

    await assert.rejects(
      save([image("duplicate", a.public_id, [a.public_id])]),
      { code: "23505", constraint: "canvas_media_refs_pkey" },
    );
    assert.deepEqual(await readRefs(), before);
    assert.equal((await f.canvases.get(f.admin, canvas.id)).revision, revision);

    revision = (await save([image("replacement", c.public_id)])).revision;
    assert.equal(statements, oneReference);
    assert.deepEqual(await readRefs(), {
      nodes: [["replacement", c.public_id]],
      document: [c.public_id],
    });
    await save([]);
    assert.equal(statements, 2);
    assert.deepEqual(await readRefs(), { nodes: [], document: [] });
  } finally {
    await f.cleanup();
  }
});
