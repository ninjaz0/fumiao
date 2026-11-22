export default {
  async run(job, values, host) {
    const note = await host.data.get("review/" + job.id);
    return { notice: note ? note.slice(0, 300) : "暂无审片备注" };
  },
};
