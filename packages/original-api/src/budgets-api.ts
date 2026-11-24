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

  async list(actor: Actor, explicitWorkspace?: string) {
    return this.p.db.transaction(async (sql) => {
      const ws = await this.identity.activeWorkspace(sql, actor, explicitWorkspace);
      const policies = (
        await sql.query(
          `SELECT id, scope_type, scope_id, period, warn_limit, cap_limit, mode, enabled, revision, updated_at
             FROM budget_policies
            WHERE (scope_type = 'workspace' AND scope_id = $1::text)
               OR (scope_type = 'project' AND scope_id IN (
                    SELECT public_id::text FROM documents WHERE workspace_id = $1::uuid
                  ))
            ORDER BY scope_type ASC, period ASC`,
          [ws.id],
        )
      ).rows;

      const enriched = [];
      for (const row of policies) {
        const usage = await computeScopeSpend(
          sql,
          row.scope_type,
          String(row.scope_id),
          row.period as BudgetPeriod,
        );
        enriched.push({
          id: String(row.id),
          scope_type: row.scope_type as "workspace" | "project",
          scope_id: String(row.scope_id),
          period: row.period as BudgetPeriod,
          warn_limit: Number(row.warn_limit),
          cap_limit: Number(row.cap_limit),
          mode: row.mode as BudgetMode,
          enabled: Boolean(row.enabled),
          revision: Number(row.revision),
          spent: usage.spent,
          held: usage.held,
          total_committed: usage.spent + usage.held,
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
      input.cap_limit > 0 &&
      input.warn_limit > input.cap_limit
    ) {
      requireValue(false, 400, "预警阈值不能高于硬上限");
    }

    return this.p.db.transaction(async (sql) => {
      const ws = await this.identity.activeWorkspace(sql, actor, explicitWorkspace);
      const scopeType = input.scope_type as "workspace" | "project";
      let scopeId: string;
      if (scopeType === "workspace") {
        scopeId = ws.id;
      } else {
        const rawProject = String(input.scope_id || "").trim();
        requireValue(rawProject.length > 0, 400, "项目级预算必须指定项目编号");
        const doc = await one(
          sql,
          "SELECT public_id FROM documents WHERE workspace_id=$1 AND (public_id::text=$2 OR id::text=$2)",
          [ws.id, rawProject],
        );
        requireValue(doc, 404, "项目不存在或不属于当前工作区");
        scopeId = String(doc.public_id);
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
          period: row.period,
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
