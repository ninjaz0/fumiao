import { randomUUID } from "node:crypto";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { one } from "@fumiao/platform/db.js";
import { DomainError, requireValue } from "@fumiao/platform/security.js";
import { OriginalIdentity } from "@fumiao/original-api/identity.js";
import { OriginalCanvases } from "@fumiao/original-api/canvases.js";
import { OriginalCanvasRuns } from "@fumiao/original-api/canvas-runs.js";
import { OriginalPacks } from "@fumiao/original-api/packs.js";
import { OriginalBatchPrecheck } from "@fumiao/original-api/batch-precheck.js";
import { OriginalStoryboardExports } from "@fumiao/original-api/storyboard-exports.js";
import {
  OriginalAgentPolicies,
  OriginalCanvasProposals,
} from "@fumiao/original-api/proposals.js";
import {
  OriginalApiTokens,
  requireTokenScope,
  type TokenAuthContext,
} from "@fumiao/original-api/tokens.js";
import {
  originalBearerToken,
  originalSessionToken,
  originalWorkspace,
  type OriginalAuthRequest,
} from "./original-request.js";

const MCP_PROTOCOL_VERSION = "2025-03-26";

const MCP_TOOLS = [
  {
    name: "list_canvases",
    description: "列出当前工作区的所有画布项目及节点数",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_canvas",
    description: "以只读事务读取指定画布的完整节点图、连线、镜头顺序和版本号",
    inputSchema: {
      type: "object",
      required: ["project_id"],
      properties: { project_id: { type: "string" } },
    },
  },
  {
    name: "propose_canvas_patch",
    description:
      "向画布提交提案式变更集（新增/修改/删除节点、连线、镜头列表），自动估算未来渲染积分，等待用户在画布审批落图（绝不自动扣费）",
    inputSchema: {
      type: "object",
      required: ["project_id", "operations"],
      properties: {
        project_id: { type: "string" },
        title: { type: "string" },
        summary: { type: "string" },
        base_revision: { type: "integer" },
        operations: { type: "array", items: { type: "object" } },
      },
    },
  },
  {
    name: "list_asset_packs",
    description: "列出当前工作区及全局只读的角色/场景/服装素材包（含三视图与声线配置）",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "precheck_batch",
    description: "对画布节点或工作流组执行无锁只读 Precheck 预检与积分费用核算",
    inputSchema: {
      type: "object",
      required: ["project_id", "node_ids"],
      properties: {
        project_id: { type: "string" },
        expected_revision: { type: "integer" },
        node_ids: { type: "array", items: { type: "string" } },
        stages: {
          type: "array",
          items: { type: "string", enum: ["image", "video", "narration", "dialogue"] },
        },
      },
    },
  },
  {
    name: "submit_generation_job",
    description:
      "提交画布单节点生成任务（需要 job:submit 权限，且工作区安全策略不能为 plan_only）",
    inputSchema: {
      type: "object",
      required: ["project_id", "node_id", "expected_revision"],
      properties: {
        project_id: { type: "string" },
        node_id: { type: "string" },
        expected_revision: { type: "integer" },
        price_revision: { type: "integer" },
        uid: { type: "string" },
        approved_proposal_id: {
          type: "string",
          description: "当工作区处于 propose_and_confirm 策略时，需传入已由人工在画布批准落图的提案编号",
        },
      },
    },
  },
  {
    name: "get_job_status",
    description: "查询指定生成任务 ID 的最新状态、结果素材与错误信息",
    inputSchema: {
      type: "object",
      required: ["job_id"],
      properties: { job_id: { type: "integer" } },
    },
  },
  {
    name: "export_storyboard",
    description: "触发画布成片 MP4 或工程包（剪映 ZIP / FCPXML）导出",
    inputSchema: {
      type: "object",
      required: ["project_id", "expected_revision"],
      properties: {
        project_id: { type: "string" },
        expected_revision: { type: "integer" },
        exporter: { type: "string", default: "storyboard/mp4" },
        uid: { type: "string" },
      },
    },
  },
] as const;

type McpSession = {
  id: string;
  workspacePublicId: string;
  userId: string;
  createdAt: number;
};

/**
 * F012: Fumiao MCP Server (Streamable HTTP JSON-RPC 2.0 over POST/GET/DELETE /api/mcp).
 */
@Controller("api/mcp")
export class OriginalMcpController {
  private readonly sessions = new Map<string, McpSession>();
  private readonly tokens: OriginalApiTokens;
  private readonly canvases: OriginalCanvases;
  private readonly canvasRuns: OriginalCanvasRuns;
  private readonly packs: OriginalPacks;
  private readonly precheck: OriginalBatchPrecheck;
  private readonly proposals: OriginalCanvasProposals;
  private readonly policies: OriginalAgentPolicies;
  private readonly exports: OriginalStoryboardExports;

