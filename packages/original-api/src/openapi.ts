import { WORKSPACE_TOKEN_SCOPES } from "./tokens.js";

/** F035: Standard OpenAPI 3.1.0 specification for Fumiao Developer REST API & MCP Gateway. */
export function buildOpenApiSpec(serverUrl = "/") {
  return {
    openapi: "3.1.0",
    info: {
      title: "弗淼 (Fumiao) AI Video Studio OpenAPI",
      version: "1.0.0",
      description:
        "工作区级 Scoped API Token 驱动的 AI 视频创作平台接口，覆盖画布编排、批量 Precheck 预检、提案式 Agent 落图、工作区 Skills 与 MCP Streamable HTTP 网关。",
    },
    servers: [{ url: serverUrl }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "fmk_<token>",
          description: `工作区 Scoped API Token（可选 Scopes: ${WORKSPACE_TOKEN_SCOPES.join(", ")}）。禁止跨工作区携带不同的 X-Workspace-Id。`,
        },
        sessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: "fm_session",
        },
      },
    },
    security: [{ bearerAuth: [] }, { sessionCookie: [] }],
    paths: {
      "/api/state": {
        get: {
          summary: "获取当前工作区状态、模型目录、余额与最近任务",
          tags: ["Workspace"],
          responses: { "200": { description: "工作区快照" } },
        },
      },
      "/api/tokens": {
        get: {
          summary: "列出当前工作区的 API Tokens",
          tags: ["Developer"],
          responses: { "200": { description: "Token 列表（脱敏）" } },
        },
        post: {
          summary: "签发工作区 Scoped API Token（明文仅返回一次）",
          tags: ["Developer"],
          responses: { "200": { description: "新签发的 Token" } },
        },
      },
      "/api/tokens/{id}": {
        delete: {
          summary: "吊销指定的 API Token",
          tags: ["Developer"],
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
          responses: { "200": { description: "批量报价明细与余额检查" } },
        },
      },
      "/api/canvases": {
        get: {
          summary: "列出当前工作区画布项目",
          tags: ["Canvas"],
          responses: { "200": { description: "画布列表" } },
        },
        post: {
          summary: "创建画布项目",
          tags: ["Canvas"],
          responses: { "200": { description: "新画布" } },
        },
      },
      "/api/canvases/{key}": {
        get: {
          summary: "读取画布完整文档与版本号",
          tags: ["Canvas"],
          parameters: [
            { name: "key", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "画布文档" } },
        },
      },
      "/api/canvases/{key}/batch-precheck": {
        post: {
          summary: "工作流组或选中节点的批量 Precheck 预检与积分确认",
          tags: ["Canvas"],
          parameters: [
            { name: "key", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "逐节点红黄绿健康灯与冻结积分估算" } },
        },
      },
      "/api/canvases/{key}/batch-runs": {
        post: {
          summary: "按环节（图/视频/旁白/对白）提交工作流组局部重跑",
          tags: ["Canvas"],
          parameters: [
            { name: "key", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "已提交的任务列表与总冻结积分" } },
        },
      },
      "/api/canvases/{key}/proposals": {
        get: {
          summary: "列出画布 Agent 变更提案",
          tags: ["Agent"],
          parameters: [
            { name: "key", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "提案列表" } },
        },
        post: {
          summary: "提交提案式画布变更集（不自动改图、不自动烧费）",
          tags: ["Agent"],
          parameters: [
            { name: "key", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "已落库的待审批提案与预估积分" } },
        },
      },
      "/api/canvases/{key}/proposals/{pid}/apply": {
        post: {
          summary: "批准提案并按预期版本号原子落图",
          tags: ["Agent"],
          parameters: [
            { name: "key", in: "path", required: true, schema: { type: "string" } },
            { name: "pid", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "已落图的新版本画布" } },
        },
      },
      "/api/canvases/{key}/proposals/{pid}/reject": {
        post: {
          summary: "拒绝画布变更提案",
          tags: ["Agent"],
          parameters: [
            { name: "key", in: "path", required: true, schema: { type: "string" } },
            { name: "pid", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "提案已拒绝" } },
        },
      },
      "/api/skills": {
        get: {
          summary: "列出当前工作区 SKILL.md 技能包",
          tags: ["Skills"],
          responses: { "200": { description: "技能列表" } },
        },
        post: {
          summary: "创建或导入 SKILL.md 技能",
          tags: ["Skills"],
          responses: { "200": { description: "已保存的技能" } },
        },
      },
      "/api/skills/import-zip": {
        post: {
          summary: "上传包含 SKILL.md 的 ZIP 技能包（防路径穿越、限 64 KiB）",
          tags: ["Skills"],
          responses: { "200": { description: "导入成功的技能" } },
        },
      },
      "/api/workspace/agent-policy": {
        get: {
          summary: "读取工作区 Agent 执行安全策略（plan_only / propose_and_confirm / auto_within_budget）",
          tags: ["Agent"],
          responses: { "200": { description: "当前安全策略" } },
        },
        put: {
          summary: "更新工作区 Agent 执行安全策略",
          tags: ["Agent"],
          responses: { "200": { description: "已更新的安全策略" } },
        },
      },
      "/api/mcp": {
        post: {
          summary: "Fumiao MCP Server (Streamable HTTP JSON-RPC 2.0 入口)",
          tags: ["MCP"],
          responses: {
            "200": { description: "JSON-RPC 2.0 响应（含 mcp-session-id）" },
          },
        },
        get: {
          summary: "Fumiao MCP Server SSE 事件通道",
          tags: ["MCP"],
          responses: { "200": { description: "text/event-stream" } },
        },
        delete: {
          summary: "关闭 MCP 会话",
          tags: ["MCP"],
          responses: { "200": { description: "会话已关闭" } },
        },
      },
    },
  };
}
