import { one } from "@fumiao/platform/db.js";
import { Operations } from "@fumiao/platform/operations.js";
import type { Actor, Platform } from "@fumiao/platform/platform.js";
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
        ? "COALESCE(SUM(am.upstream_cost_fen), 0)"
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
        const upstreamCostFen = Number(row.upstream_cost_fen);
        const grossMarginFen = revenueFen - upstreamCostFen;
        const terminal = completed + failed + uncertain;
        const successRate =
          terminal > 0 ? Math.round((completed / terminal) * 1000) / 10 : 100;

        totalJobs += total;
        completedJobs += completed;
        failedJobs += failed;
        uncertainJobs += uncertain;
        totalCreditsRevenue += creditsRevenue;
        totalUpstreamCostFen += upstreamCostFen;
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
          upstream_cost_fen: totalUpstreamCostFen,
          gross_margin_fen: totalRevenueFen - totalUpstreamCostFen,
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
    return this.ops.resolve(actor, jobId, {
      action: input.action,
      reason: input.reason,
      ...(input.remoteId ? { remoteId: input.remoteId } : {}),
    });
  }
}
