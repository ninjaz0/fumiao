import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  packageContributions,
  type Contributes,
} from "@fumiao/plugin-sdk/contributions.js";
import type { Sql } from "../db.js";
import { runProgram } from "../plugin-program.js";
import { requireValue } from "../security.js";
import {
  gatewayBytes,
  sign,
  type PaymentOrder,
  type PaymentConfig,
} from "./wire.js";
import {
  originalFen,
  paymentStatus,
  paymentStatusNumber,
  gatewayDocument,
  paymentJson,
  paymentScalar,
  type PaymentValues,
} from "./values.js";

type Declaration = NonNullable<Contributes["paymentMethods"]>[number];
export type Method = Declaration & { plugin: string; version: string };
const trade = z.string().regex(/^[A-Za-z0-9_-]{1,128}(?![\s\S])/);
const receipt = z
  .object({
    checkout: z.string().max(16384),
    tradeId: trade.optional(),
    expires: z.number().int().safe().positive().optional(),
  })
  .strict();

export async function paymentMethods(
  sql: Sql,
  pin?: { plugin: string; version: string },
) {
  const { rows } = await sql.query(
    pin
      ? "SELECT id,version,package->'contributes' AS contributes FROM studio_package_releases WHERE id=$1 AND version=$2"
      : `SELECT p.id,p.version,r.package->'contributes' AS contributes FROM studio_packages p
       JOIN studio_package_releases r USING(id,version) WHERE p.installed AND p.enabled AND NOT p.removing
       AND r.package->'contributes' ? 'paymentMethods' ORDER BY p.id FOR SHARE OF p`,
    pin ? [pin.plugin, pin.version] : [],
  );
  return rows.flatMap((row) =>
    (packageContributions(row).paymentMethods ?? []).map((d) => ({
      ...d,
      plugin: String(row.id),
      version: String(row.version),
    })),
  );
}

