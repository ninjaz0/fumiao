import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chatsFixture } from "../helpers/chats.js";
import { one } from "@fumiao/platform/db.js";
import { chatText } from "@fumiao/platform/chat-values.js";
import { chatContext } from "@fumiao/platform/chat-context.js";
import type { OriginalActor } from "@fumiao/original-api/identity.js";

test("Original chat reservations, stops, retry history and settlement share one PostgreSQL authority and preserve text bytes", async () => {
  const f = await chatsFixture();
  try {
    let view = await f.chats.create(f.admin, {});
    const id = view.conversation.id;
    assert.match(id, /^[0-9a-f]{32}$/);
    assert.equal(view.conversation.title, "新对话");
    assert.equal(view.conversation.active_turn, null);
    assert.deepEqual(view.messages, []);
    const input = await f.draft(view, {
      text: "\u3000第一条😀\u0000消息\n 第二行\u3000",
    });
    view = await f.chats.send(f.admin, id, input);
    assert.equal(view.conversation.title, "第一条😀\u0000消息 第二行");
    assert.equal(view.conversation.revision, 2);
    assert.equal(view.messages[0].content, "第一条😀\u0000消息\n 第二行");
    assert.equal(view.messages[0].context, "{}");
    assert.equal(view.messages[0].turn, null);
    assert.equal(view.messages[1].author_name, null);
    assert.equal(view.messages[1].usage, "{}");
    assert.deepEqual(
      await one(
        f.db,
        "SELECT balance::integer AS balance,held::integer AS held FROM wallets WHERE workspace_id=$1",
        [f.workspace.id],
      ),
      { balance: 100, held: 1 },
    );
    const turn = await f.turn(view.conversation.active_turn!);
    assert.equal(turn.plugin_version, "1.2.0");
    assert.equal(f.p.vault.open(turn.config_snapshot).provider, "deepseek");
    assert.equal(
      (await one(f.db, "SELECT count(*)::integer AS count FROM jobs")).count,
      0,
    );
    await f.db.query("UPDATE chat_messages SET content=$2 WHERE id=$1", [
      turn.assistant_message,
      Buffer.from("已显示的部分😀\u0000"),
    ]);
    f.setTime(1800000010.25);
    const stopped = await f.chats.stop(f.admin, id);
    assert.equal(stopped.messages[1].content, "已显示的部分😀\u0000");
    assert.equal(stopped.messages[1].state, "stopped");
    assert.equal(stopped.conversation.revision, 3);
    assert.equal(stopped.conversation.active_turn, null);
    assert.deepEqual(await f.chats.stop(f.admin, id), stopped);
    assert.equal(
      await f.chats.finish(turn.id, {
        state: "complete",
        text: "late",
        reason: "stop",
      }),
      false,
    );
    assert.equal(
      (
        await one(f.db, "SELECT state FROM chat_charges WHERE turn_id=$1", [
          turn.id,
        ])
      ).state,
      "refunded",
    );
    const retry = await f.draft(stopped, {
      retry: stopped.messages[1].id,
      text: "新文字必须被忽略",
    });
    const second = await f.chats.send(f.admin, id, retry),
      secondTurn = await f.turn(second.conversation.active_turn!);
    assert.equal(second.messages.length, 2);
    assert.equal(second.messages[0].id, stopped.messages[0].id);
    assert.equal(second.messages[0].content, stopped.messages[0].content);
    assert.notEqual(second.messages[1].id, stopped.messages[1].id);
    assert.equal(
      (
        await one(f.db, "SELECT superseded FROM chat_messages WHERE id=$1", [
          turn.assistant_message,
        ])
      ).superseded,
      true,
    );
    await f.db.query(
      "UPDATE studio_prices SET amount=37 WHERE key='deepseek-flash|reply'",
    );
    f.setTime(1800000020.25);
    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () =>
        f.chats.finish(secondTurn.id, {
          state: "complete",
          text: "完整回复😀\u0000",
          reason: "stop",
          usage: { total_tokens: 9007199254740993n },
        }),
      ),
    );
    assert.equal(outcomes.filter(Boolean).length, 1);
    const completed = await f.chats.get(f.admin, id);
    assert.equal(
      completed.messages[1].usage,
      '{"total_tokens": 9007199254740993}',
    );
    assert.equal(completed.messages[1].finish_reason, "stop");
    assert.equal(completed.messages[1].content, "完整回复😀\u0000");
    assert.deepEqual(
      await one(
        f.db,
        "SELECT balance::integer AS balance,held::integer AS held FROM wallets WHERE workspace_id=$1",
        [f.workspace.id],
      ),
      { balance: 99, held: 0 },
    );
    assert.equal(
      (
        await one(
          f.db,
          "SELECT count(*)::integer AS count FROM ledger WHERE chat_turn_id IS NOT NULL",
        )
      ).count,
      4,
    );
    assert.equal(
      (await one(f.db, "SELECT count(*)::integer AS count FROM chat_outbox"))
        .count,
      0,
    );
    assert.equal(f.wire.requests.length, 0);
  } finally {
    await f.cleanup();
  }
});

