import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
export const paymentConfig = z.object({
  gateway: z.url().refine((s) => new URL(s).protocol === "https:"),
  pid: z.string().min(1),
  key: z.string().min(1),
  cid: z.string().optional(),
});
export type PaymentConfig = z.infer<typeof paymentConfig>;
export type PaymentOrder = {
  id: string;
  method: string;
  amount: number;
  credits: number;
  trade_id?: string | null;
};
function signedScalar(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number")
    throw new Error("Invalid signed value");
  return String(value);
}
export function sign(
  values: Record<string, unknown>,
  key: string,
  epusdt = false,
  scalar = signedScalar,
  compareKeys?: (left: string, right: string) => number,
) {
  const excluded = epusdt ? ["signature"] : ["sign", "sign_type"];
  const text = Object.keys(values)
    .sort(compareKeys)
    .filter(
      (k) => !excluded.includes(k) && values[k] !== "" && values[k] != null,
    )
    .map((k) => k + "=" + scalar(values[k]))
    .join("&");
  return epusdt
    ? createHmac("sha256", key).update(text).digest("hex")
    : createHash("md5")
        .update(text + key)
        .digest("hex");
}
export function fen(value: unknown) {
  const text = String(value);
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error("Invalid amount");
  const [integer, fraction = ""] = text.split(".");
  const result = Number(integer) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result) || result <= 0)
    throw new Error("Invalid amount");
  return result;
}
const money = (o: PaymentOrder) => (o.amount / 100).toFixed(2);
const trade = (value: unknown) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export async function gatewayBytes(
  url: string,
  body?: URLSearchParams | string,
  original = false,
) {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    body,
    headers: {
      Accept: "*/*",
      ...(original ? { "User-Agent": "Fumiao-Payments/1.0" } : {}),
      ...(original && body
        ? { "Content-Type": "application/x-www-form-urlencoded" }
        : {}),
    },
    redirect: "error",
    signal: AbortSignal.timeout(original ? 4000 : 10000),
  });
  if (!response.ok || !response.body) throw new Error("Gateway unavailable");
  let size = 0;
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.body as any) {
    size += chunk.length;
    if (size > 131072) throw new Error("Gateway response too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function gateway(url: string, body?: Record<string, string>) {
  return JSON.parse(
    (
      await gatewayBytes(url, body ? new URLSearchParams(body) : undefined)
    ).toString(),
  );
}
export interface PaymentAdapter {
  create(
    order: PaymentOrder,
    config: PaymentConfig,
    publicUrl: string,
  ): Promise<{ checkout: string; tradeId?: string }>;
  verify(
    order: PaymentOrder,
    config: PaymentConfig,
    expected?: string,
  ): Promise<string | null>;
  callback(
    order: PaymentOrder,
    config: PaymentConfig,
    values: Record<string, unknown>,
  ): string;
}
function callback(
  o: PaymentOrder,
  c: PaymentConfig,
  v: Record<string, unknown>,
  epusdt: boolean,
) {
  const expected = Buffer.from(sign(v, c.key, epusdt));
  const actual = Buffer.from(
    String(v[epusdt ? "signature" : "sign"] || "").toLowerCase(),
  );
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new Error("Invalid signature");
  if (
    String(v.pid) !== c.pid ||
    String(v[epusdt ? "order_id" : "out_trade_no"]) !== o.id ||
    fen(v[epusdt ? "amount" : "money"]) !== o.amount
  )
    throw new Error("Order mismatch");
  if (
    epusdt
      ? String(v.status) !== "2" || String(v.token).toLowerCase() !== "usdt"
      : v.trade_status !== "TRADE_SUCCESS" || v.type !== "alipay"
  )
    throw new Error("Not paid");
  const tid = v[epusdt ? "trade_id" : "trade_no"];
  if (!trade(tid)) throw new Error("Invalid trade");
  return tid as string;
}
export const zpay: PaymentAdapter = {
  async create(o, c, publicUrl) {
    const values: Record<string, string> = {
      pid: c.pid,
      type: "alipay",
      out_trade_no: o.id,
      name: `弗淼 ${o.credits} 积分`,
      money: money(o),
      notify_url: publicUrl + "/api/payments/notify/alipay",
      return_url: publicUrl,
    };
    if (c.cid) values.cid = c.cid;
    values.sign = sign(values, c.key);
    values.sign_type = "MD5";
    return {
      checkout:
        c.gateway.replace(/\/$/, "") +
        "/submit.php?" +
        new URLSearchParams(values),
    };
  },
  async verify(o, c, expected) {
    const v = await gateway(
      c.gateway.replace(/\/$/, "") +
        "/api.php?" +
        new URLSearchParams({
          act: "order",
          pid: c.pid,
          key: c.key,
          out_trade_no: o.id,
        }),
    );
    if (String(v.code) !== "1" || String(v.status) !== "1") return null;
    if (
      String(v.pid) !== c.pid ||
      v.out_trade_no !== o.id ||
      v.type !== "alipay" ||
      fen(v.money) !== o.amount ||
      !trade(v.trade_no) ||
      (expected && v.trade_no !== expected)
    )
      throw new Error("Order mismatch");
    return v.trade_no;
  },
  callback: (o, c, v) => callback(o, c, v, false),
};
export const epusdt: PaymentAdapter = {
  async create(o, c, publicUrl) {
    const values: Record<string, string> = {
      pid: c.pid,
      order_id: o.id,
      currency: "cny",
      token: "usdt",
      network: "plasma",
      amount: money(o),
      notify_url: publicUrl + "/api/payments/notify/usdt_plasma",
      redirect_url: publicUrl,
      name: `弗淼 ${o.credits} 积分`,
    };
    values.signature = sign(values, c.key, true);
    const response = await gateway(
        c.gateway.replace(/\/$/, "") +
          "/payments/gmpay/v1/order/create-transaction",
        values,
      ),
      v = response.data;
    if (
      String(response.status_code) !== "200" ||
      !v ||
      v.order_id !== o.id ||
      fen(v.amount) !== o.amount ||
      String(v.currency).toLowerCase() !== "cny" ||
      !trade(v.trade_id) ||
      new URL(v.payment_url).origin !== new URL(c.gateway).origin
    )
      throw new Error("Creation unconfirmed");
    return { checkout: v.payment_url, tradeId: v.trade_id };
  },
  async verify(o, c, expected) {
    const tid = o.trade_id || expected;
    if (!trade(tid)) return null;
    if (o.trade_id && expected && o.trade_id !== expected)
      throw new Error("Trade mismatch");
    const response = await gateway(
        c.gateway.replace(/\/$/, "") + "/pay/check-status/" + tid,
      ),
      v = response.data;
    if (
      String(response.status_code) !== "200" ||
      v?.trade_id !== tid ||
      v?.status !== 2
    )
      return null;
    return tid!;
  },
  callback: (o, c, v) => callback(o, c, v, true),
};
export const paymentAdapters: Record<string, PaymentAdapter> = {
  alipay: zpay,
  usdt_plasma: epusdt,
};
