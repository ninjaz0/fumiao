import { useCallback, useEffect, useState, type FormEvent } from "react";
import { creditUnits } from "@fumiao/plugin-sdk/credit-amount.js";
import { creditDecimal, displayCredits } from "./settings-credits-helpers";
import { api } from "./api";

type BudgetPolicy = {
  id: string;
  scope_type: "workspace" | "project";
  scope_id: string;
  project_public_id?: string | null;
  project_title?: string | null;
  period: "daily" | "monthly" | "total";
  warn_limit: number;
  cap_limit: number;
  mode: "observe" | "warn" | "cap";
  enabled: boolean;
  spent: number;
  held: number;
  total_committed: number;
  exact?: { spent: string; held: string; committed: string; warn_limit: string; cap_limit: string };
};

type BudgetProjectOption = {
  id: string;
  public_id: string;
  title: string;
};

type BudgetAlert = {
  id: string;
  project_id: string | null;
  projected_spend: number;
  warn_limit: number;
  cap_limit: number;
  exact?: { projected_spend: string; warn_limit: string; cap_limit: string };
  action: string;
  created_at: string;
};

type BudgetsPayload = {
  workspace_id: number;
  can_manage?: boolean;
  projects?: BudgetProjectOption[];
  policies: BudgetPolicy[];
  alerts: BudgetAlert[];
};

const periodNames: Record<string, string> = {
  daily: "每日预算",
  monthly: "月度预算",
  total: "累计总预算",
};

const modeNames: Record<string, string> = {
  observe: "仅记录观察",
  warn: "超阈告警放行",
  cap: "超上限硬拦截",
};

export function BudgetPolicyUsage({ policy: p }: { policy: BudgetPolicy }) {
  const committed = creditUnits(
    creditDecimal(p.exact?.committed ?? p.total_committed),
  );
  const cap = creditUnits(creditDecimal(p.exact?.cap_limit ?? p.cap_limit));
  const warn = creditUnits(creditDecimal(p.exact?.warn_limit ?? p.warn_limit));
  const pct =
    cap <= 0n
      ? 0
      : committed >= cap
        ? 100
        : Number((100n * committed + cap / 2n) / cap);
  const scopeTitle =
    p.scope_type === "project"
      ? `项目「${p.project_title || p.project_public_id || p.scope_id.slice(0, 8)}」· `
      : "工作区 · ";
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 8,
        border: "1px solid rgba(128,128,128,0.22)",
        opacity: p.enabled ? 1 : 0.6,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 6,
          fontSize: 13,
        }}
      >
        <strong>
          {scopeTitle}
          {periodNames[p.period] || p.period}（{modeNames[p.mode]}
          {p.enabled ? "" : " · 已停用"}）
        </strong>
        <span>
          已消耗 {displayCredits(p.exact?.spent ?? p.spent)} + 在途冻结{" "}
          {displayCredits(p.exact?.held ?? p.held)} / 上限{" "}
          {displayCredits(p.exact?.cap_limit ?? p.cap_limit)} 积分（告警{" "}
          {displayCredits(p.exact?.warn_limit ?? p.warn_limit)}）
        </span>
      </div>
      {cap > 0n && (
        <div
          style={{
            height: 6,
            marginTop: 6,
            borderRadius: 99,
            background: "rgba(128,128,128,0.2)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              background:
                committed >= cap
                  ? "#ef4444"
                  : warn > 0n && committed >= warn
                    ? "#f59e0b"
                    : "#10b981",
            }}
          />
        </div>
      )}
    </div>
  );
}

