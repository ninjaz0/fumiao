/** Differential test for the default editor, with two independent pinned APIs. */
import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { tree } from "./verify-homepage.js";
import {
  normalizeEditorIds,
  verifyEditorInteractions,
} from "./verify-canvas-interactions.js";

const temp = await mkdtemp(join(tmpdir(), "fumiao-editor-parity-"));
const out = resolve(".runtime-advanced/canvas-editor-parity");
const pid = "a".repeat(32);
const path = "/canvas/" + pid;
const documentURL = "/api/canvases/" + pid;
const legacyEditorScript = /^\/static\/(?:canvas|chat|flowpicker)\.js$/;
const nextScript = /^\/_next\/static\/.*\.js$/;
const origins = ["reference", "next"] as const;
const children: ChildProcess[] = [];
const states: string[] = [];
const errors: string[] = [];
const providerRequests: unknown[] = [];
const flowRequests = origins.map(() => [] as unknown[]);
const disconnected: string[][] = [[], []];
const reply = "对照回答：镜头轻轻推进。";
const proposal = [
  {
    title: "展台开场",
    prompt: "镜头推近蓝色展台。",
    narration: "欢迎来到展台。",
    seconds: 5,
  },
  {
    title: "产品特写",
    prompt: "环绕产品展示细节。",
    narration: "来看这些细节。",
    seconds: 10,
  },
];
let finishProposal!: () => void;
const proposalReady = new Promise<void>((resolve) => {
  finishProposal = resolve;
});
function sse(content: string) {
  return (
    [
      { choices: [{ delta: { content } }] },
      {
        choices: [{ delta: {}, finish_reason: "stop" }],
        usage: { total_tokens: 20 },
      },
    ]
      .map((event) => "data: " + JSON.stringify(event) + "\n\n")
      .join("") + "data: [DONE]\n\n"
  );
}
let logs = "";
const provider = createServer(async (request, response) => {
  const [, side, ...segments] = request.url!.split("/");
  const route = "/" + segments.join("/");
  const index = origins.findIndex((name) => name === side);
  if (index < 0 || request.headers.authorization !== "Bearer editor-fixture") {
    response.writeHead(403).end();
    return;
  }
  if (route === "/models" || route === "/v1/models") {
    response.end(JSON.stringify({ data: [{ id: "deepseek-chat" }] }));
    return;
  }
  if (route === "/health") {
    response.end(
      JSON.stringify({ backend_running: true, has_active_tokens: true }),
    );
    return;
  }
  if (route === "/tmp/shot.mp4") {
    response.writeHead(200, { "Content-Type": "video/mp4" });
    response.end(await readFile(join(temp, "shot.mp4")));
    return;
  }
  if (route !== "/chat/completions" && route !== "/v1/chat/completions") {
    response.writeHead(404).end();
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (route === "/v1/chat/completions") {
    flowRequests[index].push(body);
    if (flowRequests[index].length === 1) {
      response.writeHead(400).end(JSON.stringify({ error: "policy" }));
    } else {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.end(
        sse(
          `<video src="http://127.0.0.1:${listenPort(provider)}/${side}/tmp/shot.mp4" data-media-id="fixture-video"></video>`,
        ),
      );
    }
    return;
  }
  providerRequests.push(body);
  if (!body.stream) {
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({ choices: [{ message: { content: "对照对话" } }] }),
    );
    return;
  }
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  const storyboard = body.messages.some((message: { content: string }) =>
    message.content.includes("拟定可编辑分镜"),
  );
  if (storyboard) await proposalReady;
  response.end(sse(storyboard ? JSON.stringify(proposal) : reply));
});
function listenPort(server: ReturnType<typeof createServer>) {
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
}
async function port() {
  const temporary = createServer().listen(0, "127.0.0.1");
  await once(temporary, "listening");
  const result = listenPort(temporary);
  await new Promise<void>((resolve) => temporary.close(() => resolve()));
  return result;
}
function launch(command: string, args: string[], env = process.env) {
  const child = spawn(command, args, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (data) => (logs = (logs + data).slice(-8000)));
  child.on("error", (error) => (logs += error.message));
  return child;
}
async function ready(base: string) {
  await expect
    .poll(
      async () => {
        try {
          const response = await fetch(base + "/health", {
            signal: AbortSignal.timeout(500),
          });
          await response.body?.cancel();
          return response.status;
        } catch {
          return 0;
        }
      },
      { timeout: 15000, message: `Server readiness at ${base}` },
    )
    .toBe(200);
}
type Site = {
  url: string;
  api: string;
  backend: ChildProcess;
  workspace: number;
  cookie: string;
  foreignCookie: string;
  expiredCookie: string;
};
async function startNext(webPort: number, api: string, editor?: "legacy") {
  launch(
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
      STUDIO_CANVAS_EDITOR: editor,
      LEGACY_API_INTERNAL_URL: api,
      FUMIAO_REPOSITORY_ROOT: process.cwd(),
      NEXT_TELEMETRY_DISABLED: "1",
    },
  );
  const url = `http://127.0.0.1:${webPort}`;
  await ready(url);
  return url;
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid)
    return;
  child.kill();
  const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
  try {
    await once(child, "exit");
  } finally {
    clearTimeout(timer);
  }
}
async function setup(): Promise<Site[]> {
  const python =
    process.env.STUDIO_PYTHON ||
    resolve(".runtime-advanced/original/.venv/bin/python");
  execFileSync("ffmpeg", [
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=blue:s=96x54:r=24:d=1",
    "-vf",
    "drawbox=color=red:t=fill:enable='gte(t,0.4)'",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    join(temp, "shot.mp4"),
  ]);
  execFileSync("ffmpeg", [
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=24000:duration=1",
    join(temp, "voice.wav"),
  ]);
  execFileSync("ffmpeg", [
    "-loglevel",
    "error",
    "-stream_loop",
    "2",
    "-i",
    join(temp, "shot.mp4"),
    "-stream_loop",
    "2",
    "-i",
    join(temp, "voice.wav"),
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-shortest",
    join(temp, "reference.mp4"),
  ]);
  await sharp({
    create: { width: 96, height: 54, channels: 3, background: "#58a1ac" },
  })
    .png()
    .toFile(join(temp, "ref.png"));
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  return Promise.all(
    origins.map(async (name) => {
      const runtime = join(temp, name);
      const apiPort = await port();
      const webPort = name === "next" ? await port() : apiPort;
      const url = `http://127.0.0.1:${webPort}`;
      const api = `http://127.0.0.1:${apiPort}`;
      const backend = launch(python, [
        "scripts/canvas-editor-oracle.py",
        runtime,
        temp,
        String(apiPort),
        url,
        `http://127.0.0.1:${listenPort(provider)}/${name}`,
      ]);
      await ready(api);
      const session: Pick<
        Site,
        "cookie" | "workspace" | "foreignCookie" | "expiredCookie"
      > = JSON.parse(await readFile(join(runtime, "session.json"), "utf8"));
      if (name === "next") await startNext(webPort, api);
      return { url, api, backend, ...session };
    }),
  );
}
async function api(
  site: Pick<Site, "url" | "cookie" | "workspace">,
  route: string,
  body?: object,
  method = body ? "POST" : "GET",
) {
  const response = await fetch(site.url + route, {
    method,
    headers: {
      cookie: "fm_session=" + site.cookie,
      "X-Workspace-Id": String(site.workspace),
      ...(body ? { Origin: site.url, "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.equal(response.status, 200, `${method} ${route}: ${response.status}`);
  return response.json();
}

type Call = {
  method: string;
  path: string;
  workspace: string | null;
  body: unknown;
};
const mutations: Call[][] = [[], []];
const requests: string[][] = [[], []];
const streams: number[][] = [[], []];

function observe(page: Page, side: number, base: string) {
  page.on("pageerror", (error) =>
    errors.push(`${origins[side]}: ${error.message}`),
  );
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      message.text() === "Failed to load resource: net::ERR_FAILED"
    ) {
      disconnected[side].push(message.location().url);
      return;
    }
    if (
      message.type() === "error" &&
      !message
        .text()
        .startsWith(
          "Failed to load resource: the server responded with a status of",
        )
    )
      errors.push(`${origins[side]}: ${message.text()}`);
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== base) return;
    requests[side].push(url.pathname);
    if (!url.pathname.startsWith("/api/") || request.method() === "GET") return;
    const pathname = url.pathname.replace(
      /(\/api\/chats\/)[a-f0-9]{32}(?=\/)/,
      "$1<conversation>",
    );
    const headers = request.headers();
    const upload =
      url.pathname === "/api/assets" || url.pathname === "/api/h3/references";
    mutations[side].push({
      method: request.method(),
      path: pathname + url.search,
      workspace: headers["x-workspace-id"] ?? null,
      body: upload
        ? {
            contentType: headers["content-type"],
            frameSource: headers["x-frame-source"],
            frameTime: headers["x-frame-time"],
            fileName: headers["x-file-name"],
          }
        : request.postDataJSON(),
    });
  });
  page.on("response", (response) => {
    if (
      new URL(response.url()).pathname.endsWith("/events") &&
      response.headers()["content-type"]?.includes("text/event-stream") &&
      response.headers()["x-editor-fixture-disconnect"] === undefined
    )
      streams[side].push(response.status());
  });
}
async function compare(pages: Page[], name: string, aliases?: string[][]) {
  await Promise.all(
    pages.map(async (page) => {
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(
          [...document.querySelectorAll<HTMLImageElement>("img")]
            .filter((image) => image.getBoundingClientRect().width)
            .map((image) => image.decode().catch(() => {})),
        );
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      });
      // React Flow measures nodes and virtualizes edges after viewport changes.
      // Require each page's UI to settle independently before taking snapshots.
      let previous = "";
      await expect
        .poll(
          async () => {
            const current = JSON.stringify(await tree(page));
            const settled = current === previous;
            previous = current;
            return settled;
          },
          { intervals: [150] },
        )
        .toBe(true);
    }),
  );
  const dom = await Promise.all(pages.map(tree));
  const screenshots = await Promise.all(
    pages.map(async (page) => {
      const capture = () =>
        page.screenshot({ animations: "disabled", caret: "hide" });
      if (
        !(await page
          .locator("dialog[open] video[controls], dialog[open] audio[controls]")
          .count())
      )
        return capture();
      // Chromium paints its native media controls outside the document's CSS animations.
      let previous = await capture();
      await expect
        .poll(
          async () => {
            const current = await capture();
            const settled = current.equals(previous);
            previous = current;
            return settled;
          },
          { intervals: [150] },
        )
        .toBe(true);
      return previous;
    }),
  );
  const pixels = await Promise.all(
    screenshots.map((data) => sharp(data).ensureAlpha().raw().toBuffer()),
  );
  let changed = 0;
  for (let i = 0; i < pixels[0].length; i += 4) {
    if (pixels[0].readUInt32LE(i) !== pixels[1].readUInt32LE(i)) changed++;
  }
  const trees = dom.map((body, index) =>
    normalizeEditorIds(body, aliases?.[index] || []),
  );
  const same = trees[0] === trees[1];
  if (!same || changed) {
    await Promise.all(
      origins.flatMap((side, i) => [
        writeFile(join(out, `${name}-${side}.png`), screenshots[i]),
        writeFile(
          join(out, `${name}-${side}.json`),
          JSON.stringify(dom[i], null, 2),
        ),
      ]),
    );
  }
  assert.ok(
    same && changed === 0,
    `${name}: DOM ${same ? "equal" : "different"}, ${changed} changed pixels, artifacts in ${out}`,
  );
  states.push(name);
  console.log(`PASS ${name}: exact UI DOM, 0 changed pixels`);
}
function each<T>(
  pages: Page[],
  run: (page: Page, index: number) => Promise<T>,
) {
  return Promise.all(pages.map(run));
}
const button = (page: Page, name: string | RegExp) =>
  page.getByRole("button", { name, exact: typeof name === "string" });
