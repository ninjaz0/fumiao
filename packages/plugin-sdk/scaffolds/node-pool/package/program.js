export default {
  capabilities(report) {
    return {
      ready_models: report.ready === true ? ["starter-node-pool-image"] : [],
    };
  },
  eligible(node, job) {
    return node.ready_models.includes(job.model) && job.kind === "image";
  },
  dispatch(job) {
    return { prompt: job.input.prompt };
  },
  receipt(job, report) {
    return (
      job.kind === "image" &&
      typeof report.prompt_id === "string" &&
      report.prompt_id.length > 0
    );
  },
  artifactRules() {
    return { mime: "image/png", maxBytes: 32 * 1024 * 1024 };
  },
};
