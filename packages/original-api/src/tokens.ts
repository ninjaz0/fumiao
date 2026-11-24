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
  method: string;
  path: RegExp;
  scope: WorkspaceTokenScope;
  /** True when the operation submits paid AI generation work (governed by F031 Agent policy). */
  paidAgentAction?: boolean;
};

/**
 * F035: Explicit REST API allowlist for workspace-scoped Bearer Tokens (`fmk_...`).
 * Any route NOT listed here (including all `/api/admin/*`, `/api/users*`, `/api/workspaces*`,
 * `/api/tokens*`, `/api/workspace/agent-policy`, `/api/budgets*`, `/api/redeem`,
 * `/api/subscriptions/*`, `/api/me*`, `/api/settings/*`, and proposal `apply`/`reject`)
 * is strictly browser-session-only and rejected with 403 for Bearer tokens — even when
 * the token was issued by an administrator.
 */
export const TOKEN_REST_ALLOWLIST: readonly TokenRouteRule[] = [
  // Workspace state & batch quote (read-only)
  { method: "GET", path: /^\/api\/state$/, scope: "canvas:read" },
  { method: "POST", path: /^\/api\/quotes\/batch$/, scope: "canvas:read" },
  // Canvases & storyboard exports
  { method: "GET", path: /^\/api\/canvases$/, scope: "canvas:read" },
  { method: "POST", path: /^\/api\/canvases$/, scope: "canvas:write" },
  { method: "GET", path: /^\/api\/canvases\/[^/]+$/, scope: "canvas:read" },
  { method: "GET", path: /^\/api\/canvases\/[^/]+\/graph$/, scope: "canvas:read" },
  { method: "GET", path: /^\/api\/canvases\/[^/]+\/runs$/, scope: "canvas:read" },
  { method: "GET", path: /^\/api\/canvases\/[^/]+\/exports$/, scope: "canvas:read" },
  { method: "PUT", path: /^\/api\/canvases\/[^/]+\/document$/, scope: "canvas:write" },
  { method: "POST", path: /^\/api\/canvases\/[^/]+\/duplicate$/, scope: "canvas:write" },
  { method: "DELETE", path: /^\/api\/canvases\/[^/]+$/, scope: "canvas:write" },
  { method: "POST", path: /^\/api\/canvases\/[^/]+\/exports$/, scope: "canvas:write" },
  { method: "POST", path: /^\/api\/canvases\/[^/]+\/shots\/download$/, scope: "canvas:read" },
  { method: "GET", path: /^\/api\/storyboard-exports\/[^/]+\/subtitles$/, scope: "canvas:read" },
  { method: "POST", path: /^\/api\/canvases\/[^/]+\/batch-precheck$/, scope: "canvas:read" },
  // Canvas proposals (token may read & propose, NEVER self-apply/approve!)
  { method: "GET", path: /^\/api\/canvases\/[^/]+\/proposals$/, scope: "canvas:read" },
  { method: "POST", path: /^\/api\/canvases\/[^/]+\/proposals$/, scope: "canvas:propose" },
  // Paid generation actions (require job:submit AND pass F031 Agent spending policy)
  { method: "POST", path: /^\/api\/canvases\/[^/]+\/batch-runs$/, scope: "job:submit", paidAgentAction: true },
  { method: "POST", path: /^\/api\/canvases\/[^/]+\/nodes\/[^/]+\/runs$/, scope: "job:submit", paidAgentAction: true },
  { method: "POST", path: /^\/api\/canvases\/[^/]+\/nodes\/[^/]+\/candidates$/, scope: "job:submit", paidAgentAction: true },
  { method: "POST", path: /^\/api\/canvases\/[^/]+\/nodes\/[^/]+\/narration$/, scope: "job:submit", paidAgentAction: true },
  { method: "POST", path: /^\/api\/canvases\/[^/]+\/nodes\/[^/]+\/dialogue$/, scope: "job:submit", paidAgentAction: true },
  { method: "POST", path: /^\/api\/canvases\/[^/]+\/nodes\/[^/]+\/execute$/, scope: "job:submit", paidAgentAction: true },
  { method: "POST", path: /^\/api\/canvases\/[^/]+\/nodes\/[^/]+\/tail-frame$/, scope: "canvas:write" },
  { method: "POST", path: /^\/api\/canvases\/[^/]+\/nodes\/[^/]+\/grid-crop$/, scope: "asset:write" },
  { method: "POST", path: /^\/api\/generate\/(image|video|audio)$/, scope: "job:submit", paidAgentAction: true },
  // Jobs
  { method: "GET", path: /^\/api\/jobs$/, scope: "job:read" },
  { method: "GET", path: /^\/api\/jobs\/[^/]+$/, scope: "job:read" },
  { method: "POST", path: /^\/api\/jobs\/[^/]+\/cancel$/, scope: "job:submit" },
  // Assets & media
  { method: "POST", path: /^\/api\/assets$/, scope: "asset:write" },
  { method: "DELETE", path: /^\/api\/assets\/[^/]+$/, scope: "asset:write" },
  { method: "GET", path: /^\/media\/[^/]+$/, scope: "asset:read" },
  // Asset packs
  { method: "GET", path: /^\/api\/asset-packs$/, scope: "pack:read" },
  { method: "POST", path: /^\/api\/asset-packs\/[^/]+\/turnaround$/, scope: "job:submit", paidAgentAction: true },
  // Workspace skills
  { method: "GET", path: /^\/api\/skills$/, scope: "skill:read" },
  { method: "POST", path: /^\/api\/skills$/, scope: "skill:write" },
  { method: "POST", path: /^\/api\/skills\/import-zip$/, scope: "skill:write" },
  { method: "PUT", path: /^\/api\/skills\/[^/]+$/, scope: "skill:write" },
  { method: "DELETE", path: /^\/api\/skills\/[^/]+$/, scope: "skill:write" },
  // Series hierarchy
  { method: "GET", path: /^\/api\/series$/, scope: "canvas:read" },
  { method: "GET", path: /^\/api\/series\/[^/]+$/, scope: "canvas:read" },
  { method: "POST", path: /^\/api\/series$/, scope: "canvas:write" },
  { method: "PATCH", path: /^\/api\/series\/[^/]+$/, scope: "canvas:write" },
  { method: "DELETE", path: /^\/api\/series\/[^/]+$/, scope: "canvas:write" },
  { method: "POST", path: /^\/api\/series\/[^/]+\/episodes$/, scope: "canvas:write" },
  { method: "PATCH", path: /^\/api\/series\/[^/]+\/episodes\/[^/]+$/, scope: "canvas:write" },
  { method: "DELETE", path: /^\/api\/series\/[^/]+\/episodes\/[^/]+$/, scope: "canvas:write" },
  // MCP Streamable HTTP
  { method: "POST", path: /^\/api\/mcp$/, scope: "mcp:use" },
  { method: "GET", path: /^\/api\/mcp$/, scope: "mcp:use" },
  { method: "DELETE", path: /^\/api\/mcp$/, scope: "mcp:use" },
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
