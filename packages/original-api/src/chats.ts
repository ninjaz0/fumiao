import { listedStudioCatalog } from "../../platform/src/studio-plugin-profile.js";
import { randomUUID } from "node:crypto";
import type { Actor, Platform } from "../../platform/src/platform.js";
import { one, type Sql } from "../../platform/src/db.js";
import { requireValue } from "../../platform/src/security.js";
import { StudioCatalog } from "../../platform/src/catalog.js";
import { ChatProviders } from "../../platform/src/chat-providers.js";
import {
  chatBytes,
  chatText,
  chatJson,
} from "../../platform/src/chat-values.js";
import {
  pythonStrip,
  pythonWhitespace,
} from "../../plugin-sdk/src/python-values.js";
import { OriginalIdentity } from "./identity.js";
import { OriginalLibrary } from "./library.js";
import { parseBody } from "./validation.js";
import {
  chatCreateFields,
  chatRenameFields,
  parseChatSend,
  type ChatContextInput,
} from "./chat-draft.js";
import { chatCanvasContext } from "./chat-canvas.js";
export type ChatFinish = {
  state: "complete" | "failed" | "stopped" | "interrupted";
  text?: string;
  error?: string;
  usage?: Record<string, number | bigint>;
  reason?: string;
};
/** Independent original conversations, sharing only identity, policy and the wallet.
 * This service never dispatches provider I/O and never touches SQLite/media jobs. */
