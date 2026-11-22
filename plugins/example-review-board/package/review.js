export default {
  async run(job, _values, host) {
    const board = (await host.data.get("board")) || [];
    const row = board.find((item) => item.id === job.id);
    if (!row) return { notice: "请先将此任务加入审片清单" };
    row.reviewed = true;
    await host.data.put("board", board);
    return { notice: "已完成审片" };
  },
};
