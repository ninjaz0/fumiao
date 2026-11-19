import {
  ChevronDown,
  Copy,
  Pencil,
  Plus,
  Power,
  Route,
  Search,
} from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import type { AdminSave, AdminOpen, AdminConfirm } from "./settings-admin";
import { openDialogFor } from "./AssetDialog";
import type { InviteCode, StudioState } from "./state";

const statuses = {
  all: "全部",
  valid: "有效",
  expired: "已过期",
  disabled: "已停用",
} as const;
type InviteFilter = keyof typeof statuses;
const day = 86400;

function expiryDate(expires: number) {
  return new Date(expires * 1000).toLocaleString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function expiryNote(expires: number, now: number) {
  const days = (expires - now) / day;
  if (days <= 0) {
    const elapsed = Math.floor(-days);
    return elapsed ? `已于 ${elapsed} 天前到期` : "今天已到期";
  }
  return days < 1 ? "不足 1 天" : `剩余 ${Math.floor(days)} 天`;
}

export function Invites({
  state,
  open,
  confirm,
  request,
  refresh,
  notify,
}: AdminSave & {
  state: StudioState;
  open: AdminOpen;
  confirm: AdminConfirm;
}) {
  const [filter, setFilter] = useState<InviteFilter>("all");
  const [query, setQuery] = useState("");
  const now = Date.now() / 1000;
  const counts = { all: 0, valid: 0, expired: 0, disabled: 0 };
  let uses = 0;
  let permanent = 0;
  const items = (state.invite_codes ?? []).map((item) => {
    const status = !item.enabled
      ? "disabled"
      : item.expires !== null && item.expires <= now
        ? "expired"
        : "valid";
    ++counts[status];
    ++counts.all;
    uses += item.uses;
    if (status === "valid" && item.expires === null) ++permanent;
    return { item, status } as const;
  });
  const needle = query.trim().toLowerCase();
  const hits = items.filter(
    ({ item, status }) =>
      (filter === "all" || filter === status) &&
      (!needle ||
        item.name.toLowerCase().includes(needle) ||
        item.code
          .toLowerCase()
          .replaceAll("-", "")
          .includes(needle.replaceAll("-", ""))),
  );

  function clearFilters() {
    setFilter("all");
    setQuery("");
  }

  function edit(opener: HTMLButtonElement, item?: InviteCode) {
    open(
      <InviteDialog
        state={state}
        item={item}
        request={request}
        refresh={refresh}
        notify={notify}
        onSaved={item ? undefined : clearFilters}
      />,
      opener,
      "invite-sheet",
    );
  }

  async function copy(opener: HTMLButtonElement, code: string) {
    try {
      await navigator.clipboard.writeText(code);
      notify("邀请码已复制");
    } catch {
      if (opener.isConnected)
        open(<InviteCopy code={code} notify={notify} />, opener);
    }
  }

  return (
    <section className="management-view invite-management">
      <div className="ledger-invite-heading">
        <div>
          <h2>邀请码</h2>
          <p className="invite-intro">
            同一个邀请码可供多人注册，初始积分发放至每位新成员的个人空间。
          </p>
        </div>
        <button
          type="button"
          className="ledger-button ledger-primary"
          data-act="invite"
          onClick={(event) => edit(event.currentTarget)}
        >
          <Plus size={16} aria-hidden="true" />
          创建邀请码
        </button>
      </div>
      {items.length ? (
        <dl className="ledger-tally" aria-label="邀请码概况">
          <div>
            <dt>有效邀请码</dt>
            <dd>
              {counts.valid}
              <small> / {items.length} 个</small>
            </dd>
          </div>
          <div>
            <dt>累计注册</dt>
            <dd>
              {uses.toLocaleString()}
              <small> 人</small>
            </dd>
          </div>
          <div>
            <dt>长期有效</dt>
            <dd>
              {permanent}
              <small> 个</small>
            </dd>
          </div>
        </dl>
      ) : (
        <div className="invite-empty ledger-empty">
          <EmptyTicket />
          <div>
            <h3>还没有邀请码</h3>
            <p>创建后，成员即可从登录页注册。</p>
            <button
              type="button"
              className="ledger-button ledger-primary"
              onClick={(event) => edit(event.currentTarget)}
            >
              <Plus size={16} aria-hidden="true" />
              创建邀请码
            </button>
          </div>
        </div>
      )}
      <InviteGuide empty={!items.length} />
      {items.length > 0 && (
        <>
          <div className="ledger-invite-toolbar">
            <div
              className="ledger-segments"
              role="radiogroup"
              aria-label="按状态筛选"
            >
              {(Object.keys(statuses) as InviteFilter[]).map((key) => (
                <label key={key}>
                  <input
                    type="radio"
                    name="invite-status"
                    value={key}
                    checked={filter === key}
                    onChange={() => setFilter(key)}
                  />
                  <span>
                    {statuses[key]} <small>{counts[key]}</small>
                  </span>
                </label>
              ))}
            </div>
            <label className="ledger-search">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                aria-label="搜索名称或邀请码"
                placeholder="搜索名称或邀请码"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
          </div>
          {hits.length ? (
            <div className="ledger-ticket-list">
              {hits.map(({ item, status }) => (
                <article
                  key={item.id}
                  className="invite-code-row ledger-ticket"
                  data-status={status}
                  aria-labelledby={`invite-name-${item.id}`}
                >
                  <div className="ledger-ticket-stub">
                    <h3 id={`invite-name-${item.id}`}>
                      {item.name || "邀请码"}
                    </h3>
                    <div className="invite-code-value">
                      <code>{item.code}</code>
                      <button
                        type="button"
                        className="ledger-button"
                        data-act="copy-invite"
                        data-id={item.id}
                        aria-label={`复制邀请码 ${item.code}`}
                        onClick={(event) =>
                          void copy(event.currentTarget, item.code)
                        }
                      >
                        <Copy size={15} aria-hidden="true" />
                        复制
                      </button>
                    </div>
                  </div>
                  <div className="ledger-ticket-details">
                    <span className="invite-status ledger-seal">
                      {statuses[status]}
                    </span>
                    <dl className="ledger-facts">
                      <div>
                        <dt>有效期</dt>
                        <dd>
                          {item.expires === null
                            ? "长期有效"
                            : expiryDate(item.expires)}
                          {item.expires !== null && (
                            <small>{expiryNote(item.expires, now)}</small>
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>初始积分</dt>
                        <dd>
                          {item.grant_credits
                            ? item.initial_credits.toLocaleString() + " / 人"
                            : "不赠送"}
                        </dd>
                      </div>
                      <div>
                        <dt>加入空间</dt>
                        <dd>
                          {item.team_id
                            ? state.workspaces.find(
                                ({ id }) => id === item.team_id,
                              )?.name || "团队已删除"
                            : "仅个人空间"}
                        </dd>
                      </div>
                      <div>
                        <dt>已注册</dt>
                        <dd>{item.uses.toLocaleString() + " 人"}</dd>
                      </div>
                    </dl>
                    <div className="invite-code-actions">
                      <button
                        type="button"
                        className="ledger-button ledger-quiet"
                        data-act="edit-invite"
                        data-id={item.id}
                        onClick={(event) => edit(event.currentTarget, item)}
                      >
                        <Pencil size={15} aria-hidden="true" />
                        编辑
                      </button>
                      <button
                        type="button"
                        className={`ledger-button ledger-quiet${item.enabled ? " ledger-danger" : ""}`}
                        data-act="toggle-invite"
                        data-id={item.id}
                        onClick={(event) =>
                          confirm(
                            item.enabled
                              ? "停用这个邀请码？"
                              : "启用这个邀请码？",
                            item.enabled
                              ? "停用后无法继续注册，已注册账户不受影响。"
                              : "启用后将按原有有效期、积分和团队设置接受注册。",
                            async () => {
                              await request(
                                `/api/invite-codes/${item.id}`,
                                {
                                  enabled: !item.enabled,
                                  expected_revision: item.revision,
                                },
                                "PATCH",
                              );
                            },
                            event.currentTarget,
                          )
                        }
                      >
                        <Power size={15} aria-hidden="true" />
                        {item.enabled ? "停用" : "启用"}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="ledger-no-results">
              <p>没有符合条件的邀请码</p>
              <button
                className="ledger-button"
                type="button"
                onClick={clearFilters}
              >
                清除筛选
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function InviteGuide({ empty }: { empty: boolean }) {
  const steps = [
    ["创建邀请码", "设定有效期、初始积分与加入的团队"],
    ["复制并分享", "同一个邀请码可供多人注册"],
    ["登录页注册", "成员填写邀请码完成注册"],
    ["自动到账", "积分发放至个人空间，并按设置加入团队"],
  ];
  return (
    <details className="ledger-guide" open={empty || undefined}>
      <summary>
        <Route size={16} aria-hidden="true" />
        邀请如何生效
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <ol>
        {steps.map(([title, text]) => (
          <li key={title}>
            <strong>{title}</strong>
            <span>{text}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

function EmptyTicket() {
  return (
    <svg
      viewBox="0 0 300 200"
      aria-hidden="true"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <g transform="rotate(-8 150 100)">
        <path
          d="M46 62a10 10 0 0 1 10-10h188a10 10 0 0 1 10 10v20a14 14 0 0 0 0 28v20a10 10 0 0 1-10 10H56a10 10 0 0 1-10-10v-20a14 14 0 0 0 0-28z"
          fill="var(--bg)"
          stroke="var(--ledger-rule)"
          strokeWidth="1.5"
        />
      </g>
      <path
        d="M40 70a10 10 0 0 1 10-10h200a10 10 0 0 1 10 10v22a14 14 0 0 0 0 28v22a10 10 0 0 1-10 10H50a10 10 0 0 1-10-10v-22a14 14 0 0 0 0-28z"
        fill="var(--surface)"
        stroke="var(--secondary)"
        strokeWidth="1.5"
      />
      <path
        d="M180 64v84M62 114h72"
        stroke="var(--ledger-rule)"
        strokeWidth="1.5"
        strokeDasharray="3 5"
      />
      <rect
        x="62"
        y="84"
        width="58"
        height="7"
        rx="3.5"
        fill="var(--secondary)"
        opacity=".55"
      />
      <rect
        x="62"
        y="130"
        width="38"
        height="6"
        rx="3"
        fill="var(--ledger-rule)"
      />
      <g transform="rotate(-14 222 106)" stroke="var(--text)">
        <circle
          cx="222"
          cy="106"
          r="25"
          strokeWidth="2.2"
          strokeDasharray="4 3"
        />
        <circle cx="222" cy="106" r="19" strokeWidth="1.2" opacity=".6" />
        <path d="M214 106h16M222 98v16" strokeWidth="2.2" />
      </g>
      <path
        d="M118 176c20-6 46-6 66 0"
        stroke="var(--ledger-rule)"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function InviteCopy({
  code,
  notify,
}: {
  code: string;
  notify: AdminSave["notify"];
}) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      notify("已复制");
    } catch {
      notify("请选中内容后手动复制");
    }
  }

  return (
    <>
      <h2 id="modal-heading">邀请码</h2>
      <p>复制后分享给需要注册的成员。</p>
      <label className="formlabel">
        <textarea className="mono" readOnly rows={4} defaultValue={code} />
      </label>
      <button className="primary" id="copy" onClick={() => void copy()}>
        复制
      </button>
    </>
  );
}

function localDate(seconds: number) {
  const date = new Date(seconds * 1000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

function InviteDialog({
  state,
  item,
  request,
  refresh,
  notify,
  onSaved,
}: AdminSave & {
  state: StudioState;
  item?: InviteCode;
  onSaved?: () => void;
}) {
  const teams = state.workspaces.filter(({ kind }) => kind === "team");
  const [name, setName] = useState(item?.name || "");
  const [expiry, setExpiry] = useState(
    item ? (item.expires === null ? "never" : "custom") : "30",
  );
  const [date, setDate] = useState(() =>
    localDate(item?.expires ?? Date.now() / 1000 + 30 * day),
  );
  const [grant, setGrant] = useState(Boolean(item?.grant_credits));
  const [amount, setAmount] = useState(String(item?.initial_credits || 100));
  const [team, setTeam] = useState(
    teams.some(({ id }) => id === item?.team_id) ? String(item?.team_id) : "",
  );
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const [message, setMessage] = useState("");
  const custom = expiry === "custom";
  const expiryOptions = [
    ["7", "7 天"],
    ["30", "30 天"],
    ["custom", "指定到期时间"],
    ["never", "长期有效"],
  ];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const expires =
      expiry === "never"
        ? null
        : custom
          ? Math.floor(new Date(String(fields.get("expires"))).getTime() / 1000)
          : Math.floor(Date.now() / 1000) + Number(expiry) * day;
    const body = {
      name: String(fields.get("label")).trim(),
      expires,
      grant_credits: grant,
      initial_credits: grant ? Number(fields.get("amount")) : 0,
      team_id: Number(fields.get("team")) || null,
      ...(item ? { expected_revision: item.revision } : {}),
    };
    pending.current = true;
    setSaving(true);
    setMessage("");
    try {
      await request(
        item ? `/api/invite-codes/${item.id}` : "/api/invite-codes",
        body,
        item ? "PATCH" : "POST",
      );
      onSaved?.();
      openDialogFor(form)?.close();
      await refresh();
      notify(item ? "邀请码已保存" : "邀请码已创建");
    } catch (error) {
      setMessage((error as Error).message);
      pending.current = false;
      setSaving(false);
    }
  }

  return (
    <form id="invite-form" onSubmit={submit}>
      <header className="ledger-sheet-heading">
        <span>组织 / 邀请码</span>
        <h2 id="modal-heading">{item ? "编辑邀请码" : "创建邀请码"}</h2>
      </header>
      <div className="ledger-sheet-fields">
        <div className="ledger-ticket-preview" aria-hidden="true">
          <small>票面预览</small>
          <strong>{name.trim() || "未命名邀请码"}</strong>
          <code>{item?.code || "创建后自动生成"}</code>
          <ul>
            <li>
              {custom && date
                ? date.replace("T", " ")
                : expiryOptions.find(([value]) => value === expiry)?.[1]}
            </li>
            {grant && Number(amount) > 0 && (
              <li>{Number(amount).toLocaleString()} 积分 / 人</li>
            )}
            <li>
              {teams.find(({ id }) => String(id) === team)?.name ||
                "仅个人空间"}
            </li>
          </ul>
        </div>
        {item && (
          <div className="invite-edit-code">
            <code>{item.code}</code>
            <span>{"已注册 " + item.uses + " 人"}</span>
          </div>
        )}
        <label className="formlabel">
          <span>
            名称 <small aria-hidden="true">{name.length} / 40</small>
          </span>
          <input
            name="label"
            maxLength={40}
            placeholder="如：创作体验、项目组"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            required
          />
        </label>
        <fieldset className="ledger-expiry">
          <legend>有效期</legend>
          <div className="ledger-segments">
            {expiryOptions.map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="expiry"
                  value={value}
                  checked={value === expiry}
                  onChange={() => setExpiry(value)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="formlabel" id="invite-date" hidden={!custom}>
          到期时间
          <input
            name="expires"
            type="datetime-local"
            value={date}
            onChange={(event) => setDate(event.currentTarget.value)}
            required={custom}
            disabled={!custom}
          />
        </label>
        <div className="invite-grant-row">
          <span id="invite-grant-label">赠送初始积分</span>
          <label className="model-switch">
            <input
              type="checkbox"
              role="switch"
              name="grant"
              aria-labelledby="invite-grant-label"
              checked={grant}
              onChange={(event) => setGrant(event.currentTarget.checked)}
            />
            <span aria-hidden="true"></span>
          </label>
        </div>
        <div id="invite-amount" hidden={!grant}>
          <label className="formlabel">
            每人积分
            <input
              name="amount"
              type="number"
              min={1}
              max={1000000000}
              step={1}
              value={amount}
              onChange={(event) => setAmount(event.currentTarget.value)}
              disabled={!grant}
              required={grant}
            />
            <small>发放至新成员的个人空间</small>
          </label>
          <div
            className="ledger-credit-presets"
            aria-label="常用积分"
            role="group"
          >
            {[100, 500, 1000, 5000].map((preset) => (
              <button
                key={preset}
                className="ledger-button"
                type="button"
                onClick={() => setAmount(String(preset))}
              >
                {preset.toLocaleString()}
              </button>
            ))}
          </div>
        </div>
        <label className="formlabel">
          注册后加入
          <select
            name="team"
            value={team}
            onChange={(event) => setTeam(event.currentTarget.value)}
          >
            <option value="">仅个人空间</option>
            {teams.map((space) => (
              <option key={space.id} value={space.id}>
                {space.name}
              </option>
            ))}
          </select>
        </label>
        {item && <p className="invite-form-help">修改只影响之后注册的成员。</p>}
        <p className="form-message" role="alert">
          {message}
        </p>
      </div>
      <footer className="invite-form-actions">
        <button
          type="button"
          className="ledger-button ledger-quiet"
          id="cancel-invite"
          onClick={(event) => openDialogFor(event.currentTarget)?.close()}
        >
          取消
        </button>
        <button
          className="ledger-button ledger-primary"
          type="submit"
          disabled={saving}
        >
          {item ? "保存" : "创建邀请码"}
        </button>
      </footer>
    </form>
  );
}
