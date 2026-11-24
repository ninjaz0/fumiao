import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium, expect, type Locator, type Page } from "@playwright/test";

async function tabTo(page: Page, tab: Locator) {
  for (let step = 0; step < 30; step++) {
    await page.keyboard.press("Tab");
    if (await tab.evaluate((node) => node === document.activeElement)) return;
  }
  await expect(tab).toBeFocused();
}

const harness = spawn(process.execPath, ["--import", "tsx", "tests/integration/smoke-studio-nest.ts", "--serve"], {
  stdio: ["ignore", "pipe", "pipe"],
});
const exited = once(harness, "exit");
const evidence = process.env.LIBRARY_TAB_FOCUS_EVIDENCE;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  const [, origin, user, password] = await new Promise<RegExpMatchArray>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`Studio harness startup timed out\n${output}`)), 180_000);
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/Isolated Studio (http:\/\/[^\s]+)\/studio\nSynthetic login ([^\s]+) \/ ([^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match); }
    };
    harness.stdout.on("data", collect);
    harness.stderr.on("data", collect);
    harness.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Studio harness exited: ${code}\n${output}`)); });
  });
  browser = await chromium.launch({ slowMo: evidence ? 200 : 0 });
  const login = await browser.newPage({ baseURL: origin });
  await login.goto("/studio");
  await login.locator('[name="user"]').fill(user);
  await login.locator('[name="pw"]').fill(password);
  await login.locator('.auth-form [type="submit"]').click();
  await expect(login.locator(".shell")).toBeVisible();
  const storageState = await login.context().storageState();
  await login.close();

  const context = await browser.newContext({
    baseURL: origin,
    storageState,
    reducedMotion: "reduce",
    viewport: { width: 1280, height: 900 },
    ...(evidence ? { recordVideo: { dir: evidence } } : {}),
  });
  try {
    const page = await context.newPage();
    await page.goto("/studio");
    const library = page.locator('nav [data-nav="library"]');
    const types = page.getByRole("tablist", { name: "资产类型" });
    const scopes = page.getByRole("tablist", { name: "资产视图" });
    const video = types.getByRole("tab", { name: "视频" });
    const history = scopes.getByRole("tab", { name: "生成历史" });
    const activeAfterEnter = [];
    for (const tab of [video, history]) {
      await library.click();
      await page.mouse.move(10, 10);
      await tabTo(page, tab);
      await page.keyboard.press("Enter");
      await expect(tab).toHaveAttribute("aria-selected", "true");
      const focus = await tab.evaluate((node) => ({
        selectedTab: node.textContent?.trim(),
        activeElement: document.activeElement?.tagName,
        focused: document.activeElement === node,
      }));
      activeAfterEnter.push(focus);
      if (evidence && tab === video) await page.screenshot({ path: `${evidence}/video-focus.png` });
    }
    assert.deepEqual(activeAfterEnter, [
      { selectedTab: "视频", activeElement: "BUTTON", focused: true },
      { selectedTab: "生成历史", activeElement: "BUTTON", focused: true },
    ], "Enter must preserve focus in both asset tab bars");
    console.log("Asset library Enter focus:", JSON.stringify(activeAfterEnter));

    async function navigate(list: Locator, steps: [string, string][]) {
      for (const [key, name] of steps) {
        await page.keyboard.press(key);
        const tab = list.getByRole("tab", { name, exact: true, selected: true });
        await expect(tab).toBeFocused();
        await expect(tab).toHaveAttribute("tabindex", "0");
        await expect(list.locator(
          '[role="tab"][aria-selected="false"]:not([tabindex="-1"])',
        )).toHaveCount(0);
      }
    }
    await navigate(scopes, [
      ["ArrowRight", "收藏夹"], ["ArrowLeft", "生成历史"],
      ["End", "收藏夹"], ["Home", "生成历史"], ["ArrowLeft", "收藏夹"],
      ["ArrowRight", "生成历史"],
    ]);
    await tabTo(page, video);
    await navigate(types, [
      ["ArrowRight", "图片"], ["ArrowLeft", "视频"], ["ArrowLeft", "语音"],
      ["ArrowRight", "视频"], ["End", "语音"], ["Home", "视频"],
    ]);
    console.log("Asset library ArrowLeft, ArrowRight, Home and End move focus and selection in both bars");
  } finally {
    await context.close();
  }
} finally {
  await browser?.close();
  harness.kill("SIGTERM");
  await exited;
}
