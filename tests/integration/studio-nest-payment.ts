import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { Payments } from "@fumiao/platform/payments.js";
import type { Actor, Platform } from "@fumiao/platform/platform.js";
import { sign } from "@fumiao/platform/payment/wire.js";

export async function studioPayment(directory: string, web: string) {
  const key = join(directory, "payment-key.pem");
  const certificate = join(directory, "payment-cert.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
      "-out",
      certificate,
      "-keyout",
      key,
    ],
    { stdio: "ignore" },
  );
  const config = {
    gateway: "",
    pid: "314",
    key: randomBytes(24).toString("hex"),
  };
  let checkout: string | undefined;
  const verified: string[] = [];
  const errors: unknown[] = [];
  const trade = "studio-loopback-trade";
  const server = createServer(
    { key: await readFile(key), cert: await readFile(certificate) },
    (request, response) => {
      try {
        const { pathname, searchParams } = new URL(
          request.url!,
          config.gateway,
        );
        const id = searchParams.get("out_trade_no")!;
        assert.equal(request.method, "GET");
        assert.match(id, /^FM[0-9a-f]{26}$/);
        assert.equal(searchParams.get("pid"), config.pid);
        if (pathname === "/submit.php") {
          assert.equal(checkout, undefined);
          assert.equal(searchParams.get("money"), "1.00");
          assert.equal(searchParams.get("type"), "alipay");
          assert.equal(
            searchParams.get("notify_url"),
            web + "/api/recharge/notify/alipay",
          );
          const returnUrl = new URL(searchParams.get("return_url")!);
          assert.equal(returnUrl.href, web + "/payments/return");
          assert.equal(
            searchParams.get("sign"),
            sign(Object.fromEntries(searchParams), config.key),
          );
          checkout = id;
          returnUrl.searchParams.set("out_trade_no", id);
          response.writeHead(303, { location: returnUrl.href }).end();
        } else {
          assert.equal(pathname, "/api.php");
          assert.equal(searchParams.get("act"), "order");
          assert.equal(searchParams.get("key"), config.key);
          verified.push(id);
          response.setHeader("content-type", "application/json");
          response.end(
            JSON.stringify(
              id === checkout
                ? {
                    code: 1,
                    status: 1,
                    pid: config.pid,
                    out_trade_no: id,
                    type: "alipay",
                    trade_no: trade,
                    money: "1.00",
                  }
                : { code: 1, status: 0 },
            ),
          );
        }
      } catch (error) {
        errors.push(error);
        response.writeHead(500).end();
      }
    },
  ).listen(0, "127.0.0.1");
  await once(server, "listening");
  config.gateway =
    "https://127.0.0.1:" + (server.address() as AddressInfo).port;
  return {
    origin: config.gateway,
    certificate,
    configure: async (platform: Platform, actor: Actor) => {
      await platform.db.query("INSERT INTO studio_packages(id,version,enabled) VALUES('payments','1.0.0',true) ON CONFLICT DO NOTHING");
      return new Payments(platform).configure(actor, "alipay", {
        enabled: true,
        config,
      });
    },
    async verifyCallback(id: string, callbackOrigin = web) {
      assert.equal(checkout, id);
      assert.ok(
        verified.includes(id),
        "Nest checked the order with the gateway",
      );
      const fields = {
        pid: config.pid,
        out_trade_no: id,
        trade_no: trade,
        money: "1.00",
        trade_status: "TRADE_SUCCESS",
        type: "alipay",
      };
      const callback = new URL("/api/recharge/notify/alipay", callbackOrigin);
      callback.search = new URLSearchParams({
        ...fields,
        sign: sign(fields, config.key),
        sign_type: "MD5",
      }).toString();
      const response = await fetch(callback);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), "success");
      assert.deepEqual(errors, []);
    },
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}
