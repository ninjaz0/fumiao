import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { chromium, expect, type Locator, type Page } from "@playwright/test";

const evidence = process.env.MOBILE_ASSET_COMPOSER_EVIDENCE;
const longDraft = "镜头缓慢向前移动，保留参考视频的色彩与构图。\n".repeat(24).trimEnd();
const fixture = execFileSync("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x240:r=24:d=4",
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1",
]);
const harness = spawn(process.execPath, ["--import", "tsx", "tests/integration/smoke-studio-nest.ts", "--serve"], {
  env: process.env, stdio: ["ignore", "pipe", "pipe"],
});
const exited = once(harness, "exit");
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

async function checkTaps(page: Page, preview: Locator, description: string) {
  const failures: string[] = [];
  for (const corner of ["center", "top left", "top right", "bottom left", "bottom right"]) {
    await page.evaluate(() => scrollTo(0, 0));
    await page.mouse.move(2, 2);
    const point = await preview.evaluate((button, corner) => {
      const { left, right, top, bottom } = button.getBoundingClientRect();
      const x = Math.round(corner.endsWith("left") ? left + 16 : corner.endsWith("right") ? right - 16 : (left + right) / 2);
      // The card's separate quick actions occupy the top 36px.
      const y = Math.round(corner.startsWith("top") ? top + 40 : corner.startsWith("bottom") ? bottom - 16 : (top + bottom) / 2);
      const hit = document.elementFromPoint(x, y);
      return { x, y, preview: button.contains(hit), hit: hit?.closest("#asset-composer") ? "composer" : hit?.tagName ?? "outside viewport" };
    }, corner);
    await page.touchscreen.tap(point.x, point.y);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const dialog = page.locator("#modal[open] .h3-media-preview video");
    if (point.preview) {
      await expect(dialog, `${description}: ${corner} tap should open the video`).toBeVisible();
    } else {
      failures.push(`${description}: ${corner} hit ${point.hit}, not the preview`);
    }
    if (await dialog.isVisible()) {
      await page.getByRole("button", { name: "关闭", exact: true }).tap();
      await expect(dialog).toBeHidden();
    } else if (await page.locator("#modal[open]").isVisible()) {
      await page.keyboard.press("Escape");
      await expect(page.locator("#modal[open]")).toBeHidden();
    }
    if (await page.locator("#popover.open").isVisible()) {
      await page.keyboard.press("Escape");
      await expect(page.locator("#popover")).toBeHidden();
    }
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  }
  if (!failures.length) console.log(`${description}: center and four corners hit the preview and open video`);
  return failures;
}

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
  if (evidence) await mkdir(evidence, { recursive: true });
  browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: origin, viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const screenshot = async (name: string) => {
    if (!evidence) return;
    await page.mouse.move(2, 2);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.screenshot({ path: `${evidence}/${name}.png`, animations: "disabled" });
  };
  await page.goto("/studio");
  await page.locator('[name="user"]').fill(user);
  await page.locator('[name="pw"]').fill(password);
  await page.locator('.auth-form [type="submit"]').tap();
  await expect(page.getByRole("button", { name: "选择模型，当前MiniMax H3" })).toBeVisible();
  await expect(page.getByRole("button", { name: "选择参考模式" })).toHaveText("全能参考");
  const reference = page.locator(".composer-references video");
  await page.getByRole("button", { name: "添加参考内容" }).tap();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "上传素材" }).tap();
  await (await chooser).setFiles({ name: "mobile-asset-preview.mp4", mimeType: "video/mp4", buffer: fixture });
  await expect(reference).toBeVisible();
  const source = await reference.getAttribute("src");
  assert.ok(source, "Uploaded video is attached to the draft");

  const preview = page.locator("#library-grid .asset-preview");
  const showAssets = async () => {
    await page.locator('.mobile-tabbar [data-tab="library"]').tap();
    await expect(page.getByRole("tab", { name: "视频", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(preview).toHaveCount(1);
    await expect(preview.locator("video")).toHaveAttribute("src", source);
    await expect.poll(() => preview.locator("video").evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThan(1);
    await page.evaluate(() => scrollTo(0, 0));
  };
  const home = page.locator('.mobile-tabbar [data-tab="home"]');
  const homePrompt = page.locator("#home-composer .prompt");
  const sizes = [{ width: 375, height: 667 }, { width: 320, height: 568 }, { width: 390, height: 844 }];
  const failures: string[] = [];
  for (const viewport of sizes) {
    const name = `${viewport.width}x${viewport.height}`;
    await page.setViewportSize(viewport);
    for (const [label, draft] of [["default", ""], ["long-draft", longDraft]]) {
      if (!(await homePrompt.isVisible())) await home.tap();
      await homePrompt.fill(draft);
      await homePrompt.blur();
      await showAssets();
      await screenshot(`${name}-${label}`);
      failures.push(...await checkTaps(page, preview, `${name} ${label}`));
    }
  }
  assert.equal(failures.length, 0, `Unreachable asset preview points:\n${failures.join("\n")}`);

  for (const viewport of sizes) {
    const name = `${viewport.width}x${viewport.height}`;
    await page.setViewportSize(viewport);
    const expand = page.getByRole("button", { name: "展开创作框", exact: true });
    const collapse = page.getByRole("button", { name: "收起创作框", exact: true });
    const prompt = page.locator("#asset-composer .prompt");
    const checkDraft = async () => {
      await expect(prompt).toBeVisible();
      await expect.poll(() => prompt.innerText()).toBe(longDraft);
      await expect(reference).toHaveAttribute("src", source);
    };
    await expand.tap();
    await checkDraft();
    assert.deepEqual(await checkTaps(page, preview, `${name} expanded`), []);
    await collapse.tap();
    await expect(prompt).toBeHidden();
    await expand.tap();
    await checkDraft();
    if (viewport.width === 375) {
      await prompt.tap();
      await expect(prompt).toBeFocused();
      await screenshot("375x667-expanded-draft");
    }
    await collapse.tap();
    await page.evaluate(() => scrollTo(0, 0));
    await page.getByRole("button", { name: "多选", exact: true }).tap();
    await expect(expand).toBeHidden();
    await preview.tap();
    await expect(preview.locator("..")).toHaveClass(/is-selected/);
    await page.getByRole("button", { name: "取消选择", exact: true }).tap();
    console.log(`${name}: collapse/reopen preserves prompt and video reference; 多选 still selects the asset`);
  }
  await context.close();
} finally {
  await browser?.close();
  harness.kill("SIGTERM");
  await exited;
}
