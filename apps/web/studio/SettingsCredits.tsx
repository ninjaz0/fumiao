import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "./api";
import { openDialogFor } from "./AssetDialog";
import { Icon } from "./Icon";
import type { CreditEntry, StudioState } from "./state";

type Notify = (message: string) => void;
type Order = {
  id: string;
  workspace: number;
  method: string;
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
  methods: { id: string; label: string }[];
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
function methodName(method: string) {
  return method === "alipay" ? "支付宝" : "USDT-Plasma";
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
  notify,
}: {
  state: StudioState;
  recharge: (button: HTMLButtonElement) => void;
  history: (button: HTMLButtonElement) => void;
  notify: Notify;
}) {
  const { credits, workspace_id: workspace } = state;
  const latest = state.credit_history;
  const [previous, setPrevious] = useState(latest);
  const [rows, setRows] = useState(latest);
  const [before, setBefore] = useState(
    latest.length === 50 ? latest.at(-1)?.id : undefined,
  );
  const [busy, setBusy] = useState(false);

  if (previous !== latest) {
    setPrevious(latest);
    if (
      latest.length === 50 &&
      (!rows.length || latest.at(-1)!.id > rows[0].id)
    ) {
      setRows(latest);
      setBefore(latest.at(-1)?.id);
    } else {
      setRows(mergeCreditRows(rows, latest));
    }
  }

  async function more(button: HTMLButtonElement) {
    if (busy || before === undefined) return;
    setBusy(true);
    try {
      const result = await api<{ history: CreditEntry[] }>(
        String(workspace),
        "/api/credits?before=" + before,
      );
      if (!button.isConnected) return;
      setRows((rows) => mergeCreditRows(rows, result.history));
      setBefore(
        result.history.length === 50 ? result.history.at(-1)?.id : undefined,
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
          onClick={(event) => recharge(event.currentTarget)}
        >
          充值
        </button>
      </div>
      <div className="credit-summary">
        <div>
          <span>可用积分</span>
          <strong>{credits.available.toLocaleString()}</strong>
        </div>
        <div>
          <span>冻结积分</span>
          <strong>{credits.reserved.toLocaleString()}</strong>
        </div>
      </div>
      <div className="recharge-info">
        <span>¥1 = 10 积分</span>
        <button
          className="quiet-button"
          data-act="recharge-history"
          onClick={(event) => history(event.currentTarget)}
        >
          充值记录
        </button>
      </div>
      <section className="ledger-card">
        <h3 className="credit-heading">积分明细</h3>
        <CreditLedger rows={rows} />
        {before !== undefined && (
          <button
            className="quiet-button"
            data-act="credit-more"
            data-before={before}
            disabled={busy}
            onClick={(event) => void more(event.currentTarget)}
          >
            加载更多
          </button>
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
          const prefix =
            row.action === "spend"
              ? "−"
              : (row.action === "adjust" || row.action === "recharge") &&
                  row.amount > 0
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
              <span className="credit-amount">{prefix + row.amount}</span>
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
  const [yuan, setYuan] = useState("10");
  const amountField = useRef<HTMLInputElement>(null);
  const [method, setMethod] = useState(config.methods[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const request = useRef({ fingerprint: "", uid: "" });
  const amount = Number(yuan);
  const valid =
    Number.isInteger(amount) &&
    amount >= config.min_yuan &&
    amount <= config.max_yuan;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (busy || !method || !form.reportValidity()) return;
    const payload = { workspace: state.workspace_id, yuan: amount, method };
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
      <label className="formlabel">
        充值金额（元）
        <input
          name="yuan"
          type="number"
          min={config.min_yuan}
          max={config.max_yuan}
          step="1"
          ref={amountField}
          defaultValue="10"
          inputMode="numeric"
          required
          disabled={busy}
          onChange={(event) => setYuan(event.currentTarget.value)}
        />
      </label>
      <div className="recharge-presets">
        {[1, 10, 50, 100].map((preset) => (
          <button
            key={preset}
            type="button"
            className="profile-secondary"
            data-yuan={preset}
            aria-pressed={amount === preset}
            disabled={busy}
            onClick={() => {
              if (!amountField.current) return;
              amountField.current.value = String(preset);
              setYuan(amountField.current.value);
            }}
          >{`¥${preset}`}</button>
        ))}
      </div>
      <div className="recharge-total">
        <span>到账积分</span>
        <strong id="recharge-total" key={method}>
          {valid ? (amount * 10).toLocaleString() : "—"}
        </strong>
      </div>
      <p className="recharge-rate">¥1 = 10 积分</p>
      <fieldset className="recharge-methods">
        <legend>付款方式</legend>
        {config.methods.length ? (
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
      <p className="recharge-network" hidden={method !== "usdt_plasma"}>
        使用 Plasma 网络转账，应付 USDT 数量以收银台为准。
      </p>
      <p className="form-message" role="alert">
        {message}
      </p>
      <button
        className="primary"
        type="submit"
        disabled={busy || !config.methods.length}
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
                <small>{`${date(order.created)} · ${methodName(order.method)}`}</small>
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
        <button
          className="quiet-button"
          id="recharge-more"
          disabled={busy}
          onClick={(event) => void more(event.currentTarget)}
        >
          加载更多
        </button>
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
    const timer = window.setInterval(poll, 5000);
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
        <dd>{methodName(order.method)}</dd>
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
        <button
          ref={check}
          className="profile-secondary"
          id="recharge-check"
          disabled={busy}
          onClick={() => void poll()}
        >
          刷新支付结果
        </button>
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
