import { one, type Sql } from "./db.js";
import { requireValue } from "./security.js";
import type { Storage } from "./storage.js";

export const JOB_RESERVE = 64 << 20;
export const EXPORT_RESERVE = 256 << 20;
export const capacityMessage = "空间不足，请先清理素材或作品";

/** A cheap preflight; the deferred database constraint is the authoritative
 * concurrent quota check. Include this transaction's uncommitted deltas. */
export async function capacity(sql: Sql, storage: Storage, extra: number) {
  const row = await one(
    sql,
    `SELECT c.used+COALESCE(d.used_delta,0) AS used,
    c.reserved+COALESCE(d.reserved_delta,0) AS reserved,c.quota FROM storage_capacity c
    LEFT JOIN storage_changes d ON d.transaction_id=txid_current() WHERE c.singleton`,
  );
  requireValue(
    Number(row.used) + Number(row.reserved) + extra <= Number(row.quota),
    507,
    capacityMessage,
  );
  if (storage.availableBytes)
    requireValue(
      (await storage.availableBytes()) >= Math.max(0, extra) + (1 << 30),
      507,
      capacityMessage,
    );
}

export async function artifactCapacity(
  sql: Sql,
  storage: Storage,
  job: string,
  bytes: number,
) {
  const hold = await one(
    sql,
    "SELECT GREATEST(0,budget-materialized) AS remaining FROM storage_holds WHERE job_id=$1",
    [job],
  );
  await capacity(
    sql,
    storage,
    Math.max(0, bytes - Number(hold?.remaining || 0)),
  );
}

/** Only explicit configuration changes the shared quota. API and worker use the
 * same persisted value, including after a restart without FUMIAO_QUOTA. */
export async function configureCapacity(sql: Sql) {
  if (process.env.FUMIAO_QUOTA === undefined) return;
  const quota = Number(process.env.FUMIAO_QUOTA);
  if (!/^\d+$/.test(process.env.FUMIAO_QUOTA) || !Number.isSafeInteger(quota))
    throw new Error("FUMIAO_QUOTA must be a nonnegative integer in bytes");
  await sql.query("UPDATE storage_capacity SET quota=$1 WHERE singleton", [
    quota,
  ]);
}
