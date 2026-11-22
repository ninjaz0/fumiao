import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { chatsFixture } from "../helpers/chats.js";
import { one } from "@fumiao/platform/db.js";
import { ChatExecution } from "@fumiao/original-api/chat-execution.js";
import { ChatRuntime } from "@fumiao/original-api/chat-runtime.js";
import {
  ChatReplyError,
  type ProviderPlugin,
} from "@fumiao/plugin-sdk/index.js";
import { chatStreaming } from "@fumiao/plugin-chat/stream.js";
import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { ChatQueue } from "@fumiao/original-api/chat-queue.js";

type Fixture = Awaited<ReturnType<typeof chatsFixture>>;
async function send(f: Fixture, text = "第一轮问题") {
  const view = await f.chats.create(f.admin, {});
  const result = await f.chats.send(
    f.admin,
    view.conversation.id,
    await f.draft(view, { text }),
  );
  return { view: result, turn: await f.turn(result.conversation.active_turn!) };
}
function adapter(
  f: Fixture,
  hooks: Pick<ProviderPlugin, "chatStream" | "chatTitle">,
) {
  const original = f.p.registry.resolve.bind(f.p.registry);
  f.p.registry.resolve = async (sql, id, version) =>
    id === chatStreaming.manifest.id &&
    version === chatStreaming.manifest.version
      ? { ...chatStreaming, ...hooks }
      : original(sql, id, version);
}
async function balance(f: Fixture) {
  return one(
    f.db,
    "SELECT balance::integer AS balance,held::integer AS held FROM wallets WHERE workspace_id=$1",
    [f.workspace.id],
  );
}
async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await delay(10);
  }
  throw new Error("Chat worker test timed out");
}

test("Independent chat workers submit once using frozen plugin configuration; full replies settle before best-effort titles", async () => {
  const f = await chatsFixture(),
    store = new ChatExecution(f.chats);
  const a = new ChatRuntime(store),
    b = new ChatRuntime(new ChatExecution(f.chats));
  try {
    const { view, turn } = await send(f);
    let calls = 0,
      titles = 0;
    adapter(f, {
      async *chatStream(request) {
        calls++;
        assert.equal(request.config.apiKey, "sk-fixture-native-chat");
        assert.equal(request.model, "deepseek-flash");
        assert.equal(request.messages.at(-1)?.content, "第一轮问题");
        yield { request_id: "fixture-id" };
        f.setTime(1800000001.5);
        yield {
          text: "回复😀\u0000",
          reason: "stop",
          usage: { total_tokens: 9007199254740993n },
        };
      },
      async chatTitle(request) {
        titles++;
        assert.equal(request.question, "第一轮问题");
        assert.equal(request.answer, "回复😀\u0000");
        assert.deepEqual(await balance(f), { balance: 99, held: 0 });
        await delay(30); // A completed turn must not lose its title to heartbeat.
        return "原自动标题";
      },
    });
    await f.reset({ deepseek: "sk-changed-after-admission", openai: "sk-new" });
    await Promise.all([
      a.execute(turn.id),
      b.execute(turn.id),
      a.execute(turn.id),
    ]);
    assert.equal(calls, 1);
    assert.equal(titles, 1);
    const result = await f.chats.get(f.admin, view.conversation.id);
    assert.equal(result.messages[1].state, "complete");
    assert.equal(
      result.messages[1].usage,
      '{"total_tokens": 9007199254740993}',
    );
    assert.equal(result.messages[1].started, 1800000000.25);
    assert.equal(result.messages[1].finished, 1800000001.5);
    assert.equal(result.conversation.title, "原自动标题");
    assert.equal(result.conversation.updated, 1800000001.5);
    assert.equal(result.conversation.revision, 4);
    assert.deepEqual(await store.ready(), []);
    assert.equal(
      (
        await one(
          f.db,
          "SELECT count(*)::integer AS count FROM ledger WHERE chat_turn_id=$1",
          [turn.id],
        )
      ).count,
      2,
    );
  } finally {
    await a.close();
    await b.close();
    await f.cleanup();
  }
});

