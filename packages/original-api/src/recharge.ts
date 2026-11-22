import { randomBytes } from "node:crypto";
import { one, type Sql } from "@fumiao/platform/db.js";
import { DomainError, hash, requireValue } from "@fumiao/platform/security.js";
import {
  paymentConfig,
  type PaymentConfig,
} from "@fumiao/platform/payment/wire.js";
import {
  paymentMethods,
  paymentProvider,
} from "@fumiao/platform/payment/methods.js";
import type { PaymentValues } from "@fumiao/platform/payment/values.js";
import type { OriginalActor, OriginalIdentity } from "./identity.js";

export const originalOrderId = /^FM[0-9a-f]{26}(?![\s\S])/;
const rate = 10;
const minYuan = 1;
const maxYuan = 10_000;
const now = () => Math.floor(Date.now() / 1000);
const merchant = (config: PaymentConfig) =>
  hash(config.gateway + "|" + config.pid);

export type CreateRecharge = {
  yuan: number;
  workspace: number | bigint;
  method: string;
  uid: string;
};

type Order = {
  id: string;
  uid: string;
  owner_id: string;
  workspace_id: string;
  workspace: string;
  method: string;
  merchant: string;
  plugin_id: string;
  plugin_version: string;
  config_snapshot: string | null;
  method_label?: string;
  amount: number;
  credits: number;
  state: string;
  trade_id: string | null;
  checkout: string;
  created: number;
  expires: number;
  paid: number | null;
};

function readOrder(row: Record<string, any>): Order {
  return {
    ...row,
    credits: Number(row.credits),
    created: Number(row.created),
    expires: Number(row.expires),
    paid: row.paid === null ? null : Number(row.paid),
  } as Order;
}

const methodLabel = `(SELECT decl->>'title' FROM studio_package_releases pkg,
  jsonb_array_elements(pkg.package->'contributes'->'paymentMethods') decl
  WHERE pkg.id=r.plugin_id AND pkg.version=r.plugin_version AND decl->>'id'=r.method) AS method_label`;

function publicOrder(order: Order) {
  const state =
    order.state === "pending" && order.expires <= now()
      ? "expired"
      : order.state;
  return {
    id: order.id,
    workspace: Number(order.workspace),
    method: order.method,
    method_label: order.method_label,
    amount: order.amount,
    credits: order.credits,
    created: order.created,
    expires: order.expires,
    paid: order.paid,
    state,
    can_pay: state === "pending" && !!order.checkout,
    payment_url: "/api/recharge/orders/" + order.id + "/pay",
  };
}

export class OriginalRecharge {
  private timer?: ReturnType<typeof setInterval>;
  private polling?: Promise<void>;
  private stopping = false;

  constructor(
    private identity: OriginalIdentity,
    private site: string,
  ) {}

  private get p() {
    return this.identity.p;
  }

  onApplicationBootstrap() {
    if (process.env.FUMIAO_PAYMENT_AUTOSTART === "0") return;
    this.timer = setInterval(() => {
      this.polling ??= this.poll()
        .catch(() => console.warn("Recharge reconciliation deferred"))
        .finally(() => {
          this.polling = undefined;
        });
    }, 20_000);
    this.timer.unref();
  }

  async beforeApplicationShutdown() {
    this.stopping = true;
    clearInterval(this.timer);
    await this.polling;
  }

  private async poll() {
    const timestamp = now();
    const { rows } = await this.p.db.query(
      "SELECT id FROM original_recharge_orders WHERE state<>'paid' AND created>$1 AND checked<$2 ORDER BY checked LIMIT 12",
      [timestamp - 7 * 86_400, timestamp - 60],
    );
    for (const { id } of rows) {
      if (this.stopping) break;
      await this.reconcile(id).catch(() => {});
    }
  }

  private decodeConfig(channel: Record<string, any>) {
    try {
      const result = paymentConfig.safeParse(this.p.vault.open(channel.config));
      return result.success ? result.data : undefined;
    } catch {
      return undefined;
    }
  }

  private async orderConfig(order: Order) {
    if (order.config_snapshot)
      return paymentConfig.parse(this.p.vault.open(order.config_snapshot));
    const channel = await one(
      this.p.db,
      "SELECT config FROM payment_channels WHERE method=$1 AND plugin_id=$2 AND enabled",
      [order.method, order.plugin_id],
    );
    const config = channel && this.decodeConfig(channel);
    if (!config || merchant(config) !== order.merchant)
      throw new DomainError(503, "此订单的支付通道暂不可用，请联系管理员");
    return config;
  }
  private async orderMethod(order: Order) {
    const methods = await paymentMethods(this.p.db, {
      plugin: order.plugin_id,
      version: order.plugin_version,
    });
    const method = methods.find((m) => m.id === order.method);
    requireValue(method, 503, "订单的支付插件版本不可用");
    return paymentProvider(method);
  }

