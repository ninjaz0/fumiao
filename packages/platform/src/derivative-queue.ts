import { Queue, Worker, type ConnectionOptions } from "bullmq";
import {
  generateDerivative,
  listPendingDerivatives,
  type DerivativeVariant,
} from "./derivatives.js";
import type { Platform } from "./platform.js";

/**
 * Low-priority BullMQ worker + durable DB sweep for F038 asset derivatives
 * (400px WebP image thumbnails & 480px JPEG video poster frames).
 */
export class DerivativeQueue {
  readonly queue: Queue;
  readonly worker: Worker;
  private timer?: ReturnType<typeof setInterval>;
  private pending?: Promise<void>;
  private closing = false;
  constructor(
    readonly p: Platform,
    connection: ConnectionOptions,
    readonly name = "fumiao-derivatives",
    readonly onError = (e: unknown) =>
      console.error(
        "Derivative worker pending",
        e instanceof Error ? e.name : "Error",
      ),
  ) {
    this.queue = new Queue(name, { connection });
    this.worker = new Worker(
      name,
      async (job) => {
        const { assetId, variant } = job.data as {
          assetId: string;
          variant: DerivativeVariant;
        };
        await generateDerivative(this.p, assetId, variant);
      },
      {
        connection,
        concurrency: Number(process.env.DERIVATIVE_CONCURRENCY || 4),
      },
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
    const rows = await listPendingDerivatives(this.p.db, 16);
    for (const row of rows) {
      await this.queue.add(
        "derive",
        { assetId: row.asset_id, variant: row.variant },
        {
          jobId: `${row.asset_id}-${row.variant}`,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    }
  }
  async start() {
    if (this.closing || this.timer) return;
    const run = () => this.dispatch().catch(this.onError);
    this.timer = setInterval(() => void run(), 4000);
    await run();
  }
  async close() {
    this.closing = true;
    if (this.timer) clearInterval(this.timer);
    await this.pending?.catch(() => {});
    await this.worker.close();
    await this.queue.close();
  }
}
