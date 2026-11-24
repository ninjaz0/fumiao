import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Platform } from "@fumiao/platform/platform.js";
import { one } from "@fumiao/platform/db.js";
import { DomainError, requireValue } from "@fumiao/platform/security.js";
import { pythonStrip } from "@fumiao/plugin-sdk/python-values.js";
import { OriginalIdentity, type OriginalActor } from "./identity.js";
import { parseBody } from "./validation.js";
import {
  tokenCreateFields,
  WORKSPACE_TOKEN_SCOPES,
  type WorkspaceTokenScope,
} from "./wave4-fields.js";

export { WORKSPACE_TOKEN_SCOPES, tokenCreateFields, type WorkspaceTokenScope };

export type TokenAuthContext = {
  tokenId: string;
  workspaceId: string;
  workspacePublicId: number;
  scopes: WorkspaceTokenScope[];
  actor: OriginalActor;
};

function hashToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

// Per-token in-memory sliding 60-second window for RPM enforcement.
const rateBuckets = new Map<string, number[]>();

export function checkTokenRateLimit(tokenId: string, limitRpm: number): void {
  const now = Date.now();
  const cutoff = now - 60_000;
  const list = (rateBuckets.get(tokenId) ?? []).filter((ts) => ts > cutoff);
  if (list.length >= limitRpm) {
    rateBuckets.set(tokenId, list);
    throw new DomainError(429, "API Token 请求频率超出每分钟限额");
  }
  list.push(now);
  rateBuckets.set(tokenId, list);
}

export function requireTokenScope(
  auth: TokenAuthContext | undefined,
  scope: WorkspaceTokenScope,
): void {
  if (!auth) return;
  requireValue(
    auth.scopes.includes(scope),
    403,
    `当前 API Token 缺少所需权限：${scope}`,
  );
}

export type TokenRouteRule = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Canonical Express/NestJS route template (e.g. `/api/series/:key`). */
  template: string;
  /** Compiled matcher derived from `template`. */
  path: RegExp;
  scope: WorkspaceTokenScope;
  /** OpenAPI summary & tag for 1-to-1 spec generation. */
  tag: string;
  summary: string;
  /** True when the operation submits paid AI generation work (governed by F031 Agent policy). */
  paidAgentAction?: boolean;
};