  private async ownedOrder(actor: OriginalActor, id: string) {
    const row =
      originalOrderId.test(id) &&
      (await one(
        this.p.db,
        `SELECT r.*,w.public_id AS workspace, ${methodLabel} FROM original_recharge_orders r
       JOIN workspaces w ON w.id=r.workspace_id WHERE r.id=$1 AND r.owner_id=$2`,
        [id, actor.id],
      ));
    requireValue(row, 404, "充值订单不存在");
    const order = readOrder(row);
    await this.identity.requireWorkspace(
      this.p.db,
      actor,
      Number(order.workspace),
    );
    return order;
  }

  async list(
    actor: OriginalActor,
    selected: string | undefined,
    before: string | undefined,
  ) {
    const workspace = await this.identity.activeWorkspace(
      this.p.db,
      actor,
      selected,
    );
    const { rows } = await this.p.db.query(
      `SELECT r.*,$4::bigint AS workspace, ${methodLabel} FROM original_recharge_orders r
       WHERE owner_id=$1 AND workspace_id=$2 AND id<$3 ORDER BY id DESC LIMIT 30`,
      [
        actor.id,
        workspace.id,
        // Order IDs are ASCII alphanumerics. SOH has the same ordering
        // against every valid ID as NUL and can be bound as PostgreSQL text.
        (before || "z").replaceAll("\0", "\x01"),
        workspace.public_id,
      ],
    );
    const channels = await this.p.db.query(
      "SELECT method,config,plugin_id FROM payment_channels WHERE enabled ORDER BY position",
    );
    const active = await paymentMethods(this.p.db);
    const methods = channels.rows.flatMap((channel) => {
      const adapter = active.find(
        (m) => m.plugin === channel.plugin_id && m.id === channel.method,
      );
      return adapter && this.decodeConfig(channel)
        ? [
            {
              id: channel.method,
              label: adapter.title,
              ...(adapter.notice ? { notice: adapter.notice } : {}),
            },
          ]
        : [];
    });
    return {
      methods,
      credits_per_yuan: rate,
      min_yuan: minYuan,
      max_yuan: maxYuan,
      orders: rows.map((row) => publicOrder(readOrder(row))),
    };
  }

  async create(actor: OriginalActor, input: CreateRecharge) {
    const amount = input.yuan * 100;
    const prepared = await this.p.db.transaction(async (sql) => {
      await this.lock(sql, "uid:" + input.uid);
      await this.lock(sql, "owner:" + actor.id);
      // Team edits lock the workspace before changing membership. Recheck
      // access in a new statement after acquiring the lock.
      await sql.query(
        "SELECT id FROM workspaces WHERE public_id=$1 FOR SHARE",
        [input.workspace],
      );
      const workspace = await this.identity.requireWorkspace(
        sql,
        actor,
        input.workspace,
      );
      const old = await one(
        sql,
        "SELECT *,$2::bigint AS workspace FROM original_recharge_orders WHERE uid=$1",
        [input.uid, workspace.public_id],
      );
      if (old) {
        requireValue(
          old.owner_id === actor.id &&
            old.workspace_id === workspace.id &&
            old.method === input.method &&
            old.amount === amount,
          409,
          "订单编号已使用，请重新打开充值",
        );
        return { order: readOrder(old), fresh: false };
      }
      const channel = await one(
        sql,
        "SELECT config,plugin_id FROM payment_channels WHERE method=$1 AND enabled FOR SHARE",
        [input.method],
      );
      const config = channel && this.decodeConfig(channel);
      const method = (await paymentMethods(sql)).find(
        (m) => m.id === input.method && m.plugin === channel?.plugin_id,
      );
      requireValue(config && method, 503, "此付款方式暂不可用");
      const created = now();
      const { n } = await one(
        sql,
        "SELECT count(*) AS n FROM original_recharge_orders WHERE owner_id=$1 AND state<>'paid' AND expires>$2",
        [actor.id, created],
      );
      requireValue(
        Number(n) < 3,
        409,
        "最多保留 3 笔待付订单，请先完成已有订单或等待过期",
      );
      const row = await one(
        sql,
        `INSERT INTO original_recharge_orders(id,uid,owner_id,workspace_id,method,merchant,amount,credits,created,expires,plugin_id,plugin_version,config_snapshot)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$12,$13,$14) RETURNING *,$11::bigint AS workspace`,
        [
          "FM" + created + randomBytes(8).toString("hex"),
          input.uid,
          actor.id,
          workspace.id,
          input.method,
          merchant(config),
          amount,
          input.yuan * rate,
          created,
          created + 1800,
          workspace.public_id,
          method.plugin,
          method.version,
          channel.config,
        ],
      );
      return { order: readOrder(row), fresh: true };
    });
    const { order } = prepared;
    if (!prepared.fresh) return publicOrder(order);
    const adapter = await this.orderMethod(order);
    let receipt: Awaited<ReturnType<typeof adapter.create>>;
    try {
      receipt = await adapter.create(
        order,
        await this.orderConfig(order),
        this.site,
      );
    } catch {
      const row = await one(
        this.p.db,
        `UPDATE original_recharge_orders SET state=CASE WHEN state='paid' THEN state ELSE 'unconfirmed' END
         WHERE id=$1 RETURNING *,$2::bigint AS workspace`,
        [order.id, order.workspace],
      );
      return publicOrder(readOrder(row));
    }
    const row = await one(
      this.p.db,
      `UPDATE original_recharge_orders SET checkout=$2,trade_id=COALESCE(trade_id,$3),expires=$4
       WHERE id=$1 RETURNING *,$5::bigint AS workspace`,
      [
        order.id,
        receipt.checkout,
        receipt.tradeId ?? null,
        receipt.expires ?? order.expires,
        order.workspace,
      ],
    );
    return publicOrder(readOrder(row));
  }

