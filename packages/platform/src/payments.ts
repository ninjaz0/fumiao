import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Platform, uuid, type Actor } from "./platform.js";
import { one } from "./db.js";
import { requireValue, hash } from "./security.js";
import {
  paymentConfig,
  type PaymentConfig,
  type PaymentOrder,
} from "./payment/wire.js";
import { paymentMethods, paymentProvider } from "./payment/methods.js";
interface PaymentAdapter {
  label?: string;
  create(
    o: PaymentOrder,
    c: PaymentConfig,
    site: string,
  ): Promise<{ checkout: string; tradeId?: string }>;
  callback(
    o: PaymentOrder,
    c: PaymentConfig,
    values: Record<string, unknown>,
  ): string | Promise<string>;
  verify(
    o: PaymentOrder,
    c: PaymentConfig,
    expected?: string,
  ): Promise<string | null>;
}
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
    private adapters?: Record<string, PaymentAdapter>,
  ) {}
  private async adapter(order: Record<string, any>) {
    if (this.adapters?.[order.method]) return this.adapters[order.method];
    const method = (
      await paymentMethods(this.p.db, {
        plugin: order.plugin_id,
        version: order.plugin_version,
      })
    ).find((m) => m.id === order.method);
    requireValue(method, 503, "支付插件版本不可用");
    return paymentProvider(method, false);
  }
  async configure(actor: Actor, method: string, value: unknown) {
    this.p.admin(actor);

    const input = z
      .object({
        enabled: z.boolean(),
        config: paymentConfig.optional(),
        revision: z.number().int().positive().optional(),
        plugin: z.string().optional(),
      })
      .parse(value);
    await this.p.db.transaction(async (sql) => {
      if (input.revision !== undefined) {
        const current = await one(
          sql,
          "UPDATE studio_packages SET revision=revision+1 WHERE id=$1 AND installed AND enabled AND NOT removing AND revision=$2 RETURNING id",
          [input.plugin, input.revision],
        );
        requireValue(current, 409, "插件状态已更改，请重新打开配置");
      }
      const matches = (await paymentMethods(sql)).filter(
        (m) => m.id === method && (!input.plugin || input.plugin === m.plugin),
      );
      requireValue(
        this.adapters?.[method] || matches.length === 1,
        400,
        "支付插件不存在或需要指定插件 ID",
      );
      const plugin = matches[0]?.plugin ?? "payments";
      if (input.config) {
        const bound = await one(
          sql,
          `INSERT INTO payment_channels(method,config,enabled,plugin_id) VALUES($1,$2,$3,$4)
           ON CONFLICT(method) DO UPDATE SET config=EXCLUDED.config,enabled=EXCLUDED.enabled
           WHERE payment_channels.plugin_id=EXCLUDED.plugin_id RETURNING method`,
          [method, this.p.vault.seal(input.config), input.enabled, plugin],
        );
        requireValue(bound, 409, "此渠道标识已由另一个插件配置");
      } else {
        const updated = await one(
          sql,
          "UPDATE payment_channels SET enabled=$2 WHERE method=$1 AND plugin_id=$3 RETURNING method",
          [method, input.enabled, plugin],
        );
        requireValue(updated, 400, "请先配置商户");
      }
      await this.p.audit(sql, actor, "payments.configure", method);
    });
    return { ok: true };
  }
  async create(actor: Actor, wid: string, value: unknown) {
    const input = z
      .object({
        key: uuid,
        method: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
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
        "SELECT * FROM payment_channels WHERE method=$1 AND enabled=true FOR SHARE",
        [input.method],
      );
      requireValue(channel, 503, "此付款方式不可用");
      const method = (await paymentMethods(sql)).find(
        (m) => m.id === input.method && m.plugin === channel.plugin_id,
      );
      requireValue(
        method || this.adapters?.[input.method],
        503,
        "支付插件不可用",
      );
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
        "INSERT INTO payment_orders(id,workspace_id,owner_id,request_key,method,config_snapshot,amount,credits,merchant,plugin_id,plugin_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
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
          channel.plugin_id,
          method?.version ?? "1.0.0",
        ],
      );
      return { order, fresh: true };
    });
    if (!prepared.fresh) return publicOrder(prepared.order);
    const order = prepared.order;
    try {
      const receipt = await (
        await this.adapter(order)
      ).create(
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
  async settle(id: string, trade: string, label?: string) {
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
            (label ?? order.method) +
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
  async callback(method: string, values: Record<string, unknown>) {
    const ids = Object.values(values).filter((v) => uuid.safeParse(v).success);
    const { rows } = await this.p.db.query(
      "SELECT * FROM payment_orders WHERE id=ANY($1::uuid[]) AND method=$2",
      [ids, method],
    );
    const order = rows.length === 1 && rows[0];
    requireValue(order, 404, "订单不存在");
    const id = order.id;
    const adapter = await this.adapter(order);
    const config = paymentConfig.parse(
      this.p.vault.open(order.config_snapshot),
    );
    let expected: string;
    try {
      expected = await adapter.callback(paymentOrder(order), config, values);
    } catch {
      throw new Error("Invalid callback");
    }
    if (order.state === "paid" && order.trade_id === expected) return;
    const trade = await adapter.verify(paymentOrder(order), config, expected);
    requireValue(trade, 409, "网关尚未确认付款");
    await this.settle(id, trade, adapter.label);
  }
}
