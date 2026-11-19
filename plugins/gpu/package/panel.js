// Only JSON crosses the plugin boundary. The host renders these controls with Studio's existing styles.
export default ({ nodes, models, jobs, enabled, pending }) => {
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
    title: "GPU 实例",
    notice: enabled ? "" : "已停用 · 剩余 " + pending + " 个任务",
    empty: "暂无接入实例",
    icon: "gpu",
    add: {
      label: "接入GPU实例",
      nameLabel: "实例名称",
      group: "安装模型",
      namePath: "/api/pairs/default-name",
      path: "/api/pairs",
      nameField: "name",
      optionsField: "models",
      button: "生成接入命令",
      options: Object.entries(models).map(([value, m]) => ({
        value,
        label: m.label,
        detail: m.min_vram_gib + " GiB 显存起",
        selected: value === "MiniMax H3",
      })),
      resultLabel: "接入命令",
      instructions: "在实例终端运行。30 分钟内有效，限用一次。",
    },
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
        (n.models || []).map((m) => models[m]?.label || m).join(" · "),
        n.profile?.gpu_name
          ? n.profile.gpu_name + " · " + n.profile.vram_gib + " GiB"
          : "",
      ].filter(Boolean),
      detail:
        n.stage !== "ready" && n.detail !== "完整模式已就绪" ? n.detail : "",
      actions: (n.control === "active"
        ? ["drain", "stop", "remove"]
        : ["resume", "remove"]
      ).map((op) => {
        const job = jobs.find((j) => j.node === n.id && j.status === "running");
        return {
          op,
          label: controls[op][0],
          summary: (job ? "正在生成 #" + job.id + "。" : "") + controls[op][1],
          path: "/api/nodes/" + n.id + "/" + op,
        };
      }),
    })),
  };
};
