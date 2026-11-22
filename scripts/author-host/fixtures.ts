import type {
  HostFunction,
  ResolvedContributions,
} from "@fumiao/plugin-sdk/contributions.js";
import { hostFunctions } from "@fumiao/plugin-sdk/contributions.js";
import type { HostCall } from "@fumiao/platform/plugin-program.js";

export const mediaAsset = {
  id: "11111111111111111111111111111111",
  mime: "image/png",
  size: 256,
  width: 96,
  height: 54,
  seconds: 1,
};
export const job = {
  id: 1,
  kind: "image",
  state: "completed",
  requestId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
};
export const sampleOrder = { id: "order-1", amount: 100, money: "1.00" };
export const sampleMerchant = { pid: "demo" };
export const sampleTrade = "trade-1";
const paymentDocument = {
  values: {
    pid: "demo",
    out_trade_no: "order-1",
    order_id: "order-1",
    trade_no: sampleTrade,
    trade_id: sampleTrade,
    type: "alipay",
    trade_status: "TRADE_SUCCESS",
    status: "2",
    token: "usdt",
  },
  status: { pid: true, status: true },
  fen: { money: 100, amount: 100 },
  numeric: {},
};
export const paymentInput = {
  order: sampleOrder,
  merchant: sampleMerchant,
  expected: sampleTrade,
  document: paymentDocument,
  urls: {
    name: "测试订单",
    notify: "https://studio.example/notify",
    return: "https://studio.example/return",
    studio: true,
  },
};

export function fixtureHost(
  grants: ResolvedContributions,
  responses: Record<string, unknown> = {},
) {
  let data = new Map<string, unknown>();
  const calls: string[] = [];
  const scopedCall =
    (allowGlobal: boolean): HostCall =>
    async (name, args) => {
      calls.push(name);
      const [first, second, third] = args as any[];
      if (name.startsWith("data.")) {
        const scope =
          (name === "data.put" ? third : second)?.scope ?? "workspace";
        if (
          !["workspace", "global"].includes(scope) ||
          (scope === "global" && !allowGlobal)
        )
          throw Error("此入口不能访问请求的数据范围");
        if (
          name !== "data.list" &&
          (typeof first !== "string" ||
            !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(first))
        )
          throw Error("存储键无效");
        const key = scope + "/" + String(first ?? "");
        if (name === "data.get") return data.get(key) ?? null;
        if (name === "data.put") {
          data.set(key, structuredClone(second));
          return true;
        }
        if (name === "data.delete") return data.delete(key);
        const matches = [...data.keys()]
          .filter((k) => k.startsWith(key))
          .sort();
        return {
          keys: matches.slice(0, 200).map((k) => k.slice(scope.length + 1)),
          more: matches.length > 200,
        };
      }
      if (name.startsWith("http.")) {
        if (
          name !== "http.readStream" &&
          !grants.http?.origins.includes(new URL(first).origin)
        )
          throw Error("工作区未授权此服务源");
        if (!Object.hasOwn(responses, name))
          throw Error(
            "请在 fixtures.json 的 host 中提供 " + name + " 模拟响应",
          );
      }
      if (Object.hasOwn(responses, name))
        return structuredClone(responses[name]);
      if (name === "media.probe") return mediaAsset;
      if (name.startsWith("media."))
        return { ...mediaAsset, id: "22222222222222222222222222222222" };
      if (name === "payment.checkout") return "https://checkout.example/pay";
      if (name === "payment.post")
        return {
          values: {
            status_code: "200",
            data: {
              order_id: "order-1",
              trade_id: sampleTrade,
              currency: "cny",
              payment_url: "https://checkout.example/pay",
            },
          },
          status: { status_code: true },
          fen: { data: { amount: 100 } },
          numeric: {},
          expiry: { data: { expiration_time: 2000000000 } },
        };
      if (name === "payment.query")
        return {
          values: {
            code: "1",
            status: "1",
            pid: "demo",
            out_trade_no: "order-1",
            type: "alipay",
            trade_no: sampleTrade,
            status_code: "200",
            data: { trade_id: sampleTrade },
          },
          status: { code: true, status: true, status_code: true, pid: true },
          numeric: { data: { status: "2" } },
          fen: { money: 100 },
        };
      throw Error("没有此宿主函数的测试数据：" + name);
    };
  const allowed = (mode: "read" | "write") =>
    (Object.keys(hostFunctions) as HostFunction[]).filter(
      (n) =>
        grants.hostCapabilities.includes(hostFunctions[n].capability) &&
        (mode === "write" || hostFunctions[n].access === "read"),
    );
  // Interactive requests share the fixture workspace. Publish successful writes
  // in call order and discard a failed hook's staged data and diagnostics.
  let pending: Promise<unknown> = Promise.resolve();
  function transaction(run: () => Promise<unknown>) {
    const work = pending.then(async () => {
      const previous = data;
      data = new Map(previous);
      calls.length = 0;
      try {
        return { result: await run(), calls: [...calls] };
      } catch (error) {
        data = previous;
        throw error;
      }
    });
    pending = work.catch(() => {});
    return work;
  }
  return {
    call: scopedCall(false),
    adminCall: scopedCall(true),
    allowed,
    transaction,
  };
}
