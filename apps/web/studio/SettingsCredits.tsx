import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { api } from "./api";
import { openDialogFor } from "./AssetDialog";
import { Icon } from "./Icon";
import {
  creditDecimal,
  displayCredits,
  evaluateRechargeYuan,
  formatRechargeRangeHint,
} from "./settings-credits-helpers";
import type { CreditEntry, StudioState } from "./state";

type Notify = (message: string) => void;
type Order = {
  id: string;
  workspace: number;
  method: string;
  method_label?: string;
  amount: number;
  credits: number;
  created: number;
  state: string;
  can_pay: boolean;
  payment_url: string;
  warning?: string;
};
export type RechargeConfig = {
  min_yuan: number;
  max_yuan: number;
  methods: { id: string; label: string; notice?: string }[];
  orders: Order[];
};

const creditLabels: Record<string, string> = {
  reserve: "冻结",
  spend: "扣除",
  refund: "退回",
  adjust: "调整",
  recharge: "充值",
};
const orderLabels: Record<string, string> = {
  pending: "待支付",
  paid: "已到账",
  expired: "已过期",
  unconfirmed: "待核对",
};
const orderHints: Record<string, string> = {
  paid: "积分已加入原充值空间。",
  unconfirmed: "支付通道尚未确认订单，请稍后刷新或联系管理员核对。",
  expired: "订单已过期，请新建充值订单。已付款的订单确认后仍会到账。",
};

function date(stamp: number) {
  return new Date(stamp * 1000).toLocaleString();
}
function mergeCreditRows(rows: CreditEntry[], incoming: CreditEntry[]) {
  return Array.from(
    new Map([...rows, ...incoming].map((row) => [row.id, row])).values(),
  ).sort((a, b) => b.id - a.id);
}
export function readOrder(workspace: number, id: string) {
  return api<Order>(
    String(workspace),
    "/api/recharge/orders/" + encodeURIComponent(id),
  );
}