test("Chat retries check identity before revisions; invalid sends roll back messages, supersession, outbox and funds", async () => {
  const f = await chatsFixture();
  try {
    const initial = await f.chats.create(f.admin, {}),
      id = initial.conversation.id;
    const input = await f.draft(initial),
      sent = await f.chats.send(f.admin, id, input);
    await f.db.query(
      "UPDATE studio_policy SET flags=jsonb_set(flags,'{deepseek-flash}','false'),price_revision=price_revision+1",
    );
    assert.deepEqual(
      await f.chats.send(f.admin, id, {
        ...input,
        expected_revision: 999,
        price_revision: 999,
      }),
      sent,
    );
    assert.deepEqual(
      await f.chats.send(f.admin, id, {
        ...input,
        text: "ignored",
        retry: 99999,
      }),
      sent,
    );
    await assert.rejects(
      f.chats.send(f.admin, id, { ...input, text: "different" }),
      { status: 409, message: "发送标识已使用" },
    );
    await assert.rejects(
      f.chats.send(f.admin, id, {
        ...input,
        uid: randomUUID(),
        model: "unknown",
      }),
      {
        status: 409,
        message: "其他成员已更新这段对话，已为你载入最新内容，请再次发送",
      },
    );
    const stopped = await f.chats.stop(f.admin, id);
    await f.db.query(
      "UPDATE studio_policy SET flags=jsonb_set(flags,'{deepseek-flash}','true')",
    );
    const retry = await f.draft(stopped, { retry: stopped.messages[1].id });
    for (const setup of [
      async () => {
        await f.db.query(
          "UPDATE studio_prices SET amount=NULL WHERE key='deepseek-flash|reply'",
        );
        return { status: 409, message: "这个对话模型尚未定价" };
      },
      async () => {
        await f.db.query(
          "UPDATE studio_prices SET amount=1 WHERE key='deepseek-flash|reply'",
        );
        retry.price_revision = 999;
        return { status: 409, message: "价格已更新，请确认后重新发送" };
      },
      async () => {
        retry.price_revision = (
          await one(f.db, "SELECT price_revision FROM studio_policy")
        ).price_revision;
        await f.db.query("UPDATE wallets SET balance=0 WHERE workspace_id=$1", [
          f.workspace.id,
        ]);
        return { status: 409, message: "当前空间积分不足，需要 1 积分" };
      },
    ]) {
      const expected = await setup();
      await assert.rejects(f.chats.send(f.admin, id, retry), expected);
      assert.deepEqual(await f.chats.get(f.admin, id), stopped);
      assert.equal(
        (
          await one(
            f.db,
            "SELECT count(*)::integer AS count FROM chat_messages",
          )
        ).count,
        2,
      );
      assert.equal(
        (await one(f.db, "SELECT count(*)::integer AS count FROM chat_turns"))
          .count,
        1,
      );
      assert.equal(
        (await one(f.db, "SELECT count(*)::integer AS count FROM chat_outbox"))
          .count,
        0,
      );
    }
    await f.db.query("UPDATE wallets SET balance=10 WHERE workspace_id=$1", [
      f.workspace.id,
    ]);
    await assert.rejects(
      f.chats.send(
        f.admin,
        id,
        await f.draft(stopped, { text: "\u0085\u3000" }),
      ),
      { status: 400, message: "请输入消息" },
    );
    await assert.rejects(
      f.chats.send(f.admin, id, await f.draft(stopped, { text: "bad\ud800" })),
    );
    assert.deepEqual(await f.chats.get(f.admin, id), stopped);
  } finally {
    await f.cleanup();
  }
});

