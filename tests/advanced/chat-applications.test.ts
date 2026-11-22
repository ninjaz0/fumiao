import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { canvasesFixture } from "../helpers/canvases.js";
import { chatsFixture } from "../helpers/chats.js";
import { ChatExecution } from "@fumiao/original-api/chat-execution.js";
import { ChatRuntime } from "@fumiao/original-api/chat-runtime.js";
import { OriginalCanvases } from "@fumiao/original-api/canvases.js";
import { chatStreaming } from "@fumiao/plugin-chat/stream.js";
import { museCanvas } from "@fumiao/plugin-muse/canvas.js";
import { flowCanvas } from "@fumiao/plugin-flow/canvas.js";
import { gpuCanvas } from "@fumiao/plugin-gpu/canvas.js";
import { imagesCanvas } from "@fumiao/plugin-images/canvas.js";
import { one } from "@fumiao/platform/db.js";
import { OriginalChatApplications } from "@fumiao/original-api/chat-applications.js";
test("adoption persists permanent canvas identity, raw text, indexes and idempotent history", async () => {
  const f = await canvasesFixture();
  try {
    const canvas = await f.canvases.create(f.admin, { title: "采用" });
    const chat = await one(
      f.db,
      "INSERT INTO chat_conversations(workspace_id,owner_id,model,created,updated) VALUES($1,$2,'deepseek-flash',1,1) RETURNING *",
      [f.workspace.id, f.admin.id],
    );
    const message = await one(
      f.db,
      "INSERT INTO chat_messages(conversation_id,role,state,content,created,superseded) VALUES($1,'assistant','complete',$2,1,true) RETURNING *",
      [chat.id, Buffer.from("采用\0😀")],
    );
    const apply = new OriginalChatApplications(f.p);
    const body = {
      uid: randomUUID(),
      message: Number(message.public_id),
      project: canvas.id,
      expected_revision: 1,
    };
    const result = await apply.apply(f.admin, chat.public_id, body);
    assert.equal(result.document.nodes[0].text, "采用\0😀");
    assert.equal(result.document.nodes[0].x, -320);
    assert.deepEqual(
      await apply.apply(f.admin, chat.public_id, {
        ...body,
        expected_revision: 99,
      }),
      result,
    );
    const saved = await one(
      f.db,
      "SELECT * FROM chat_applications WHERE uid=$1",
      [body.uid],
    );
    assert.equal(saved.project_public_id, canvas.id);
    assert.ok(
      await one(
        f.db,
        "SELECT * FROM canvas_nodes WHERE project_id=$1 AND node=$2",
        [saved.project_id, result.applied_node],
      ),
    );
    await assert.rejects(apply.apply(f.member, chat.public_id, body), {
      status: 404,
    });
    await f.canvases.remove(f.admin, canvas.id);
    assert.equal(
      (
        await one(f.db, "SELECT * FROM chat_applications WHERE uid=$1", [
          body.uid,
        ])
      ).project_id,
      null,
    );
    await assert.rejects(
      apply.apply(f.admin, chat.public_id, body),
      /画布不存在或已删除/,
    );
  } finally {
    await f.cleanup();
  }
});

test("the first native chat reply becomes adoptable after completion without a second charge", async () => {
  const f = await chatsFixture();
  const runtime = new ChatRuntime(new ChatExecution(f.chats));
  try {
    await f.db.transaction(async (sql) => {
      for (const plugin of [museCanvas, flowCanvas, gpuCanvas, imagesCanvas])
        await f.catalog.activate(sql, plugin.manifest);
    });
    const canvases = new OriginalCanvases(f.p, f.chats.clock);
    const canvas = await canvases.create(f.admin, { title: "首轮采用" });
    const document = await canvases.save(f.admin, canvas.id, {
      title: canvas.title,
      expected_revision: canvas.revision,
      document: {
        nodes: [{ id: "draft", type: "text", text: "原稿", x: 5, y: 10 }],
      },
    });
    const context = {
      project: canvas.id,
      node: "draft",
      expected_revision: document.revision,
    };
    const created = await f.chats.create(f.admin, { context });
    assert.deepEqual(created.messages, []);
    const cid = created.conversation.id;
    const running = await f.chats.send(
      f.admin,
      cid,
      await f.draft(created, { context }),
    );
    const body = {
      uid: randomUUID(),
      project: canvas.id,
      expected_revision: document.revision,
      node: context.node,
      message: running.messages[1].id,
    };
    const service = new OriginalChatApplications(f.p, f.chats.clock);
    const before = await canvases.get(f.admin, canvas.id);
    await assert.rejects(service.apply(f.admin, cid, body), {
      status: 409,
      message: "请等待回复完成后再采用",
    });
    assert.deepEqual(await canvases.get(f.admin, canvas.id), before);
    const resolve = f.p.registry.resolve.bind(f.p.registry);
    const reply = "首轮回答\0😀";
    f.p.registry.resolve = (sql, plugin, version) =>
      plugin === chatStreaming.manifest.id &&
      version === chatStreaming.manifest.version
        ? Promise.resolve({
            ...chatStreaming,
            async *chatStream() {
              yield { text: reply, reason: "stop" };
            },
            async chatTitle() {
              return "首轮标题";
            },
          })
        : resolve(sql, plugin, version);
    const turn = await f.turn(running.conversation.active_turn!);
    await runtime.execute(turn.id);
    const completed = await f.chats.get(f.admin, cid);
    assert.equal(completed.conversation.title, "首轮标题");
    assert.equal(completed.messages[1].state, "complete");
    assert.equal(completed.messages[1].content, reply);
    const wallet = () =>
      one(
        f.db,
        "SELECT balance::integer,held::integer FROM wallets WHERE workspace_id=$1",
        [f.workspace.id],
      );
    const ledger = () =>
      f.db.query(
        "SELECT action FROM ledger WHERE chat_turn_id=$1 ORDER BY public_id",
        [turn.id],
      );
    assert.deepEqual(await wallet(), { balance: 99, held: 0 });
    assert.deepEqual((await ledger()).rows, [
      { action: "reserve" },
      { action: "spend" },
    ]);
    f.setTime(1800000001.5);
    const applied = await service.apply(f.admin, cid, body);
    assert.equal(applied.revision, document.revision + 1);
    assert.equal(applied.updated, 1800000001);
    assert.equal(applied.document.nodes[0].text, "原稿");
    const adopted = applied.document.nodes[1];
    assert.equal(adopted.id, applied.applied_node);
    assert.equal(adopted.text, reply);
    assert.equal(adopted.x, 373);
    assert.equal(adopted.y, 10);
    assert.deepEqual(
      await f.chats.list(f.admin, undefined, canvas.id, adopted.id),
      {
        conversations: [completed.conversation],
      },
    );
    assert.deepEqual(await service.apply(f.admin, cid, body), applied);
    assert.deepEqual(await f.chats.get(f.admin, cid), completed);
    assert.deepEqual(await wallet(), { balance: 99, held: 0 });
    assert.deepEqual((await ledger()).rows, [
      { action: "reserve" },
      { action: "spend" },
    ]);
  } finally {
    await runtime.close();
    await f.cleanup();
  }
});
