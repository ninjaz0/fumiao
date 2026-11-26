import assert from "node:assert/strict";
import test from "node:test";
import { OriginalScriptDocuments } from "@fumiao/original-api/script-documents.js";
import { canvasesFixture } from "../helpers/canvases.js";

test("Workspace script documents support CRUD, folder tree relocation, and suite templates", async () => {
  const f = await canvasesFixture();
  try {
    const scripts = new OriginalScriptDocuments(f.p);
    const ws = String(f.team.public_id);

    const canvas = await f.canvases.create(
      f.member,
      { title: "说谎者 · 画布1" },
      ws,
    );

    // Bootstrap Toonflow 4-file drama suite inside folder "说谎者"
    const suite = await scripts.createSuite(
      f.member,
      {
        folder: "说谎者",
        project_title: "说谎者",
        canvas_id: canvas.id,
      },
      ws,
    );
    assert.equal(suite.created.length, 5); // 1 directory + 4 markdown docs

    const listed = await scripts.list(f.member, ws);
    assert.equal(listed.items.length, 5);
    assert.equal(listed.items[0].entry_type, "directory");
    assert.equal(listed.items[0].path, "说谎者");

    const epDoc = listed.items.find((item) =>
      item.path.includes("02_分集剧本"),
    );
    assert.ok(epDoc);
    assert.equal(epDoc.canvas_id, canvas.id);

    const detail = await scripts.get(f.member, epDoc.id, ws);
    assert.equal(detail.revision, 1);
    assert.match(detail.body_md, /S01/);

    // Update body with matching expected_revision
    const updated = await scripts.update(
      f.member,
      epDoc.id,
      {
        expected_revision: 1,
        body_md: detail.body_md + "\n\n△齐夏猛地抬头看向座钟。\n",
      },
      ws,
    );
    assert.equal(updated.revision, 2);
    assert.match(updated.body_md, /齐夏猛地抬头看向座钟/);

    // Rename parent folder "说谎者" -> "说谎者_第一季" relocates all child paths atomically
    const folderItem = listed.items[0];
    await scripts.update(
      f.member,
      folderItem.id,
      {
        expected_revision: folderItem.revision,
        path: "说谎者_第一季",
      },
      ws,
    );

    const afterRename = await scripts.list(f.member, ws);
    const relocatedEp = afterRename.items.find((i) => i.id === epDoc.id);
    assert.ok(relocatedEp);
    assert.ok(relocatedEp.path.startsWith("说谎者_第一季/"));

    // Non-empty directory deletion without recursive flag rejects with 409
    await assert.rejects(
      () => scripts.remove(f.member, folderItem.id, false, ws),
      (err: any) => err.status === 409,
    );

    // Recursive deletion removes folder and descendants
    const removed = await scripts.remove(f.member, folderItem.id, true, ws);
    assert.equal(removed.ok, true);
    const afterRemove = await scripts.list(f.member, ws);
    assert.equal(afterRemove.items.length, 0);
  } finally {
    await f.cleanup();
  }
});

