import type { MouseEvent } from "react";
import { Chevron, Icon } from "./Icon";
import {
  displayName,
  type Member,
  type Space,
  type StudioState,
} from "./state";

const nav = [
  ["home", "创作", "create"],
  ["canvas", "画布", "canvas"],
  ["chat", "对话", "chat"],
  ["library", "资产", "library"],
  ["queue", "任务队列", "queue"],
] as const;
export type Destination = (typeof nav)[number][0];
export type SidebarMenu = "workspaces" | "account";
export type Menu = SidebarMenu | "detail-more";

export function Avatar({
  member,
  current = true,
}: {
  member: Member;
  current?: boolean;
}) {
  return (
    <img
      className="user-avatar"
      src={member.avatar_url || "/avatars/alpine.svg"}
      alt=""
      data-current-avatar={current ? "" : undefined}
    />
  );
}
export function WorkspaceBadge({
  space,
  member,
}: {
  space: Space;
  member: Member;
}) {
  return space.kind === "personal" ? (
    <span className="space-badge personal" aria-hidden="true">
      {[...displayName(member)][0] || "用"}
    </span>
  ) : (
    <span className="space-badge team" aria-hidden="true">
      <Icon name="team" />
    </span>
  );
}
export function Sidebar({
  state,
  page,
  collapsed,
  menu,
  accountOpened,
  navigate,
  collapse,
  open,
}: {
  state: StudioState;
  page: "home" | "queue" | "library" | "chat" | "settings";
  collapsed: boolean;
  menu: Menu | null;
  accountOpened: boolean;
  navigate: (page: Destination | "settings") => void;
  collapse: (event: MouseEvent<HTMLButtonElement>) => void;
  open: (kind: Menu, anchor: HTMLButtonElement) => void;
}) {
  const space = state.workspaces.find(({ id }) => id === state.workspace_id)!;
  const name = displayName(state.me);
  const destinations = page === "settings"
    ? [...nav, ["settings", "设置", "settings"] as const]
    : nav;
  return (
    <>
      <aside className="side">
        <div className="side-head">
          <button
            className="brand-button"
            data-nav="home"
            aria-label="去首页"
            tabIndex={collapsed ? -1 : 0}
            aria-hidden={collapsed}
            onClick={() => navigate("home")}
          >
            <span className="brand">
              <img src="/static/mark.svg" alt="" />
              <span>
                弗淼 <b>AIGC</b>
              </span>
            </span>
          </button>
          <button
            className="icon-button collapse-button"
            data-act="collapse"
            aria-label="收起侧边栏"
            aria-expanded="true"
            disabled={collapsed}
            onClick={collapse}
          >
            <Icon name="sidebar" />
          </button>
          <button
            className="icon-button expand-button"
            data-act="collapse"
            aria-label="展开侧边栏"
            aria-expanded="false"
            disabled={!collapsed}
            onClick={collapse}
          >
            <span className="collapse-glyph">
              <Icon name="sidebar" />
            </span>
          </button>
        </div>
        <button
          className="workspace-switch"
          data-menu="workspaces"
          aria-label={`切换工作区，当前${space.name}`}
          aria-haspopup="dialog"
          aria-expanded={menu === "workspaces"}
          title={space.name}
          onClick={(event) => open("workspaces", event.currentTarget)}
        >
          <WorkspaceBadge space={space} member={state.me} />
          <span className="space-button-name nav-label">{space.name}</span>
          <span className="space-switch-icon nav-label">
            <Icon name="switch" />
          </span>
        </button>
        <nav aria-label="主导航">
          {destinations.map(([id, label, icon]) => (
            <button
              key={id}
              data-nav={id}
              title={label}
              aria-label={label}
              className={page === id ? "active" : ""}
              aria-current={page === id ? "page" : undefined}
              onClick={() => navigate(id)}
            >
              <Icon name={icon} />
              <span className="nav-label">{label}</span>
            </button>
          ))}
        </nav>
        <div className="side-bottom">
          <button
            className="account"
            data-menu="account"
            aria-label="账户"
            title={name}
            aria-expanded={accountOpened ? menu === "account" : undefined}
            onClick={(event) => open("account", event.currentTarget)}
          >
            <Avatar member={state.me} />
            <span className="nav-label" data-current-name="">
              {name}
            </span>
          </button>
        </div>
      </aside>
      <button
        className="rail-backdrop"
        data-act="collapse"
        aria-label="关闭导航"
        tabIndex={-1}
        onClick={collapse}
      ></button>
    </>
  );
}

export function MenuContents({
  kind,
  state,
  select,
  create,
  settings,
  logout,
}: {
  kind: SidebarMenu;
  state: StudioState;
  select: (id: number) => void;
  create: (opener: HTMLButtonElement) => void;
  settings: () => void;
  logout: () => void;
}) {
  const name = displayName(state.me);
  if (kind === "account")
    return (
      <>
        <div className="account-menu-header">
          <Avatar member={state.me} />
          <div className="account-menu-identity">
            <strong data-current-name="" title={name}>
              {name}
            </strong>
          </div>
        </div>
        <div className="menu-divider"></div>
        <button className="menu-item" data-nav="settings" onClick={settings}>
          <Icon name="settings" />
          设置
        </button>
        <button className="menu-item" data-act="logout" onClick={logout}>
          <Icon name="logout" />
          退出登录
        </button>
      </>
    );
  const teams = state.workspaces.filter((space) => space.kind === "team");
  const option = (space: Space) => (
    <button
      key={space.id}
      type="button"
      role="option"
      aria-selected={space.id === state.workspace_id}
      className="space-option"
      data-act="switch-workspace"
      data-id={space.id}
      onClick={() => select(space.id)}
    >
      <WorkspaceBadge space={space} member={state.me} />
      <span className="space-option-name">
        <strong>{space.kind === "personal" ? name : space.name}</strong>
        <small>
          {space.kind === "personal" ? "仅自己可见" : "团队成员可见"}
        </small>
      </span>
      {space.id === state.workspace_id ? (
        <Icon name="check" />
      ) : (
        <span className="space-check-slot" />
      )}
    </button>
  );
  return (
    <>
      <div className="space-menu-label">个人空间</div>
      <div role="listbox" aria-label="个人空间">
        {state.workspaces
          .filter((space) => space.kind === "personal")
          .map(option)}
      </div>
      <div className="space-menu-label space-team-label">
        <span>团队空间</span>
        {state.me.role === "admin" && (
          <button
            className="space-create"
            data-act="create-workspace"
            onClick={(event) => create(event.currentTarget)}
          >
            <Icon name="plus" />
            创建团队
          </button>
        )}
      </div>
      <div className="space-team-options" role="listbox" aria-label="团队空间">
        {teams.length ? (
          teams.map(option)
        ) : (
          <p className="space-empty">尚未加入团队空间</p>
        )}
      </div>
    </>
  );
}

export function HistoryHeading({ open }: { open: () => void }) {
  return (
    <div className="section-head">
      <h2>生成历史</h2>
      <button className="quiet-button" data-nav="library" onClick={open}>
        查看全部 <Chevron />
      </button>
    </div>
  );
}