  private async lock(sql: Sql, key: string) {
    await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "original-recharge:" + key,
    ]);
  }

  async detail(actor: OriginalActor, id: string) {
    await this.ownedOrder(actor, id);
    let warning = "";
    try {
      await this.reconcile(id);
    } catch {
      warning = "暂时无法查询支付结果，请稍后刷新；已付款请勿重复支付";
    }
    return { ...publicOrder(await this.ownedOrder(actor, id)), warning };
  }

  async checkout(actor: OriginalActor, id: string) {
    const order = await this.ownedOrder(actor, id);
    requireValue(
      publicOrder(order).can_pay,
      409,
      "订单已支付、已过期或仍在确认中，请返回积分页面查询",
    );
    const channel = await one(
      this.p.db,
      "SELECT config FROM payment_channels WHERE method=$1 AND plugin_id=$2 AND enabled",
      [order.method, order.plugin_id],
    );
    const current = channel && this.decodeConfig(channel);
    requireValue(
      current && merchant(current) === order.merchant,
      503,
      "此订单的支付通道暂不可用，请联系管理员",
    );
    return order.checkout;
  }

  async notify(method: string, values: PaymentValues) {
    const ids = Object.values(values).filter(
      (v): v is string => typeof v === "string" && originalOrderId.test(v),
    );
    const { rows } = await this.p.db.query(
      "SELECT * FROM original_recharge_orders WHERE id=ANY($1::text[]) AND method=$2",
      [ids, method],
    );
    const row = rows.length === 1 && rows[0];
    if (!row) throw new Error("Unknown payment order");
    const order = readOrder(row);
    const config = await this.orderConfig(order);
    const adapter = await this.orderMethod(order);
    const expected = await adapter.callback(order, config, values);
    if (order.state !== "paid" || order.trade_id !== expected) {
      const trade = await adapter.verify(order, config, expected);
      if (!trade) throw new Error("Payment not confirmed");
      await this.settle(order.id, trade, adapter.label);
    }
    return adapter.acknowledgement;
  }

  private async reconcile(id: string) {
    const timestamp = now();
    const row = await one(
      this.p.db,
      `UPDATE original_recharge_orders SET checked=$2
       WHERE id=$1 AND state<>'paid' AND checked<=$2::bigint-10 RETURNING *`,
      [id, timestamp],
    );
    if (!row) return;
    const order = readOrder(row);
    const adapter = await this.orderMethod(order);
    const trade = await adapter.verify(order, await this.orderConfig(order));
    if (trade) await this.settle(order.id, trade, adapter.label);
  }

  private async settle(id: string, trade: string, label: string) {
    await this.p.db.transaction(async (sql) => {
      const row = await one(
        sql,
        "SELECT * FROM original_recharge_orders WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (!row || (row.trade_id && row.trade_id !== trade))
        throw new DomainError(409, "网关订单不一致");
      if (row.state === "paid") return;
      const order = readOrder(row);
      // The unique (method, trade_id) reservation and the wallet/ledger change
      // share this transaction. A failed credit also releases the reservation.
      await sql.query(
        "UPDATE original_recharge_orders SET state='paid',trade_id=$2,paid=$3 WHERE id=$1",
        [id, trade, now()],
      );
      await this.p.credit(
        sql,
        order.workspace_id,
        order.credits,
        "payment:" + id,
        "recharge",
        {
          actorId: order.owner_id,
          uid: "recharge:" + id,
          note: `${label} ¥${(order.amount / 100).toFixed(2)} · ${id}`,
        },
      );
    });
  }
}
