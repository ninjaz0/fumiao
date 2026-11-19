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
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "team" | "personal">(
    "all",
  );
  useLayoutEffect(() => {
    if (!dialogOpen) setVisibleAccounts(accounts);
  }, [accounts, dialogOpen]);
  const historyRead = useRef(0);

  const totalAvailable = visibleAccounts.reduce(
    (sum, item) => sum + item.available,
    0,
  );
  const totalReserved = visibleAccounts.reduce(
    (sum, item) => sum + item.reserved,
    0,
  );
  const needle = query.trim().toLowerCase();
  const filteredAccounts = visibleAccounts.filter((account) => {
    if (kindFilter !== "all" && account.kind !== kindFilter) return false;
    if (!needle) return true;
    return (account.name + " " + (account.username || ""))
      .toLowerCase()
      .includes(needle);
  });

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
      );
    } catch (error) {
      if (opener.isConnected && version === historyRead.current)
        notify((error as Error).message);
    }
  }

  return (
    <section className="settings-section credit-admin">
      <h2>积分管理</h2>
      <div className="console-kpi-grid">
        <div className="console-kpi">
          <span>全平台可用积分</span>
          <strong>{totalAvailable.toLocaleString()}</strong>
        </div>
        <div className="console-kpi">
          <span>任务在途冻结</span>
          <strong>{totalReserved.toLocaleString()}</strong>
        </div>
        <div className="console-kpi">
          <span>积分账户</span>
          <strong>{visibleAccounts.length}</strong>
        </div>
      </div>
      {visibleAccounts.length > 2 && (
        <div className="console-toolbar">
          <div className="ledger-segments" role="radiogroup" aria-label="账户类型">
            {(
              [
                ["all", "全部"],
                ["team", "团队积分"],
                ["personal", "个人积分"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                <input
                  type="radio"
                  name="credit-kind-filter"
                  checked={kindFilter === key}
                  onChange={() => setKindFilter(key)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <input
            className="member-search console-search-inline"
            type="search"
            aria-label="搜索积分账户"
            placeholder="搜索空间或成员..."
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </div>
      )}
      {accountKinds
        .filter(([kind]) => kindFilter === "all" || kindFilter === kind)
        .map(([kind, label]) => {
          const rows = filteredAccounts.filter(
            (account) => account.kind === kind,
          );
          if (needle && !rows.length) return null;
          return (
            <section className="ledger-card" key={kind}>
              <div className="console-card-head">
                <h3 className="credit-heading">{label}</h3>
                <span className="console-pill">{rows.length} 个账户</span>
              </div>
              {rows.length ? (
                rows.map((account) => (
                  <div key={account.workspace} className="credit-account-row">
                    <div>
                      <strong>{account.name}</strong>
                      {account.username &&
                        account.username !== account.name && (
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
                        );
                      }}
                    >
                      调整
                    </button>
                  </div>
                ))
              ) : (
                <p className="empty-note">暂无账户</p>
              )}
            </section>
          );
        })}
      {needle && !filteredAccounts.length && (
        <div className="ledger-no-results">
          <p>没有匹配的积分账户</p>
          <button
            type="button"
            className="ledger-button"
            onClick={() => {
              setQuery("");
              setKindFilter("all");
            }}
          >
            重置筛选
          </button>
        </div>
      )}
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
