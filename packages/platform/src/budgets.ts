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

async function resolveProjectScopeKey(
  sql: Sql,
  rawScopeId: string,
): Promise<{ canonicalUuid: string | null; policyKeys: string[] }> {
  const trimmed = rawScopeId.trim();
  if (!trimmed) return { canonicalUuid: null, policyKeys: [] };
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      trimmed,
    );
  const hasDocs = await one(sql, "SELECT to_regclass('documents') IS NOT NULL AS ok");
  if (!hasDocs?.ok) {
    return { canonicalUuid: isUuid ? trimmed : null, policyKeys: [trimmed] };
  }
  const doc = await one(
    sql,
    isUuid
      ? "SELECT id, public_id FROM documents WHERE id = $1::uuid LIMIT 1"
      : "SELECT id, public_id FROM documents WHERE public_id::text = $1 LIMIT 1",
    [trimmed],
  );
  if (!doc) {
    return { canonicalUuid: isUuid ? trimmed : null, policyKeys: [trimmed] };
  }
  const keys = [...new Set([String(doc.id), String(doc.public_id)])];
  return { canonicalUuid: String(doc.id), policyKeys: keys };
}

/**
 * Computes spent + currently held credits within the given scope and period.
 * - `spent`: settled ledger `action = 'spend'` rows within the current period window.
 * - `held`: ALL currently in-flight active jobs (`queued|dispatching|running|finalizing|uncertain`)
 *   belonging to the scope, regardless of when they were enqueued — because if a job created
 *   before midnight or month-end succeeds now, its `spend` lands in the current period, while
 *   if it fails/cancels it leaves active states immediately and releases its hold cleanly.
 * - For `project` scope, unions BOTH `job_projects` AND legacy `canvas_job_links` so historical
 *   jobs created before `job_projects` existed are always attributed accurately.
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
          AND deleted_at IS NULL
          AND state IN ('queued', 'dispatching', 'running', 'finalizing', 'uncertain')`,
      [scopeId],
    );
    return {
      spent: Number(spentRow?.total ?? 0),
      held: Number(heldRow?.total ?? 0),
    };
  }

  // Project-scoped budget: canonicalize public_id or UUID -> documents.id UUID
  const { canonicalUuid } = await resolveProjectScopeKey(sql, scopeId);
  if (!canonicalUuid) return { spent: 0, held: 0 };

  const tables = await one(
    sql,
    `SELECT to_regclass('job_projects') IS NOT NULL AS jp,
            to_regclass('canvas_job_links') IS NOT NULL AS cjl`,
  );
  const sources: string[] = [];
  if (tables?.jp) {
    sources.push("SELECT job_id FROM job_projects WHERE project_id = $1::uuid");
  }
  if (tables?.cjl) {
    sources.push("SELECT job_id FROM canvas_job_links WHERE project_id = $1::uuid");
  }
  if (!sources.length) return { spent: 0, held: 0 };
  const projectJobsCte = `WITH proj_jobs AS (${sources.join(" UNION ")})`;

  const spentRow = await one(
    sql,
    `${projectJobsCte}
      SELECT COALESCE(SUM(l.amount), 0) AS total
        FROM ledger l
        JOIN proj_jobs pj ON pj.job_id = l.job_id
       WHERE l.action = 'spend' AND l.created_at >= ${startExpr}`,
    [canonicalUuid],
  );
  const heldRow = await one(
    sql,
    `${projectJobsCte}
      SELECT COALESCE(SUM(j.price), 0) AS total
        FROM jobs j
        JOIN proj_jobs pj ON pj.job_id = j.id
       WHERE j.deleted_at IS NULL
         AND j.state IN ('queued', 'dispatching', 'running', 'finalizing', 'uncertain')`,
    [canonicalUuid],
  );
  return {
    spent: Number(spentRow?.total ?? 0),
    held: Number(heldRow?.total ?? 0),
  };
}

export type BudgetEvaluation = {
  blocked: boolean;
  blocks: string[];
  warnings: string[];
  policies: Array<{
    policyId: string;
    scopeType: "workspace" | "project";
    scopeId: string;
    period: BudgetPeriod;
    mode: BudgetMode;
    spent: number;
    held: number;
    projected: number;
    warnLimit: number;
    capLimit: number;
    exceededCap: boolean;
    exceededWarn: boolean;
  }>;
};

/**
 * Pure read-only budget impact check safe inside REPEATABLE READ READ ONLY transactions
 * (used by F010 batch Precheck and shared with atomic `checkAndRecordBudget`).
 */