export function Credits({
  state,
  recharge,
  history,
  refresh,
  rechargePending,
  notify,
}: {
  state: StudioState;
  recharge: (button: HTMLButtonElement) => void;
  history: (button: HTMLButtonElement) => void;
  refresh?: () => Promise<void>;
  rechargePending?: "recharge" | "history";
  notify: Notify;
}) {
  const { credits, workspace_id: workspace } = state;
  const latest = state.credit_history;
  const [previous, setPrevious] = useState(latest);
  const [ledger, setLedger] = useState({
    rows: latest,
    before: latest.length === 50 ? latest.at(-1)?.id : undefined,
    epoch: 0,
  });
  const { rows, before, epoch } = ledger;
  const [busy, setBusy] = useState(false);
  const [redeemInput, setRedeemInput] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [statementFrom, setStatementFrom] = useState("");
  const [statementTo, setStatementTo] = useState("");
  const [inviteSummary, setInviteSummary] = useState<{
    total_invited: number;
    total_granted_credits: number;
    pending_claim_count: number;
    pending_claim_credits: number;
  } | null>(null);

  useEffect(() => {
    let active = true;
    void api<{
      total_invited: number;
      total_granted_credits: number;
      pending_claim_count: number;
      pending_claim_credits: number;
    }>(String(workspace), "/api/invites/rewards")
      .catch(() => null)
      .then((inviteRes) => {
        if (active && inviteRes) setInviteSummary(inviteRes);
      });
    return () => {
      active = false;
    };
  }, [workspace]);

  async function redeemCode(e: FormEvent) {
    e.preventDefault();
    if (!redeemInput.trim()) return;
    setRedeeming(true);
    try {
      const res = await api<{ credits: number; name: string }>(
        String(workspace),
        "/api/redeem",
        { code: redeemInput.trim() },
        "POST",
      );
      setRedeemInput("");
      notify(`兑换成功：+${res.credits} 积分（${res.name}）`);
      await refresh?.();
    } catch (err) {
      notify((err as Error).message || "兑换失败");
    } finally {
      setRedeeming(false);
    }
  }

  async function claimRewards() {
    try {
      const res = await api<{ claimed_count: number; claimed_credits: number }>(
        String(workspace),
        "/api/invites/rewards/claim",
        {},
        "POST",
      );
      notify(
        res.claimed_credits > 0
          ? `已领取邀请返佣 +${res.claimed_credits} 积分`
          : "当前暂无可领取的邀请返佣",
      );
      await refresh?.();
      const updated = await api<{
        total_invited: number;
        total_granted_credits: number;
        pending_claim_count: number;
        pending_claim_credits: number;
      }>(String(workspace), "/api/invites/rewards");
      setInviteSummary(updated);
    } catch (err) {
      notify((err as Error).message || "领取返佣失败");
    }
  }

  async function downloadStatement(format: "csv" | "pdf") {
    try {
      const qs = new URLSearchParams({ format });
      if (statementFrom) qs.set("from", statementFrom);
      if (statementTo) qs.set("to", statementTo);
      const resp = await fetch(`/api/credits/statement?${qs.toString()}`, {
        credentials: "same-origin",
        headers: { "X-Workspace-Id": String(workspace) },
      });
      if (!resp.ok) {
        const errJson = await resp.json().catch(() => null);
        throw new Error(errJson?.detail || "对账单导出失败");
      }
      const total = resp.headers.get("X-Total-Count");
      const exported = resp.headers.get("X-Exported-Count");
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fumiao-statement-ws${workspace}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      if (total && exported) {
        notify(`已导出 ${exported} / ${total} 条对账记录（${format.toUpperCase()}）`);
      }
    } catch (err) {
      notify((err as Error).message || "对账单导出失败");
    }
  }

  if (previous !== latest) {
    setPrevious(latest);
    if (
      latest.length === 50 &&
      (!rows.length || latest.at(-1)!.id > rows[0].id)
    ) {
      setLedger({ rows: latest, before: latest.at(-1)?.id, epoch: epoch + 1 });
    } else {
      setLedger({ ...ledger, rows: mergeCreditRows(rows, latest) });
    }
  }

  async function more(button: HTMLButtonElement) {
    if (busy || before === undefined) return;
    const startEpoch = epoch;
    setBusy(true);
    try {
      const result = await api<{ history: CreditEntry[] }>(
        String(workspace),
        "/api/credits?before=" + before,
      );
      if (!button.isConnected) return;
      setLedger((current) =>
        current.epoch !== startEpoch
          ? current
          : {
              ...current,
              rows: mergeCreditRows(current.rows, result.history),
              before:
                result.history.length === 50
                  ? result.history.at(-1)?.id
                  : undefined,
            },
      );
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-section">
      <div className="recharge-heading">
        <h2>积分</h2>
        <button
          className="primary"
          data-act="recharge"
          disabled={!!rechargePending}
          onClick={(event) => recharge(event.currentTarget)}
        >
          {rechargePending === "recharge" ? "正在加载…" : "充值"}
        </button>
      </div>
      <div className="credit-summary">
        <div>
          <span>可用积分</span>
          <strong>{displayCredits(credits.exact?.available ?? credits.available)}</strong>
        </div>
        <div>
          <span>冻结积分</span>
          <strong>{displayCredits(credits.exact?.reserved ?? credits.reserved)}</strong>
        </div>
      </div>
      <div className="recharge-info">
        <span>¥1 = 10 积分</span>
        <button
          className="quiet-button"
          data-act="recharge-history"
          disabled={!!rechargePending}
          onClick={(event) => history(event.currentTarget)}
        >
          {rechargePending === "history" ? "正在加载…" : "充值记录"}
        </button>
      </div>

      <section className="ledger-card" style={{ marginBottom: 14 }}>
        <h3 className="credit-heading">兑换码兑换积分</h3>
        <form
          onSubmit={redeemCode}
          style={{ display: "flex", gap: 8, alignItems: "center" }}
        >
          <input
            value={redeemInput}
            onChange={(e) => setRedeemInput(e.target.value)}
            placeholder="输入兑换码（如 FM-XXXX-XXXX-XXXX）"
            style={{ flex: 1 }}
          />
          <button type="submit" className="primary" disabled={redeeming}>
            {redeeming ? "兑换中…" : "立即兑换"}
          </button>
        </form>
      </section>

      {inviteSummary && (
        <section className="ledger-card" style={{ marginBottom: 14 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div>
              <h3 className="credit-heading" style={{ margin: 0 }}>
                邀请返佣
              </h3>
              <small>
                已邀请 {inviteSummary.total_invited} 人 · 累计获得{" "}
                {inviteSummary.total_granted_credits} 积分
                {inviteSummary.pending_claim_credits > 0
                  ? ` · 待领取 ${inviteSummary.pending_claim_credits} 积分`
                  : ""}
              </small>
            </div>
            {inviteSummary.pending_claim_credits > 0 && (
              <button
                type="button"
                className="primary"
                onClick={() => void claimRewards()}
              >
                一键领取 +{inviteSummary.pending_claim_credits} 积分
              </button>
            )}
          </div>
        </section>
      )}

      <section className="ledger-card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: 12,
          }}
        >
          <h3 className="credit-heading" style={{ margin: 0 }}>
            积分明细
          </h3>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <input
              type="date"
              aria-label="对账单开始日期"
              value={statementFrom}
              onChange={(e) => setStatementFrom(e.target.value)}
              style={{ width: "auto", height: 34, minHeight: 34 }}
            />
            <span style={{ fontSize: 13, color: "var(--secondary)" }}>至</span>
            <input
              type="date"
              aria-label="对账单结束日期"
              value={statementTo}
              onChange={(e) => setStatementTo(e.target.value)}
              style={{ width: "auto", height: 34, minHeight: 34 }}
            />
            <button
              type="button"
              className="secondary"
              onClick={() => void downloadStatement("csv")}
            >
              导出 CSV 对账单
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => void downloadStatement("pdf")}
            >
              导出 PDF 对账单
            </button>
          </div>
        </div>
        <CreditLedger rows={rows} />
        {before !== undefined && (
          <div className="ledger-list-more">
            <button
              className="quiet-button"
              data-act="credit-more"
              data-before={before}
              disabled={busy}
              onClick={(event) => void more(event.currentTarget)}
            >
              {busy ? "正在加载…" : "加载更多"}
            </button>
          </div>
        )}
      </section>
    </section>
  );
}

