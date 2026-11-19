export default {
  view({ settings }) {
    const { values, revision } = settings.global;
    return {
      schema: 1,
      title: "目录显示设置",
      blocks: [
        {
          type: "form",
          id: "display",
          presentation: "inline",
          revision,
          fields: [
            {
              type: "select",
              name: "labelMode",
              label: "概览中显示",
              help: "此设置对所有工作区生效。",
              value: values.labelMode,
              required: true,
              options: [
                { value: "name", label: "模型名称" },
                { value: "id", label: "模型 ID" },
              ],
            },
          ],
          submit: { action: "save", label: "保存设置" },
        },
      ],
    };
  },
};
