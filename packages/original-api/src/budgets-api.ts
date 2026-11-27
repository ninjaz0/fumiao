import { creditUnits, formatCredits } from "@fumiao/platform/credit-amount.js";
import {
  computeScopeSpend,
  type BudgetMode,
  type BudgetPeriod,
} from "@fumiao/platform/budgets.js";
import { one } from "@fumiao/platform/db.js";
import type { Actor, Platform } from "@fumiao/platform/platform.js";
import { requireValue } from "@fumiao/platform/security.js";
import { OriginalIdentity } from "./identity.js";
import { parseBody } from "./validation.js";
import {
  budgetUpsertFields,
  moderationSettingsFields,
} from "./wave6-fields.js";

/**
 * F015 + F024: Workspace / Project Budget Policies, Alerts, and Moderation Auto-Rewrite Settings.
 */
export class OriginalBudgets {
  constructor(
    readonly p: Platform,
    readonly identity = new OriginalIdentity(p),
  ) {}

  private assertCanManageWorkspacePolicy(actor: Actor, ws: any) {
    requireValue(
      !actor.tokenId,
      403,
      "修改预算与内容安全策略仅支持浏览器会话，禁止使用 API Token",
    );
    requireValue(
      actor.role === "admin" || ws.owner_id === actor.id,
      403,
      "只有工作区负责人或管理员可以修改预算与内容安全策略",
    );
  }

  async list(actor: Actor, explicitWorkspace?: string) {
    return this.p.db.transaction(async (sql) => {
      const ws = await this.identity.activeWorkspace(sql, actor, explicitWorkspace);
      const docs = (
        await sql.query(
          `SELECT id, public_id, title
             FROM documents
            WHERE workspace_id = $1::uuid AND kind = 'canvas' AND NOT deleted
            ORDER BY updated_at DESC
            LIMIT 200`,
          [ws.id],
        )
      ).rows;
      const docByAnyId = new Map<
        string,
        { id: string; public_id: string; title: string }
      >();
      const projects = docs.map((d) => {
        const title = String(d.title || "未命名画布");
        const entry = {
          id: String(d.id),
          public_id: String(d.public_id),
          title,
        };
        docByAnyId.set(entry.id, entry);
        docByAnyId.set(entry.public_id, entry);
        return entry;
      });

      const policies = (
        await sql.query(
          `SELECT id, scope_type, scope_id, period, warn_limit, cap_limit, mode, enabled, revision, updated_at
             FROM budget_policies
            WHERE (scope_type = 'workspace' AND scope_id = $1::text)
               OR (scope_type = 'project' AND (
                    scope_id IN (SELECT id::text FROM documents WHERE workspace_id = $1::uuid)
                    OR scope_id IN (SELECT public_id::text FROM documents WHERE workspace_id = $1::uuid)
                  ))
            ORDER BY scope_type ASC, scope_id ASC, period ASC`,
          [ws.id],
        )
      ).rows;

      const enriched = [];
      for (const row of policies) {
        const rawScopeId = String(row.scope_id);
        const proj =
          row.scope_type === "project" ? docByAnyId.get(rawScopeId) : undefined;
        const canonicalScopeId = proj ? proj.id : rawScopeId;
        const usage = await computeScopeSpend(
          sql,
          row.scope_type,
          canonicalScopeId,
          row.period as BudgetPeriod,
        );
        enriched.push({
          id: String(row.id),
          scope_type: row.scope_type as "workspace" | "project",
          scope_id: canonicalScopeId,
          project_public_id: proj?.public_id ?? null,
          project_title: proj?.title ?? null,
          period: row.period as BudgetPeriod,
          warn_limit: Number(row.warn_limit),
          cap_limit: Number(row.cap_limit),
          mode: row.mode as BudgetMode,
          enabled: Boolean(row.enabled),
          revision: Number(row.revision),
          spent: usage.spent,
          held: usage.held,
          total_committed: Number(usage.exact.committed),
          exact: { ...usage.exact,
            warn_limit: formatCredits(creditUnits(String(row.warn_limit))),
            cap_limit: formatCredits(creditUnits(String(row.cap_limit))),
          },
          updated_at: new Date(row.updated_at).toISOString(),
        });
      }

      const alerts = (
        await sql.query(
          `SELECT id, policy_id, project_id, projected_spend, warn_limit, cap_limit, action, created_at
             FROM budget_alerts
            WHERE workspace_id = $1
            ORDER BY created_at DESC
            LIMIT 30`,
          [ws.id],
        )
      ).rows.map((a) => ({
        id: String(a.id),
        policy_id: String(a.policy_id),
        project_id: a.project_id ? String(a.project_id) : null,
        exact: {
          projected_spend: formatCredits(creditUnits(String(a.projected_spend))),
          warn_limit: formatCredits(creditUnits(String(a.warn_limit))),
          cap_limit: formatCredits(creditUnits(String(a.cap_limit))),
        },
        projected_spend: Number(a.projected_spend),
        warn_limit: Number(a.warn_limit),
        cap_limit: Number(a.cap_limit),
        action: String(a.action),
        created_at: new Date(a.created_at).toISOString(),
      }));

      const mod = await one(
        sql,
        "SELECT auto_rewrite, max_attempts, updated_at FROM workspace_moderation_settings WHERE workspace_id=$1",
        [ws.id],
      );

      return {
        workspace_id: Number(ws.public_id),
        can_manage:
          !actor.tokenId &&
          (actor.role === "admin" || ws.owner_id === actor.id),
        projects,
        policies: enriched,
        alerts,
        moderation: {
          auto_rewrite: Boolean(mod?.auto_rewrite ?? false),
          max_attempts: Number(mod?.max_attempts ?? 2),
          updated_at: mod?.updated_at
            ? new Date(mod.updated_at).toISOString()
            : null,
        },
      };
    });
  }