export function SettingsBudgets({
  workspace,
  notify,
}: {
  workspace: number;
  notify: (msg: string) => void;
}) {
  const [data, setData] = useState<BudgetsPayload | null>(null);
  const [scopeType, setScopeType] = useState<"workspace" | "project">("workspace");
  const [scopeProjectId, setScopeProjectId] = useState("");
  const [period, setPeriod] = useState<"daily" | "monthly" | "total">("monthly");
  const [warnLimit, setWarnLimit] = useState("500");
  const [capLimit, setCapLimit] = useState("1000");
  const [mode, setMode] = useState<"observe" | "warn" | "cap">("cap");
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api<BudgetsPayload>(String(workspace), "/api/budgets");
      setData(res);
      if (!scopeProjectId && res.projects?.length) {
        setScopeProjectId(res.projects[0].public_id);
      }
    } catch (err) {
      notify((err as Error).message || "加载预算策略失败");
    }
  }, [workspace, notify, scopeProjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const canManage = data ? Boolean(data.can_manage) : false;
  const projects = data?.projects ?? [];

  async function savePolicy(e: FormEvent) {
    e.preventDefault();
    if (scopeType === "project" && !scopeProjectId) {
      notify("请先选择一个画布项目");
      return;
    }
    setSaving(true);
    try {
      await api(
        String(workspace),
        "/api/budgets",
        {
          scope_type: scopeType,
          ...(scopeType === "project" ? { scope_id: scopeProjectId } : {}),
          period,
          warn_limit: warnLimit || "0",
          cap_limit: capLimit || "0",
          mode,
          enabled,
        },
        "PUT",
      );
      notify(scopeType === "project" ? "项目预算策略已保存" : "工作区预算策略已保存");
      await load();
    } catch (err) {
      notify((err as Error).message || "保存预算策略失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="settings-section">
      <h2>预算控制</h2>
      <p className="console-description">
        为当前工作区或指定画布项目配置「预估 → 锁定 →
        核销」三段式预算阈值与超限保护。
      </p>

      {data && !canManage && (
        <p className="console-description" style={{ color: "#f59e0b" }}>
          当前账号为普通成员，仅工作区负责人或管理员可修改预算策略。
        </p>
      )}

      <section className="ledger-card" style={{ marginBottom: 16 }}>
        <h3>
          {canManage ? "配置工作区 / 项目预算策略" : "当前生效的预算策略"}
        </h3>
        {canManage && (
          <form
            onSubmit={savePolicy}
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 10,
              alignItems: "end",
            }}
          >
            <label>
              生效范围
              <select
                value={scopeType}
                onChange={(e) =>
                  setScopeType(e.target.value as "workspace" | "project")
                }
              >
                <option value="workspace">整个工作区</option>
                <option value="project">指定画布项目</option>
              </select>
            </label>
            {scopeType === "project" && (
              <label>
                目标项目
                <select
                  value={scopeProjectId}
                  disabled={projects.length === 0}
                  onChange={(e) => setScopeProjectId(e.target.value)}
                >
                  {projects.length === 0 ? (
                    <option value="">暂无画布项目</option>
                  ) : (
                    projects.map((proj) => (
                      <option key={proj.id} value={proj.public_id}>
                        {proj.title}（{proj.public_id.slice(0, 8)}）
                      </option>
                    ))
                  )}
                </select>
              </label>
            )}
            <label>
              统计周期
              <select
                value={period}
                onChange={(e) =>
                  setPeriod(e.target.value as "daily" | "monthly" | "total")
                }
              >
                <option value="daily">每日预算</option>
                <option value="monthly">月度预算</option>
                <option value="total">累计预算</option>
              </select>
            </label>
            <label>
              告警阈值（积分）
              <input
                type="number"
                min={0}
                max={100_000_000}
                step="0.000000000001"
                value={warnLimit}
                onChange={(e) => setWarnLimit(e.target.value)}
              />
            </label>
            <label>
              硬上限（积分）
              <input
                type="number"
                min={0}
                max={100_000_000}
                step="0.000000000001"
                value={capLimit}
                onChange={(e) => setCapLimit(e.target.value)}
              />
            </label>
            <label>
              执行模式
              <select
                value={mode}
                onChange={(e) =>
                  setMode(e.target.value as "observe" | "warn" | "cap")
                }
              >
                <option value="observe">仅观察</option>
                <option value="warn">达阈告警</option>
                <option value="cap">超限拦截</option>
              </select>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              启用此策略
            </label>
            <button
              type="submit"
              className="primary"
              disabled={saving || (scopeType === "project" && !scopeProjectId)}
            >
              保存预算策略
            </button>
          </form>
        )}

        {!data && (
          <p className="console-description" style={{ marginBottom: 0 }}>
            正在加载预算策略…
          </p>
        )}

        {data && !canManage && data.policies.length === 0 && (
          <p className="console-description" style={{ marginBottom: 0 }}>
            当前工作区暂未配置预算策略。
          </p>
        )}

        {data && data.policies.length > 0 && (
          <div
            style={{ display: "grid", gap: 8, marginTop: canManage ? 14 : 0 }}
          >
            {data.policies.map((policy) => (
              <BudgetPolicyUsage key={policy.id} policy={policy} />
            ))}
          </div>
        )}
      </section>

      {data && data.alerts.length > 0 && (
        <section className="ledger-card">
          <h3>近期预算告警（{data.alerts.length}）</h3>
          <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
            {data.alerts.map((a) => (
              <div key={a.id}>
                <code>{new Date(a.created_at).toLocaleString()}</code> ·
                预计消耗{" "}
                <strong>
                  {displayCredits(
                    a.exact?.projected_spend ?? a.projected_spend,
                  )}
                </strong>{" "}
                积分（告警阈值{" "}
                {displayCredits(a.exact?.warn_limit ?? a.warn_limit)} / 上限{" "}
                {displayCredits(a.exact?.cap_limit ?? a.cap_limit)}）
              </div>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
