import type { PageGroup } from "../../../packages/plugin-sdk/src/contributions";
import { ChevronDown, Search, Ticket } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Icon } from "./Icon";
import { Avatar } from "./Navigation";
import type { SettingsTab } from "./settings-tabs";
import { displayName, type StudioState } from "./state";
import "./settings-ledger.css";

const groups = {
  account: "账户",
  services: "生成服务",
  billing: "计费",
  organization: "组织",
} satisfies Record<PageGroup, string>;

type Section = readonly [
  SettingsTab,
  string,
  ComponentProps<typeof Icon>["name"],
  PageGroup,
];

export function SettingsShell({
  state,
  tab,
  sections,
  navigate,
  children,
  legacyTab,
}: {
  state: StudioState;
  tab: SettingsTab;
  sections: readonly Section[];
  navigate: (tab: SettingsTab) => void;
  children: ReactNode;
  legacyTab?: SettingsTab;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const active = sections.find(([key]) => key === tab);
  const workspace = state.workspaces.find(
    ({ id }) => id === state.workspace_id,
  );
  const now = Date.now() / 1000;
  const inviteCount = state.invite_codes?.filter(
    ({ enabled, expires }) => enabled && (expires === null || expires > now),
  ).length;
  const normalized = query.trim().toLowerCase();
  const filtered = Object.entries(groups).map(([id, name]) => ({
    name,
    sections: sections.filter(
      ([, label, , group]) =>
        id === group && label.toLowerCase().includes(normalized),
    ),
  }));

  useEffect(() => {
    function shortcut(event: globalThis.KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.key !== "/" ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        (event.target instanceof Element &&
          event.target.closest("input, textarea, select, [contenteditable]")) ||
        document.querySelector("dialog[open]")
      )
        return;
      event.preventDefault();
      if (search.current?.getClientRects().length) search.current.focus();
      else setExpanded(true);
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  useEffect(() => {
    if (expanded && toggle.current?.getClientRects().length)
      search.current?.focus();
  }, [expanded]);

  function select(key: SettingsTab) {
    setQuery("");
    setExpanded(false);
    if (toggle.current?.getClientRects().length) toggle.current.focus();
    navigate(key);
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      if (query && event.target === search.current) setQuery("");
      else if (expanded) {
        setExpanded(false);
        toggle.current?.focus();
      } else return;
      event.preventDefault();
      return;
    }
    const buttons = Array.from(
      panel.current?.querySelectorAll<HTMLButtonElement>(
        "[data-act='settings-tab']",
      ) ?? [],
    );
    if (!buttons.length) return;
    if (event.target === search.current) {
      if (event.key === "Enter") buttons[0].click();
      else if (event.key === "ArrowDown") buttons[0].focus();
      else return;
    } else {
      const current = buttons.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      if (current < 0) return;
      const offset = event.key === "ArrowDown" ? 1 : -1;
      switch (event.key) {
        case "Home":
          buttons[0].focus();
          break;
        case "End":
          buttons.at(-1)?.focus();
          break;
        case "ArrowDown":
        case "ArrowUp":
          buttons[(current + offset + buttons.length) % buttons.length].focus();
          break;
        default:
          return;
      }
    }
    event.preventDefault();
  }

  return (
    <div
      className="settings-page ledger-settings"
      data-plugin-page={tab.startsWith("plugin:") || undefined}
    >
      <header className="settings-title">
        <div>
          <h1>设置</h1>
          {active && (
            <p className="ledger-breadcrumb">
              {groups[active[3]]} / <strong>{active[1]}</strong>
            </p>
          )}
        </div>
        <div className="ledger-account">
          <Avatar member={state.me} current={false} />
          <div>
            <strong>{displayName(state.me)}</strong>
            <small>
              {state.me.role === "admin" ? "管理员" : "成员"}
              {workspace && " · " + workspace.name}
            </small>
          </div>
        </div>
      </header>
      <div className="settings-layout">
        <div className="ledger-navigation">
          <button
            className="ledger-navigation-toggle"
            type="button"
            aria-expanded={expanded}
            aria-controls={panelId}
            ref={toggle}
            onClick={() => setExpanded(!expanded)}
          >
            <span>设置分类 · {active?.[1]}</span>
            <ChevronDown aria-hidden="true" size={17} />
          </button>
          <div
            className="ledger-navigation-panel"
            data-expanded={expanded}
            id={panelId}
            ref={panel}
            onKeyDown={keyDown}
          >
            <label className="ledger-search">
              <Search aria-hidden="true" size={16} />
              <input
                type="search"
                aria-label="搜索设置"
                placeholder="搜索设置"
                autoComplete="off"
                value={query}
                ref={search}
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
              <kbd aria-hidden="true">/</kbd>
            </label>
            <nav className="settings-navigation" aria-label="设置分类">
              {filtered.map(
                ({ name, sections }) =>
                  sections.length > 0 && (
                    <section key={name} aria-label={name}>
                      <h2>{name}</h2>
                      {sections.map(([key, label, icon]) => (
                        <button
                          key={key}
                          type="button"
                          data-act="settings-tab"
                          data-value={key}
                          className={tab === key ? "active" : ""}
                          aria-current={tab === key ? "page" : "false"}
                          onClick={() => select(key)}
                        >
                          {key === "invites" ? (
                            <Ticket aria-hidden="true" size={17} />
                          ) : (
                            <Icon name={icon} />
                          )}
                          <span
                            data-value={key === legacyTab ? "gpu" : undefined}
                          >
                            {label}
                          </span>
                          {key === "invites" && !!inviteCount && (
                            <span className="ledger-count" aria-hidden="true">
                              {inviteCount}
                            </span>
                          )}
                        </button>
                      ))}
                    </section>
                  ),
              )}
              {filtered.every(({ sections }) => !sections.length) && (
                <p className="ledger-nav-empty">没有匹配的设置项</p>
              )}
            </nav>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
