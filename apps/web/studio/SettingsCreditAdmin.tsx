import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { openDialogFor } from "./AssetDialog";
import { CreditLedger } from "./SettingsCredits";
import type { AdminOpen, AdminSave } from "./settings-admin";
import type { CreditAccount, CreditEntry } from "./state";

type CreditHistory = { accounts: CreditAccount[]; history: CreditEntry[] };
const accountKinds = [
  ["team", "团队积分"],
  ["personal", "个人积分"],
] as const;
const creditHistoryPath = (workspace: number) =>
  "/api/admin/credits?workspace=" + workspace;

export function CreditAdmin({
  accounts,
  dialogOpen,
  open,
  request,
  refresh,
  notify,
}: AdminSave & {
  accounts: CreditAccount[];
  dialogOpen: boolean;
  open: AdminOpen;
}) {
  const [visibleAccounts, setVisibleAccounts] = useState(accounts);
  useLayoutEffect(() => {
    if (!dialogOpen) setVisibleAccounts(accounts);
  }, [accounts, dialogOpen]);
  const [kindFilter, setKindFilter] = useState("all");
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  const matching = visibleAccounts.filter(
    (account) =>
      (kindFilter === "all" || account.kind === kindFilter) &&
      [account.name, account.username].some((name) =>
        name?.toLowerCase().includes(term),
      ),
  );
  const historyRead = useRef(0);

  async function history(account: CreditAccount, opener: HTMLButtonElement) {
    const version = ++historyRead.current;
    try {
      const result = (await request(
        creditHistoryPath(account.workspace),
      )) as CreditHistory;
      if (version !== historyRead.current || !opener.isConnected) return;
      open(
        <AccountHistory
          workspace={account.workspace}
          initial={result}
          request={request}
          notify={notify}
        />,
        opener,
        "account-sheet",
      );
    } catch (error) {
      if (opener.isConnected && version === historyRead.current)
        notify((error as Error).message);
    }
  }

  return (
    <section className="settings-section credit-admin">
      <h2>积分管理</h2>
      <p className="console-description">
        按空间核对可用积分、冻结金额与账本流水。
      </p>
      <dl className="console-stats">
        <div>
          <dt>可用积分合计</dt>
          <dd>
            {visibleAccounts
              .reduce((sum, a) => sum + a.available, 0)
              .toLocaleString()}
          </dd>
        </div>
        <div>
          <dt>任务冻结积分</dt>
          <dd>
            {visibleAccounts
              .reduce((sum, a) => sum + a.reserved, 0)
              .toLocaleString()}
          </dd>
        </div>
        <div>
          <dt>空间账户</dt>
          <dd>{visibleAccounts.length}</dd>
        </div>
      </dl>
      <div className="console-toolbar">
        <select
          aria-label="账户类型"
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
        >
          <option value="all">全部账户</option>
          {accountKinds.map(([kind, label]) => (
            <option key={kind} value={kind}>
              {label}
            </option>
          ))}
        </select>
        <input
          type="search"
          placeholder="搜索空间或用户名"
          aria-label="搜索积分账户"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {!matching.length && <p role="status">没有匹配的空间账户</p>}
      {accountKinds
        .filter(([kind]) => matching.some((a) => a.kind === kind))
        .map(([kind, label]) => (
          <section className="ledger-card" key={kind}>
            <h3 className="credit-heading">{label}</h3>
            {matching
              .filter((account) => account.kind === kind)
              .map((account) => (
                <div key={account.workspace} className="credit-account-row">
                  <div>
                    <strong>{account.name}</strong>
                    {account.username && account.username !== account.name && (
                      <small>{account.username}</small>
                    )}
                  </div>
                  <span>
                    {account.available.toLocaleString()}
                    <small>{`可用 · 冻结 ${account.reserved.toLocaleString()}`}</small>
                  </span>
                  <button
                    className="quiet-button"
                    data-act="credit-history"
                    data-id={account.workspace}
                    onClick={(event) =>
                      void history(account, event.currentTarget)
                    }
                  >
                    明细
                  </button>
                  <button
                    className="profile-secondary"
                    data-act="credit-adjust"
                    data-id={account.workspace}
                    onClick={(event) => {
                      ++historyRead.current;
                      open(
                        <CreditAdjustment
                          {...{ account, request, refresh, notify }}
                        />,
                        event.currentTarget,
                        "account-sheet",
                      );
                    }}
                  >
                    调整
                  </button>
                </div>
              ))}
          </section>
        ))}
    </section>
  );
}

function AccountHistory({
  workspace,
  initial,
  request,
  notify,
}: Pick<AdminSave, "request" | "notify"> & {
  workspace: number;
  initial: CreditHistory;
}) {
  const [rows, setRows] = useState(initial.history);
  const [before, setBefore] = useState(
    rows.length === 50 ? rows.at(-1)?.id : undefined,
  );
  const loading = useRef(false);
  const [busy, setBusy] = useState(false);
  const account = initial.accounts.find(
    (account) => account.workspace === workspace,
  );

  async function more(button: HTMLButtonElement) {
    if (loading.current || before === undefined) return;
    loading.current = true;
    setBusy(true);
    try {
      const result = (await request(
        creditHistoryPath(workspace) + "&before=" + before,
      )) as CreditHistory;
      if (!openDialogFor(button)) return;
      setRows((current) => [...current, ...result.history]);
      setBefore(
        result.history.length === 50 ? result.history.at(-1)?.id : undefined,
      );
    } catch (error) {
      if (openDialogFor(button)) notify((error as Error).message);
    } finally {
      loading.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <h2 id="modal-heading">{`${account?.name || ""} · 积分明细`}</h2>
      <CreditLedger rows={rows} />
      {before !== undefined && (
        <button
          className="quiet-button"
          data-act="credit-more"
          data-workspace={workspace}
          data-before={before}
          disabled={busy}
          onClick={(event) => void more(event.currentTarget)}
        >
          加载更多
        </button>
      )}
    </>
  );
}

function CreditAdjustment({
  account,
  request,
  refresh,
  notify,
}: AdminSave & { account: CreditAccount }) {
  const [uid] = useState(() => crypto.randomUUID());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    pending.current = true;
    setBusy(true);
    try {
      await request("/api/admin/credits/adjust", {
        workspace: account.workspace,
        amount: Number(values.get("amount")) * Number(values.get("direction")),
        note: String(values.get("note")).trim(),
        uid,
      });
      openDialogFor(form)?.close();
      await refresh();
      notify("积分已调整");
    } catch (error) {
      setMessage((error as Error).message);
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <form id="credit-adjust-form" onSubmit={save}>
      <h2 id="modal-heading">调整积分</h2>
      <p>{`${account.name} · 可用 ${account.available} 积分`}</p>
      <label className="formlabel">
        操作
        <select name="direction">
          <option value="1">发放积分</option>
          <option value="-1">扣减积分</option>
        </select>
      </label>
      <label className="formlabel">
        积分数量
        <input
          name="amount"
          type="number"
          min="1"
          max="1000000000"
          step="1"
          required
        />
      </label>
      <label className="formlabel">
        原因
        <input name="note" maxLength={200} required />
      </label>
      <p className="form-message" role="alert">
        {message}
      </p>
      <button className="primary" type="submit" disabled={busy}>
        确认调整
      </button>
    </form>
  );
}
