import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  countTeamPolicyDiffs,
  filterTeamScopes,
} from "./model-policy-scope";
import type { AdminSave } from "./settings-admin";
import type { StudioState } from "./state";

const sections = [
  ["video", "视频生成"],
  ["image", "图片生成"],
  ["audio", "语音生成"],
  ["chat", "AI 对话"],
] as const;

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
      placeholder="搜索模型"
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
  const [scopeOpen, setScopeOpen] = useState(false);
  const [scopeQuery, setScopeQuery] = useState("");
  const [onlyCustom, setOnlyCustom] = useState(false);
  const [pending, setPending] = useState<{ id: string; enabled: boolean }>();
  const submit = useRef(false);
  const focus = useRef("");
  const section = useRef<HTMLElement>(null);
  const comboRef = useRef<HTMLDivElement>(null);
  const scopeInputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const scope = teams.some(({ id }) => String(id) === selected)
    ? selected
    : "global";
  const global = state.model_policy;
  const policy =
    scope === "global" ? global : state.team_model_policies?.[scope];
  const activeTeam =
    scope === "global"
      ? undefined
      : teams.find(({ id }) => String(id) === scope);

  const diffCount = (teamId: number) =>
    countTeamPolicyDiffs(
      state.model_groups,
      global,
      state.team_model_policies?.[String(teamId)],
    );
  const customTeamCount = teams.filter((team) => diffCount(team.id) > 0).length;
  const activeDiffCount = activeTeam ? diffCount(activeTeam.id) : 0;
  const filteredTeams = filterTeamScopes(
    teams,
    scopeQuery,
    onlyCustom,
    diffCount,
  );
  const showGlobalOption =
    !onlyCustom &&
    (!scopeQuery.trim() ||
      "全站默认策略全局".includes(scopeQuery.trim().toLowerCase()));

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

  useEffect(() => {
    if (!scopeOpen) return;
    scopeInputRef.current?.focus();
    function onPointerDown(event: MouseEvent) {
      if (
        comboRef.current &&
        event.target instanceof Node &&
        !comboRef.current.contains(event.target)
      ) {
        setScopeOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setScopeOpen(false);
        comboRef.current?.querySelector<HTMLButtonElement>("#model-policy-scope")?.focus();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [scopeOpen]);

  function chooseScope(next: string) {
    preferences.scope = next;
    setSelected(next);
    setScopeOpen(false);
  }

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
  return (
    <section className="settings-section model-settings" ref={section}>
      <div className="console-page-head">
        <div>
          <h2>模型管理</h2>
          <p className="console-page-desc">
            控制创作台可见的模型开放策略，默认全站生效，也可按团队空间单独覆盖。
          </p>
        </div>
        <div className="console-combo" ref={comboRef}>
          <button
            type="button"
            id="model-policy-scope"
            className="console-combo-trigger"
            aria-label="应用范围"
            aria-haspopup="listbox"
            aria-expanded={scopeOpen}
            aria-controls={listboxId}
            disabled={!!pending}
            onClick={() => {
              if (!scopeOpen) setScopeQuery("");
              setScopeOpen((open) => !open);
            }}
          >
            <span className="console-combo-trigger-text">
              <span className="console-combo-prefix">应用范围</span>
              <strong>{activeTeam ? activeTeam.name : "全站"}</strong>
              {activeDiffCount > 0 && (
                <span className="console-pill info">
                  独立 {activeDiffCount} 项
                </span>
              )}
            </span>
            <ChevronDown
              aria-hidden="true"
              size={15}
              className="console-combo-chevron"
            />
          </button>
          {scopeOpen && (
            <div
              className="console-combo-panel"
              id={listboxId}
              role="dialog"
              aria-label="选择应用范围"
            >
              {teams.length > 0 && (
                <div className="console-combo-head">
                  <label className="console-pop-search">
                    <Search aria-hidden="true" size={14} />
                    <input
                      ref={scopeInputRef}
                      type="search"
                      aria-label="搜索团队空间"
                      placeholder={`搜索 ${teams.length} 个团队空间...`}
                      value={scopeQuery}
                      onChange={(event) =>
                        setScopeQuery(event.currentTarget.value)
                      }
                    />
                  </label>
                  <div className="console-combo-chips" role="group" aria-label="团队筛选">
                    <button
                      type="button"
                      className={`console-chip${!onlyCustom ? " active" : ""}`}
                      onClick={() => setOnlyCustom(false)}
                    >
                      全部 ({teams.length})
                    </button>
                    <button
                      type="button"
                      className={`console-chip${onlyCustom ? " active" : ""}`}
                      onClick={() => setOnlyCustom(true)}
                    >
                      仅看已单独配置 ({customTeamCount})
                    </button>
                  </div>
                </div>
              )}
              <div className="console-combo-list" role="listbox" aria-label="应用范围列表">
                {showGlobalOption && (
                  <>
                    <div className="console-pop-group">默认策略</div>
                    <button
                      type="button"
                      role="option"
                      aria-selected={scope === "global"}
                      className={`console-combo-opt${scope === "global" ? " active" : ""}`}
                      onClick={() => chooseScope("global")}
                    >
                      <span>全站</span>
                      <span className="console-combo-meta">
                        <span>全部团队默认继承</span>
                        {scope === "global" && <Check aria-hidden="true" size={14} />}
                      </span>
                    </button>
                  </>
                )}
                {teams.length > 0 && (
                  <div className="console-pop-group">
                    团队空间（{filteredTeams.length} / {teams.length}）
                  </div>
                )}
                {filteredTeams.map((team) => {
                  const diffs = diffCount(team.id);
                  const active = scope === String(team.id);
                  return (
                    <button
                      key={team.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      className={`console-combo-opt${active ? " active" : ""}`}
                      onClick={() => chooseScope(String(team.id))}
                    >
                      <span className="console-combo-opt-name">
                        {team.name}
                      </span>
                      <span className="console-combo-meta">
                        {diffs > 0 ? (
                          <span className="console-pill info">
                            独立 {diffs} 项
                          </span>
                        ) : (
                          <span>沿用全站</span>
                        )}
                        {active && <Check aria-hidden="true" size={14} />}
                      </span>
                    </button>
                  );
                })}
                {teams.length > 0 && !filteredTeams.length && !showGlobalOption && (
                  <p className="console-pop-empty">没有匹配的团队空间</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {activeTeam && (
        <div className="console-scope-banner">
          <span>
            当前编辑 <strong>{activeTeam.name}</strong>
            {activeTeam.member_count !== undefined
              ? `（${activeTeam.member_count} 位成员）`
              : ""}
            的模型策略
            {activeDiffCount > 0
              ? ` · 与全站默认有 ${activeDiffCount} 处差异`
              : " · 当前完全沿用全站默认"}
          </span>
          <button
            type="button"
            className="quiet-button"
            disabled={!!pending}
            onClick={() => chooseScope("global")}
          >
            返回全站
          </button>
        </div>
      )}

      <div className="console-toolbar">
        <ModelSearch
          key={JSON.stringify([scope, policy?.revision, global.revision])}
          search={search}
          disabled={!!pending}
          change={(value) => {
            preferences.search = value;
            setSearch(value);
          }}
        />
        {teams.length > 0 && (
          <span className="console-toolbar-meta">
            共 {teams.length} 个团队空间，其中 {customTeamCount} 个有独立策略
          </span>
        )}
      </div>

      {sections.map(([kind, title]) => {
        const rows = Object.entries(state.model_groups || {})
          .filter(([, group]) => group.kind === kind)
          .map(([id, group]) => {
            const open = group.models.filter(
              (model) => policy?.enabled[model],
            ).length;
            const globalOpen = group.models.filter(
              (model) => global.enabled[model],
            ).length;
            const partial = open > 0 && open < group.models.length;
            const overridden =
              scope !== "global" && (open > 0) !== (globalOpen > 0);
            const notes = [
              partial ? "部分开放" : "",
              scope === "global" || globalOpen === group.models.length
                ? ""
                : globalOpen === 0
                  ? "全站已关闭"
                  : "全站部分开放",
              id === "gpt-image-2.6-sunburst" && !state.images.configured
                ? "未配置"
                : "",
            ]
              .filter(Boolean)
              .join(" · ");
            return {
              id,
              label: group.label,
              open,
              partial,
              overridden,
              notes,
              hidden: !(group.label + notes).toLowerCase().includes(term),
            };
          });
        const visibleRows = rows.filter((row) => !row.hidden);
        const enabledInGroup = visibleRows.filter((row) => row.open > 0).length;
        return (
          <section
            key={kind}
            className="model-group ledger-card"
            hidden={rows.every(({ hidden }) => hidden)}
          >
            <div className="console-card-head">
              <h3>{title}</h3>
              <span className="console-pill">
                {enabledInGroup} / {visibleRows.length} 启用
              </span>
            </div>
            {rows.map(
              ({ id, label, open, partial, overridden, notes, hidden }) => (
                <div key={id} className="setting-row" hidden={hidden}>
                  <div className="model-setting-name">
                    <span className="console-row-title">
                      <span>{label}</span>
                      {overridden && (
                        <span className="console-pill info">独立覆盖</span>
                      )}
                    </span>
                    {notes && <small>{notes}</small>}
                  </div>
                  <label className="model-switch">
                    <input
                      key={JSON.stringify([scope, open > 0])}
                      type="checkbox"
                      role="switch"
                      data-model={id}
                      aria-label={`开放${title}模型 ${label}${partial ? "（部分开放）" : ""}`}
                      checked={pending?.id === id ? pending.enabled : open > 0}
                      disabled={!!pending}
                      onChange={(event) =>
                        void toggle(id, event.currentTarget.checked)
                      }
                    />
                    <span aria-hidden="true" />
                  </label>
                </div>
              ),
            )}
          </section>
        );
      })}
    </section>
  );
}
