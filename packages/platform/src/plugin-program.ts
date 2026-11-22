import { getQuickJS, type QuickJSWASMModule } from "quickjs-emscripten";
import { DomainError, requireValue } from "./security.js";

// Guest programs receive JSON only. No host objects, credentials, filesystem,
// network, timers or process bindings are installed in the interpreter.
export async function loadProgram(source: string) {
  const engine = await getQuickJS();
  return (hook: string, ...args: unknown[]) =>
    invoke(engine, source, hook, args);
}
function invoke(
  engine: QuickJSWASMModule,
  source: string,
  hook: string,
  args: unknown[],
) {
  const rt = engine.newRuntime();
  rt.setMemoryLimit(16 * 1024 * 1024);
  rt.setMaxStackSize(256 * 1024);
  const deadline = performance.now() + 100;
  rt.setInterruptHandler(() => performance.now() > deadline);
  const ctx = rt.newContext();
  try {
    const code =
      hook === "describe"
        ? "JSON.stringify(Object.keys((" + source + "\n)))"
        : "JSON.stringify((" +
          source +
          "\n)[" +
          JSON.stringify(hook) +
          "](...JSON.parse(" +
          JSON.stringify(JSON.stringify(args)) +
          ")))";
    const result = ctx.evalCode(code);
    if (result.error) {
      result.error.dispose();
      throw new DomainError(400, "插件程序执行失败");
    }
    try {
      const value = ctx.getString(result.value);
      requireValue(value.length <= 2 * 1024 * 1024, 400, "插件程序输出过大");
      return JSON.parse(value);
    } finally {
      result.value.dispose();
    }
  } finally {
    ctx.dispose();
    rt.dispose();
  }
}

/** Host function names a program may call, e.g. `data.get`. */
export type HostCall = (
  name: string,
  args: unknown[],
  signal: AbortSignal,
) => Promise<unknown>;
export const programLimits = {
  /** Guest execution time. Waiting for the host is not counted. */
  cpuMs: 250,
  wallMs: 15_000,
  hostCalls: 32,
  hostResultBytes: 2 * 1024 * 1024,
};

// Hooks may be async and call the host functions granted to this invocation.
// The guest still receives JSON only: `host` is built inside the interpreter
// from the granted names, and every call crosses as a JSON string.
export async function runProgram(
  source: string,
  hook: string,
  args: unknown[],
  granted: readonly string[] = [],
  call?: HostCall,
) {
  const engine = await getQuickJS();
  const rt = engine.newRuntime();
  rt.setMemoryLimit(16 * 1024 * 1024);
  rt.setMaxStackSize(256 * 1024);
  let spent = 0;
  let slice = 0;
  rt.setInterruptHandler(
    () => spent + performance.now() - slice > programLimits.cpuMs,
  );
  const ctx = rt.newContext();
  const abort = new AbortController();
  const pending = new Set<{ dispose(): void }>();
  let alive = true;
  let calls = 0;
  let idle = () => {};
  let unclaimed:
    { error?: { dispose(): void }; value?: { dispose(): void } } | undefined;
  const guest = <T>(run: () => T) => {
    slice = performance.now();
    try {
      return run();
    } finally {
      spent += performance.now() - slice;
    }
  };
  const bridge = ctx.newFunction("__host", (nameHandle, argsHandle) => {
    const name = ctx.getString(nameHandle);
    const deferred = ctx.newPromise();
    pending.add(deferred);
    const settle = (ok: boolean, value: string) => {
      if (!alive) return;
      pending.delete(deferred);
      const handle = ctx.newString(value);
      if (ok) deferred.resolve(handle);
      else deferred.reject(handle);
      handle.dispose();
      deferred.dispose();
      guest(() => rt.executePendingJobs());
      idle();
    };
    (async () => {
      if (!call || !granted.includes(name))
        throw new DomainError(403, "插件未声明此宿主能力");
      if (++calls > programLimits.hostCalls)
        throw new DomainError(429, "插件程序调用宿主次数过多");
      const result = JSON.stringify(
        (await call(
          name,
          JSON.parse(ctx.getString(argsHandle)),
          abort.signal,
        )) ?? null,
      );
      requireValue(
        result.length <= programLimits.hostResultBytes,
        413,
        "宿主返回内容过大",
      );
      return result;
    })().then(
      (value) => settle(true, value),
      (error) =>
        settle(
          false,
          error instanceof DomainError ? error.message : "宿主调用失败",
        ),
    );
    return deferred.handle;
  });
  ctx.setProp(ctx.global, "__host", bridge);
  bridge.dispose();
  // { "data.get": 1 } becomes host.data.get(...). Rejections arrive as Error.
  const code = `(async () => {
    const call = __host; delete globalThis.__host;
    const host = {};
    for (const name of ${JSON.stringify(granted)}) {
      const [group, method] = name.split(".");
      (host[group] ??= {})[method] = (...args) =>
        call(name, JSON.stringify(args)).then(JSON.parse, (m) => { throw new Error(m); });
    }
    return JSON.stringify(await (${source}\n)[${JSON.stringify(hook)}](...JSON.parse(${JSON.stringify(JSON.stringify(args))}), host));
  })()`;
  // Stop listening to the guest before cancelling its host calls, so their
  // late results cannot re-enter an interpreter that is being torn down.
  const timer = setTimeout(() => {
    alive = false;
    abort.abort();
  }, programLimits.wallMs);
  try {
    const started = guest(() => ctx.evalCode(code));
    if (started.error) {
      started.error.dispose();
      throw new DomainError(400, "插件程序执行失败");
    }
    const settled = ctx.resolvePromise(started.value);
    started.value.dispose();
    let done = false;
    void settled.then((outcome) => {
      done = true;
      unclaimed = outcome;
    });
    guest(() => rt.executePendingJobs());
    const result = await Promise.race([
      settled,
      new Promise<never>((_, reject) => {
        abort.signal.addEventListener("abort", () =>
          reject(new DomainError(408, "插件程序执行超时")),
        );
        // Nothing left to run and no host call in flight: it cannot finish.
        idle = () =>
          setImmediate(() => {
            if (!done && !pending.size)
              reject(new DomainError(400, "插件程序执行失败"));
          });
        idle();
      }),
    ]);
    unclaimed = undefined;
    if (result.error) {
      result.error.dispose();
      throw new DomainError(400, "插件程序执行失败");
    }
    try {
      const value = ctx.getString(result.value);
      requireValue(value.length <= 2 * 1024 * 1024, 400, "插件程序输出过大");
      return JSON.parse(value);
    } finally {
      result.value.dispose();
    }
  } finally {
    clearTimeout(timer);
    alive = false;
    abort.abort();
    for (const deferred of pending) deferred.dispose();
    // Let a result that lost the race to a limit surface, then release it.
    await new Promise((next) => setImmediate(next));
    (unclaimed?.error ?? unclaimed?.value)?.dispose();
    ctx.dispose();
    rt.dispose();
  }
}
