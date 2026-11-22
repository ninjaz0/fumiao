import { randomUUID } from "node:crypto";
import type { Platform } from "./platform.js";
import { executableJob } from "./retired-jobs.js";
import { one } from "./db.js";
import type { ProviderPlugin } from "@fumiao/plugin-sdk/index.js";
import {
  queueHealthSchema,
  type QueueHealth,
} from "@fumiao/plugin-sdk/queue.js";

async function probeHealth(
  p: Platform,
  plugin: ProviderPlugin,
  sealedConfig: string,
): Promise<QueueHealth> {
  try {
    return queueHealthSchema.parse(
      await plugin.queueHealth!(
        p.vault.open(sealedConfig),
        AbortSignal.timeout(10000),
      ),
    );
  } catch {
    return { ready: false };
  }
}

// A superseded connection can still have queued jobs that must respect its old
// provider's capacity. Coalesce only matching snapshots and never persist the
// result as the health of the newly installed service.
export class FrozenQueueHealth {
  private readonly recent = new Map<
    string,
    { until: number; value: Promise<QueueHealth> }
  >();

  read(
    p: Platform,
    plugin: ProviderPlugin,
    connection: string,
    sealedConfig: string,
  ) {
    const key = JSON.stringify([
      connection,
      plugin.manifest.id,
      plugin.manifest.version,
      sealedConfig,
    ]);
    const now = Date.now();
    const cached = this.recent.get(key);
    if (cached && cached.until > now) return cached.value;
    for (const [entry, record] of this.recent)
      if (record.until <= now) this.recent.delete(entry);
    if (this.recent.size >= 128)
      this.recent.delete(this.recent.keys().next().value!);
    const value = probeHealth(p, plugin, sealedConfig).then((health) => ({
      ...health,
      checked: Date.now() / 1000,
    }));
    this.recent.set(key, { until: now + 15000, value });
    return value;
  }
}

export class QueueHealthPoller {
  constructor(readonly p: Platform) {}
  async refresh(id: string) {
    const current = await one(
      this.p.db,
      "SELECT plugin_id,plugin_version,revision FROM connections c WHERE id=$1 AND enabled AND to_jsonb(c)->>'sandbox_address_pause' IS NULL",
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
    const health = await probeHealth(this.p, plugin, c.config);
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
  async refreshEnabled() {
    const pending = (
      await this.p.db
        .query(`SELECT c.id FROM connections c JOIN plugin_versions p ON p.id=c.plugin_id AND p.version=c.plugin_version
   WHERE c.enabled AND to_jsonb(c)->>'sandbox_address_pause' IS NULL AND p.manifest->'queue' IS NOT NULL AND p.manifest->>'mode'='request'
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
