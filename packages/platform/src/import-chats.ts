import { z } from "zod";
import { requireValue } from "./security.js";
import type { Sql } from "./db.js";
import { chatBytes } from "./chat-values.js";
import { pythonJsonText } from "@fumiao/plugin-sdk/json.js";

const number = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const hex = z.string().regex(/^[a-f0-9]{32}$/);
const flag = z.union([z.literal(0), z.literal(1)]);
const time = z.number().finite();
const terminal = z.enum(["complete", "failed", "stopped", "interrupted"]);
const text = z.string().refine((value) => {
  try {
    chatBytes(value);
    return true;
  } catch {
    return false;
  }
}, "Invalid UTF-8 text");
const plain = text.refine(
  (value) => !value.includes("\0"),
  "Invalid PostgreSQL text",
);
const conversationSchema = z
  .object({
    id: hex,
    original_order: number,
    workspace: number,
    owner: number,
    title: text,
    custom_title: flag,
    model: plain,
    created: time,
    updated: time,
    revision: number.max(2147483647),
    deleted_at: time.nullable(),
  })
  .strict();
const messageSchema = z
  .object({
    id: number,
    conversation: hex,
    role: z.enum(["user", "assistant"]),
    author: number.nullable(),
    content: text,
    state: terminal,
    model: plain,
    created: time,
    context: plain,
    reply_to: number.nullable(),
    superseded: flag,
  })
  .strict();
const turnSchema = z
  .object({
    id: hex,
    uid: z.string().regex(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/),
    conversation: hex,
    owner: number,
    user_message: number,
    assistant_message: number,
    model: plain,
    state: terminal,
    created: time,
    started: time.nullable(),
    first_token: time.nullable(),
    finished: time.nullable(),
    updated: time,
    usage: plain,
    error: text,
    request_id: text,
    finish_reason: text,
  })
  .strict();
const chargeSchema = z
  .object({
    turn: hex,
    workspace: number,
    owner: number,
    amount: number,
    price_key: plain,
    price_revision: number.max(2147483647),
    state: z.enum(["spent", "refunded"]),
    created: z.number().int().safe(),
  })
  .strict();
const linkSchema = z
  .object({ project: hex, node: plain, conversation: hex, created: time })
  .strict();
const applicationSchema = z
  .object({
    uid: z.string().regex(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/),
    owner: number,
    conversation: hex,
    message: number,
    project: hex,
    node: plain,
    mode: z.enum(["new", "replace"]),
    created: time,
  })
  .strict();
