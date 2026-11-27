import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { chromium, expect, type Page } from "@playwright/test";

// STUDIO_URL (origin without /studio), STUDIO_USER and STUDIO_PASSWORD point
// the checks at a running Studio, such as a worktree's Docker environment.
// Without STUDIO_URL the isolated fixture harness starts, as in CI.
const evidence = process.env.MOBILE_LAYOUT_EVIDENCE;
// Shared inputs for the composer dock checks.
const longDraft = "镜头缓慢向前移动，保留参考视频的色彩与构图。\n".repeat(24).trimEnd();
const png = execFileSync("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=teal:s=64x64",
  "-frames:v", "1", "-f", "image2", "-c:v", "png", "pipe:1",
]);

async function checkTabBar(page: Page) {
  const tabs = page.locator(".mobile-tabbar");
  await expect(page.locator(".side")).not.toBeInViewport();          // 收起时无常驻图标栏
  await expect(page.locator(".workspace")).toHaveCSS("margin-left", "0px");
  await expect(tabs.locator("[data-tab]")).toHaveText(["创作", "画布", "对话", "资产", "队列"]);
  await tabs.locator('[data-tab="library"]').tap();
  await expect(tabs.locator('[data-tab="library"]')).toHaveAttribute("aria-current", "page");
  await expect(tabs.locator('[data-tab="home"]')).not.toHaveAttribute("aria-current", "page");
}

async function checkDrawerClosesAfterNavigation(page: Page) {
  await page.getByRole("button", { name: "打开导航" }).tap();
  await expect(page.locator(".rail-backdrop")).toBeVisible();
  await page.locator('.side [data-nav="queue"]').tap();
  await expect(page.locator(".rail-backdrop")).toBeHidden();
  await expect(page.locator(".workspace")).toHaveJSProperty("inert", false);
  await expect(page.locator('.mobile-tabbar [data-tab="queue"]')).toHaveAttribute("aria-current", "page");
  // Keyboard: choosing a page closes the drawer and returns focus to its opener.
  const menu = page.getByRole("button", { name: "打开导航" });
  await menu.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".side .collapse-button")).toBeFocused();
  await page.locator('.side [data-nav="library"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".rail-backdrop")).toBeHidden();
  await expect(menu).toBeFocused();
  await expect(page.locator('.mobile-tabbar [data-tab="library"]')).toHaveAttribute("aria-current", "page");
}

async function checkLongWorkspaceName(page: Page) {
  // 用 DOM 临时替换名称，检查截断效果而不依赖测试数据
  const fits = await page.evaluate(() => {
    const name = document.querySelector<HTMLElement>(".mobile-workspace-switch .space-button-name")!;
    name.textContent = "非常非常长的团队空间名称用于测试顶栏截断效果".repeat(2);
    const bar = document.querySelector<HTMLElement>(".mobile-topbar")!;
    const avatar = document.querySelector<HTMLElement>(".mobile-account")!.getBoundingClientRect();
    return { noOverflow: bar.scrollWidth <= bar.clientWidth, avatarVisible: avatar.right <= innerWidth,
      ellipsis: getComputedStyle(name).textOverflow };
  });
  assert.deepEqual(fits, { noOverflow: true, avatarVisible: true, ellipsis: "ellipsis" });
}

const checks = [checkTabBar, checkDrawerClosesAfterNavigation, checkLongWorkspaceName];

async function fixture(harness: ChildProcess) {
  return new Promise<RegExpMatchArray>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`Studio harness startup timed out\n${output}`)), 180_000);
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/Isolated Studio (http:\/\/[^\s]+)\/studio\nSynthetic login ([^\s]+) \/ ([^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match); }
    };
    harness.stdout!.on("data", collect);
    harness.stderr!.on("data", collect);
    harness.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Studio harness exited: ${code}\n${output}`)); });
  });
}

const external = process.env.STUDIO_URL;
const harness = external ? undefined : spawn(
  process.execPath, ["--import", "tsx", "tests/integration/smoke-studio-nest.ts", "--serve"],
  { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
);
const exited = harness && once(harness, "exit");
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  const [origin, user, password] = harness
    ? (await fixture(harness)).slice(1)
    : [external!.replace(/\/+$/, ""), process.env.STUDIO_USER ?? "admin", process.env.STUDIO_PASSWORD ?? ""];
  if (evidence) await mkdir(evidence, { recursive: true });
  browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: origin, viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.goto(origin + "/studio");
  await page.locator('[name="user"]').fill(user);
  await page.locator('[name="pw"]').fill(password);
  await page.locator('.auth-form [type="submit"]').tap();
  await expect(page.locator(".shell")).toBeVisible();
  for (const check of checks) {
    await page.goto(origin + "/studio");
    await expect(page.locator(".shell")).toBeVisible();
    await check(page);
    if (evidence) await page.screenshot({ path: `${evidence}/${check.name}.png`, animations: "disabled" });
    console.log(`${check.name}: passed`);
  }
  await context.close();
} finally {
  await browser?.close();
  harness?.kill("SIGTERM");
  await exited;
}
