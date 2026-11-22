import type { ModelForm } from "./model-form.js";
import type {
  OriginalEstimate,
  OriginalSubmission,
  OriginalState,
  ProviderPlugin,
  QueueJob,
  QueueTools,
  QueueContext,
  ModelSpec,
} from "./index.js";

export type RequestQueuePolicy = {
  requestCapacity: NonNullable<ProviderPlugin["requestCapacity"]>;
  queuePlan(
    context: QueueContext,
    tools: {
      predict(job: QueueJob): ReturnType<QueueTools["estimate"]>;
      remaining: QueueTools["remaining"];
    },
  ): ReturnType<NonNullable<ProviderPlugin["queuePlan"]>>;
};
export const unobserved = () => ({
  source: "none",
  samples: 0,
  confidence: "none",
  version: 4,
});
export function requestQueueTools(tools: QueueTools) {
  return {
    remaining: tools.remaining,
    predict: (job: QueueJob) =>
      tools.supports(job) ? tools.estimate(tools.features(job)) : unobserved(),
  };
}
// A request provider's portable Studio entry points. Only the host authorizes
// reference IDs, counts jobs, computes capacity and reads timing history.
export function requestWorkbench(
  submission: OriginalSubmission,
  estimate: OriginalEstimate,
  state: OriginalState,
  queue: RequestQueuePolicy,
  timingFeatures: NonNullable<ProviderPlugin["timingFeatures"]>,
  forms: Record<string, ModelForm>,
) {
  return {
    modelForm: (model: ModelSpec) => forms[model.id],
    namespace: submission.namespace,
    validate: submission.validate,
    plan: submission.plan,
    prepare(
      d: Parameters<OriginalSubmission["prepare"]>[0],
      r: Omit<
        Parameters<OriginalSubmission["prepare"]>[1],
        "capacity" | "admit"
      >,
      host: {
        task: Pick<
          Parameters<OriginalSubmission["prepare"]>[1],
          "capacity" | "admit"
        >;
      },
    ) {
      return submission.prepare(d, {
        ...r,
        admit: host.task.admit,
        capacity: host.task.capacity,
      });
    },
    estimate(
      d: Parameters<OriginalEstimate["prepare"]>[0],
      host: {
        task: Pick<Parameters<OriginalEstimate["prepare"]>[1], "references">;
      },
    ) {
      return estimate.prepare(d, {
        authorize: async () => {},
        references: host.task.references,
      });
    },
    configuration: state.configuration,
    project: state.project,
    timingFeatures,
    requestCapacity: queue.requestCapacity,
    queuePlan(
      context: QueueContext,
      predictions: Record<string, ReturnType<QueueTools["estimate"]>>,
      remaining: Record<string, ReturnType<QueueTools["remaining"]>>,
    ) {
      return queue.queuePlan(context, {
        remaining: (j) => remaining[j.id],
        predict: (j) => predictions[j.id] ?? unobserved(),
      });
    },
  };
}
