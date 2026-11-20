import type { PageGroup } from "../../../packages/plugin-sdk/src/contributions";
import {
  ChevronDown,
  Search,
  SunMoon,
  Ticket,
} from "lucide-react";
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
import type { SettingsTab } from "./settings-tabs";
import type { StudioState } from "./state";
import "./settings-ledger.css";
import "./settings-console.css";

const groups = {
  account: "账户",
  services: "生成服务",
  billing: "计费",
  organization: "组织",
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
  const [search, setSearch] = useState("");
  const searchBox = useRef<HTMLInputElement>(null);
  const term = search.trim().toLowerCase();
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const active = sections.find(([key]) => key === tab);
  const now = Date.now() / 1000;
  const inviteCount = state.invite_codes?.filter(
    ({ enabled, expires }) => enabled && (expires === null || expires > now),
  ).length;
  const grouped = Object.entries(groups).map(([group, name]) => ({
    name,
    sections: sections.filter(
      (section) =>
        section[3] === group &&
        (name.includes(term) || section[1].toLowerCase().includes(term)),
    ),
  }));
  useEffect(() => {
    if (expanded)
      panel.current
        ?.querySelector<HTMLButtonElement>('[aria-current="page"]')
        ?.focus();
  }, [expanded]);

  useEffect(() => {
    function shortcut(event: globalThis.KeyboardEvent) {
      const target = event.target;
      if (
        event.key !== "/" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        document.querySelector("dialog[open]") ||
        !(target instanceof HTMLElement) ||
        target.closest("input, textarea, select, [contenteditable=true]")
      )
        return;
      event.preventDefault();
      if (toggle.current?.getClientRects().length) setExpanded(true);
      requestAnimationFrame(() => searchBox.current?.focus());
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  function select(key: SettingsTab) {
    setSearch("");
    window.scrollTo(0, 0);
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
      data-plugin-page={tab.startsWith("plugin:") || undefined}
    >
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
            <label className="ledger-search console-search">
              <Search size={15} aria-hidden="true" />
              <input
                ref={searchBox}
                type="search"
                aria-label="搜索设置项"
                placeholder="搜索设置项…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <kbd aria-hidden="true">/</kbd>
            </label>
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
                            <Ticket
                              className="icon"
                              aria-hidden="true"
                              size={17}
                            />
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
              {grouped.every((group) => !group.sections.length) && (
                <p className="console-empty" role="status">
                  没有匹配的设置项
                </p>
              )}
            </nav>
          </div>
        </div>
        <div className="console-main">
          <header className="settings-title">
            <div className="console-breadcrumb">
              <h1>设置</h1>
              <span>/</span>
              <span>{active && groups[active[3]]}</span>
              <span>/</span>
              <strong>{active?.[1]}</strong>
            </div>
            <button
              type="button"
              className="console-theme"
              aria-label="切换外观主题"
              onClick={() =>
                window.setFumiaoTheme?.(
                  document.documentElement.dataset.theme === "dark"
                    ? "light"
                    : "dark",
                )
              }
            >
              <SunMoon size={15} aria-hidden="true" />
              <span className="switch-to-dark">深色模式</span>
              <span className="switch-to-light">浅色模式</span>
            </button>
          </header>
          {children}
        </div>
      </div>
    </div>
  );
}
