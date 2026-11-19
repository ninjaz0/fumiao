export default {
  view({ settings, models }) {
    const { showDisabled } = settings.workspace.values;
    const label = showDisabled ? "隐藏停用模型" : "显示停用模型";
    return {
      schema: 1,
      title: "示例模型概览",
      primary: {
        action: "toggle-disabled",
        label,
        confirm: {
          title: label,
          summary: "更改当前工作区的模型列表显示方式。",
        },
      },
      blocks: [
        {
          type: "list",
          empty: "当前没有符合显示条件的模型。",
          rows: models
            .filter((model) => showDisabled || model.enabled)
            .map((model) => ({
              id: model.id,
              title:
                settings.global.values.labelMode === "id"
                  ? model.id
                  : model.label,
              status: model.enabled ? "已启用" : "已停用",
            })),
        },
      ],
    };
  },
  action(id, payload, { settings }) {
    if (id !== "toggle-disabled") throw Error("未知操作");
    const showDisabled = !settings.workspace.values.showDisabled;
    return {
      settings: { workspace: { showDisabled } },
      notice: showDisabled
        ? "当前工作区已显示停用模型"
        : "当前工作区已隐藏停用模型",
    };
  },
};
