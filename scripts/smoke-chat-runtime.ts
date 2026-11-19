import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chatsFixture } from "../tests/helpers/chats.js";
import { ChatExecution } from "../packages/original-api/src/chat-execution.js";
import { ChatRuntime } from "../packages/original-api/src/chat-runtime.js";
import { ChatReplyError } from "../packages/plugin-sdk/src/index.js";
import { chatStreaming } from "../plugins/chat/src/stream.js";
import { chatText } from "../packages/platform/src/chat-values.js";
import { one } from "../packages/platform/src/db.js";
const directory = await mkdtemp(join(tmpdir(), "fumiao-chat-runtime-oracle-"));
let f: Awaited<ReturnType<typeof chatsFixture>> | undefined;
try {
  execFileSync(
    process.env.STUDIO_PYTHON ||
      resolve(".runtime-advanced/original/.venv/bin/python"),
    ["scripts/chat-runtime-fixtures.py", directory],
    { stdio: "pipe", timeout: 180000 },
  );
  const data = JSON.parse(
      await readFile(join(directory, "manifest.json"), "utf8"),
    ),
    failures: any[] = [];
  f = await chatsFixture();
  const nativeResolve = f.p.registry.resolve.bind(f.p.registry);
  let snapshots = 0;
  for (const c of data.cases) {
    let mono = 10;
    f.setTime(c.base);
    await f.db.query("UPDATE wallets SET balance=100,held=0");
    let view = await f.chats.create(f.admin, {});
    const id = view.conversation.id;
    if (c.custom)
      view = await f.chats.rename(f.admin, id, {
        title: "用户标题",
        expected_revision: 1,
      });
    view = await f.chats.send(
      f.admin,
      id,
      await f.draft(view, { uid: c.body.uid, text: c.body.text }),
    );
    const turn: Record<string, any> = await f.turn(
        view.conversation.active_turn!,
      ),
      store = new ChatExecution(f.chats);
    const runtime = new ChatRuntime(store, { monotonic: () => mono });
    const trace: any[] = [],
      requests: any[] = [],
      titles: any[] = [];
    const snapshot = async (): Promise<Record<string, any>> => {
      const row = await one(
        f!.db,
        "SELECT c.*,w.public_id AS workspace_number,u.public_id AS owner_number FROM chat_conversations c JOIN workspaces w ON w.id=c.workspace_id JOIN users u ON u.id=c.owner_id WHERE c.id=$1",
        [turn.conversation_id],
      );
      const current: any = await f!.chats.snapshot(f!.db, row, f!.admin);
      current.conversation.id = "$c";
      current.conversation.active_turn = current.conversation.active_turn
        ? "$t"
        : null;
      current.messages = current.messages.map((m: any, i: number) => ({
        ...m,
        id: "$m" + (i + 1),
        reply_to: m.reply_to ? "$m1" : null,
        turn: m.turn ? "$t" : null,
      }));
      const t = await one(f!.db, "SELECT * FROM chat_turns WHERE id=$1", [
        turn.id,
      ]);
      const fields = Object.fromEntries(
        [
          "state",
          "created",
          "started",
          "first_token",
          "finished",
          "updated",
          "usage",
          "error",
          "request_id",
          "finish_reason",
        ].map((k) => [
          k,
          ["error", "request_id", "finish_reason"].includes(k)
            ? chatText(t[k])
            : t[k],
        ]),
      );
      const wallet = await one(
        f!.db,
        "SELECT balance::integer AS balance,held::integer AS reserved FROM wallets WHERE workspace_id=$1",
        [f!.workspace.id],
      );
      const charge = await one(
        f!.db,
        "SELECT amount::integer AS amount,state FROM chat_charges WHERE turn_id=$1",
        [turn.id],
      );
      const ledger = (
        await f!.db.query(
          "SELECT action,amount::integer AS amount,balance_snapshot::integer AS balance,held_snapshot::integer AS reserved,note,extract(epoch FROM created_at)::integer AS created FROM ledger WHERE chat_turn_id=$1 ORDER BY public_id",
          [turn.id],
        )
      ).rows;
      return { view: current, turn: fields, wallet, charge, ledger };
    };
    f.p.registry.resolve = async (sql, key, version) =>
      key === chatStreaming.manifest.id &&
      version === chatStreaming.manifest.version
        ? {
            ...chatStreaming,
            async *chatStream(request) {
              requests.push({
                model: request.model,
                messages: request.messages,
              });
              for (const event of c.events) {
                f!.setTime(c.base + (event.at ?? 0.25));
                mono = event.mono ?? 10;
                if (event.stop) await f!.chats.stop(f!.admin, id);
                if (event.raise_ === "generic")
                  throw new Error("private detail");
                if (event.raise_ === "runtime")
                  throw new ChatReplyError(event.message);
                if (event.raise_ === "cancel") {
                  void runtime.close();
                  throw new Error("shutdown");
                }
                yield event.item;
                trace.push(await snapshot());
              }
            },
            async chatTitle(request) {
              f!.setTime(c.base + 2);
              titles.push({
                model: request.model,
                question: request.question,
                answer: request.answer,
              });
              if (c.titleFailure) throw new Error("private title error");
              if (c.titleMutation === "rename") {
                const current = await f!.chats.get(f!.admin, id);
                await f!.chats.rename(f!.admin, id, {
                  title: "用户改名",
                  expected_revision: current.conversation.revision,
                });
              }
              if (c.titleMutation === "delete")
                await f!.chats.remove(f!.admin, id);
              return c.title ?? "";
            },
          }
        : nativeResolve(sql, key, version);
    let rejected = false;
    try {
      await runtime.execute(turn.id);
    } catch {
      rejected = true;
    }
    const final = await snapshot();
    let recovered = null;
    if (c.recover) {
      f.setTime(c.base + 61);
      await store.recover();
      recovered = await snapshot();
    }
    await runtime.close();
    try {
      assert.deepEqual(requests, c.requests, "provider context");
      assert.deepEqual(trace, c.trace, "intermediate snapshots");
      assert.deepEqual(titles, c.titles, "title requests");
      assert.deepEqual(final, c.final, "final state");
      assert.deepEqual(recovered, c.recovered, "recovery");
      // Python propagates CancelledError to its task owner; close() waits for and
      // consumes shutdown in Node. The public state and full ledger stay equal.
      if (c.name !== "cancel")
        assert.equal(rejected, c.rejected, "settlement failure");
    } catch (error) {
      failures.push({ name: c.name, error: String(error).slice(0, 8000) });
    }
    snapshots += trace.length + 1 + Number(!!recovered);
  }
  const report = {
    passed: !failures.length,
    scenarios: data.cases.length,
    snapshots,
    failures,
  };
  await mkdir(".runtime-advanced/chat-runtime-parity", { recursive: true });
  await writeFile(
    ".runtime-advanced/chat-runtime-parity/report.json",
    JSON.stringify(report, null, 2),
  );
  console.log("Original chat runtime parity:", JSON.stringify(report));
  if (failures.length) process.exitCode = 1;
} finally {
  await f?.cleanup();
  await rm(directory, { recursive: true, force: true });
}
