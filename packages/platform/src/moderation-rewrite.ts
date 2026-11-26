import { randomUUID } from "node:crypto";
import type { RequestDisposition } from "@fumiao/plugin-sdk/lifecycle.js";
import { one, type Sql } from "./db.js";
import type { Platform } from "./platform.js";

export function isModerationRejectionMessage(message: string): boolean {
  const lower = String(message || "").toLowerCase();
  return (
    lower.includes("content_policy_violation") ||
    lower.includes("moderation_blocked") ||
    lower.includes("safety_blocked") ||
    lower.includes("content_filter") ||
    lower.includes("安全审核") ||
    lower.includes("敏感内容") ||
    lower.includes("内容违规")
  );
}

const SENSITIVE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\b(blood|bloody|gore|gory|behead|dismember|slaughter|massacre|corpse)\b/gi, "dramatic crimson shadow silhouette"],
  [/\b(kill|murder|stab|shoot|gunshot|assassinate|suicide|torture)\b/gi, "tense dramatic confrontation in silhouette"],
  [/\b(nude|naked|explicit|erotic|nsfw|porn|sexual)\b/gi, "artistic backlit fashion silhouette"],
  [/\b(bomb|explosion|terrorist|weapon|rifle|pistol|knife)\b/gi, "dramatic atmospheric flash and moody fog"],
  [/(血腥|残忍|砍杀|斩首|尸体|屠杀|暴力|自杀|虐待)/g, "戏剧化暗影剪影与紧张氛围"],
  [/(裸露|色情|低俗|情色|性爱)/g, "艺术逆光时尚剪影"],
  [/(枪击|炸弹|恐怖袭击|匕首|砍刀|谋杀|刺杀)/g, "电影感高对比光影对峙画面"],
];

/**
 * F024: Deterministic cinematic visual-metaphor prompt neutralizer.
 * Preserves camera framing, lighting, and scene continuity while softening
 * moderation-sensitive phrasing into safe dramatic cinematography.
 */
export function neutralizeBlockedPrompt(
  originalPrompt: string,
  attempt: number,
): string {
  let text = originalPrompt.trim();
  for (const [pattern, replacement] of SENSITIVE_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }
  const suffix =
    attempt <= 1
      ? " (safe cinematic stylized framing, dramatic shadow silhouette, artistic atmospheric lighting, PG-13)"
      : " (abstract minimalist filmic silhouette, soft atmospheric haze, gentle artistic metaphor, family-safe cinema)";
  if (text === originalPrompt.trim()) {
    return `${text}${suffix}`;
  }
  return `${text}${suffix}`;
}

export async function hasModerationTables(sql: Sql): Promise<boolean> {
  const row = await one(
    sql,
    "SELECT to_regclass('workspace_moderation_settings') AS s, to_regclass('job_audit_meta') AS m",
  );
  return Boolean(row?.s && row?.m);
}

/**
 * F024: Strict single-settlement moderation rewrite & retry guardrail.
 * Triggers ONLY when ALL of the following hold:
 *  1. outcome.action === "fail"
 *  2. outcome.reason === "moderation_blocked"
 *  3. outcome.certainty === "rejected"
 *  4. outcome.billable === false
 *  5. !job.remote_id && !job.receipt (never accepted upstream)
 *  6. Workspace opted into auto_rewrite = TRUE with attempts remaining (<= 2)
 *
 * Re-queues the job reusing the EXACT original `hold:<job.id>` reservation
 * without creating any second hold or settlement ledger entry.
 */
