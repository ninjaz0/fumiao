import { createHash, randomBytes } from "node:crypto";
import { one } from "@fumiao/platform/db.js";
import type { Actor, Platform } from "@fumiao/platform/platform.js";
import { DomainError, requireValue } from "@fumiao/platform/security.js";
import { grantDueSubscriptions } from "@fumiao/platform/subscriptions.js";
import { OriginalIdentity } from "./identity.js";
import { parseBody } from "./validation.js";
import {
  redeemApplyFields,
  redeemBatchCreateFields,
  subscriptionPlanCreateFields,
  subscriptionSubscribeFields,
} from "./wave6-fields.js";

const INVITE_REWARD_CREDITS = 20;

function hashCode(raw: string): string {
  return createHash("sha256").update(raw.trim().toUpperCase()).digest("hex");
}

function generateRedeemCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(12);
  let out = "";
  for (let i = 0; i < 12; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return `FM-${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

function escapePdfText(text: string): string {
  // Replace non-ASCII characters cleanly with ASCII-safe fallback while keeping readable identifiers/numbers
  const ascii = text.replace(/[^\x20-\x7e]/g, "?");
  return ascii
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

/**
 * Pure zero-dependency PDF 1.4 single/multi-page financial statement builder.
 * Produces a strictly valid `%PDF-1.4` document with accurate xref byte offsets.
 */
export function buildLedgerStatementPdf(options: {
  workspaceName: string;
  workspacePublicId: number;
  balance: number;
  reserved: number;
  generatedAtIso: string;
  rows: Array<{
    id: number;
    createdIso: string;
    action: string;
    amount: number;
    balance: number;
    reserved: number;
    note: string;
  }>;
}): Buffer {
  const lines: string[] = [
    "FUMIAO STUDIO - CREDIT ACCOUNT STATEMENT",
    `Workspace: #${options.workspacePublicId} (${options.workspaceName})`,
    `Generated: ${options.generatedAtIso}`,
    `Current Balance: ${options.balance} credits | Reserved: ${options.reserved} | Available: ${options.balance - options.reserved}`,
    "--------------------------------------------------------------------------------",
    "ID       | TIMESTAMP            | ACTION   | AMOUNT  | BALANCE | NOTE",
    "--------------------------------------------------------------------------------",
  ];
  for (const r of options.rows.slice(0, 45)) {
    const idCol = String(r.id).padEnd(8);
    const tsCol = r.createdIso.slice(0, 19).replace("T", " ").padEnd(20);
    const actCol = r.action.padEnd(8);
    const amtCol = (r.amount >= 0 ? `+${r.amount}` : String(r.amount)).padStart(7);
    const balCol = String(r.balance).padStart(7);
    const noteCol = r.note.slice(0, 32);
    lines.push(`${idCol} | ${tsCol} | ${actCol} | ${amtCol} | ${balCol} | ${noteCol}`);
  }
  if (options.rows.length > 45) {
    lines.push(`... (${options.rows.length - 45} additional rows omitted; use CSV for full archive)`);
  }

  const streamOps: string[] = ["BT", "/F1 9 Tf", "40 760 Td", "14 TL"];
  lines.forEach((line, idx) => {
    const escaped = escapePdfText(line);
    streamOps.push(idx === 0 ? `(${escaped}) Tj` : `T* (${escaped}) Tj`);
  });
  streamOps.push("ET");
  const contentStream = streamOps.join("\n");
  const contentBytes = Buffer.byteLength(contentStream, "utf8");

  const objects: string[] = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n",
    `5 0 obj\n<< /Length ${contentBytes} >>\nstream\n${contentStream}\nendstream\nendobj\n`,
  ];

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n", "ascii")];
  const offsets: number[] = [0];
  let cursor = chunks[0].length;
  for (const obj of objects) {
    offsets.push(cursor);
    const buf = Buffer.from(obj, "utf8");
    chunks.push(buf);
    cursor += buf.length;
  }

  const xrefOffset = cursor;
  const xrefLines = [`xref\n0 ${objects.length + 1}\n`, "0000000000 65535 f \n"];
  for (let i = 1; i < offsets.length; i++) {
    xrefLines.push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  }
  const trailer =
    xrefLines.join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  chunks.push(Buffer.from(trailer, "ascii"));
  return Buffer.concat(chunks);
}

