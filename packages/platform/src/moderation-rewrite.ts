import type { RequestDisposition } from "@fumiao/plugin-sdk/lifecycle.js";
import { one, type Sql } from "./db.js";

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