export async function tryModerationRewrite(
  sql: Sql,
  job: {
    id: string;
    workspace_id: string;
    remote_id?: string | null;
    receipt?: unknown;
    input?: Record<string, unknown> | null;
  },
  outcome: RequestDisposition,
): Promise<boolean> {
  if (
    outcome.action !== "fail" ||
    outcome.reason !== "moderation_blocked" ||
    outcome.certainty !== "rejected" ||
    outcome.billable !== false ||
    job.remote_id ||
    job.receipt
  ) {
    return false;
  }
  if (!(await hasModerationTables(sql))) return false;

  const settings = await one(
    sql,
    "SELECT auto_rewrite, max_attempts FROM workspace_moderation_settings WHERE workspace_id=$1",
    [job.workspace_id],
  );
  if (!settings?.auto_rewrite) return false;
  const maxAttempts = Math.min(2, Math.max(0, Number(settings.max_attempts ?? 2)));
  if (maxAttempts <= 0) return false;

  const meta = await one(
    sql,
    "SELECT original_prompt, rewrite_attempts FROM job_audit_meta WHERE job_id=$1 FOR UPDATE",
    [job.id],
  );
  const attempts = Number(meta?.rewrite_attempts ?? 0);
  if (attempts >= maxAttempts) return false;

  const inputObj =
    job.input && typeof job.input === "object" ? { ...job.input } : {};
  const currentPrompt =
    typeof inputObj.prompt === "string" ? inputObj.prompt : "";
  if (!currentPrompt.trim()) return false;

  const originalPrompt =
    typeof meta?.original_prompt === "string" && meta.original_prompt
      ? meta.original_prompt
      : currentPrompt;
  const nextAttempt = attempts + 1;
  const rewrittenPrompt = neutralizeBlockedPrompt(currentPrompt, nextAttempt);

  await sql.query(
    `INSERT INTO job_audit_meta(job_id, original_prompt, rewritten_prompt, rewrite_attempts, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (job_id) DO UPDATE
       SET original_prompt = COALESCE(job_audit_meta.original_prompt, EXCLUDED.original_prompt),
           rewritten_prompt = EXCLUDED.rewritten_prompt,
           rewrite_attempts = EXCLUDED.rewrite_attempts,
           updated_at = now()`,
    [job.id, originalPrompt, rewrittenPrompt, nextAttempt],
  );

  const nextInput = { ...inputObj, prompt: rewrittenPrompt };
  await sql.query(
    `UPDATE jobs
        SET input = $2::jsonb,
            state = 'queued',
            request_note = $3,
            request_retry_at = now() + interval '1 second',
            error = NULL,
            lease_token = NULL,
            lease_until = NULL,
            updated_at = now()
      WHERE id = $1`,
    [
      job.id,
      JSON.stringify(nextInput),
      `触发内容安全审查，已自动中性化改写重试（第 ${nextAttempt}/${maxAttempts} 次，复用原冻结积分）`,
    ],
  );

  await sql.query(
    `INSERT INTO outbox(job_id, available_at, sent_at)
     VALUES ($1, now() + interval '1 second', NULL)
     ON CONFLICT (job_id) DO UPDATE
       SET available_at = now() + interval '1 second',
           sent_at = NULL`,
    [job.id],
  );

  await sql.query(
    "INSERT INTO job_events(job_id, state, detail) VALUES ($1, 'moderation_rewrite', $2)",
    [
      job.id,
      JSON.stringify({
        attempt: nextAttempt,
        max_attempts: maxAttempts,
        reason: outcome.reason,
      }),
    ],
  );

  return true;
}

/**
 * F024: Equivalent-model intelligent fallback after moderation prompt rewrites are exhausted.
 * Triggers ONLY on explicitly rejected, non-billable moderation blocks before upstream acceptance,
 * selecting an enabled equivalent same-kind model at <= original price (refunding any positive
 * delta atomically without creating a second hold or double-billing).
 */
