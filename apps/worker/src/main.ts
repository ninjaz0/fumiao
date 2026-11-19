import {StudioPackages} from "../../../packages/platform/src/studio-packages.js";
import { StudioUpdates } from "../../../packages/platform/src/studio-updates.js";
import { StoryboardQueue } from "../../../packages/original-api/src/storyboard-queue.js";
import { OriginalStoryboardExports } from "../../../packages/original-api/src/storyboard-exports.js";
import { Queue, Worker } from "bullmq";
import { runtime } from "../../../packages/platform/src/runtime.js";
import { Executor } from "../../../packages/platform/src/executor.js";
import { QueueHealthPoller } from "../../../packages/platform/src/queue-health.js";
import { OriginalChats } from "../../../packages/original-api/src/chats.js";
import { ChatExecution } from "../../../packages/original-api/src/chat-execution.js";
import { ChatRuntime } from "../../../packages/original-api/src/chat-runtime.js";
import { ChatQueue } from "../../../packages/original-api/src/chat-queue.js";
import { redisConnection } from "../../../packages/platform/src/redis.js";
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
const healthTimer = setInterval(() => void pollHealth(), 15000);
void pollHealth();
const updateTimer=setInterval(()=>void new StudioUpdates(p).due().catch(()=>console.error("Plugin update check unavailable")),60000);
await dispatch();
for (const event of ["SIGTERM", "SIGINT"])
  process.on(event, () => {
    stopping = true;
    clearInterval(timer);
    clearInterval(healthTimer);
    clearInterval(updateTimer);
    void Promise.all([
      worker.close(),
      chatQueue.close(),
      storyboardQueue.close(),
    ])
      .then(() => queue.close())
      .then(() => p.db.close())
      .then(() => process.exit(0));
  });
