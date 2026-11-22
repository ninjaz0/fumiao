export default {
  async create({ order, merchant, urls }, host) {
    const fields = {
      pid: merchant.pid,
      type: "alipay",
      out_trade_no: order.id,
      name: urls.name,
      money: order.money,
      notify_url: urls.notify,
      return_url: urls.return,
    };
    if (merchant.cid) fields.cid = merchant.cid;
    return { checkout: await host.payment.checkout("/submit.php", fields) };
  },
  async verify({ order, merchant, expected }, host) {
    const result = await host.payment.query("/api.php", {
      act: "order",
      pid: merchant.pid,
      out_trade_no: order.id,
    });
    const v = result.values;
    if (
      !result.status.code ||
      !result.status.status ||
      v.code !== "1" ||
      v.status !== "1"
    )
      return null;
    const trade = String(v.trade_no ?? "");
    if (
      !result.status.pid ||
      v.pid !== merchant.pid ||
      v.out_trade_no !== order.id ||
      v.type !== "alipay" ||
      result.fen.money !== order.amount ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(trade) ||
      (expected && trade !== expected)
    )
      throw Error("Invalid payment confirmation");
    return trade;
  },
  callback({ order, merchant, document: { values: v, status, fen, numeric } }) {
    if (
      !status.pid ||
      v.pid !== merchant.pid ||
      v.out_trade_no !== order.id ||
      fen.money !== order.amount ||
      v.trade_status !== "TRADE_SUCCESS" ||
      v.type !== "alipay"
    )
      throw Error("Invalid callback");
    if (numeric.trade_no != null) throw Error("Invalid trade");
    return v.trade_no;
  },
};
