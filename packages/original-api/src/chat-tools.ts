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
import { hash, DomainError, requireValue } from "@fumiao/platform/security.js";
import { one, type Sql } from "@fumiao/platform/db.js";
import { PluginHost } from "@fumiao/platform/plugin-host.js";
import { PluginMedia } from "@fumiao/platform/plugin-media.js";
import { runProgram } from "@fumiao/platform/plugin-program.js";
import type { Actor } from "@fumiao/platform/platform.js";
import type { ChatExecution } from "./chat-execution.js";
import type { OriginalActor } from "./identity.js";
import { OriginalCanvasProposals } from "./proposals.js";
import {
  toolArguments,
  appendToolFragments,
} from "@fumiao/plugin-sdk/chat-tools.js";

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

export type FrozenTool = {
  plugin: string;
  version: string;
  grants?: ResolvedContributions;
  builtin?: "read_canvas_graph" | "propose_canvas_changes";
  boundProject?: string;
  declaration: ChatTool;
  model: ModelTool;
};

export async function detectBoundCanvasProject(
  sql: Sql,
  turnId: string,
): Promise<string | null> {
  const row = await one(
    sql,
    `SELECT m.context
       FROM chat_turns t
       JOIN chat_messages m ON m.conversation_id = t.conversation_id
      WHERE t.id = $1 AND NOT m.superseded AND m.role = 'user'
        AND m.context IS NOT NULL AND m.context <> '' AND m.context <> '{}'
      ORDER BY m.public_id DESC
      LIMIT 1`,
    [turnId],
  );
  if (row?.context) {
    try {
      const parsed = JSON.parse(String(row.context)) as { project?: unknown };
      if (
        typeof parsed?.project === "string" &&
        /^[a-f0-9]{32}$/.test(parsed.project)
      ) {
        return parsed.project;
      }
    } catch {
      // Ignore non-JSON contexts.
    }
  }
  const linked = await one(
    sql,
    `SELECT d.public_id
       FROM chat_turns t
       JOIN canvas_chat_links l ON l.conversation_id = t.conversation_id
       JOIN documents d ON d.id = l.project_id AND NOT d.deleted
      WHERE t.id = $1
      ORDER BY l.created DESC
      LIMIT 1`,
    [turnId],
  );
  if (linked?.public_id && /^[a-f0-9]{32}$/.test(String(linked.public_id))) {
    return String(linked.public_id);
  }
  return null;
}

export async function turnTools(sql: Sql, id: string, project?: string | null) {
  const { rows } = await sql.query(
    `SELECT t.plugin_id,t.package_version,array_agg(t.tool_id ORDER BY t.tool_id) AS ids,
    r.package->'contributes' AS contributes FROM chat_turn_tools t JOIN studio_package_releases r
    ON (r.id,r.version)=(t.plugin_id,t.package_version) WHERE t.turn_id=$1
    GROUP BY t.plugin_id,t.package_version,r.id,r.version ORDER BY t.plugin_id`,
    [id],
  );
  return buildTools(
    sql,
    rows,
    project === undefined ? await detectBoundCanvasProject(sql, id) : project,
  );
}

export async function availableChatTools(
  sql: Sql,
  role: string,
  project: string | null,
) {
  const { rows } = await sql.query(
    `SELECT p.id AS plugin_id,p.version AS package_version,
    r.package->'contributes' AS contributes,array_agg(t->>'id' ORDER BY t->>'id') AS ids
    FROM studio_packages p JOIN studio_package_releases r USING(id,version)
    CROSS JOIN LATERAL jsonb_array_elements(r.package->'contributes'->'chatTools') t
    WHERE p.installed AND p.enabled AND NOT p.removing AND ($1='admin' OR coalesce(t->>'audience','member')='member')
    GROUP BY p.id,p.version,r.id,r.version ORDER BY p.id`,
    [role],
  );
  const tools = await buildTools(sql, rows, project);
  requireValue(
    tools.size <= 128,
    409,
    "已启用的对话工具过多，请管理员调整插件",
  );
  return tools;
}

