import { timingSafeEqual } from "node:crypto";
import {
  gatewayBytes,
  sign,
  type PaymentConfig,
  type PaymentOrder,
} from "./index.js";
import {
  originalFen,
  paymentExpiry,
  paymentJson,
  paymentObject,
  paymentScalar,
  paymentStatus,
  paymentStatusNumber,
  type PaymentValues,
} from "./original-values.js";

const tradeId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}(?![\s\S])/.test(value);

export const paymentMoney = (order: PaymentOrder) =>
  (order.amount / 100).toFixed(2);
const quoteForm = (values: Record<string, string>) =>
  new URLSearchParams(values)
    .toString()
    .replace(/%7E/g, "~")
    .replace(/\*/g, "%2A");

async function gateway(url: string, values?: Record<string, string>) {
  return paymentJson(
    await gatewayBytes(url, values && quoteForm(values), true),
  );
}

export interface OriginalPaymentAdapter {
  label: string;
  orderField: string;
  acknowledgement: string;
  create(
    order: PaymentOrder,
    config: PaymentConfig,
    site: string,
  ): Promise<{
    checkout: string;
    tradeId?: string;
    expires?: number;
  }>;
  verify(
    order: PaymentOrder,
    config: PaymentConfig,
    expected?: string,
  ): Promise<string | null>;
  callback(
    order: PaymentOrder,
    config: PaymentConfig,
    values: PaymentValues,
  ): string;
}

function callback(
  order: PaymentOrder,
  config: PaymentConfig,
  values: PaymentValues,
  epusdt: boolean,
) {
  const actual = values[epusdt ? "signature" : "sign"];
  const expected = sign(
    values,
    config.key,
    epusdt,
    paymentScalar,
    (left, right) =>
      Buffer.compare(
        Buffer.from(paymentScalar(left)),
        Buffer.from(paymentScalar(right)),
      ),
  );
  if (
    typeof actual !== "string" ||
    !/^[a-fA-F0-9]+(?![\s\S])/.test(actual) ||
    actual.length !== expected.length ||
    !timingSafeEqual(Buffer.from(actual.toLowerCase()), Buffer.from(expected))
  )
    throw new Error("Invalid signature");
  if (
    !paymentStatus(values.pid, config.pid) ||
    originalFen(values[epusdt ? "amount" : "money"]) !== order.amount
  )
    throw new Error("Order mismatch");
  if (
    epusdt
      ? !paymentStatus(values.status, "2") ||
        typeof values.token !== "string" ||
        values.token.toLowerCase() !== "usdt"
      : values.trade_status !== "TRADE_SUCCESS" || values.type !== "alipay"
  )
    throw new Error("Not paid");
  const trade = values[epusdt ? "trade_id" : "trade_no"];
  if (!tradeId(trade)) throw new Error("Invalid trade");
  return trade;
}

const alipay: OriginalPaymentAdapter = {
  label: "支付宝",
  orderField: "out_trade_no",
  acknowledgement: "success",
  async create(order, config, site) {
    const values: Record<string, string> = {
      pid: config.pid,
      type: "alipay",
      out_trade_no: order.id,
      name: `弗淼AIGC ${order.credits}积分`,
      money: paymentMoney(order),
      notify_url: site + "/api/recharge/notify/alipay",
      return_url: site + "/payments/return",
    };
    if (config.cid) values.cid = config.cid;
    values.sign = sign(values, config.key);
    values.sign_type = "MD5";
    return { checkout: config.gateway + "/submit.php?" + quoteForm(values) };
  },
  async verify(order, config, expected) {
    const result = await gateway(
      config.gateway +
        "/api.php?" +
        quoteForm({
          act: "order",
          pid: config.pid,
          key: config.key,
          out_trade_no: order.id,
        }),
    );
    if (!paymentStatus(result.code, "1") || !paymentStatus(result.status, "1"))
      return null;
    const trade = String(result.trade_no ?? "");
    if (
      !paymentStatus(result.pid, config.pid) ||
      result.out_trade_no !== order.id ||
      result.type !== "alipay" ||
      originalFen(result.money) !== order.amount ||
      !tradeId(trade) ||
      (expected && expected !== trade)
    )
      throw new Error("Invalid order verification");
    return trade;
  },
  callback: (order, config, values) => callback(order, config, values, false),
};
const authority = (value: string) => /^https:\/\/([^/?#]+)/i.exec(value)?.[1];

const epusdt: OriginalPaymentAdapter = {
  label: "USDT-Plasma",
  orderField: "order_id",
  acknowledgement: "ok",
  async create(order, config, site) {
    const values: Record<string, string> = {
      pid: config.pid,
      order_id: order.id,
      currency: "cny",
      token: "usdt",
      network: "plasma",
      amount: paymentMoney(order),
      notify_url: site + "/api/recharge/notify/usdt_plasma",
      redirect_url: site + "/payments/return?order=" + order.id,
      name: `弗淼AIGC ${order.credits}积分`,
    };
    values.signature = sign(values, config.key, true);
    const result = await gateway(
      config.gateway + "/payments/gmpay/v1/order/create-transaction",
      values,
    );
    const data = paymentObject(result.data);
    if (
      !paymentStatus(result.status_code, "200") ||
      data.order_id !== order.id ||
      originalFen(data.amount) !== order.amount ||
      typeof data.currency !== "string" ||
      data.currency.toLowerCase() !== "cny" ||
      !tradeId(data.trade_id) ||
      typeof data.payment_url !== "string" ||
      !authority(data.payment_url) ||
      authority(data.payment_url) !== authority(config.gateway)
    )
      throw new Error("Invalid creation response");
    return {
      checkout: data.payment_url,
      tradeId: data.trade_id,
      expires: paymentExpiry(data.expiration_time),
    };
  },
  async verify(order, config, expected) {
    const trade = order.trade_id || expected;
    if (!tradeId(trade)) return null;
    if (order.trade_id && expected && order.trade_id !== expected)
      throw new Error("Gateway trade mismatch");
    const result = await gateway(config.gateway + "/pay/check-status/" + trade);
    const data = paymentObject(result.data || {});
    if (
      !paymentStatus(result.status_code, "200") ||
      data.trade_id !== trade ||
      !paymentStatusNumber(data.status, "2")
    )
      return null;
    return trade;
  },
  callback: (order, config, values) => callback(order, config, values, true),
};

export const originalPaymentAdapters = new Map<string, OriginalPaymentAdapter>([
  ["alipay", alipay],
  ["usdt_plasma", epusdt],
]);
