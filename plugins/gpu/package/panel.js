export default {
  view({ plugin, nodes: { nodes, nodeModels }, jobs }) {
    const statuses = {
      preparing: "准备模型",
      ready: "就绪",
      busy: "生成中",
      error: "准备失败",
      offline: "离线",
    };
    const controls = {
      drain: ["完成后下线", "当前任务回传后停止接单。"],
      stop: ["立即断开", "当前任务可能需要重新生成。"],
      resume: ["恢复接单", "实例在线后将继续接单。"],
      remove: ["移除", "此实例的接入凭据将失效。"],
    };
    return {
      schema: 1,
      title: "GPU 实例",
      primary: { action: "pair", opensForm: "pair", label: "接入GPU实例" },
      blocks: [
        ...(!plugin.enabled
          ? [
              {
                type: "notice",
                tone: "warning",
                text: "已停用 · 剩余 " + plugin.pending + " 个任务",
              },
            ]
          : []),
        {
          type: "form",
          id: "pair",
          presentation: "dialog",
          title: "接入GPU实例",
          fields: [
            { name: "name", type: "text", label: "实例名称", maxLength: 45 },
            {
              name: "models",
              type: "multiselect",
              label: "安装模型",
              required: true,
              value: ["MiniMax H3"],
              options: Object.entries(nodeModels).map(([value, m]) => ({
                value,
                label: m.label,
                detail: m.min_vram_gib + " GiB 显存起",
              })),
            },
          ],
          submit: { action: "pair", label: "生成接入命令" },
        },
        {
          type: "list",
          empty: "暂无接入实例",
          rows: nodes.map((n) => ({
            id: n.id,
            title: n.name,
            status:
              n.stage === "offline"
                ? statuses.offline
                : n.control === "paused"
                  ? "已暂停"
                  : n.control === "draining"
                    ? "完成后下线"
                    : statuses[n.stage],
            metadata: [
              n.models.map((m) => nodeModels[m]?.label || m).join(" · "),
              n.profile?.gpu_name,
            ].filter(Boolean),
            detail: n.stage !== "ready" ? n.detail : "",
            actions: (n.control === "active"
              ? ["drain", "stop", "remove"]
              : ["resume", "remove"]
            ).map((action) => {
              const [label, explanation] = controls[action],
                job = jobs.find(
                  (j) => j.node === n.id && j.status === "running",
                );
              return {
                action,
                label,
                target: n.id,
                confirm: {
                  title: label,
                  summary:
                    (job ? "正在生成 #" + job.id + "。" : "") + explanation,
                },
              };
            }),
          })),
        },
      ],
    };
  },
};