export function CreditLedger({ rows }: { rows: CreditEntry[] }) {
  return (
    <div className="credit-ledger">
      {rows.length ? (
        rows.map((row) => {
          const amount = creditDecimal(row.exact?.amount ?? row.amount);
          const balance = row.exact?.balance ?? row.balance;
          const prefix =
            row.action === "spend"
              ? "−"
              : (row.action === "adjust" || row.action === "recharge") &&
                  !amount.startsWith("-") &&
                  amount !== "0"
                ? "+"
                : "";
          return (
            <div key={row.id} className="credit-ledger-row">
              <div>
                <strong>
                  {(creditLabels[row.action] || row.action) +
                    (row.job ? " · #" + row.job : "")}
                </strong>
                <small>
                  {(row.actor_name || "") + (row.note ? " · " + row.note : "")}
                </small>
              </div>
              <div className="credit-entry-amounts">
                <span className="credit-amount">{prefix + amount}</span>
                {balance != null && (
                  <span className="credit-entry-balance">
                    余额 {displayCredits(balance)}
                  </span>
                )}
              </div>
              <time>{date(row.created)}</time>
            </div>
          );
        })
      ) : (
        <p className="empty-note">暂无记录</p>
      )}
    </div>
  );
}

export function RechargeForm({
  config,
  state,
  detail,
}: {
  config: RechargeConfig;
  state: StudioState;
  detail: (order: Order) => void;
}) {
  const workspace = state.workspaces.find(
    ({ id }) => id === state.workspace_id,
  );
  const initialYuan = String(
    Math.min(Math.max(10, config.min_yuan), config.max_yuan),
  );
  const [yuan, setYuan] = useState(initialYuan);
  const [badInput, setBadInput] = useState(false);
  const amountField = useRef<HTMLInputElement>(null);
  const [method, setMethod] = useState(config.methods[0]?.id ?? "");
  const notice = config.methods.find((option) => option.id === method)?.notice;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const request = useRef({ fingerprint: "", uid: "" });
  const hasMethods = config.methods.length > 0;
  const controlsDisabled = busy || !hasMethods;
  const evaluation = evaluateRechargeYuan(yuan, config, badInput);
  const inlineError = hasMethods ? evaluation.error : "";

  useLayoutEffect(() => {
    amountField.current?.setCustomValidity(inlineError);
  }, [inlineError]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (
      busy ||
      !hasMethods ||
      !method ||
      !evaluation.valid ||
      evaluation.amount === null ||
      !form.reportValidity()
    )
      return;
    const payload = {
      workspace: state.workspace_id,
      yuan: evaluation.amount,
      method,
    };
    const fingerprint = JSON.stringify(payload);
    if (fingerprint !== request.current.fingerprint)
      request.current = { fingerprint, uid: crypto.randomUUID() };
    setBusy(true);
    setMessage("正在创建订单…");
    try {
      const order = await api<Order>(
        String(state.workspace_id),
        "/api/recharge/orders",
        { ...payload, uid: request.current.uid },
      );
      if (openDialogFor(form)) detail(order);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form id="recharge-form" className="recharge-form" onSubmit={submit}>
      <h2 id="modal-heading">充值积分</h2>
      <p className="recharge-destination">
        充值到 <strong>{workspace?.name || "当前空间"}</strong>
        {workspace?.kind === "team" ? " · 团队共用" : ""}
      </p>
      <div className="recharge-amount-group">
        <label className="formlabel" htmlFor="recharge-yuan">
          充值金额（元）
          <input
            id="recharge-yuan"
            name="yuan"
            type="number"
            min={config.min_yuan}
            max={config.max_yuan}
            step="1"
            ref={amountField}
            defaultValue={initialYuan}
            inputMode="numeric"
            required
            disabled={controlsDisabled}
            aria-invalid={Boolean(inlineError) || undefined}
            aria-describedby={
              inlineError
                ? "recharge-yuan-hint recharge-yuan-error"
                : "recharge-yuan-hint"
            }
            onChange={(event) => {
              const nextValue = event.currentTarget.value;
              const nextBad = event.currentTarget.validity.badInput;
              const nextEval = evaluateRechargeYuan(nextValue, config, nextBad);
              event.currentTarget.setCustomValidity(
                hasMethods ? nextEval.error : "",
              );
              setYuan(nextValue);
              setBadInput(nextBad);
              if (message) setMessage("");
            }}
          />
        </label>
        <p id="recharge-yuan-hint" className="recharge-field-hint">
          {formatRechargeRangeHint(config.min_yuan, config.max_yuan)}
        </p>
        {inlineError && (
          <p
            id="recharge-yuan-error"
            className="recharge-field-error"
            role="alert"
          >
            {inlineError}
          </p>
        )}
      </div>
      <div className="recharge-presets">
        {[1, 10, 50, 100].map((preset) => (
          <button
            key={preset}
            type="button"
            className="profile-secondary"
            data-yuan={preset}
            aria-pressed={evaluation.valid && evaluation.amount === preset}
            disabled={
              controlsDisabled ||
              preset < config.min_yuan ||
              preset > config.max_yuan
            }
            onClick={() => {
              if (!amountField.current) return;
              const nextValue = String(preset);
              const nextEval = evaluateRechargeYuan(nextValue, config, false);
              amountField.current.value = nextValue;
              amountField.current.setCustomValidity(
                hasMethods ? nextEval.error : "",
              );
              setYuan(nextValue);
              setBadInput(false);
              if (message) setMessage("");
            }}
          >{`¥${preset}`}</button>
        ))}
      </div>
      <div className="recharge-total">
        <span>到账积分</span>
        <strong id="recharge-total" key={method}>
          {evaluation.credits !== null
            ? evaluation.credits.toLocaleString()
            : "—"}
        </strong>
      </div>
      <p className="recharge-rate">¥1 = 10 积分</p>
      <fieldset className="recharge-methods">
        <legend>付款方式</legend>
        {hasMethods ? (
          config.methods.map((option) => (
            <label key={option.id}>
              <input
                type="radio"
                name="method"
                value={option.id}
                defaultChecked={option.id === config.methods[0].id}
                disabled={busy}
                onChange={() => setMethod(option.id)}
              />
              <span>{option.label}</span>
            </label>
          ))
        ) : (
          <p>充值暂不可用，请稍后再试</p>
        )}
      </fieldset>
      {notice && <p className="recharge-network">{notice}</p>}
      <p
        className="form-message"
        data-tone={busy ? "status" : undefined}
        role="alert"
      >
        {message}
      </p>
      <button
        className="primary"
        type="submit"
        disabled={controlsDisabled || !evaluation.valid}
      >
        创建充值订单
      </button>
    </form>
  );
}

export function RechargeHistory({
  config,
  workspace,
  detail,
  notify,
}: {
  config: RechargeConfig;
  workspace: number;
  detail: (id: string, button: HTMLButtonElement) => void;
  notify: Notify;
}) {
  const [orders, setOrders] = useState(config.orders);
  const [before, setBefore] = useState(
    orders.length === 30 ? orders.at(-1)?.id : undefined,
  );
  const [busy, setBusy] = useState(false);
  async function more(button: HTMLButtonElement) {
    if (busy || before === undefined) return;
    setBusy(true);
    try {
      const next = await api<RechargeConfig>(
        String(workspace),
        "/api/recharge?before=" + encodeURIComponent(before),
      );
      if (!openDialogFor(button)) return;
      setOrders((orders) => [...orders, ...next.orders]);
      setBefore(next.orders.length === 30 ? next.orders.at(-1)?.id : undefined);
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h2 id="modal-heading">充值记录</h2>
      <div className="recharge-orders">
        {orders.length ? (
          orders.map((order) => (
            <button
              key={order.id}
              className="recharge-order-row"
              data-act="recharge-order"
              data-order={order.id}
              onClick={(event) => detail(order.id, event.currentTarget)}
            >
              <span>
                <strong>{`¥${(order.amount / 100).toFixed(2)} · ${order.credits.toLocaleString()} 积分`}</strong>
                <small>{`${date(order.created)} · ${order.method_label ?? order.method}`}</small>
              </span>
              <span>
                {(orderLabels[order.state] || "待核对") + " "}
                <Icon name="chevron" />
              </span>
            </button>
          ))
        ) : (
          <p className="empty-note">暂无充值记录</p>
        )}
      </div>
      {before !== undefined && (
        <div className="ledger-list-more">
          <button
            className="quiet-button"
            id="recharge-more"
            disabled={busy}
            onClick={(event) => void more(event.currentTarget)}
          >
            加载更多
          </button>
        </div>
      )}
    </>
  );
}

export function RechargeOrder({
  initial,
  state,
  refresh,
  notify,
}: {
  initial: Order;
  state: StudioState;
  refresh: () => Promise<void>;
  notify: Notify;
}) {
  const section = useRef<HTMLElement>(null);
  const check = useRef<HTMLButtonElement>(null);
  const checking = useRef(false);
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState(initial);
  const [message, setMessage] = useState(initial.warning || "");
  const paid = order.state === "paid";
  const workspace = state.workspaces.find(({ id }) => id === initial.workspace);

  useEffect(() => {
    // The original dialog first focuses the pay link, then hides it.
    if (!initial.can_pay && document.activeElement === check.current)
      check.current?.blur();
  }, [initial.can_pay]);

  async function poll() {
    const panel = section.current;
    if (!panel || !openDialogFor(panel) || checking.current || document.hidden)
      return;
    checking.current = true;
    setBusy(true);
    try {
      const next = await readOrder(state.workspace_id, initial.id);
      if (!openDialogFor(panel)) return;
      setOrder(next);
      setMessage(next.warning || "");
      if (next.state === "paid") {
        await refresh();
        if (!paid) notify("充值成功，积分已到账");
      }
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      checking.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    const dialog = section.current && openDialogFor(section.current);
    if (!dialog || paid) return;
    const timer = window.setInterval(() => void poll(), 5000);
    const stop = () => window.clearInterval(timer);
    dialog.addEventListener("close", stop, { once: true });
    return () => {
      stop();
      dialog.removeEventListener("close", stop);
    };
  }, [paid]);

  return (
    <section ref={section} className="recharge-detail" data-order={initial.id}>
      <h2 id="modal-heading">充值订单</h2>
      <div className="recharge-order-total">
        <strong>{`${order.credits.toLocaleString()} 积分`}</strong>
        <span>{`¥${(order.amount / 100).toFixed(2)}`}</span>
      </div>
      <dl className="settings-facts">
        <dt>充值空间</dt>
        <dd>{workspace?.name || "原充值空间"}</dd>
        <dt>付款方式</dt>
        <dd>{order.method_label ?? order.method}</dd>
        <dt>订单号</dt>
        <dd className="recharge-order-id">{order.id}</dd>
      </dl>
      <p className="recharge-status" role="status">
        {orderLabels[order.state] || "待核对"}
      </p>
      <div className="recharge-actions">
        <a
          className="primary"
          id="recharge-pay"
          href={initial.payment_url}
          target="_blank"
          rel="noopener"
          hidden={!order.can_pay}
        >
          前往支付 ↗
        </a>
        {!paid && <button
          ref={check}
          className="profile-secondary"
          id="recharge-check"
          disabled={busy}
          onClick={() => void poll()}
        >
          {busy ? "正在查询…" : "刷新支付结果"}
        </button>}
      </div>
      <p className="recharge-hint">
        {orderHints[order.state] ||
          "付款后自动更新到账状态，关闭页面也不影响到账。"}
      </p>
      <p className="form-message" role="alert">
        {message}
      </p>
    </section>
  );
}
