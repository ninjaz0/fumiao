import { pythonStrip } from "@fumiao/plugin-sdk/python-text.js";
import { submissionPolicy } from "../src/submission-policy.js";
import { estimatePolicy } from "../src/estimate-policy.js";
import { referenceIds, prepareInput } from "../src/inputs.js";
import { timingFeatures } from "../src/timing-policy.js";
import {
  claimEligible,
  poolSlots,
  canRunQueueJob,
  queueWorkload,
  unavailable,
} from "../src/queue-policy.js";
const submission = submissionPolicy(pythonStrip);

export default {
  modelForm(model) {
    return MODEL_FORMS[model.id];
  },
  configuration() {
    return STATE_CONFIGURATION;
  },
  project(j) {
    const keys =
      j.kind === "audio"
        ? ["duration", "sample_rate", "channels", "format"]
        : ["sampling_steps", "fast_mode", "h3_input_fingerprint"];
    return {
      ...(j.state === "completed"
        ? {
            actual: Object.fromEntries(
              keys
                .filter((k) => Object.hasOwn(j.metadata, k))
                .map((k) => [k, j.metadata[k]]),
            ),
          }
        : {}),
      ...(["uploading", "validating"].includes(j.phase) &&
      !["completed", "failed", "cancelled"].includes(j.state)
        ? { note: "正在回传并校验成片" }
        : {}),
    };
  },
  namespace: submission.namespace,
  validate(d, phase) {
    submission.validate(d, phase);
    return null;
  },
  plan: submission.plan,
  prepare(d, r, seed, host) {
    return submission.prepare(
      { ...d, seed: d.seed ?? (d.kind === "audio" ? seed % 2147483648 : seed) },
      { ...r, capacity: host.task.capacity },
    );
  },
  referenceIds,
  prepareInput(request, assets, seed) {
    request.params.seed ??= request.kind === "audio" ? seed % 2147483648 : seed;
    return prepareInput(request, assets, pythonStrip);
  },
  estimate(d, host) {
    return estimatePolicy.prepare(d, {
      authorize: async () => {},
      references: host.task.references,
    });
  },
  forecastEligible: estimatePolicy.eligible,
  timingFeatures,
  claimEligible,
  slots(context, remaining) {
    const { slots, active, liveJobs } = poolSlots(
      context,
      (j) => remaining[j.id],
    );
    return {
      slots,
      liveJobs,
      jobs: Object.fromEntries(
        context.jobs
          .filter((j) => j.status === "queued")
          .map((j) => [
            j.id,
            {
              mode: queueWorkload(j),
              unavailable: unavailable(j, active),
              eligible: slots.map((s) => canRunQueueJob(s.node, j)),
            },
          ]),
      ),
    };
  },
};
