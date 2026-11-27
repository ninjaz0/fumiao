import type { MouseEvent } from "react";
import { Chevron, Icon } from "./Icon";
import {
  Avatar,
  WorkspaceBadge,
  primaryDestinations,
  type Destination,
  type Menu,
} from "./Navigation";
import type { StudioState } from "./state";

// The tab bar has room for five short labels only.
const tabLabels: Partial<Record<Destination, string>> = { queue: "队列" };

/** Phone header (≤760px): drawer button, brand, workspace and account. */
export function MobileTopBar({
  state,
  menu,
  drawerOpen,
  openDrawer,
  open,
}: {
  state: StudioState;
  menu: Menu | null;
  drawerOpen: boolean;
  openDrawer: (event: MouseEvent<HTMLButtonElement>) => void;
  open: (kind: Menu, anchor: HTMLButtonElement) => void;
}) {
  const space = state.workspaces.find(({ id }) => id === state.workspace_id)!;
  return (
    <header className="mobile-topbar">
      <button
        className="mobile-menu-button"
        aria-label="打开导航"
        aria-expanded={drawerOpen}
        onClick={openDrawer}
      >
        <Icon name="menu" />
      </button>
      <img className="mobile-brand" src="/static/mark.svg" alt="" />
      <button
        className="mobile-workspace-switch"
        data-menu="workspaces"
        aria-label={`切换工作区，当前${space.name}`}
        aria-haspopup="dialog"
        aria-expanded={menu === "workspaces"}
        onClick={(event) => open("workspaces", event.currentTarget)}
      >
        <WorkspaceBadge space={space} member={state.me} />
        <span className="space-button-name">{space.name}</span>
        <Chevron />
      </button>
      <button
        className="mobile-account"
        data-menu="account"
        aria-label="账户"
        aria-haspopup="dialog"
        aria-expanded={menu === "account"}
        onClick={(event) => open("account", event.currentTarget)}
      >
        <Avatar member={state.me} />
      </button>
    </header>
  );
}

/** Phone bottom tab bar (≤760px) for the five primary pages. */
export function MobileTabBar({
  page,
  hidden,
  inert,
  navigate,
}: {
  page: string;
  hidden: boolean;
  inert?: boolean;
  navigate: (destination: Destination) => void;
}) {
  return (
    <nav className="mobile-tabbar" aria-label="主要页面" hidden={hidden} inert={inert}>
      {primaryDestinations.map(([id, label, icon]) => (
        <button
          key={id}
          data-tab={id}
          aria-current={page === id ? "page" : undefined}
          onClick={() => navigate(id)}
        >
          <Icon name={icon} />
          <span>{tabLabels[id] ?? label}</span>
        </button>
      ))}
    </nav>
  );
}
