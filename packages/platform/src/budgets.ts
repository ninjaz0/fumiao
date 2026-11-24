import { one, type Sql } from "./db.js";
import { DomainError } from "./security.js";

export type BudgetPeriod = "daily" | "monthly" | "total";
export type BudgetMode = "observe" | "warn" | "cap";

export type BudgetPolicyRow = {
  id: string;
  scope_type: "workspace" | "project";
  scope_id: string;
  period: BudgetPeriod;
  warn_limit: number;
  cap_limit: number;
  mode: BudgetMode;
  enabled: boolean;
  revision: number;
  updated_at: string;
};

export async function hasBudgetTables(sql: Sql): Promise<boolean> {
  const row = await one(
    sql,
    "SELECT to_regclass('budget_policies') AS name",
  );
  return Boolean(row?.name);
}

function periodStartExpr(period: BudgetPeriod): string {
  if (period === "daily") return "date_trunc('day', now())";
  if (period === "monthly") return "date_trunc('month', now())";
  return "to_timestamp(0)";
}

function periodLabel(period: BudgetPeriod): string {
  if (period === "daily") return "每日";
  if (period === "monthly") return "月度";
  return "累计";
}

/**
 * Computes spent + currently held credits within the given scope and period.
 * Must be called inside the acceptance transaction (where wallets row is locked)
 * so concurrent submissions cannot exceed cap_limit.
 */
export async function computeScopeSpend(
  sql: Sql,
  scopeType: "workspace" | "project",
  scopeId: string,
  period: BudgetPeriod,
): Promise<{ spent: number; held: number }> {
  const startExpr = periodStartExpr(period);
  if (scopeType === "workspace") {
    const spentRow = await one(
      sql,
      `SELECT COALESCE(SUM(amount), 0) AS total
         FROM ledger
        WHERE workspace_id = $1 AND action = 'spend' AND created_at >= ${startExpr}`,
      [scopeId],
    );
    const heldRow = await one(
      sql,
      `SELECT COALESCE(SUM(price), 0) AS total
         FROM jobs
        WHERE workspace_id = $1
          AND state IN ('queued', 'dispatching', 'running', 'finalizing', 'uncertain')
          AND created_at >= ${startExpr}`,
      [scopeId],
    );
    return {
      spent: Number(spentRow?.total ?? 0),
      held: Number(heldRow?.total ?? 0),
    };
  }

  // Project-scoped budget: join via sidecar job_projects table when present
  const hasJobProjects = await one(
    sql,
    "SELECT to_regclass('job_projects') AS name",
  );
  if (!hasJobProjects?.name) return { spent: 0, held: 0 };

  const spentRow = await one(
    sql,
    `SELECT COALESCE(SUM(l.amount), 0) AS total
       FROM ledger l
       JOIN job_projects jp ON jp.job_id = l.job_id
      WHERE jp.project_id = $1 AND l.action = 'spend' AND l.created_at >= ${startExpr}`,
    [scopeId],
  );
  const heldRow = await one(
    sql,
    `SELECT COALESCE(SUM(j.price), 0) AS total
       FROM jobs j
       JOIN job_projects jp ON jp.job_id = j.id
      WHERE jp.project_id = $1
        AND j.state IN ('queued', 'dispatching', 'running', 'finalizing', 'uncertain')
        AND j.created_at >= ${startExpr}`,
    [scopeId],
  );
  return {
    spent: Number(spentRow?.total ?? 0),
    held: Number(heldRow?.total ?? 0),
  };
}

/**
 * F015: Atomic 3-stage budget enforcement (estimate -> lock -> settle).
 * Evaluates workspace + optional project budget policies inside the acceptance transaction.
 */
export async function checkAndRecordBudget(
  sql: Sql,
  options: {
    workspaceId: string;
    projectId?: string | null;
    amount: number;
  },
): Promise<void> {
  if (options.amount <= 0) return;
  if (!(await hasBudgetTables(sql))) return;

  const scopes: Array<{ type: "workspace" | "project"; id: string }> = [
    { type: "workspace", id: options.workspaceId },
  ];
  if (options.projectId && options.projectId.trim()) {
    scopes.push({ type: "project", id: options.projectId.trim() });
  }

  for (const scope of scopes) {
    const policies = (
      await sql.query(
        `SELECT id, scope_type, scope_id, period, warn_limit, cap_limit, mode, enabled, revision, updated_at
           FROM budget_policies
          WHERE scope_type = $1 AND scope_id = $2 AND enabled = TRUE
          ORDER BY period`,
        [scope.type, scope.id],
      )
    ).rows as BudgetPolicyRow[];

    for (const policy of policies) {
      const { spent, held } = await computeScopeSpend(
        sql,
        scope.type,
        scope.id,
        policy.period,
      );
      const projected = spent + held + options.amount;
      const warnLimit = Number(policy.warn_limit);
      const capLimit = Number(policy.cap_limit);

      if (policy.mode === "cap" && capLimit > 0 && projected > capLimit) {
        const scopeName = scope.type === "project" ? "项目" : "空间";
        throw new DomainError(
          402,
          `已超出${scopeName}${periodLabel(policy.period)}预算上限（预计 ${projected} / 上限 ${capLimit} 积分），请联系管理员调整预算策略`,
        );
      }

      if (
        (policy.mode === "warn" || policy.mode === "cap") &&
        warnLimit > 0 &&
        projected >= warnLimit
      ) {
        await sql.query(
          `INSERT INTO budget_alerts(policy_id, workspace_id, project_id, projected_spend, warn_limit, cap_limit, action)
           VALUES ($1, $2, $3, $4, $5, $6, 'warn')`,
          [
            policy.id,
            options.workspaceId,
            scope.type === "project" ? scope.id : null,
            projected,
            warnLimit,
            capLimit,
          ],
        );
      }
    }
  }
}