export class OriginalChats {
  readonly identity: OriginalIdentity;
  constructor(
    readonly p: Platform,
    readonly clock = () => Date.now() / 1000,
  ) {
    this.identity = new OriginalIdentity(p);
  }
  private async models(sql: Sql) {
    return (
      await sql.query(
        `SELECT id,descriptor FROM ${await listedStudioCatalog(sql)} c WHERE descriptor->>'kind'='chat' ORDER BY position,id`,
      )
    ).rows;
  }
  async access(
    sql: Sql,
    actor: Actor,
    key: string,
    workspace: string,
    options: { deleted?: boolean; lock?: boolean } = {},
  ) {
    requireValue(/^[a-f0-9]{32}$/.test(key), 404, "内容不存在或无权访问");
    const row = await one(
      sql,
      `SELECT c.*,w.public_id AS workspace_number,u.public_id AS owner_number FROM chat_conversations c
      JOIN workspaces w ON w.id=c.workspace_id JOIN users u ON u.id=c.owner_id WHERE c.public_id=$1${options.lock ? " FOR UPDATE OF c" : ""}`,
      [key],
    );
    requireValue(row, 404, "内容不存在或无权访问");
    await new OriginalLibrary(this.p).access(
      sql,
      actor,
      { kind: "asset", row },
      workspace,
    );
    requireValue(options.deleted || row.deleted_at === null, 404, "对话已删除");
    return row;
  }
  async publicChat(sql: Sql, row: any, actor: Actor) {
    const active = Object.hasOwn(row, "active_turn")
      ? { public_id: row.active_turn }
      : await one(
          sql,
          "SELECT public_id FROM chat_turns WHERE conversation_id=$1 AND state='running'",
          [row.id],
        );
    return {
      id: row.public_id,
      workspace: Number(row.workspace_number),
      owner: Number(row.owner_number),
      title: chatText(row.title),
      model: row.model,
      created: row.created,
      updated: row.updated,
      revision: row.revision,
      active_turn: active?.public_id ?? null,
      can_delete: actor.id === row.owner_id || actor.role === "admin",
    };
  }
  async snapshot(sql: Sql, row: any, actor: Actor) {
    const records = (
      await sql.query(
        `SELECT m.*,u.public_id AS author_number,COALESCE(NULLIF(u.nickname,''),u.name) AS author_name,r.public_id AS reply_number,
      t.public_id AS turn_number,t.error,t.usage,t.started,t.finished,t.finish_reason FROM chat_messages m
      LEFT JOIN users u ON u.id=m.author_id LEFT JOIN chat_messages r ON r.id=m.reply_to LEFT JOIN chat_turns t ON t.assistant_message=m.id
      WHERE m.conversation_id=$1 AND NOT m.superseded ORDER BY m.public_id`,
        [row.id],
      )
    ).rows;
    return {
      conversation: await this.publicChat(sql, row, actor),
      messages: records.map((m) => ({
        id: Number(m.public_id),
        role: m.role,
        content: chatText(m.content),
        state: m.state,
        model: m.model,
        created: m.created,
        author: m.author_number === null ? null : Number(m.author_number),
        context: m.context,
        reply_to: m.reply_number === null ? null : Number(m.reply_number),
        author_name: m.author_name,
        turn: m.turn_number,
        error: m.error === null ? null : chatText(m.error),
        usage: m.usage,
        started: m.started,
        finished: m.finished,
        finish_reason:
          m.finish_reason === null ? null : chatText(m.finish_reason),
      })),
    };
  }
  async list(actor: Actor, selected?: string, project = "", node = "") {
    return this.p.db.transaction(async (sql) => {
      await sql.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      const workspace = await this.identity.activeWorkspace(
        sql,
        actor,
        selected,
      );
      if (
        project &&
        (!/^[a-f0-9]{32}$/.test(project) || !/^[A-Za-z0-9_-]{1,80}$/.test(node))
      )
        return { conversations: [] };
      const rows = (
        await sql.query(
          `SELECT c.*,w.public_id AS workspace_number,u.public_id AS owner_number,
        (SELECT t.public_id FROM chat_turns t WHERE t.conversation_id=c.id AND t.state='running') AS active_turn FROM chat_conversations c
        JOIN workspaces w ON w.id=c.workspace_id JOIN users u ON u.id=c.owner_id
        WHERE c.workspace_id=$1 AND c.deleted_at IS NULL AND ($2='' OR EXISTS(SELECT 1 FROM canvas_chat_links l JOIN documents d ON d.id=l.project_id WHERE NOT d.deleted AND l.conversation_id=c.id AND d.public_id=$2 AND l.node=$3))
        ORDER BY c.updated DESC,c.ordinal DESC LIMIT 200`,
          [workspace.id, project, project ? node : ""],
        )
      ).rows;
      return {
        conversations: await Promise.all(
          rows.map((r) => this.publicChat(sql, r, actor)),
        ),
      };
    });
  }
  async get(actor: Actor, key: string, selected?: string) {
    return this.p.db.transaction(async (sql) => {
      await sql.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      const workspace = await this.identity.activeWorkspace(
        sql,
        actor,
        selected,
      );
      return this.snapshot(
        sql,
        await this.access(sql, actor, key, workspace.id),
        actor,
      );
    });
  }
  async requireAccess(actor: Actor, key: string, selected?: string) {
    await this.p.db.transaction(async (sql) => {
      await sql.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      const workspace = await this.identity.activeWorkspace(
        sql,
        actor,
        selected,
      );
      await this.access(sql, actor, key, workspace.id);
    });
  }
  async create(actor: Actor, value: unknown, selected?: string) {
    const body = parseBody(value, chatCreateFields, true);
    return this.p.db.transaction(async (sql) => {
      const models = await this.models(sql),
        model = body.model ?? models[0]?.id;
      requireValue(
        models.some((m) => m.id === model),
        400,
        "未知对话模型",
      );
      const workspace = await this.identity.activeWorkspace(
        sql,
        actor,
        selected,
      );
      await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "chat-create:" + workspace.id,
      ]);
      const context = await chatCanvasContext(
        this.p,
        sql,
        actor,
        workspace.id,
        body.context,
      );
      const count = await one(
        sql,
        "SELECT count(*) FROM chat_conversations WHERE workspace_id=$1 AND deleted_at IS NULL",
        [workspace.id],
      );
      requireValue(
        Number(count.count) < 500,
        409,
        "对话数量已达 500，请先整理旧对话",
      );
      const stamp = this.clock();
      const row = await one(
        sql,
        "INSERT INTO chat_conversations(workspace_id,owner_id,model,created,updated) VALUES($1,$2,$3,$4,$4) RETURNING public_id,id",
        [workspace.id, actor.id, model, stamp],
      );
      if (context.project)
        await sql.query(
          "INSERT INTO canvas_chat_links(project_id,node,conversation_id,created) SELECT id,$2,$3,$4 FROM documents WHERE public_id=$1",
          [context.project, context.node, row.id, stamp],
        );
      return this.snapshot(
        sql,
        await this.access(sql, actor, row.public_id, workspace.id),
        actor,
      );
    });
  }
  async rename(actor: Actor, key: string, value: unknown, selected?: string) {
    const body = parseBody(value, chatRenameFields, true),
      title = pythonStrip(body.title);
    requireValue(title, 400, "请输入对话名称");
    return this.p.db.transaction(async (sql) => {
      const workspace = await this.identity.activeWorkspace(
          sql,
          actor,
          selected,
        ),
        row = await this.access(sql, actor, key, workspace.id, { lock: true });
      requireValue(
        row.revision === body.expected_revision,
        409,
        "对话已更新，请重试",
      );
      await sql.query(
        "UPDATE chat_conversations SET title=$2,custom_title=true,revision=revision+1 WHERE id=$1",
        [row.id, chatBytes(title)],
      );
      return this.snapshot(
        sql,
        await this.access(sql, actor, key, workspace.id),
        actor,
      );
    });
  }
  async remove(actor: Actor, key: string, selected?: string) {
    return this.p.db.transaction(async (sql) => {
      const workspace = await this.identity.activeWorkspace(
        sql,
        actor,
        selected,
      );
      await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "chat-create:" + workspace.id,
      ]);
      const row = await this.access(sql, actor, key, workspace.id, {
        lock: true,
      });
      requireValue(
        row.owner_id === actor.id || actor.role === "admin",
        403,
        "只有创建者或管理员可以删除对话",
      );
      requireValue(
        !(await one(
          sql,
          "SELECT id FROM chat_turns WHERE conversation_id=$1 AND state='running'",
          [row.id],
        )),
        409,
        "请先停止回复，再删除对话",
      );
      await sql.query(
        "UPDATE chat_conversations SET deleted_at=$2,revision=revision+1 WHERE id=$1",
        [row.id, this.clock()],
      );
      return { ok: true };
    });
  }
  async restore(actor: Actor, key: string, selected?: string) {
    return this.p.db.transaction(async (sql) => {
      const workspace = await this.identity.activeWorkspace(
        sql,
        actor,
        selected,
      );
      await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "chat-create:" + workspace.id,
      ]);
      const row = await this.access(sql, actor, key, workspace.id, {
        lock: true,
        deleted: true,
      });
      requireValue(
        row.owner_id === actor.id || actor.role === "admin",
        403,
        "无法恢复对话",
      );
      await sql.query(
        "UPDATE chat_conversations SET deleted_at=NULL,revision=revision+1 WHERE id=$1",
        [row.id],
      );
      return this.snapshot(
        sql,
        await this.access(sql, actor, key, workspace.id),
        actor,
      );
    });
  }
  async send(actor: Actor, key: string, value: unknown, selected?: string) {
    const body = parseChatSend(value);
    return this.p.db.transaction(async (sql) => {
      // Policy -> admission -> conversation -> wallet -> canvas. Match existing
      // catalog/financial lock order; global admission serializes only new turns.
      const global = await one(
        sql,
        "SELECT price_revision FROM studio_policy FOR SHARE",
      );
      await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "chat-admission",
      ]);
      const workspace = await this.identity.activeWorkspace(
          sql,
          actor,
          selected,
        ),
        chat = await this.access(sql, actor, key, workspace.id, { lock: true });
      const previous = await one(
        sql,
        "SELECT t.*,m.content FROM chat_turns t JOIN chat_messages m ON m.id=t.user_message WHERE t.uid=$1",
        [body.uid],
      );
      if (previous) {
        requireValue(
          previous.owner_id === actor.id &&
            previous.conversation_id === chat.id &&
            previous.model === body.model &&
            (body.retry ||
              chatText(previous.content) === pythonStrip(body.text)),
          409,
          "发送标识已使用",
        );
        return this.snapshot(sql, chat, actor);
      }
      requireValue(
        chat.revision === body.expected_revision,
        409,
        "其他成员已更新这段对话，已为你载入最新内容，请再次发送",
      );
      const model = (await this.models(sql)).find((m) => m.id === body.model);
      requireValue(model, 400, "未知对话模型");
      await sql.query("SELECT id FROM workspaces WHERE id=$1 FOR SHARE", [
        workspace.id,
      ]);
      requireValue(
        (await new StudioCatalog(this.p.db).effective(sql, workspace.id))[
          body.model
        ],
        403,
        "当前空间未开放该模型，请选择其他模型",
      );
      const connection = [
        ...(await new ChatProviders(this.p).read(sql, true)).values(),
      ].find((c) => c.provider.models.includes(body.model));
      requireValue(connection, 503, "原对话模型尚未完整启用");
      requireValue(
        connection.configured && connection.row?.enabled !== false,
        409,
        "这个对话服务尚未配置",
      );
      requireValue(
        !(await one(
          sql,
          "SELECT id FROM chat_turns WHERE conversation_id=$1 AND state='running'",
          [chat.id],
        )),
        409,
        "这段对话正在回复，请等待完成",
      );
      requireValue(
        Number(
          (
            await one(
              sql,
              "SELECT count(*) FROM chat_turns WHERE owner_id=$1 AND state='running'",
              [actor.id],
            )
          ).count,
        ) < 3,
        429,
        "最多同时进行 3 段对话",
      );
      requireValue(
        Number(
          (
            await one(
              sql,
              "SELECT count(*) FROM chat_turns WHERE state='running'",
            )
          ).count,
        ) < 20,
        429,
        "对话服务繁忙，请稍后重试",
      );
      requireValue(
        Number(
          (
            await one(
              sql,
              "SELECT count(*) FROM chat_messages WHERE conversation_id=$1",
              [chat.id],
            )
          ).count,
        ) < 1000,
        409,
        "这段对话已很长，请新建对话",
      );
      const stamp = this.clock();
      const wallet = await one(
        sql,
        "SELECT * FROM wallets WHERE workspace_id=$1 FOR UPDATE",
        [workspace.id],
      );
      const context = await chatCanvasContext(
        this.p,
        sql,
        actor,
        workspace.id,
        body.context,
      );
      let userMessage: string;
      if (body.retry) {
        const last = await one(
          sql,
          "SELECT * FROM chat_messages WHERE conversation_id=$1 AND NOT superseded ORDER BY public_id DESC LIMIT 1",
          [chat.id],
        );
        requireValue(
          last &&
            Number(last.public_id) === body.retry &&
            last.role === "assistant" &&
            ["failed", "stopped", "interrupted"].includes(last.state),
          409,
          "只能重试最后一条未完成的回复",
        );
        userMessage = last.reply_to;
        await sql.query(
          "UPDATE chat_messages SET superseded=true WHERE id=$1",
          [last.id],
        );
      } else {
        const text = pythonStrip(body.text);
        requireValue(text, 400, "请输入消息");
        userMessage = (
          await one(
            sql,
            "INSERT INTO chat_messages(conversation_id,role,author_id,content,state,created,context) VALUES($1,'user',$2,$3,'complete',$4,$5) RETURNING id",
            [
              chat.id,
              actor.id,
              chatBytes(text),
              stamp,
              chatJson(context, false),
            ],
          )
        ).id;
      }
      const assistantMessage = (
        await one(
          sql,
          "INSERT INTO chat_messages(conversation_id,role,state,model,created,reply_to) VALUES($1,'assistant','running',$2,$3,$4) RETURNING id",
          [chat.id, body.model, stamp, userMessage],
        )
      ).id;
      const turn = await one(
        sql,
        `INSERT INTO chat_turns(uid,conversation_id,owner_id,user_message,assistant_message,model,state,created,updated,plugin_id,plugin_version,config_snapshot,connection_id)
        VALUES($1,$2,$3,$4,$5,$6,'running',$7,$7,$8,$9,$10,$11) RETURNING *`,
        [
          body.uid,
          chat.id,
          actor.id,
          userMessage,
          assistantMessage,
          body.model,
          stamp,
          connection.plugin.manifest.id,
          connection.plugin.manifest.version,
          this.p.vault.seal(connection.config),
          connection.row?.id ?? null,
        ],
      );
      const priceKey = body.model + "|reply",
        price = await one(
          sql,
          "SELECT amount FROM studio_prices WHERE key=$1",
          [priceKey],
        );
      requireValue(
        price?.amount !== undefined && price.amount !== null,
        409,
        "这个对话模型尚未定价",
      );
      requireValue(
        global.price_revision === body.price_revision,
        409,
        "价格已更新，请确认后重新发送",
      );
      requireValue(wallet, 404, "积分账户不存在");
      const amount = Number(price.amount);
      requireValue(
        Number(wallet.balance) - Number(wallet.held) >= amount,
        409,
        `当前空间积分不足，需要 ${amount} 积分`,
      );
      await sql.query("UPDATE wallets SET held=held+$2 WHERE workspace_id=$1", [
        workspace.id,
        amount,
      ]);
      await sql.query(
        "INSERT INTO chat_charges VALUES($1,$2,$3,$4,$5,$6,'held',$7)",
        [
          turn.id,
          workspace.id,
          actor.id,
          amount,
          priceKey,
          global.price_revision,
          Math.floor(stamp),
        ],
      );
      await this.ledger(
        sql,
        turn,
        workspace.id,
        amount,
        "reserve",
        model.descriptor.label + " 对话",
        stamp,
      );
      await sql.query(
        "INSERT INTO chat_outbox(turn_id,available_at) VALUES($1,$2)",
        [turn.id, stamp],
      );
      const title =
        chat.custom_title || chatText(chat.title) !== "新对话" || body.retry
          ? chat.title
          : chatBytes(
              [
                ...pythonStrip(body.text).replace(
                  new RegExp("[" + pythonWhitespace + "]+", "g"),
                  " ",
                ),
              ]
                .slice(0, 32)
                .join(""),
            );
      await sql.query(
        "UPDATE chat_conversations SET title=$2,model=$3,updated=$4,revision=revision+1 WHERE id=$1",
        [chat.id, title, body.model, stamp],
      );
      return this.snapshot(
        sql,
        await this.access(sql, actor, key, workspace.id),
        actor,
      );
    });
  }
  private async ledger(
    sql: Sql,
    turn: any,
    workspace: string,
    amount: number,
    action: "reserve" | "spend" | "refund",
    note: string,
    stamp: number,
  ) {
    await sql.query(
      `INSERT INTO ledger(id,workspace_id,chat_turn_id,original_chat_turn,actor_id,key,action,amount,balance_snapshot,held_snapshot,note,created_at)
      SELECT $1,$2,$3,$4,$5,$6,$7,$8,balance,held,$9,to_timestamp($10) FROM wallets WHERE workspace_id=$2`,
      [
        randomUUID(),
        workspace,
        turn.id,
        turn.public_id,
        turn.owner_id,
        "chat:" + turn.id + ":" + (action === "reserve" ? "reserve" : "settle"),
        action,
        amount,
        note,
        Math.floor(stamp),
      ],
    );
  }
  /** All terminal paths share this transaction. Optional lease guards reject stale workers. */
  async finishOn(sql: Sql, id: string, value: ChatFinish, lease?: string) {
    let turn = await one(sql, "SELECT * FROM chat_turns WHERE id=$1", [id]);
    if (!turn) return false;
    await sql.query(
      "SELECT id FROM chat_conversations WHERE id=$1 FOR UPDATE",
      [turn.conversation_id],
    );
    turn = await one(sql, "SELECT * FROM chat_turns WHERE id=$1 FOR UPDATE", [
      id,
    ]);
    const stamp = this.clock();
    if (
      turn.state !== "running" ||
      (lease !== undefined &&
        (turn.lease_token !== lease || turn.lease_until <= stamp))
    )
      return false;
    if (value.text !== undefined)
      await sql.query("UPDATE chat_messages SET content=$2 WHERE id=$1", [
        turn.assistant_message,
        chatBytes(value.text),
      ]);
    await sql.query("UPDATE chat_messages SET state=$2 WHERE id=$1", [
      turn.assistant_message,
      value.state,
    ]);
    await sql.query(
      "UPDATE chat_turns SET state=$2,finished=$3,updated=$3,error=$4,usage=$5,finish_reason=$6,lease_token=NULL,lease_until=NULL WHERE id=$1",
      [
        id,
        value.state,
        stamp,
        chatBytes(value.error ?? ""),
        chatJson(value.usage ?? {}),
        chatBytes(value.reason ?? ""),
      ],
    );
    await sql.query(
      "UPDATE chat_conversations SET updated=$2,revision=revision+1 WHERE id=$1",
      [turn.conversation_id, stamp],
    );
    const charge = await one(
      sql,
      "SELECT * FROM chat_charges WHERE turn_id=$1 FOR UPDATE",
      [id],
    );
    if (charge?.state === "held") {
      const success = value.state === "complete",
        amount = Number(charge.amount);
      await sql.query(
        "UPDATE wallets SET balance=balance-$2,held=held-$3 WHERE workspace_id=$1",
        [charge.workspace_id, success ? amount : 0, amount],
      );
      await sql.query("UPDATE chat_charges SET state=$2 WHERE turn_id=$1", [
        id,
        success ? "spent" : "refunded",
      ]);
      await this.ledger(
        sql,
        turn,
        charge.workspace_id,
        amount,
        success ? "spend" : "refund",
        "AI 对话",
        stamp,
      );
    }
    await sql.query("DELETE FROM chat_outbox WHERE turn_id=$1", [id]);
    return true;
  }
  async finish(id: string, value: ChatFinish, lease?: string) {
    return this.p.db.transaction((sql) => this.finishOn(sql, id, value, lease));
  }
  async stop(actor: Actor, key: string, selected?: string) {
    return this.p.db.transaction(async (sql) => {
      const workspace = await this.identity.activeWorkspace(
          sql,
          actor,
          selected,
        ),
        row = await this.access(sql, actor, key, workspace.id, { lock: true });
      const active = await one(
        sql,
        "SELECT id FROM chat_turns WHERE conversation_id=$1 AND state='running'",
        [row.id],
      );
      if (active) await this.finishOn(sql, active.id, { state: "stopped" });
      return this.snapshot(
        sql,
        await this.access(sql, actor, key, workspace.id),
        actor,
      );
    });
  }
}
