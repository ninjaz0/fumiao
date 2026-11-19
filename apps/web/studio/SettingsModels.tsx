import { useLayoutEffect, useRef, useState } from "react";
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
  const [pending, setPending] = useState<{ id: string; enabled: boolean }>();
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
  return (
    <section className="settings-section model-settings" ref={section}>
      <h2>模型管理</h2>
      <ModelSearch
        key={JSON.stringify([scope, policy?.revision, global.revision])}
        search={search}
        disabled={!!pending}
        change={(value) => {
          preferences.search = value;
          setSearch(value);
        }}
      />
      <label className="settings-scope">
        应用范围
        <select
          id="model-policy-scope"
          value={scope}
          disabled={!!pending}
          onChange={(event) => {
            preferences.scope = event.currentTarget.value;
            setSelected(preferences.scope);
          }}
        >
          <option value="global">全站</option>
          {teams.map(({ id, name }) => (
            <option
              key={id}
              value={id}
              ref={(option) => {
                if (option) option.defaultSelected = String(id) === scope;
              }}
            >
              {name}
            </option>
          ))}
        </select>
      </label>
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
              notes,
              hidden: !(group.label + notes).toLowerCase().includes(term),
            };
          });
        return (
          <section
            key={kind}
            className="model-group"
            hidden={rows.every(({ hidden }) => hidden)}
          >
            <h3>{title}</h3>
            {rows.map(({ id, label, open, partial, notes, hidden }) => (
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
            ))}
          </section>
        );
      })}
    </section>
  );
}
