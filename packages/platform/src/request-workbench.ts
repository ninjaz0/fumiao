import { z } from "zod";
import type { Manifest, ProviderPlugin } from "@fumiao/plugin-sdk/index.js";
import { requestQueueTools } from "@fumiao/plugin-sdk/request-workbench.js";
import { loadStudioPolicy, planSchema } from "./studio-policy.js";
import { requireValue } from "./security.js";

export const workbenchHooks = [
  "modelForm",
  "namespace",
  "validate",
  "plan",
  "prepare",
  "estimate",
  "configuration",
  "project",
  "timingFeatures",
  "requestCapacity",
  "queuePlan",
];
const message = z.string().min(1).max(300);
const limits = z.number().int().positive();
const requestPlan = planSchema.extend({
  source: z.number().int().positive().optional(),
  referenceBytes: z
    .object({ max: limits.max(100 * 1024 * 1024), message })
    .strict()
    .optional(),
  admission: z
    .object({
      models: z.array(z.string().max(180)).min(1).max(500),
      owner: limits.max(200).optional(),
      global: limits.optional(),
      message,
    })
    .strict()
    .optional(),
  requireConfigured: message.optional(),
});

type StudioFields =
  | "modelForm"
  | "originalSubmission"
  | "originalEstimate"
  | "originalState"
  | "timingFeatures"
  | "requestCapacity"
  | "queuePlan";
export function requestWorkbenchAdapter(
  manifest: Manifest,
  { sync, resource }: Awaited<ReturnType<typeof loadStudioPolicy>>,
): Required<Pick<ProviderPlugin, StudioFields>> {
  const models = new Set(manifest.models.map((m) => m.id));
  return {
    modelForm: (m) => sync("modelForm", m),
    originalSubmission: {
      namespace(d) {
        const namespace = sync("namespace", d);
        requireValue(
          namespace === "-" + manifest.id + "-" + d.kind,
          400,
          "插件请求命名空间不符",
        );
        return namespace;
      },
      validate: (d, phase) => sync("validate", d, phase),
      plan(d) {
        const plan = requestPlan.parse(sync("plan", d));
        requireValue(
          !plan.admission ||
            plan.admission.models.every((id) => models.has(id)),
          400,
          "队列准入模型超出插件范围",
        );
        requireValue(
          plan.refs.every((id) => d.refs.includes(id)) &&
            (plan.source === undefined || plan.source === d.flow_source_job),
          400,
          "生成计划引用不属于当前请求",
        );
        return plan;
      },
      prepare: (d, { capacity, admit, parent, source, references, owner }) =>
        resource(
          "prepare",
          [d, { parent, source, references, owner }],
          ["task.admit", "task.capacity"],
          (name) => (name === "task.admit" ? admit() : capacity()),
        ),
    },
    originalEstimate: {
      prepare: (d, r) =>
        resource("estimate", [d], ["task.references"], async (_name, args) => {
          const ids = z.array(z.string().max(64)).max(12).parse(args[0]);
          requireValue(
            ids.every((id) => d.refs.includes(id)),
            400,
            "估时引用不属于当前请求",
          );
          return r.references(ids);
        }),
    },
    originalState: {
      configured: (c) => Boolean(c.baseUrl && c.apiKey),
      configuration: ({ stamp, connection, imageEnabled }) =>
        sync("configuration", { stamp, connection, imageEnabled }),
      project: (j) => sync("project", j),
    },
    timingFeatures: (d) =>
      sync("timingFeatures", {
        kind: d.kind,
        model: d.model,
        input: {
          params: d.input.params,
          references: d.input.references.map(({ width, height }) => ({
            width,
            height,
          })),
        },
      }),
    requestCapacity: ({ job, jobs, health, stamp }) =>
      sync("requestCapacity", {
        ...(job ? { job: { kind: job.kind, model: job.model } } : {}),
        jobs: jobs.map(({ kind, status, remoteId }) => ({
          kind,
          status,
          remoteId,
        })),
        health,
        stamp,
      }),
    queuePlan(ctx, tools) {
      const predict = requestQueueTools(tools).predict;
      const jobs = ctx.jobs.map(({ id, kind, status, remoteId }) => ({
        id,
        kind,
        status,
        remoteId,
      }));
      const runs = Object.fromEntries(
        jobs
          .filter((j) => Object.hasOwn(ctx.runs, j.id))
          .map((j) => [j.id, { phase: ctx.runs[j.id].phase }]),
      );
      const waiting = ctx.jobs.filter(
        (j) => j.status === "queued" || runs[j.id]?.phase === "queued",
      );
      const predictions = Object.fromEntries(
        waiting.map((j) => [j.id, predict(j)]),
      );
      const remaining = Object.fromEntries(
        ctx.jobs
          .filter((j) => j.status === "running")
          .map((j) => [j.id, tools.remaining(j)]),
      );
      return sync(
        "queuePlan",
        {
          jobs,
          health: ctx.health,
          stamp: ctx.stamp,
          imageEnabled: ctx.imageEnabled,
          runs,
        },
        predictions,
        remaining,
      );
    },
  };
}
