import { creditUnits, formatCredits } from "@fumiao/platform/credit-amount.js";
import { Platform, type Actor } from "@fumiao/platform/platform.js";
import { one, type Sql } from "@fumiao/platform/db.js";
import { requireValue } from "@fumiao/platform/security.js";
import { OriginalIdentity } from "./identity.js";
import { identityBodies } from "./contracts.js";
import { parseBody } from "./validation.js";
function walletAmounts(row: { balance: string; held: string }) {
  const balance = creditUnits(String(row.balance));
  const reserved = creditUnits(String(row.held));
  const exact = {
    balance: formatCredits(balance),
    reserved: formatCredits(reserved),
    available: formatCredits(balance - reserved),
  };
  return {
    balance: Number(exact.balance),
    reserved: Number(exact.reserved),
    available: Number(exact.available),
    exact,
  };
}

/** Original wallet/history contracts over the platform's only financial authority. */
export class OriginalCredits {
  constructor(
    readonly p: Platform,
    readonly identity = new OriginalIdentity(p),
  ) {}
  async wallet(sql: Sql, publicWorkspace: number) {
    const row = await one(
      sql,
      "SELECT w.public_id,a.balance,a.held FROM wallets a JOIN workspaces w ON w.id=a.workspace_id WHERE w.public_id=$1",
      [publicWorkspace],
    );
    requireValue(row, 404, "积分账户不存在");
    return {
      workspace: Number(row.public_id),
      ...walletAmounts({ balance: row.balance, held: row.held }),
    };
  }
  async history(sql: Sql, publicWorkspace: number, before?: number) {
    const rows = (
      await sql.query(
        `SELECT l.*,w.public_id AS workspace_number,u.public_id AS actor_number,COALESCE(NULLIF(u.nickname,''),u.name) AS actor_name,
      CASE WHEN l.action='spend' THEN j.result->'media_bill' END AS media_bill,
      COALESCE(l.original_job_id,j.public_id) AS job_number FROM ledger l JOIN workspaces w ON w.id=l.workspace_id
      LEFT JOIN users u ON u.id=l.actor_id LEFT JOIN jobs j ON j.id=l.job_id
      WHERE w.public_id=$1 AND l.public_id IS NOT NULL AND l.public_id<$2 ORDER BY l.public_id DESC LIMIT 50`,
        [publicWorkspace, before || "9223372036854775807"],
      )
    ).rows;
    requireValue(
      rows.every(
        (r) => r.balance_snapshot !== null && r.held_snapshot !== null,
      ),
      503,
      "积分历史尚未完成迁移",
    );
    return rows.map((r) => ({
      id: Number(r.public_id),
      workspace: Number(r.workspace_number),
      actor: r.actor_number === null ? null : Number(r.actor_number),
      job: r.job_number === null ? null : Number(r.job_number),
      action:
        r.action === "hold"
          ? "reserve"
          : r.action === "grant"
            ? "adjust"
            : r.action,
      exact: {
        amount: formatCredits(creditUnits(String(r.amount))),
        balance: formatCredits(creditUnits(String(r.balance_snapshot))),
        reserved: formatCredits(creditUnits(String(r.held_snapshot))),
      },
      ...(r.media_bill ? { media_bill: r.media_bill } : {}),
      amount: Number(r.amount),
      balance: Number(r.balance_snapshot),
      reserved: Number(r.held_snapshot),
      note: r.note,
      uid: r.original_uid,
      created: Math.floor(new Date(r.created_at).getTime() / 1000),
      chat_turn: r.original_chat_turn,
      actor_name: r.actor_name,
    }));
  }
  async list(user: Actor, explicit?: string, before?: number) {
    return this.p.db.transaction(async (sql) => {
      await sql.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      const workspace = Number(
        (await this.identity.activeWorkspace(sql, user, explicit)).public_id,
      );
      return {
        wallet: await this.wallet(sql, workspace),
        history: await this.history(sql, workspace, before),
      };
    });
  }
  async accounts(user: Actor, workspace?: number, before?: number) {
    this.p.admin(user);
    return this.p.db.transaction(async (sql) => {
      await sql.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      return {
        accounts: await this.accountRows(sql),
        history: workspace ? await this.history(sql, workspace, before) : [],
      };
    });
  }
  async accountRows(sql: Sql) {
    const rows = (
      await sql.query(`SELECT w.public_id,w.kind,a.balance,a.held,
        CASE WHEN w.kind='team' THEN w.name ELSE COALESCE(NULLIF(u.nickname,''),u.name) END AS name,
        CASE WHEN w.kind='team' THEN NULL ELSE u.name END AS username FROM wallets a JOIN workspaces w ON w.id=a.workspace_id
        LEFT JOIN users u ON u.id=w.owner_id WHERE w.kind='team' OR u.deleted_at IS NULL ORDER BY w.kind,w.public_id`)
    ).rows;
    return rows.map((r) => ({
      workspace: Number(r.public_id),
      ...walletAmounts({ balance: r.balance, held: r.held }),
      kind: r.kind,
      name: r.name,
      username: r.username,
    }));
  }
  async adjust(user: Actor, value: unknown) {
    this.p.admin(user);
    const input = parseBody(value, identityBodies.adjustCredits),
      note = input.note.trim();
    requireValue(
      input.amount !== 0 && Math.abs(input.amount) <= 1000000000,
      400,
      "调整积分需为非零整数",
    );
    requireValue(note, 400, "请填写调整原因");
    return this.p.db.transaction(async (sql) => {
      const current = await one(
        sql,
        "SELECT role FROM users WHERE id=$1 AND active=true AND deleted_at IS NULL FOR SHARE",
        [user.id],
      );
      requireValue(current, 401, "请先登录");
      requireValue(current.role === "admin", 403, "需要管理员权限");
      await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "credit:uid:" + input.uid,
      ]);
      const prior = await one(
        sql,
        "SELECT l.*,w.public_id AS workspace_number FROM ledger l JOIN workspaces w ON w.id=l.workspace_id WHERE original_uid=$1",
        [input.uid],
      );
      if (prior) {
        requireValue(
          Number(prior.workspace_number) === input.workspace &&
            creditUnits(String(prior.amount)) === creditUnits(String(input.amount)) &&
            prior.note === note &&
            prior.actor_id === user.id,
          409,
          "该操作编号已使用",
        );
        return this.wallet(sql, input.workspace);
      }
      const wallet = await one(
        sql,
        "SELECT a.*,w.public_id FROM wallets a JOIN workspaces w ON w.id=a.workspace_id WHERE w.public_id=$1 FOR UPDATE OF a",
        [input.workspace],
      );
      requireValue(wallet, 404, "积分账户不存在");
      const nextBalance = creditUnits(String(wallet.balance)) + creditUnits(String(input.amount));
      requireValue(
        nextBalance >= creditUnits(String(wallet.held)),
        409,
        "不能扣减已冻结的积分或使可用积分小于零",
      );
      requireValue(
        nextBalance <= creditUnits("1000000000000"),
        400,
        "积分余额超出上限",
      );
      await this.p.credit(
        sql,
        wallet.workspace_id,
        input.amount,
        "original-adjust:" + input.uid,
        "adjust",
        { actorId: user.id, note, uid: input.uid },
      );
      return this.wallet(sql, input.workspace);
    });
  }
}
