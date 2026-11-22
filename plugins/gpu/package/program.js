import { canRunQueueJob } from "../src/queue-policy.js";
import { hardwareSignature } from "../src/timing-policy.js";
import { lanePlan } from "../src/lane-plan.js";
import { checkReport } from "../src/receipt-policy.js";
function workerView(job) {
  const params = job.input.params,
    native = params.h3_inputs;
  const key = (id) => job.assets[id] ?? null;
  const h3_inputs = native
    ? {
        ...native,
        first_frame: key(native.first_frame),
        last_frame: key(native.last_frame),
        files: native.files.map((f) => ({ ...f, id: key(f.id) })),
        video_audio: native.video_audio.map(key),
      }
    : {};
  return {
    ...params,
    audio_settings: { instruction: params.instruction },
    h3_inputs,
    ...job.view,
  };
}
export default {
  capabilities(beat, selected) {
    const steps = beat.video_steps;
    if (
      steps &&
      (!selected.includes("MiniMax H3") ||
        (beat.lane_model && beat.lane_model !== "MiniMax H3") ||
        !Array.isArray(steps) ||
        !steps.length ||
        steps.length > 5 ||
        !steps.every((n) => [4, 16, 20, 32, 50].includes(n)))
    )
      throw Error("采样步数无效");
    return {
      ready_models: beat.ready_models ?? [],
      ...(steps || !beat.lane_model
        ? { features: { video_steps: steps ?? [20] } }
        : {}),
      scheduling: {
        hardware: beat.profile ? hardwareSignature(beat.profile) : "",
        ...(beat.execution_plan
          ? { plan: lanePlan(beat.execution_plan, selected) }
          : {}),
      },
    };
  },
  eligible: canRunQueueJob,
  dispatch(job) {
    return {
      ...workerView(job),
      model: job.model,
      kind: job.kind,
      prompt: job.input.prompt,
      attempts: job.attempts,
      refs: job.input.references.map((path) => path.split("/").pop()),
    };
  },
  receipt(job, report) {
    try {
      const params = {
        ...job.input.params,
        h3_inputs: workerView(job).h3_inputs,
      };
      const checked = checkReport(
        { model: job.model, params },
        { report: JSON.stringify(report) },
        (message) => {
          throw Error(message);
        },
      );
      const { sampling_steps, fast_mode, h3_input_fingerprint, ...timing } =
        checked;
      return {
        timing,
        metadata:
          job.kind === "audio"
            ? {}
            : {
                sampling_steps: params.sampling_steps ?? 20,
                fast_mode: params.sampling_steps === 4,
                ...(h3_input_fingerprint ? { h3_input_fingerprint } : {}),
              },
      };
    } catch {
      return false;
    }
  },
  artifactRules(job) {
    const maxBytes = 64 * 1024 * 1024;
    if (job.kind === "audio")
      return {
        mime: "audio/wav",
        maxBytes,
        audioCodec: "pcm_s16le",
        channels: 1,
        sampleRate: 24000,
        minSeconds: 0.1,
        maxSeconds: 119.5 - 1 / 24000,
        minPeak: 32,
      };
    const { width, height, seconds } = job.input.params;
    const frames = { 5: 124, 10: 243, 15: 362 }[seconds];
    return {
      mime: "video/mp4",
      maxBytes,
      videoCodec: "h264",
      audioCodec: "aac",
      width,
      height,
      frames,
      fps: 24,
      channels: 2,
      sampleRate: 32000,
      minSeconds: frames / 24 - 0.16,
      maxSeconds: frames / 24 + 0.16,
      unrotated: true,
    };
  },
};
