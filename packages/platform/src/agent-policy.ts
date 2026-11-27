import { creditUnits, formatCredits } from "./credit-amount.js";
import { one, type Sql } from "./db.js";
import { DomainError, requireValue } from "./security.js";

export type AgentExecutionPolicy =
  | "plan_only"
  | "propose_and_confirm"
  | "auto_within_budget";

export async function readAgentExecutionPolicy(
  sql: Sql,
  workspaceId: string,
): Promise<AgentExecutionPolicy> {
  const exists = await one(
    sql,
    "SELECT to_regclass('workspace_agent_policies') IS NOT NULL AS ok",
  );
  if (!exists?.ok) return "plan_only";
  const row = await one(
    sql,
    "SELECT execution_policy FROM workspace_agent_policies WHERE workspace_id=$1",
    [workspaceId],
  );
  return (row?.execution_policy as AgentExecutionPolicy) ?? "plan_only";
}

export async function hasActiveWorkspaceCapBudget(
  sql: Sql,
  workspaceId: string,
): Promise<boolean> {
  const table = await one(
    sql,
    "SELECT to_regclass('budget_policies') IS NOT NULL AS ok",
  );
  if (!table?.ok) return false;
  const row = await one(
    sql,
    `SELECT 1 FROM budget_policies
      WHERE scope_type = 'workspace'
        AND scope_id = $1::text
        AND enabled = TRUE
        AND mode = 'cap'
        AND cap_limit > 0
      LIMIT 1`,
    [workspaceId],
  );
  return Boolean(row);
}

export type AgentActionGuardOptions = {
  projectId?: string | null;
  nodeId?: string | null;
  amount?: number | string;
  executionKey?: string | null;
  approvedProposalId?: string | null;
};

export type VerifiedAgentProposal = {
  proposalId: string;
  executionKey: string;
  nodeId: string | null;
  amount: string;
};

/**
 * F031: Authoritative in-transaction Agent execution policy guardrail.
 * Must run inside the acceptance transaction (holding wallet + proposal row locks)
 * so concurrent submissions cannot exceed an approved proposal's scope or budget.
 */