export function routeTemplateToRegex(template: string): RegExp {
  const escaped = template
    .split("/")
    .map((seg) =>
      seg.startsWith(":")
        ? "[^/]+"
        : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/");
  return new RegExp(`^${escaped}$`);
}

function tokenRule(
  method: TokenRouteRule["method"],
  template: string,
  scope: WorkspaceTokenScope,
  tag: string,
  summary: string,
  paidAgentAction = false,
): TokenRouteRule {
  return {
    method,
    template,
    path: routeTemplateToRegex(template),
    scope,
    tag,
    summary,
    ...(paidAgentAction ? { paidAgentAction: true } : {}),
  };
}

/**
 * F035: Explicit REST API allowlist for workspace-scoped Bearer Tokens (`fmk_...`).
 * Derived from canonical NestJS route templates and verified by automated contract tests
 * against the live NestJS controllers so routes/methods never drift.
 *
 * Any route NOT listed here (including all `/api/admin/*`, `/api/users*`, `/api/workspaces*`,
 * `/api/tokens*`, `/api/workspace/agent-policy`, `/api/budgets*`, `/api/redeem`,
 * `/api/subscriptions/*`, `/api/me*`, `/api/settings/*`, and proposal `apply`/`reject`)
 * is strictly browser-session-only and rejected with 403 for Bearer tokens — even when
 * the token was issued by an administrator.
 */
export const TOKEN_REST_ALLOWLIST: readonly TokenRouteRule[] = [
  // Workspace state & quoting (read-only; state response is scope-projected for tokens)
  tokenRule("GET", "/api/state", "canvas:read", "Workspace", "读取当前工作区受 scope 裁剪的状态快照"),
  tokenRule("POST", "/api/estimate", "canvas:read", "Billing", "估算单任务耗时与积分"),
  tokenRule("POST", "/api/quotes/batch", "canvas:read", "Billing", "只读批量积分预估（单事务无锁）"),
  // Canvases & storyboard exports
  tokenRule("GET", "/api/canvases", "canvas:read", "Canvas", "列出当前工作区画布项目"),
  tokenRule("POST", "/api/canvases", "canvas:write", "Canvas", "创建画布项目"),
  tokenRule("GET", "/api/canvases/:key", "canvas:read", "Canvas", "读取画布完整文档、节点图与版本号"),
  tokenRule("PUT", "/api/canvases/:key/document", "canvas:write", "Canvas", "按乐观锁版本号保存画布文档"),
  tokenRule("POST", "/api/canvases/:key/duplicate", "canvas:write", "Canvas", "复制画布项目"),
  tokenRule("DELETE", "/api/canvases/:key", "canvas:write", "Canvas", "删除画布项目"),
  tokenRule("GET", "/api/canvases/:key/runs", "canvas:read", "Canvas", "查询画布关联任务列表"),
  tokenRule("GET", "/api/canvases/:key/exports", "canvas:read", "Canvas", "查询画布成片/工程包导出记录"),
  tokenRule("POST", "/api/canvases/:key/exports", "canvas:write", "Canvas", "提交画布成片或剪映/FCPXML/EDL 导出"),
  tokenRule("POST", "/api/canvases/:key/shots/download", "canvas:read", "Canvas", "打包下载画布分镜成片"),
  tokenRule("GET", "/api/storyboard-exports/:key/subtitles", "canvas:read", "Canvas", "导出画布分镜字幕 (SRT/VTT)"),
  tokenRule("POST", "/api/canvases/:key/batch-precheck", "canvas:read", "Canvas", "工作流组或选中节点的只读 Precheck 预检与积分确认"),
  // Canvas proposals (token may read & propose, NEVER self-apply/approve!)
  tokenRule("GET", "/api/canvases/:key/proposals", "canvas:read", "Agent", "列出画布 Agent 变更提案"),
  tokenRule("POST", "/api/canvases/:key/proposals", "canvas:propose", "Agent", "提交提案式画布变更集（不自动改图、不自动扣费）"),
  // Paid generation actions (require job:submit AND pass in-tx F031 Agent policy)
  tokenRule("POST", "/api/canvases/:key/batch-runs", "job:submit", "Canvas", "按环节提交工作流组局部重跑（受 F031 策略管控）", true),
  tokenRule("POST", "/api/canvases/:key/nodes/:node/runs", "job:submit", "Canvas", "提交画布单节点生成任务（受 F031 策略与 F015 预算管控）", true),
  tokenRule("POST", "/api/canvases/:key/nodes/:node/candidates", "job:submit", "Canvas", "提交画布节点多候选生成任务（受 F031 策略管控）", true),
  tokenRule("POST", "/api/canvases/:key/nodes/:node/narration", "job:submit", "Canvas", "提交画布节点旁白配音任务（受 F031 策略管控）", true),
  tokenRule("POST", "/api/canvases/:key/nodes/:node/dialogue", "job:submit", "Canvas", "提交画布节点多角色对白任务（受 F031 策略管控）", true),
  tokenRule("POST", "/api/canvases/:key/nodes/:node/execute", "job:submit", "Canvas", "执行画布扩展插件节点（受 F031 策略管控）", true),
  tokenRule("POST", "/api/canvases/:key/nodes/:node/tail-frame", "canvas:write", "Canvas", "抽取分镜尾帧作为衔接素材"),
  tokenRule("POST", "/api/canvases/:key/nodes/:node/grid-crop", "asset:write", "Canvas", "裁切宫格图单格并入库"),
  // Direct generation & job lifecycle (matching real Nest routes)
  tokenRule("POST", "/api/jobs", "job:submit", "Jobs", "提交视频生成任务（受 F031 策略管控）", true),
  tokenRule("POST", "/api/image-jobs", "job:submit", "Jobs", "提交图片生成任务（受 F031 策略管控）", true),
  tokenRule("POST", "/api/audio-jobs", "job:submit", "Jobs", "提交音频/配音生成任务（受 F031 策略管控）", true),
  tokenRule("POST", "/api/jobs/:id/cancel", "job:submit", "Jobs", "取消排队中的生成任务"),
  tokenRule("DELETE", "/api/jobs/:id", "job:submit", "Jobs", "删除任务记录"),
  // Assets & private media
  tokenRule("POST", "/api/assets", "asset:write", "Assets", "上传素材文件到当前工作区"),
  tokenRule("DELETE", "/api/assets/:key", "asset:write", "Assets", "删除当前工作区素材"),
  tokenRule("GET", "/media/:key", "asset:read", "Assets", "读取工作区私有媒体（支持 Range）"),
  // Asset packs
  tokenRule("GET", "/api/asset-packs", "pack:read", "Assets", "列出当前工作区及全局只读资产包"),
  tokenRule("POST", "/api/asset-packs/:key/turnaround", "job:submit", "Assets", "生成角色三视图/设定图（受 F031 策略管控）", true),
  // Workspace skills
  tokenRule("GET", "/api/skills", "skill:read", "Skills", "列出当前工作区 SKILL.md 技能包"),
  tokenRule("POST", "/api/skills", "skill:write", "Skills", "创建或导入 SKILL.md 技能"),
  tokenRule("POST", "/api/skills/import-zip", "skill:write", "Skills", "上传包含 SKILL.md 的 ZIP 技能包"),
  tokenRule("PUT", "/api/skills/:key", "skill:write", "Skills", "更新指定工作区技能"),
  tokenRule("DELETE", "/api/skills/:key", "skill:write", "Skills", "删除指定工作区技能"),
  // Series -> Season -> Episode -> Scene hierarchy (matching real Nest PUT routes)
  tokenRule("GET", "/api/series", "canvas:read", "Series", "列出当前工作区剧集/季/集/场层级结构"),
  tokenRule("GET", "/api/series/:key", "canvas:read", "Series", "读取单个剧集详情与季/集/场树"),
  tokenRule("POST", "/api/series", "canvas:write", "Series", "创建剧集项目"),
  tokenRule("PUT", "/api/series/:key", "canvas:write", "Series", "更新剧集信息"),
  tokenRule("DELETE", "/api/series/:key", "canvas:write", "Series", "删除剧集项目"),
  tokenRule("POST", "/api/series/:key/episodes", "canvas:write", "Series", "在指定季下创建分集与绑定画布"),
  tokenRule("PUT", "/api/series/:key/episodes/:ep", "canvas:write", "Series", "更新分集标题、季号、集号或梗概"),
  tokenRule("DELETE", "/api/series/:key/episodes/:ep", "canvas:write", "Series", "删除分集"),
  tokenRule("POST", "/api/series/:key/episodes/:ep/scenes", "canvas:write", "Series", "在指定分集下创建分场与绑定画布"),
  tokenRule("PUT", "/api/series/:key/episodes/:ep/scenes/:scene", "canvas:write", "Series", "更新分场标题、场号或分组映射"),
  tokenRule("DELETE", "/api/series/:key/episodes/:ep/scenes/:scene", "canvas:write", "Series", "删除分场"),
  // MCP Streamable HTTP
  tokenRule("POST", "/api/mcp", "mcp:use", "MCP", "Fumiao MCP Server Streamable HTTP JSON-RPC 2.0 入口"),
  tokenRule("GET", "/api/mcp", "mcp:use", "MCP", "Fumiao MCP Server SSE 事件通道"),
  tokenRule("DELETE", "/api/mcp", "mcp:use", "MCP", "关闭 MCP 会话"),
];

export function authorizeTokenHttpRequest(
  auth: TokenAuthContext,
  method: string,
  path: string,
): TokenRouteRule {
  const upper = method.toUpperCase();
  const matched = TOKEN_REST_ALLOWLIST.find(
    (rule) => rule.method === upper && rule.path.test(path),
  );
  if (!matched) {
    throw new DomainError(
      403,
      "该接口仅支持浏览器会话访问，不允许使用工作区 API Token",
    );
  }
  requireTokenScope(auth, matched.scope);
  return matched;
}

export class OriginalApiTokens {
  readonly identity: OriginalIdentity;
  constructor(readonly p: Platform) {
    this.identity = new OriginalIdentity(p);
  }

  async list(user: OriginalActor, selected?: string) {
    return this.p.db.transaction(async (sql) => {
      const workspace = await this.identity.activeWorkspace(
        sql,
        user,
        selected,
      );
      const { rows } = await sql.query(
        `SELECT t.id, t.name, t.token_prefix, t.scopes, t.rate_limit_rpm,
                t.expires_at, t.revoked_at, t.last_used_at, t.created_at,
                u.name AS creator_name, u.public_id AS creator_id
         FROM workspace_api_tokens t
         JOIN users u ON u.id = t.created_by
         WHERE t.workspace_id=$1
         ORDER BY t.created_at DESC
         LIMIT 100`,
        [workspace.id],
      );
      return {
        workspace: Number(workspace.public_id),
        available_scopes: [...WORKSPACE_TOKEN_SCOPES],
        tokens: rows.map((r) => ({
          id: r.id as string,
          name: r.name as string,
          prefix: r.token_prefix as string,
          scopes: (r.scopes as string[]) ?? [],
          rate_limit_rpm: Number(r.rate_limit_rpm),
          expires_at: r.expires_at
            ? Math.floor(new Date(r.expires_at).getTime() / 1000)
            : null,
          revoked_at: r.revoked_at
            ? Math.floor(new Date(r.revoked_at).getTime() / 1000)
            : null,
          last_used_at: r.last_used_at
            ? Math.floor(new Date(r.last_used_at).getTime() / 1000)
            : null,
          created_at: Math.floor(new Date(r.created_at).getTime() / 1000),
          creator: r.creator_name as string,
        })),
      };
    });
  }

  async create(user: OriginalActor, value: unknown, selected?: string) {
    const body = parseBody(value, tokenCreateFields, true) as {
      name: string;
      scopes: WorkspaceTokenScope[];
      rate_limit_rpm: number;
      expires_in_days?: number | null;
    };
    const name = pythonStrip(body.name);
    requireValue(name, 400, "请输入 Token 名称");
    const uniqueScopes = [...new Set(body.scopes)];
    const rawSecret = `fmk_${randomBytes(24).toString("base64url")}`;
    const prefix = rawSecret.slice(0, 12);
    const tokenHash = hashToken(rawSecret);
    const id = randomUUID();
    const expiresAt = body.expires_in_days
      ? new Date(Date.now() + body.expires_in_days * 86_400_000)
      : null;

    return this.p.db.transaction(async (sql) => {
      const workspace = await this.identity.activeWorkspace(
        sql,
        user,
        selected,
      );
      await sql.query(
        `INSERT INTO workspace_api_tokens(id, workspace_id, created_by, name, token_prefix, token_hash, scopes, rate_limit_rpm, expires_at)
         VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          id,
          workspace.id,
          user.id,
          name,
          prefix,
          tokenHash,
          uniqueScopes,
          body.rate_limit_rpm,
          expiresAt,
        ],
      );
      return {
        id,
        name,
        prefix,
        token: rawSecret, // Plaintext returned ONCE at creation!
        workspace: Number(workspace.public_id),
        scopes: uniqueScopes,
        rate_limit_rpm: body.rate_limit_rpm,
        expires_at: expiresAt ? Math.floor(expiresAt.getTime() / 1000) : null,
      };
    });
  }

  async revoke(user: OriginalActor, tokenId: string, selected?: string) {
    requireValue(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        tokenId,
      ),
      404,
      "Token 不存在",
    );
    return this.p.db.transaction(async (sql) => {
      const workspace = await this.identity.activeWorkspace(
        sql,
        user,
        selected,
      );
      const row = await one(
        sql,
        `SELECT id, created_by FROM workspace_api_tokens WHERE id=$1 AND workspace_id=$2 FOR UPDATE`,
        [tokenId, workspace.id],
      );
      requireValue(row, 404, "Token 不存在");
      requireValue(
        row.created_by === user.id || user.role === "admin",
        403,
        "只有创建者或管理员可以吊销该 Token",
      );
      await sql.query(
        "UPDATE workspace_api_tokens SET revoked_at=COALESCE(revoked_at, now()) WHERE id=$1",
        [row.id],
      );
      return { ok: true, id: tokenId };
    });
  }

  /**
   * Authenticates `Authorization: Bearer fmk_...` and strictly pins access to the token's workspace.
   * Any cross-workspace `X-Workspace-Id` header or query param is rejected immediately with 403!
   */
  async authenticateBearer(
    rawToken: string,
    requestedWorkspace?: string,
  ): Promise<TokenAuthContext> {
    requireValue(
      rawToken.startsWith("fmk_") && rawToken.length >= 20,
      401,
      "无效的 API Token",
    );
    const tokenHash = hashToken(rawToken);
    const row = await one(
      this.p.db,
      `SELECT t.id AS token_id, t.workspace_id, t.scopes, t.rate_limit_rpm, t.expires_at, t.revoked_at,
              w.public_id AS workspace_public_id,
              u.id AS user_id, u.public_id AS user_public_id, u.name, u.nickname, u.role,
              u.avatar, u.default_workspace, u.password, u.active, u.deleted_at
       FROM workspace_api_tokens t
       JOIN workspaces w ON w.id = t.workspace_id
       JOIN users u ON u.id = t.created_by
       WHERE t.token_hash = $1`,
      [tokenHash],
    );
    requireValue(row, 401, "API Token 无效");
    requireValue(!row.revoked_at, 401, "API Token 已吊销");
    requireValue(
      !row.expires_at || new Date(row.expires_at).getTime() > Date.now(),
      401,
      "API Token 已过期",
    );
    requireValue(
      row.active && !row.deleted_at,
      401,
      "Token 所属账号已停用",
    );

    const boundWorkspace = Number(row.workspace_public_id);
    if (
      requestedWorkspace !== undefined &&
      requestedWorkspace.trim() !== "" &&
      requestedWorkspace.trim() !== String(boundWorkspace)
    ) {
      throw new DomainError(
        403,
        "API Token 已绑定所属工作区，禁止通过 X-Workspace-Id 跨工作区访问",
      );
    }

    checkTokenRateLimit(String(row.token_id), Number(row.rate_limit_rpm));

    void this.p.db
      .query("UPDATE workspace_api_tokens SET last_used_at=now() WHERE id=$1", [
        row.token_id,
      ])
      .catch(() => {});

    const scopes = ((row.scopes as string[]) ?? []) as WorkspaceTokenScope[];
    const actor: OriginalActor = {
      id: String(row.user_id),
      public_id: Number(row.user_public_id),
      name: String(row.name),
      nickname: String(row.nickname || ""),
      role: row.role === "admin" ? "admin" : "member",
      avatar: String(row.avatar || ""),
      default_workspace: row.default_workspace
        ? String(row.default_workspace)
        : null,
      password: String(row.password || ""),
      active: Boolean(row.active),
      deleted_at: row.deleted_at ?? null,
      tokenId: String(row.token_id),
      tokenWorkspaceId: String(row.workspace_id),
      tokenWorkspacePublicId: boundWorkspace,
      tokenScopes: scopes,
    };

    return {
      tokenId: String(row.token_id),
      workspaceId: String(row.workspace_id),
      workspacePublicId: boundWorkspace,
      scopes,
      actor,
    };
  }
}