export async function tryModerationEquivalentFallback(
  sql: Sql,
  job: {
    id: string;
    workspace_id: string;
    owner_id: string;
    kind: string;
    catalog_id?: string | null;
    provider_model?: string | null;
    price?: number | string | null;
    remote_id?: string | null;
    receipt?: unknown;
    input?: Record<string, unknown> | null;
  },
  outcome: RequestDisposition,
  preferredFallbackModel?: string,
): Promise<boolean> {
  if (
    outcome.action !== "fail" ||
    outcome.reason !== "moderation_blocked" ||
    outcome.certainty !== "rejected" ||
    outcome.billable !== false ||
    job.remote_id ||
    job.receipt
  ) {
    return false;
  }
  const inputObj =
    job.input && typeof job.input === "object" ? { ...job.input } : {};
  const existingParams =
    inputObj.params && typeof inputObj.params === "object"
      ? (inputObj.params as Record<string, unknown>)
      : {};
  if (existingParams._moderation_fallback_from) return false;
  if (!(await hasModerationTables(sql))) return false;

  const settings = await one(
    sql,
    "SELECT auto_rewrite, max_attempts FROM workspace_moderation_settings WHERE workspace_id=$1",
    [job.workspace_id],
  );
  if (!settings?.auto_rewrite) return false;

  const currentCatalogId = String(job.catalog_id || job.provider_model || "");
  const originalPrice = Number(job.price ?? 0);

  // Candidate enabled same-kind models excluding current model, prioritizing explicit fallbackModel
  const candidateRows = (
    await sql.query(
      `SELECT m.id, m.connection_id, m.catalog_id, m.provider_model,
              c.plugin_id, c.plugin_version, c.config,
              COALESCE(
                (SELECT MIN(sp.amount) FROM studio_prices sp WHERE sp.model_id = m.catalog_id),
                $3
              )::bigint AS min_price
         FROM models m
         JOIN connections c ON c.id = m.connection_id
        WHERE m.kind = $1
          AND m.enabled = TRUE
          AND c.enabled = TRUE
          AND NOT c.removed
          AND COALESCE(m.catalog_id, m.provider_model) <> $2
        ORDER BY CASE WHEN m.catalog_id = $4 OR m.provider_model = $4 THEN 0 ELSE 1 END,
                 min_price ASC, m.id ASC
        LIMIT 10`,
      [job.kind, currentCatalogId, originalPrice, preferredFallbackModel || ""],
    )
  ).rows;

  let chosen: (typeof candidateRows)[number] | null = null;
  for (const cand of candidateRows) {
    const candCatalog = String(cand.catalog_id || cand.provider_model);
    const candPrice = Number(cand.min_price ?? originalPrice);
    if (candPrice > originalPrice) continue;
    const allowed = await one(
      sql,
      "SELECT studio_model_allowed($1, $2) AS ok",
      [candCatalog, job.workspace_id],
    );
    if (allowed?.ok === false) continue;
    chosen = cand;
    break;
  }
  if (!chosen) return false;

  const nextPrice = Math.min(originalPrice, Number(chosen.min_price ?? originalPrice));
  const deltaRefund = originalPrice - nextPrice;
  if (deltaRefund > 0) {
    const released = await one(
      sql,
      "UPDATE wallets SET held = held - $2 WHERE workspace_id = $1 AND held >= $2 RETURNING balance, held",
      [job.workspace_id, deltaRefund],
    );
    if (!released) return false;
    await sql.query(
      `INSERT INTO ledger(id, workspace_id, job_id, key, action, amount, actor_id, balance_snapshot, held_snapshot, note)
       VALUES ($1,$2,$3,$4,'refund',$5,$6,$7,$8,$9)
       ON CONFLICT (key) DO NOTHING`,
      [
        randomUUID(),
        job.workspace_id,
        job.id,
        `refund-mod-fallback:${job.id}`,
        deltaRefund,
        job.owner_id,
        released.balance,
        released.held,
        `内容审核降级至等价模型 ${chosen.catalog_id || chosen.provider_model} 退回差价`,
      ],
    );
  }

  const nextInput = {
    ...inputObj,
    modelId: chosen.id,
    params: {
      ...existingParams,
      _moderation_fallback_from: currentCatalogId,
    },
  };
  await sql.query(
    `UPDATE jobs
        SET model_id = $2,
            connection_id = $3,
            plugin_id = $4,
            plugin_version = $5,
            config_snapshot = $6,
            provider_model = $7,
            catalog_id = $8,
            price = $9,
            input = $10::jsonb,
            state = 'queued',
            request_note = $11,
            request_retry_at = now() + interval '1 second',
            error = NULL,
            lease_token = NULL,
            lease_until = NULL,
            updated_at = now()
      WHERE id = $1`,
    [
      job.id,
      chosen.id,
      chosen.connection_id,
      chosen.plugin_id,
      chosen.plugin_version,
      chosen.config,
      chosen.provider_model,
      chosen.catalog_id,
      nextPrice,
      JSON.stringify(nextInput),
      `内容审核改写重试达上限，已智能降级至等价模型 ${chosen.catalog_id || chosen.provider_model}（复用原冻结积分）`,
    ],
  );
  await sql.query(
    `INSERT INTO outbox(job_id, available_at, sent_at)
     VALUES ($1, now() + interval '1 second', NULL)
     ON CONFLICT (job_id) DO UPDATE SET available_at = now() + interval '1 second', sent_at = NULL`,
    [job.id],
  );
  await sql.query(
    "INSERT INTO job_events(job_id, state, detail) VALUES ($1, 'moderation_fallback', $2)",
    [
      job.id,
      JSON.stringify({
        from: currentCatalogId,
        to: chosen.catalog_id || chosen.provider_model,
        price_before: originalPrice,
        price_after: nextPrice,
      }),
    ],
  );
  return true;
}

