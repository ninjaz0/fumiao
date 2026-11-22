import { Worker } from "node:worker_threads";
import { z } from "zod";

const message = z
  .object({
    ready: z.literal(true).optional(),
    note: z.string().max(500).optional(),
    outcome: z.unknown().optional(),
    failure: z.enum(["invalid", "oversized"]).optional(),
  })
  .strict();

// Backpressure permits one 64 KiB packet in flight. The independent watchdog
// also bounds native interpreter operations that do not check its interrupt hook.
export class ProviderStreamInterpreterError extends Error {}
export async function readProviderStream(
  source: string,
  kind: string,
  body: AsyncIterable<Uint8Array>,
  signal: AbortSignal,
  report?: (note: string) => Promise<void>,
) {
  signal.throwIfAborted();
  const worker = new Worker(
    new URL("./provider-stream-worker.mjs", import.meta.url),
    {
      workerData: { source, kind },
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    },
  );
  type Reply = z.infer<typeof message>;
  let resolve: ((v: Reply) => void) | undefined,
    reject: ((e: unknown) => void) | undefined;
  let stopped = false;
  function fail() {
    stopped = true;
    reject?.(
      new ProviderStreamInterpreterError("Stream interpreter unavailable"),
    );
  }
  function receive(send?: () => void): Promise<Reply> {
    return new Promise((yes, no) => {
      if (stopped || signal.aborted)
        return no(
          new ProviderStreamInterpreterError("Stream interpreter unavailable"),
        );
      const timer = setTimeout(fail, 4000);
      resolve = (v) => {
        clearTimeout(timer);
        yes(v);
      };
      reject = (e) => {
        clearTimeout(timer);
        no(e);
      };
      try {
        send?.();
      } catch {
        fail();
      }
    });
  }
  worker.on("message", (v) => {
    const parsed = message.safeParse(v);
    if (parsed.success) resolve?.(parsed.data);
    else fail();
  });
  worker.once("error", fail);
  worker.once("exit", fail);
  signal.addEventListener("abort", fail, { once: true });
  let lastNote = -Infinity;
  async function feed(chunk: Uint8Array | null) {
    const reply = await receive(() => {
      if (!chunk) return worker.postMessage(null);
      // A socket Buffer can share a much larger backing allocation.
      const packet = Uint8Array.from(chunk);
      worker.postMessage(packet, [packet.buffer]);
    });
    if (reply.note && performance.now() - lastNote > 8000) {
      lastNote = performance.now();
      await report?.(reply.note);
    }
    return reply;
  }
  try {
    if (!(await receive()).ready)
      throw new ProviderStreamInterpreterError(
        "Stream interpreter unavailable",
      );
    for await (const chunk of body) {
      for (let i = 0; i < chunk.length; i += 65536) {
        const reply = await feed(chunk.subarray(i, i + 65536));
        if (reply.failure || reply.outcome !== undefined) return reply;
      }
    }
    return await feed(null);
  } finally {
    signal.removeEventListener("abort", fail);
    await worker.terminate();
  }
}