test("Original conversation ownership, team collaboration and private-space isolation survive soft delete/restore", async () => {
  const f = await chatsFixture();
  try {
    const privateView = await f.chats.create(f.member, {});
    await assert.rejects(f.chats.get(f.admin, privateView.conversation.id), {
      status: 404,
    });
    await assert.rejects(
      f.chats.get(
        f.admin,
        privateView.conversation.id,
        String(f.memberSpace.public_id),
      ),
      { status: 403 },
    );
    const team = await one(f.db, "SELECT * FROM workspaces WHERE kind='team'");
    await f.db.query(
      "INSERT INTO members(workspace_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [team.id, f.member.id],
    );
    const selected = String(team.public_id),
      created = await f.chats.create(f.admin, {}, selected);
    const renamed = await f.chats.rename(
      f.member,
      created.conversation.id,
      { title: "\u3000共同编辑\u3000", expected_revision: 1 },
      selected,
    );
    assert.equal(renamed.conversation.title, "共同编辑");
    assert.equal(renamed.conversation.updated, created.conversation.updated);
    assert.equal(renamed.conversation.can_delete, false);
    const sent = await f.chats.send(
      f.member,
      created.conversation.id,
      await f.draft(renamed),
      selected,
    );
    await assert.rejects(
      f.chats.remove(f.member, created.conversation.id, selected),
      { status: 403, message: "只有创建者或管理员可以删除对话" },
    );
    await assert.rejects(
      f.chats.remove(f.admin, created.conversation.id, selected),
      { status: 409, message: "请先停止回复，再删除对话" },
    );
    await f.chats.stop(f.admin, created.conversation.id, selected);
    await f.chats.remove(f.admin, created.conversation.id, selected);
    await assert.rejects(
      f.chats.get(f.member, created.conversation.id, selected),
      { status: 404, message: "对话已删除" },
    );
    assert.deepEqual(
      (await f.chats.list(f.member, selected)).conversations,
      [],
    );
    await assert.rejects(
      f.chats.restore(f.member, created.conversation.id, selected),
      { status: 403, message: "无法恢复对话" },
    );
    const restored = await f.chats.restore(
      f.admin,
      created.conversation.id,
      selected,
    );
    assert.equal(restored.messages[0].author, Number(f.member.public_id));
    assert.equal(restored.messages[0].author_name, f.member.nickname);
    assert.equal(restored.conversation.title, "共同编辑");
    await f.db.query(
      "DELETE FROM members WHERE workspace_id=$1 AND user_id=$2",
      [team.id, f.member.id],
    );
    await assert.rejects(
      f.chats.get(f.member, created.conversation.id, selected),
      { status: 403 },
    );
    assert.equal(sent.messages[1].reply_to, sent.messages[0].id);
  } finally {
    await f.cleanup();
  }
});

test("Canvas context is an authorized optimistic snapshot; retries validate fresh context but reuse the original user material", async () => {
  const f = await chatsFixture();
  try {
    const canvas = await f.canvas(),
      context = {
        project: canvas.public_id,
        node: "text-node",
        expected_revision: 1,
        writeback: true,
      };
    const created = await f.chats.create(f.admin, { context });
    assert.equal(
      (await f.chats.list(f.admin, undefined, canvas.public_id, "text-node"))
        .conversations.length,
      1,
    );
    assert.equal(
      (await f.chats.list(f.admin, undefined, canvas.public_id, "missing"))
        .conversations.length,
      0,
    );
    const sent = await f.chats.send(
      f.admin,
      created.conversation.id,
      await f.draft(created, { context, text: "修改" }),
    );
    assert.equal(
      sent.messages[0].context,
      '{"project": "' +
        canvas.public_id +
        '", "node": "text-node", "title": "原节点", "text": "保留原文😀", "writeback": true}',
    );
    const turn = await f.turn(sent.conversation.active_turn!);
    await f.chats.finish(turn.id, {
      state: "failed",
      text: "弃用片段",
      error: "失败",
    });
    const stopped = await f.chats.get(f.admin, created.conversation.id);
    const retry = await f.draft(stopped, {
      retry: stopped.messages[1].id,
      context,
    });
    await f.db.query(
      "UPDATE documents SET revision=2,body=jsonb_set(body,'{legacyDocument,nodes,0,text}','\"已改为新材料\"') WHERE id=$1",
      [canvas.id],
    );
    await assert.rejects(
      f.chats.send(f.admin, created.conversation.id, retry),
      {
        status: 409,
        message:
          "画布已被其他成员修改。你的修改已保留，请重新载入或下载本地副本。",
      },
    );
    const retried = await f.chats.send(f.admin, created.conversation.id, {
      ...retry,
      context: { ...context, expected_revision: 2 },
    });
    assert.equal(retried.messages[0].context, sent.messages[0].context);
    const prompt = chatContext(
      retried.messages.filter((m) => m.role === "user"),
    );
    assert.match(prompt[0].content, /画布文字编辑助手/);
    assert.match(prompt[1].content, /保留原文😀/);
    assert.ok(!JSON.stringify(prompt).includes("已改为新材料"));
    const other = await f.canvas(f.member, f.memberSpace);
    await assert.rejects(
      f.chats.create(f.admin, {
        context: { ...context, project: other.public_id },
      }),
      { status: 404 },
    );
    await assert.rejects(
      f.chats.create(f.admin, { context: { ...context, project: "missing" } }),
      { status: 404, message: "画布不存在或已删除" },
    );
  } finally {
    await f.cleanup();
  }
});

