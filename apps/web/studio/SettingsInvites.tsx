import { useRef, useState, type FormEvent } from "react";
import type { AdminSave, AdminOpen, AdminConfirm } from "./settings-admin";
import { openDialogFor } from "./AssetDialog";
import { Icon } from "./Icon";

import type { InviteCode, StudioState } from "./state";

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
  const items = state.invite_codes || [];

  function edit(opener: HTMLButtonElement, item?: InviteCode) {
    open(
      <InviteDialog
        state={state}
        item={item}
        request={request}
        refresh={refresh}
        notify={notify}
      />,
      opener,
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
      <div className="page-heading">
        <h2>邀请码</h2>
        <button
          className="primary"
          data-act="invite"
          onClick={(event) => edit(event.currentTarget)}
        >
          <Icon name="plus" />
          创建邀请码
        </button>
      </div>
      <p className="invite-intro">
        同一个邀请码可供多人注册，初始积分发放至每位新成员的个人空间。
      </p>
      <div className="invite-code-list">
        {items.length ? (
          items.map((item) => {
            const expired =
              item.expires !== null && item.expires <= Date.now() / 1000;
            const status = !item.enabled
              ? "已停用"
              : expired
                ? "已过期"
                : "有效";
            const team = item.team_id
              ? state.workspaces.find(({ id }) => id === item.team_id)?.name ||
                "团队已删除"
              : "仅个人空间";
            return (
              <article key={item.id} className="invite-code-row">
                <div className="invite-code-heading">
                  <strong>{item.name || "邀请码"}</strong>
                  <span
                    className={`invite-status ${status === "有效" ? "" : "inactive"}`}
                  >
                    {status}
                  </span>
                </div>
                <div className="invite-code-value">
                  <code>{item.code}</code>
                  <button
                    className="quiet-button"
                    data-act="copy-invite"
                    data-id={item.id}
                    aria-label={`复制邀请码 ${item.code}`}
                    onClick={(event) =>
                      void copy(event.currentTarget, item.code)
                    }
                  >
                    <Icon name="copy" />
                    复制
                  </button>
                </div>
                <dl className="invite-code-facts">
                  <div>
                    <dt>有效期</dt>
                    <dd>
                      {item.expires === null
                        ? "长期有效"
                        : new Date(item.expires * 1000).toLocaleString([], {
                            year: "numeric",
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
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
                    <dd>{team}</dd>
                  </div>
                  <div>
                    <dt>已注册</dt>
                    <dd>{item.uses + " 人"}</dd>
                  </div>
                </dl>
                <div className="invite-code-actions">
                  <button
                    className="quiet-button"
                    data-act="edit-invite"
                    data-id={item.id}
                    onClick={(event) => edit(event.currentTarget, item)}
                  >
                    编辑
                  </button>
                  <button
                    className={`quiet-button ${item.enabled ? "danger" : ""}`}
                    data-act="toggle-invite"
                    data-id={item.id}
                    onClick={(event) =>
                      confirm(
                        item.enabled ? "停用这个邀请码？" : "启用这个邀请码？",
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
                    {item.enabled ? "停用" : "启用"}
                  </button>
                </div>
              </article>
            );
          })
        ) : (
          <div className="invite-empty">
            <h3>还没有邀请码</h3>
            <p>创建后，成员即可从登录页注册。</p>
          </div>
        )}
      </div>
    </section>
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
}: AdminSave & { state: StudioState; item?: InviteCode }) {
  const teams = state.workspaces.filter(({ kind }) => kind === "team");
  const [expiry, setExpiry] = useState(
    item ? (item.expires === null ? "never" : "custom") : "30",
  );
  const [date] = useState(() =>
    localDate(item?.expires || Date.now() / 1000 + 30 * 86400),
  );
  const [grant, setGrant] = useState(Boolean(item?.grant_credits));
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const [message, setMessage] = useState("");
  const custom = expiry === "custom";

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
          : Math.floor(Date.now() / 1000) + Number(expiry) * 86400;
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
      <h2 id="modal-heading">{item ? "编辑邀请码" : "创建邀请码"}</h2>
      {item && (
        <div className="invite-edit-code">
          <code>{item.code}</code>
          <span>{"已注册 " + item.uses + " 人"}</span>
        </div>
      )}
      <label className="formlabel">
        名称
        <input
          name="label"
          maxLength={40}
          placeholder="如：创作体验、项目组"
          defaultValue={item?.name || ""}
          required
        />
      </label>
      <label className="formlabel">
        有效期
        <select
          name="expiry"
          defaultValue={expiry}
          onChange={(event) => setExpiry(event.currentTarget.value)}
        >
          <option value="7">7 天</option>
          <option value="30">30 天</option>
          <option value="custom">指定到期时间</option>
          <option value="never">长期有效</option>
        </select>
      </label>
      <label className="formlabel" id="invite-date" hidden={!custom}>
        到期时间
        <input
          name="expires"
          type="datetime-local"
          defaultValue={date}
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
            defaultChecked={Boolean(item?.grant_credits)}
            onChange={(event) => setGrant(event.currentTarget.checked)}
          />
          <span aria-hidden="true"></span>
        </label>
      </div>
      <label className="formlabel" id="invite-amount" hidden={!grant}>
        每人积分
        <input
          name="amount"
          type="number"
          min={1}
          max={1000000000}
          step={1}
          defaultValue={item?.initial_credits || 100}
          disabled={!grant}
          required={grant}
        />
        <small>发放至新成员的个人空间</small>
      </label>
      <label className="formlabel">
        注册后加入
        <select
          name="team"
          defaultValue={
            teams.some(({ id }) => id === item?.team_id)
              ? (item?.team_id ?? undefined)
              : undefined
          }
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
      <div className="invite-form-actions">
        <button
          type="button"
          className="quiet-button"
          id="cancel-invite"
          onClick={(event) => openDialogFor(event.currentTarget)?.close()}
        >
          取消
        </button>
        <button className="primary" type="submit" disabled={saving}>
          {item ? "保存" : "创建邀请码"}
        </button>
      </div>
    </form>
  );
}