test("Workspace script documents enforce optimistic revision locking, path safety, and workspace isolation", async () => {
  const f = await canvasesFixture();
  try {
    const scripts = new OriginalScriptDocuments(f.p);
    const teamWs = String(f.team.public_id);
    await f.identity.createMember(f.admin, {
      name: "outsider",
      nickname: "外部成员",
      password: "canvas-storage-fixture",
    });
    const outsiderRow = (
      await f.db.query("SELECT * FROM users WHERE name='outsider'")
    ).rows[0] as any;
    const outsiderSpace = await f.identity.activeWorkspace(f.db, outsiderRow);
    const outsiderPersonalWs = String(outsiderSpace.public_id);

    const doc = await scripts.create(
      f.member,
      {
        path: "剧本/EP01_密室.md",
        doc_kind: "script",
        body_md: "# EP01 密室\n\nS01 密室 夜 内\n人物：齐夏、人羊\n△灯光闪烁。",
      },
      teamWs,
    );
    assert.equal(doc.path, "剧本/EP01_密室.md");
    assert.equal(doc.revision, 1);

    // Duplicate path rejected with 409
    await assert.rejects(
      () =>
        scripts.create(
          f.member,
          { path: "剧本/EP01_密室.md", body_md: "dup" },
          teamWs,
        ),
      (err: any) => err.status === 409,
    );

    // Path traversal rejected with 400
    await assert.rejects(
      () =>
        scripts.create(
          f.member,
          { path: "../secret.md", body_md: "bad" },
          teamWs,
        ),
      (err: any) => err.status === 400,
    );

    // Stale expected_revision rejected with 409 preserving server content
    await scripts.update(
      f.admin,
      doc.id,
      {
        expected_revision: 1,
        body_md: "# EP01 密室（导演修订版）",
      },
      teamWs,
    );
    await assert.rejects(
      () =>
        scripts.update(
          f.member,
          doc.id,
          {
            expected_revision: 1,
            body_md: "# EP01 密室（过期草稿覆盖）",
          },
          teamWs,
        ),
      (err: any) => err.status === 409,
    );
    const latest = await scripts.get(f.member, doc.id, teamWs);
    assert.equal(latest.revision, 2);
    assert.equal(latest.body_md, "# EP01 密室（导演修订版）");

    // Outsider in another workspace cannot read, update, or search team script documents
    await assert.rejects(
      () => scripts.get(outsiderRow, doc.id, outsiderPersonalWs),
      (err: any) => err.status === 404,
    );
    const outsiderList = await scripts.list(outsiderRow, outsiderPersonalWs);
    assert.equal(outsiderList.items.length, 0);
  } finally {
    await f.cleanup();
  }
});

test("Workspace script search and batch optimistic replace handle matches and conflicts", async () => {
  const f = await canvasesFixture();
  try {
    const scripts = new OriginalScriptDocuments(f.p);
    const ws = String(f.team.public_id);

    const a = await scripts.create(
      f.member,
      {
        path: "01_人物设定.md",
        doc_kind: "assets",
        body_md: "主角：林墨\n林墨身穿黑色风衣站在雨夜街头。",
      },
      ws,
    );
    const b = await scripts.create(
      f.member,
      {
        path: "02_第一集剧本.md",
        doc_kind: "script",
        body_md: "S01 街头 夜 外\n林墨：时间不多了。\n△林墨转身离开。",
      },
      ws,
    );

    const hits = await scripts.search(
      f.member,
      { query: "林墨", case_sensitive: false },
      ws,
    );
    assert.equal(hits.files.length, 2);
    assert.equal(hits.total_matches, 4);

    // Simulate concurrent edit on file b before batch replace
    await scripts.update(
      f.admin,
      b.id,
      { expected_revision: 1, body_md: b.body_md + "\n△远处警笛声响起。" },
      ws,
    );

    const replaced = await scripts.replace(
      f.member,
      {
        replacements: [
          {
            id: a.id,
            expected_revision: 1,
            expected_text: a.body_md,
            next_text: a.body_md.replaceAll("林墨", "沈墨"),
          },
          {
            id: b.id,
            expected_revision: 1,
            expected_text: b.body_md,
            next_text: b.body_md.replaceAll("林墨", "沈墨"),
          },
        ],
      },
      ws,
    );
    assert.equal(replaced.results.length, 2);
    assert.equal(replaced.results[0].saved, true);
    assert.equal(replaced.results[1].saved, false);
    assert.match(replaced.results[1].error || "", /变化|冲突|修改/);

    const afterA = await scripts.get(f.member, a.id, ws);
    assert.match(afterA.body_md, /沈墨/);
    const afterB = await scripts.get(f.member, b.id, ws);
    assert.match(afterB.body_md, /林墨/);
    assert.match(afterB.body_md, /远处警笛声响起/);
  } finally {
    await f.cleanup();
  }
});
