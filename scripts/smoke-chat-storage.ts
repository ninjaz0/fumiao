import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { chatsFixture } from "../tests/helpers/chats.js";
import { chatText } from "../packages/platform/src/chat-values.js";
import { DomainError } from "../packages/platform/src/security.js";
import { ValidationError } from "../packages/original-api/src/validation.js";
const directory = await mkdtemp(join(tmpdir(), "fumiao-chat-storage-oracle-"));
let f: Awaited<ReturnType<typeof chatsFixture>> | undefined;
try {
  execFileSync(
    process.env.STUDIO_PYTHON ||
      resolve(".runtime-advanced/original/.venv/bin/python"),
    ["scripts/chat-storage-fixtures.py", directory],
    { stdio: "pipe", timeout: 180000 },
  );
  const data = JSON.parse(
      await readFile(join(directory, "manifest.json"), "utf8"),
    ),
    failures: any[] = [];
  f = await chatsFixture();
  await f.db.query(
    "UPDATE studio_policy SET flags=$1,revision=$2,price_revision=$3",
    [
      JSON.stringify(data.initial.enabled),
      data.initial.revision,
      data.pricing.revision,
    ],
  );
  for (const [actor, space, key] of [
    [f.admin, f.workspace, data.canvas],
    [f.member, f.memberSpace, data.foreign],
  ] as const) {
    const canvas = await f.canvas(actor, space, [data.node]);
    await f.db.query("UPDATE documents SET public_id=$2 WHERE id=$1", [
      canvas.id,
      key,
    ]);
  }
  let aliases = new Map<string | number, string>(),
    messages = new Map<number, string>();
  const refresh = async () => {
    const c = (
      await f!.db.query(
        "SELECT public_id FROM chat_conversations ORDER BY ordinal",
      )
    ).rows;
    const m = (
      await f!.db.query(
        "SELECT public_id FROM chat_messages ORDER BY public_id",
      )
    ).rows;
    const t = (
      await f!.db.query(
        "SELECT t.public_id FROM chat_turns t JOIN chat_messages m ON m.id=t.assistant_message ORDER BY m.public_id",
      )
    ).rows;
    aliases = new Map([
      ...c.map((r, i) => [r.public_id, "$c" + (i + 1)] as const),
      ...t.map((r, i) => [r.public_id, "$t" + (i + 1)] as const),
    ]);
    messages = new Map(m.map((r, i) => [Number(r.public_id), "$m" + (i + 1)]));
  };
  const resolveInput = (value: any): any => {
    if (typeof value === "string" && /^\$[cmt]\d+$/.test(value))
      return (
        [...aliases, ...messages].find(([, v]) => v === value)?.[0] ?? value
      );
    if (Array.isArray(value)) return value.map(resolveInput);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, resolveInput(v)]),
      );
    return value;
  };
  const normalize = (value: any): any => {
    if (typeof value === "string") return aliases.get(value) ?? value;
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object") {
      const result: any = Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, normalize(v)]),
      );
      if ("role" in value && "id" in value)
        result.id = messages.get(Number(value.id)) ?? value.id;
      for (const key of ["reply_to", "user_message", "assistant_message"])
        if (key in value)
          result[key] =
            value[key] === null
              ? null
              : (messages.get(Number(value[key])) ?? value[key]);
      return result;
    }
    return value;
  };
  const storage = async () => {
    const conversations = (
      await f!.db.query(
        `SELECT c.*,w.public_id AS workspace,u.public_id AS owner FROM chat_conversations c JOIN workspaces w ON w.id=c.workspace_id JOIN users u ON u.id=c.owner_id ORDER BY c.ordinal`,
      )
    ).rows.map((c) => ({
      id: c.public_id,
      workspace: Number(c.workspace),
      owner: Number(c.owner),
      title: chatText(c.title),
      custom_title: Number(c.custom_title),
      model: c.model,
      created: c.created,
      updated: c.updated,
      revision: c.revision,
      deleted_at: c.deleted_at,
    }));
    const msgs = (
      await f!.db.query(
        `SELECT m.*,c.public_id AS conversation,u.public_id AS author,r.public_id AS reply_number FROM chat_messages m JOIN chat_conversations c ON c.id=m.conversation_id LEFT JOIN users u ON u.id=m.author_id LEFT JOIN chat_messages r ON r.id=m.reply_to ORDER BY m.public_id`,
      )
    ).rows.map((m) => ({
      id: Number(m.public_id),
      conversation: m.conversation,
      role: m.role,
      author: m.author === null ? null : Number(m.author),
      content: chatText(m.content),
      state: m.state,
      model: m.model,
      created: m.created,
      context: m.context,
      reply_to: m.reply_number === null ? null : Number(m.reply_number),
      superseded: Number(m.superseded),
    }));
    const turns = (
      await f!.db.query(
        `SELECT t.*,c.public_id AS conversation,u.public_id AS owner,a.public_id AS assistant_number,m.public_id AS user_number FROM chat_turns t JOIN chat_conversations c ON c.id=t.conversation_id JOIN users u ON u.id=t.owner_id JOIN chat_messages a ON a.id=t.assistant_message JOIN chat_messages m ON m.id=t.user_message ORDER BY a.public_id`,
      )
    ).rows.map((t) => ({
      id: t.public_id,
      uid: t.uid,
      conversation: t.conversation,
      owner: Number(t.owner),
      user_message: Number(t.user_number),
      assistant_message: Number(t.assistant_number),
      model: t.model,
      state: t.state,
      created: t.created,
      started: t.started,
      first_token: t.first_token,
      finished: t.finished,
      updated: t.updated,
      usage: t.usage,
      error: chatText(t.error),
      request_id: chatText(t.request_id),
      finish_reason: chatText(t.finish_reason),
    }));
    const charges = (
      await f!.db.query(
        `SELECT c.*,t.public_id AS turn,w.public_id AS workspace,u.public_id AS owner FROM chat_charges c JOIN chat_turns t ON t.id=c.turn_id JOIN chat_messages m ON m.id=t.assistant_message JOIN workspaces w ON w.id=c.workspace_id JOIN users u ON u.id=c.owner_id ORDER BY m.public_id`,
      )
    ).rows.map((c) => ({
      turn: c.turn,
      workspace: Number(c.workspace),
      owner: Number(c.owner),
      amount: Number(c.amount),
      price_key: c.price_key,
      price_revision: c.price_revision,
      state: c.state,
      created: Number(c.created),
    }));
    const ledger = (
      await f!.db.query(
        `SELECT l.*,w.public_id AS workspace,u.public_id AS actor FROM ledger l JOIN workspaces w ON w.id=l.workspace_id JOIN users u ON u.id=l.actor_id WHERE l.chat_turn_id IS NOT NULL ORDER BY l.public_id`,
      )
    ).rows.map((l) => ({
      workspace: Number(l.workspace),
      actor: Number(l.actor),
      chat_turn: l.original_chat_turn,
      action: l.action,
      amount: Number(l.amount),
      balance: Number(l.balance_snapshot),
      reserved: Number(l.held_snapshot),
      note: l.note,
      created: Math.floor(new Date(l.created_at).getTime() / 1000),
    }));
    const wallets = (
      await f!.db.query(
        "SELECT w.public_id AS workspace,a.balance,a.held FROM wallets a JOIN workspaces w ON w.id=a.workspace_id ORDER BY w.public_id",
      )
    ).rows.map((w) => ({
      workspace: Number(w.workspace),
      balance: Number(w.balance),
      reserved: Number(w.held),
    }));
    const links = (
      await f!.db.query(
        "SELECT d.public_id AS project,l.node,c.public_id AS conversation,l.created FROM canvas_chat_links l JOIN documents d ON d.id=l.project_id JOIN chat_conversations c ON c.id=l.conversation_id ORDER BY d.public_id,l.node,c.public_id",
      )
    ).rows;
    return normalize({
      conversations,
      messages: msgs,
      turns,
      charges,
      ledger,
      wallets,
      links,
    });
  };
  for (const source of data.cases) {
    f.setTime(source.stamp);
    const c = resolveInput(source),
      actor = c.actor === 1 ? f.member : f.admin,
      selected = c.workspace === undefined ? undefined : String(c.workspace);
    let actual: { status: number; body: unknown };
    try {
      let body: unknown;
      switch (c.action) {
        case "create":
          body = await f.chats.create(actor, c.body, selected);
          break;
        case "get":
          body = await f.chats.get(actor, c.chat, selected);
          break;
        case "list":
          body = await f.chats.list(
            actor,
            selected,
            c.query?.project,
            c.query?.node,
          );
          break;
        case "rename":
          body = await f.chats.rename(actor, c.chat, c.body, selected);
          break;
        case "delete":
          body = await f.chats.remove(actor, c.chat, selected);
          break;
        case "restore":
          body = await f.chats.restore(actor, c.chat, selected);
          break;
        case "send":
          body = await f.chats.send(actor, c.chat, c.body, selected);
          break;
        case "stop":
          body = await f.chats.stop(actor, c.chat, selected);
          break;
        case "finish": {
          const turn = await f.turn(c.turn);
          body = await f.chats.finish(turn.id, {
            state: c.state,
            ...(Object.hasOwn(c, "text") ? { text: c.text } : {}),
            error: c.error,
            reason: c.reason,
            usage: c.usageBig ? { total_tokens: BigInt(c.usageBig) } : c.usage,
          });
          break;
        }
        case "mutate": {
          if ("configured" in c)
            await f.reset(
              c.configured
                ? {
                    deepseek: "sk-fixture-native-chat",
                    openai: "sk-fixture-native-chat",
                  }
                : {},
            );
          if ("flag" in c)
            await f.db.query(
              "UPDATE studio_policy SET flags=jsonb_set(flags,'{deepseek-flash}',$1)",
              [JSON.stringify(c.flag)],
            );
          if ("price" in c)
            await f.db.query(
              "UPDATE studio_prices SET amount=$1 WHERE key='deepseek-flash|reply'",
              [c.price],
            );
          if ("balance" in c)
            await f.db.query(
              "UPDATE wallets SET balance=$1 WHERE workspace_id=$2",
              [c.balance, f.workspace.id],
            );
          if ("canvasText" in c)
            await f.db.query(
              "UPDATE documents SET body=$2,revision=revision+1 WHERE public_id=$1",
              [
                data.canvas,
                JSON.stringify({
                  legacyDocument: {
                    schemaVersion: 1,
                    nodes: [{ ...data.node, text: c.canvasText }],
                    edges: [],
                  },
                }),
              ],
            );
          if ("teamMember" in c) {
            if (c.teamMember)
              await f.db.query(
                "INSERT INTO members(workspace_id,user_id) SELECT id,$1 FROM workspaces WHERE public_id=1 ON CONFLICT DO NOTHING",
                [f.member.id],
              );
            else
              await f.db.query(
                "DELETE FROM members WHERE workspace_id=(SELECT id FROM workspaces WHERE public_id=1) AND user_id=$1",
                [f.member.id],
              );
          }
          body = { ok: true };
          break;
        }
        default:
          throw new Error("Unknown fixture action");
      }
      actual = { status: 200, body };
    } catch (error) {
      actual =
        error instanceof ValidationError
          ? { status: 422, body: { detail: error.detail } }
          : error instanceof DomainError
            ? { status: error.status, body: { detail: error.message } }
            : { status: 500, body: "Internal Server Error" };
    }
    await refresh();
    try {
      assert.deepEqual(
        normalize(actual),
        source.expected,
        c.name + " response",
      );
      assert.deepEqual(await storage(), source.storage, c.name + " storage");
    } catch (error) {
      failures.push({ name: c.name, error: String(error).slice(0, 5000) });
    }
  }
  await mkdir(".runtime-advanced/chat-storage-parity", { recursive: true });
  const report = {
    passed: !failures.length,
    scenarios: data.cases.length,
    failures,
  };
  await writeFile(
    ".runtime-advanced/chat-storage-parity/report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  assert.equal(failures.length, 0, JSON.stringify(failures, null, 2));
  console.log("Original chat storage parity: " + JSON.stringify(report));
} finally {
  await f?.cleanup();
  await rm(directory, { recursive: true, force: true });
}
