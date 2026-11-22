export default {
  async run(job, values, host) {
    await host.data.put("review/" + job.id, values.note.trim());
    return { notice: "已保存任务 #" + job.id + " 的审片备注" };
  },
};