  constructor(@Inject(OriginalIdentity) private readonly identity: OriginalIdentity) {
    this.tokens = new OriginalApiTokens(identity.p);
    this.canvases = new OriginalCanvases(identity.p);
    this.canvasRuns = new OriginalCanvasRuns(identity.p);
    this.packs = new OriginalPacks(identity.p);
    this.precheck = new OriginalBatchPrecheck(identity.p);
    this.proposals = new OriginalCanvasProposals(identity.p);
    this.policies = new OriginalAgentPolicies(identity.p);
    this.exports = new OriginalStoryboardExports(identity.p);
  }

  private async authenticate(req: OriginalAuthRequest): Promise<{
    actor: OriginalAuthRequest["actor"];
    workspacePublicId: string;
    workspaceId: string;
    tokenAuth?: TokenAuthContext;
  }> {
    const bearer = originalBearerToken(req);
    const requestedWs = originalWorkspace(req);
    if (bearer) {
      const auth = await this.tokens.authenticateBearer(bearer, requestedWs);
      requireTokenScope(auth, "mcp:use");
      return {
        actor: auth.actor,
        workspacePublicId: String(auth.workspacePublicId),
        workspaceId: auth.workspaceId,
        tokenAuth: auth,
      };
    }
    const actor = await this.identity.actor(originalSessionToken(req));
    const ws = await this.identity.activeWorkspace(
      this.identity.p.db,
      actor,
      requestedWs,
    );
    return {
      actor,
      workspacePublicId: String(ws.public_id),
      workspaceId: String(ws.id),
    };
  }

  private async assertProjectInWorkspace(
    projectKey: string,
    workspaceId: string,
  ): Promise<{ id: string; workspace_id: string }> {
    const row = await one(
      this.identity.p.db,
      "SELECT id, workspace_id FROM documents WHERE public_id=$1 AND kind='canvas' AND NOT deleted",
      [projectKey],
    );
    requireValue(row, 404, "画布不存在或已删除");
    requireValue(
      row.workspace_id === workspaceId,
      403,
      "目标画布不属于当前 MCP 会话 / API Token 绑定的工作区",
    );
    return { id: String(row.id), workspace_id: String(row.workspace_id) };
  }

  private async executeTool(
    ctx: {
      actor: OriginalAuthRequest["actor"];
      workspacePublicId: string;
      workspaceId: string;
      tokenAuth?: TokenAuthContext;
    },
    name: string,
    args: Record<string, any>,
  ) {
    switch (name) {
      case "list_canvases": {
        requireTokenScope(ctx.tokenAuth, "canvas:read");
        return this.canvases.list(ctx.actor, ctx.workspacePublicId);
      }
      case "get_canvas": {
        requireTokenScope(ctx.tokenAuth, "canvas:read");
        requireValue(typeof args.project_id === "string", 400, "缺少 project_id");
        await this.assertProjectInWorkspace(args.project_id, ctx.workspaceId);
        return this.proposals.readGraph(ctx.actor, args.project_id);
      }
      case "propose_canvas_patch": {
        requireTokenScope(ctx.tokenAuth, "canvas:propose");
        requireValue(typeof args.project_id === "string", 400, "缺少 project_id");
        await this.assertProjectInWorkspace(args.project_id, ctx.workspaceId);
        return this.proposals.create(ctx.actor, args.project_id, {
          title: args.title ?? "MCP Agent 画布变更提案",
          summary: args.summary ?? "",
          base_revision: args.base_revision ?? null,
          operations: args.operations ?? [],
        });
      }
      case "list_asset_packs": {
        requireTokenScope(ctx.tokenAuth, "pack:read");
        return this.packs.list(ctx.actor, ctx.workspacePublicId);
      }
      case "precheck_batch": {
        requireTokenScope(ctx.tokenAuth, "canvas:read");
        requireValue(typeof args.project_id === "string", 400, "缺少 project_id");
        await this.assertProjectInWorkspace(args.project_id, ctx.workspaceId);
        return this.precheck.precheckCanvas(ctx.actor, args.project_id, {
          expected_revision: args.expected_revision ?? null,
          node_ids: args.node_ids ?? [],
          stages: args.stages ?? ["image", "video"],
        });
      }
      case "submit_generation_job": {
        requireTokenScope(ctx.tokenAuth, "job:submit");
        requireValue(
          typeof args.project_id === "string" &&
            typeof args.node_id === "string",
          400,
          "缺少 project_id 或 node_id",
        );
        const target = await this.assertProjectInWorkspace(
          args.project_id,
          ctx.workspaceId,
        );
        // F031: Enforce workspace agent execution policy on the real target project workspace!
        await this.policies.enforceForAgentAction(
          this.identity.p.db,
          target.workspace_id,
          {
            projectId: target.id,
            approvedProposalId:
              typeof args.approved_proposal_id === "string"
                ? args.approved_proposal_id
                : null,
          },
        );
        return this.canvasRuns.generate(
          ctx.actor,
          args.project_id,
          args.node_id,
          {
            expected_revision: args.expected_revision,
            price_revision: args.price_revision ?? null,
            uid: args.uid || randomUUID(),
          },
        );
      }
      case "get_job_status": {
        requireTokenScope(ctx.tokenAuth, "job:read");
        requireValue(
          Number.isSafeInteger(args.job_id) && args.job_id > 0,
          400,
          "job_id 无效",
        );
        const row = await one(
          this.identity.p.db,
          `SELECT j.public_id, j.kind, j.state, j.provider_model, j.price, j.error,
                  j.created_at, j.updated_at,
                  (SELECT a.public_id FROM job_assets ja JOIN assets a ON a.id=ja.asset_id
                   WHERE ja.job_id=j.id AND ja.role='output' ORDER BY a.created_at LIMIT 1) AS result_asset
           FROM jobs j
           WHERE j.public_id=$1 AND j.workspace_id=$2 AND j.deleted_at IS NULL`,
          [args.job_id, ctx.workspaceId],
        );
        requireValue(row, 404, "任务不存在或无权访问");
        return {
          id: Number(row.public_id),
          kind: row.kind,
          state: row.state,
          model: row.provider_model,
          price: Number(row.price),
          result_asset: row.result_asset ?? null,
          error: row.error ?? null,
        };
      }
      case "export_storyboard": {
        requireTokenScope(ctx.tokenAuth, "canvas:write");
        requireValue(typeof args.project_id === "string", 400, "缺少 project_id");
        await this.assertProjectInWorkspace(args.project_id, ctx.workspaceId);
        return this.exports.create(ctx.actor, args.project_id, {
          expected_revision: args.expected_revision,
          exporter: args.exporter ?? "storyboard/mp4",
          uid: args.uid || randomUUID(),
        });
      }
      default:
        throw new DomainError(404, `未知 MCP 工具：${name}`);
    }
  }

