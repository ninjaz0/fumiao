import { useRef, useState, type FormEvent } from "react";
import type { AdminSave } from "./settings-admin";
import { openDialogFor } from "./AssetDialog";
import { Icon } from "./Icon";
import { countTeamPolicyDiffs } from "./model-policy-scope";
import { Avatar, WorkspaceBadge } from "./Navigation";
import { displayName, type Space, type StudioState } from "./state";

export function Workspaces({
  state,
  show,
  select,
  openModels,
}: {
  state: StudioState;
  show: (opener: HTMLButtonElement, space?: Space) => void;
  select: (id: number) => void;
  openModels?: (id: number) => void;
}) {
  const [query, setQuery] = useState("");
  const teams = state.workspaces.filter(({ kind }) => kind === "team");
  const term = query.trim().toLowerCase();
  const visible = teams.filter(
    (space) => !term || space.name.toLowerCase().includes(term),
  );
  return (
    <section className="management-view">
      <div className="page-heading">
        <div>
          <h2>团队空间</h2>
          <small className="muted">
            共 {teams.length} 个团队空间，素材与会话按空间隔离
          </small>
        </div>
        <button
          className="primary"
          data-act="create-workspace"
          onClick={(event) => show(event.currentTarget)}
        >
          <Icon name="plus" />
          创建团队
        </button>
      </div>
      {teams.length > 0 && (
        <div className="console-toolbar">
          <input
            className="member-search console-search-inline"
            type="search"
            aria-label="搜索团队空间"
            placeholder={`搜索 ${teams.length} 个团队空间...`}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <span className="console-toolbar-meta">
            显示 {visible.length} / {teams.length} 个团队
          </span>
        </div>
      )}
      <div className="list-surface">
        {visible.length ? (
          visible.map((space) => {
            const diffs = countTeamPolicyDiffs(
              state.model_groups,
              state.model_policy,
              state.team_model_policies?.[String(space.id)],
            );
            return (
              <div key={space.id} className="workspace-row">
                <WorkspaceBadge space={space} member={state.me} />
                <div className="workspace-row-name">
                  <span className="console-row-title">
                    <strong>{space.name}</strong>
                    {space.id === state.workspace_id && (
                      <span className="console-pill ok">当前空间</span>
                    )}
                    {diffs > 0 && (
                      <span className="console-pill info">
                        独立模型策略 ({diffs})
                      </span>
                    )}
                  </span>
                  <span>{space.member_count + " 位成员"}</span>
                </div>
                {openModels && (
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={() => openModels(space.id)}
                  >
                    模型策略
                  </button>
                )}
                <button
                  className="quiet-button"
                  data-act="edit-workspace"
                  data-id={space.id}
                  onClick={(event) => show(event.currentTarget, space)}
                >
                  管理成员
                </button>
                <button
                  className="quiet-button"
                  data-act="switch-workspace"
                  data-id={space.id}
                  onClick={() => select(space.id)}
                >
                  进入
                </button>
              </div>
            );
          })
        ) : (
          <p className="empty-note">
            {teams.length ? "没有匹配的团队空间" : "还没有团队空间"}
          </p>
        )}
      </div>
    </section>
  );
}

export function WorkspaceDialog({
  state,
  space,
  request,
  refresh,
  notify,
}: AdminSave & { state: StudioState; space?: Space }) {
  const members = (state.users || []).filter(({ active }) => active);
  const [search, setSearch] = useState<string | null>(null);
  const [count, setCount] = useState(
    () => members.filter(({ id }) => space?.members?.includes(id)).length,
  );
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const [message, setMessage] = useState("");
  const searchText = (member: (typeof members)[number]) =>
    (displayName(member) + " " + member.name).toLowerCase();
  const query = search?.trim().toLowerCase() || "";
  const matches = (text: string) => text.includes(query);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const body = {
      name: String(fields.get("name")).trim(),
      members: fields.getAll("member").map(Number),
      ...(space ? { expected_revision: space.revision } : {}),
    };
    pending.current = true;
    setSaving(true);
    try {
      await request(
        space ? "/api/workspaces/" + space.id : "/api/workspaces",
        body,
        space ? "PATCH" : "POST",
      );
      openDialogFor(form)?.close();
      await refresh();
      notify(space ? "团队已更新" : "团队已创建");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return (
    <form id="workspace-form" onSubmit={submit}>
      <h2 id="modal-heading">{space ? "管理团队空间" : "创建团队空间"}</h2>
      <label className="formlabel">
        团队名称
        <input
          name="name"
          required
          maxLength={40}
          defaultValue={space?.name || ""}
          placeholder="输入团队名称"
          autoComplete="off"
        />
      </label>
      <div className="workspace-member-heading">
        <span>团队成员</span>
        <span id="workspace-member-count">{"已选 " + count + " 人"}</span>
      </div>
      <input
        className="workspace-member-search"
        type="search"
        placeholder="搜索成员"
        aria-label="搜索团队成员"
        onChange={(event) => setSearch(event.currentTarget.value)}
      />
      <div className="workspace-member-picker">
        {members.map((member) => {
          const name = displayName(member);
          const text = searchText(member);
          return (
            <label
              key={member.id}
              className="workspace-member-choice"
              data-search={text}
              hidden={!matches(text)}
            >
              <input
                type="checkbox"
                name="member"
                value={member.id}
                defaultChecked={space?.members?.includes(member.id)}
                onChange={(event) =>
                  setCount(
                    new FormData(event.currentTarget.form!).getAll("member")
                      .length,
                  )
                }
              />
              <Avatar member={member} current={false} />
              <span>
                <strong>{name}</strong>
                {name !== member.name && <small>{member.name}</small>}
              </span>
            </label>
          );
        })}
        <p
          className="space-empty"
          id="workspace-no-match"
          hidden={
            search === null ||
            members.some((member) => matches(searchText(member)))
          }
        >
          没有找到成员
        </p>
      </div>
      <p className="workspace-access-note">管理员无需加入即可访问</p>
      <p className="form-message" role="alert">
        {message}
      </p>
      <div className="workspace-dialog-actions">
        <button
          type="button"
          className="quiet-button"
          data-act="close"
          onClick={(event) => openDialogFor(event.currentTarget)?.close()}
        >
          取消
        </button>
        <button className="primary" type="submit" disabled={saving}>
          {space ? "保存" : "创建"}
        </button>
      </div>
    </form>
  );
}