function field(value: unknown, path: string) {
  for (const key of path.split(".")) {
    if (!value || typeof value !== "object" || !Object.hasOwn(value, key))
      return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

export function paymentProvider(method: Method, studio = true) {
  const hmac = method.signature === "hmac-sha256";
  const signFields = (fields: PaymentValues, key: string, strict = true) =>
    sign(fields, key, hmac, strict ? paymentScalar : undefined, (a, b) =>
      Buffer.compare(Buffer.from(a), Buffer.from(b)),
    );
  const envelope = (order: PaymentOrder, config: PaymentConfig) => ({
    order: {
      id: order.id,
      amount: Number(order.amount),
      credits: Number(order.credits),
      trade_id: order.trade_id,
      money: (order.amount / 100).toFixed(2),
    },
    merchant: { pid: config.pid, cid: config.cid },
  });
  async function invoke(
    hook: "create" | "verify",
    order: PaymentOrder,
    config: PaymentConfig,
    extra: Record<string, unknown>,
  ) {
    let confirmed: string | undefined,
      calls = 0;
    const endpoint = config.gateway.replace(/\/$/, "");
    const grant =
      hook === "create"
        ? ["payment.checkout", "payment.post"]
        : ["payment.query"];
    const result = await runProgram(
      method.program,
      hook,
      [{ ...envelope(order, config), ...extra }],
      grant,
      async (name, args) => {
        requireValue(++calls === 1, 400, "每次支付操作只能访问一次网关");
        const [path, fields] = z
          .tuple([
            z.string().max(256),
            z.record(z.string().max(64), z.string().max(4096)),
          ])
          .parse(args);
        const query = name === "payment.query",
          post = name === "payment.post";
        const expected = query
          ? method.queryPath
          : post
            ? method.createPath
            : method.checkoutPath;
        const id = order.trade_id || extra.expected;
        const resolved = expected?.includes("{trade}")
          ? trade.safeParse(id).success
            ? expected.replace("{trade}", String(id))
            : undefined
          : expected;
        requireValue(path === resolved, 400, "支付网关路径未授权");
        const url = endpoint + path;
        if (query && method.queryKey) fields[method.queryKey] = config.key;
        if (!query) {
          fields[hmac ? "signature" : "sign"] = signFields(fields, config.key);
          if (!hmac) fields.sign_type = "MD5";
        }
        const form = new URLSearchParams(fields)
          .toString()
          .replace(/%7E/g, "~")
          .replace(/\*/g, "%2A");
        if (!query && !post) return url + "?" + form;
        const bytes = await gatewayBytes(
          url + (query && form ? "?" + form : ""),
          post ? form : undefined,
          true,
        );
        const raw = paymentJson(bytes);
        if (query) {
          const proof = method.confirmation;
          if (
            paymentStatus(field(raw, proof.status), proof.paid) ||
            paymentStatusNumber(field(raw, proof.status), proof.paid)
          ) {
            const gatewayTrade = String(field(raw, proof.trade) ?? "");
            if (
              trade.safeParse(gatewayTrade).success &&
              (proof.order
                ? field(raw, proof.order) === order.id
                : gatewayTrade === id) &&
              (proof.amount
                ? originalFen(field(raw, proof.amount)) === order.amount
                : gatewayTrade === id) &&
              (!proof.merchant ||
                paymentStatus(field(raw, proof.merchant), config.pid))
            )
              confirmed = gatewayTrade;
          }
        }
        return gatewayDocument(raw);
      },
    );
    requireValue(
      hook !== "verify" ||
        result === null ||
        (confirmed !== undefined && result === confirmed),
      400,
      "未向收款网关核实订单",
    );
    return result;
  }
  return {
    ...method,
    label: method.title,
    async create(order: PaymentOrder, config: PaymentConfig, site: string) {
      const notify =
        site +
        (studio ? "/api/recharge/notify/" : "/api/payments/notify/") +
        order.method;
      const back = studio ? site + "/payments/return" : site;
      const output = receipt.parse(
        await invoke("create", order, config, {
          urls: {
            notify,
            return: back,
            name: studio
              ? `弗淼AIGC ${order.credits}积分`
              : `弗淼 ${order.credits} 积分`,
            studio,
          },
        }),
      );
      const checkout = new URL(output.checkout);
      requireValue(
        checkout.origin === new URL(config.gateway).origin &&
          !checkout.username &&
          !checkout.password,
        400,
        "收银台地址无效",
      );
      return output;
    },
    async verify(
      order: PaymentOrder,
      config: PaymentConfig,
      expected?: string,
    ) {
      const result = trade
        .nullable()
        .parse(await invoke("verify", order, config, { expected }));
      requireValue(
        !result ||
          ((!expected || result === expected) &&
            (!order.trade_id || result === order.trade_id)),
        400,
        "网关订单不一致",
      );
      return result;
    },
    async callback(
      order: PaymentOrder,
      config: PaymentConfig,
      values: PaymentValues,
    ) {
      const actual = values[hmac ? "signature" : "sign"],
        expected = signFields(values, config.key, studio);
      requireValue(
        typeof actual === "string" &&
          actual.length === expected.length &&
          /^[a-fA-F0-9]+$/.test(actual) &&
          timingSafeEqual(
            Buffer.from(actual.toLowerCase()),
            Buffer.from(expected),
          ) &&
          values[method.orderField] === order.id,
        400,
        "回调签名或订单编号无效",
      );
      // The retired UUID-order API passed JSON numbers directly. Preserve their
      // signed spelling above, then validate them with the same typed wire parser.
      const document = studio
        ? values
        : paymentJson(Buffer.from(JSON.stringify(values)));
      requireValue(
        paymentStatus(document[method.callbackMerchant], config.pid) &&
          originalFen(document[method.callbackAmount]) === order.amount,
        400,
        "回调商户或金额不匹配",
      );
      const signedTrade = trade.parse(values[method.callbackTrade]);
      const result = await runProgram(method.program, "callback", [
        { ...envelope(order, config), document: gatewayDocument(document) },
      ]);
      requireValue(result === signedTrade, 400, "回调交易号不匹配");
      return signedTrade;
    },
  };
}
