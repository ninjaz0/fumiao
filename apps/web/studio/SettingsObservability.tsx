import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

type ChannelMetric = {
  model_key: string;
  plugin_id: string;
  kind: string;
  total: number;
  completed: number;
  failed: number;
  uncertain: number;
  cancelled: number;
  success_rate: number;
  p50_seconds: number;
  p95_seconds: number;
  credits_revenue: number;
  revenue_fen: number;
  upstream_cost_fen: number;
  gross_margin_fen: number;
  rewritten_count: number;
};

type SummaryResponse = {
  window_days: number;
  totals: {
    total_jobs: number;
    completed_jobs: number;
    failed_jobs: number;
    uncertain_jobs: number;
    overall_success_rate: number;
    credits_revenue: number;
    revenue_fen: number;
    upstream_cost_fen: number;
    gross_margin_fen: number;
    rewritten_jobs: number;
    total_gpu_nodes: number;
    online_gpu_nodes: number;
  };
  channels: ChannelMetric[];
};

type UncertainJob = {
  id: string;
  public_id: number | null;
  workspace_name: string;
  owner_name: string | null;
  model: string;
  plugin_id: string;
  kind: string;
  price: number;
  error: string | null;
  remote_id: string | null;
  created_at: string;
};

function yuan(fen: number): string {
  return `¥${(fen / 100).toFixed(2)}`;
}

