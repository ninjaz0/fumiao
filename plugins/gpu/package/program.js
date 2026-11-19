export default {
  eligible(node, job) {
    if (!(node.ready_models || ["MiniMax H3"]).includes(job.model))
      return false;
    if (job.model !== "MiniMax H3") return true;
    const p = job.input.params,
      workflow = node.workflow || "";
    if (
      Object.keys(p.h3_inputs || {}).length &&
      workflow !== "h3-v6-native-inputs-turbo4"
    )
      return false;
    if (workflow === "h3-v3-rocm-qkv-safe-fast4-i2v768") return false;
    const steps = p.sampling_steps ?? 20;
    if (
      steps === 4 &&
      !["h3-v5-rocm-qkv-safe-turbo4", "h3-v6-native-inputs-turbo4"].includes(
        workflow,
      )
    )
      return false;
    return (node.video_steps || [20]).includes(steps);
  },
};
