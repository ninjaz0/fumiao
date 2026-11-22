export default {
  async run(job, _values, host) {
    const board = (await host.data.get("board")) || [];
    if (board.some((row) => row.id === job.id))
      return { notice: "任务已在审片清单中" };
    if (board.length === 40) {
      const finished = board.findIndex((row) => row.reviewed);
      if (finished < 0) return { notice: "清单已满，请先完成一项审片" };
      board.splice(finished, 1);
    }
    board.push({ id: job.id, reviewed: false });
    await host.data.put("board", board);
    return { notice: "已加入审片清单" };
  },
};
