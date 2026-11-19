import { randomUUID } from "node:crypto";
import type { Platform } from "./platform.js";
import { executableJob } from "./retired-jobs.js";
import { one } from "./db.js";
import { queueHealthSchema } from "../../plugin-sdk/src/queue.js";

export class QueueHealthPoller {
  constructor(readonly p: Platform) {}
  async refresh(id: string) {
    const current = await one(
      this.p.db,
      "SELECT plugin_id,plugin_version,revision FROM connections WHERE id=$1 AND enabled",
      [id],
    );
    if (!current) return;
    const plugin = await this.p.registry.resolve(
      this.p.db,
      current.plugin_id,
      current.plugin_version,
    );
    if (!plugin.queueHealth) return;
    const token = randomUUID();
    const c = await one(
      this.p.db,
      `UPDATE connections SET queue_refresh_token=$2,queue_refresh_until=now()+interval '30 seconds'
   WHERE id=$1 AND enabled AND revision=$3 AND (queue_refresh_until IS NULL OR queue_refresh_until<now())
   AND ($4=false OR NOT EXISTS(SELECT 1 FROM jobs j WHERE connection_id=$1 AND state IN ('dispatching','running','finalizing') AND ${executableJob}))
   RETURNING *`,
      [
        id,
        token,
        current.revision,
        Boolean(
          plugin.manifest.requestLifecycle &&
          plugin.manifest.requestLifecycle.version !== 1 &&
          plugin.manifest.requestLifecycle.progressUpdatesHealth,
        ),
      ],
    );
    if (!c) return;
    let health = { ready: false } as ReturnType<typeof queueHealthSchema.parse>;
    try {
      health = queueHealthSchema.parse(
        await plugin.queueHealth(
          this.p.vault.open(c.config),
          AbortSignal.timeout(10000),
        ),
      );
    } catch {
      /* Failed probes publish only a bounded unavailable state. */
    } finally {
      await this.p.db.query(
        `UPDATE connections SET queue_health=$3,queue_health_revision=$4,queue_refresh_token=NULL,queue_refresh_until=now()+interval '15 seconds'
    WHERE id=$1 AND queue_refresh_token=$2 AND revision=$4 AND enabled`,
        [
          id,
          token,
          JSON.stringify({ ...health, checked: Date.now() / 1000 }),
          c.revision,
        ],
      );
    }
  }
  async refreshEnabled() {
    const pending = (
      await this.p.db
        .query(`SELECT c.id FROM connections c JOIN plugin_versions p ON p.id=c.plugin_id AND p.version=c.plugin_version
   WHERE c.enabled AND p.manifest->'queue' IS NOT NULL AND p.manifest->>'mode'='request'
   AND (c.queue_refresh_until IS NULL OR c.queue_refresh_until<now()) ORDER BY c.id`)
    ).rows;
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, pending.length) }, async () => {
        for (;;) {
          const row = pending[next++];
          if (!row) return;
          await this.refresh(row.id);
        }
      }),
    );
  }
}
