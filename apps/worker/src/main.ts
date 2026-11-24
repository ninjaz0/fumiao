import { deliverPluginEvent } from "@fumiao/platform/plugin-extensions.js";
import {StudioPackages} from "@fumiao/platform/studio-packages.js";
import { StudioUpdates } from "@fumiao/platform/studio-updates.js";
import { StoryboardQueue } from "@fumiao/original-api/storyboard-queue.js";
import { OriginalStoryboardExports } from "@fumiao/original-api/storyboard-exports.js";
import { Queue, Worker } from "bullmq";
import { runtime } from "@fumiao/platform/runtime.js";
import { Executor } from "@fumiao/platform/executor.js";
import { QueueHealthPoller } from "@fumiao/platform/queue-health.js";
import { OriginalChats } from "@fumiao/original-api/chats.js";
import { ChatExecution } from "@fumiao/original-api/chat-execution.js";
import { ChatRuntime } from "@fumiao/original-api/chat-runtime.js";
import { ChatQueue } from "@fumiao/original-api/chat-queue.js";
import { redisConnection } from "@fumiao/platform/redis.js";
import { DerivativeQueue } from "@fumiao/platform/derivative-queue.js";
const p = runtime();
const executor = new Executor(p);
const connection = redisConnection(
  process.env.REDIS_URL || "redis://127.0.0.1:6379",
);
const queue = new Queue("fumiao-jobs", { connection });
const chatQueue = new ChatQueue(
  new ChatRuntime(new ChatExecution(new OriginalChats(p))),
  connection,
  {
    onError: (error) =>
      console.error("Chat queue retry/recovery pending", error.name),
  },
);
await chatQueue.start();
const storyboardQueue = new StoryboardQueue(
  new OriginalStoryboardExports(p),
  connection,
);
await storyboardQueue.start();
const derivativeQueue = new DerivativeQueue(p, connection);
await derivativeQueue.start();
const worker = new Worker(
  "fumiao-jobs",
  async (job) => executor.execute(job.data.id),
  { connection, concurrency: Number(process.env.WORKER_CONCURRENCY || 8) },
);
queue.on("error", (error) =>
  console.error("Queue connection error", error.name),
);
worker.on("error", (error) => console.error("Queue worker error", error.name));
let running = false,
  stopping = false;
async function dispatch() {
  if (running || stopping) return;
  running = true;
  try {
    await executor.recover();
    await new StudioPackages(p).finishRemovals();
    const rows = await executor.queueReady();
    for (const row of rows) {
      await queue.add(
        "execute",
        { id: row.id },
        { jobId: row.id, removeOnComplete: true, removeOnFail: true },
      );
      await p.db.query(
        "UPDATE outbox SET sent_at=now(),available_at=now()+interval '5 seconds' WHERE job_id=$1",
        [row.id],
      );
    }
  } catch (error) {
    console.error("Dispatch retry pending", (error as Error).name);
  } finally {
    running = false;
  }
}
const timer = setInterval(() => void dispatch(), 3000);
let checkingHealth = false;
const pollHealth = async () => {
  if (checkingHealth || stopping) return;
  checkingHealth = true;
  try {
    await new QueueHealthPoller(p).refreshEnabled();
  } catch (error) {
    console.error("Queue health retry pending", (error as Error).name);
  } finally {
    checkingHealth = false;
  }
};
let eventBatch: Promise<void> | undefined;
const eventTimer = setInterval(() => {
  if (stopping || eventBatch) return;
  eventBatch = (async () => {
    for (let i = 0; i < 16 && !stopping; i++) {
      if (!(await deliverPluginEvent(p))) break;
    }
  })()
    .catch(() => console.error("Plugin event delivery unavailable"))
    .finally(() => {
      eventBatch = undefined;
    });
}, 1000);
const healthTimer = setInterval(() => void pollHealth(), 15000);
void pollHealth();
const updateTimer=setInterval(()=>void new StudioUpdates(p).due().catch(()=>console.error("Plugin update check unavailable")),60000);
await dispatch();
for (const event of ["SIGTERM", "SIGINT"])
  process.on(event, () => {
    stopping = true;
    clearInterval(timer);
    clearInterval(eventTimer);
    clearInterval(healthTimer);
    clearInterval(updateTimer);
    void Promise.all([
      eventBatch,
      worker.close(),
      chatQueue.close(),
      storyboardQueue.close(),
      derivativeQueue.close(),
    ])
      .then(() => queue.close())
      .then(() => p.db.close())
      .then(() => process.exit(0));
  });