  @Post()
  @HttpCode(200)
  async handlePost(
    @Req() req: OriginalAuthRequest,
    @Body() body: any,
    @Res() res: Response,
  ) {
    const ctx = await this.authenticate(req);
    res.setHeader("X-Accel-Buffering", "no");

    const rpc = body && typeof body === "object" ? body : {};
    const id = rpc.id ?? null;
    const method = typeof rpc.method === "string" ? rpc.method : "";
    const params =
      rpc.params && typeof rpc.params === "object" ? rpc.params : {};

    let sessionId = req.get("mcp-session-id") || "";

    try {
      if (method === "initialize") {
        sessionId = randomUUID();
        this.sessions.set(sessionId, {
          id: sessionId,
          workspacePublicId: ctx.workspacePublicId,
          userId: ctx.actor.id,
          createdAt: Date.now(),
        });
        res.setHeader("mcp-session-id", sessionId);
        res.json({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "fumiao-mcp", version: "1.0.0" },
          },
        });
        return;
      }

      if (sessionId) {
        const existing = this.sessions.get(sessionId);
        if (existing) {
          requireValue(
            existing.userId === ctx.actor.id &&
              existing.workspacePublicId === ctx.workspacePublicId,
            403,
            "MCP 会话不属于当前工作区",
          );
          res.setHeader("mcp-session-id", sessionId);
        }
      }

      if (method === "notifications/initialized" || method === "ping") {
        res.json({ jsonrpc: "2.0", id, result: {} });
        return;
      }

      if (method === "tools/list") {
        res.json({
          jsonrpc: "2.0",
          id,
          result: { tools: MCP_TOOLS },
        });
        return;
      }

      if (method === "tools/call") {
        const toolName = typeof params.name === "string" ? params.name : "";
        const toolArgs =
          params.arguments && typeof params.arguments === "object"
            ? params.arguments
            : {};
        const output = await this.executeTool(ctx, toolName, toolArgs);
        res.json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
            structuredContent: output,
            isError: false,
          },
        });
        return;
      }

      res.json({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
    } catch (err) {
      const status = err instanceof DomainError ? err.status : 500;
      const message = err instanceof Error ? err.message : "MCP 工具执行失败";
      if (method === "tools/call") {
        res.json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify({ error: message, status }) }],
            isError: true,
          },
        });
        return;
      }
      res.status(status >= 400 && status < 600 ? status : 500).json({
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message },
      });
    }
  }

  @Get()
  async handleSse(@Req() req: OriginalAuthRequest, @Res() res: Response) {
    const ctx = await this.authenticate(req);
    const sessionId = req.get("mcp-session-id") || randomUUID();
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        id: sessionId,
        workspacePublicId: ctx.workspacePublicId,
        userId: ctx.actor.id,
        createdAt: Date.now(),
      });
    }
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("mcp-session-id", sessionId);
    res.write(
      `event: endpoint\ndata: ${JSON.stringify({ session_id: sessionId, server: "fumiao-mcp" })}\n\n`,
    );
    const timer = setInterval(() => {
      if (!res.writableEnded) res.write(": keepalive\n\n");
    }, 15_000);
    req.once("close", () => clearInterval(timer));
  }

  @Delete()
  @HttpCode(200)
  async handleDelete(@Req() req: OriginalAuthRequest) {
    await this.authenticate(req);
    const sessionId = req.get("mcp-session-id") || "";
    if (sessionId) this.sessions.delete(sessionId);
    return { ok: true };
  }
}
