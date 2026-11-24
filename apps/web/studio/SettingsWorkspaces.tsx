import { useRef, useState, type FormEvent } from "react";
import type { AdminSave } from "./settings-admin";
import { openDialogFor } from "./AssetDialog";
import { Icon } from "./Icon";
import { Avatar, WorkspaceBadge } from "./Navigation";
import { displayName, type Space, type StudioState } from "./state";

export function Workspaces({
  state,
  show,
  select,
  editModels,
}: {
  state: StudioState;
  show: (opener: HTMLButtonElement, space?: Space) => void;
  select: (id: number) => void;
  editModels: (id: number) => void;
}) {
  const teams = state.workspaces.filter(({ kind }) => kind === "team");
  const [search, setSearch] = useState("");
  const matches = teams.filter((space) =>
    space.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <section className="management-view">
      <div className="page-heading">
        <h2>团队空间</h2>
        <button
          className="primary"
          data-act="create-workspace"
          onClick={(event) => show(event.currentTarget)}
        >
          <Icon name="plus" />
          创建团队
        </button>
      </div>
      <div className="console-toolbar">
        <input
          type="search"
          aria-label="搜索团队空间"
          placeholder="搜索团队空间"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <small>
          {matches.length} / {teams.length} 个团队
        </small>
      </div>
      <div className="list-surface">
        {matches.length ? (
          matches.map((space) => (
            <div key={space.id} className="workspace-row">
              <WorkspaceBadge space={space} member={state.me} />
              <div className="workspace-row-name">
                <strong>
                  {space.name}{" "}
                  {space.id === state.workspace_id && (
                    <small className="console-current">当前空间</small>
                  )}
                </strong>
                <span>{space.member_count + " 位成员"}</span>
              </div>
              <button
                type="button"
                className="quiet-button"
                onClick={() => editModels(space.id)}
              >
                模型策略
              </button>
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
                disabled={space.id === state.workspace_id}
                onClick={() => select(space.id)}
              >
                进入
              </button>
            </div>
          ))
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
  const nameField = useRef<HTMLInputElement>(null);
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
    const name = String(fields.get("name") ?? "").trim();
    if (!name) {
      setMessage("请输入团队名称");
      nameField.current?.focus();
      return;
    }
    const body = {
      name,
      members: fields.getAll("member").map(Number),
      ...(space ? { expected_revision: space.revision } : {}),
    };
    pending.current = true;
    setSaving(true);
    setMessage("");
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
    <form id="workspace-form" onSubmit={submit} noValidate>
      <h2 id="modal-heading">{space ? "管理团队空间" : "创建团队空间"}</h2>
      <label className="formlabel">
        团队名称
        <input
          ref={nameField}
          name="name"
          required
          maxLength={40}
          defaultValue={space?.name || ""}
          placeholder="输入团队名称"
          autoComplete="off"
          onChange={(event) => {
            if (
              message === "请输入团队名称" &&
              event.currentTarget.value.trim()
            )
              setMessage("");
          }}
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
