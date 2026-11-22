import test from "node:test";
import assert from "node:assert/strict";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { gzipSync } from "node:zlib";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OriginalUI } from "../../packages/web-compat/src/ui.js";
import { forward } from "../../packages/web-compat/src/proxy.js";

async function server(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
) {
  const s = createServer(handler);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${(s.address() as any).port}`,
    close: async () => {
      s.closeAllConnections();
      await new Promise<void>((r) => s.close(() => r()));
    },
  };
}
test("gateway keeps original protocol, private ranges, cookies, redirects and decoded bytes", async () => {
  let seen: any;
  const upstream = await server(async (req, res) => {
    const bytes: Buffer[] = [];
    for await (const chunk of req) bytes.push(Buffer.from(chunk));
    seen = {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: Buffer.concat(bytes),
    };
    if (req.url === "/redirect") {
      res.writeHead(307, { location: "/studio?workspace=2" });
      res.end();
      return;
    }
    if (req.url === "/empty") {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(206, {
      "content-type": "application/octet-stream",
      "content-encoding": "gzip",
      "content-range": "bytes 0-3/8",
      "set-cookie": [
        "fm_session=test; HttpOnly; SameSite=Strict; Path=/",
        "second=value; Path=/",
      ],
      connection: "x-private-hop",
      "x-private-hop": "drop-me",
    });
    res.end(gzipSync(Buffer.from([0, 1, 2, 255])));
  });
  try {
    const body = new Uint8Array([0, 9, 255, 2]);
    const r = await forward(
      new Request("http://public.test/api/assets?workspace=17", {
        method: "POST",
        headers: {
          cookie: "fm_session=original",
          origin: "http://public.test",
          "x-workspace-id": "17",
          "x-forwarded-for": "spoofed",
          connection: "x-hop",
          "x-hop": "secret",
        },
        body,
      }),
      upstream.url,
    );
    assert.equal(seen.url, "/api/assets?workspace=17");
    assert.equal(seen.headers.cookie, "fm_session=original");
    assert.equal(seen.headers.origin, "http://public.test");
    assert.equal(seen.headers["x-workspace-id"], "17");
    assert.equal(seen.headers["x-forwarded-for"], undefined);
    assert.equal(seen.headers["x-hop"], undefined);
    assert.deepEqual(seen.body, Buffer.from(body));
    assert.equal(r.status, 206);
    assert.equal(r.headers.get("content-range"), "bytes 0-3/8");
    assert.equal(r.headers.getSetCookie().length, 2);
    assert.equal(r.headers.get("content-encoding"), null);
    assert.equal(r.headers.get("x-private-hop"), null);
    assert.equal(r.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(
      Buffer.from(await r.arrayBuffer()),
      Buffer.from([0, 1, 2, 255]),
    );
    const redirect = await forward(
      new Request("http://public.test/redirect"),
      upstream.url,
    );
    assert.equal(redirect.status, 307);
    assert.equal(redirect.headers.get("location"), "/studio?workspace=2");
    const empty = await forward(
      new Request("http://public.test/empty", { method: "HEAD" }),
      upstream.url,
    );
    assert.equal(empty.status, 204);
    assert.equal(await empty.text(), "");
  } finally {
    await upstream.close();
  }
});
test("SSE arrives before completion and abort closes upstream; failed writes are never replayed", async () => {
  let writes = 0;
  let disconnected!: () => void;
  const closed = new Promise<void>((r) => (disconnected = r));
  const upstream = await server((req, res) => {
    if (req.method === "POST") {
      writes++;
      req.socket.destroy();
      return;
    }
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "x-accel-buffering": "no",
    });
    res.write('data: {"text":"first"}\n\n');
    res.once("close", disconnected);
  });
  try {
    const controller = new AbortController();
    const response = await forward(
      new Request("http://public.test/api/chats/one/events", {
        signal: controller.signal,
      }),
      upstream.url,
    );
    const reader = response.body!.getReader();
    const first = await reader.read();
    assert.equal(
      new TextDecoder().decode(first.value),
      'data: {"text":"first"}\n\n',
    );
    assert.equal(response.headers.get("x-accel-buffering"), "no");
    controller.abort();
    await assert.rejects(reader.read());
    await Promise.race([
      closed,
      new Promise((_, reject) => {
        const t = setTimeout(
          () => reject(new Error("SSE upstream was not cancelled")),
          2000,
        );
        t.unref();
      }),
    ]);
    const failed = await forward(
      new Request("http://public.test/api/jobs", {
        method: "POST",
        body: "{}",
      }),
      upstream.url,
    );
    assert.equal(failed.status, 502);
    assert.deepEqual(await failed.json(), { detail: "后端暂时不可用" });
    assert.equal(writes, 1);
    const unconfigured = await forward(
      new Request("http://public.test/api/jobs", {
        method: "POST",
        body: "{}",
      }),
      "",
    );
    assert.equal(unconfigured.status, 502);
    assert.deepEqual(await unconfigured.json(), { detail: "后端暂时不可用" });
    assert.equal(writes, 1);
  } finally {
    await upstream.close();
  }
});
test("original assets are pinned, unknown paths and modified source fail closed", async () => {
  const root = process.cwd();
  const ui = new OriginalUI(root);
  assert.equal(await ui.verify(), 17);
  await assert.rejects(ui.file("studio.js"));
  await assert.rejects(ui.file("../../.env"));
  const tmp = await mkdtemp(join(tmpdir(), "fumiao-ui-pinning-"));
  try {
    await mkdir(join(tmp, "baseline/production/static"), { recursive: true });
    await writeFile(
      join(tmp, "baseline/production/manifest.json"),
      await readFile(join(root, "baseline/production/manifest.json")),
    );
    await writeFile(
      join(tmp, "baseline/production/static/studio.css"),
      "tampered",
    );
    await assert.rejects(
      new OriginalUI(tmp).file("studio.css"),
      /hash mismatch/,
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
