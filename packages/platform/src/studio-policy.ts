import { z } from "zod";
import { loadProgram, runProgram, type HostCall } from "./plugin-program.js";
import { requireValue, DomainError } from "./security.js";
export const planSchema = z
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
export async function loadStudioPolicy(
  source: string,
  hooks: readonly string[],
) {
  const describe = await loadProgram(
    `({hooks(){const p=(${source}\n);return Object.keys(p).filter(k=>typeof p[k]==="function")}})`,
  );
  const methods = describe("hooks") as string[];
  requireValue(
    hooks.every((h) => methods.includes(h)) && methods.length === hooks.length,
    400,
    "插件工作台程序不完整",
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
    methods: string[],
    call: HostCall,
  ) {
    let failure: unknown;
    const result = await runProgram(
      wrapped,
      name,
      args,
      methods,
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
  return { sync, resource };
}
