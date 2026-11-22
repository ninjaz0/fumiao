export default {
  async create({ order, merchant, urls }, host) {
    const result = await host.payment.post(
      "/payments/gmpay/v1/order/create-transaction",
      {
        pid: merchant.pid,
        order_id: order.id,
        currency: "cny",
        token: "usdt",
        network: "plasma",
        amount: order.money,
        notify_url: urls.notify,
        redirect_url: urls.studio
          ? urls.return + "?order=" + order.id
          : urls.return,
        name: urls.name,
      },
    );
    const v = result.values.data;
    if (
      !result.status.status_code ||
      result.values.status_code !== "200" ||
      !v ||
      v.order_id !== order.id ||
      result.fen.data?.amount !== order.amount ||
      typeof v.currency !== "string" ||
      v.currency.toLowerCase() !== "cny"
    )
      throw Error("Invalid creation response");
    if (
      result.numeric.data?.trade_id != null ||
      result.expiry.data?.expiration_time == null
    )
      throw Error("Invalid receipt");
    return {
      checkout: v.payment_url,
      tradeId: v.trade_id,
      expires: result.expiry.data?.expiration_time,
    };
  },
  async verify({ order, expected }, host) {
    const trade = order.trade_id || expected;
    if (typeof trade !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(trade))
      return null;
    if (expected && order.trade_id && order.trade_id !== expected)
      throw Error("Trade mismatch");
    const result = await host.payment.query("/pay/check-status/" + trade, {});
    if (
      !result.status.status_code ||
      result.values.status_code !== "200" ||
      result.values.data?.trade_id !== trade ||
      result.numeric.data?.status !== "2"
    )
      return null;
    return trade;
  },
  callback({ order, merchant, document: { values: v, fen, status, numeric } }) {
    if (
      !status.pid ||
      v.pid !== merchant.pid ||
      v.order_id !== order.id ||
      fen.amount !== order.amount ||
      !status.status ||
      v.status !== "2" ||
      typeof v.token !== "string" ||
      v.token.toLowerCase() !== "usdt"
    )
      throw Error("Invalid callback");
    if (numeric.trade_id != null) throw Error("Invalid trade");
    return v.trade_id;
  },
};