async function buildTools(
  sql: Sql,
  rows: Record<string, any>[],
  boundProject: string | null,
) {
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

  // F018: Mount built-in canvas Agent proposal tools when the chat is bound to a canvas project.
  const hasProposals = boundProject
    ? Boolean(
        (await one(sql, "SELECT to_regclass('canvas_proposals') AS ok"))?.ok,
      )
    : false;
  if (boundProject && hasProposals) {
    const readParams: ChatTool["parameters"] = {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description:
            "画布公开 ID（32位十六进制，缺省默认使用当前对话绑定的画布）",
        },
      },
      additionalProperties: false,
    };
    const proposeParams: ChatTool["parameters"] = {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "画布公开 ID（缺省默认使用当前对话绑定的画布）",
        },
        title: {
          type: "string",
          description: "变更提案标题（如：新增雨夜分镜）",
        },
        summary: {
          type: "string",
          description: "本次画布结构变更与镜头意图说明",
        },
        base_revision: {
          type: "integer",
          description: "基于的画布版本号（用于并发冲突保护，不匹配时返回 409）",
        },
        operations_json: {
          type: "string",
          description:
            "JSON 数组字符串，元素支持 add_node / update_node / remove_node / add_edge / remove_edge / set_shots",
        },
      },
      required: ["title", "operations_json"],
      additionalProperties: false,
    };
    tools.set("fm_read_canvas_graph", {
      plugin: "builtin-canvas-agent",
      version: "1.0.0",
      builtin: "read_canvas_graph",
      boundProject,
      declaration: {
        id: "read-canvas-graph",
        title: "读取画布图结构",
        description:
          "读取当前画布的节点、连线、镜头顺序与版本号，用于生成画布变更提案前获取上下文。",
        audience: "member",
        parameters: readParams,
        program: "builtin",
      },
      model: {
        type: "function",
        function: {
          name: "fm_read_canvas_graph",
          description:
            "读取当前画布的节点、连线、镜头顺序与版本号，用于生成画布变更提案前获取上下文。",
          parameters: readParams,
        },
      },
    });
    tools.set("fm_propose_canvas_changes", {
      plugin: "builtin-canvas-agent",
      version: "1.0.0",
      builtin: "propose_canvas_changes",
      boundProject,
      declaration: {
        id: "propose-canvas-changes",
        title: "生成画布变更提案",
        description:
          "创建待审批的画布节点/连线变更提案并返回积分预估（不直接修改画布或消耗积分，需人工审批落图）。",
        audience: "member",
        parameters: proposeParams,
        program: "builtin",
      },
      model: {
        type: "function",
        function: {
          name: "fm_propose_canvas_changes",
          description:
            "创建待审批的画布节点/连线变更提案并返回积分预估（不直接修改画布或消耗积分，需人工审批落图）。",
          parameters: proposeParams,
        },
      },
    });
  }
  return tools;
}

export class ChatToolCalls {
  readonly calls = new Map<number, ToolCall>();
  append(fragments: ToolFragment[]) {
    appendToolFragments(this.calls, fragments);
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
  validateToolOutput?: (value: unknown) => void,
) {
  if (tool.builtin) {
    // Validate live turn lease, active actor, and workspace membership before invoking built-in Agent tools.
    const verified = await store.p.db.transaction(async (sql) => {
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
        "SELECT * FROM users WHERE id=$1 AND active AND deleted_at IS NULL FOR SHARE",
        [turn.owner_id],
      )) as OriginalActor | undefined;
      if (!actor) throw new ChatReplyError("当前账号无法运行此对话工具");
      await store.chats.identity.requireWorkspace(
        sql,
        actor,
        turn.workspace_number,
      );
      return { actor, workspaceId: String(turn.workspace_id) };
    });

    const projectId =
      typeof args.project_id === "string" && args.project_id.trim()
        ? args.project_id.trim()
        : tool.boundProject || "";
    if (!projectId) {
      return JSON.stringify({ ok: false, error: "缺少目标画布 project_id" });
    }
    const proposals = new OriginalCanvasProposals(store.p);
    try {
      if (tool.builtin === "read_canvas_graph") {
        const graph = await proposals.readGraph(verified.actor, projectId);
        return JSON.stringify({ ok: true, graph }).slice(0, 16000);
      }
      let ops: unknown;
      try {
        ops = JSON.parse(String(args.operations_json || "[]"));
      } catch {
        return JSON.stringify({
          ok: false,
          status: 400,
          error: "operations_json 不是有效的 JSON 数组",
        });
      }
      if (!Array.isArray(ops) || ops.length === 0) {
        return JSON.stringify({
          ok: false,
          status: 400,
          error: "operations_json 必须为非空操作数组",
        });
      }
      const proposal = {
        title: String(args.title || "画布助手变更提案").slice(0, 120),
        summary: String(args.summary || "").slice(0, 1000),
        ...(typeof args.base_revision === "number"
          ? { base_revision: args.base_revision }
          : {}),
        operations: ops,
      };
      validateToolOutput?.({ project_id: projectId, ...proposal });
      const created = await proposals.create(
        verified.actor,
        projectId,
        proposal,
        validateToolOutput,
      );
      return JSON.stringify({
        ok: true,
        proposal_id: created.id,
        status: created.status,
        base_revision: created.base_revision,
        estimated_credits: created.estimated_credits,
        title: created.title,
        summary: created.summary,
        ops_count: ops.length,
      }).slice(0, 16000);
    } catch (error) {
      if (error instanceof DomainError) {
        return JSON.stringify({
          ok: false,
          status: error.status,
          error: error.message,
        });
      }
      throw new ChatReplyError("画布助手工具调用失败");
    }
  }

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
          contributions: tool.grants!,
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
