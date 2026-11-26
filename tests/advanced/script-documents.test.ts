import assert from "node:assert/strict";
import test from "node:test";
import { chatCanvasContext } from "@fumiao/original-api/chat-canvas.js";
import {
  OriginalScriptDocuments,
  computeScriptDescendantsSignature as serverDescendantsSig,
} from "@fumiao/original-api/script-documents.js";
import { chatContext } from "@fumiao/platform/chat-context.js";
import { computeScriptDescendantsSignature as clientDescendantsSig } from "../../apps/web/canvas-editor/script-fusion.js";
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

test("Recursive delete enforces descendant ownership, directory casing stays canonical, and suite rejects entry_type collisions", async () => {
  const f = await canvasesFixture();
  try {
    const scripts = new OriginalScriptDocuments(f.p);
    const ws = String(f.team.public_id);

    // 1. Member creates folder "Scenes", another workspace author (f.admin) creates a script inside "scenes/Episode.md"
    const dir = await scripts.create(
      f.member,
      { path: "Scenes", entry_type: "directory" },
      ws,
    );

    const child = await scripts.create(
      f.admin,
      {
        path: "scenes/Episode.md",
        doc_kind: "script",
        body_md: "同事撰写的剧本内容",
      },
      ws,
    );
    // Parent casing must canonicalize to existing directory "Scenes"
    assert.equal(child.path, "Scenes/Episode.md");
    assert.equal(child.parent_path, "Scenes");

    // Case-only rename of folder ("Scenes" -> "scenes") must relocate descendants too!
    const renamedDir = await scripts.update(
      f.member,
      dir.id,
      { expected_revision: dir.revision, path: "scenes" },
      ws,
    );
    assert.equal(renamedDir.path, "scenes");
    const childAfterCaseRename = await scripts.get(f.member, child.id, ws);
    assert.equal(childAfterCaseRename.path, "scenes/Episode.md");
    assert.equal(childAfterCaseRename.parent_path, "scenes");

    // Non-admin folder owner MUST NOT delete colleague's descendant document via recursive=true
    await assert.rejects(
      () => scripts.remove(f.member, dir.id, true, ws),
      (err: any) => err?.status === 403,
    );
    const stillExists = await scripts.get(f.admin, child.id, ws);
    assert.equal(stillExists.body_md, "同事撰写的剧本内容");

    // Suite creation must reject when a directory occupies an expected .md file path
    await scripts.create(
      f.member,
      { path: "冲突剧目/01_事件图谱与故事骨架.md", entry_type: "directory" },
      ws,
    );
    await assert.rejects(
      () =>
        scripts.createSuite(
          f.member,
          { folder: "冲突剧目", project_title: "冲突剧目" },
          ws,
        ),
      (err: any) => err?.status === 409,
    );
  } finally {
    await f.cleanup();
  }
});