test("Chat stop in another application closes streaming, retains the last visible partial and refunds only once", async () => {
  const f = await chatsFixture(),
    runtime = new ChatRuntime(new ChatExecution(f.chats), { pollMs: 10 });
  try {
    const { view, turn } = await send(f);
    let closed = false;
    adapter(f, {
      async *chatStream({ signal }) {
        try {
          yield { text: "已经显示" };
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true }),
          );
          yield { text: "迟到文本", reason: "stop" };
        } finally {
          closed = true;
        }
      },
      async chatTitle() {
        throw new Error("Stopped turns must never request a title");
      },
    });
    const task = runtime.execute(turn.id);
    await until(
      async () =>
        (await f.chats.get(f.admin, view.conversation.id)).messages[1]
          .content === "已经显示",
    );
    const stopped = await f.chats.stop(f.admin, view.conversation.id);
    await task;
    assert.equal(closed, true);
    assert.deepEqual(await f.chats.get(f.admin, view.conversation.id), stopped);
    assert.equal(stopped.messages[1].state, "stopped");
    assert.equal(stopped.messages[1].finish_reason, "");
    assert.deepEqual(await balance(f), { balance: 100, held: 0 });
  } finally {
    await runtime.close();
    await f.cleanup();
  }
});

test("Expired chat claims interrupt instead of resubmitting; live heartbeats and never-dispatched turns survive another worker recovery", async () => {
  const f = await chatsFixture(),
    store = new ChatExecution(f.chats, 10);
  try {
    const expired = await send(f),
      live = await send(f),
      pending = await send(f);
    const old = await store.claim(expired.turn.id),
      current = await store.claim(live.turn.id);
    assert.ok(old && current);
    await store.start(expired.turn.id, old.lease);
    await store.progress(
      expired.turn.id,
      old.lease,
      "重启前部分文本",
      1800000000.25,
      "req-before-restart",
    );
    f.setTime(1800000008);
    assert.equal(await store.heartbeat(live.turn.id, current.lease), true);
    f.setTime(1800000012);
    const runtime = new ChatRuntime(store);
    let calls = 0;
    adapter(f, {
      async *chatStream() {
        calls++;
        yield { text: "不能再次调用", reason: "stop" };
      },
    });
    await runtime.execute(expired.turn.id);
    assert.equal(calls, 0);
    assert.equal(await store.recover(), 1);
    assert.equal(await store.recover(), 0);
    assert.equal(
      await store.progress(expired.turn.id, old.lease, "stale", null),
      false,
    );
    assert.equal(
      await f.chats.finish(
        expired.turn.id,
        { state: "complete", text: "stale" },
        old.lease,
      ),
      false,
    );
    const result = await f.chats.get(f.admin, expired.view.conversation.id);
    assert.equal(result.messages[1].state, "interrupted");
    assert.equal(result.messages[1].error, "服务重启，回复已停止，积分已退回");
    assert.equal(result.messages[1].content, "重启前部分文本");
    assert.deepEqual(
      (await store.ready()).map((r) => r.id),
      [pending.turn.id],
    );
    assert.deepEqual(await balance(f), { balance: 100, held: 2 });
    await runtime.close();
  } finally {
    await f.cleanup();
  }
});

