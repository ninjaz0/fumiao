import { TOKEN_REST_ALLOWLIST, WORKSPACE_TOKEN_SCOPES } from "./tokens.js";

export type SessionOnlyRouteDoc = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  template: string;
  tag: string;
  summary: string;
};

/**
 * Browser-session-only management / governance routes documented in OpenAPI.
 * Every route here is explicitly rejected with 403 for Bearer API Tokens.
 */
export const SESSION_ONLY_OPENAPI_ROUTES: readonly SessionOnlyRouteDoc[] = [
  {
    method: "PUT",
    template: "/api/canvases/:key/archive",
    tag: "Canvas",
    summary: "归档画布（仅画布创建者或有工作区访问权限的系统管理员）",
  },
  {
    method: "DELETE",
    template: "/api/canvases/:key/archive",
    tag: "Canvas",
    summary: "恢复画布（仅画布创建者或有工作区访问权限的系统管理员）",
  },
  {
    method: "GET",
    template: "/api/tokens",
    tag: "Developer",
    summary: "列出当前工作区的 API Tokens（仅浏览器会话）",
  },
  {
    method: "POST",
    template: "/api/tokens",
    tag: "Developer",
    summary: "签发工作区 Scoped API Token（仅浏览器会话，明文仅返回一次）",
  },
  {
    method: "DELETE",
    template: "/api/tokens/:id",
    tag: "Developer",
    summary: "吊销指定的 API Token（仅浏览器会话）",
  },
  {
    method: "GET",
    template: "/api/workspace/agent-policy",
    tag: "Agent",
    summary: "读取工作区 Agent 执行安全策略（仅浏览器会话）",
  },
  {
    method: "PUT",
    template: "/api/workspace/agent-policy",
    tag: "Agent",
    summary: "更新工作区 Agent 执行安全策略（仅工作区负责人/管理员浏览器会话）",
  },
  {
    method: "POST",
    template: "/api/canvases/:key/proposals/:pid/apply",
    tag: "Agent",
    summary:
      "人工批准提案并按预期版本号原子落图（仅浏览器会话，防止 Agent 自行审批）",
  },
  {
    method: "POST",
    template: "/api/canvases/:key/proposals/:pid/reject",
    tag: "Agent",
    summary: "拒绝画布变更提案（仅浏览器会话）",
  },
  {
    method: "GET",
    template: "/api/budgets",
    tag: "Billing",
    summary: "读取当前工作区及项目预算策略与内容安全策略（仅浏览器会话）",
  },
  {
    method: "PUT",
    template: "/api/budgets",
    tag: "Billing",
    summary: "保存工作区或项目级预算策略（仅工作区负责人/管理员浏览器会话）",
  },
  {
    method: "PUT",
    template: "/api/budgets/moderation",
    tag: "Billing",
    summary: "更新内容安全改写重试策略（仅工作区负责人/管理员浏览器会话）",
  },
  {
    method: "GET",
    template: "/api/admin/observability/summary",
    tag: "Admin",
    summary:
      "读取全站模型渠道健康度、延迟、成本与毛利汇总（仅管理员浏览器会话）",
  },
  {
    method: "GET",
    template: "/api/admin/observability/uncertain",
    tag: "Admin",
    summary:
      "列出待人工核对的 uncertain 任务列表，返回任务 UUID（id）与公开任务号（public_id）（仅管理员浏览器会话）",
  },
  {
    method: "POST",
    template: "/api/admin/observability/jobs/:id/reconcile",
    tag: "Admin",
    summary:
      "核对 uncertain 任务（退款或恢复）；路径参数 id 支持运营大盘返回的任务 UUID 或正整数公开任务号，格式非法返回 400、不存在返回 404（仅管理员浏览器会话）",
  },
];

function templateToOpenApiPath(template: string): {
  openApiPath: string;
  params: Array<{
    name: string;
    in: "path";
    required: true;
    schema: { type: "string" };
  }>;
} {
  const params: Array<{
    name: string;
    in: "path";
    required: true;
    schema: { type: "string" };
  }> = [];
  const openApiPath = template
    .split("/")
    .map((seg) => {
      if (seg.startsWith(":")) {
        const name = seg.slice(1);
        params.push({
          name,
          in: "path",
          required: true,
          schema: { type: "string" },
        });
        return `{${name}}`;
      }
      return seg;
    })
    .join("/");
  return { openApiPath, params };
}