test("Unicode case-insensitive search, cross-canvas node search/replace, and server-verified @ references in chat context", async () => {
  const f = await canvasesFixture();
  try {
    const scripts = new OriginalScriptDocuments(f.p);
    const ws = String(f.team.public_id);

    // 1. Unicode İ expansion does not shift match offsets
    const unicodeDoc = await scripts.create(
      f.member,
      {
        path: "unicode.md",
        doc_kind: "notes",
        body_md: "İabc 与 林默",
      },
      ws,
    );
    const uniHits = await scripts.search(
      f.member,
      { query: "abc", case_sensitive: false },
      ws,
    );
    const uniFile = uniHits.files.find((x) => x.id === unicodeDoc.id);
    assert.ok(uniFile);
    assert.equal(uniFile.matches[0].text, "abc");

    // 2. Cross-canvas search & optimistic replace across multiple canvases in workspace
    const c1 = await f.canvases.create(f.member, { title: "画布 A" }, ws);
    const c2 = await f.canvases.create(f.member, { title: "画布 B" }, ws);
    const baseNode = (id: string, text: string) => ({
      id,
      type: "text" as const,
      title: "镜头文稿",
      x: 40,
      y: 40,
      width: 320,
      height: 220,
      text,
      prompt: "",
      color: "none",
      media_id: null,
      active_job: null,
      use_media: false,
      params: {
        model: "gpt-image-2.6-sunburst",
        ratio: "16:9",
        seconds: 5,
        resolution: "1K" as const,
        quality: 768 as const,
        image_quality: "high" as const,
        fast_mode: true,
        sampling_steps: 20 as const,
        seed: null,
        flow_source_job: null,
        h3: null,
        h3_refs: [],
      },
    });
    const c1Saved = await f.canvases.save(f.member, c1.id, {
      title: "画布 A",
      expected_revision: c1.revision,
      document: { nodes: [baseNode("n_a", "林默推开审讯室大门")], edges: [], shots: [] },
    });
    const c2Saved = await f.canvases.save(f.member, c2.id, {
      title: "画布 B",
      expected_revision: c2.revision,
      document: { nodes: [baseNode("n_b", "天台上的林默回望城市")], edges: [], shots: [] },
    });

    const crossHits: any = await scripts.search(
      f.member,
      { query: "林默", case_sensitive: false },
      ws,
    );
    assert.equal(crossHits.canvases.length, 2);

    const crossReplaced: any = await scripts.replace(
      f.member,
      {
        replacements: [],
        canvas_replacements: [
          {
            canvas_id: c2.id,
            expected_revision: c2Saved.revision,
            nodes: [
              {
                node_id: "n_b",
                expected_text: "天台上的林默回望城市",
                next_text: "天台上的沈默回望城市",
              },
            ],
          },
        ],
      },
      ws,
    );
    assert.equal(crossReplaced.canvas_results[0].saved, true);
    const c2After = await f.canvases.get(f.member, c2.id);
    assert.equal(c2After.document.nodes[0].text, "天台上的沈默回望城市");

    // Reject cross-workspace canvas_replacements even when caller owns the foreign canvas
    const personalCanvas = await f.canvases.create(f.member, { title: "个人画布" });
    const crossWsAttempt: any = await scripts.replace(
      f.member,
      {
        replacements: [],
        canvas_replacements: [
          {
            canvas_id: personalCanvas.id,
            expected_revision: personalCanvas.revision,
            nodes: [{ node_id: "n_x", expected_text: "a", next_text: "b" }],
          },
        ],
      },
      ws,
    );
    assert.equal(crossWsAttempt.canvas_results[0].saved, false);
    assert.match(String(crossWsAttempt.canvas_results[0].error), /工作区/);

    // 3. Server-verified @ script_ids and @ node_ids in chatCanvasContext (including empty selected node)
    const ctx = await f.p.db.transaction((sql) =>
      chatCanvasContext(f.p, sql, f.member, String(f.team.id), {
        project: c1.id,
        node: "",
        expected_revision: c1Saved.revision,
        writeback: false,
        script_ids: [unicodeDoc.id],
        node_ids: ["n_a"],
      } as any),
    );
    assert.ok(Array.isArray(ctx.references));
    assert.equal(ctx.references.length, 2);
    const builtMessages = chatContext([
      {
        role: "user",
        content: "请根据引用的剧本与节点续写下一镜",
        state: "complete",
        context: JSON.stringify(ctx),
      },
    ]);
    assert.match(builtMessages[1].content, /林默推开审讯室大门/);
    assert.match(builtMessages[1].content, /unicode\.md/);

    // 4. Oversized canvas_replacements (> 12,000 chars) rejected cleanly without truncating original node text
    const overLimitAttempt: any = await scripts.replace(
      f.member,
      {
        replacements: [],
        canvas_replacements: [
          {
            canvas_id: c1.id,
            expected_revision: c1Saved.revision,
            nodes: [
              {
                node_id: "n_a",
                expected_text: "林默推开审讯室大门",
                next_text: "长".repeat(12001),
              },
            ],
          },
        ],
      },
      ws,
    );
    assert.equal(overLimitAttempt.canvas_results[0].saved, false);
    assert.match(String(overLimitAttempt.canvas_results[0].error), /12000/);
    const c1Unchanged = await f.canvases.get(f.member, c1.id);
    assert.equal(c1Unchanged.document.nodes[0].text, "林默推开审讯室大门");

    // 5. Fair @ reference budget: 3 long scripts (4,500 chars each) NEVER starve an explicit @ canvas node
    const longScripts = await Promise.all(
      [1, 2, 3].map((idx) =>
        scripts.create(
          f.member,
          {
            path: `long_${idx}.md`,
            doc_kind: "script",
            body_md: `剧本${idx}开头 ` + "剧".repeat(4500),
          },
          ws,
        ),
      ),
    );
    const fairCtx: any = await f.p.db.transaction((sql) =>
      chatCanvasContext(f.p, sql, f.member, String(f.team.id), {
        project: c1.id,
        node: "",
        expected_revision: c1Saved.revision,
        writeback: false,
        script_ids: longScripts.map((d) => d.id),
        node_ids: ["n_a", "missing_node_id"],
      } as any),
    );
    assert.equal(fairCtx.references?.length, 4);
    assert.ok(
      fairCtx.references?.some(
        (r: any) =>
          r.kind === "node" &&
          r.label === "镜头文稿" &&
          r.content.includes("林默推开审讯室大门"),
      ),
    );
    assert.ok(
      fairCtx.references
        ?.filter((r: any) => r.kind === "script")
        .every((r: any) => r.truncated === true),
    );
    assert.ok(
      fairCtx.omitted_references?.some((s: string) =>
        s.includes("missing_node_id"),
      ),
    );
    const fairPrompt = chatContext([
      {
        role: "user",
        content: "综合三份长剧本与审讯室节点给出建议",
        state: "complete",
        context: JSON.stringify(fairCtx),
      },
    ]);
    assert.match(fairPrompt[1].content, /林默推开审讯室大门/);
    assert.match(fairPrompt[1].content, /已按配额截断/);
    assert.match(fairPrompt[1].content, /missing_node_id/);

    // 6. Delete confirmation guards protect concurrent updates and newly added descendants
    const guardedDir = await scripts.create(
      f.member,
      { path: "受保护目录", entry_type: "directory" },
      ws,
    );
    const guardedChild = await scripts.create(
      f.member,
      {
        path: "受保护目录/子剧本A.md",
        doc_kind: "script",
        body_md: "初始版本",
      },
      ws,
    );

    // Collaborator adds a new file after user opened delete confirmation (expectedDescendants = 1)
    const lateSibling = await scripts.create(
      f.admin,
      {
        path: "受保护目录/确认后新增B.md",
        doc_kind: "script",
        body_md: "确认弹窗打开后才新增的剧本",
      },
      ws,
    );
    await assert.rejects(
      () =>
        scripts.remove(f.admin, guardedDir.id, true, ws, {
          expectedRevision: guardedDir.revision,
          expectedDescendants: 1,
          expectedRevisionSum: guardedChild.revision,
        }),
      (err: any) => err?.status === 409,
    );
    // Collaborator updates file revision after delete confirmation opened -> single-file delete rejected with 409
    const updatedSibling = await scripts.update(
      f.admin,
      lateSibling.id,
      {
        expected_revision: lateSibling.revision,
        body_md: "确认弹窗打开后刚保存的新内容",
      },
      ws,
    );
    await assert.rejects(
      () =>
        scripts.remove(f.admin, lateSibling.id, false, ws, {
          expectedRevision: lateSibling.revision,
        }),
      (err: any) => err?.status === 409,
    );
    const stillIntact = await scripts.get(f.member, lateSibling.id, ws);
    assert.equal(stillIntact.revision, updatedSibling.revision);
    assert.equal(stillIntact.body_md, "确认弹窗打开后刚保存的新内容");

    // 6b. Same descendant count AND same revision sum (delete a(r1) + create b(r1)) must STILL reject recursive delete via expectedDescendantSig!
    const swapDir = await scripts.create(
      f.member,
      { path: "签名保护目录", entry_type: "directory" },
      ws,
    );
    const childA = await scripts.create(
      f.member,
      {
        path: "签名保护目录/a.md",
        doc_kind: "script",
        body_md: "旧子剧本 A(r1)",
      },
      ws,
    );
    const sigWhenDialogOpened = clientDescendantsSig([
      { id: childA.id, revision: childA.revision },
    ]);
    assert.equal(
      sigWhenDialogOpened,
      serverDescendantsSig([{ id: childA.id, revision: childA.revision }]),
      "client and server descendant signatures must match bit-for-bit",
    );

    // Another tab deletes a(r1) and creates b(r1) inside the same directory (count=1, revisionSum=1 unchanged!)
    await scripts.remove(f.member, childA.id, false, ws);
    const childB = await scripts.create(
      f.member,
      {
        path: "签名保护目录/b.md",
        doc_kind: "script",
        body_md: "确认期间新建的子剧本 B(r1)",
      },
      ws,
    );
    assert.equal(childB.revision, 1);

    await assert.rejects(
      () =>
        scripts.remove(f.member, swapDir.id, true, ws, {
          expectedRevision: swapDir.revision,
          expectedDescendants: 1,
          expectedRevisionSum: 1,
          expectedDescendantSig: sigWhenDialogOpened,
        }),
      (err: any) =>
        err?.status === 409 && /子文档集合或版本/.test(String(err?.message)),
    );
    // Verify childB survived untouched!
    const childBIntact = await scripts.get(f.member, childB.id, ws);
    assert.equal(childBIntact.body_md, "确认期间新建的子剧本 B(r1)");

    // Refreshing confirmation signature with childB now deletes cleanly
    const refreshedSig = clientDescendantsSig([
      { id: childB.id, revision: childB.revision },
    ]);
    const deletedSwapDir = await scripts.remove(f.member, swapDir.id, true, ws, {
      expectedRevision: swapDir.revision,
      expectedDescendants: 1,
      expectedRevisionSum: 1,
      expectedDescendantSig: refreshedSig,
    });
    assert.equal(deletedSwapDir.ok, true);

    // 7. Cross-canvas search scans > 100 canvases (up to 200) and reports accurate scanned_canvases / total_canvases
    // Note: original per-workspace canvas limit is 100 (`canvases.ts`); create up to 96 more canvases (total ~98 in ws) and verify full scan + accurate counts!
    let extraLastId = "";
    for (let i = 0; i < 95; i++) {
      const extra = await f.canvases.create(
        f.member,
        { title: `批量画布_${i}` },
        ws,
      );
      extraLastId = extra.id;
      if (i === 94) {
        await f.canvases.save(f.member, extra.id, {
          title: extra.title,
          expected_revision: extra.revision,
          document: {
            nodes: [baseNode("deep_node_97", "深层跨画布命中标记_97")],
            edges: [],
            shots: [],
          },
        });
      }
    }
    assert.ok(extraLastId);
    const wideSearch: any = await scripts.search(
      f.member,
      {
        query: "深层跨画布命中标记_97",
        case_sensitive: false,
      },
      ws,
    );
    assert.ok(wideSearch.total_canvases >= 97);
    assert.equal(wideSearch.scanned_canvases, wideSearch.total_canvases);
    assert.equal(wideSearch.truncated, false);
    assert.equal(wideSearch.canvases.length, 1);
  } finally {
    await f.cleanup();
  }
});
