export const modelSections = [
  ["video", "视频生成"],
  ["image", "图片生成"],
  ["audio", "语音生成"],
  ["chat", "AI 对话"],
] as const;

export type ModelSectionKind = (typeof modelSections)[number][0];

export type ModelPolicySnapshot = {
  enabled: Record<string, boolean>;
};

export type ModelGroupSnapshot = {
  kind: ModelSectionKind;
  label: string;
  models: string[];
};

export type ModelSettingsStateSnapshot = {
  model_groups?: Record<string, ModelGroupSnapshot>;
  model_catalog: Record<string, { provider?: string } | undefined>;
  model_policy: ModelPolicySnapshot;
  team_model_policies?: Record<string, ModelPolicySnapshot>;
  model_plugin_access?: Record<string, boolean>;
  images: { configured: boolean };
};

export type ModelSectionRow = {
  id: string;
  label: string;
  open: number;
  effectiveOpen: number;
  partial: boolean;
  pluginDisabled: boolean;
  notes: string;
  hidden: boolean;
};

export type ModelSectionSummary = {
  kind: ModelSectionKind;
  title: string;
  rows: ModelSectionRow[];
  visibleRows: ModelSectionRow[];
  openCount: number;
};

export function summarizeModelSections(
  state: ModelSettingsStateSnapshot,
  scope: string,
  search: string,
): ModelSectionSummary[] {
  const global = state.model_policy;
  const policy =
    scope === "global" ? global : state.team_model_policies?.[scope];
  const term = search.trim().toLowerCase();

  return modelSections.map(([kind, title]) => {
    const rows: ModelSectionRow[] = Object.entries(state.model_groups || {})
      .filter(([, group]) => group.kind === kind)
      .map(([id, group]) => {
        const open = group.models.filter(
          (model) => policy?.enabled[model],
        ).length;
        const globalOpen = group.models.filter(
          (model) => global.enabled[model],
        ).length;
        const pluginOpen = group.models.filter(
          (model) => state.model_plugin_access?.[model] !== false,
        ).length;
        const effectiveOpen = group.models.filter(
          (model) =>
            policy?.enabled[model] &&
            state.model_plugin_access?.[model] !== false,
        ).length;
        const pluginDisabled = group.models.length > 0 && pluginOpen === 0;
        const partial = open > 0 && open < group.models.length;
        const notes = [
          pluginDisabled
            ? "插件已停用"
            : pluginOpen < group.models.length
              ? "部分插件已停用"
              : "",
          partial ? "部分开放" : "",
          scope === "global" || globalOpen === group.models.length
            ? ""
            : globalOpen === 0
              ? "全站已关闭"
              : "全站部分开放",
          !pluginDisabled &&
          id === "gpt-image-2.6-sunburst" &&
          !state.images.configured
            ? "未配置"
            : "",
        ]
          .filter(Boolean)
          .join(" · ");
        return {
          id,
          label: group.label,
          open,
          effectiveOpen,
          partial,
          pluginDisabled,
          notes,
          hidden: ![
            group.label,
            notes,
            ...group.models.map((model) => state.model_catalog[model]?.provider),
          ]
            .join(" ")
            .toLowerCase()
            .includes(term),
        };
      });
    const visibleRows = rows.filter(({ hidden }) => !hidden);
    return {
      kind,
      title,
      rows,
      visibleRows,
      openCount: visibleRows.filter(({ effectiveOpen }) => effectiveOpen > 0)
        .length,
    };
  });
}
