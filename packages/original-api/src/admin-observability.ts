import { one } from "@fumiao/platform/db.js";
import { Operations } from "@fumiao/platform/operations.js";
import type { Actor, Platform } from "@fumiao/platform/platform.js";
import { requireValue } from "@fumiao/platform/security.js";
import { parseBody } from "./validation.js";
import { reconcileJobFields } from "./wave6-fields.js";

/**
 * F005: Admin Observability Dashboard & Uncertain-Job Reconciliation.
 * Aggregates channel/model success rates, P50/P95 latency, revenue/cost gross margin,
 * moderation rewrite counts, GPU node availability, and exposes Operations.resolve().
 */
export class OriginalObservability {
  private readonly ops: Operations;
  constructor(readonly p: Platform) {
    this.ops = new Operations(p);
  }

  async summary(actor: Actor, rawDays?: number) {
    this.p.admin(actor);
    const days = Math.min(90, Math.max(1, Math.round(rawDays || 7)));

    return this.p.db.transaction(async (sql) => {
      await sql.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      const hasAudit = Boolean(
        (await one(sql, "SELECT to_regclass('job_audit_meta') AS n"))?.n,
      );
      const auditJoin = hasAudit
        ? "LEFT JOIN job_audit_meta am ON am.job_id = j.id"
        : "";
      const costExpr = hasAudit
        ? "COALESCE(SUM(CASE WHEN j.state = 'completed' AND am.upstream_cost_fen IS NOT NULL THEN am.upstream_cost_fen ELSE 0 END), 0)"
        : "0";
      const costKnownExpr = hasAudit
        ? "COUNT(*) FILTER (WHERE j.state = 'completed' AND am.upstream_cost_fen IS NOT NULL)"
        : "0";
      const costUnknownExpr = hasAudit
        ? "COUNT(*) FILTER (WHERE j.state = 'completed' AND am.upstream_cost_fen IS NULL)"
        : "COUNT(*) FILTER (WHERE j.state = 'completed')";
      const knownRevenueCreditsExpr = hasAudit
        ? "COALESCE(SUM(CASE WHEN j.state = 'completed' AND am.upstream_cost_fen IS NOT NULL THEN j.price ELSE 0 END), 0)"
        : "0";
      const rewriteExpr = hasAudit
        ? "COUNT(*) FILTER (WHERE COALESCE(am.rewrite_attempts, 0) > 0)"
        : "0";

      const channelRows = (
        await sql.query(
          `SELECT
              COALESCE(j.catalog_id, j.provider_model, j.model_id::text) AS model_key,
              j.plugin_id,
              j.kind,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE j.state = 'completed')::int AS completed,
              COUNT(*) FILTER (WHERE j.state = 'failed')::int AS failed,
              COUNT(*) FILTER (WHERE j.state = 'uncertain')::int AS uncertain,
              COUNT(*) FILTER (WHERE j.state = 'cancelled')::int AS cancelled,
              COALESCE(SUM(CASE WHEN j.state = 'completed' THEN j.price ELSE 0 END), 0)::bigint AS credits_revenue,
              ${costExpr}::bigint AS upstream_cost_fen,
              ${costKnownExpr}::int AS cost_known_jobs,
              ${costUnknownExpr}::int AS cost_unknown_jobs,
              ${knownRevenueCreditsExpr}::bigint AS known_cost_revenue_credits,
              ${rewriteExpr}::int AS rewritten_count,
              COALESCE(
                percentile_cont(0.5) WITHIN GROUP (
                  ORDER BY (r.finished - r.started)
                ) FILTER (WHERE r.started IS NOT NULL AND r.finished IS NOT NULL AND r.finished >= r.started),
                0
              ) AS p50_seconds,
              COALESCE(
                percentile_cont(0.95) WITHIN GROUP (
                  ORDER BY (r.finished - r.started)
                ) FILTER (WHERE r.started IS NOT NULL AND r.finished IS NOT NULL AND r.finished >= r.started),
                0
              ) AS p95_seconds
             FROM jobs j
             LEFT JOIN LATERAL (
               SELECT started, finished
                 FROM job_runs
                WHERE job = j.id
                ORDER BY id DESC
                LIMIT 1
             ) r ON TRUE
             ${auditJoin}
            WHERE j.created_at >= now() - ($1::int * interval '1 day')
            GROUP BY 1, 2, 3
            ORDER BY total DESC, model_key ASC`,
          [days],
        )
      ).rows;

      let totalJobs = 0;
      let completedJobs = 0;
      let failedJobs = 0;
      let uncertainJobs = 0;
      let totalCreditsRevenue = 0;
      let totalUpstreamCostFen = 0;
      let totalKnownCostRevenueFen = 0;
      let totalCostKnownJobs = 0;
      let totalCostUnknownJobs = 0;
      let totalRewritten = 0;

      const channels = channelRows.map((row) => {
        const total = Number(row.total);
        const completed = Number(row.completed);
        const failed = Number(row.failed);
        const uncertain = Number(row.uncertain);
        const cancelled = Number(row.cancelled);
        const creditsRevenue = Number(row.credits_revenue);
        // Studio billing baseline: 1 yuan = 10 credits => 1 credit = 10 fen
        const revenueFen = creditsRevenue * 10;
        const costKnown = Number(row.cost_known_jobs ?? 0);
        const costUnknown = Number(row.cost_unknown_jobs ?? 0);
        const rawCostFen = Number(row.upstream_cost_fen ?? 0);
        const knownRevenueFen = Number(row.known_cost_revenue_credits ?? 0) * 10;
        const costStatus: "known" | "partial" | "unknown" =
          completed === 0
            ? "known"
            : costKnown === 0
              ? "unknown"
              : costUnknown === 0
                ? "known"
                : "partial";
        const costCoveragePct =
          completed > 0 ? Math.round((costKnown / completed) * 1000) / 10 : 100;
        // Never treat unknown/NULL upstream cost as ¥0 (100% margin): report null when unknown,
        // and compute gross margin strictly over cost-known completed jobs.
        const upstreamCostFen = costKnown > 0 ? rawCostFen : null;
        const grossMarginFen =
          costKnown > 0 ? knownRevenueFen - rawCostFen : null;
        const terminal = completed + failed + uncertain;
        const successRate =
          terminal > 0 ? Math.round((completed / terminal) * 1000) / 10 : 100;

        totalJobs += total;
        completedJobs += completed;
        failedJobs += failed;
        uncertainJobs += uncertain;
        totalCreditsRevenue += creditsRevenue;
        totalUpstreamCostFen += rawCostFen;
        totalKnownCostRevenueFen += knownRevenueFen;
        totalCostKnownJobs += costKnown;
        totalCostUnknownJobs += costUnknown;
        totalRewritten += Number(row.rewritten_count ?? 0);

        return {
          model_key: String(row.model_key),
          plugin_id: String(row.plugin_id),
          kind: String(row.kind),
          total,
          completed,
          failed,
          uncertain,
          cancelled,
          success_rate: successRate,
          p50_seconds: Math.round(Number(row.p50_seconds || 0) * 100) / 100,
          p95_seconds: Math.round(Number(row.p95_seconds || 0) * 100) / 100,
          credits_revenue: creditsRevenue,
          revenue_fen: revenueFen,
          upstream_cost_fen: upstreamCostFen,
          gross_margin_fen: grossMarginFen,
          cost_status: costStatus,
          cost_known_jobs: costKnown,
          cost_unknown_jobs: costUnknown,
          cost_coverage_pct: costCoveragePct,
          rewritten_count: Number(row.rewritten_count ?? 0),
        };
      });

      const nodeStats = await one(
        sql,
        `SELECT
            COUNT(*) FILTER (WHERE NOT archived AND enabled)::int AS total_nodes,
            COUNT(*) FILTER (WHERE NOT archived AND enabled AND last_seen >= now() - interval '2 minutes')::int AS online_nodes
           FROM gpu_nodes`,
      );

      const totalRevenueFen = totalCreditsRevenue * 10;
      const terminalAll = completedJobs + failedJobs + uncertainJobs;
      const totalCostStatus: "known" | "partial" | "unknown" =
        completedJobs === 0
          ? "known"
          : totalCostKnownJobs === 0
            ? "unknown"
            : totalCostUnknownJobs === 0
              ? "known"
              : "partial";
      const totalCostCoveragePct =
        completedJobs > 0
          ? Math.round((totalCostKnownJobs / completedJobs) * 1000) / 10
          : 100;
      return {
        window_days: days,
        totals: {
          total_jobs: totalJobs,
          completed_jobs: completedJobs,
          failed_jobs: failedJobs,
          uncertain_jobs: uncertainJobs,
          overall_success_rate:
            terminalAll > 0
              ? Math.round((completedJobs / terminalAll) * 1000) / 10
              : 100,
          credits_revenue: totalCreditsRevenue,
          revenue_fen: totalRevenueFen,
          upstream_cost_fen:
            totalCostKnownJobs > 0 ? totalUpstreamCostFen : null,
          gross_margin_fen:
            totalCostKnownJobs > 0
              ? totalKnownCostRevenueFen - totalUpstreamCostFen
              : null,
          cost_status: totalCostStatus,
          cost_known_jobs: totalCostKnownJobs,
          cost_unknown_jobs: totalCostUnknownJobs,
          cost_coverage_pct: totalCostCoveragePct,
          rewritten_jobs: totalRewritten,
          total_gpu_nodes: Number(nodeStats?.total_nodes ?? 0),
          online_gpu_nodes: Number(nodeStats?.online_nodes ?? 0),
        },
        channels,
      };
    });
  }

