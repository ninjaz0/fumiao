import { createHash, randomBytes, randomUUID } from "node:crypto";
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
const STATEMENT_MAX_ROWS = 50_000;

const ACTION_LABELS_ZH: Record<string, string> = {
  recharge: "充值",
  grant: "赠送/发放",
  adjust: "调整",
  hold: "冻结",
  spend: "扣费",
  refund: "退回",
};

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

function pdfUtf16Hex(text: string): string {
  const clean = text.replace(/[\x00-\x1f\x7f]/g, " ");
  let hex = "";
  for (let i = 0; i < clean.length; i++) {
    hex += clean.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0");
  }
  return `<${hex}>`;
}

function displayWidth(text: string): number {
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    w += text.charCodeAt(i) > 0x7f ? 2 : 1;
  }
  return w;
}

function padRightDisplay(text: string, targetWidth: number): string {
  const w = displayWidth(text);
  return w >= targetWidth ? text : text + " ".repeat(targetWidth - w);
}

function wrapDisplayText(text: string, maxCols: number): string[] {
  const clean = text.replace(/\r?\n/g, " ").trim();
  if (!clean) return [""];
  const lines: string[] = [];
  let current = "";
  let cols = 0;
  for (const ch of clean) {
    const chWidth = ch.charCodeAt(0) > 0x7f ? 2 : 1;
    if (cols + chWidth > maxCols && current) {
      lines.push(current);
      current = ch;
      cols = chWidth;
    } else {
      current += ch;
      cols += chWidth;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function parseRangeBound(raw: string | undefined, endOfDay: boolean): Date | null {
  if (!raw || !raw.trim()) return null;
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const iso = endOfDay ? `${s}T23:59:59.999Z` : `${s}T00:00:00.000Z`;
    const d = new Date(iso);
    requireValue(!Number.isNaN(d.getTime()), 400, "对账单日期格式无效，请使用 YYYY-MM-DD");
    return d;
  }
  const d = new Date(s);
  requireValue(!Number.isNaN(d.getTime()), 400, "对账单时间范围格式无效");
  return d;
}

/**
 * Pure zero-dependency multi-page PDF 1.4 CJK financial statement builder.
 * Uses Standard PDF 1.4 Type0 CIDFont (`/BaseFont /STSong-Light`, `/Encoding /UniGB-UCS2-H`)
 * with UTF-16BE hex strings so Chinese characters, workspace names, and full wrapped notes
 * render natively across PDF viewers and paginate cleanly over unlimited rows.
 */
export function buildLedgerStatementPdf(options: {
  workspaceName: string;
  workspacePublicId: number;
  balance: number;
  reserved: number;
  generatedAtIso: string;
  rangeLabel?: string;
  totalCount?: number;
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
  const totalCount = options.totalCount ?? options.rows.length;
  const totalIn = options.rows
    .filter((r) => ["recharge", "grant", "adjust"].includes(r.action) && r.amount > 0)
    .reduce((sum, r) => sum + r.amount, 0);
  const totalOut = options.rows
    .filter((r) => r.action === "spend")
    .reduce((sum, r) => sum + Math.abs(r.amount), 0);

  const rangeText = options.rangeLabel || "全部时间";
  const headerLines = [
    "弗淼工作台 · 积分账户对账单 (FUMIAO CREDIT STATEMENT)",
    `工作区：#${options.workspacePublicId} ${options.workspaceName}    统计区间：${rangeText}`,
    `生成时间：${options.generatedAtIso.replace("T", " ").slice(0, 19)} UTC    记录数：${options.rows.length} / 总计 ${totalCount} 条`,
    `余额快照：总余额 ${options.balance} | 冻结 ${options.reserved} | 可用 ${options.balance - options.reserved} 积分（入账合计 +${totalIn} / 扣费合计 -${totalOut}）`,
    "----------------------------------------------------------------------------------------------",
    "编号     | 时间(UTC)           | 类型       | 变动积分 | 余额快照 | 备注",
    "----------------------------------------------------------------------------------------------",
  ];

  // Expand every ledger entry into 1+ wrapped display lines (never silently truncating notes!)
  const bodyLines: string[] = [];
  for (const r of options.rows) {
    const idCol = padRightDisplay(String(r.id), 8);
    const tsCol = padRightDisplay(r.createdIso.slice(0, 19).replace("T", " "), 19);
    const actLabel = ACTION_LABELS_ZH[r.action] || r.action;
    const actCol = padRightDisplay(actLabel, 10);
    const signedAmt =
      r.action === "spend"
        ? `-${Math.abs(r.amount)}`
        : r.action === "hold"
          ? `(${r.amount})`
          : r.amount >= 0
            ? `+${r.amount}`
            : String(r.amount);
    const amtCol = signedAmt.padStart(8);
    const balCol = String(r.balance).padStart(8);
    const wrappedNote = wrapDisplayText(r.note || "-", 30);
    bodyLines.push(`${idCol} | ${tsCol} | ${actCol} | ${amtCol} | ${balCol} | ${wrappedNote[0]}`);
    for (let i = 1; i < wrappedNote.length; i++) {
      bodyLines.push(`${" ".repeat(65)} | ${wrappedNote[i]}`);
    }
  }
  if (!bodyLines.length) {
    bodyLines.push("（该时间范围内无积分流水记录）");
  }

  const linesPerPage = 42;
  const pageChunks: string[][] = [];
  for (let i = 0; i < bodyLines.length; i += linesPerPage) {
    pageChunks.push(bodyLines.slice(i, i + linesPerPage));
  }
  const pageCount = Math.max(1, pageChunks.length);

  // Object layout:
  // 1: Catalog
  // 2: Pages
  // 3: Type0 Font (/F1)
  // 4: CIDFontType0
  // 5: FontDescriptor
  // 6..: Pairs of (Page obj, Content stream obj)
  const pageObjIds: number[] = [];
  const dynamicObjects: string[] = [];
  let nextObjId = 6;

  for (let pageIdx = 0; pageIdx < pageCount; pageIdx++) {
    const pageObjId = nextObjId++;
    const contentObjId = nextObjId++;
    pageObjIds.push(pageObjId);

    const lines = [
      ...headerLines,
      ...(pageChunks[pageIdx] ?? []),
      "----------------------------------------------------------------------------------------------",
      `第 ${pageIdx + 1} / ${pageCount} 页    已导出 ${options.rows.length} 条记录（总计 ${totalCount} 条）`,
    ];

    const streamOps: string[] = ["BT", "/F1 8.5 Tf", "30 765 Td", "13.5 TL"];
    lines.forEach((line, idx) => {
      const hex = pdfUtf16Hex(line);
      streamOps.push(idx === 0 ? `${hex} Tj` : `T* ${hex} Tj`);
    });
    streamOps.push("ET");
    const contentStream = streamOps.join("\n");
    const contentBytes = Buffer.byteLength(contentStream, "ascii");

    dynamicObjects.push(
      `${pageObjId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjId} 0 R >>\nendobj\n`,
    );
    dynamicObjects.push(
      `${contentObjId} 0 obj\n<< /Length ${contentBytes} >>\nstream\n${contentStream}\nendstream\nendobj\n`,
    );
  }

  const objects: string[] = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>\nendobj\n`,
    "3 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [4 0 R] >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 2 >> /DW 1000 /W [ 1 [ 500 ] 2 95 500 ] /FontDescriptor 5 0 R >>\nendobj\n",
    "5 0 obj\n<< /Type /FontDescriptor /FontName /STSong-Light /Flags 4 /FontBBox [-250 -143 1000 857] /ItalicAngle 0 /Ascent 857 /Descent -143 /CapHeight 700 /StemV 80 >>\nendobj\n",
    ...dynamicObjects,
  ];

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "binary")];
  const offsets: number[] = [0];
  let cursor = chunks[0].length;
  for (const obj of objects) {
    offsets.push(cursor);
    const buf = Buffer.from(obj, "ascii");
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
 * and Chinese Multi-Page PDF / Full-Range CSV Financial Statement Exports.
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
    requireValue(!actor.tokenId, 403, "兑换码兑换仅支持浏览器会话");
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
    requireValue(!actor.tokenId, 403, "领取邀请返佣仅支持浏览器会话");
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

  // ---- Period Quota Packs / Subscriptions (Q5 + #4) ----

  async listPlans(actor: Actor, explicitWorkspace?: string) {
    return this.p.db.transaction(async (sql) => {
      const ws = await this.identity.activeWorkspace(sql, actor, explicitWorkspace);
      // Mark elapsed active subscriptions expired before reading
      await sql.query(
        `UPDATE workspace_subscriptions
            SET status = 'expired', revision = revision + 1
          WHERE workspace_id = $1 AND status = 'active' AND current_period_end <= now()`,
        [ws.id],
      );
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
        cost_credits: Math.round(Number(p.price_fen) / 10),
        period_days: Number(p.period_days),
        period_credits: Number(p.period_credits),
        quotas: p.quotas ?? {},
      }));

      const subscriptions = (
        await sql.query(
          `SELECT s.id, s.status, s.current_period_start, s.current_period_end, s.order_id, s.created_at,
                  p.code AS plan_code, p.name AS plan_name, p.period_credits, p.period_days,
                  EXISTS (
                    SELECT 1 FROM subscription_grants g
                     WHERE g.subscription_id = s.id AND g.period_start = s.current_period_start
                  ) AS period_granted
             FROM workspace_subscriptions s
             JOIN subscription_plans p ON p.id = s.plan_id
            WHERE s.workspace_id = $1
            ORDER BY s.current_period_end DESC, s.created_at DESC
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
        period_granted: Boolean(s.period_granted),
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
        price_yuan: Number(row.price_fen) / 100,
        cost_credits: Math.round(Number(row.price_fen) / 10),
        period_days: Number(row.period_days),
        period_credits: Number(row.period_credits),
        quotas: row.quotas ?? {},
        enabled: Boolean(row.enabled),
      },
    };
  }

  /**
   * Q5 + #4: Activates or renews a period quota pack with strict single-settlement accounting:
   * - Idempotent by `uid` (or `order:<order_id>`), protected by `subscription_activations(idempotency_key PRIMARY KEY, order_id UNIQUE)`.
   * - Prevents double-counting paid recharge funds: both `payment_mode="wallet"` and `payment_mode="order"`
   *   atomically debit `cost_credits = round(price_fen / 10)` from workspace balance so a ¥29 recharge (+290)
   *   converted into a ¥29 starter pack (-290 spend + 350 grant) nets EXACTLY +350 credits (period_credits).
   * - Explicit renewal/expiry semantics:
   *   - New or expired plan: starts at `now()`, ends at `now() + period_days`, credits granted immediately.
   *   - Renewal of an active plan: chains seamlessly from `existing.current_period_end` to `+ period_days`,
   *     and periodic worker grants credits when `current_period_start <= now()`.
   */
  async subscribe(actor: Actor, body: unknown, explicitWorkspace?: string) {
    requireValue(!actor.tokenId, 403, "开通或续期周期配额包仅支持浏览器会话");
    const input = parseBody(body, subscriptionSubscribeFields);

    const outcome = await this.p.db.transaction(async (sql) => {
      const ws = await this.identity.activeWorkspace(sql, actor, explicitWorkspace);
      // Serialize concurrent subscription activations & wallet balance checks per workspace
      const wallet = await one(
        sql,
        "SELECT balance, held FROM wallets WHERE workspace_id = $1 FOR UPDATE",
        [ws.id],
      );
      requireValue(wallet, 404, "工作区钱包不存在");

      const plan = await one(
        sql,
        "SELECT * FROM subscription_plans WHERE code = $1 AND enabled = TRUE",
        [input.plan_code.trim().toLowerCase()],
      );
      requireValue(plan, 404, "周期配额包套餐不存在或已下架");

      const orderId = input.order_id?.trim() || null;
      const uid = input.uid?.trim() || "";
      const idempotencyKey = uid || (orderId ? `order:${orderId}` : randomUUID());

      const hasActTable = await one(
        sql,
        "SELECT to_regclass('subscription_activations') IS NOT NULL AS ok",
      );

      // 1. Idempotent retry check
      if (hasActTable?.ok) {
        const existingAct = await one(
          sql,
          `SELECT a.workspace_id, a.cost_credits, a.payment_mode,
                  s.id, s.status, s.current_period_start, s.current_period_end, s.order_id,
                  p.code AS plan_code, p.name AS plan_name, p.period_credits
             FROM subscription_activations a
             JOIN workspace_subscriptions s ON s.id = a.subscription_id
             JOIN subscription_plans p ON p.id = s.plan_id
            WHERE a.idempotency_key = $1`,
          [idempotencyKey],
        );
        if (existingAct) {
          requireValue(
            existingAct.workspace_id === ws.id,
            409,
            "幂等请求键已被其他工作区使用",
          );
          const startsInFuture =
            new Date(existingAct.current_period_start).getTime() > Date.now();
          return {
            idempotent_replay: true,
            renewed: startsInFuture,
            grant_timing: startsInFuture ? "at_period_start" : "immediate",
            cost_credits: Number(existingAct.cost_credits),
            payment_mode: String(existingAct.payment_mode),
            subscription: {
              id: String(existingAct.id),
              plan_code: String(existingAct.plan_code),
              plan_name: String(existingAct.plan_name),
              period_credits: Number(existingAct.period_credits),
              current_period_start: new Date(
                existingAct.current_period_start,
              ).toISOString(),
              current_period_end: new Date(
                existingAct.current_period_end,
              ).toISOString(),
              order_id: existingAct.order_id ? String(existingAct.order_id) : null,
            },
          };
        }
      }

      const priceFen = Number(plan.price_fen);
      const costCredits = Math.round(priceFen / 10);
      let paymentMode: "wallet" | "order" | "free" | "admin";
      if (orderId) {
        paymentMode = "order";
      } else if (costCredits === 0) {
        paymentMode = "free";
      } else if (input.payment_mode === "admin") {
        requireValue(actor.role === "admin", 403, "仅管理员可使用后台直通开通");
        paymentMode = "admin";
      } else {
        paymentMode = "wallet";
      }

      // 2. Verify order & deduct wallet credits atomically so paid funds are NEVER double-counted!
      let chargedCredits = 0;
      if (paymentMode === "order") {
        if (hasActTable?.ok) {
          const usedOrder = await one(
            sql,
            "SELECT subscription_id FROM subscription_activations WHERE order_id = $1",
            [orderId],
          );
          if (usedOrder) {
            throw new DomainError(409, "该充值订单已用于激活周期配额包，不能重复消费");
          }
        }
        let order = await one(
          sql,
          `SELECT id, state, amount AS amount_fen FROM original_recharge_orders
            WHERE id = $1 AND workspace_id = $2
            FOR UPDATE`,
          [orderId, ws.id],
        );
        if (!order && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId!)) {
          order = await one(
            sql,
            `SELECT id::text AS id, state, amount AS amount_fen FROM payment_orders
              WHERE id = $1::uuid AND workspace_id = $2
              FOR UPDATE`,
            [orderId, ws.id],
          );
        }
        requireValue(
          order && order.state === "paid" && Number(order.amount_fen) >= priceFen,
          402,
          "未找到已支付且金额匹配的充值订单",
        );
        if (costCredits > 0) {
          const debited = await one(
            sql,
            "UPDATE wallets SET balance = balance - $2 WHERE workspace_id = $1 AND balance - held >= $2 RETURNING balance, held",
            [ws.id, costCredits],
          );
          requireValue(
            debited,
            402,
            `该充值订单入账积分已被消耗，当前可用积分不足 ${costCredits}，请先充值后再开通`,
          );
          chargedCredits = costCredits;
          await sql.query(
            `INSERT INTO ledger(id, workspace_id, key, action, amount, actor_id, balance_snapshot, held_snapshot, note)
             VALUES ($1, $2, $3, 'spend', $4, $5, $6, $7, $8)`,
            [
              randomUUID(),
              ws.id,
              `sub-buy:${idempotencyKey}`,
              costCredits,
              actor.id,
              debited.balance,
              debited.held,
              `周期配额包核销（充值单 ${orderId}）· ${plan.name}`,
            ],
          );
        }
      } else if (paymentMode === "wallet" && costCredits > 0) {
        const debited = await one(
          sql,
          "UPDATE wallets SET balance = balance - $2 WHERE workspace_id = $1 AND balance - held >= $2 RETURNING balance, held",
          [ws.id, costCredits],
        );
        requireValue(
          debited,
          402,
          `可用积分不足，开通「${plan.name}」需 ${costCredits} 积分，请先通过支付宝或 USDT 充值`,
        );
        chargedCredits = costCredits;
        await sql.query(
          `INSERT INTO ledger(id, workspace_id, key, action, amount, actor_id, balance_snapshot, held_snapshot, note)
           VALUES ($1, $2, $3, 'spend', $4, $5, $6, $7, $8)`,
          [
            randomUUID(),
            ws.id,
            `sub-buy:${idempotencyKey}`,
            costCredits,
            actor.id,
            debited.balance,
            debited.held,
            `周期配额包开通 · ${plan.name}`,
          ],
        );
      }

      // 3. Renewal vs New / Post-Expiry Period Scheduling
      await sql.query(
        `UPDATE workspace_subscriptions
            SET status = 'expired', revision = revision + 1
          WHERE workspace_id = $1 AND status = 'active' AND current_period_end <= now()`,
        [ws.id],
      );
      const activeSub = await one(
        sql,
        `SELECT id, current_period_end
           FROM workspace_subscriptions
          WHERE workspace_id = $1 AND plan_id = $2 AND status = 'active' AND current_period_end > now()
          ORDER BY current_period_end DESC
          LIMIT 1
          FOR UPDATE`,
        [ws.id, plan.id],
      );
      const renewed = Boolean(activeSub);
      const start = activeSub ? new Date(activeSub.current_period_end) : new Date();
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

      if (hasActTable?.ok) {
        await sql.query(
          `INSERT INTO subscription_activations(idempotency_key, subscription_id, order_id, workspace_id, cost_credits, payment_mode)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            idempotencyKey,
            created.id,
            orderId,
            ws.id,
            chargedCredits,
            paymentMode,
          ],
        );
      }

      await this.p.audit(
        sql,
        actor,
        renewed ? "subscription.renew" : "subscription.activate",
        String(created.id),
      );

      return {
        idempotent_replay: false,
        renewed,
        grant_timing: renewed ? "at_period_start" : "immediate",
        cost_credits: chargedCredits,
        payment_mode: paymentMode,
        subscription: {
          id: String(created.id),
          plan_code: String(plan.code),
          plan_name: String(plan.name),
          period_credits: Number(plan.period_credits),
          current_period_start: new Date(
            created.current_period_start,
          ).toISOString(),
          current_period_end: new Date(
            created.current_period_end,
          ).toISOString(),
          order_id: orderId,
        },
      };
    });

    // Immediately issue period credits for newly due activations (`current_period_start <= now()`)
    await grantDueSubscriptions(this.p);
    return {
      ok: true,
      idempotent_replay: outcome.idempotent_replay,
      renewed: outcome.renewed,
      grant_timing: outcome.grant_timing,
      cost_credits: outcome.cost_credits,
      payment_mode: outcome.payment_mode,
      subscription: outcome.subscription,
    };
  }

  // ---- Financial Statements (Full-Range CSV / Multi-Page Chinese PDF) ----

  async exportStatement(
    actor: Actor,
    format: "csv" | "pdf",
    explicitWorkspace?: string,
    range?: { from?: string; to?: string },
  ): Promise<{
    filename: string;
    mime: string;
    bytes: Buffer;
    totalCount: number;
    exportedCount: number;
    truncated: boolean;
    from: string | null;
    to: string | null;
  }> {
    const fromDate = parseRangeBound(range?.from, false);
    const toDate = parseRangeBound(range?.to, true);
    if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
      throw new DomainError(400, "开始日期不能晚于结束日期");
    }

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

      const whereParts = ["l.workspace_id = $1"];
      const params: unknown[] = [ws.id];
      if (fromDate) {
        params.push(fromDate);
        whereParts.push(`l.created_at >= $${params.length}`);
      }
      if (toDate) {
        params.push(toDate);
        whereParts.push(`l.created_at <= $${params.length}`);
      }
      const whereClause = whereParts.join(" AND ");

      const countRow = await one(
        sql,
        `SELECT COUNT(*)::int AS total FROM ledger l WHERE ${whereClause}`,
        params,
      );
      const totalCount = Number(countRow?.total ?? 0);

      const rows = (
        await sql.query(
          `SELECT l.public_id, l.created_at, l.action, l.amount, l.balance_snapshot, l.held_snapshot,
                  l.note, COALESCE(NULLIF(u.nickname, ''), u.name, '') AS actor_name
             FROM ledger l
             LEFT JOIN users u ON u.id = l.actor_id
            WHERE ${whereClause}
            ORDER BY l.created_at DESC, l.public_id DESC NULLS LAST
            LIMIT ${STATEMENT_MAX_ROWS}`,
          params,
        )
      ).rows;
      const exportedCount = rows.length;
      const truncated = totalCount > exportedCount;

      const fromLabel = range?.from?.trim() || null;
      const toLabel = range?.to?.trim() || null;
      const rangeLabel =
        fromLabel || toLabel
          ? `${fromLabel || "起始"} ~ ${toLabel || "至今"}`
          : "全部时间";
      const stamp = new Date().toISOString().slice(0, 10);

      if (format === "pdf") {
        const pdfBytes = buildLedgerStatementPdf({
          workspaceName: String(ws.name || `工作区 ${ws.public_id}`),
          workspacePublicId: Number(ws.public_id),
          balance: Number(wallet?.balance ?? 0),
          reserved: Number(wallet?.held ?? 0),
          generatedAtIso: new Date().toISOString(),
          rangeLabel,
          totalCount,
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
          totalCount,
          exportedCount,
          truncated,
          from: fromLabel,
          to: toLabel,
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
            csvCell(ACTION_LABELS_ZH[String(r.action)] ?? r.action),
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
        totalCount,
        exportedCount,
        truncated,
        from: fromLabel,
        to: toLabel,
      };
    });
  }
}