test("Chat deadline, transport failure, length failure and graceful shutdown refund; title failures preserve success", async () => {
  const f = await chatsFixture();
  try {
    const cases = [
      {
        name: "deadline",
        stream: async function* () {
          await delay(100);
          yield {};
        },
        note: "连接中断，未完成的回复已退回积分",
      },
      {
        name: "transport",
        stream: async function* () {
          yield { text: "部分" };
          throw new Error("private credential/server detail");
        },
        note: "连接中断，未完成的回复已退回积分",
      },
      {
        name: "provider",
        stream: async function* () {
          throw new ChatReplyError("服务繁忙或额度不足，请稍后重试");
        },
        note: "服务繁忙或额度不足，请稍后重试",
      },
      {
        name: "length",
        stream: async function* () {
          yield { text: "部分", reason: "length" };
        },
        note: "回复达到长度限制，请缩小本次写作范围",
      },
      {
        name: "unicode-limit",
        stream: async function* () {
          yield { text: "😀".repeat(50001), reason: "stop" };
        },
        note: "回复过长，已停止。请缩小本次写作范围",
      },
      {
        name: "empty",
        stream: async function* () {
          yield { text: "\u3000", reason: "stop" };
        },
        note: "回复未完整结束，请重试",
      },
    ];
    for (const c of cases) {
      const { view, turn } = await send(f);
      adapter(f, { chatStream: c.stream });
      const runtime = new ChatRuntime(new ChatExecution(f.chats), {
        timeoutMs: c.name === "deadline" ? 10 : 1000,
      });
      await runtime.execute(turn.id);
      assert.equal(
        (await f.chats.get(f.admin, view.conversation.id)).messages[1].error,
        c.note,
        c.name,
      );
      assert.deepEqual(await balance(f), { balance: 100, held: 0 }, c.name);
      await runtime.close();
    }
    const stopped = await send(f),
      runtime = new ChatRuntime(new ChatExecution(f.chats));
    adapter(f, {
      async *chatStream({ signal }) {
        yield { text: "关闭前回复" };
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      },
    });
    const task = runtime.execute(stopped.turn.id);
    await until(
      async () =>
        (await f.chats.get(f.admin, stopped.view.conversation.id)).messages[1]
          .content === "关闭前回复",
    );
    await runtime.close();
    await task;
    assert.equal(
      (await f.chats.get(f.admin, stopped.view.conversation.id)).messages[1]
        .state,
      "stopped",
    );
    assert.deepEqual(await balance(f), { balance: 100, held: 0 });
    const complete = await send(f),
      final = new ChatRuntime(new ChatExecution(f.chats), {
        titleTimeoutMs: 10,
      });
    adapter(f, {
      async *chatStream() {
        yield { text: "完整", reason: "stop" };
      },
      async chatTitle() {
        await delay(100);
        return "迟到标题";
      },
    });
    await final.execute(complete.turn.id);
    const snapshot = await f.chats.get(f.admin, complete.view.conversation.id);
    assert.equal(snapshot.messages[1].state, "complete");
    assert.equal(snapshot.conversation.title, "第一轮问题");
    assert.deepEqual(await balance(f), { balance: 99, held: 0 });
    await final.close();
  } finally {
    await f.cleanup();
  }
});

test("Chat automatic titles respect rename/delete races and only the first successful user message", async () => {
  const f = await chatsFixture(),
    runtime = new ChatRuntime(new ChatExecution(f.chats));
  try {
    for (const mutation of ["rename", "delete", "empty", "failure"]) {
      const { view, turn } = await send(f);
      adapter(f, {
        async *chatStream() {
          yield { text: "完整", reason: "stop" };
        },
        async chatTitle() {
          if (mutation === "rename") {
            const current = await f.chats.get(f.admin, view.conversation.id);
            await f.chats.rename(f.admin, view.conversation.id, {
              title: "手动名称",
              expected_revision: current.conversation.revision,
            });
          }
          if (mutation === "delete")
            await f.chats.remove(f.admin, view.conversation.id);
          if (mutation === "failure")
            throw new Error("title server unavailable");
          return mutation === "empty" ? "" : "自动名称";
        },
      });
      await runtime.execute(turn.id);
      const row = await one(
        f.db,
        "SELECT * FROM chat_conversations WHERE public_id=$1",
        [view.conversation.id],
      );
      assert.equal(
        Buffer.from(row.title).toString(),
        mutation === "rename" ? "手动名称" : "第一轮问题",
      );
      assert.deepEqual(
        await one(f.db, "SELECT state FROM chat_charges WHERE turn_id=$1", [
          turn.id,
        ]),
        { state: "spent" },
      );
    }
    const first = await send(f);
    let titles = 0;
    adapter(f, {
      async *chatStream() {
        yield { text: "完整首轮", reason: "stop" };
      },
      async chatTitle() {
        titles++;
        return "首轮标题";
      },
    });
    await runtime.execute(first.turn.id);
    const current = await f.chats.get(f.admin, first.view.conversation.id);
    const second = await f.chats.send(
      f.admin,
      first.view.conversation.id,
      await f.draft(current, { text: "第二轮问题" }),
    );
    adapter(f, {
      async *chatStream(request) {
        assert.deepEqual(request.messages.slice(1), [
          { role: "user", content: "第一轮问题" },
          { role: "assistant", content: "完整首轮" },
          { role: "user", content: "第二轮问题" },
        ]);
        yield { text: "第二轮完整", reason: "stop" };
      },
      async chatTitle() {
        titles++;
        return "错误的第二轮标题";
      },
    });
    await runtime.execute((await f.turn(second.conversation.active_turn!)).id);
    assert.equal(titles, 1);
    const final = await f.chats.get(f.admin, first.view.conversation.id);
    assert.equal(final.conversation.title, "首轮标题");
    assert.equal(final.messages[3].state, "complete");
  } finally {
    await runtime.close();
    await f.cleanup();
  }
});

