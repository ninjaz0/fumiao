import { pythonStrip } from "@fumiao/plugin-sdk/python-values.js";
import {
  chatContext,
  type ChatContextRow,
} from "@fumiao/platform/chat-context.js";
import { chatText, chatJson } from "@fumiao/platform/chat-values.js";
import { creditUnits, formatCredits } from "@fumiao/platform/credit-amount.js";
import { one, type Sql } from "@fumiao/platform/db.js";
import {
  chatLimit,
  type ChatPrice,
} from "@fumiao/platform/model-access/chat.js";
import { resolveConnectionRevision } from "@fumiao/platform/model-access/connections.js";
import {
  routeScopeAllows,
  type FrozenModelRoute,
} from "@fumiao/platform/model-access/publication.js";
import type { Actor, Platform } from "@fumiao/platform/platform.js";
import { hash, requireValue } from "@fumiao/platform/security.js";
import { availableChatTools, type FrozenTool } from "./chat-tools.js";
import { loadActiveWorkspaceSkills } from "./skills.js";

export type NativeChatSnapshot = {
  route: FrozenModelRoute & { price: ChatPrice };
  messages: ReturnType<typeof chatContext>;
  project: string | null;
  requestHash?: string;
  max_charge: string;
  max_output_tokens: number;
};
export async function retryTarget(sql: Sql, chatId: string, retry: number) {
  const last = await one(
    sql,
    "SELECT * FROM chat_messages WHERE conversation_id=$1 AND NOT superseded ORDER BY public_id DESC LIMIT 1",
    [chatId],
  );
  requireValue(
    last &&
      Number(last.public_id) === retry &&
      last.role === "assistant" &&
      ["failed", "stopped", "interrupted"].includes(last.state),
    409,
    "只能重试最后一条未完成的回复",
  );
  return last;
}
export async function prepareNativeChat(
  p: Platform,
  sql: Sql,
  actor: Actor,
  workspace: string,
  chatId: string | null,
  body: { text: string; retry: number | null },
  context: Record<string, any>,
  route: FrozenModelRoute,
  wallet: { balance: string; held: string },
  policyRevision: number,
) {
  requireValue(
    route.price.kind === "chat" && route.protocol === "openai-chat",
    409,
    "当前线路不支持对话",
  );
  const client = await resolveConnectionRevision(
    sql,
    p,
    route.connectionRevisionId,
  );
  requireValue(
    routeScopeAllows(client.scope, route.protocol, route.upstreamId),
    403,
    "凭据未授权此模型",
  );
  const target = body.retry
    ? await retryTarget(sql, chatId!, body.retry)
    : null;
  const records = chatId
    ? (
        await sql.query(
          `SELECT role,content,state,context FROM chat_messages
    WHERE conversation_id=$1 AND NOT superseded AND ($2::uuid IS NULL OR public_id <= (SELECT public_id FROM chat_messages WHERE id=$2))
    ORDER BY public_id`,
          [chatId, target?.reply_to ?? null],
        )
      ).rows
    : [];
  const rows: ChatContextRow[] = records.map((r) => ({
    role: r.role,
    content: chatText(r.content),
    state: r.state,
    context: r.context,
  }));
  if (!target) {
    requireValue(pythonStrip(body.text), 400, "请输入消息");
    rows.push({
      role: "user",
      content: pythonStrip(body.text),
      state: "complete",
      context: chatJson(context, false),
    });
  }
  const lastContext = [...rows]
    .reverse()
    .find((r) => r.role === "user" && JSON.parse(r.context).project);
  const project: string | null =
    (lastContext ? JSON.parse(lastContext.context).project : null) ??
    (chatId
      ? (
          await one(
            sql,
            `SELECT d.public_id FROM canvas_chat_links l JOIN documents d ON d.id=l.project_id AND NOT d.deleted
    WHERE l.conversation_id=$1 ORDER BY l.created DESC LIMIT 1`,
            [chatId],
          )
        )?.public_id
      : null) ??
    null;
  const skills = await loadActiveWorkspaceSkills(sql, workspace);
  const messages = chatContext(rows, skills);
  const tools =
    (route.capabilities.tools ?? route.capabilities.names?.includes("tools"))
      ? await availableChatTools(sql, actor.role, project)
      : new Map<string, FrozenTool>();
  const definitions = [...tools.values()].map((t) => t.model);
  const limits = chatLimit(
    route.price,
    route.capabilities,
    messages,
    definitions,
    creditUnits(String(wallet.balance)) - creditUnits(String(wallet.held)),
  );
  requireValue(
    limits.max_output_tokens > 0,
    409,
    "当前可用积分或模型上下文不足以生成回复",
  );
  const snapshot: NativeChatSnapshot = {
    route: { ...route, price: route.price },
    messages,
    project,
    ...limits,
  };
  const quote = {
    ...limits,
    price_revision: route.priceRevisionId,
    route_revision: route.routeRevisionId,
    quote_context: hash(
      JSON.stringify([
        actor.id,
        workspace,
        policyRevision,
        project,
        context,
        body.retry,
        messages,
        skills,
        [...tools.values()].map((t) => [t.plugin, t.version, t.model]),
      ]),
    ),
  };
  return { snapshot, quote, tools, skills };
}

export async function readChatBills(
  sql: Sql,
  chatId: string,
  message?: number,
) {
  const { rows } = await sql.query(
    `SELECT t.public_id AS turn,t.route_revision_id,t.price_revision_id,m.public_id AS message,r.public_id AS user_message,m.superseded,t.state,t.usage,
    c.amount AS held,c.state AS charge_state,b.bill,l.amount AS spent
    FROM chat_turns t JOIN chat_conversations conv ON conv.id=t.conversation_id JOIN chat_messages m ON m.id=t.assistant_message JOIN chat_messages r ON r.id=t.user_message
    LEFT JOIN chat_charges c ON c.turn_id=t.id LEFT JOIN chat_turn_bills b ON b.turn_id=t.id
    LEFT JOIN LATERAL (SELECT SUM(ABS(amount)) AS amount FROM ledger WHERE b.turn_id IS NULL AND (chat_turn_id=t.id OR (chat_turn_id IS NULL AND original_chat_turn=t.public_id)) AND workspace_id=conv.workspace_id AND action='spend') l ON true
    WHERE t.conversation_id=$1 AND t.state<>'running' AND ($2::bigint IS NULL OR m.public_id=$2) ORDER BY m.public_id`,
    [chatId, message ?? null],
  );
  return {
    bills: rows.map((r) => ({
      turn: r.turn,
      route_revision: r.route_revision_id,
      price_revision: r.price_revision_id,
      message: Number(r.message),
      user_message: Number(r.user_message),
      superseded: r.superseded,
      ...(r.bill ?? {
        kind: "fixed",
        state: r.state,
        held:
          r.held == null ? null : formatCredits(creditUnits(String(r.held))),
        charged:
          r.spent != null
            ? formatCredits(creditUnits(String(r.spent)))
            : r.charge_state === "spent"
              ? formatCredits(creditUnits(String(r.held)))
              : r.charge_state === "refunded"
                ? "0"
                : null,
        usage: r.usage && r.usage !== "{}" ? r.usage : null,
      }),
    })),
  };
}
