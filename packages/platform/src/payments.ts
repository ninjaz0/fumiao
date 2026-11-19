import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Platform, uuid, type Actor } from "./platform.js";
import { one } from "./db.js";
import { requireValue, hash } from "./security.js";
import {
  paymentAdapters,
  paymentConfig,
  type PaymentAdapter,
  type PaymentOrder,
} from "../../../plugins/payments/src/index.js";
const paymentOrder = (r: Record<string, any>): PaymentOrder => ({
  id: r.id,
  method: r.method,
  amount: Number(r.amount),
  credits: Number(r.credits),
  trade_id: r.trade_id,
});
const publicOrder = (row: any) => ({
  id: row.id,
  method: row.method,
  amount: row.amount,
  credits: row.credits,
  state: row.state,
  checkout:
    row.state === "pending" && new Date(row.expires_at).getTime() > Date.now()
      ? row.checkout
      : null,
  created_at: row.created_at,
  expires_at: row.expires_at,
});
export class Payments {
  constructor(
    private p: Platform,
    private adapters: Record<string, PaymentAdapter> = paymentAdapters,
  ) {}
  async configure(actor: Actor, method: string, value: unknown) {
    this.p.admin(actor);
    requireValue(this.adapters[method], 400, "支付插件不存在");
    const input = z
      .object({ enabled: z.boolean(), config: paymentConfig })
      .parse(value);
    await this.p.db.transaction(async (sql) => {
      await sql.query(
        "INSERT INTO payment_channels(method,config,enabled) VALUES($1,$2,$3) ON CONFLICT(method) DO UPDATE SET config=EXCLUDED.config,enabled=EXCLUDED.enabled",
        [method, this.p.vault.seal(input.config), input.enabled],
      );
      await this.p.audit(sql, actor, "payments.configure", method);
    });
    return { ok: true };
  }
  async list(actor: Actor, wid: string) {
    await this.p.workspace(this.p.db, actor, wid);
    return {
      channels: (
        await this.p.db.query(
          "SELECT method FROM payment_channels WHERE enabled=true",
        )
      ).rows,
      orders: (
        await this.p.db.query(
          "SELECT * FROM payment_orders WHERE workspace_id=$1 AND owner_id=$2 ORDER BY created_at DESC LIMIT 30",
          [wid, actor.id],
        )
      ).rows.map(publicOrder),
    };
  }
  async create(actor: Actor, wid: string, value: unknown) {
    const input = z
      .object({
        key: uuid,
        method: z.enum(["alipay", "usdt_plasma"]),
        yuan: z.number().int().min(1).max(10000),
      })
      .parse(value);
    const prepared = await this.p.db.transaction(async (sql) => {
      await this.p.workspace(sql, actor, wid);
      await sql.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
        actor.id,
      ]);
      const old = await one(
        sql,
        "SELECT * FROM payment_orders WHERE owner_id=$1 AND request_key=$2",
        [actor.id, input.key],
      );
      if (old) {
        requireValue(
          old.workspace_id === wid &&
            old.method === input.method &&
            old.amount === input.yuan * 100,
          409,
          "充值幂等键已使用",
        );
        return { order: old, fresh: false };
      }
      const count = await one(
        sql,
        "SELECT count(*) AS n FROM payment_orders WHERE owner_id=$1 AND state<>'paid' AND expires_at>now()",
        [actor.id],
      );
      requireValue(Number(count.n) < 3, 409, "最多保留 3 笔待付订单");
      const channel = await one(
        sql,
        "SELECT * FROM payment_channels WHERE method=$1 AND enabled=true",
        [input.method],
      );
      requireValue(channel, 503, "此付款方式不可用");
      const config = this.p.vault.open(channel.config),
        id = randomUUID();
      const rate = Number(process.env.CREDITS_PER_YUAN || 10);
      requireValue(
        Number.isSafeInteger(rate) && rate > 0 && rate <= 100000,
        500,
        "积分兑换比例无效",
      );
      const order = await one(
        sql,
        "INSERT INTO payment_orders(id,workspace_id,owner_id,request_key,method,config_snapshot,amount,credits,merchant) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
        [
          id,
          wid,
          actor.id,
          input.key,
          input.method,
          channel.config,
          input.yuan * 100,
          input.yuan * rate,
          hash(config.gateway + "|" + config.pid),
        ],
      );
      return { order, fresh: true };
    });
    if (!prepared.fresh) return publicOrder(prepared.order);
    const order = prepared.order;
    try {
      const receipt = await this.adapters[order.method].create(
        paymentOrder(order),
        paymentConfig.parse(this.p.vault.open(order.config_snapshot)),
        process.env.PUBLIC_URL || "http://localhost:3000",
      );
      await this.p.db.query(
        "UPDATE payment_orders SET state=CASE WHEN state='paid' THEN state ELSE 'pending' END,checkout=$2,trade_id=COALESCE(trade_id,$3) WHERE id=$1",
        [order.id, receipt.checkout, receipt.tradeId || null],
      );
    } catch {
      await this.p.db.query(
        "UPDATE payment_orders SET state='unconfirmed' WHERE id=$1 AND state<>'paid'",
        [order.id],
      );
    }
    return publicOrder(
      await one(this.p.db, "SELECT * FROM payment_orders WHERE id=$1", [
        order.id,
      ]),
    );
  }
  async settle(id: string, trade: string) {
    return this.p.db.transaction(async (sql) => {
      const order = await one(
        sql,
        "SELECT * FROM payment_orders WHERE id=$1 FOR UPDATE",
        [id],
      );
      requireValue(order, 404, "订单不存在");
      requireValue(
        !order.trade_id || order.trade_id === trade,
        409,
        "网关订单不一致",
      );
      if (order.state === "paid") return;
      await this.p.credit(
        sql,
        order.workspace_id,
        Number(order.credits),
        "payment:" + id,
        "recharge",
        {
          actorId: order.owner_id,
          uid: "recharge:" + id,
          note:
            (order.method === "alipay" ? "支付宝" : "USDT-Plasma") +
            " ¥" +
            (Number(order.amount) / 100).toFixed(2) +
            " · " +
            id,
        },
      );
      await sql.query(
        "UPDATE payment_orders SET state='paid',trade_id=$2,paid_at=now() WHERE id=$1",
        [id, trade],
      );
    });
  }
  async refresh(actor: Actor, id: string) {
    uuid.parse(id);
    const order = await one(
      this.p.db,
      "SELECT * FROM payment_orders WHERE id=$1 AND owner_id=$2",
      [id, actor.id],
    );
    requireValue(order, 404, "订单不存在");
    await this.p.workspace(this.p.db, actor, order.workspace_id);
    if (order.state !== "paid") {
      const allowed = await one(
        this.p.db,
        "UPDATE payment_orders SET checked_at=now() WHERE id=$1 AND (checked_at IS NULL OR checked_at<now()-interval '10 seconds') RETURNING id",
        [id],
      );
      if (!allowed) return publicOrder(order);
      try {
        const trade = await this.adapters[order.method].verify(
          paymentOrder(order),
          paymentConfig.parse(this.p.vault.open(order.config_snapshot)),
        );
        if (trade) await this.settle(id, trade);
      } catch {
        return {
          ...publicOrder(order),
          warning: "支付结果暂未确认，请稍后查询，避免重复支付",
        };
      }
    }
    return publicOrder(
      await one(this.p.db, "SELECT * FROM payment_orders WHERE id=$1", [id]),
    );
  }
  async callback(method: string, values: Record<string, unknown>) {
    const adapter = this.adapters[method];
    requireValue(adapter, 400, "支付插件不存在");
    const id = uuid.parse(
      values[method === "alipay" ? "out_trade_no" : "order_id"],
    );
    const order = await one(
      this.p.db,
      "SELECT * FROM payment_orders WHERE id=$1 AND method=$2",
      [id, method],
    );
    requireValue(order, 404, "订单不存在");
    const config = paymentConfig.parse(
      this.p.vault.open(order.config_snapshot),
    );
    let expected: string;
    try {
      expected = adapter.callback(paymentOrder(order), config, values);
    } catch {
      throw new Error("Invalid callback");
    }
    if (order.state === "paid" && order.trade_id === expected) return;
    const trade = await adapter.verify(paymentOrder(order), config, expected);
    requireValue(trade, 409, "网关尚未确认付款");
    await this.settle(id, trade);
  }
}
