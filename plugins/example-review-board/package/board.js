export default {
  async view(_input, host) {
    const board = (await host.data.get("board")) || [];
    const tabs = [
      { id: "pending", label: "待审", reviewed: false },
      { id: "done", label: "已审", reviewed: true },
    ];
    if (!board.length)
      return {
        schema: 2,
        title: "审片清单",
        blocks: [{ type: "text", text: "从任务菜单选择「加入审片清单」。" }],
      };
    return {
      schema: 2,
      title: "审片清单",
      blocks: [
        {
          type: "progress",
          label: "已完成审片",
          value: board.filter((row) => row.reviewed).length,
          max: board.length,
        },
        {
          type: "tabs",
          label: "审片状态",
          tabs: tabs.map((tab) => {
            const rows = board.filter((row) => row.reviewed === tab.reviewed);
            return {
              id: tab.id,
              label: tab.label,
              blocks: rows.length
                ? [
                    {
                      type: "table",
                      title: tab.label + "任务",
                      columns: ["任务编号"],
                      rows: rows.map((row) => ["#" + row.id]),
                    },
                  ]
                : [{ type: "text", text: "暂无" + tab.label + "任务" }],
            };
          }),
        },
      ],
    };
  },
};
