import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

type ApiToken = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  rate_limit_rpm: number;
  expires_at: number | null;
  revoked_at: number | null;
  last_used_at: number | null;
  created_at: number;
  creator: string;
};

type AgentPolicy = "plan_only" | "propose_and_confirm" | "auto_within_budget";

const SCOPE_LABELS: Record<string, string> = {
  "canvas:read": "读取画布",
  "canvas:propose": "提交画布提案",
  "canvas:write": "修改画布/导出",
  "job:submit": "提交扣费生成任务",
  "job:read": "查询任务状态",
  "asset:read": "读取资产",
  "asset:write": "上传资产",
  "pack:read": "读取素材包",
  "skill:read": "读取工作区技能",
  "skill:write": "编辑工作区技能",
  "mcp:use": "连接 MCP Server",
};

export function SettingsApiTokens({
  workspace,
  canEditPolicy,
  notify,
}: {
  workspace: number;
  canEditPolicy: boolean;
  notify: (msg: string) => void;
}) {
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [availableScopes, setAvailableScopes] = useState<string[]>(
    Object.keys(SCOPE_LABELS),
  );
  const [policy, setPolicy] = useState<AgentPolicy>("plan_only");
  const [name, setName] = useState("Claude Code / Cursor MCP");
  const [selectedScopes, setSelectedScopes] = useState<string[]>([
    "canvas:read",
    "canvas:propose",
    "pack:read",
    "job:read",
    "mcp:use",
  ]);
  const [rpm, setRpm] = useState(120);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [tRes, pRes] = (await Promise.all([
        api(String(workspace), "/api/tokens"),
        api(String(workspace), "/api/workspace/agent-policy"),
      ])) as [
        { tokens?: ApiToken[]; available_scopes?: string[] },
        { execution_policy?: AgentPolicy },
      ];
      setTokens(tRes.tokens || []);
      if (Array.isArray(tRes.available_scopes)) {
        setAvailableScopes(tRes.available_scopes);
      }
      if (pRes.execution_policy) setPolicy(pRes.execution_policy);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [workspace]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleScope = (scope: string) => {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  };

  const createToken = async () => {
    setBusy(true);
    setError("");
    try {
      const res = (await api(String(workspace), "/api/tokens", {
        name: name.trim(),
        scopes: selectedScopes,
        rate_limit_rpm: rpm,
      })) as { token: string };
      setCreatedSecret(res.token);
      notify("已签发工作区 Scoped API Token（请立即复制保存）");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const revokeToken = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      await api(String(workspace), `/api/tokens/${id}`, undefined, "DELETE");
      notify("已吊销该 API Token");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const savePolicy = async (next: AgentPolicy) => {
    setBusy(true);
    setError("");
    try {
      const res = (await api(
        String(workspace),
        "/api/workspace/agent-policy",
        { execution_policy: next },
        "PUT",
      )) as { execution_policy: AgentPolicy };
      setPolicy(res.execution_policy);
      notify("已更新工作区 Agent 安全执行策略");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const origin =
    typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
  const mcpSnippet = JSON.stringify(
    {
      mcpServers: {
        fumiao: {
          type: "http",
          url: `${origin}/api/mcp`,
          headers: {
            Authorization: `Bearer ${createdSecret || "<YOUR_FMK_TOKEN>"}`,
          },
        },
      },
    },
    null,
    2,
  );

  return (
    <div className="settings-section">
      <h2>API 与 MCP 接入</h2>
      <p className="console-description">
        签发工作区隔离的 Scoped API Token，将弗淼接入 Claude Code、Cursor 或自研自动化流水线。
        {" "}
        <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer">
          查看 OpenAPI 3.1 规范
        </a>
      </p>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="ledger-card">
        <h3>Agent 安全执行开关（防误烧费）</h3>
        <p className="console-description">
          默认开启「只建图不烧费 (plan_only)」，外部 MCP 与画布助手只能读取上下文与提交待审批提案，无法直接提交扣费生成任务。
        </p>
        <select
          aria-label="Agent 执行安全策略"
          disabled={busy || !canEditPolicy}
          value={policy}
          onChange={(e) => void savePolicy(e.target.value as AgentPolicy)}
        >
          <option value="plan_only">只建图不烧费 (plan_only · 推荐)</option>
          <option value="propose_and_confirm">
            允许授权 Token 提交任务 (propose_and_confirm)
          </option>
          <option value="auto_within_budget">
            预算上限内自动执行 (auto_within_budget)
          </option>
        </select>
      </div>

      <div className="ledger-card">
        <h3>签发工作区 API Token</h3>
        <div className="form-grid" style={{ display: "grid", gap: 10 }}>
          <label>
            名称
            <input
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            每分钟速率限制 (RPM)
            <input
              type="number"
              min={1}
              max={6000}
              value={rpm}
              onChange={(e) => setRpm(Number(e.target.value) || 120)}
            />
          </label>
          <div>
            <strong>权限范围 (Scopes)</strong>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
              {availableScopes.map((s) => (
                <label
                  key={s}
                  style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12 }}
                >
                  <input
                    type="checkbox"
                    checked={selectedScopes.includes(s)}
                    onChange={() => toggleScope(s)}
                  />
                  <span>{SCOPE_LABELS[s] || s}</span>
                </label>
              ))}
            </div>
          </div>
          <button
            type="button"
            className="primary"
            disabled={busy || !name.trim() || !selectedScopes.length}
            onClick={() => void createToken()}
          >
            {busy ? "签发中…" : "生成 Scoped API Token"}
          </button>
        </div>

        {createdSecret && (
          <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: "rgba(34,197,94,0.12)" }}>
            <strong>新 Token（仅显示一次，请妥善保管）：</strong>
            <pre style={{ overflow: "auto", margin: "6px 0" }}>{createdSecret}</pre>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                void navigator.clipboard.writeText(createdSecret);
                notify("已复制 Token");
              }}
            >
              复制 Token
            </button>
          </div>
        )}
      </div>

      <div className="ledger-card">
        <h3>MCP Server 连接配置（Claude Code / Cursor）</h3>
        <pre style={{ overflow: "auto", fontSize: 12 }}>{mcpSnippet}</pre>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            void navigator.clipboard.writeText(mcpSnippet);
            notify("已复制 MCP 配置 JSON");
          }}
        >
          一键复制 MCP JSON
        </button>
      </div>

      <div className="ledger-card">
        <h3>已签发 Token ({tokens.length})</h3>
        {tokens.length === 0 ? (
          <p className="console-description">当前工作区暂无 API Token。</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {tokens.map((t) => (
              <div
                key={t.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid rgba(128,128,128,0.22)",
                }}
              >
                <div>
                  <strong>
                    {t.name} <code>{t.prefix}…</code>
                  </strong>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>
                    {t.scopes.join(", ")} · {t.rate_limit_rpm} RPM
                    {t.revoked_at ? " · 已吊销" : ""}
                  </div>
                </div>
                {!t.revoked_at && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => void revokeToken(t.id)}
                  >
                    吊销
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