  async uncertainJobs(actor: Actor) {
    this.p.admin(actor);
    const { rows } = await this.p.db.query(
      `SELECT j.id, j.public_id, j.workspace_id, w.name AS workspace_name,
              u.name AS owner_name, COALESCE(j.catalog_id, j.provider_model) AS model,
              j.plugin_id, j.kind, j.price, j.error, j.remote_id, j.created_at, j.updated_at
         FROM jobs j
         JOIN workspaces w ON w.id = j.workspace_id
         LEFT JOIN users u ON u.id = j.owner_id
        WHERE j.state = 'uncertain'
        ORDER BY j.created_at DESC
        LIMIT 100`,
    );
    return {
      jobs: rows.map((r) => ({
        id: String(r.id),
        public_id: r.public_id ? Number(r.public_id) : null,
        workspace_name: String(r.workspace_name),
        owner_name: r.owner_name ? String(r.owner_name) : null,
        model: String(r.model ?? ""),
        plugin_id: String(r.plugin_id),
        kind: String(r.kind),
        price: Number(r.price),
        error: r.error ? String(r.error) : null,
        remote_id: r.remote_id ? String(r.remote_id) : null,
        created_at: new Date(r.created_at).toISOString(),
        updated_at: new Date(r.updated_at).toISOString(),
      })),
    };
  }

  async reconcileJob(actor: Actor, jobId: string, body: unknown) {
    this.p.admin(actor);
    const input = parseBody(body, reconcileJobFields);
    const trimmed = String(jobId ?? "").trim();
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        trimmed,
      );
    const isNumeric = /^[1-9]\d{0,17}$/.test(trimmed);
    requireValue(
      isUuid || isNumeric,
      400,
      "任务 ID 无效：请传入运营大盘返回的任务 UUID 或正整数公开任务号",
    );
    let targetUuid = trimmed;
    if (isNumeric) {
      const row = await one(
        this.p.db,
        "SELECT id FROM jobs WHERE public_id = $1 AND deleted_at IS NULL",
        [Number(trimmed)],
      );
      requireValue(row, 404, `未找到编号为 #${trimmed} 的任务`);
      targetUuid = String(row.id);
    } else {
      const row = await one(
        this.p.db,
        "SELECT id FROM jobs WHERE id = $1 AND deleted_at IS NULL",
        [trimmed],
      );
      requireValue(row, 404, "未找到对应的任务");
    }
    return this.ops.resolve(actor, targetUuid, {
      action: input.action,
      reason: input.reason,
      ...(input.remoteId ? { remoteId: input.remoteId } : {}),
    });
  }
}
