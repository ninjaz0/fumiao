import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { expect, firefox, type Page } from "@playwright/test";
import sharp from "sharp";
import type { chatProviderFixture } from "../tests/helpers/chat-provider.js";
import { assertStudio, request } from "./studio-settings-browser.js";

const host = "127.0.0.1";
const browserHost = "localhost";
const timeout = 10_000;
const sourceRejected = { detail: "来源无效" };
const run = promisify(execFile);
const cookieName = "fm_session";

async function testCertificate(directory: string) {
  await writeFile(
    join(directory, "ca.cnf"),
    "[req]\ndistinguished_name=dn\n[dn]\n[ca]\nbasicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n",
  );
  await writeFile(
    join(directory, "leaf.ext"),
    "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:" +
      browserHost +
      "\n",
  );
  const openssl = (args: string[]) => run("openssl", args, { cwd: directory });
  await openssl([
    "req",
    "-new",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=Studio HTTPS test CA",
    "-config",
    "ca.cnf",
    "-extensions",
    "ca",
    "-keyout",
    "ca.key",
    "-out",
    "ca.pem",
  ]);
  await openssl([
    "req",
    "-new",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-subj",
    "/CN=" + browserHost,
    "-keyout",
    "leaf.key",
    "-out",
    "leaf.csr",
  ]);
  await openssl([
    "x509",
    "-req",
    "-in",
    "leaf.csr",
    "-CA",
    "ca.pem",
    "-CAkey",
    "ca.key",
    "-set_serial",
    "2",
    "-days",
    "1",
    "-extfile",
    "leaf.ext",
    "-out",
    "leaf.pem",
  ]);
  return {
    key: await readFile(join(directory, "leaf.key")),
    cert: await readFile(join(directory, "leaf.pem")),
  };
}

async function listen(server: Server) {
  server.listen(0, host);
  await once(server, "listening");
  return `https://${browserHost}:${(server.address() as AddressInfo).port}`;
}

async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
}

type Credentials = { name: string; password: string };
type Snapshot = { messages: { state: string; content: string }[] };

async function login(
  page: Page,
  origin: string,
  user: Credentials,
  status: number,
) {
  assert.equal((await page.goto(origin + "/studio"))?.status(), 200);
  await expect(page.locator(".auth-form")).toBeVisible();
  await assertStudio(page, true);
  await page.locator('[name="user"]').fill(user.name);
  await page.locator('[name="pw"]').fill(user.password);
  const response = await request(page, "/api/login", "POST", () =>
    page.locator('.auth-form [type="submit"]').click(),
  );
  assert.equal(response.status(), status, await response.text());
  assert.equal((await response.request().allHeaders()).origin, origin);
  if (status === 200) {
    await expect(page.locator(".shell")).toBeVisible();
    assert.equal(page.url(), origin + "/studio");
    await assertStudio(page, true);
  }
  return response;
}

