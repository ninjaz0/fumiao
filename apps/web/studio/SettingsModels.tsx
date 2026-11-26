import { useLayoutEffect, useRef, useState } from "react";
import type { AdminSave } from "./settings-admin";
import { summarizeModelSections } from "./settings-models-helpers";
import type { StudioState } from "./state";

function ModelSearch({
  search,
  disabled,
  change,
}: {
  search: string;
  disabled: boolean;
  change: (value: string) => void;
}) {
  const [initial] = useState(search);
  return (
    <input
      className="model-search"
      id="model-policy-search"
      aria-label="搜索模型管理"
      placeholder="搜索模型或提供方"
      defaultValue={initial}
      disabled={disabled}
      onInput={(event) => change(event.currentTarget.value)}
    />
  );
}

export type ModelSettingsPreferences = { scope: string; search: string };

export function ModelSettings({
  state,
  preferences,
  request,
  refresh,
  notify,
}: AdminSave & {
  state: StudioState;
  preferences: ModelSettingsPreferences;
}) {
  const teams = state.workspaces.filter(({ kind }) => kind === "team");
  const [selected, setSelected] = useState(preferences.scope);
  const [search, setSearch] = useState(preferences.search);
  const [pending, setPending] = useState<{ id: string; enabled: boolean }>();
  const [teamSearch, setTeamSearch] = useState("");
  const [customOnly, setCustomOnly] = useState(false);
  const scopeMenu = useRef<HTMLDetailsElement>(null);
  const submit = useRef(false);
  const focus = useRef("");
  const section = useRef<HTMLElement>(null);
  const scope = teams.some(({ id }) => String(id) === selected)
    ? selected
    : "global";
  const global = state.model_policy;
  const policy =
    scope === "global" ? global : state.team_model_policies?.[scope];

  useLayoutEffect(() => {
    if (scope !== selected) {
      preferences.scope = scope;
      setSelected(scope);
    }
  }, [scope, selected, preferences]);
  useLayoutEffect(() => {
    if (!pending && focus.current) {
      section.current
        ?.querySelector<HTMLInputElement>(
          `[data-model="${CSS.escape(focus.current)}"]`,
        )
        ?.focus();
      focus.current = "";
    }
  }, [pending]);

  async function toggle(id: string, enabled: boolean) {
    if (submit.current || !policy) return;
    submit.current = true;
    setPending({ id, enabled });
    try {
      await request(
        "/api/settings/models",
        {
          model: id,
          enabled,
          group: true,
          expected_revision: policy.revision,
          workspace: scope === "global" ? null : Number(scope),
        },
        "PATCH",
      );
      await refresh();
      if (section.current) notify(enabled ? "模型已开放" : "模型已关闭");
    } catch (error) {
      if (section.current) notify((error as Error).message);
      await refresh();
    } finally {
      focus.current = id;
      submit.current = false;
      setPending(undefined);
    }
  }

  const term = search.trim().toLowerCase();
  const groups = summarizeModelSections(state, scope, search);
  const noResults =
    term !== "" && groups.every(({ visibleRows }) => !visibleRows.length);

  return (
    <section className="settings-section model-settings" ref={section}>
      <h2>模型管理</h2>
      <p className="console-description">
        设置全站和各团队空间可使用的生成模型。
      </p>
      <div className="console-model-toolbar">
        <details
          ref={scopeMenu}
          className="console-scope"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget))
              event.currentTarget.open = false;
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.currentTarget.open = false;
              event.currentTarget.querySelector("summary")?.focus();
            }
          }}
        >
          <summary>
            应用范围{" "}
            <strong>
              {teams.find((team) => String(team.id) === scope)?.name ||
                "全站默认"}
            </strong>
          </summary>
          <div className="console-scope-panel">
            <input
              type="search"
              placeholder="搜索团队空间"
              aria-label="搜索策略范围"
              value={teamSearch}
              onChange={(e) => setTeamSearch(e.target.value)}
            />
            <label>
              <input
                type="checkbox"
                checked={customOnly}
                onChange={(e) => setCustomOnly(e.target.checked)}
              />{" "}
              仅看已单独配置的团队
            </label>
            {[
              { id: "global", name: "全站默认" },
              ...teams.filter(
                (team) =>
                  team.name
                    .toLowerCase()
                    .includes(teamSearch.trim().toLowerCase()) &&
                  (!customOnly ||
                    (state.team_model_policies?.[team.id]?.revision ?? 0) > 0),
              ),
            ].map((option) => (
              <button
                type="button"
                key={option.id}
                disabled={!!pending}
                aria-pressed={String(option.id) === scope}
                onClick={() => {
                  preferences.scope = String(option.id);
                  setSelected(preferences.scope);
                  if (scopeMenu.current) {
                    scopeMenu.current.open = false;
                    scopeMenu.current.querySelector("summary")?.focus();
                  }
                  setTeamSearch("");
                }}
              >
                {option.name}
              </button>
            ))}
          </div>
        </details>
        <ModelSearch
          key={JSON.stringify([scope, policy?.revision, global.revision])}
          search={search}
          disabled={!!pending}
          change={(value) => {
            preferences.search = value;
            setSearch(value);
          }}
        />
      </div>
      <div role="status">
        {noResults && <p className="console-empty">没有匹配的模型</p>}
      </div>
      {groups.map(({ kind, title, rows, visibleRows, openCount }) => {
        return (
          <section
            key={kind}
            className="model-group ledger-card"
            hidden={!visibleRows.length}
          >
            <h3 className="console-model-heading">
              {title}
              <small>
                {openCount} / {visibleRows.length} 开放
              </small>
            </h3>
            {rows.map(({ id, label, open, partial, pluginDisabled, notes, hidden }) => {
              const qualifiers = [
                pluginDisabled ? "插件已停用" : "",
                partial ? "部分开放" : "",
              ].filter(Boolean);
              return (
                <div key={id} className="setting-row" hidden={hidden}>
                  <div className="model-setting-name">
                    <span>{label}</span>
                    {notes && <small>{notes}</small>}
                  </div>
                  <label className="model-switch">
                    <input
                      key={JSON.stringify([scope, open > 0])}
                      type="checkbox"
                      role="switch"
                      data-model={id}
                      aria-label={`开放${title}模型 ${label}${qualifiers.length ? `（${qualifiers.join("，")}）` : ""}`}
                      checked={pending?.id === id ? pending.enabled : open > 0}
                      disabled={!!pending}
                      onChange={(event) =>
                        void toggle(id, event.currentTarget.checked)
                      }
                    />
                    <span aria-hidden="true" />
                  </label>
                </div>
              );
            })}
          </section>
        );
      })}
    </section>
  );
}