/**
 * F005 (#17): Persist REAL upstream cost in `job_audit_meta.upstream_cost_fen` when
 * known from receipt usage, connection/model cost config, or built-in free Edge TTS.
 * Leaves `upstream_cost_fen` NULL when no real cost source is configured (never faking ¥0).
 */
export async function recordCompletedJobCost(
  sql: Sql,
  p: Platform,
  job: {
    id: string;
    plugin_id?: string | null;
    provider_model?: string | null;
    catalog_id?: string | null;
    config_snapshot?: string | null;
    input?: Record<string, unknown> | null;
  },
  result?: unknown,
): Promise<number | null> {
  const hasAudit = Boolean(
    (await one(sql, "SELECT to_regclass('job_audit_meta') IS NOT NULL AS ok"))?.ok,
  );
  if (!hasAudit) return null;

  let costFen: number | null = null;
  const usage =
    result && typeof result === "object" && "usage" in result
      ? (result as { usage?: Record<string, unknown> }).usage
      : undefined;
  if (
    usage &&
    typeof usage.cost_fen === "number" &&
    Number.isFinite(usage.cost_fen) &&
    usage.cost_fen >= 0
  ) {
    costFen = Math.round(usage.cost_fen);
  }

  if (costFen === null && job.config_snapshot) {
    try {
      const cfg = p.vault.open(job.config_snapshot) as Record<string, unknown>;
      const modelCosts =
        cfg?.modelCosts && typeof cfg.modelCosts === "object"
          ? (cfg.modelCosts as Record<string, unknown>)
          : undefined;
      const byModel =
        (job.catalog_id && modelCosts?.[job.catalog_id]) ??
        (job.provider_model && modelCosts?.[job.provider_model]);
      if (typeof byModel === "number" && Number.isFinite(byModel) && byModel >= 0) {
        costFen = Math.round(byModel);
      } else if (
        typeof cfg?.upstreamCostFen === "number" &&
        Number.isFinite(cfg.upstreamCostFen) &&
        cfg.upstreamCostFen >= 0
      ) {
        costFen = Math.round(cfg.upstreamCostFen);
      } else if (
        typeof cfg?.upstreamCostFenPerSecond === "number" &&
        Number.isFinite(cfg.upstreamCostFenPerSecond) &&
        cfg.upstreamCostFenPerSecond >= 0
      ) {
        const secs = Number(
          (job.input?.params as Record<string, unknown> | undefined)?.seconds ?? 5,
        );
        costFen = Math.round(cfg.upstreamCostFenPerSecond * Math.max(1, secs));
      }
    } catch {
      // Ignore unreadable config snapshots; keep cost unknown (NULL).
    }
  }

  // Built-in free Edge TTS is genuinely 0 upstream cost.
  if (costFen === null && job.plugin_id === "edge-tts") {
    costFen = 0;
  }

  if (costFen === null) return null;

  await sql.query(
    `INSERT INTO job_audit_meta(job_id, upstream_cost_fen, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (job_id) DO UPDATE
       SET upstream_cost_fen = EXCLUDED.upstream_cost_fen,
           updated_at = now()`,
    [job.id, costFen],
  );
  return costFen;
}
