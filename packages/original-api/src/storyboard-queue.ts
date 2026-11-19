import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { OriginalStoryboardExports } from "./storyboard-exports.js";
/** PostgreSQL queued rows are the durable outbox. Redis loss cannot lose acceptance. */
export class StoryboardQueue {
  readonly queue: Queue;
  readonly worker: Worker;
  private timer?: ReturnType<typeof setInterval>;
  private pending?: Promise<void>;
  private closing = false;
  constructor(
    readonly service: OriginalStoryboardExports,
    connection: ConnectionOptions,
    readonly name = "fumiao-storyboard",
    readonly onError = (e: unknown) =>
      console.error(
        "Storyboard recovery pending",
        e instanceof Error ? e.name : "Error",
      ),
  ) {
    this.queue = new Queue(name, { connection });
    this.worker = new Worker(
      name,
      async (job) => service.execute(job.data.id),
      { connection, concurrency: 1 },
    );
    this.queue.on("error", onError);
    this.worker.on("error", onError);
    this.worker.on("failed", (_job, error) => onError(error));
  }
  dispatch(): Promise<void> {
    if (this.closing) return Promise.resolve();
    if (this.pending) return this.pending;
    this.pending = this.dispatchOnce().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }
  private async dispatchOnce() {
    await this.service.expireLeases();
    for (const row of await this.service.ready())
      await this.queue.add(
        "compose",
        { id: row.id },
        { jobId: row.id, removeOnComplete: true, removeOnFail: true },
      );
    await this.service.cleanupObjects();
  }
  async start() {
    if (this.closing || this.timer) return;
    const dispatch = () => this.dispatch().catch(this.onError);
    this.timer = setInterval(() => void dispatch(), 3000);
    await dispatch();
  }
  async close() {
    this.closing = true;
    if (this.timer) clearInterval(this.timer);
    await this.pending?.catch(() => {});
    await this.worker.close();
    await this.queue.close();
  }
}