export const chatCollections = new Set([
  "conversations",
  "chat_messages",
  "chat_turns",
  "credit_chat_charges",
  "canvas_chat_links",
  "chat_applications",
]);
const schemas = {
  conversations: conversationSchema,
  chat_messages: messageSchema,
  chat_turns: turnSchema,
  credit_chat_charges: chargeSchema,
  canvas_chat_links: linkSchema,
  chat_applications: applicationSchema,
};
export function validateChatImport(
  tables: Record<string, Record<string, any>[]>,
  version?: number,
) {
  requireValue(
    version === undefined || version === 1,
    400,
    "旧对话导出版本无效",
  );
  const present =
    [...chatCollections].some((name) => (tables[name]?.length ?? 0) > 0) ||
    (tables.credit_ledger ?? []).some((r) => r.chat_turn != null);
  requireValue(
    !present || version === 1,
    400,
    "导出文件缺少完整对话历史，请重新导出",
  );
  if (version === 1)
    requireValue(
      [...chatCollections].every((name) => Array.isArray(tables[name])),
      400,
      "导出文件缺少完整对话表，请重新导出",
    );
  const parsed = Object.fromEntries(
    Object.entries(schemas).map(([name, schema]) => {
      const result = z.array(schema).safeParse(tables[name] ?? []);
      requireValue(result.success, 400, "旧对话记录无效：" + name);
      return [name, result.data];
    }),
  ) as { [K in keyof typeof schemas]: z.infer<(typeof schemas)[K]>[] };
  const index = <T>(
    rows: T[],
    key: (v: T) => string | number,
    label: string,
  ) => {
    const map = new Map(rows.map((row) => [key(row), row]));
    requireValue(map.size === rows.length, 400, "旧对话编号重复：" + label);
    return map;
  };
  const chats = index(parsed.conversations, (c) => c.id, "conversation"),
    messages = index(parsed.chat_messages, (m) => m.id, "message"),
    turns = index(parsed.chat_turns, (t) => t.id, "turn");
  index(parsed.conversations, (c) => c.original_order, "conversation order");
  index(parsed.chat_turns, (t) => t.uid, "turn uid");
  index(parsed.chat_turns, (t) => t.assistant_message, "turn assistant");
  index(parsed.credit_chat_charges, (c) => c.turn, "charge");
  index(parsed.chat_applications, (a) => a.uid, "application");
  index(
    parsed.canvas_chat_links,
    (l) => JSON.stringify([l.project, l.node, l.conversation]),
    "canvas link",
  );
  const users = new Set((tables.users ?? []).map((u) => u.id)),
    workspaces = new Map((tables.workspaces ?? []).map((w) => [w.id, w])),
    canvases = new Map((tables.canvas_projects ?? []).map((c) => [c.id, c]));
  const requireChat = (key: string) => {
    const c = chats.get(key);
    requireValue(c, 400, "旧对话关联不存在");
    return c;
  };
  for (const c of parsed.conversations) {
    const w = workspaces.get(c.workspace);
    requireValue(
      users.has(c.owner) && w && (w.kind !== "personal" || w.owner === c.owner),
      400,
      "旧对话空间或创建者无效",
    );
  }
  const assistantTurns = new Map(
    parsed.chat_turns.map((t) => [t.assistant_message, t]),
  );
  for (const m of parsed.chat_messages) {
    requireChat(m.conversation);
    requireValue(
      m.author === null || users.has(m.author),
      400,
      "旧消息作者不存在",
    );
    let context: unknown;
    try {
      context = pythonJsonText(m.context);
    } catch {
      requireValue(false, 400, "旧消息上下文无效");
    }
    requireValue(
      context !== null &&
        typeof context === "object" &&
        !Array.isArray(context),
      400,
      "旧消息上下文无效",
    );
    const reply = m.reply_to === null ? undefined : messages.get(m.reply_to);
    if (m.role === "user")
      requireValue(
        m.state === "complete" &&
          m.author !== null &&
          m.reply_to === null &&
          m.superseded === 0,
        400,
        "旧用户消息无效",
      );
    else
      requireValue(
        m.author === null &&
          reply?.role === "user" &&
          reply.conversation === m.conversation &&
          reply.id < m.id &&
          assistantTurns.has(m.id),
        400,
        "旧回复关联无效",
      );
  }
  for (const t of parsed.chat_turns) {
    const c = requireChat(t.conversation),
      user = messages.get(t.user_message),
      assistant = messages.get(t.assistant_message);
    requireValue(
      users.has(t.owner) &&
        (workspaces.get(c.workspace)?.kind !== "personal" ||
          c.owner === t.owner),
      400,
      "旧对话轮次归属无效",
    );
    requireValue(
      user?.role === "user" &&
        assistant?.role === "assistant" &&
        user.conversation === c.id &&
        assistant.conversation === c.id &&
        assistant.reply_to === user.id &&
        assistant.model === t.model &&
        assistant.state === t.state &&
        t.finished !== null,
      400,
      "旧对话轮次与消息不一致",
    );
    let usage: unknown;
    try {
      usage = pythonJsonText(t.usage);
    } catch {
      requireValue(false, 400, "旧对话用量无效");
    }
    requireValue(
      usage !== null && typeof usage === "object" && !Array.isArray(usage),
      400,
      "旧对话用量无效",
    );
  }
  requireValue(
    parsed.credit_chat_charges.length === turns.size,
    409,
    "旧对话费用记录不完整",
  );
  const ledger = tables.credit_ledger ?? [];
  const accounts = new Set(
    (tables.credit_accounts ?? []).map((a) => a.workspace),
  );
  const ledgers = new Map<string, Record<string, any>[]>();
  for (const entry of ledger)
    if (entry.chat_turn != null) {
      const rows = ledgers.get(entry.chat_turn) ?? [];
      rows.push(entry);
      ledgers.set(entry.chat_turn, rows);
    }
  for (const charge of parsed.credit_chat_charges) {
    const t = turns.get(charge.turn),
      c = t && requireChat(t.conversation);
    requireValue(
      t &&
        c &&
        charge.owner === t.owner &&
        charge.workspace === c.workspace &&
        accounts.has(charge.workspace) &&
        charge.price_key === t.model + "|reply" &&
        charge.state === (t.state === "complete" ? "spent" : "refunded"),
      409,
      "旧对话费用与轮次不一致",
    );
    const entries = ledgers.get(t.id) ?? [];
    requireValue(
      entries.length === 2 &&
        entries.every(
          (l) =>
            l.workspace === charge.workspace &&
            l.actor === charge.owner &&
            l.amount === charge.amount &&
            l.job == null,
        ) &&
        entries.filter((l) => l.action === "reserve").length === 1 &&
        entries.filter(
          (l) => l.action === (charge.state === "spent" ? "spend" : "refund"),
        ).length === 1,
      409,
      "旧对话账本与费用不一致",
    );
  }
  requireValue(
    ledger.every((l) => l.chat_turn == null || turns.has(l.chat_turn)),
    409,
    "旧对话账本关联不存在",
  );
  for (const link of parsed.canvas_chat_links) {
    const c = requireChat(link.conversation),
      canvas = canvases.get(link.project);
    requireValue(
      canvas && canvas.workspace === c.workspace,
      400,
      "旧对话画布链接无效",
    );
    // A removed node can retain conversation history; do not require it to exist.
  }
  for (const a of parsed.chat_applications) {
    const c = requireChat(a.conversation),
      m = messages.get(a.message),
      canvas = canvases.get(a.project);
    requireValue(
      users.has(a.owner) &&
        (workspaces.get(c.workspace)?.kind !== "personal" ||
          c.owner === a.owner) &&
        m?.conversation === c.id &&
        m.role === "assistant" &&
        m.state === "complete" &&
        (!canvas || canvas.workspace === c.workspace),
      400,
      "旧对话采用记录无效",
    );
  }
  return parsed;
}
export type ChatImport = ReturnType<typeof validateChatImport>;
export async function importChats(
  sql: Sql,
  source: string,
  data: ChatImport,
  canvases: Record<string, any>[],
  id: (kind: string, value: unknown) => string,
) {
  const spaces = new Map(data.conversations.map((c) => [c.id, c.workspace]));
  for (const c of [...data.conversations].sort(
    (a, b) => a.original_order - b.original_order,
  )) {
    await sql.query(
      `INSERT INTO chat_conversations(id,public_id,ordinal,workspace_id,owner_id,title,custom_title,model,created,updated,revision,deleted_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        id("chat", c.id),
        c.id,
        c.original_order,
        id("workspace", c.workspace),
        id("user", c.owner),
        chatBytes(c.title),
        !!c.custom_title,
        c.model,
        c.created,
        c.updated,
        c.revision,
        c.deleted_at,
      ],
    );
    await sql.query(
      "INSERT INTO import_records(source,kind,legacy_id,target_id) VALUES($1,'chat',$2,$3)",
      [source, c.id, id("chat", c.id)],
    );
  }
  for (const m of [...data.chat_messages].sort((a, b) => a.id - b.id))
    await sql.query(
      `INSERT INTO chat_messages(id,public_id,conversation_id,role,author_id,content,state,model,created,context,reply_to,superseded)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        id("chat-message", m.id),
        m.id,
        id("chat", m.conversation),
        m.role,
        m.author === null ? null : id("user", m.author),
        chatBytes(m.content),
        m.state,
        m.model,
        m.created,
        m.context,
        m.reply_to === null ? null : id("chat-message", m.reply_to),
        !!m.superseded,
      ],
    );
  for (const t of data.chat_turns)
    await sql.query(
      `INSERT INTO chat_turns(id,public_id,uid,conversation_id,owner_id,user_message,assistant_message,model,state,created,started,first_token,finished,updated,usage,error,request_id,finish_reason)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        id("chat-turn", t.id),
        t.id,
        t.uid,
        id("chat", t.conversation),
        id("user", t.owner),
        id("chat-message", t.user_message),
        id("chat-message", t.assistant_message),
        t.model,
        t.state,
        t.created,
        t.started,
        t.first_token,
        t.finished,
        t.updated,
        t.usage,
        chatBytes(t.error),
        chatBytes(t.request_id),
        chatBytes(t.finish_reason),
      ],
    );
  for (const c of data.credit_chat_charges)
    await sql.query(
      `INSERT INTO chat_charges(turn_id,workspace_id,owner_id,amount,price_key,price_revision,state,created) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id("chat-turn", c.turn),
        id("workspace", c.workspace),
        id("user", c.owner),
        c.amount,
        c.price_key,
        c.price_revision,
        c.state,
        c.created,
      ],
    );
  for (const l of data.canvas_chat_links)
    await sql.query(
      "INSERT INTO canvas_chat_links(project_id,node,conversation_id,created) VALUES($1,$2,$3,$4)",
      [id("canvas", l.project), l.node, id("chat", l.conversation), l.created],
    );
  const canvasIds = new Set(canvases.map((c) => c.id));
  for (const a of data.chat_applications)
    await sql.query(
      `INSERT INTO chat_applications(uid,owner_id,conversation_id,message_id,project_id,project_public_id,node,mode,created) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        a.uid,
        id("user", a.owner),
        id("chat", a.conversation),
        id("chat-message", a.message),
        canvasIds.has(a.project) ? id("canvas", a.project) : null,
        a.project,
        a.node,
        a.mode,
        a.created,
      ],
    );
  for (const [table, field] of [
    ["chat_conversations", "ordinal"],
    ["chat_messages", "public_id"],
  ])
    await sql.query(
      `SELECT setval(pg_get_serial_sequence('${table}','${field}'),GREATEST(COALESCE((SELECT max(${field}) FROM ${table}),0),1),EXISTS(SELECT 1 FROM ${table}))`,
    );
  const turnMap = new Map(data.chat_turns.map((t) => [t.id, t]));
  for (const [collection, records] of Object.entries(data))
    for (const [index, record] of records.entries()) {
      const row = record as Record<string, any>,
        turn =
          collection === "credit_chat_charges"
            ? turnMap.get(row.turn)
            : undefined;
      const workspace =
        row.workspace ?? spaces.get(row.conversation ?? turn?.conversation);
      await sql.query(
        "INSERT INTO legacy_chat_records(source,collection,legacy_id,workspace_id,payload) VALUES($1,$2,$3,$4,$5)",
        [
          source,
          collection,
          String(row.id ?? row.uid ?? row.turn ?? index),
          id("workspace", workspace),
          chatBytes(JSON.stringify(row)),
        ],
      );
    }
}
