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
