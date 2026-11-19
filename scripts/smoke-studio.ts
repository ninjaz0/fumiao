/** Compare the Next gateway against a fresh, real original API, never user data. */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";

const root = process.cwd();
const directory = await mkdtemp(join(tmpdir(), "fumiao-original-http-"));
async function freePort() {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}
const apiPort = await freePort(),
  webPort = await freePort();
const api = `http://127.0.0.1:${apiPort}`,
  web = `http://127.0.0.1:${webPort}`;
const children: ChildProcess[] = [];
let logs = "";
function launch(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(command, args, {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  child.stdout!.on("data", (c) => (logs = (logs + c).slice(-6000)));
  child.stderr!.on("data", (c) => (logs = (logs + c).slice(-6000)));
  child.on("error", (e) => (logs += e.message));
  return child;
}
async function ready(url: string, child: ChildProcess) {
  for (let i = 0; i < 150; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (r.ok) {
        await r.body?.cancel();
        return;
      }
    } catch {}
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Server did not start: " + logs);
}
let cookie = "";
const request = (
  path: string,
  body?: unknown,
  method?: string,
  workspace?: number,
  session = cookie,
) =>
  fetch(web + path, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: {
      cookie: session,
      Origin: web,
      ...(workspace ? { "X-Workspace-Id": String(workspace) } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
async function json(response: Response, expected = 200) {
  const data = await response.json();
  assert.equal(response.status, expected, JSON.stringify(data).slice(0, 250));
  return data;
}
async function assertReactEditor(response: Response) {
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /id="canvas-root"/);
  assert.match(html, /<script[^>]+src="\/_next\/static\//);
  assert.doesNotMatch(
    html,
    /<script[^>]+src="\/static\/(canvas|chat|flowpicker)\.js/,
  );
  assert.match(response.headers.get("content-security-policy")!, /'nonce-/);
}
try {
  const python =
    process.env.STUDIO_PYTHON ||
    resolve(".runtime-advanced/original/.venv/bin/python");
  const legacy = launch(
    python,
    [
      "scripts/preview-original.py",
      "--port",
      String(apiPort),
      "--public-url",
      web,
      "--runtime-directory",
      directory,
      "--no-reuse-local-credentials",
    ],
    process.env,
  );
  await ready(api + "/health", legacy);
  const next = launch(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "apps/web",
      "-p",
      String(webPort),
      "-H",
      "127.0.0.1",
    ],
    {
      ...process.env,
      STUDIO_MODE: "original",
      STUDIO_CANVAS_EDITOR: undefined,
      LEGACY_API_INTERNAL_URL: api,
      FUMIAO_REPOSITORY_ROOT: root,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  );
  await ready(web + "/health", next);
  // Installer, registration and payment returns use the original backend.
  for (const path of [
    "/connect/install.sh",
    "/agent/registration",
    "/payments/return?order=FM0123456789abcdef0123456789",
  ]) {
    const [old, current] = await Promise.all([
      fetch(api + path, { redirect: "manual" }),
      fetch(web + path, { redirect: "manual" }),
    ]);
    assert.equal(current.status, old.status, path);
    assert.equal(current.headers.get("x-fumiao-web"), "next");
    assert.equal(current.headers.get("location"), old.headers.get("location"));
    assert.deepEqual(await current.bytes(), await old.bytes(), path);
  }
  const usage = () => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uid: "synthetic-gateway-probe", units: 0 }),
  });
  for (const path of ["/fmworker/usage", "/api/fmworker/resources", "/api/admin/fmworker/config"]) {
    const retired = await fetch(web + path, usage());
    assert.equal(retired.status, 410, path);
    assert.equal(retired.headers.get("x-fumiao-web"), "next");
    assert.deepEqual(await retired.json(), { detail: "贡献服务已停用" });
  }
  // The guest list still uses the pinned HTML and original CSP.
  const [originalList, guestList] = await Promise.all([
    fetch(api + "/canvas"),
    fetch(web + "/canvas"),
  ]);
  const originalCanvas = await originalList.text();
  assert.equal(guestList.status, originalList.status);
  assert.equal(await guestList.text(), originalCanvas);
  assert.equal(
    guestList.headers.get("content-security-policy"),
    originalList.headers.get("content-security-policy"),
  );
  assert.equal(guestList.headers.get("x-fumiao-web"), "next");
  await assertReactEditor(await fetch(web + "/canvas/a-project"));
  const originalStudio = await (await fetch(api + "/studio")).text();
  const authPage = await fetch(web + "/studio");
  assert.equal(authPage.status, 200);
  const authHtml = await authPage.text();
  assert.match(authHtml, /\/_next\//);
  assert.doesNotMatch(authHtml, /src="\/static\/(studio|theme|flowpicker)\.js/);
  assert.match(authPage.headers.get("content-security-policy")!, /'nonce-/);
  assert.equal((await fetch(web + "/compat-auth")).status, 404);
  const home = await fetch(web + "/");
  const homeHtml = await home.text();
  assert.equal(home.status, 200);
  assert.match(homeHtml, /从一个想法，/);
  assert.match(homeHtml, /data-session="guest"/);
  assert.doesNotMatch(homeHtml, /src="\/static\/(home|theme)\.js/);
  const csp = home.headers.get("content-security-policy")!;
  const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
  assert.ok(nonce);
  assert.ok(homeHtml.includes(`nonce="${nonce}"`));
  assert.doesNotMatch(
    csp.split("script-src")[1].split(";")[0],
    /unsafe-inline|unsafe-eval/,
  );
  const secondCsp = (await fetch(web + "/")).headers.get(
    "content-security-policy",
  );
  assert.notEqual(csp, secondCsp, "nonce must change per response");
  const manifest = JSON.parse(
    await readFile("baseline/production/manifest.json", "utf8"),
  );
  let assets = 0;
  for (const [path, metadata] of Object.entries(manifest.files) as [
    string,
    any,
  ][]) {
    if (!path.startsWith("static/") || path.endsWith(".html")) continue;
    const route = path.startsWith("static/avatars/")
      ? "/" + path.slice(7)
      : "/" + path;
    const response = await fetch(web + route);
    assert.equal(response.status, 200, path);
    assert.equal(
      createHash("sha256")
        .update(Buffer.from(await response.arrayBuffer()))
        .digest("hex"),
      metadata.sha256,
      path,
    );
    assets++;
  }
  assert.equal(assets, 23);
  const version = manifest.files["static/studio.js"].sha256.slice(0, 20);
  assert.match(
    (await fetch(web + "/static/studio.js?v=" + version)).headers.get(
      "cache-control",
    )!,
    /immutable/,
  );
  assert.equal(
    (await fetch(web + "/static/studio.js?v=wrong")).headers.get(
      "cache-control",
    ),
    "private, no-store",
  );
  assert.equal((await fetch(web + "/static/index.html")).status, 404);
  assert.equal((await fetch(web + "/advanced")).status, 404);
  assert.equal(
    await (await fetch(web + "/studio", { method: "HEAD" })).text(),
    "",
  );
  const redirect = await fetch(web + "/?workspace=2&recharge=one", {
    redirect: "manual",
  });
  assert.equal(redirect.status, 307);
  assert.equal(
    new URL(redirect.headers.get("location")!, web).pathname +
      new URL(redirect.headers.get("location")!, web).search,
    "/studio?workspace=2&recharge=one",
  );
  const encodedQuery = "?workspace=2&label=a%20b&label=c%2Fd";
  const encodedRedirect = await fetch(web + "/" + encodedQuery, {
    redirect: "manual",
  });
  assert.equal(encodedRedirect.status, 307);
  assert.equal(
    new URL(encodedRedirect.headers.get("location")!, web).search,
    encodedQuery,
  );
  assert.equal((await request("/api/state")).status, 401);
  const creds = JSON.parse(
    await readFile(join(directory, "credentials.json"), "utf8"),
  );
  const login = await request("/api/login", creds);
  await json(login);
  assert.match(login.headers.get("set-cookie")!, /HttpOnly/);
  cookie = login.headers.get("set-cookie")!.split(";")[0];
  assert.equal(
    await (await request("/studio?studio_ui=legacy")).text(),
    originalStudio,
    "explicit fallback must serve the pinned Studio document",
  );
  for (const path of ["/studio", "/studio?studio_ui=react"]) {
    const response = await request(path);
    assert.match(response.headers.get("content-security-policy")!, /'nonce-/);
    const html = await response.text();
    assert.match(html, /src="\/_next\/static\//);
    assert.doesNotMatch(html, /src="\/static\/(studio|theme|flowpicker|chat)\.js/);
  }
  assert.match(await (await request("/")).text(), /data-session="member"/);
  const canvasList = await request("/canvas");
  assert.equal(canvasList.status, 200);
  assert.match(canvasList.headers.get("content-security-policy")!, /'nonce-/);
  const listHtml = await canvasList.text();
  assert.match(listHtml, /id="canvas-root"/);
  assert.doesNotMatch(listHtml, /src="\/static\/(canvas|theme)\.js/);
  const canvasHead = await request("/canvas", undefined, "HEAD");
  assert.equal(canvasHead.status, 200);
  assert.equal(await canvasHead.text(), "");
  assert.match(canvasHead.headers.get("content-security-policy")!, /'nonce-/);
  assert.match(canvasHead.headers.get("cache-control")!, /private, no-store/);
  const guestCanvasHead = await request(
    "/canvas",
    undefined,
    "HEAD",
    undefined,
    "",
  );
  assert.equal(guestCanvasHead.status, 200);
  assert.equal(await guestCanvasHead.text(), "");
  assert.doesNotMatch(
    guestCanvasHead.headers.get("content-security-policy")!,
    /'nonce-/,
  );
  assert.equal((await request("/canvas", {}, "POST")).status, 405);
  assert.equal(
    await (
      await request(
        "/canvas",
        undefined,
        "GET",
        undefined,
        "fm_session=expired",
      )
    ).text(),
    originalCanvas,
    "invalid sessions must receive the original canvas entry",
  );
  await assertReactEditor(await request("/canvas/a-project"));
  const [legacyEditor, originalEditor] = await Promise.all([
    request("/canvas/a-project?canvas_ui=legacy"),
    fetch(api + "/canvas/a-project"),
  ]);
  assert.equal(legacyEditor.status, originalEditor.status);
  assert.equal(await legacyEditor.text(), await originalEditor.text());
  assert.equal(
    legacyEditor.headers.get("content-security-policy"),
    originalEditor.headers.get("content-security-policy"),
  );
  for (const [path, header] of [
    ["compat-canvas", "x-fumiao-canvas"],
    ["compat-canvas-editor", "x-fumiao-canvas-editor"],
    ["compat-studio", "x-fumiao-studio"],
  ]) {
    const response = await fetch(web + "/" + path, {
      headers: { cookie, [header]: "1" },
    });
    assert.equal(response.status, 404, path);
  }
  if (process.argv.includes("--studio-react")) {
    const { verifyStudioReact } = await import("./verify-studio-react.js");
    await verifyStudioReact(api, web, cookie, directory);
  }
  if (process.argv.includes("--canvas-list")) {
    const { verifyCanvasList } = await import("./verify-canvas-list.js");
    await verifyCanvasList(api, web, cookie, directory);
  }
  if (process.argv.includes("--visual")) {
    const { verifyHomepage } = await import("./verify-homepage.js");
    await verifyHomepage(api, web, cookie);
  }
  if (process.argv.includes("--auth")) {
    const reference = `http://127.0.0.1:${await freePort()}`;
    const referenceDirectory = join(directory, "reference");
    const referenceProcess = launch(
      python,
      [
        "scripts/preview-original.py",
        "--port",
        new URL(reference).port,
        "--public-url",
        reference,
        "--runtime-directory",
        referenceDirectory,
        "--no-reuse-local-credentials",
      ],
      process.env,
    );
    await ready(reference + "/health", referenceProcess);
    const referenceCredentials = JSON.parse(
      await readFile(join(referenceDirectory, "credentials.json"), "utf8"),
    );
    const { verifyAuth } = await import("./verify-auth.js");
    await verifyAuth(reference, web, referenceCredentials, creds);
  }
  const state = await json(await request("/api/state"));
  const wid = state.workspace_id;
  assert.equal(typeof wid, "number");
  const foreign = await fetch(web + "/api/canvases", {
    method: "POST",
    headers: {
      cookie,
      Origin: "https://untrusted.invalid",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(foreign.status, 403);
  assert.ok((await foreign.json()).detail);
  // Original canvas formats/revisions are not converted to the Advanced document shape.
  const canvas = await json(
    await request(
      "/api/canvases",
      { title: "Gateway contract check" },
      "POST",
      wid,
    ),
  );
  const document = {
    schemaVersion: 1,
    nodes: [
      {
        id: "text",
        type: "text",
        x: 40,
        y: 60,
        text: "原版节点内容",
        title: "文字",
        width: 320,
        height: 240,
      },
    ],
    edges: [],
  };
  const changed = await json(
    await request(
      `/api/canvases/${canvas.id}/document`,
      { expected_revision: canvas.revision, title: canvas.title, document },
      "PUT",
      wid,
    ),
  );
  assert.ok(changed.revision > canvas.revision);
  assert.equal(
    (
      await request(
        `/api/canvases/${canvas.id}/document`,
        { expected_revision: canvas.revision, title: canvas.title, document },
        "PUT",
        wid,
      )
    ).status,
    409,
  );
  const reopened = await json(
    await request(`/api/canvases/${canvas.id}`, undefined, "GET", wid),
  );
  assert.equal(reopened.document.nodes[0].text, "原版节点内容");
  const png = await sharp({
    create: { width: 16, height: 16, channels: 3, background: "blue" },
  })
    .png()
    .toBuffer();
  const uploaded = await fetch(web + "/api/assets", {
    method: "POST",
    headers: {
      cookie,
      Origin: web,
      "X-Workspace-Id": String(wid),
      "Content-Type": "image/png",
    },
    body: new Uint8Array(png),
  });
  const asset = await json(uploaded);
  assert.match(asset.id, /^[a-f0-9]{32}$/);
  const partial = await fetch(web + "/media/" + asset.id, {
    headers: { cookie, Range: "bytes=0-7" },
  });
  assert.equal(partial.status, 206);
  assert.deepEqual(
    Buffer.from(await partial.arrayBuffer()),
    png.subarray(0, 8),
  );
  assert.equal((await fetch(web + "/media/" + asset.id)).status, 401);
  // A real original SSE endpoint is held open; the first event must not wait for EOF.
  const chat = await json(
    await request("/api/chats", { model: "gpt-4.1" }, "POST", wid),
  );
  const cid = chat.conversation.id;
  const abort = new AbortController();
  const stream = await fetch(
    web + `/api/chats/${cid}/events?workspace=${wid}`,
    {
      headers: { cookie },
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]),
    },
  );
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get("content-type")!, /text\/event-stream/);
  const reader = stream.body!.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /data: /);
  abort.abort();
  await reader.cancel().catch(() => {});
  await json(await request("/api/logout", {}));
  assert.equal((await request("/api/state")).status, 401);
  const renewedSession = await request("/api/login", creds);
  await json(renewedSession);
  cookie = renewedSession.headers.get("set-cookie")!.split(";")[0];
  legacy.kill("SIGTERM");
  await new Promise<void>((resolve, reject) => {
    if (legacy.exitCode !== null || legacy.signalCode !== null)
      return resolve();
    const timer = setTimeout(
      () => reject(new Error("Isolated API did not stop")),
      5000,
    );
    legacy.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  assert.equal(
    await (await fetch(web + "/studio")).text(),
    originalStudio,
    "API outage must preserve the original loading/error UI",
  );
  assert.equal(
    await (await request("/studio")).text(),
    originalStudio,
    "API outage must preserve pinned Studio for a signed-in browser too",
  );
  assert.equal((await fetch(web + "/api/state")).status, 502);
  if (process.argv.includes("--studio-react")) {
    assert.equal(
      await (await request("/studio?studio_ui=react")).text(),
      originalStudio,
      "the studio candidate must fall back to pinned HTML when the API is offline",
    );
  }
  await assertReactEditor(await request("/canvas/a-project"));
  assert.equal(
    await (await request("/canvas")).text(),
    originalCanvas,
    "API outage must preserve the original canvas fallback",
  );
  console.log(
    "PASS React home/auth/Studio/canvas and CSP; explicit Studio fallback, guest canvas and 23 pinned assets; CSRF, revisions, private ranges, SSE, logout and API-outage behavior",
  );
} finally {
  for (const child of children.reverse()) {
    child.kill("SIGTERM");
    await new Promise<void>((r) => {
      if (child.exitCode !== null || child.signalCode !== null) return r();
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        r();
      }, 5000);
      child.once("exit", () => {
        clearTimeout(timer);
        r();
      });
    });
  }
  await rm(directory, { recursive: true, force: true });
}