/**
 * F035: Standard OpenAPI 3.1.0 specification generated directly from `TOKEN_REST_ALLOWLIST`
 * and `SESSION_ONLY_OPENAPI_ROUTES` so security, scopes, paths, and HTTP methods stay 1-to-1
 * with the real NestJS routes.
 */
export function buildOpenApiSpec(serverUrl = "/") {
  const paths: Record<string, Record<string, any>> = {};

  for (const rule of TOKEN_REST_ALLOWLIST) {
    const { openApiPath, params } = templateToOpenApiPath(rule.template);
    const methodKey = rule.method.toLowerCase();
    const extraParams = rule.paidAgentAction
      ? [
          {
            name: "X-Approved-Proposal-Id",
            in: "header",
            required: false,
            schema: { type: "string" },
            description:
              "当工作区处于 propose_and_confirm 策略时，Agent 需携带已由人工批准落图的提案编号",
          },
        ]
      : [];
    const viewParams =
      rule.method === "GET" && rule.template === "/api/canvases"
        ? [
            {
              name: "view",
              in: "query",
              schema: {
                type: "string",
                enum: ["current", "archived"],
                default: "current",
              },
              description: "选择当前画布或已归档画布",
            },
          ]
        : [];
    const allParams = [...params, ...extraParams, ...viewParams];
    paths[openApiPath] ??= {};
    paths[openApiPath][methodKey] = {
      summary: rule.summary,
      tags: [rule.tag],
      security: [{ bearerAuth: [rule.scope] }, { sessionCookie: [] }],
      "x-required-scope": rule.scope,
      ...(rule.paidAgentAction ? { "x-paid-agent-action": true } : {}),
      ...(allParams.length ? { parameters: allParams } : {}),
      responses: {
        "200": { description: "成功" },
        "403": {
          description: `缺少权限 ${rule.scope}、跨工作区拒绝${rule.paidAgentAction ? "或被 F031 Agent 安全策略拦截" : ""}`,
        },
      },
    };
  }

  for (const doc of SESSION_ONLY_OPENAPI_ROUTES) {
    const { openApiPath, params } = templateToOpenApiPath(doc.template);
    const methodKey = doc.method.toLowerCase();
    const archive = doc.template === "/api/canvases/:key/archive";
    const allParams = archive
      ? [
          ...params,
          {
            name: "expected_archive_change",
            in: "query",
            schema: { type: "string", format: "uuid" },
            description: "撤销时传入上一次操作返回的 undo_token",
          },
        ]
      : params;
    paths[openApiPath] ??= {};
    paths[openApiPath][methodKey] = {
      summary: doc.summary,
      tags: [doc.tag],
      security: [{ sessionCookie: [] }],
      "x-session-only": true,
      ...(allParams.length ? { parameters: allParams } : {}),
      responses: {
        "200": {
          description: archive
            ? "返回 archived_at。直接操作实际改变状态时同时返回 undo_token"
            : "成功",
        },
        "403": {
          description: "该接口仅支持浏览器会话访问，禁止使用 API Token",
        },
        ...(archive
          ? { "409": { description: "归档状态已经变化，撤销凭据过期" } }
          : {}),
      },
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "弗淼 (Fumiao) AI Video Studio OpenAPI",
      version: "1.2.0",
      description:
        "工作区级 Scoped API Token 驱动的 AI 视频创作平台接口。所有 Bearer Token 严格锁定在签发工作区内并逐路由校验 scope；GET /api/state 对 Token 返回受 scope 裁剪的工作区投影；管理接口、Token 管理、安全策略、预算写入与提案审批落图仅允许浏览器会话（sessionCookie）执行。",
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
          description:
            "浏览器登录会话 Cookie（管理员与工作区策略/审批操作必需）。",
        },
      },
    },
    paths,
  };
}