test(
  "BullMQ chat outbox retries an unavailable enqueue, tolerates duplicate deliveries and restores a lost wake-up",
  { skip: !process.env.TEST_REDIS_URL },
  async () => {
    const f = await chatsFixture(),
      url = new URL(process.env.TEST_REDIS_URL!),
      name = "test-chat-" + randomUUID();
    const connection = {
      host: url.hostname,
      port: Number(url.port || 6379),
      username: decodeURIComponent(url.username) || undefined,
      password: decodeURIComponent(url.password) || undefined,
      db: Number(url.pathname.slice(1) || 0),
      ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    };
    const store = new ChatExecution(f.chats),
      runtime = new ChatRuntime(store);
    const queue = new ChatQueue(runtime, connection, { name }),
      errors: string[] = [];
    const other = new ChatQueue(
      new ChatRuntime(new ChatExecution(f.chats)),
      connection,
      { name, onError: (e) => errors.push(e.name) },
    );
    try {
      let calls = 0;
      adapter(f, {
        async *chatStream() {
          calls++;
          yield { text: "队列完整回复", reason: "stop" };
        },
        async chatTitle() {
          return "队列标题";
        },
      });
      const { turn, view } = await send(f);
      const add = queue.queue.add.bind(queue.queue);
      queue.queue.add = async () => {
        throw new Error("fixture Redis unavailable before enqueue");
      };
      await assert.rejects(queue.dispatch(), /Redis unavailable/);
      assert.deepEqual(
        (await store.ready()).map((r) => r.id),
        [turn.id],
      );
      assert.deepEqual(await balance(f), { balance: 100, held: 1 });
      queue.queue.add = add;
      await Promise.all([queue.dispatch(), other.dispatch()]);
      await until(
        async () =>
          (await f.chats.get(f.admin, view.conversation.id)).conversation
            .title === "队列标题",
      );
      await queue.queue.add("duplicate", { id: turn.id });
      await other.queue.add("duplicate", { id: turn.id });
      await until(
        async () =>
          !(await queue.queue.getJobCounts("active", "waiting")).active &&
          !(await queue.queue.getJobCounts("active", "waiting")).waiting,
      );
      assert.equal(calls, 1);
      assert.deepEqual(await balance(f), { balance: 99, held: 0 });
      const lost = await send(f);
      await store.dispatched(lost.turn.id); // Redis accepted then lost its pending key.
      assert.deepEqual(await store.ready(), []);
      f.setTime(1800000006);
      await other.dispatch();
      await until(
        async () =>
          (await f.chats.get(f.admin, lost.view.conversation.id)).conversation
            .title === "队列标题",
      );
      assert.equal(calls, 2);
      assert.deepEqual(errors, []);
      assert.deepEqual(await balance(f), { balance: 98, held: 0 });
    } finally {
      await queue.close();
      await other.close();
      const cleanup = new Queue(name, { connection });
      await cleanup.obliterate({ force: true });
      await cleanup.close();
      await f.cleanup();
    }
  },
);
