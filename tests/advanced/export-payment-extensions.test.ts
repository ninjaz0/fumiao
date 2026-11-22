import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { databaseFixture } from "../helpers/database.js";
import { planComposition } from "@fumiao/platform/composition/exporters.js";
import {
  paymentMethods,
  paymentProvider,
} from "@fumiao/platform/payment/methods.js";
import { paymentJson } from "@fumiao/platform/payment/values.js";
import { sign } from "@fumiao/platform/payment/wire.js";
import { parsePackageFile } from "@fumiao/platform/studio-packages.js";
import { one } from "@fumiao/platform/db.js";

import { randomUUID } from "node:crypto";
import { canvasesFixture } from "../helpers/canvases.js";
import { OriginalRecharge } from "@fumiao/original-api/recharge.js";
import { StudioPackages } from "@fumiao/platform/studio-packages.js";
import { Payments } from "@fumiao/platform/payments.js";

test("release archives match distributable files and fresh installations have no active payment methods", async () => {
  const f = await databaseFixture();
  try {
    for (const id of ["payments", "storyboard"]) {
      const file = parsePackageFile(
        JSON.parse(
          await readFile("plugins/" + id + "/" + id + ".fmplugin.json", "utf8"),
        ),
      );
      assert.deepEqual(
        (
          await one(
            f.db,
            "SELECT package FROM studio_package_releases WHERE id=$1 AND version=$2",
            [id, file.version],
          )
        ).package,
        file,
      );
    }
    assert.deepEqual(await paymentMethods(f.db), []);
  } finally {
    await f.cleanup();
  }
});
test("an exporter rearranges only admitted shots and cannot provide media paths", async () => {
  const shots = [
    {
      node: "a",
      video: "approved",
      title: "shot",
      voice: "voice",
      text: "caption",
    },
  ];
  assert.deepEqual(
    await planComposition(
      "({plan:()=>[{index:0,narration:false,subtitles:true}]})",
      shots,
    ),
    [{ ...shots[0], voice: null, text: "" }],
  );
  for (const plan of [
    [{ index: 1, narration: true, subtitles: true }],
    [{ index: 0, video: "other", narration: true, subtitles: true }],
  ]) {
    await assert.rejects(
      planComposition("({plan:()=>" + JSON.stringify(plan) + "})", shots),
    );
  }
});
test("a disabled payment release verifies signed notifications and requires matching paid gateway evidence", async () => {
  const f = await databaseFixture();
  const fetchBefore = globalThis.fetch;
  try {
    const pin = { plugin: "payments", version: "1.0.0" };
    await f.db.query(
      "INSERT INTO studio_packages(id,version,enabled) VALUES('payments','1.0.0',true)",
    );
    assert.equal((await paymentMethods(f.db)).length, 2);
    await f.db.query(
      "UPDATE studio_packages SET enabled=false WHERE id='payments'",
    );
    assert.deepEqual(await paymentMethods(f.db), []);
    const method = (await paymentMethods(f.db, pin)).find(
      (m) => m.id === "usdt_plasma",
    )!;
    const adapter = paymentProvider(method);
    const order = {
      id: "FM123",
      method: method.id,
      amount: 500,
      credits: 50,
      trade_id: "T1",
    };
    const config = {
      gateway: "https://checkout.example",
      pid: "one",
      key: "test-key",
    };
    const values = {
      order_id: order.id,
      pid: "one",
      amount: "5.00",
      status: "2",
      token: "usdt",
      trade_id: "T1",
    };
    assert.equal(
      await adapter.callback(order, config, {
        ...values,
        signature: sign(values, config.key, true),
      }),
      "T1",
    );
    await assert.rejects(
      adapter.callback(order, config, { ...values, signature: "invalid" }),
    );
    let status = 2;
    globalThis.fetch = async (url) => {
      assert.equal(String(url), "https://checkout.example/pay/check-status/T1");
      return new Response(
        JSON.stringify({ status_code: 200, data: { status, trade_id: "T1" } }),
      );
    };
    assert.equal(await adapter.verify(order, config), "T1");
    status = 1;
    assert.equal(await adapter.verify(order, config), null);
    const dishonest = paymentProvider({
      ...method,
      program:
        '({async verify(_,host){await host.payment.query("/pay/check-status/T1",{});return "T1"}})',
    });
    await assert.rejects(dishonest.verify(order, config));
    const raw = paymentJson(Buffer.from('{"amount":5.000,"status":2}'));
    assert.throws(() =>
      paymentJson(Buffer.from('{"amount":5,"amount":0}'), true),
    );
    assert.equal(String(raw.amount), "5.000");
  } finally {
    globalThis.fetch = fetchBefore;
    await f.cleanup();
  }
});

