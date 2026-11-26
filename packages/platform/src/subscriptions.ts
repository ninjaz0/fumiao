import { one } from "./db.js";
import type { Platform } from "./platform.js";

/**
 * F034 + Q5: Idempotent periodic credit grant worker for active workspace subscriptions.
 * Protected by PRIMARY KEY(subscription_id, period_start) AND ledger.key uniqueness
 * ("sub:<subscriptionId>:<periodStartIso>") so retries, restarts, and multiple workers
 * settle each billing period EXACTLY ONCE.
 */
export async function grantDueSubscriptions(p: Platform): Promise<number> {
  const tableCheck = await one(
    p.db,
    "SELECT to_regclass('workspace_subscriptions') AS ws, to_regclass('subscription_grants') AS sg",
  );
  if (!tableCheck?.ws || !tableCheck?.sg) return 0;

  // Expire elapsed subscriptions first
  await p.db.query(
    `UPDATE workspace_subscriptions
        SET status = 'expired', revision = revision + 1
      WHERE status = 'active' AND current_period_end <= now()`,
  );

  const due = (
    await p.db.query(
      `SELECT s.id
         FROM workspace_subscriptions s
        WHERE s.status = 'active'
          AND s.current_period_start <= now()
          AND s.current_period_end > now()
          AND NOT EXISTS (
            SELECT 1 FROM subscription_grants g
             WHERE g.subscription_id = s.id
               AND g.period_start = s.current_period_start
          )
        ORDER BY s.created_at ASC
        LIMIT 100`,
    )
  ).rows as { id: string }[];

  let granted = 0;
  for (const row of due) {
    const didGrant = await p.db.transaction(async (sql) => {
      const sub = await one(
        sql,
        `SELECT s.id, s.workspace_id, s.current_period_start, s.current_period_end, s.status,
                p.name AS plan_name, s.period_credits
           FROM workspace_subscriptions s
           JOIN subscription_plans p ON p.id = s.plan_id
          WHERE s.id = $1 FOR UPDATE OF s`,
        [row.id],
      );
      if (!sub || sub.status !== "active") return false;
      const periodCredits = Number(sub.period_credits);
      if (!(periodCredits > 0)) return false;

      const inserted = await one(
        sql,
        `INSERT INTO subscription_grants(subscription_id, period_start, credits)
         VALUES ($1, $2, $3)
         ON CONFLICT (subscription_id, period_start) DO NOTHING
         RETURNING subscription_id`,
        [sub.id, sub.current_period_start, periodCredits],
      );
      if (!inserted) return false;

      const periodIso = new Date(sub.current_period_start).toISOString();
      await p.credit(
        sql,
        sub.workspace_id,
        periodCredits,
        `sub:${sub.id}:${periodIso}`,
        "grant",
        {
          note: `周期配额包发放 · ${sub.plan_name}`,
        },
      );
      return true;
    });
    if (didGrant) granted++;
  }
  return granted;
}