/**
 * F034 + Q5: Batch Redeem Codes, Invite Rewards, Period Quota Pack Subscriptions,
 * and CSV / PDF Financial Statement Exports (all single-settlement over Platform.credit).
 */
export class OriginalBillingExtras {
  constructor(
    readonly p: Platform,
    readonly identity = new OriginalIdentity(p),
  ) {}

  // ---- Admin Redeem Codes ----

  async listRedeemCodes(actor: Actor) {
    this.p.admin(actor);
    const { rows } = await this.p.db.query(
      `SELECT id, code_prefix, batch_id, name, credits, max_uses, uses, enabled, expires_at, created_at
         FROM redeem_codes
        ORDER BY created_at DESC
        LIMIT 200`,
    );
    return {
      codes: rows.map((r) => ({
        id: String(r.id),
        code_prefix: String(r.code_prefix),
        batch_id: String(r.batch_id),
        name: String(r.name),
        credits: Number(r.credits),
        max_uses: Number(r.max_uses),
        uses: Number(r.uses),
        enabled: Boolean(r.enabled),
        expires_at: r.expires_at ? new Date(r.expires_at).toISOString() : null,
        created_at: new Date(r.created_at).toISOString(),
      })),
    };
  }

  async createRedeemBatch(actor: Actor, body: unknown) {
    this.p.admin(actor);
    const input = parseBody(body, redeemBatchCreateFields);
    const batchId = `batch_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
    const expiresAt = input.expires_in_days
      ? new Date(Date.now() + input.expires_in_days * 86_400_000)
      : null;

    return this.p.db.transaction(async (sql) => {
      const issued: Array<{ id: string; code: string; credits: number }> = [];
      for (let i = 0; i < input.count; i++) {
        const plain = generateRedeemCode();
        const prefix = plain.slice(0, 7) + "-****";
        const row = await one(
          sql,
          `INSERT INTO redeem_codes(code_hash, code_prefix, batch_id, name, credits, max_uses, expires_at, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [
            hashCode(plain),
            prefix,
            batchId,
            input.name.trim(),
            input.credits,
            input.max_uses,
            expiresAt,
            actor.id,
          ],
        );
        issued.push({
          id: String(row.id),
          code: plain,
          credits: Number(input.credits),
        });
      }
      await this.p.audit(sql, actor, "redeem.batch_create", batchId);
      return {
        batch_id: batchId,
        name: input.name.trim(),
        credits: Number(input.credits),
        count: issued.length,
        expires_at: expiresAt ? expiresAt.toISOString() : null,
        codes: issued,
      };
    });
  }

  async disableRedeemCode(actor: Actor, id: string) {
    this.p.admin(actor);
    const row = await one(
      this.p.db,
      `UPDATE redeem_codes
          SET enabled = FALSE, revision = revision + 1
        WHERE id = $1
        RETURNING id, enabled`,
      [id],
    );
    requireValue(row, 404, "兑换码不存在");
    return { id: String(row.id), enabled: false };
  }

  async redeem(actor: Actor, body: unknown, explicitWorkspace?: string) {
    const input = parseBody(body, redeemApplyFields);
    const digest = hashCode(input.code);

    return this.p.db.transaction(async (sql) => {
      const ws = await this.identity.activeWorkspace(sql, actor, explicitWorkspace);
      const code = await one(
        sql,
        `SELECT * FROM redeem_codes
          WHERE code_hash = $1
          FOR UPDATE`,
        [digest],
      );
      requireValue(code, 404, "兑换码无效");
      requireValue(code.enabled, 410, "兑换码已停用");
      requireValue(
        !code.expires_at || new Date(code.expires_at).getTime() > Date.now(),
        410,
        "兑换码已过期",
      );
      requireValue(
        Number(code.uses) < Number(code.max_uses),
        409,
        "兑换码已达到使用次数上限",
      );

      const already = await one(
        sql,
        "SELECT id FROM redeem_redemptions WHERE code_id = $1 AND user_id = $2",
        [code.id, actor.id],
      );
      if (already) {
        throw new DomainError(409, "您已兑换过此兑换码，不能重复领取");
      }

      const credits = Number(code.credits);
      await sql.query(
        `INSERT INTO redeem_redemptions(code_id, user_id, workspace_id, credits)
         VALUES ($1, $2, $3, $4)`,
        [code.id, actor.id, ws.id, credits],
      );
      await sql.query(
        "UPDATE redeem_codes SET uses = uses + 1, revision = revision + 1 WHERE id = $1",
        [code.id],
      );

      await this.p.credit(
        sql,
        ws.id,
        credits,
        `redeem:${code.id}:${actor.id}`,
        "grant",
        {
          actorId: actor.id,
          note: `兑换码兑换 · ${code.name}`,
        },
      );

      const wallet = await one(
        sql,
        "SELECT balance, held FROM wallets WHERE workspace_id = $1",
        [ws.id],
      );
      return {
        ok: true,
        credits,
        name: String(code.name),
        workspace_id: Number(ws.public_id),
        balance: Number(wallet.balance),
        available: Number(wallet.balance) - Number(wallet.held),
      };
    });
  }

  // ---- Invite Rewards ----

  async inviteRewards(actor: Actor) {
    const invited = (
      await this.p.db.query(
        `SELECT rr.user_id AS invitee_id, u.name AS invitee_name, u.nickname AS invitee_nickname,
                rr.created_at AS registered_at,
                irg.id AS grant_id, irg.credits AS granted_credits, irg.created_at AS granted_at
           FROM registration_redemptions rr
           JOIN invites i ON i.id = rr.invitation_id
           JOIN users u ON u.id = rr.user_id
           LEFT JOIN invite_reward_grants irg ON irg.invitee_user_id = rr.user_id
          WHERE i.created_by = $1 AND rr.user_id <> $1
          ORDER BY rr.created_at DESC
          LIMIT 100`,
        [actor.id],
      )
    ).rows;

    let totalGranted = 0;
    let pendingCount = 0;
    const items = invited.map((r) => {
      const granted = Boolean(r.grant_id);
      if (granted) totalGranted += Number(r.granted_credits);
      else pendingCount++;
      return {
        invitee_id: String(r.invitee_id),
        invitee_name: String(r.invitee_nickname || r.invitee_name),
        registered_at: new Date(r.registered_at).toISOString(),
        reward_credits: granted ? Number(r.granted_credits) : INVITE_REWARD_CREDITS,
        claimed: granted,
        granted_at: r.granted_at ? new Date(r.granted_at).toISOString() : null,
      };
    });

    return {
      reward_per_invite: INVITE_REWARD_CREDITS,
      total_invited: items.length,
      total_granted_credits: totalGranted,
      pending_claim_count: pendingCount,
      pending_claim_credits: pendingCount * INVITE_REWARD_CREDITS,
      items,
    };
  }

  async claimInviteRewards(actor: Actor, explicitWorkspace?: string) {
    return this.p.db.transaction(async (sql) => {
      const ws = await this.identity.activeWorkspace(sql, actor, explicitWorkspace);
      const pending = (
        await sql.query(
          `SELECT rr.user_id AS invitee_id, COALESCE(NULLIF(u.nickname, ''), u.name) AS invitee_label
             FROM registration_redemptions rr
             JOIN invites i ON i.id = rr.invitation_id
             JOIN users u ON u.id = rr.user_id
            WHERE i.created_by = $1
              AND rr.user_id <> $1
              AND NOT EXISTS (
                SELECT 1 FROM invite_reward_grants g WHERE g.invitee_user_id = rr.user_id
              )
            ORDER BY rr.created_at ASC
            LIMIT 50`,
          [actor.id],
        )
      ).rows;

      let grantedCount = 0;
      let grantedCredits = 0;
      for (const row of pending) {
        const inserted = await one(
          sql,
          `INSERT INTO invite_reward_grants(inviter_user_id, invitee_user_id, workspace_id, credits, trigger_action)
           VALUES ($1, $2, $3, $4, 'register')
           ON CONFLICT (invitee_user_id) DO NOTHING
           RETURNING id`,
          [actor.id, row.invitee_id, ws.id, INVITE_REWARD_CREDITS],
        );
        if (!inserted) continue;
        await this.p.credit(
          sql,
          ws.id,
          INVITE_REWARD_CREDITS,
          `invite-reward:${row.invitee_id}`,
          "grant",
          {
            actorId: actor.id,
            note: `邀请好友注册返佣 · ${row.invitee_label}`,
          },
        );
        grantedCount++;
        grantedCredits += INVITE_REWARD_CREDITS;
      }

      return {
        claimed_count: grantedCount,
        claimed_credits: grantedCredits,
        workspace_id: Number(ws.public_id),
      };
    });
  }

  // ---- Period Quota Packs / Subscriptions (Q5) ----

  async listPlans(actor: Actor, explicitWorkspace?: string) {
    return this.p.db.transaction(async (sql) => {
      const ws = await this.identity.activeWorkspace(sql, actor, explicitWorkspace);
      const plans = (
        await sql.query(
          `SELECT id, code, name, price_fen, period_days, period_credits, quotas, enabled, position
             FROM subscription_plans
            WHERE enabled = TRUE
            ORDER BY position ASC, price_fen ASC`,
        )
      ).rows.map((p) => ({
        id: String(p.id),
        code: String(p.code),
        name: String(p.name),
        price_fen: Number(p.price_fen),
        price_yuan: Number(p.price_fen) / 100,
        period_days: Number(p.period_days),
        period_credits: Number(p.period_credits),
        quotas: p.quotas ?? {},
      }));

      const subscriptions = (
        await sql.query(
          `SELECT s.id, s.status, s.current_period_start, s.current_period_end, s.order_id, s.created_at,
                  p.code AS plan_code, p.name AS plan_name, p.period_credits, p.period_days
             FROM workspace_subscriptions s
             JOIN subscription_plans p ON p.id = s.plan_id
            WHERE s.workspace_id = $1
            ORDER BY s.created_at DESC
            LIMIT 20`,
          [ws.id],
        )
      ).rows.map((s) => ({
        id: String(s.id),
        plan_code: String(s.plan_code),
        plan_name: String(s.plan_name),
        period_credits: Number(s.period_credits),
        period_days: Number(s.period_days),
        status: String(s.status),
        current_period_start: new Date(s.current_period_start).toISOString(),
        current_period_end: new Date(s.current_period_end).toISOString(),
        order_id: s.order_id ? String(s.order_id) : null,
        created_at: new Date(s.created_at).toISOString(),
      }));

      return {
        workspace_id: Number(ws.public_id),
        plans,
        subscriptions,
      };
    });
  }

  async createPlan(actor: Actor, body: unknown) {
    this.p.admin(actor);
    const input = parseBody(body, subscriptionPlanCreateFields);
    const code = input.code.trim().toLowerCase();
    requireValue(/^[a-z0-9][a-z0-9-]{1,62}$/.test(code), 400, "套餐编码格式无效");

    const row = await one(
      this.p.db,
      `INSERT INTO subscription_plans(code, name, price_fen, period_days, period_credits, quotas, enabled)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       ON CONFLICT (code) DO UPDATE
         SET name = EXCLUDED.name,
             price_fen = EXCLUDED.price_fen,
             period_days = EXCLUDED.period_days,
             period_credits = EXCLUDED.period_credits,
             quotas = EXCLUDED.quotas,
             enabled = EXCLUDED.enabled
       RETURNING id, code, name, price_fen, period_days, period_credits, quotas, enabled`,
      [
        code,
        input.name.trim(),
        input.price_fen,
        input.period_days,
        input.period_credits,
        JSON.stringify(input.quotas ?? {}),
        input.enabled,
      ],
    );

    return {
      plan: {
        id: String(row.id),
        code: String(row.code),
        name: String(row.name),
        price_fen: Number(row.price_fen),
        period_days: Number(row.period_days),
        period_credits: Number(row.period_credits),
        quotas: row.quotas ?? {},
        enabled: Boolean(row.enabled),
      },
    };
  }

  /**
   * Q5: Activates a period quota pack reusing existing Alipay/USDT recharge orders
   * (or zero-cost / admin-authorized activation), then triggers idempotent periodic grant.
   */
  async subscribe(actor: Actor, body: unknown, explicitWorkspace?: string) {
    const input = parseBody(body, subscriptionSubscribeFields);
    const subId = await this.p.db.transaction(async (sql) => {
      const ws = await this.identity.activeWorkspace(sql, actor, explicitWorkspace);
      const plan = await one(
        sql,
        "SELECT * FROM subscription_plans WHERE code = $1 AND enabled = TRUE",
        [input.plan_code.trim().toLowerCase()],
      );
      requireValue(plan, 404, "周期配额包套餐不存在或已下架");

      const orderId = input.order_id?.trim() || null;
      if (Number(plan.price_fen) > 0 && actor.role !== "admin") {
        // Verify paid recharge order belonging to this workspace when non-admin activates a paid pack
        requireValue(
          orderId,
          402,
          "请先通过支付宝或 USDT 完成充值订单，再传入已支付的订单号激活周期配额包",
        );
        const order = await one(
          sql,
          `SELECT id, state, amount_fen FROM recharge_orders
            WHERE id::text = $1 AND workspace_id = $2`,
          [orderId, ws.id],
        );
        requireValue(
          order && order.state === "paid" && Number(order.amount_fen) >= Number(plan.price_fen),
          402,
          "未找到已支付且金额匹配的充值订单",
        );
      }

      const start = new Date();
      const end = new Date(
        start.getTime() + Number(plan.period_days) * 86_400_000,
      );
      const created = await one(
        sql,
        `INSERT INTO workspace_subscriptions(workspace_id, plan_id, status, current_period_start, current_period_end, order_id)
         VALUES ($1, $2, 'active', $3, $4, $5)
         RETURNING id, current_period_start, current_period_end`,
        [ws.id, plan.id, start, end, orderId],
      );
      await this.p.audit(sql, actor, "subscription.activate", String(created.id));
      return {
        id: String(created.id),
        plan_code: String(plan.code),
        plan_name: String(plan.name),
        period_credits: Number(plan.period_credits),
        current_period_start: new Date(created.current_period_start).toISOString(),
        current_period_end: new Date(created.current_period_end).toISOString(),
      };
    });

    // Immediately issue the period credits idempotently
    await grantDueSubscriptions(this.p);
    return { ok: true, subscription: subId };
  }

  // ---- Financial Statements (CSV / PDF) ----

  async exportStatement(
    actor: Actor,
    format: "csv" | "pdf",
    explicitWorkspace?: string,
  ): Promise<{ filename: string; mime: string; bytes: Buffer }> {
    return this.p.db.transaction(async (sql) => {
      await sql.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      const ws = await this.identity.activeWorkspace(sql, actor, explicitWorkspace);
      const wallet = await one(
        sql,
        "SELECT balance, held FROM wallets WHERE workspace_id = $1",
        [ws.id],
      );
      const rows = (
        await sql.query(
          `SELECT l.public_id, l.created_at, l.action, l.amount, l.balance_snapshot, l.held_snapshot,
                  l.note, COALESCE(NULLIF(u.nickname, ''), u.name, '') AS actor_name
             FROM ledger l
             LEFT JOIN users u ON u.id = l.actor_id
            WHERE l.workspace_id = $1
            ORDER BY l.created_at DESC, l.public_id DESC NULLS LAST
            LIMIT 1000`,
          [ws.id],
        )
      ).rows;

      const stamp = new Date().toISOString().slice(0, 10);
      if (format === "pdf") {
        const pdfBytes = buildLedgerStatementPdf({
          workspaceName: String(ws.name || `Workspace ${ws.public_id}`),
          workspacePublicId: Number(ws.public_id),
          balance: Number(wallet?.balance ?? 0),
          reserved: Number(wallet?.held ?? 0),
          generatedAtIso: new Date().toISOString(),
          rows: rows.map((r, i) => ({
            id: Number(r.public_id ?? i + 1),
            createdIso: new Date(r.created_at).toISOString(),
            action: String(r.action),
            amount: Number(r.amount),
            balance: Number(r.balance_snapshot ?? 0),
            reserved: Number(r.held_snapshot ?? 0),
            note: String(r.note ?? ""),
          })),
        });
        return {
          filename: `fumiao-statement-ws${ws.public_id}-${stamp}.pdf`,
          mime: "application/pdf",
          bytes: pdfBytes,
        };
      }

      const header = [
        "ID",
        "时间",
        "类型",
        "变动积分",
        "余额快照",
        "冻结快照",
        "操作人",
        "备注",
      ].join(",");
      const csvLines = [header];
      for (const r of rows) {
        csvLines.push(
          [
            csvCell(r.public_id ?? ""),
            csvCell(new Date(r.created_at).toISOString()),
            csvCell(r.action),
            csvCell(r.amount),
            csvCell(r.balance_snapshot ?? ""),
            csvCell(r.held_snapshot ?? ""),
            csvCell(r.actor_name),
            csvCell(r.note ?? ""),
          ].join(","),
        );
      }
      // UTF-8 BOM for clean Excel opening on macOS/Windows
      const csvText = "\uFEFF" + csvLines.join("\r\n") + "\r\n";
      return {
        filename: `fumiao-statement-ws${ws.public_id}-${stamp}.csv`,
        mime: "text/csv; charset=utf-8",
        bytes: Buffer.from(csvText, "utf8"),
      };
    });
  }
}