test("Concurrent chat admission preserves per-owner/global limits across independent application instances", async () => {
  const { OriginalChats } =
    await import("@fumiao/original-api/chats.js");
  const f = await chatsFixture();
  try {
    const actors = [f.admin, f.member];
    for (let i = 0; i < 6; i++) {
      await f.identity.createMember(f.admin, {
        name: "limit-" + i,
        nickname: "成员 " + i,
        password: "chat-limits-fixture",
      });
      actors.push(
        (await one(f.db, "SELECT * FROM users WHERE name=$1", [
          "limit-" + i,
        ])) as OriginalActor,
      );
    }
    await f.db.query("UPDATE wallets SET balance=100");
    const work: { actor: any; view: any; body: any }[] = [];
    for (const actor of actors)
      for (let i = 0; i < 3; i++) {
        const view = await f.chats.create(actor, {});
        work.push({ actor, view, body: await f.draft(view) });
      }
    const results = await Promise.allSettled(
      work.map((w, i) =>
        new OriginalChats(f.p, f.chats.clock).send(
          w.actor,
          w.view.conversation.id,
          w.body,
        ),
      ),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 20);
    for (const r of results)
      if (r.status === "rejected")
        assert.equal(r.reason.message, "对话服务繁忙，请稍后重试");
    const counts = (
      await f.db.query(
        "SELECT owner_id,count(*) FROM chat_turns WHERE state='running' GROUP BY owner_id",
      )
    ).rows;
    assert.ok(counts.every((c) => Number(c.count) <= 3));
    const fullOwner = counts.find((c) => Number(c.count) === 3)!,
      actor = actors.find((a) => a.id === fullOwner.owner_id)!;
    const another = await f.chats.create(actor, {});
    await assert.rejects(
      f.chats.send(actor, another.conversation.id, await f.draft(another)),
      { status: 429, message: "最多同时进行 3 段对话" },
    );
    assert.equal(
      Number((await one(f.db, "SELECT sum(held) AS held FROM wallets")).held),
      20,
    );
    const turns = (await f.db.query("SELECT id FROM chat_turns")).rows;
    await Promise.all(
      turns.map((t) =>
        f.chats.finish(t.id, {
          state: "interrupted",
          error: "服务重启，回复已停止，积分已退回",
        }),
      ),
    );
    assert.equal(
      Number((await one(f.db, "SELECT sum(held) AS held FROM wallets")).held),
      0,
    );
    assert.equal(
      Number(
        (
          await one(
            f.db,
            "SELECT count(*)::integer AS count FROM ledger WHERE chat_turn_id IS NOT NULL",
          )
        ).count,
      ),
      40,
    );
    assert.equal(f.wire.requests.length, 0);
  } finally {
    await f.cleanup();
  }
});

test("Conversation/message bounds include superseded history, while restore and same-time listing retain original rules", async () => {
  const f = await chatsFixture();
  try {
    const first = await f.chats.create(f.admin, {}),
      second = await f.chats.create(f.admin, {});
    assert.deepEqual(
      (await f.chats.list(f.admin)).conversations.map((c) => c.id),
      [second.conversation.id, first.conversation.id],
    );
    const row = await one(
      f.db,
      "SELECT id FROM chat_conversations WHERE public_id=$1",
      [first.conversation.id],
    );
    await f.db.query(
      "INSERT INTO chat_messages(conversation_id,role,content,state,created,superseded) SELECT $1,'user',''::bytea,'complete',0,true FROM generate_series(1,1000)",
      [row.id],
    );
    await assert.rejects(
      f.chats.send(
        f.admin,
        first.conversation.id,
        await f.draft(first, { retry: 1 }),
      ),
      { status: 409, message: "这段对话已很长，请新建对话" },
    );
    await f.db.query(
      "INSERT INTO chat_conversations(workspace_id,owner_id,model,created,updated) SELECT $1,$2,'deepseek-flash',0,0 FROM generate_series(1,498)",
      [f.workspace.id, f.admin.id],
    );
    await assert.rejects(f.chats.create(f.admin, {}), {
      status: 409,
      message: "对话数量已达 500，请先整理旧对话",
    });
    await f.chats.remove(f.admin, first.conversation.id);
    await f.chats.create(f.admin, {});
    await f.chats.restore(f.admin, first.conversation.id);
    assert.equal(
      Number(
        (
          await one(
            f.db,
            "SELECT count(*)::integer AS count FROM chat_conversations WHERE deleted_at IS NULL AND workspace_id=$1",
            [f.workspace.id],
          )
        ).count,
      ),
      501,
    );
    assert.equal((await f.chats.list(f.admin)).conversations.length, 200);
    await assert.rejects(f.chats.get(f.admin, "invalid\u0000"), {
      status: 404,
    });
    assert.equal(
      (await f.chats.list(f.admin, undefined, "", "\u0000")).conversations
        .length,
      200,
    );
  } finally {
    await f.cleanup();
  }
});
