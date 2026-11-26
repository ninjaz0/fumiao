import { useCallback, useEffect, useState } from "react";
import { BookOpen, Check, ShieldCheck, Sparkles, X } from "lucide-react";

type ProposalOp = {
  op: string;
  temp_id?: string;
  id?: string;
  type?: string;
  title?: string;
  source?: string;
  target?: string;
  shots?: string[];
};

type CanvasProposal = {
  id: string;
  title: string;
  summary: string;
  base_revision: number;
  operations: ProposalOp[];
  estimated_credits: number;
  status: "pending" | "applied" | "rejected" | "expired";
  applied_revision: number | null;
  created: number;
};

type AgentPolicy = "plan_only" | "propose_and_confirm" | "auto_within_budget";

const POLICY_LABELS: Record<AgentPolicy, string> = {
  plan_only: "只建图不烧费 (plan_only)",
  propose_and_confirm: "提案人工批准后执行 (propose_and_confirm)",
  auto_within_budget: "预算硬上限内自动执行 (auto_within_budget)",
};

export function ProposalDiffPreview({
  workspace,
  projectId,
  canEditPolicy,
  onApproveProposal,
  onOpenSkills,
  onClose,
  embedded = false,
}: {
  workspace: number;
  projectId: string;
  canEditPolicy: boolean;
  onApproveProposal: (proposalId: string) => Promise<{ conflict?: string }>;
  onOpenSkills: () => void;
  onClose: () => void;
  embedded?: boolean;
}) {
  const [proposals, setProposals] = useState<CanvasProposal[]>([]);
  const [policy, setPolicy] = useState<AgentPolicy>("plan_only");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const req = useCallback(
    async (path: string, body?: unknown, method?: string) => {
      const res = await fetch(path, {
        method: method || (body === undefined ? "GET" : "POST"),
        credentials: "same-origin",
        headers: {
          "X-Workspace-Id": String(workspace),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok)
        throw new Error(typeof json.detail === "string" ? json.detail : "请求失败");
      return json;
    },
    [workspace],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [pRes, polRes] = await Promise.all([
        req(`/api/canvases/${projectId}/proposals`),
        req("/api/workspace/agent-policy"),
      ]);
      setProposals(pRes.proposals || []);
      if (polRes.execution_policy) setPolicy(polRes.execution_policy);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId, req]);

  useEffect(() => {
    void load();
  }, [load]);

  const updatePolicy = async (next: AgentPolicy) => {
    setBusy(true);
    setError("");
    try {
      const res = await req(
        "/api/workspace/agent-policy",
        { execution_policy: next },
        "PUT",
      );
      setPolicy(res.execution_policy);
      setNotice(`已切换 Agent 安全模式为「${POLICY_LABELS[next]}」`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const approve = async (p: CanvasProposal) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await onApproveProposal(p.id);
      await load();
      if (res?.conflict) {
        setError(res.conflict);
      } else {
        setNotice(`提案「${p.title}」已原子落图（不自动触发扣费生成）`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reject = async (p: CanvasProposal) => {
    setBusy(true);
    setError("");
    try {
      await req(`/api/canvases/${projectId}/proposals/${p.id}/reject`, {});
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside
      className={embedded ? "fm-agent-dock-embedded" : "fm-agent-dock"}
      aria-label="提案式画布 Agent 停靠栏"
    >
      {!embedded && (
        <div className="fm-docked-head">
          <strong>
            <Sparkles size={15} /> 画布 Agent 提案箱
          </strong>
          <div className="fm-agent-head-btns">
            <button
              type="button"
              className="secondary"
              onClick={onOpenSkills}
              title="管理工作区 SKILL.md 技能包"
            >
              <BookOpen size={14} />
              Skills
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="关闭 Agent 提案箱"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      <div className="fm-policy-banner">
        <ShieldCheck size={15} />
        <div>
          <strong>安全执行模式</strong>
          {canEditPolicy ? (
            <select
              aria-label="工作区 Agent 安全执行策略"
              disabled={busy}
              value={policy}
              onChange={(e) => void updatePolicy(e.target.value as AgentPolicy)}
            >
              {(Object.entries(POLICY_LABELS) as [AgentPolicy, string][]).map(
                ([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ),
              )}
            </select>
          ) : (
            <span>{POLICY_LABELS[policy]}</span>
          )}
        </div>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="fm-pack-notice" role="status">
          {notice}
        </p>
      )}

      {loading ? (
        <p className="fm-series-muted">正在加载提案…</p>
      ) : proposals.length === 0 ? (
        <p className="fm-series-muted">
          外部 MCP（Claude Code / Cursor）或画布助手提交的结构化画布变更提案将出现在这里，审阅 Diff 与积分预估后再一键落图。
        </p>
      ) : (
        <div className="fm-proposal-list">
          {proposals.map((p) => (
            <article key={p.id} className={`fm-proposal-card status-${p.status}`}>
              <header>
                <strong>{p.title}</strong>
                <span className="fm-proposal-status">
                  {p.status === "pending"
                    ? "待审批"
                    : p.status === "applied"
                      ? `已落图 v${p.applied_revision}`
                      : "已拒绝"}
                </span>
              </header>
              {p.summary && <p className="fm-proposal-summary">{p.summary}</p>}
              <ul className="fm-proposal-ops">
                {p.operations.slice(0, 8).map((op, i) => (
                  <li key={i}>
                    {op.op === "add_node"
                      ? `+ 新增 ${op.type} 节点「${op.title || op.temp_id}」`
                      : op.op === "update_node"
                        ? `~ 修改节点 ${op.id}`
                        : op.op === "remove_node"
                          ? `- 删除节点 ${op.id}`
                          : op.op === "add_edge"
                            ? `→ 连线 ${op.source} → ${op.target}`
                            : op.op === "set_shots"
                              ? `≡ 重排分镜 (${op.shots?.length ?? 0} 镜)`
                              : op.op}
                  </li>
                ))}
                {p.operations.length > 8 && (
                  <li>…共 {p.operations.length} 项原子操作</li>
                )}
              </ul>
              <footer>
                <span>后续渲染预估：{p.estimated_credits} 积分（落图本身 0 积分）</span>
                {p.status === "pending" && (
                  <div className="fm-proposal-btns">
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => void reject(p)}
                    >
                      拒绝
                    </button>
                    <button
                      type="button"
                      className="primary"
                      disabled={busy}
                      onClick={() => void approve(p)}
                    >
                      <Check size={14} />
                      批准落图
                    </button>
                  </div>
                )}
              </footer>
            </article>
          ))}
        </div>
      )}
    </aside>
  );
}
