import { ChatReplyError } from "@fumiao/plugin-sdk/chat.js";
import type {
  ChatTool,
  ModelTool,
  ToolCall,
  ToolFragment,
} from "@fumiao/plugin-sdk/chat-tools.js";
import {
  packageContributions,
  type ResolvedContributions,
} from "@fumiao/plugin-sdk/contributions.js";
import { hash, requireValue } from "@fumiao/platform/security.js";
import { one, type Sql } from "@fumiao/platform/db.js";
import { PluginHost } from "@fumiao/platform/plugin-host.js";
import { PluginMedia } from "@fumiao/platform/plugin-media.js";
import { runProgram } from "@fumiao/platform/plugin-program.js";
import type { Actor } from "@fumiao/platform/platform.js";
import type { ChatExecution } from "./chat-execution.js";
import { toolArguments } from "@fumiao/plugin-sdk/chat-tools.js";

export async function freezeChatTools(sql: Sql, turnId: string, role: string) {
  const inserted = await sql.query(
    `INSERT INTO chat_turn_tools(turn_id,plugin_id,package_version,tool_id)
     SELECT $1,p.id,p.version,t->>'id' FROM studio_packages p JOIN studio_package_releases r USING(id,version)
     CROSS JOIN LATERAL jsonb_array_elements(r.package->'contributes'->'chatTools') t
     WHERE p.installed AND p.enabled AND NOT p.removing AND ($2='admin' OR coalesce(t->>'audience','member')='member')
     RETURNING tool_id`,
    [turnId, role],
  );
  requireValue(
    inserted.rows.length <= 128,
    409,
    "已启用的对话工具过多，请管理员调整插件",
  );
}

type FrozenTool = {
  plugin: string;
  version: string;
  grants: ResolvedContributions;
  declaration: ChatTool;
  model: ModelTool;
};
export async function turnTools(sql: Sql, id: string) {
  const { rows } = await sql.query(
    `SELECT t.plugin_id,t.package_version,array_agg(t.tool_id ORDER BY t.tool_id) AS ids,
    r.package->'contributes' AS contributes FROM chat_turn_tools t JOIN studio_package_releases r
    ON (r.id,r.version)=(t.plugin_id,t.package_version) WHERE t.turn_id=$1
    GROUP BY t.plugin_id,t.package_version,r.id,r.version ORDER BY t.plugin_id`,
    [id],
  );
  const tools = new Map<string, FrozenTool>();
  for (const row of rows) {
    const grants = packageContributions(row);
    for (const declaration of grants.chatTools ?? []) {
      if (!row.ids.includes(declaration.id)) continue;
      const name =
        "fm_" +
        declaration.id.replaceAll("-", "_") +
        "_" +
        hash(row.plugin_id + "/" + declaration.id).slice(0, 16);
      tools.set(name, {
        plugin: row.plugin_id,
        version: row.package_version,
        grants,
        declaration,
        model: {
          type: "function",
          function: {
            name,
            description: declaration.description,
            parameters: declaration.parameters,
          },
        },
      });
    }
  }
  return tools;
}

export class ChatToolCalls {
  readonly calls = new Map<number, ToolCall>();
  append(fragments: ToolFragment[]) {
    for (const fragment of fragments) {
      const call = this.calls.get(fragment.index) ?? {
        id: "",
        type: "function",
        function: { name: "", arguments: "" },
      };
      call.id += fragment.id ?? "";
      call.function.name += fragment.function?.name ?? "";
      call.function.arguments += fragment.function?.arguments ?? "";
      if (
        call.id.length > 128 ||
        call.function.name.length > 64 ||
        Buffer.byteLength(call.function.arguments) > 16384
      )
        throw new ChatReplyError("模型返回的工具调用过长");
      this.calls.set(fragment.index, call);
    }
  }
  prepare(tools: Map<string, FrozenTool>, used: Set<string>) {
    const ordered = [];
    for (let index = 0; index < this.calls.size; index++) {
      const call = this.calls.get(index);
      const tool = call && tools.get(call.function.name);
      if (
        !call ||
        !tool ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(call.id) ||
        used.has(call.id)
      )
        throw new ChatReplyError("模型请求了无效或重复的对话工具调用");
      let args;
      try {
        args = toolArguments(
          tool.declaration.parameters,
          JSON.parse(call.function.arguments),
        );
      } catch {
        throw new ChatReplyError("模型返回的对话工具参数无效");
      }
      used.add(call.id);
      ordered.push({ tool, call, args });
    }
    if (!ordered.length || used.size > 8)
      throw new ChatReplyError("对话工具调用数量无效或超出限制");
    return ordered;
  }
}