const click = (pages: Page[], name: string | RegExp) =>
  each(pages, (page) => button(page, name).click());
const visible = (pages: Page[], name: string | RegExp) =>
  each(pages, (page) => expect(button(page, name)).toBeVisible());
const save = (pages: Page[]) => visible(pages, "已保存");
const title = (page: Page) => page.getByRole("textbox", { name: "画布名称" });
const close = (pages: Page[]) => click(pages, "关闭");

async function run() {
  await mkdir(out, { recursive: true });
  await rm(join(out, "report.json"), { force: true });
  const sites = await setup();
  assert.equal(sites[0].workspace, sites[1].workspace);
  assert.notEqual(sites[0].cookie, sites[1].cookie);
  assert.deepEqual(
    await api(sites[0], documentURL),
    await api(sites[1], documentURL),
  );
  const query = `?label=a%20b&label=again&workspace=0${sites[0].workspace}`;
  const candidate = sites[1].url;
  const rollback = await startNext(await port(), sites[1].api, "legacy");
  const [original, rolledBack] = await Promise.all([
    fetch(sites[0].url + path + query),
    fetch(rollback + path + query),
  ]);
  assert.equal(rolledBack.status, 200);
  assert.equal(await rolledBack.text(), await original.text());
  assert.equal(
    rolledBack.headers.get("content-security-policy"),
    original.headers.get("content-security-policy"),
  );
  const rollbackHead = await fetch(rollback + path, { method: "HEAD" });
  assert.equal(rollbackHead.status, 200);
  assert.equal(await rollbackHead.text(), "");

  const response = await fetch(candidate + path + query);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /<script[^>]+src="\/_next\/static\//);
  assert.doesNotMatch(
    html,
    /<script[^>]+src="\/static\/(canvas|chat|flowpicker)\.js/,
  );
  const nonce = response.headers
    .get("content-security-policy")
    ?.match(/'nonce-([^']+)'/)?.[1];
  assert.ok(nonce && html.includes(`nonce="${nonce}"`));
  assert.equal(
    (
      await fetch(candidate + "/compat-canvas-editor", {
        headers: { "x-fumiao-canvas-editor": "1" },
      })
    ).status,
    404,
  );
  assert.equal((await fetch(candidate + path + "/extra")).status, 404);
  const head = await fetch(candidate + path, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.match(head.headers.get("content-security-policy")!, /'nonce-/);
  assert.equal(await head.text(), "");
  assert.equal((await fetch(candidate + path, { method: "POST" })).status, 405);
  const clip = await readFile(join(temp, "shot.mp4"));
  for (const site of sites) {
    const media = site.url + "/media/" + "b".repeat(32);
    const range = await fetch(media, {
      headers: { cookie: "fm_session=" + site.cookie, Range: "bytes=4-15" },
    });
    assert.equal(range.status, 206);
    assert.equal(
      range.headers.get("content-range"),
      "bytes 4-15/" + clip.length,
    );
    assert.deepEqual(await range.bytes(), new Uint8Array(clip.subarray(4, 16)));
    for (const [cookie, status] of [
      [site.foreignCookie, 404],
      [site.expiredCookie, 401],
    ] as const) {
      const denied = await fetch(media, {
        headers: { cookie: "fm_session=" + cookie, Range: "bytes=4-15" },
      });
      assert.equal(denied.status, status);
      await denied.body?.cancel();
    }
  }

  const browser = await chromium.launch({ args: ["--disable-partial-raster"] });
  try {
    async function open(
      width: number,
      height: number,
      theme: string,
      {
        suffix = path,
        session = "cookie",
        status = 200,
        hold,
        targets = sites,
      }: {
        suffix?: string;
        session?: "guest" | "cookie" | "foreignCookie" | "expiredCookie";
        status?: number;
        hold?: Promise<void>;
        targets?: Site[];
      } = {},
    ) {
      return Promise.all(
        targets.map(async (site, side) => {
          const context = await browser.newContext({
            viewport: { width, height },
            deviceScaleFactor: 1,
            colorScheme: "light",
            reducedMotion: "reduce",
            locale: "zh-CN",
            timezoneId: "Asia/Shanghai",
            serviceWorkers: "block",
          });
          if (session !== "guest")
            await context.addCookies([
              {
                name: "fm_session",
                value: site[session],
                url: site.url,
                httpOnly: true,
                sameSite: "Strict",
              },
            ]);
          await context.addInitScript(
            ({ theme, pid, width }) => {
              if (localStorage.getItem("fumiao-appearance") === null)
                localStorage.setItem("fumiao-appearance", theme);
              if (width < 760 && !localStorage.getItem("fm-canvas-view-" + pid))
                localStorage.setItem(
                  "fm-canvas-view-" + pid,
                  JSON.stringify({ x: 20, y: 130, zoom: 0.4 }),
                );
              // Match locally generated identifiers so DOM IDs and request bodies can
              // be compared literally. Server-generated tickets remain independent.
              crypto.randomUUID = () => {
                const id =
                  Number(sessionStorage.getItem("fixture-uuid") || 0) + 1;
                sessionStorage.setItem("fixture-uuid", String(id));
                return `f0000000-0000-4000-8000-${String(id).padStart(12, "0")}`;
              };
            },
            { theme, pid, width },
          );
          await context.route("**/*", async (route) => {
            const request = new URL(route.request().url());
            if (request.origin !== site.url) return route.abort();
            if (side === 1 && legacyEditorScript.test(request.pathname))
              return route.abort();
            if (hold && request.pathname === documentURL) await hold;
            return route.continue();
          });
          const page = await context.newPage();
          page.setDefaultTimeout(8000);
          observe(page, side, site.url);
          const readyEditor = status === 200 && !hold;
          const projectRequest = readyEditor
            ? page.waitForRequest(
                (request) => new URL(request.url()).pathname === documentURL,
              )
            : null;
          const stateRequest = readyEditor
            ? page.waitForRequest(
                (request) => new URL(request.url()).pathname === "/api/state",
              )
            : null;
          const errorResponse =
            status === 200
              ? null
              : page.waitForResponse(
                  (response) =>
                    new URL(response.url()).pathname ===
                    "/api/canvases/" + suffix.split("/").at(-1),
                );
          await page.goto(site.url + suffix + query + "#editor");
          if (errorResponse)
            assert.equal((await errorResponse).status(), status);
          if (readyEditor) {
            assert.equal(
              (await projectRequest)!.headers()["x-workspace-id"],
              "0" + site.workspace,
            );
            assert.equal(
              (await stateRequest)!.headers()["x-workspace-id"],
              String(site.workspace),
            );
            await expect(title(page)).toHaveValue("画布编辑器对照");
            await expect(page.locator(".react-flow__node")).toHaveCount(2);
            await expect(page.locator(".react-flow__edge")).toHaveCount(1);
            await expect(page.locator("html")).toHaveAttribute(
              "data-theme",
              theme,
            );
            await expect(
              page.locator('meta[name="theme-color"]'),
            ).toHaveAttribute(
              "content",
              theme === "dark" ? "#171918" : "#f8f9fa",
            );
            const current = new URL(page.url());
            assert.equal(
              current.searchParams.get("workspace"),
              String(site.workspace),
            );
            assert.deepEqual(current.searchParams.getAll("label"), [
              "a b",
              "again",
            ]);
            assert.equal(current.hash, "#editor");
            await expect(
              page.getByRole("link", { name: "返回工作台" }),
            ).toHaveAttribute("href", "/studio?workspace=" + site.workspace);
          }
          return page;
        }),
      );
    }
    async function end(pages: Page[]) {
      await each(pages, (page) => page.context().close());
    }
    let releaseProject!: () => void;
    const holdProject = new Promise<void>((resolve) => {
      releaseProject = resolve;
    });
    const loading = await open(1440, 900, "light", { hold: holdProject });
    try {
      await each(loading, (page) =>
        expect(page.locator(".canvas-loading img")).toHaveAttribute(
          "src",
          "/static/mark.svg",
        ),
      );
      await compare(loading, "editor-loading");
    } finally {
      releaseProject();
    }
    await save(loading);
    await end(loading);
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ]) {
      for (const theme of ["light", "dark"]) {
        const pages = await open(width, height, theme);
        await compare(pages, `canvas-${width}-${theme}`);
        await click(pages, "搜索节点");
        await each(pages, (page) =>
          page.getByRole("dialog").getByRole("textbox").fill("封面"),
        );
        await each(pages, (page) =>
          expect(page.getByRole("dialog").getByText("封面镜头")).toBeVisible(),
        );
        await compare(pages, `search-${width}-${theme}`);
        if (width === 1440 && theme === "light") {
          await each(pages, async (page, index) => {
            const otherTab = await page.context().newPage();
            await otherTab.goto(sites[index].url + "/health");
            await otherTab.evaluate(() =>
              localStorage.setItem("fumiao-appearance", "dark"),
            );
            await otherTab.close();
            await expect(page.locator("html")).toHaveAttribute(
              "data-theme",
              "dark",
            );
            await expect(
              page.locator('meta[name="theme-color"]'),
            ).toHaveAttribute("content", "#171918");
            await expect(page.locator(".react-flow")).toHaveClass(/\bdark\b/);
          });
          await compare(pages, "editor-cross-tab-theme");
        }
        await end(pages);
      }
    }
    async function editorError(pages: Page[], name: string, detail: string) {
      await each(pages, async (page) => {
        await expect(
          page.getByRole("heading", { name: "画布暂时无法打开" }),
        ).toBeVisible();
        await expect(page.locator(".canvas-error p")).toHaveText(detail);
        await expect(
          page.getByRole("link", { name: "返回画布列表" }),
        ).toHaveAttribute("href", "/canvas?workspace=0" + sites[0].workspace);
      });
      await compare(pages, name);
      await end(pages);
    }
    await editorError(
      await open(1440, 900, "dark", { suffix: "/canvas/missing", status: 404 }),
      "missing-editor",
      "画布不存在或已删除",
    );
    await editorError(
      await open(1440, 900, "light", { session: "foreignCookie", status: 404 }),
      "foreign-workspace-editor",
      "内容不存在或无权访问",
    );
    for (const session of ["guest", "expiredCookie"] as const) {
      const pages = await open(1440, 900, "light", { session, status: 401 });
      await each(pages, (page) => expect(page).toHaveURL(/\/studio$/));
      await end(pages);
    }

    const pages = await open(1440, 900, "light");
    const rename = (name: string) =>
      each(pages, async (page) => {
        await title(page).fill(name);
        await title(page).press("Enter");
      });
    await rename("已保存的新标题 😀");
    await save(pages);
    await compare(pages, "saved-edit");
    await click(pages, "撤销 ⌘Z");
    await each(pages, (page) =>
      expect(title(page)).toHaveValue("画布编辑器对照"),
    );
    await save(pages);
    await compare(pages, "undo");
    await click(pages, "重做 ⌘⇧Z");
    await each(pages, (page) =>
      expect(title(page)).toHaveValue("已保存的新标题 😀"),
    );
    await save(pages);
    assert.deepEqual(
      await api(sites[0], documentURL),
      await api(sites[1], documentURL),
    );

    const select = (node: string) =>
      each(pages, (page) =>
        page
          .getByTestId("rf__node-" + node)
          .locator(".node-content")
          .click({ position: { x: 15, y: 15 } }),
      );
    await select("video");
    await visible(pages, "生成");
    await save(pages);
    await compare(pages, "video-composer");
    await click(pages, "素材包");
    await click(pages, "打开素材包 对照素材包");
    await compare(pages, "asset-pack");
    await click(pages, "导入整个素材包");
    await visible(pages, "素材包 · 1");
    await save(pages);
    await click(pages, "生成");
    await each(pages, (page) =>
      expect(page.getByText("已加入生成队列")).toBeVisible(),
    );
    await visible(pages, "取消任务");
    // The queue update can render before React Flow remeasures the existing edge.
    await each(pages, (page) =>
      expect(page.getByTestId("rf__edge-text-to-video")).toBeAttached(),
    );
    await compare(pages, "generation-queued");
    await click(pages, "取消任务");
    await each(pages, (page) => expect(button(page, "生成")).toBeEnabled());
    await click(pages, "候选数量");
    await click(pages, "2 个候选");
    await click(pages, "生成");
    await each(pages, (page) =>
      expect(page.getByRole("dialog", { name: "生成两个候选" })).toBeVisible(),
    );
    await compare(pages, "candidate-confirmation");
    await click(pages, "确认生成 · 4");
    await each(pages, (page) =>
      expect(button(page, "取消任务")).toHaveCount(2),
    );
    const finish = () =>
      Promise.all(
        sites.map(async (site) => {
          assert.equal(
            (
              await fetch(site.api + "/__editor_fixture/finish", {
                method: "POST",
                headers: { Origin: site.url },
              })
            ).status,
            200,
          );
        }),
      );
    await finish();
    await each(pages, (page) =>
      expect(button(page, "采用")).toHaveCount(2, { timeout: 10000 }),
    );
    await each(pages, (page) => button(page, "采用").first().click());
    await save(pages);
    await compare(pages, "candidate-adopted");
    await each(pages, async (page, i) => {
      const current = await api(sites[i], documentURL);
      assert.equal(
        current.document.nodes.find(
          (node: { id: string }) => node.id === "video",
        ).active_job,
        3,
      );
    });
    await click(pages, "已采用");
    await click(pages, "并排对比");
    await each(pages, async (page) => {
      const videos = page.getByRole("dialog").locator("video");
      await expect(videos).toHaveCount(2);
      // Both clips use a media fragment. Their first decoded frames and
      // initial seeks can complete on different animation frames.
      await expect
        .poll(() =>
          videos.evaluateAll((players) =>
            players.every((player) => {
              const video = player as HTMLVideoElement;
              return (
                video.readyState >= video.HAVE_CURRENT_DATA &&
                !video.seeking &&
                video.currentTime > 0
              );
            }),
          ),
        )
        .toBe(true);
    });
    await compare(pages, "candidate-side-by-side");
    await close(pages);

    await click(pages, "缩放菜单");
    await click(pages, /适配画布/);
    await each(pages, (page) =>
      expect(page.getByTestId("rf__edge-text-to-video")).toBeAttached(),
    );
    await click(pages, "镜头列表");
    await click(pages, "镜头 1 的旁白");
    await each(pages, (page) =>
      page.getByLabel("旁白文字").fill("本机旁白对照。"),
    );
    await click(pages, "生成旁白 · 2");
    await visible(pages, "旁白生成中");
    await each(pages, (page) =>
      expect(page.locator(".react-flow__edge")).toHaveCount(1),
    );
    await compare(pages, "narration-queued");
    await finish();
    await each(pages, (page) =>
      expect(page.locator('audio[aria-label="当前旁白"]')).toBeVisible({
        timeout: 12000,
      }),
    );
    await save(pages);
    await compare(pages, "narration-adopted");
    const downloads = await each(pages, async (page) => {
      const pending = page.waitForEvent("download");
      await button(page, "导出镜头包").click();
      return pending;
    });
    const zipFiles = await Promise.all(
      downloads.map(async (download) => {
        assert.match(download.suggestedFilename(), /\.zip$/);
        return readFile((await download.path())!);
      }),
    );
    assert.ok(zipFiles.every((zip) => zip.includes(Buffer.from("PK\x03\x04"))));
    await click(pages, "合成预览");
    const exports = await each(pages, async (page, i) => {
      await expect(page.getByRole("link", { name: "字幕 SRT" })).toBeVisible({
        timeout: 20000,
      });
      const href = await page
        .getByRole("link", { name: "字幕 SRT" })
        .getAttribute("href");
      const mp4 = await page
        .getByRole("link", { name: "MP4" })
        .getAttribute("href");
      assert.match(
        href!,
        /^\/api\/storyboard-exports\/[a-f0-9]{32}\/subtitles$/,
      );
      const headers = { cookie: "fm_session=" + sites[i].cookie };
      const srt = await fetch(sites[i].url + href, { headers });
      assert.equal(srt.status, 200);
      const video = await fetch(sites[i].url + mp4, { headers });
      assert.equal(video.status, 200);
      const ids = [href!.split("/")[3], mp4!.split("/")[2].split("?")[0]];
      return {
        ids,
        srt: await srt.text(),
        video: Buffer.from(await video.arrayBuffer()),
      };
    });
    assert.match(exports[0].srt, /本机旁白对照。/);
    assert.equal(exports[0].srt, exports[1].srt);
    assert.deepEqual(exports[0].video, exports[1].video);
    await click(pages, "预览");
    await each(pages, (page) =>
      expect(page.locator(".composition-preview track")).toHaveCount(1),
    );
    await compare(
      pages,
      "export-preview",
      exports.map((result) => result.ids),
    );
    await close(pages);

    await select("text");
    await visible(pages, "生成文本");
    await each(pages, async (page) => {
      await page
        .getByTestId("rf__node-text")
        .locator(".text-display")
        .dblclick();
      await page
        .getByRole("textbox", { name: "文本内容" })
        .fill("编辑后的节点原文 😀");
      await page.getByRole("textbox", { name: "文本内容" }).press("Escape");
    });
    await save(pages);
    await compare(pages, "node-text-edit");
    await each(pages, (page) =>
      page
        .getByRole("textbox", { name: "文本生成要求" })
        .fill("把文案写成缓慢推进的镜头。"),
    );
    await compare(pages, "chat-draft");
    await click(pages, "生成文本");
    await each(pages, (page) =>
      expect(page.getByTestId("rf__node-text").getByText(reply)).toBeVisible({
        timeout: 18000,
      }),
    );
    await compare(pages, "chat-writeback");
    assert.ok(
      streams.every((events) => events.includes(200)),
      "real SSE in both sessions",
    );
    assert.equal(
      providerRequests.filter(
        (request) => (request as { stream: boolean }).stream,
      ).length,
      2,
    );

    await Promise.all(
      sites.map(async (site) => {
        const current = await api(site, documentURL);
        await api(
          site,
          documentURL + "/document",
          {
            title: "其他成员的新标题",
            expected_revision: current.revision,
            document: current.document,
          },
          "PUT",
        );
      }),
    );
    await rename("冲突的本地草稿");
    await visible(pages, "保存冲突");
    await compare(pages, "conflict");
    const drafts = await each(pages, async (page) => {
      const pending = page.waitForEvent("download");
      await button(page, "下载本地副本").click();
      const download = await pending;
      return JSON.parse(await readFile((await download.path())!, "utf8"));
    });
    assert.deepEqual(drafts[0], drafts[1]);
    assert.equal(drafts[0].title, "冲突的本地草稿");
    await click(pages, "重新载入");
    await compare(pages, "conflict-reload-dialog");
    await each(pages, (page) =>
      page
        .getByRole("dialog")
        .getByRole("button", { name: "重新载入" })
        .click(),
    );
    await each(pages, (page) =>
      expect(title(page)).toHaveValue("其他成员的新标题"),
    );
    await save(pages);
    await compare(pages, "conflict-remote");
    const interactions = await verifyEditorInteractions({
      pages,
      project: pid,
      sites,
      fixtures: temp,
      api,
      compare,
      flowRequests,
      proposal,
      finishProposal,
    });
    await end(pages);

    // Leave both Next servers running and stop their real compatibility backend.
    // The rollback server supplies the pinned editor to compare the same 502.
    await stop(sites[1].backend);
    await editorError(
      await open(1440, 900, "light", {
        status: 502,
        targets: [{ ...sites[1], url: rollback }, sites[1]],
      }),
      "backend-unavailable-editor",
      "后端暂时不可用",
    );

    assert.ok(requests[0].includes("/static/canvas.js"));
    assert.ok(requests[1].some((request) => nextScript.test(request)));
    assert.deepEqual(
      requests[1].filter((request) => legacyEditorScript.test(request)),
      [],
    );
    assert.deepEqual(errors, []);
    const referenceMutations: Call[] = JSON.parse(
      normalizeEditorIds(mutations[0], interactions.aliases[0]),
    );
    assert.deepEqual(
      JSON.parse(normalizeEditorIds(mutations[1], interactions.aliases[1])),
      referenceMutations,
      "browser API method, path, workspace, revisions and JSON request bodies",
    );
    for (const urls of disconnected) {
      assert.ok(
        urls.every((url) => {
          const path = new URL(url).pathname;
          return (
            path === documentURL + "/document" ||
            path === documentURL + "/nodes/video/candidates"
          );
        }),
        `Unexpected network failures: ${urls.join(", ")}`,
      );
    }
    const storyboardRequests = providerRequests.filter(
      (request) =>
        (request as { stream?: boolean }).stream &&
        JSON.stringify(request).includes("拟定可编辑分镜"),
    );
    assert.equal(storyboardRequests.length, 2);
    assert.deepEqual(storyboardRequests[0], storyboardRequests[1]);
    console.log(
      `PASS ${mutations[0].length} original mutation contracts, local media/SRT/ZIP, and real chat SSE with writeback`,
    );
    await writeFile(
      join(out, "report.json"),
      JSON.stringify(
        {
          editor: "default React",
          states: states.map((name) => ({
            name,
            dom: "equal",
            differentPixels: 0,
          })),
          mutations: referenceMutations.map(({ method, path }) => ({
            method,
            path,
          })),
          chatStreams: streams.map((events) => events.length),
          entry: {
            rollback: "pinned HTML and CSP",
            guest: "401, redirects to /studio",
            expiredSession: "401, redirects to /studio",
            privateMedia:
              "206 for owner, 404 for outsider, 401 for expired session",
          },
          interactions: interactions.evidence,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}

try {
  await run();
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  finishProposal();
  provider.closeAllConnections();
  if (provider.listening)
    await new Promise<void>((resolve) => provider.close(() => resolve()));
  await Promise.all(children.reverse().map(stop));
  await rm(temp, { recursive: true, force: true });
}
