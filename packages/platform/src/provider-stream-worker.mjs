// Only the host's line framing and byte decoder run in this worker. The installed
// program runs inside a fresh, capability-free QuickJS runtime for this response.
import { parentPort, workerData } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { getQuickJS } from "quickjs-emscripten";
import { decodePythonJson } from "@fumiao/plugin-sdk/json.js";

const wireLimit = 8 * 1024 ** 2;
const rt = (await getQuickJS()).newRuntime();
rt.setMemoryLimit(64 * 1024 ** 2);
rt.setMaxStackSize(256 * 1024);
let deadline = 0,
  remainingCpu = 5000;
rt.setInterruptHandler(() => performance.now() > deadline);
const ctx = rt.newContext();
function guest(fn, allowance) {
  const start = performance.now();
  if (remainingCpu <= 0) throw Error("stream CPU budget");
  deadline = start + Math.min(allowance, remainingCpu);
  try {
    return fn();
  } finally {
    remainingCpu -= performance.now() - start;
  }
}
const policy = guest(
  () =>
    ctx.unwrapResult(
      ctx.evalCode(
        `(()=>{const encode=JSON.stringify;const s=(${workerData.source}\n).stream(${JSON.stringify(workerData.kind)});
     return (op,text)=>{const json=encode(op==="line"?s.line(text):s.finish());
       if(typeof json!=="string" || json.length>2097152) throw Error(); return json}})()`,
      ),
    ),
  250,
);
let spent = 0,
  pending = Buffer.alloc(0),
  used = 0;
function call(op, text = "") {
  const name = ctx.newString(op),
    input = ctx.newString(text);
  try {
    return guest(() => {
      const result = ctx.unwrapResult(
        ctx.callFunction(policy, ctx.undefined, name, input),
      );
      try {
        return JSON.parse(ctx.getString(result));
      } finally {
        result.dispose();
      }
    }, 1500);
  } finally {
    name.dispose();
    input.dispose();
  }
}
function append(part) {
  const size = used + part.length;
  if (size > pending.length) {
    const next = Buffer.allocUnsafe(
      Math.min(wireLimit, Math.max(4096, size, 2 * pending.length)),
    );
    pending.copy(next, 0, 0, used);
    pending = next;
  }
  part.copy(pending, used);
  used = size;
}
// Count complete and incomplete lines by bytes, including the LF. A terminal
// SSE marker stops the consumer even if the same packet contains more bytes.
function frame(raw) {
  if (raw.length < 5 || !raw.subarray(0, 5).equals(prefix)) return null;
  let a = 5,
    b = raw.length;
  const space = (x) => x === 32 || (x >= 9 && x <= 13);
  while (a < b && space(raw[a])) a++;
  while (b > a && space(raw[b - 1])) b--;
  const bytes = raw.subarray(a, b);
  if (bytes.equals(done)) return { outcome: call("finish") };
  let text;
  try {
    text = decodePythonJson(bytes);
    // Pass encoded lone surrogates losslessly through QuickJS's UTF-8 interface.
    text = text.replace(
      /[\uD800-\uDFFF]/gu,
      (c) => "\\u" + c.charCodeAt(0).toString(16),
    );
  } catch {
    return null;
  }
  return call("line", text);
}
const prefix = Buffer.from("data:"),
  done = Buffer.from("[DONE]");
parentPort.on("message", (message) => {
  try {
    if (message === null) {
      const event = used ? frame(pending.subarray(0, used)) : null;
      parentPort.postMessage({
        ...event,
        outcome: event?.outcome ?? call("finish"),
      });
      return;
    }
    const bytes = Buffer.from(
      message.buffer,
      message.byteOffset,
      message.byteLength,
    );
    let note;
    for (let at = 0; at < bytes.length;) {
      const lf = bytes.indexOf(10, at);
      const end = lf < 0 ? bytes.length : lf + 1;
      const part = bytes.subarray(at, end);
      spent += part.length;
      if (spent > wireLimit)
        return parentPort.postMessage({ note, failure: "oversized" });
      if (lf < 0) {
        append(part);
        break;
      }
      let line = part;
      if (used) {
        append(part);
        line = pending.subarray(0, used);
        used = 0;
      }
      const event = frame(line);
      if (event?.note) note = event.note;
      if (event?.outcome)
        return parentPort.postMessage({ note, outcome: event.outcome });
      at = end;
    }
    parentPort.postMessage({ note });
  } catch {
    parentPort.postMessage({ failure: "invalid" });
  }
});
parentPort.postMessage({ ready: true });