export async function executeChatTool(
  store: ChatExecution,
  id: string,
  lease: string,
  tool: FrozenTool,
  call: ToolCall,
  args: Record<string, unknown>,
  signal: AbortSignal,
) {
  const media = new PluginMedia(store.p.storage);
  let audit: ((sql: Sql, outcome: string) => Promise<unknown>) | undefined;
  try {
    return await store.p.db.transaction(async (sql) => {
      signal.throwIfAborted();
      const turn = await one(
        sql,
        `SELECT t.owner_id,c.workspace_id,w.public_id AS workspace_number
        FROM chat_turns t JOIN chat_conversations c ON c.id=t.conversation_id JOIN workspaces w ON w.id=c.workspace_id
        WHERE t.id=$1 AND t.lease_token=$2 AND t.lease_until>$3 AND t.state='running' AND c.deleted_at IS NULL FOR UPDATE OF t`,
        [id, lease, store.chats.clock()],
      );
      if (!turn) throw new ChatReplyError("这次对话已停止");
      const actor = (await one(
        sql,
        "SELECT id,name,nickname,role FROM users WHERE id=$1 AND active AND deleted_at IS NULL FOR SHARE",
        [turn.owner_id],
      )) as Actor | undefined;
      if (
        !actor ||
        (tool.declaration.audience === "admin" && actor.role !== "admin")
      )
        throw new ChatReplyError("当前账号无法运行此对话工具");
      await store.chats.identity.requireWorkspace(
        sql,
        actor,
        turn.workspace_number,
      );
      const host = new PluginHost(
        sql,
        {
          pluginId: tool.plugin,
          workspace: turn.workspace_id,
          contributions: tool.grants,
          mode: "write",
          scopes: ["workspace"],
        },
        undefined,
        { session: media, actor: actor.id },
      );
      audit = (db, outcome) =>
        db.query(
          `INSERT INTO studio_plugin_audit(plugin_id,package_version,page_id,action_id,kind,actor_id,workspace_id,target,outcome,detail)
        VALUES($1,$2,'chat',$3,'program',$4,$5,$6,$7,$8)`,
          [
            tool.plugin,
            tool.version,
            tool.declaration.id,
            actor.id,
            turn.workspace_id,
            id,
            outcome,
            host.summary(),
          ],
        );
      const result = await runProgram(
        tool.declaration.program,
        "run",
        [args, { callId: call.id, turn: id }],
        host.granted,
        (name, argv, inner) =>
          host.call(name, argv, AbortSignal.any([signal, inner])),
      );
      signal.throwIfAborted();
      if (
        !(await one(
          sql,
          "SELECT 1 FROM chat_turns WHERE id=$1 AND lease_until>$2",
          [id, store.chats.clock()],
        ))
      )
        throw new ChatReplyError("这次对话已停止");
      if (typeof result !== "string" || Buffer.byteLength(result) > 16384)
        throw new ChatReplyError("对话工具返回内容无效或过长");
      await audit(sql, "succeeded");
      return result;
    });
  } catch (error) {
    await media.rollback();
    if (audit) await audit(store.p.db, "failed");
    if (error instanceof ChatReplyError) throw error;
    throw new ChatReplyError(
      "对话工具「" + tool.declaration.title + "」未能完成",
    );
  }
}