async function browserJSON(
  page: Page,
  path: string,
  status: number,
  payload?: object,
) {
  const result = await page.evaluate(
    async ({ path, payload }) => {
      const response = await fetch(path, {
        ...(payload && {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      return {
        status: response.status,
        gateway: response.headers.get("x-fumiao-web"),
        body: await response.json(),
      };
    },
    { path, payload },
  );
  assert.equal(result.gateway, "next", path);
  assert.equal(
    result.status,
    status,
    path + ": " + JSON.stringify(result.body),
  );
  return result.body;
}

async function verifyPrivateMedia(page: Page) {
  const png = await sharp({
    create: { width: 24, height: 24, channels: 3, background: "#84aabe" },
  })
    .png()
    .toBuffer();
  const asset = await page.evaluate(
    async (bytes) => {
      const res = await fetch("/api/assets", {
        method: "POST",
        headers: { "content-type": "image/png" },
        body: new Uint8Array(bytes),
        signal: AbortSignal.timeout(10_000),
      });
      return { status: res.status, body: await res.json() };
    },
    [...png],
  );
  assert.equal(asset.status, 200, JSON.stringify(asset.body));
  assert.match(asset.body.id, /^[0-9a-f]{32}$/);
  const result = await page.evaluate(async (id) => {
    const path = "/media/" + id;
    const options = {
      headers: { range: "bytes=0-7" },
      redirect: "manual" as const,
      signal: AbortSignal.timeout(10_000),
    };
    const authorized = await fetch(path, options);
    const anonymous = await fetch(path, { ...options, credentials: "omit" });
    return {
      status: authorized.status,
      contentRange: authorized.headers.get("content-range"),
      cache: authorized.headers.get("cache-control"),
      gateway: authorized.headers.get("x-fumiao-web"),
      bytes: Array.from(new Uint8Array(await authorized.arrayBuffer())),
      anonymous: anonymous.status,
    };
  }, asset.body.id);
  assert.deepEqual(result, {
    status: 206,
    contentRange: "bytes 0-7/" + png.length,
    cache: "private, no-store",
    gateway: "next",
    bytes: [...png.subarray(0, 8)],
    anonymous: 401,
  });
}

async function verifyStreaming(
  page: Page,
  provider: Awaited<ReturnType<typeof chatProviderFixture>>,
  logout: () => Promise<void>,
) {
  const { conversation } = await browserJSON(page, "/api/chats", 200, {});
  const { pricing } = await browserJSON(page, "/api/chat/config", 200);
  const path = "/api/chats/" + conversation.id;
  const events = path + "/events";
  const started = page.waitForResponse(
    (res) => new URL(res.url()).pathname === events,
  );
  const frames: Snapshot[] = [];
  let unavailable = false;
  await page.exposeFunction("recordFrame", (frame: Snapshot) =>
    frames.push(frame),
  );
  await page.exposeFunction("streamUnavailable", () => {
    unavailable = true;
  });
  await page.evaluate((events) => {
    const source = new EventSource(events);
    const bridge = window as typeof window & {
      recordFrame: (data: Snapshot) => void;
      streamUnavailable: () => void;
    };
    source.onmessage = (event) => bridge.recordFrame(JSON.parse(event.data));
    source.addEventListener("unavailable", () => {
      source.close();
      bridge.streamUnavailable();
    });
  }, events);
  const res = await started;
  assert.equal(res.status(), 200);
  assert.match(res.headers()["content-type"], /^text\/event-stream/);
  assert.equal(res.headers()["x-accel-buffering"], "no");
  assert.equal(res.headers()["x-fumiao-web"], "next");
  await expect
    .poll(() => frames[0]?.messages, {
      timeout,
      message: "initial SSE frame while stream is open",
    })
    .toEqual([]);

  const parts = ["首段回复", "、后续回复"];
  const deltas = parts.map(
    (content) =>
      "data: " + JSON.stringify({ choices: [{ delta: { content } }] }) + "\n\n",
  );
  const finish =
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"total_tokens":20}}\n\ndata: [DONE]\n\n';
  const prelude = ": connected\n\n";
  const gates = parts.map(() => {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { promise, release };
  });
  provider.setWire("stream", {
    raw: prelude + deltas.join("") + finish,
    chunks: [prelude, ...deltas].map((chunk) => Buffer.byteLength(chunk)),
    // The original scheduler throttles updates for 150 ms after recording the
    // provider request ID. Once text starts, the browser controls each release.
    afterChunk: (i) => (i === 0 ? delay(350) : gates[i - 1].promise),
  });
  const check = (state: string, content: string) =>
    expect
      .poll(() => frames.at(-1)?.messages.at(-1), {
        timeout,
        message: "SSE " + state + " " + content,
      })
      .toMatchObject({ state, content });
  try {
    await browserJSON(page, path + "/messages", 200, {
      uid: crypto.randomUUID(),
      model: "deepseek-flash",
      text: "本地 HTTPS 聊天验收",
      expected_revision: conversation.revision,
      price_revision: pricing.revision,
    });
    await check("running", parts[0]);
    gates[0].release();
    await check("running", parts.join(""));
    gates[1].release();
    await check("complete", parts.join(""));
    assert.equal(
      provider.requests.filter(({ body }) => body?.stream).length,
      1,
    );
    await logout();
    await expect
      .poll(() => unavailable, {
        timeout,
        message: "already-open SSE stream must report revocation",
      })
      .toBe(true);
    await browserJSON(page, events, 401);
  } finally {
    for (const gate of gates) gate.release();
  }
}

export async function verifyStudioHTTPS(
  directory: string,
  web: string,
  user: Credentials,
  provider: Awaited<ReturnType<typeof chatProviderFixture>>,
  configure: (origin: string) => Promise<void>,
) {
  const tls = await testCertificate(directory);
  const upstream = new URL(web);
  const proxy = createServer(tls, (incoming, outgoing) => {
    const headers = { ...incoming.headers };
    for (const name of Object.keys(headers))
      if (name === "forwarded" || name.startsWith("x-forwarded-"))
        delete headers[name];
    const edge = httpRequest(
      {
        hostname: host,
        port: upstream.port,
        method: incoming.method,
        path: incoming.url,
        headers: {
          ...headers,
          "x-forwarded-proto": "https",
          "x-forwarded-host": headers.host,
          "x-forwarded-port": String((proxy.address() as AddressInfo).port),
          "x-forwarded-for": incoming.socket.remoteAddress!,
        },
      },
      (response) => {
        outgoing.writeHead(response.statusCode!, response.headers);
        outgoing.flushHeaders();
        response.pipe(outgoing);
      },
    );
    edge.on("error", () => {
      if (outgoing.headersSent) outgoing.destroy();
      else outgoing.writeHead(502).end();
    });
    outgoing.once("close", () => edge.destroy());
    incoming.pipe(edge);
  });
  const origin = await listen(proxy);
  const crossOrigin = createServer(tls, (_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(
      '<form method="post" action="' +
        origin +
        '/api/logout"><button>Post</button></form>',
    );
  });
  try {
    const foreign = await listen(crossOrigin);
    const prefs = {
      "security.enterprise_roots.enabled": false,
      "security.certerrors.mitm.auto_enable_enterprise_roots": false,
      "network.proxy.type": 1,
      "network.proxy.http": host,
      "network.proxy.http_port": 1,
      "network.proxy.ssl": host,
      "network.proxy.ssl_port": 1,
      "network.proxy.no_proxies_on": `${host},${browserHost}`,
      "network.trr.mode": 5,
    };
    const untrusted = await firefox.launchPersistentContext(
      join(directory, "untrusted"),
      {
        firefoxUserPrefs: prefs,
      },
    );
    try {
      const page = untrusted.pages()[0];
      await assert.rejects(
        page.goto(origin + "/studio", { timeout }),
        /SEC_ERROR_UNKNOWN_ISSUER/,
      );
      const response = await login(page, web, user, 200);
      assert.doesNotMatch(
        (await response.headerValue("set-cookie"))!,
        /; Secure\b/i,
      );
      assert.equal(
        (await browserJSON(page, "/api/state", 200)).me.name,
        user.name,
      );
      await browserJSON(page, "/api/logout", 200, {});
      console.log(
        "Verified ordinary HTTP /studio and Firefox rejection of the private CA before profile import",
      );
    } finally {
      await untrusted.close();
    }
    const profile = join(directory, "trusted");
    await mkdir(profile);
    const certutil = process.env.STUDIO_CERTUTIL || "certutil";
    const db = ["-d", "sql:" + profile];
    await run(certutil, ["-N", ...db, "--empty-password"]);
    await run(certutil, [
      "-A",
      ...db,
      "-n",
      "Studio HTTPS test CA",
      "-t",
      "C,,",
      "-a",
      "-i",
      join(directory, "ca.pem"),
    ]);
    const trusted = await firefox.launchPersistentContext(profile, {
      firefoxUserPrefs: prefs,
    });
    trusted.setDefaultTimeout(timeout);
    trusted.setDefaultNavigationTimeout(timeout);
    try {
      const page = trusted.pages()[0];
      await assert.rejects(
        page.goto(`https://${host}:${new URL(origin).port}/studio`),
        /SSL_ERROR_BAD_CERT_DOMAIN/,
      );
      const mismatch = await login(page, origin, user, 403);
      assert.deepEqual(await mismatch.json(), sourceRejected);
      assert.equal(await mismatch.headerValue("set-cookie"), null);
      await configure(origin);
      const localResponse = await login(page, web, user, 200);
      assert.doesNotMatch(
        (await localResponse.headerValue("set-cookie"))!,
        /; Secure\b/i,
      );
      await browserJSON(page, "/api/logout", 200, {});
      const response = await login(page, origin, user, 200);
      const raw = (await response.headerValue("set-cookie"))!;
      for (const attr of ["Path=/", "HttpOnly", "Secure", "SameSite=Strict"])
        assert.ok(
          raw.split(/;\s*/).includes(attr),
          "Missing " + attr + " on the session cookie",
        );
      const session = (await trusted.cookies(origin)).find(
        ({ name }) => name === cookieName,
      );
      assert.ok(session);
      assert.equal(session.domain, browserHost);
      assert.equal(session.path, "/");
      assert.equal(session.httpOnly, true);
      assert.equal(session.secure, true);
      assert.equal(session.sameSite, "Strict");
      assert.ok(
        !(await page.evaluate(() => document.cookie)).includes(
          cookieName + "=",
        ),
      );
      const state = await browserJSON(page, "/api/state", 200);
      assert.equal(state.me.name, user.name);
      assert.ok(Number.isSafeInteger(state.workspace_id));
      const tab = await trusted.newPage();
      await tab.goto(foreign);
      const denied = await request(tab, "/api/logout", "POST", () =>
        tab.getByRole("button", { name: "Post" }).click(),
      );
      const seen = await denied.request().allHeaders();
      assert.equal(seen.origin, foreign);
      assert.ok(
        seen.cookie?.includes(cookieName + "=" + session.value),
        "same-site cross-origin form must actually send the session",
      );
      assert.equal(denied.status(), 403);
      assert.deepEqual(await denied.json(), sourceRejected);
      assert.equal(
        (await browserJSON(page, "/api/state", 200)).me.name,
        user.name,
      );
      // A common externally visible redirect must preserve the authority and query bytes.
      const query = "?workspace=" + state.workspace_id + "&keep=a%20b&keep=c";
      assert.equal((await page.goto(origin + "/" + query))?.status(), 200);
      assert.equal(page.url(), origin + "/studio" + query);
      await verifyPrivateMedia(page);
      await verifyStreaming(page, provider, async () => {
        await tab.goto(origin + "/studio");
        await expect(tab.locator(".shell")).toBeVisible();
        await tab.locator(".account").click();
        const signedOut = await request(tab, "/api/logout", "POST", () =>
          tab.locator('[data-act="logout"]').click(),
        );
        assert.equal(signedOut.status(), 200);
        await expect(tab.locator(".auth-form")).toBeVisible();
        assert.ok(
          !(await trusted.cookies(origin)).some(
            ({ name }) => name === cookieName,
          ),
        );
        await browserJSON(tab, "/api/state", 401);
        // A browser with the old token must still be denied by PostgreSQL-backed auth.
        await trusted.addCookies([session]);
        const replay = await request(tab, "/api/state", "GET", () =>
          browserJSON(tab, "/api/state", 401),
        );
        assert.equal(
          (await replay.request().allHeaders()).cookie,
          `${cookieName}=${session.value}`,
        );
      });
      console.log(
        "Verified concurrent HTTP and HTTPS Studio origins, third-origin rejection, cookie flags and revocation, private 206/401, initial and live SSE frames, and logout of an open SSE stream",
      );
    } finally {
      await trusted.close();
    }
  } finally {
    await Promise.all([close(proxy), close(crossOrigin)]);
  }
}
