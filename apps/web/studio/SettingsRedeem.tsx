import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "./api";

type RedeemCodeRow = {
  id: string;
  code_prefix: string;
  batch_id: string;
  name: string;
  credits: number;
  max_uses: number;
  uses: number;
  enabled: boolean;
  expires_at: string | null;
  created_at: string;
};

type BatchResult = {
  batch_id: string;
  name: string;
  credits: number;
  count: number;
  codes: { id: string; code: string; credits: number }[];
};

export function SettingsRedeem({
  notify,
}: {
  notify: (msg: string) => void;
}) {
  const [codes, setCodes] = useState<RedeemCodeRow[]>([]);
  const [name, setName] = useState("活动赠礼兑换码");
  const [credits, setCredits] = useState(100);
  const [count, setCount] = useState(5);
  const [maxUses, setMaxUses] = useState(1);
  const [expiresDays, setExpiresDays] = useState(30);
  const [minted, setMinted] = useState<BatchResult | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api<{ codes: RedeemCodeRow[] }>(
        null,
        "/api/admin/redeem-codes",
      );
      setCodes(res.codes);
    } catch (err) {
      notify((err as Error).message || "加载兑换码失败");
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  async function mintBatch(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api<BatchResult>(
        null,
        "/api/admin/redeem-codes/batch",
        {
          name: name.trim(),
          credits: Number(credits),
          count: Number(count),
          max_uses: Number(maxUses),
          expires_in_days: expiresDays > 0 ? Number(expiresDays) : null,
        },
        "POST",
      );
      setMinted(res);
      notify(`已批量签发 ${res.count} 张兑换码`);
      await load();
    } catch (err) {
      notify((err as Error).message || "签发兑换码失败");
    } finally {
      setBusy(false);
    }
  }

  async function disableCode(id: string) {
    try {
      await api(null, `/api/admin/redeem-codes/${encodeURIComponent(id)}/disable`, {}, "POST");
      notify("兑换码已停用");
      await load();
    } catch (err) {
      notify((err as Error).message || "停用失败");
    }
  }

  return (
    <section className="settings-section">
      <h2>批量兑换码管理（F034）</h2>
      <p className="console-description">
        批量签发一次性或限次积分兑换码（仅服务端保存 SHA-256 摘要，明文仅在签发时展示一次）。
      </p>

      <section className="ledger-card" style={{ marginBottom: 16 }}>
        <h3>签发新批次</h3>
        <form
          onSubmit={mintBatch}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 10,
            alignItems: "end",
          }}
        >
          <label>
            批次名称
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            单码积分
            <input
              type="number"
              min={1}
              value={credits}
              onChange={(e) => setCredits(Number(e.target.value))}
            />
          </label>
          <label>
            生成张数
            <input
              type="number"
              min={1}
              max={100}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </label>
          <label>
            每张可用次数
            <input
              type="number"
              min={1}
              value={maxUses}
              onChange={(e) => setMaxUses(Number(e.target.value))}
            />
          </label>
          <label>
            有效天数（0 为永久）
            <input
              type="number"
              min={0}
              value={expiresDays}
              onChange={(e) => setExpiresDays(Number(e.target.value))}
            />
          </label>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "签发中…" : "批量生成"}
          </button>
        </form>

        {minted && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>本次签发明文（请及时复制保存）：</strong>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(
                    minted.codes.map((c) => c.code).join("\n"),
                  );
                  notify("已复制全部兑换码");
                }}
              >
                复制全部
              </button>
            </div>
            <pre
              style={{
                marginTop: 6,
                padding: 10,
                borderRadius: 8,
                background: "rgba(128,128,128,0.12)",
                fontSize: 12,
                overflowX: "auto",
              }}
            >
              {minted.codes.map((c) => `${c.code}  (+${c.credits} 积分)`).join("\n")}
            </pre>
          </div>
        )}
      </section>

      <section className="ledger-card">
        <h3>已签发兑换码列表（{codes.length}）</h3>
        <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
          {codes.map((c) => (
            <div
              key={c.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                borderRadius: 6,
                border: "1px solid rgba(128,128,128,0.18)",
              }}
            >
              <div>
                <code>{c.code_prefix}</code> · <strong>{c.name}</strong> ·{" "}
                {c.credits} 积分 · 已用 {c.uses}/{c.max_uses} ·{" "}
                {c.enabled ? "有效" : "已停用"}
              </div>
              {c.enabled && (
                <button type="button" onClick={() => void disableCode(c.id)}>
                  停用
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}