export async function evaluateBudgetImpact(
  sql: Sql,
  options: {
    workspaceId: string;
    projectId?: string | null;
    amount: number;
  },
): Promise<BudgetEvaluation> {
  const empty: BudgetEvaluation = {
    blocked: false,
    blocks: [],
    warnings: [],
    policies: [],
  };
  if (options.amount <= 0) return empty;
  if (!(await hasBudgetTables(sql))) return empty;

  const scopes: Array<{
    type: "workspace" | "project";
    canonicalId: string;
    lookupIds: string[];
  }> = [
    {
      type: "workspace",
      canonicalId: options.workspaceId,
      lookupIds: [options.workspaceId],
    },
  ];
  if (options.projectId && options.projectId.trim()) {
    const resolved = await resolveProjectScopeKey(sql, options.projectId);
    if (resolved.policyKeys.length) {
      scopes.push({
        type: "project",
        canonicalId: resolved.canonicalUuid ?? options.projectId.trim(),
        lookupIds: resolved.policyKeys,
      });
    }
  }

  const out: BudgetEvaluation = {
    blocked: false,
    blocks: [],
    warnings: [],
    policies: [],
  };

  for (const scope of scopes) {
    const policies = (
      await sql.query(
        `SELECT id, scope_type, scope_id, period, warn_limit, cap_limit, mode, enabled, revision, updated_at
           FROM budget_policies
          WHERE scope_type = $1 AND scope_id = ANY($2::text[]) AND enabled = TRUE
          ORDER BY period`,
        [scope.type, scope.lookupIds],
      )
    ).rows as BudgetPolicyRow[];

    for (const policy of policies) {
      const { spent, held } = await computeScopeSpend(
        sql,
        scope.type,
        scope.canonicalId,
        policy.period,
      );
      const projected = spent + held + options.amount;
      const warnLimit = Number(policy.warn_limit);
      const capLimit = Number(policy.cap_limit);
      const scopeName = scope.type === "project" ? "项目" : "空间";
      const exceededCap =
        policy.mode === "cap" && capLimit > 0 && projected > capLimit;
      const exceededWarn =
        (policy.mode === "warn" || policy.mode === "cap") &&
        warnLimit > 0 &&
        projected >= warnLimit;

      out.policies.push({
        policyId: String(policy.id),
        scopeType: scope.type,
        scopeId: scope.canonicalId,
        period: policy.period,
        mode: policy.mode,
        spent,
        held,
        projected,
        warnLimit,
        capLimit,
        exceededCap,
        exceededWarn,
      });

      if (exceededCap) {
        out.blocked = true;
        out.blocks.push(
          `已超出${scopeName}${periodLabel(policy.period)}预算上限（已承诺 ${spent + held} + 本次 ${options.amount} = ${projected} / 上限 ${capLimit} 积分），请联系管理员调整预算策略`,
        );
      } else if (exceededWarn) {
        out.warnings.push(
          `预计触达${scopeName}${periodLabel(policy.period)}预算告警阈值（预计 ${projected} / 告警 ${warnLimit} 积分）`,
        );
      }
    }
  }

  return out;
}

/**
 * F015: Atomic 3-stage budget enforcement (estimate -> lock -> settle).
 * Evaluates workspace + optional project budget policies inside the acceptance transaction
 * while holding the workspace wallet lock so concurrent submissions cannot exceed cap_limit.
 */
export async function checkAndRecordBudget(
  sql: Sql,
  options: {
    workspaceId: string;
    projectId?: string | null;
    amount: number;
  },
): Promise<void> {
  const evalResult = await evaluateBudgetImpact(sql, options);
  if (evalResult.blocked) {
    throw new DomainError(402, evalResult.blocks[0]);
  }
  for (const item of evalResult.policies) {
    if (item.exceededWarn) {
      await sql.query(
        `INSERT INTO budget_alerts(policy_id, workspace_id, project_id, projected_spend, warn_limit, cap_limit, action)
         VALUES ($1, $2, $3, $4, $5, $6, 'warn')`,
        [
          item.policyId,
          options.workspaceId,
          item.scopeType === "project" ? item.scopeId : null,
          item.projected,
          item.warnLimit,
          item.capLimit,
        ],
      );
    }
  }
}
