import type { PageGroup } from "../../../packages/plugin-sdk/src/contributions";
import { ChevronDown, Ticket } from "lucide-react";
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
  const member = state.me.role !== "admin";
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const active = sections.find(([key]) => key === tab);
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
  useEffect(() => {
    if (expanded)
      panel.current
        ?.querySelector<HTMLButtonElement>('[aria-current="page"]')
        ?.focus();
  }, [expanded]);

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
        <h1>设置</h1>
        <span className="settings-space">{workspace?.name}</span>
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
            </nav>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