export async function enforceAgentPolicyInTx(
  sql: Sql,
  workspaceId: string,
  options: AgentActionGuardOptions = {},
): Promise<VerifiedAgentProposal | null> {
  const policy = await readAgentExecutionPolicy(sql, workspaceId);
  if (policy === "plan_only") {
    throw new DomainError(
      403,
      "当前工作区处于「只建图不烧费 (plan_only)」安全模式，Agent 仅可读取上下文与提交待审批提案，禁止直接提交扣费生成任务或冻结积分",
    );
  }

  if (policy === "auto_within_budget") {
    const hasCap = await hasActiveWorkspaceCapBudget(sql, workspaceId);
    if (!hasCap) {
      throw new DomainError(
        403,
        "当前工作区尚未启用有效的硬上限预算策略 (mode=cap)，已暂停 Agent 在预算内自动执行扣费任务",
      );
    }
    return null;
  }

  // policy === "propose_and_confirm"
  const pid = options.approvedProposalId?.trim();
  if (!pid) {
    throw new DomainError(
      403,
      "当前工作区处于「提案人工批准后执行 (propose_and_confirm)」模式，Agent 必须引用已由用户在画布批准落图的提案编号 (approved_proposal_id) 才能执行扣费任务",
    );
  }

  const proposalsTable = await one(
    sql,
    "SELECT to_regclass('canvas_proposals') IS NOT NULL AS ok",
  );
  requireValue(proposalsTable?.ok, 403, "画布提案表尚未初始化");

  const proposal = await one(
    sql,
    `SELECT id, project_id, workspace_id, status, estimated_credits
       FROM canvas_proposals
      WHERE public_id = $1 AND workspace_id = $2
      FOR UPDATE`,
    [pid, workspaceId],
  );
  requireValue(
    proposal && proposal.status === "applied",
    403,
    "引用的画布提案不存在、不属于当前工作区或尚未获得人工批准落图",
  );

  const targetProjectId = options.projectId?.trim() || null;
  requireValue(
    targetProjectId && proposal.project_id === targetProjectId,
    403,
    "引用的已批准提案仅限用于其绑定的目标画布项目",
  );

  const targetNodeId = options.nodeId?.trim() || null;
  const amount = creditUnits(String(options.amount ?? 0));
  requireValue(amount >= 0n, 400, "扣费金额不能为负数");
  const execKey = options.executionKey?.trim() || `${targetProjectId}:${targetNodeId ?? "*"}`;

  const hasScopeTables = await one(
    sql,
    `SELECT to_regclass('agent_proposal_scopes') IS NOT NULL AS scopes,
            to_regclass('agent_proposal_executions') IS NOT NULL AS execs`,
  );

  let approvedCredits = creditUnits(String(proposal.estimated_credits ?? 0));
  if (hasScopeTables?.scopes) {
    const scope = await one(
      sql,
      `SELECT project_id, allowed_node_ids, approved_credits
         FROM agent_proposal_scopes
        WHERE proposal_id = $1`,
      [proposal.id],
    );
    // Fail-closed for legacy pre-upgrade applied proposals lacking a node-level scope snapshot
    // so upgrading never widens approval permissions beyond explicitly approved nodes.
    requireValue(
      scope,
      403,
      "该历史已落图提案缺少节点级授权快照，请重新发起并批准画布提案后再执行扣费任务",
    );
    const allowedNodes: string[] = Array.isArray(scope.allowed_node_ids)
      ? scope.allowed_node_ids.map(String)
      : [];
    requireValue(
      allowedNodes.length > 0,
      403,
      "该已批准提案仅包含非扣费画布编辑，未授权执行扣费生成任务",
    );
    requireValue(
      targetNodeId && allowedNodes.includes(targetNodeId),
      403,
      "目标节点不在该已批准提案授权的生成范围内",
    );
    approvedCredits = creditUnits(String(scope.approved_credits));
  }

  if (hasScopeTables?.execs) {
    // Idempotent retry on the exact same executionKey bypasses double-counting
    const existing = await one(
      sql,
      `SELECT job_id FROM agent_proposal_executions
        WHERE proposal_id = $1 AND execution_key = $2`,
      [proposal.id, execKey],
    );
    if (existing) {
      return {
        proposalId: String(proposal.id),
        executionKey: execKey,
        nodeId: targetNodeId,
        amount: formatCredits(amount),
      };
    }

    const usedRow = await one(
      sql,
      `SELECT COALESCE(SUM(e.amount), 0) AS used
         FROM agent_proposal_executions e
         JOIN jobs j ON j.id = e.job_id
        WHERE e.proposal_id = $1
          AND j.state NOT IN ('failed', 'cancelled')`,
      [proposal.id],
    );
    const used = creditUnits(String(usedRow?.used ?? 0));
    if (amount > 0 && used + amount > approvedCredits) {
      throw new DomainError(
        403,
        `已超出该批准提案授权的积分预算（已占用 ${formatCredits(used)} + 本次 ${formatCredits(amount)} > 已批准 ${formatCredits(approvedCredits)} 积分）`,
      );
    }
  } else if (amount > 0 && amount > approvedCredits) {
    throw new DomainError(
      403,
      `已超出该批准提案授权的积分预算（本次 ${formatCredits(amount)} > 已批准 ${formatCredits(approvedCredits)} 积分）`,
    );
  }

  return {
    proposalId: String(proposal.id),
    executionKey: execKey,
    nodeId: targetNodeId,
    amount: formatCredits(amount),
  };
}

export async function recordAgentProposalExecution(
  sql: Sql,
  verified: VerifiedAgentProposal | null,
  jobId: string,
): Promise<void> {
  if (!verified) return;
  const hasExecTable = await one(
    sql,
    "SELECT to_regclass('agent_proposal_executions') IS NOT NULL AS ok",
  );
  if (!hasExecTable?.ok) return;
  await sql.query(
    `INSERT INTO agent_proposal_executions(proposal_id, execution_key, job_id, node_id, amount)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (proposal_id, execution_key) DO NOTHING`,
    [
      verified.proposalId,
      verified.executionKey,
      jobId,
      verified.nodeId,
      verified.amount,
    ],
  );
}
