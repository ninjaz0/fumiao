import { Queue, Worker, type ConnectionOptions } from "bullmq";
import type { ChatRuntime } from "./chat-runtime.js";

/** PostgreSQL owns admission, money, stream state and deduplication. Redis is a
 * replaceable wake-up queue; a lost enqueue is retried from the durable outbox. */
export class ChatQueue {
  readonly queue: Queue;
  readonly worker: Worker;
  private timer?: NodeJS.Timeout;
  private dispatching?: Promise<void>;
  private stopping = false;
  constructor(
    readonly runtime: ChatRuntime,
    connection: ConnectionOptions,
    readonly options: {
      name?: string;
      dispatchMs?: number;
      concurrency?: number;
      onError?: (error: Error) => void;
    } = {},
  ) {
    const name = options.name ?? "fumiao-chat";
    this.queue = new Queue(name, { connection });
    this.worker = new Worker(name, (job) => runtime.execute(job.data.id), {
      connection,
      concurrency: options.concurrency ?? 20,
    });
    this.queue.on("error", (e) => options.onError?.(e));
    this.worker.on("error", (e) => options.onError?.(e));
    this.worker.on("failed", (_job, e) => options.onError?.(e));
  }
  async start() {
    if (this.stopping || this.timer) return;
    this.timer = setInterval(() => {
      void this.dispatch().catch((e) => this.options.onError?.(e));
    }, this.options.dispatchMs ?? 1000);
    this.timer.unref();
    await this.dispatch();
  }
  dispatch(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    if (this.dispatching) return this.dispatching;
    this.dispatching = this.dispatchOnce().finally(() => {
      this.dispatching = undefined;
    });
    return this.dispatching;
  }
  private async dispatchOnce() {
    await this.runtime.store.recover();
    for (const row of await this.runtime.store.ready()) {
      if (this.stopping) break;
      await this.queue.add(
        "reply",
        { id: row.id },
        { jobId: row.id, removeOnComplete: true, removeOnFail: true },
      );
      await this.runtime.store.dispatched(row.id);
    }
  }
  async close() {
    this.stopping = true;
    clearInterval(this.timer);
    await this.runtime.close();
    await this.worker.close();
    await this.dispatching?.catch(() => {});
    await this.queue.close();
  }
}