test("a merchant rotation and plugin removal preserve the accepted order and concurrent callbacks settle once", async () => {
  const f = await canvasesFixture(),
    before = globalThis.fetch;
  const packages = new StudioPackages(f.p),
    channels = new Payments(f.p);
  try {
    const file = JSON.parse(
      await readFile("plugins/payments/payments.fmplugin.json", "utf8"),
    );
    await packages.install(f.admin, file);
    const plugin = () =>
      one(f.db, "SELECT revision FROM studio_packages WHERE id='payments'");
    await packages.change(
      f.admin,
      "payments",
      (await plugin()).revision,
      "enable",
    );
    const config = {
      gateway: "https://merchant.example",
      pid: "original",
      key: "synthetic-merchant-secret",
    };
    const configure = (key: string, revision: number) => ({
      plugin: "payments",
      revision,
      config: { ...config, key },
      enabled: true,
    });
    const revision = (await plugin()).revision;
    await assert.rejects(
      channels.configure(f.member, "alipay", configure(config.key, revision)),
    );
    await channels.configure(
      f.admin,
      "alipay",
      configure(config.key, revision),
    );
    await assert.rejects(
      channels.configure(f.admin, "alipay", configure(config.key, revision)),
    );
    assert.ok(
      !JSON.stringify(await packages.list(f.admin)).includes(config.key),
    );
    const recharge = new OriginalRecharge(f.identity, "https://studio.example");
    const request = {
      yuan: 2,
      workspace: Number(f.memberSpace.public_id),
      method: "alipay",
      uid: randomUUID(),
    };
    const order = await recharge.create(f.member, request);
    assert.equal(order.state, "pending");
    await channels.configure(
      f.admin,
      "alipay",
      configure("synthetic-replacement", (await plugin()).revision),
    );
    await packages.change(
      f.admin,
      "payments",
      (await plugin()).revision,
      "remove",
    );
    assert.equal((await recharge.create(f.member, request)).id, order.id);
    await assert.rejects(
      recharge.create(f.member, { ...request, uid: randomUUID() }),
    );
    const fields = {
      pid: config.pid,
      out_trade_no: order.id,
      money: "2.00",
      type: "alipay",
      trade_status: "TRADE_SUCCESS",
      trade_no: "txn-42",
    };
    const callback = { ...fields, sign: sign(fields, config.key) };
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.get("key"), config.key);
      assert.equal(url.searchParams.get("out_trade_no"), order.id);
      return new Response(JSON.stringify({ ...fields, code: 1, status: 1 }));
    };
    await Promise.all([
      recharge.notify("alipay", callback),
      recharge.notify("alipay", callback),
    ]);
    const history = await recharge.list(
      f.member,
      String(f.memberSpace.public_id),
      undefined,
    );
    assert.equal(history.orders[0].state, "paid");
    assert.equal(history.orders[0].method_label, "支付宝");
    assert.deepEqual(history.methods, []);
    assert.equal(
      (
        await one(
          f.db,
          "SELECT count(*)::int AS count FROM ledger WHERE action='recharge' AND workspace_id=$1",
          [f.memberSpace.id],
        )
      ).count,
      1,
    );
  } finally {
    globalThis.fetch = before;
    await f.cleanup();
  }
});
