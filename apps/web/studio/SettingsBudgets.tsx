import { useCallback, useEffect, useState, type FormEvent } from "react";
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
  action: string;
  created_at: string;
};

type BudgetsPayload = {
  workspace_id: number;
  can_manage?: boolean;
  projects?: BudgetProjectOption[];
  policies: BudgetPolicy[];
  alerts: BudgetAlert[];
  moderation: {
    auto_rewrite: boolean;
    max_attempts: number;
  };
};

const periodNames: Record<string, string> = {
  daily: "每日预算",
  monthly: "月度预算",
  total: "累计总预算",
};

const modeNames: Record<string, string> = {
  observe: "仅记录观察",
  warn: "超阈告警放行",
  cap: "超上限硬拦截 (402)",
};

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
  const [warnLimit, setWarnLimit] = useState(500);
  const [capLimit, setCapLimit] = useState(1000);
  const [mode, setMode] = useState<"observe" | "warn" | "cap">("cap");
  const [enabled, setEnabled] = useState(true);
  const [autoRewrite, setAutoRewrite] = useState(false);
  const [maxAttempts, setMaxAttempts] = useState(2);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api<BudgetsPayload>(String(workspace), "/api/budgets");
      setData(res);
      setAutoRewrite(res.moderation.auto_rewrite);
      setMaxAttempts(res.moderation.max_attempts);
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

  const canManage = data?.can_manage ?? true;
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
          warn_limit: Math.max(0, Math.round(warnLimit)),
          cap_limit: Math.max(0, Math.round(capLimit)),
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

  async function saveModeration(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api(
        String(workspace),
        "/api/budgets/moderation",
        {
          auto_rewrite: autoRewrite,
          max_attempts: maxAttempts,
        },
        "PUT",
      );
      notify("内容安全改写策略已更新");
      await load();
    } catch (err) {
      notify((err as Error).message || "保存安全策略失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="settings-section">
      <h2>预算控制与安全风控</h2>
      <p className="console-description">
        为当前工作区或指定画布项目配置「预估 → 锁定 → 核销」三段式预算阈值，并管理敏感词拦截后的无二次计费自动改写重试策略。
      </p>

      {!canManage && (
        <p className="console-description" style={{ color: "#f59e0b" }}>
          当前账号为普通成员，仅工作区负责人或管理员可修改预算与内容安全策略。
        </p>
      )}

      <section className="ledger-card" style={{ marginBottom: 16 }}>
        <h3>配置工作区 / 项目预算策略（F015）</h3>
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
              disabled={!canManage}
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
                disabled={!canManage || projects.length === 0}
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
              disabled={!canManage}
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
              disabled={!canManage}
              value={warnLimit}
              onChange={(e) => setWarnLimit(Number(e.target.value))}
            />
          </label>
          <label>
            硬上限（积分）
            <input
              type="number"
              min={0}
              disabled={!canManage}
              value={capLimit}
              onChange={(e) => setCapLimit(Number(e.target.value))}
            />
          </label>
          <label>
            执行模式
            <select
              value={mode}
              disabled={!canManage}
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
              disabled={!canManage}
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            启用此策略
          </label>
          <button
            type="submit"
            className="primary"
            disabled={saving || !canManage || (scopeType === "project" && !scopeProjectId)}
          >
            保存预算策略
          </button>
        </form>

        {data && data.policies.length > 0 && (
          <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
            {data.policies.map((p) => {
              const pct =
                p.cap_limit > 0
                  ? Math.min(
                      100,
                      Math.round((p.total_committed / p.cap_limit) * 100),
                    )
                  : 0;
              const scopeTitle =
                p.scope_type === "project"
                  ? `项目「${p.project_title || p.project_public_id || p.scope_id.slice(0, 8)}」· `
                  : "工作区 · ";
              return (
                <div
                  key={p.id}
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
                      已消耗 {p.spent} + 在途冻结 {p.held} / 上限 {p.cap_limit}{" "}
                      积分（告警 {p.warn_limit}）
                    </span>
                  </div>
                  {p.cap_limit > 0 && (
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
                            p.total_committed >= p.cap_limit
                              ? "#ef4444"
                              : p.total_committed >= p.warn_limit
                                ? "#f59e0b"
                                : "#10b981",
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="ledger-card" style={{ marginBottom: 16 }}>
        <h3>内容安全拦截自动改写重试（F024）</h3>
        <p className="console-description">
          仅当上游明确拒单且不计费（<code>moderation_blocked + rejected + billable=false</code>）时，自动将提示词改写为中性影视光影隐喻并重新入队；保留原始提示词审计记录，并严格复用原冻结额度，绝不二次扣费。
        </p>
        <form
          onSubmit={saveModeration}
          style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}
        >
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              disabled={!canManage}
              checked={autoRewrite}
              onChange={(e) => setAutoRewrite(e.target.checked)}
            />
            启用内容安全自动中性化改写重试
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            最大自动重试次数
            <select
              disabled={!canManage}
              value={maxAttempts}
              onChange={(e) => setMaxAttempts(Number(e.target.value))}
            >
              <option value={0}>0 次</option>
              <option value={1}>1 次</option>
              <option value={2}>2 次（上限）</option>
            </select>
          </label>
          <button
            type="submit"
            className="primary"
            disabled={saving || !canManage}
          >
            保存安全策略
          </button>
        </form>
      </section>

      {data && data.alerts.length > 0 && (
        <section className="ledger-card">
          <h3>近期预算告警（{data.alerts.length}）</h3>
          <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
            {data.alerts.map((a) => (
              <div key={a.id}>
                <code>{new Date(a.created_at).toLocaleString()}</code> · 预计消耗{" "}
                <strong>{a.projected_spend}</strong> 积分（告警阈值{" "}
                {a.warn_limit} / 上限 {a.cap_limit}）
              </div>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
