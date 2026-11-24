import { WORKSPACE_TOKEN_SCOPES } from "./tokens.js";

/**
 * F035: Standard OpenAPI 3.1.0 specification for Fumiao Developer REST API & MCP Gateway.
 * Security and scope annotations match `TOKEN_REST_ALLOWLIST` in `tokens.ts` 1-to-1.
 */
export function buildOpenApiSpec(serverUrl = "/") {
  const tokenOrSession = (scope: string) => ({
    security: [{ bearerAuth: [scope] }, { sessionCookie: [] }],
    "x-required-scope": scope,
  });
  const sessionOnly = {
    security: [{ sessionCookie: [] }],
    "x-session-only": true,
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "弗淼 (Fumiao) AI Video Studio OpenAPI",
      version: "1.1.0",
      description:
        "工作区级 Scoped API Token 驱动的 AI 视频创作平台接口。所有 Bearer Token 严格锁定在签发工作区内并逐路由校验 scope；管理接口、Token 管理、安全策略变更与提案审批落图仅允许浏览器会话（sessionCookie）执行。",
    },
    servers: [{ url: serverUrl }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "fmk_<token>",
          description: `工作区 Scoped API Token（可用 Scopes: ${WORKSPACE_TOKEN_SCOPES.join(", ")}）。仅限调用明确允许的业务接口；禁止跨工作区访问，且即使由管理员签发也不可访问 /api/admin/* 或浏览器会话专属路由。`,
        },
        sessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: "fm_session",
          description: "浏览器登录会话 Cookie（管理员与工作区策略/审批操作必需）。",
        },
      },
    },
    paths: {
      "/api/state": {
        get: {
          summary: "获取当前工作区状态、模型目录、余额与最近任务",
          tags: ["Workspace"],
          ...tokenOrSession("canvas:read"),
          responses: { "200": { description: "工作区快照" }, "403": { description: "缺少 canvas:read 或跨工作区拒绝" } },
        },
      },
      "/api/tokens": {
        get: {
          summary: "列出当前工作区的 API Tokens（仅浏览器会话）",
          tags: ["Developer"],
          ...sessionOnly,
          responses: { "200": { description: "Token 列表（脱敏）" }, "403": { description: "禁止使用 API Token 访问" } },
        },
        post: {
          summary: "签发工作区 Scoped API Token（仅浏览器会话，明文仅返回一次）",
          tags: ["Developer"],
          ...sessionOnly,
          responses: { "200": { description: "新签发的 Token" }, "403": { description: "禁止使用 API Token 访问" } },
        },
      },
      "/api/tokens/{id}": {
        delete: {
          summary: "吊销指定的 API Token（仅浏览器会话）",
          tags: ["Developer"],
          ...sessionOnly,
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "已吊销" } },
        },
      },
      "/api/quotes/batch": {
        post: {
          summary: "只读批量积分预估（单事务无锁）",
          tags: ["Billing"],
          ...tokenOrSession("canvas:read"),
          responses: { "200": { description: "批量报价明细与余额检查" } },
        },
      },
      "/api/canvases": {
        get: {
          summary: "列出当前工作区画布项目",
          tags: ["Canvas"],
          ...tokenOrSession("canvas:read"),
          responses: { "200": { description: "画布列表" } },
        },
        post: {
          summary: "创建画布项目",
          tags: ["Canvas"],
          ...tokenOrSession("canvas:write"),
          responses: { "200": { description: "新画布" } },
        },
      },
      "/api/canvases/{key}": {
        get: {
          summary: "读取画布完整文档与版本号",
          tags: ["Canvas"],
          ...tokenOrSession("canvas:read"),
          parameters: [
            { name: "key", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "画布文档" } },
        },
        delete: {
          summary: "删除画布项目",
          tags: ["Canvas"],
          ...tokenOrSession("canvas:write"),
          parameters: [
            { name: "key", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "已删除" } },
        },
      },
      "/api/canvases/{key}/document": {
        put: {
          summary: "按乐观锁版本号保存画布文档",
          tags: ["Canvas"],
          ...tokenOrSession("canvas:write"),
          parameters: [
            { name: "key", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "新版本画布" }, "409": { description: "版本冲突" } },
        },
      },
      "/api/canvases/{key}/batch-precheck": {
        post: {
          summary: "工作流组或选中节点的批量 Precheck 预检与积分确认（只读）",
          tags: ["Canvas"],
          ...tokenOrSession("canvas:read"),
          parameters: [
            { name: "key", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "逐节点红黄绿健康灯、冻结积分与预算检查" } },
        },
      },
      "/api/canvases/{key}/batch-runs": {
        post: {
          summary: "按环节（图/视频/旁白/对白）提交工作流组局部重跑（受 F031 Agent 策略管控）",
          tags: ["Canvas"],
          ...tokenOrSession("job:submit"),
          parameters: [
            { name: "key", in: "path", required: true, schema: { type: "string" } },
            {
              name: "X-Approved-Proposal-Id",
              in: "header",
              required: false,
              schema: { type: "string" },
              description: "当工作区处于 propose_and_confirm 策略时，Token 需携带已由人工批准的提案编号",
            },
          ],
          responses: { "200": { description: "已提交的任务列表与总冻结积分" }, "403": { description: "策略拦截或缺少 job:submit" } },
        },
      },
      "/api/canvases/{key}/nodes/{node}/runs": {
        post: {
          summary: "提交画布单节点生成任务（受 F031 Agent 策略与 F015 预算策略管控）",
          tags: ["Canvas"],
          ...tokenOrSession("job:submit"),
          parameters: [
            { name: "key", in: "path", required: true, schema: { type: "string" } },
            { name: "node", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "已接单任务" }, "402": { description: "超出预算硬上限" }, "403": { description: "Agent 策略拦截或缺少 job:submit" } },
        },
      },
      "/api/canvases/{key}/proposals": {
        get: {
          summary: "列出画布 Agent 变更提案",
          tags: ["Agent"],
          ...tokenOrSession("canvas:read"),
          parameters: [
            { name: "key", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "提案列表" } },
        },
        post: {
          summary: "提交提案式画布变更集（不自动改图、不自动烧费）",
          tags: ["Agent"],
          ...tokenOrSession("canvas:propose"),
          parameters: [
            { name: "key", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "已落库的待审批提案与预估积分" } },
        },
      },
      "/api/canvases/{key}/proposals/{pid}/apply": {
        post: {
          summary: "人工批准提案并按预期版本号原子落图（仅浏览器会话，防止 Agent 自行审批）",
          tags: ["Agent"],
          ...sessionOnly,
          parameters: [
            { name: "key", in: "path", required: true, schema: { type: "string" } },
            { name: "pid", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "已落图的新版本画布" }, "403": { description: "禁止使用 API Token 自行审批" } },
        },
      },
      "/api/canvases/{key}/proposals/{pid}/reject": {
        post: {
          summary: "拒绝画布变更提案（仅浏览器会话）",
          tags: ["Agent"],
          ...sessionOnly,
          parameters: [
            { name: "key", in: "path", required: true, schema: { type: "string" } },
            { name: "pid", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "提案已拒绝" } },
        },
      },
      "/api/asset-packs": {
        get: {
          summary: "列出当前工作区及全局只读资产包",
          tags: ["Assets"],
          ...tokenOrSession("pack:read"),
          responses: { "200": { description: "素材包列表" } },
        },
      },
      "/api/skills": {
        get: {
          summary: "列出当前工作区 SKILL.md 技能包",
          tags: ["Skills"],
          ...tokenOrSession("skill:read"),
          responses: { "200": { description: "技能列表" } },
        },
        post: {
          summary: "创建或导入 SKILL.md 技能",
          tags: ["Skills"],
          ...tokenOrSession("skill:write"),
          responses: { "200": { description: "已保存的技能" } },
        },
      },
      "/api/skills/import-zip": {
        post: {
          summary: "上传包含 SKILL.md 的 ZIP 技能包（防路径穿越、限 64 KiB）",
          tags: ["Skills"],
          ...tokenOrSession("skill:write"),
          responses: { "200": { description: "导入成功的技能" } },
        },
      },
      "/api/workspace/agent-policy": {
        get: {
          summary: "读取工作区 Agent 执行安全策略（仅浏览器会话）",
          tags: ["Agent"],
          ...sessionOnly,
          responses: { "200": { description: "当前安全策略与硬上限预算状态" } },
        },
        put: {
          summary: "更新工作区 Agent 执行安全策略（仅工作区负责人/管理员浏览器会话）",
          tags: ["Agent"],
          ...sessionOnly,
          responses: { "200": { description: "已更新的安全策略" }, "400": { description: "启用 auto_within_budget 缺少有效硬上限预算" } },
        },
      },
      "/api/mcp": {
        post: {
          summary: "Fumiao MCP Server (Streamable HTTP JSON-RPC 2.0 入口)",
          tags: ["MCP"],
          ...tokenOrSession("mcp:use"),
          responses: {
            "200": { description: "JSON-RPC 2.0 响应（含 mcp-session-id）" },
          },
        },
        get: {
          summary: "Fumiao MCP Server SSE 事件通道",
          tags: ["MCP"],
          ...tokenOrSession("mcp:use"),
          responses: { "200": { description: "text/event-stream" } },
        },
        delete: {
          summary: "关闭 MCP 会话",
          tags: ["MCP"],
          ...tokenOrSession("mcp:use"),
          responses: { "200": { description: "会话已关闭" } },
        },
      },
    },
  };
}
