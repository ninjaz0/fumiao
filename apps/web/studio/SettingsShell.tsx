import type { PageGroup } from "../../../packages/plugin-sdk/src/contributions";
import { Check, ChevronDown, Search, Ticket } from "lucide-react";
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
import { WorkspaceBadge } from "./Navigation";
import type { SettingsTab } from "./settings-tabs";
import { displayName, type StudioState } from "./state";
import "./settings-ledger.css";

const groups = {
  account: "个人",
  organization: "组织",
  billing: "计费",
  services: "生成服务",
  extensions: "插件设置",
} satisfies Record<PageGroup | "extensions", string>;

type Section = readonly [
  SettingsTab,
  string,
  ComponentProps<typeof Icon>["name"],
  keyof typeof groups,
];

export function SettingsShell({
  state,
  tab,
  sections,
  navigate,
  selectWorkspace,
  children,
  legacyTab,
}: {
  state: StudioState;
  tab: SettingsTab;
  sections: readonly Section[];
  navigate: (tab: SettingsTab) => void;
  selectWorkspace?: (id: number) => void;
  children: ReactNode;
  legacyTab?: SettingsTab;
}) {
  const member = state.me.role !== "admin";
  const [expanded, setExpanded] = useState(false);
  const [spaceOpen, setSpaceOpen] = useState(false);
  const [spaceQuery, setSpaceQuery] = useState("");
  const panelId = useId();
  const spaceMenuId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const spaceWrap = useRef<HTMLDivElement>(null);
  const spaceSearch = useRef<HTMLInputElement>(null);

  const active = sections.find(([key]) => key === tab);
  const activeGroupName = active ? groups[active[3]] : "";
  const workspace = state.workspaces.find(
    ({ id }) => id === state.workspace_id,
  );
  const now = Date.now() / 1000;
  const inviteCount = state.invite_codes?.filter(
    ({ enabled, expires }) => enabled && (expires === null || expires > now),
  ).length;
  const grouped = Object.entries(groups).map(([group, name]) => ({
    name,
    sections: sections.filter((section) => section[3] === group),
  }));

  const needle = spaceQuery.trim().toLowerCase();
  const personalSpaces = state.workspaces.filter(
    (s) =>
      s.kind === "personal" &&
      (!needle ||
        (s.name + " " + displayName(state.me)).toLowerCase().includes(needle)),
  );
  const teamSpaces = state.workspaces.filter(
    (s) => s.kind === "team" && (!needle || s.name.toLowerCase().includes(needle)),
  );
  const canSwitchWorkspace =
    Boolean(selectWorkspace) && state.workspaces.length > 1;

  useEffect(() => {
    if (expanded)
      panel.current
        ?.querySelector<HTMLButtonElement>('[aria-current="page"]')
        ?.focus();
  }, [expanded]);

  useEffect(() => {
    if (!spaceOpen) return;
    spaceSearch.current?.focus();
    function onPointerDown(event: MouseEvent) {
      if (
        spaceWrap.current &&
        event.target instanceof Node &&
        !spaceWrap.current.contains(event.target)
      ) {
        setSpaceOpen(false);
      }
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setSpaceOpen(false);
        spaceWrap.current
          ?.querySelector<HTMLButtonElement>(".settings-space-trigger")
          ?.focus();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [spaceOpen]);

  function select(key: SettingsTab) {
    setExpanded(false);
    if (toggle.current?.getClientRects().length) toggle.current.focus();
    navigate(key);
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      if (expanded) {
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
    event.preventDefault();
  }

  return (
    <div
      className="settings-page ledger-settings"
      data-member={member}
      data-plugin-page={tab.startsWith("plugin:") || undefined}
    >
      <header className="settings-title">
        <div className="console-title-group">
          <h1>设置</h1>
          {active && (
            <span className="console-breadcrumb" aria-hidden="true">
              <span>/</span>
              <span>{activeGroupName}</span>
              <span>/</span>
              <strong>{active[1]}</strong>
            </span>
          )}
        </div>
        {workspace &&
          (canSwitchWorkspace ? (
            <div className="console-space-switcher" ref={spaceWrap}>
              <button
                type="button"
                className="settings-space settings-space-trigger"
                aria-haspopup="listbox"
                aria-expanded={spaceOpen}
                aria-controls={spaceMenuId}
                onClick={() => {
                  if (!spaceOpen) setSpaceQuery("");
                  setSpaceOpen((open) => !open);
                }}
              >
                <WorkspaceBadge space={workspace} member={state.me} />
                <span className="settings-space-name">{workspace.name}</span>
                <ChevronDown aria-hidden="true" size={14} />
              </button>
              {spaceOpen && (
                <div
                  className="console-combo-panel console-space-panel"
                  id={spaceMenuId}
                  role="dialog"
                  aria-label="切换当前空间"
                >
                  {state.workspaces.length >= 4 && (
                    <div className="console-combo-head">
                      <label className="console-pop-search">
                        <Search aria-hidden="true" size={14} />
                        <input
                          ref={spaceSearch}
                          type="search"
                          aria-label="筛选空间"
                          placeholder={`搜索 ${state.workspaces.length} 个空间...`}
                          value={spaceQuery}
                          onChange={(event) =>
                            setSpaceQuery(event.currentTarget.value)
                          }
                        />
                      </label>
                    </div>
                  )}
                  <div
                    className="console-combo-list"
                    role="listbox"
                    aria-label="可用空间"
                  >
                    {personalSpaces.length > 0 && (
                      <>
                        <div className="console-pop-group">个人空间</div>
                        {personalSpaces.map((space) => {
                          const current = space.id === state.workspace_id;
                          return (
                            <button
                              key={space.id}
                              type="button"
                              role="option"
                              aria-selected={current}
                              className={`console-combo-opt${current ? " active" : ""}`}
                              onClick={() => {
                                setSpaceOpen(false);
                                if (!current) selectWorkspace?.(space.id);
                              }}
                            >
                              <span className="console-combo-opt-name">
                                {space.name}
                              </span>
                              <span className="console-combo-meta">
                                <span>仅自己可见</span>
                                {current && <Check aria-hidden="true" size={14} />}
                              </span>
                            </button>
                          );
                        })}
                      </>
                    )}
                    {teamSpaces.length > 0 && (
                      <>
                        <div className="console-pop-group">
                          团队空间（{teamSpaces.length}）
                        </div>
                        {teamSpaces.map((space) => {
                          const current = space.id === state.workspace_id;
                          return (
                            <button
                              key={space.id}
                              type="button"
                              role="option"
                              aria-selected={current}
                              className={`console-combo-opt${current ? " active" : ""}`}
                              onClick={() => {
                                setSpaceOpen(false);
                                if (!current) selectWorkspace?.(space.id);
                              }}
                            >
                              <span className="console-combo-opt-name">
                                {space.name}
                              </span>
                              <span className="console-combo-meta">
                                {space.member_count !== undefined && (
                                  <span>{space.member_count} 人</span>
                                )}
                                {current && <Check aria-hidden="true" size={14} />}
                              </span>
                            </button>
                          );
                        })}
                      </>
                    )}
                    {!personalSpaces.length && !teamSpaces.length && (
                      <p className="console-pop-empty">没有匹配的空间</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <span className="settings-space">{workspace.name}</span>
          ))}
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
            <nav className="settings-navigation" aria-label="设置分类">
              {grouped.map(
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
            </nav>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
