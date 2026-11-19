import { Worker } from "node:worker_threads";
import { DomainError } from "../../platform/src/security.js";
import type { ImportResult } from "./convert.js";
import {
  ProviderImageError,
  type ProviderImageResult,
} from "./provider-types.js";
export { ProviderImageError } from "./provider-types.js";
type ImageResult = ImportResult | ProviderImageResult;
type Job = {
  input: string;
  output: string;
  mode: "reference" | "avatar" | "provider" | "generated-png";
  signal?: AbortSignal;
  resolve: (value: ImageResult) => void;
  reject: (error: Error) => void;
  aborted: () => void;
};
/** Only paths cross the queue. Each conversion gets an isolated worker whose
 * native/WASM decoder memory is released before another waiting job starts. */
export class ImageImporter {
  private active = 0;
  private queue: Job[] = [];
  constructor(
    readonly concurrency = 1,
    readonly maxQueued = 32,
    readonly timeoutMs = 120000,
  ) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8)
      throw new Error("IMAGE_CONCURRENCY must be an integer from 1 to 8");
    if (!Number.isInteger(maxQueued) || maxQueued < 0)
      throw new Error("Image queue limit must be a nonnegative integer");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
      throw new Error("Image timeout must be a positive integer");
  }
  convert(
    input: string,
    output: string,
    mode: "reference" | "avatar",
    signal?: AbortSignal,
  ) {
    return this.enqueue(input, output, mode, signal) as Promise<ImportResult>;
  }
  inspect(input: string, signal?: AbortSignal) {
    return this.enqueue(
      input,
      "",
      "provider",
      signal,
    ) as Promise<ProviderImageResult>;
  }
  inspectGeneratedPng(input: string, signal?: AbortSignal) {
    return this.enqueue(
      input,
      "",
      "generated-png",
      signal,
    ) as Promise<ProviderImageResult>;
  }
  private enqueue(
    input: string,
    output: string,
    mode: Job["mode"],
    signal?: AbortSignal,
  ) {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (this.active >= this.concurrency && this.queue.length >= this.maxQueued)
      return Promise.reject(new DomainError(503, "请求处理失败"));
    return new Promise<ImageResult>((resolve, reject) => {
      const job: Job = {
        input,
        output,
        mode,
        signal,
        resolve,
        reject,
        aborted: () => {
          const index = this.queue.indexOf(job);
          if (index >= 0) {
            this.queue.splice(index, 1);
            reject(signal!.reason);
          }
        },
      };
      signal?.addEventListener("abort", job.aborted, { once: true });
      this.queue.push(job);
      this.drain();
    });
  }
  private drain() {
    while (this.active < this.concurrency && this.queue.length) {
      const job = this.queue.shift()!;
      job.signal?.removeEventListener("abort", job.aborted);
      if (job.signal?.aborted) {
        job.reject(job.signal.reason);
        continue;
      }
      this.active++;
      void this.run(job).finally(() => {
        this.active--;
        this.drain();
      });
    }
  }
  private async run(job: Job) {
    let worker: Worker | undefined,
      timer: ReturnType<typeof setTimeout> | undefined;
    let abort = () => {};
    try {
      worker = new Worker(new URL("./worker.mjs", import.meta.url), {
        execArgv: [],
        workerData: { input: job.input, output: job.output, mode: job.mode },
      });
      const result = await new Promise<ImageResult>((resolve, reject) => {
        worker!.once("message", (message) =>
          message.ok
            ? resolve(message.result)
            : reject(
                message.provider
                  ? new ProviderImageError(message.provider)
                  : new DomainError(
                      message.domain ? 400 : 500,
                      message.message,
                    ),
              ),
        );
        worker!.once("error", reject);
        worker!.once("exit", () =>
          reject(new Error("Image worker exited before replying")),
        );
        timer = setTimeout(
          () => reject(new DomainError(503, "请求处理失败")),
          this.timeoutMs,
        );
        abort = () => reject(job.signal!.reason);
        job.signal?.addEventListener("abort", abort, { once: true });
        if (job.signal?.aborted) abort();
      });
      // Do not release the slot or staging files while a decoder can still touch them.
      await worker.terminate();
      worker = undefined;
      job.resolve(result);
    } catch (error) {
      // A failed termination must not leave the caller or queue pending forever.
      if (worker) await worker.terminate().catch(() => {});
      worker = undefined;
      job.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      if (timer) clearTimeout(timer);
      job.signal?.removeEventListener("abort", abort);
    }
  }
}
export const imageImporter = new ImageImporter(
  Number(process.env.IMAGE_CONCURRENCY || 1),
);