export function SettingsObservability({
  notify,
}: {
  notify: (msg: string) => void;
}) {
  const [days, setDays] = useState(7);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [uncertain, setUncertain] = useState<UncertainJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [reconciling, setReconciling] = useState<string | null>(null);

  const load = useCallback(async (windowDays: number) => {
    setLoading(true);
    try {
      const [s, u] = await Promise.all([
        api<SummaryResponse>(
          null,
          `/api/admin/observability/summary?days=${windowDays}`,
        ),
        api<{ jobs: UncertainJob[] }>(
          null,
          "/api/admin/observability/uncertain",
        ),
      ]);
      setSummary(s);
      setUncertain(u.jobs);
    } catch (err) {
      notify((err as Error).message || "加载运营大盘失败");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void load(days);
  }, [days, load]);

  async function reconcile(jobId: string) {
    setReconciling(jobId);
    try {
      await api(
        null,
        `/api/admin/observability/jobs/${encodeURIComponent(jobId)}/reconcile`,
        {
          action: "refund",
          reason: "运营大盘人工核对确认未出片并退回冻结积分",
        },
        "POST",
      );
      notify("已完成核对并退回积分");
      await load(days);
    } catch (err) {
      notify((err as Error).message || "核对操作失败");
    } finally {
      setReconciling(null);
    }
  }

  return (
    <section className="settings-section">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div>
          <h2>运营可观测大盘</h2>
          <p className="console-description">
            监控全平台渠道成功率、P50/P95 耗时、营收与上游成本毛利，并支持对异常{" "}
            <code>uncertain</code> 任务一键人工核对退款。
          </p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              type="button"
              className={days === d ? "primary" : "quiet-button"}
              onClick={() => setDays(d)}
            >
              近 {d} 天
            </button>
          ))}
        </div>
      </div>

      {loading && !summary && <p>正在聚合运营指标…</p>}

      {summary && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 10,
              marginBottom: 16,
            }}
          >
            <div className="ledger-card">
              <small>总任务数</small>
              <div style={{ fontSize: 22, fontWeight: 700 }}>
                {summary.totals.total_jobs}
              </div>
              <small>
                完成 {summary.totals.completed_jobs} · 失败{" "}
                {summary.totals.failed_jobs}
              </small>
            </div>
            <div className="ledger-card">
              <small>综合成功率</small>
              <div style={{ fontSize: 22, fontWeight: 700 }}>
                {summary.totals.overall_success_rate}%
              </div>
              <small>待核对 {summary.totals.uncertain_jobs} 单</small>
            </div>
            <div className="ledger-card">
              <small>积分营收（估算）</small>
              <div style={{ fontSize: 22, fontWeight: 700 }}>
                {yuan(summary.totals.revenue_fen)}
              </div>
              <small>{summary.totals.credits_revenue} 积分</small>
            </div>
            <div className="ledger-card">
              <small>毛利（营收 - 成本）</small>
              <div style={{ fontSize: 22, fontWeight: 700 }}>
                {yuan(summary.totals.gross_margin_fen)}
              </div>
              <small>上游成本 {yuan(summary.totals.upstream_cost_fen)}</small>
            </div>
            <div className="ledger-card">
              <small>安全改写 / 在线 GPU</small>
              <div style={{ fontSize: 22, fontWeight: 700 }}>
                {summary.totals.rewritten_jobs} /{" "}
                {summary.totals.online_gpu_nodes}
              </div>
              <small>已配对 GPU 共 {summary.totals.total_gpu_nodes} 台</small>
            </div>
          </div>

          <section className="ledger-card" style={{ marginBottom: 16 }}>
            <h3>渠道与模型性能明细</h3>
            {summary.channels.length === 0 ? (
              <p className="console-description">该时间窗口内暂无生成任务。</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 13,
                  }}
                >
                  <thead>
                    <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(128,128,128,0.25)" }}>
                      <th style={{ padding: "8px 6px" }}>模型</th>
                      <th style={{ padding: "8px 6px" }}>插件 / 类型</th>
                      <th style={{ padding: "8px 6px" }}>任务数</th>
                      <th style={{ padding: "8px 6px" }}>成功率</th>
                      <th style={{ padding: "8px 6px" }}>P50 / P95</th>
                      <th style={{ padding: "8px 6px" }}>营收</th>
                      <th style={{ padding: "8px 6px" }}>成本</th>
                      <th style={{ padding: "8px 6px" }}>毛利</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.channels.map((ch) => (
                      <tr
                        key={`${ch.plugin_id}:${ch.model_key}:${ch.kind}`}
                        style={{ borderBottom: "1px solid rgba(128,128,128,0.12)" }}
                      >
                        <td style={{ padding: "8px 6px", fontWeight: 600 }}>
                          {ch.model_key}
                        </td>
                        <td style={{ padding: "8px 6px" }}>
                          <code>{ch.plugin_id}</code> · {ch.kind}
                        </td>
                        <td style={{ padding: "8px 6px" }}>
                          {ch.total}（成 {ch.completed} / 败 {ch.failed}）
                        </td>
                        <td style={{ padding: "8px 6px" }}>{ch.success_rate}%</td>
                        <td style={{ padding: "8px 6px" }}>
                          {ch.p50_seconds}s / {ch.p95_seconds}s
                        </td>
                        <td style={{ padding: "8px 6px" }}>
                          {yuan(ch.revenue_fen)}
                        </td>
                        <td style={{ padding: "8px 6px" }}>
                          {yuan(ch.upstream_cost_fen)}
                        </td>
                        <td style={{ padding: "8px 6px", fontWeight: 600 }}>
                          {yuan(ch.gross_margin_fen)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      <section className="ledger-card">
        <h3>待人工核对任务（uncertain · {uncertain.length}）</h3>
        {uncertain.length === 0 ? (
          <p className="console-description">当前无滞留的未确认任务。</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {uncertain.map((j) => (
              <div
                key={j.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid rgba(128,128,128,0.22)",
                }}
              >
                <div>
                  <strong>
                    #{j.public_id ?? j.id.slice(0, 8)} · {j.model}
                  </strong>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>
                    空间：{j.workspace_name} · 冻结 {j.price} 积分 ·{" "}
                    {j.error || "连接中断，等待核对"}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={reconciling === j.id}
                  onClick={() => void reconcile(j.id)}
                >
                  {reconciling === j.id ? "核对中…" : "人工核对退款"}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
