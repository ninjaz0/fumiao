import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium, expect, type Locator, type Page } from "@playwright/test";
import type { Job, StudioState } from "../../apps/web/studio/state.js";

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
  const page = await context.newPage();
  try {
    let newJob = false;
    const firstId = 987654321;
    await page.route("**/api/state", async (route) => {
      const response = await route.fetch();
      const state: StudioState = await response.json();
      const job: Job = {
        id: firstId,
        owner: state.me.id,
        author: state.me.name,
        kind: "video",
        model: "MiniMax H3",
        prompt: "轮询期间保持焦点",
        status: "queued",
        refs: [],
        seconds: 5,
        created: Math.floor(Date.now() / 1000),
        ratio: "16:9",
        quality: 480,
      };
      const jobs = newJob ? [{ ...job, id: job.id + 1 }, job] : [job];
      await route.fulfill({ response, json: { ...state, jobs: [...jobs, ...state.jobs] } });
    });
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

    for (const shortcut of [
      { key: "Home", ctrlKey: true },
      { key: "End", ctrlKey: true },
      { key: "ArrowRight", altKey: true },
      { key: "ArrowRight", metaKey: true },
    ]) {
      const uncanceled = await history.evaluate((node, init) =>
        node.dispatchEvent(new KeyboardEvent("keydown", {
          ...init, bubbles: true, cancelable: true,
        })), shortcut);
      assert.ok(uncanceled, `Modified ${shortcut.key} must retain its default behavior`);
      await expect(history).toBeFocused();
      await expect(history).toHaveAttribute("aria-selected", "true");
    }
    console.log("Asset library leaves modified keyboard shortcuts uncanceled");

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
    const original = page.getByRole("button", { name: `预览视频 #${firstId}` });
    await original.focus();
    newJob = true;
    await expect(page.getByRole("button", { name: `预览视频 #${firstId + 1}` })).toBeVisible({ timeout: 12_000 });
    await expect(original).toBeFocused();
    console.log("Adding a task during polling preserves focus on the existing asset");

    await page.locator('nav [data-nav="home"]').click();
    const trigger = page.getByRole("button", { name: "创作类型" });
    const popover = page.locator("#popover");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await trigger.press("Enter");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await expect(popover).toHaveAttribute("inert", "");
    await trigger.press("Enter");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(popover).not.toHaveAttribute("inert", "");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(popover).toHaveCSS("transition-duration", "0s");
    await page.keyboard.press("Escape");
    await expect(popover).toHaveAttribute("hidden", "");
    await expect(trigger).toBeFocused();
    console.log("Popover exits inert, reopens from the keyboard and respects a live reduced-motion preference");
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    await context.close();
  }
} finally {
  await browser?.close();
  harness.kill("SIGTERM");
  await exited;
}
