import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import sharp from "sharp";
import {
  migrate,
  type Sql,
  type Database,
} from "../packages/platform/src/db.js";
import { PluginRegistry } from "../packages/platform/src/plugins.js";
import { Vault } from "../packages/platform/src/security.js";
import { DiskStorage } from "../packages/platform/src/storage.js";
import { Platform } from "../packages/platform/src/platform.js";
import { createApp } from "../apps/api/src/main.js";
const pg = new PGlite(),
  directory = await mkdtemp(join(tmpdir(), "fumiao-web-"));
const wrap = (handle: any): Sql => ({
  async query(sql, params = []) {
    if (!params.length && sql.includes(";")) {
      const result = await handle.exec(sql);
      return result.at(-1) || { rows: [] };
    }
    return handle.query(sql, params);
  },
});
const db: Database = {
  ...wrap(pg),
  transaction: (fn) => pg.transaction((tx) => fn(wrap(tx))),
  close: () => pg.close(),
};
const p = new Platform(
  db,
  new Vault(randomBytes(32).toString("base64")),
  new PluginRegistry(),
  new DiskStorage(directory),
);
await migrate(db);
await p.bootstrap({
  name: "smoke",
  nickname: "Smoke",
  password: "smoke-test-password",
});
const reservation = createServer();
await new Promise<void>((r) => reservation.listen(0, "127.0.0.1", r));
const port = (reservation.address() as any).port;
const base = `http://127.0.0.1:${port}`;
process.env.PUBLIC_URL = base;
const app = await createApp(p);
await app.listen(0, "127.0.0.1");
await new Promise<void>((r) => reservation.close(() => r()));
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "apps/web",
    "-p",
    String(port),
    "-H",
    "127.0.0.1",
  ],
  {
    env: {
      ...process.env,
      API_INTERNAL_URL: await app.getUrl(),
      STUDIO_MODE: "advanced",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "";
child.stdout.on("data", (c) => {
  output = (output + c).slice(-4000);
});
child.stderr.on("data", (c) => {
  output = (output + c).slice(-4000);
});
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(base);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, "Next startup failed: " + output);
  assert.equal((await fetch(base + "/payments/return")).status, 404);
  assert.equal((await fetch(base + "/api/workspaces")).status, 401);
  const response = await fetch(base + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ name: "smoke", password: "smoke-test-password" }),
  });
  assert.equal(response.status, 201);
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  assert.match(response.headers.get("set-cookie")!, /HttpOnly/);
  for (const path of ["/canvas", "/canvas/a-project"]) {
    const canvas = await fetch(base + path, { headers: { cookie } });
    assert.equal(canvas.status, 200);
    assert.doesNotMatch(
      canvas.headers.get("content-security-policy")!,
      /'nonce-/,
    );
    assert.match(await canvas.text(), /src="\/static\/canvas\.js\?v=/);
  }
  const spaces = await (
    await fetch(base + "/api/workspaces", { headers: { cookie } })
  ).json();
  const wid = spaces[0].id;
  const png = await sharp({
    create: { width: 16, height: 16, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  const uploaded = await fetch(base + "/api/assets", {
    method: "POST",
    headers: {
      cookie,
      "X-Workspace-Id": wid,
      "Content-Type": "image/png",
      Origin: base,
    },
    body: new Uint8Array(png),
  });
  assert.equal(uploaded.status, 201);
  const asset = await uploaded.json();
  const partial = await fetch(base + "/media/" + asset.id, {
    headers: { cookie, Range: "bytes=0-7" },
  });
  assert.equal(partial.status, 206);
  assert.deepEqual(
    Buffer.from(await partial.arrayBuffer()),
    png.subarray(0, 8),
  );
  assert.match(partial.headers.get("content-range")!, /^bytes 0-7\//);
  await fetch(base + "/api/logout", {
    method: "POST",
    headers: { cookie, Origin: base, "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(
    (await fetch(base + "/api/me", { headers: { cookie } })).status,
    401,
  );
  console.log(
    "Production Web -> Nest -> PostgreSQL engine: login, upload, range media, logout passed",
  );
} finally {
  child.kill("SIGTERM");
  await new Promise<void>((r) => {
    if (child.exitCode !== null) {
      r();
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      r();
    }, 5000);
    child.once("exit", () => {
      clearTimeout(timer);
      r();
    });
  });
  await app.close();
  await db.close();
  await rm(directory, { recursive: true, force: true });
}
