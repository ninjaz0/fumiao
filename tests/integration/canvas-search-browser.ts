import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { after, before, test } from "node:test";
import {
  chromium,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

const evidence = process.env.CANVAS_SEARCH_EVIDENCE;
const viewport = { width: 1280, height: 800 };
const title = "镜头规划 Canvas";
const harness = spawn(
  process.execPath,
  ["--import", "tsx", "tests/integration/smoke-studio-nest.ts", "--serve"],
  { stdio: ["ignore", "pipe", "pipe"] },
);
const exited = once(harness, "exit");
let browser: Browser | undefined;
let context: BrowserContext | undefined;
let page: Page;
let initialCount: number;

before(
  async () => {
    let output = "";
    const ready = new Promise<RegExpMatchArray>((resolve) => {
      const collect = (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-16000);
        const match = output.match(
          /Isolated Studio (http:\/\/[^\s]+)\/studio\r?\nSynthetic login (\S+) \/ (\S+)\r?\n/,
        );
        if (match) resolve(match);
      };
      harness.stdout.on("data", collect);
      harness.stderr.on("data", collect);
    });
    const [, origin, name, password] = await Promise.race([
      ready,
      exited.then(([code]) => {
        throw new Error(
          `Studio harness exited with ${code}: ${output.replace(/^Synthetic login .*$/gm, "Synthetic login [redacted]")}`,
        );
      }),
    ]);
    browser = await chromium.launch({ slowMo: evidence ? 600 : 0 });
    context = await browser.newContext({
      baseURL: origin,
      viewport,
      ...(evidence ? { recordVideo: { dir: evidence, size: viewport } } : {}),
    });
    const login = await context.request.post("/api/login", {
      data: { name, password },
    });
    assert.equal(login.status(), 200);
    const state = await context.request.get("/api/state");
    assert.equal(state.status(), 200);
    const { workspace_id: workspace } = await state.json();
    const created = await context.request.post("/api/canvases", {
      headers: { Origin: origin, "X-Workspace-Id": String(workspace) },
      data: { title },
    });
    assert.equal(created.status(), 200, await created.text());
    page = await context.newPage();
    await page.goto("/studio");
    await page.getByRole("button", { name: "画布", exact: true }).click();
    await expect(
      page.getByRole("link", { name: "打开画布 " + title, exact: true }),
    ).toBeVisible();
    initialCount = await page.locator(".project-card").count();
    assert.ok(initialCount > 1);
  },
  { timeout: 190_000 },
);

after(
  async () => {
    try {
      await context?.close();
      await browser?.close();
    } finally {
      harness.kill("SIGTERM");
      await exited;
    }
  },
  { timeout: 40_000 },
);

async function screenshot(name: string) {
  if (!evidence) return;
  await page.mouse.move(10, 10);
  await page.screenshot({ path: join(evidence, `${name}.png`) });
}

test("canvas search explains no matches and clears the query", async () => {
  const search = page.getByRole("textbox", { name: "搜索画布" });
  const cards = page.locator(".project-card");
  await search.fill("没有这张画布");
  await expect(cards).toHaveCount(0);
  await screenshot("no-match");
  await expect(
    page.getByRole("heading", { name: "没有找到匹配的画布" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "清除搜索" }).click();
  await expect(search).toHaveValue("");
  await expect(cards).toHaveCount(initialCount);
});

test("canvas search ignores surrounding whitespace and letter case", async () => {
  const search = page.getByRole("textbox", { name: "搜索画布" });
  const cards = page.locator(".project-card");
  await search.fill(`  ${title.toLowerCase()}  `);
  await screenshot("padded-title");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText(title);
  await search.fill("   ");
  await expect(cards).toHaveCount(initialCount);
});

test("canvas list can recover from a failed request", async () => {
  let fail = true;
  await page.route("**/api/canvases", (route) =>
    fail ? route.fulfill({ status: 503, json: { detail: "暂时无法读取画布" } }) : route.continue(),
  );
  try {
    await page.reload();
    await expect(page.getByRole("heading", { name: "画布列表暂时无法加载" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "暂无画布" })).toBeHidden();
    fail = false;
    await page.getByRole("button", { name: "重试" }).click();
    await expect(page.getByRole("link", { name: "打开画布 " + title, exact: true })).toBeVisible();
  } finally {
    await page.unroute("**/api/canvases");
  }
});