  async upsertPolicy(
    actor: Actor,
    body: unknown,
    explicitWorkspace?: string,
  ) {
    const input = parseBody(body, budgetUpsertFields);
    if (
      input.mode === "cap" &&
      creditUnits(String(input.cap_limit)) > 0n &&
      creditUnits(String(input.warn_limit)) > creditUnits(String(input.cap_limit))
    ) {
      requireValue(false, 400, "预警阈值不能高于硬上限");
    }

    return this.p.db.transaction(async (sql) => {
      const ws = await this.identity.activeWorkspace(sql, actor, explicitWorkspace);
      this.assertCanManageWorkspacePolicy(actor, ws);
      const scopeType = input.scope_type as "workspace" | "project";
      let scopeId: string;
      let projectPublicId: string | null = null;
      if (scopeType === "workspace") {
        scopeId = ws.id;
      } else {
        const rawProject = String(input.scope_id || "").trim();
        requireValue(rawProject.length > 0, 400, "项目级预算必须指定项目编号");
        const doc = await one(
          sql,
          "SELECT id, public_id FROM documents WHERE workspace_id=$1 AND kind='canvas' AND NOT deleted AND (public_id::text=$2 OR id::text=$2)",
          [ws.id, rawProject],
        );
        requireValue(doc, 404, "项目不存在或不属于当前工作区");
        // Canonicalize project scope_id to documents.id (UUID) matching job_projects & canvas_job_links!
        scopeId = String(doc.id);
        projectPublicId = String(doc.public_id);
        // Clean up any legacy public_id-keyed policy row for the same (project, period)
        if (projectPublicId !== scopeId) {
          await sql.query(
            "DELETE FROM budget_policies WHERE scope_type='project' AND scope_id=$1 AND period=$2",
            [projectPublicId, input.period],
          );
        }
      }

      const row = await one(
        sql,
        `INSERT INTO budget_policies(scope_type, scope_id, period, warn_limit, cap_limit, mode, enabled)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (scope_type, scope_id, period) DO UPDATE
           SET warn_limit = EXCLUDED.warn_limit,
               cap_limit = EXCLUDED.cap_limit,
               mode = EXCLUDED.mode,
               enabled = EXCLUDED.enabled,
               revision = budget_policies.revision + 1,
               updated_at = now()
         RETURNING id, scope_type, scope_id, period, warn_limit, cap_limit, mode, enabled, revision, updated_at`,
        [
          scopeType,
          scopeId,
          input.period,
          input.warn_limit,
          input.cap_limit,
          input.mode,
          input.enabled,
        ],
      );

      await this.p.audit(sql, actor, "budget.upsert", String(row.id));
      return {
        policy: {
          id: String(row.id),
          scope_type: row.scope_type,
          scope_id: String(row.scope_id),
          project_public_id: projectPublicId,
          period: row.period,
          exact: {
            warn_limit: formatCredits(creditUnits(String(row.warn_limit))),
            cap_limit: formatCredits(creditUnits(String(row.cap_limit))),
          },
          warn_limit: Number(row.warn_limit),
          cap_limit: Number(row.cap_limit),
          mode: row.mode,
          enabled: Boolean(row.enabled),
          revision: Number(row.revision),
          updated_at: new Date(row.updated_at).toISOString(),
        },
      };
    });
  }

  async updateModeration(
    actor: Actor,
    body: unknown,
    explicitWorkspace?: string,
  ) {
    const input = parseBody(body, moderationSettingsFields);
    return this.p.db.transaction(async (sql) => {
      const ws = await this.identity.activeWorkspace(sql, actor, explicitWorkspace);
      this.assertCanManageWorkspacePolicy(actor, ws);
      const row = await one(
        sql,
        `INSERT INTO workspace_moderation_settings(workspace_id, auto_rewrite, max_attempts, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (workspace_id) DO UPDATE
           SET auto_rewrite = EXCLUDED.auto_rewrite,
               max_attempts = EXCLUDED.max_attempts,
               updated_at = now()
         RETURNING auto_rewrite, max_attempts, updated_at`,
        [ws.id, input.auto_rewrite, input.max_attempts],
      );
      await this.p.audit(sql, actor, "moderation.settings", ws.id);
      return {
        moderation: {
          auto_rewrite: Boolean(row.auto_rewrite),
          max_attempts: Number(row.max_attempts),
          updated_at: new Date(row.updated_at).toISOString(),
        },
      };
    });
  }
}
