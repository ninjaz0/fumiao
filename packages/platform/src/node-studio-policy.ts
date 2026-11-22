import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type {
  Manifest,
  ProviderPlugin,
  QueueId,
  QueueSlot,
} from "@fumiao/plugin-sdk/index.js";
import { referenceImporter } from "@fumiao/media-runtime/references.js";
import { loadProgram, runProgram, type HostCall } from "./plugin-program.js";
import { DomainError, requireValue } from "./security.js";

const planSchema = z
  .object({
    namespace: z.string().max(81),
    refs: z.array(z.string().max(64)).max(24),
    roles: z
      .array(
        z.enum(["ref", "ref_audio", "ref_video", "audio", "video", "image"]),
      )
      .max(6),
    missing: z.object({
      status: z.union([z.literal(400), z.literal(404)]),
      message: z.string().max(300),
    }),
    parentKind: z.enum(["any", "audio", "video", "image"]),
  })
  .strict();
const safeStatus = new Set([400, 403, 404, 409, 422, 429, 503]);
const seed = () =>
  Number(randomBytes(8).readBigUInt64BE() & ((1n << 53n) - 1n));
const hooks = [
  "modelForm",
  "configuration",
  "project",
  "namespace",
  "validate",
  "plan",
  "prepare",
  "referenceIds",
  "prepareInput",
  "estimate",
  "forecastEligible",
  "timingFeatures",
  "claimEligible",
  "slots",
];

// The digest lives in the immutable adapter manifest. The package version
// separately pins dispatch, receipt and artifact rules for every accepted job.
export async function nodeStudioPlugin(
  manifest: Manifest,
  source: string,
): Promise<ProviderPlugin> {
  const policy = manifest.originalSubmission;
  requireValue(
    policy?.version === 4 &&
      createHash("sha256").update(source).digest("hex") === policy.studioDigest,
    400,
    "节点池工作台程序摘要不符",
  );
  const describe = await loadProgram(
    `({hooks(){const p=(${source}\n);return Object.keys(p).filter(k=>typeof p[k]==="function")}})`,
  );
  const methods = describe("hooks") as string[];
  requireValue(
    hooks.every((h) => methods.includes(h)) && methods.length === hooks.length,
    400,
    "节点池工作台程序不完整",
  );
  const wrapped = `(()=>{const p=(${source}\n);
    const fail=e=>({error:{status:e.status,message:String(e.message).slice(0,300)}});
    return Object.fromEntries(Object.entries(p).map(([k,f])=>[k,(...args)=>{
      try { const v=f(...args); return v && typeof v.then==="function" ? v.then(value=>({value}),fail) : {value:v}; }
      catch(e){return fail(e)}
    }]))})()`;
  const invoke = await loadProgram(wrapped);
  function unpack(result: any) {
    if (result?.error)
      throw new DomainError(
        safeStatus.has(result.error.status) ? result.error.status : 400,
        String(result.error.message).slice(0, 300),
      );
    return result?.value;
  }
  const sync = (name: string, ...args: unknown[]) =>
    unpack(invoke(name, ...args));
  async function resource(
    name: string,
    args: unknown[],
    method: string,
    call: HostCall,
  ) {
    let failure: unknown;
    const result = await runProgram(
      wrapped,
      name,
      args,
      [method],
      async (fn, params, signal) => {
        try {
          return await call(fn, params, signal);
        } catch (e) {
          failure = e;
          throw e;
        }
      },
    );
    if (failure) throw failure;
    return unpack(result);
  }
  return {
    manifest,
    health: async () => true,
    submit: async () => {
      throw new DomainError(409, "等待节点领取任务");
    },
    modelForm: (m) => sync("modelForm", m),
    referenceIds: (d) => sync("referenceIds", d),
    prepareInput: (d, a) => sync("prepareInput", d, a, seed()),
    originalSubmission: {
      namespace: (d) => sync("namespace", d),
      validate: (d, phase) => sync("validate", d, phase),
      plan: (d) => planSchema.parse(sync("plan", d)),
      prepare: (d, { capacity, references, parent, owner }) =>
        resource(
          "prepare",
          [d, { references, parent, owner }, seed()],
          "task.capacity",
          () => capacity(),
        ),
    },
    originalEstimate: {
      async prepare(d, r) {
        await r.authorize();
        return resource(
          "estimate",
          [d],
          "task.references",
          async (_fn, args) => {
            const [ids, roles, missing] = z
              .tuple([
                z.array(z.string().max(64)).max(12),
                planSchema.shape.roles.optional(),
                planSchema.shape.missing.optional(),
              ])
              .parse([args[0], args[1], args[2]]);
            return r.references(ids, roles, missing);
          },
        );
      },
      eligible: (...args) => sync("forecastEligible", ...args) === true,
    },
    originalState: {
      configured: () => true,
      configuration: () => sync("configuration"),
      project: (j) => sync("project", j),
    },
    ...(manifest.referenceImports
      ? { importReference: referenceImporter.import.bind(referenceImporter) }
      : {}),
    timingFeatures: (d) => sync("timingFeatures", d),
    claimEligible: (...args) => sync("claimEligible", ...args) === true,
    queuePlan(ctx, tools) {
      const remaining = Object.fromEntries(
        ctx.jobs
          .filter((j) => j.status === "running")
          .map((j) => [j.id, tools.remaining(j)]),
      );
      // Only runs belonging to this connection enter its sandbox.
      const runs = Object.fromEntries(
        ctx.jobs
          .filter((j) => Object.hasOwn(ctx.runs, j.id))
          .map((j) => [j.id, ctx.runs[j.id]]),
      );
      const { slots, liveJobs, jobs } = sync(
        "slots",
        { ...ctx, runs },
        remaining,
      ) as {
        slots: QueueSlot[];
        liveJobs: QueueId[];
        jobs: Record<
          string,
          { mode: string; unavailable: string; eligible: boolean[] }
        >;
      };
      requireValue(
        Array.isArray(slots) &&
          slots.length <= ctx.nodes.length * 20 &&
          slots.every(
            (s) => s.node && ctx.nodes.some((n) => n.id === s.node!.id),
          ) &&
          Array.isArray(liveJobs) &&
          liveJobs.length <= ctx.jobs.length,
        422,
        "插件队列计划无效",
      );
      const index = new Map(slots.map((s, i) => [s.node, i]));
      return tools.schedule({
        slots,
        waiting: ctx.jobs.filter((j) => j.status === "queued"),
        mode: (j) => jobs[j.id].mode,
        unavailable: (j) => jobs[j.id].unavailable,
        eligible: (s, j) => jobs[j.id].eligible[index.get(s.node)!] === true,
        predict: (j, s, mode) => {
          if (!tools.supports(j))
            return {
              source: "none",
              samples: 0,
              confidence: "none",
              version: 4,
            };
          const f = tools.features(j, s.node);
          if (s.node?.runtime_id) f.cold = mode !== jobs[j.id].mode;
          return tools.planning(f, s.node?.id, liveJobs);
        },
      });
    },
  };
}
