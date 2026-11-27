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

// Thumbnails and the "参考内容" caption are gone in the collapsed bar; the
// reference deck itself stays as the compact "+" (count badge when filled).
async function collapsedDeckIsCompact(page: Page) {
  return page.evaluate(() => {
    const dock = document.querySelector("#home-composer .composer-dock")!;
    const deck = dock.querySelector<HTMLElement>(".reference-deck");
    const box = deck?.getBoundingClientRect();
    const extras = [...dock.querySelectorAll(".reference-layer, .reference-deck-empty small, .composer-utilities, .composer-credit, .composer-status")];
    return {
      compactDeck: !box || (box.width <= 44 && box.height <= 44),
      extrasHidden: extras.every((element) => !element.getClientRects().length),
    };
  });
}

async function clearPrompt(page: Page) {
  const prompt = page.locator("#home-composer #prompt");
  await prompt.tap();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  await expect(prompt).toHaveText("");
  await page.keyboard.press("Escape");
}

async function checkDockCollapseExpand(page: Page) {      // 创作页
  const dock = page.locator("#home-composer .composer-dock");
  await expect(dock).toHaveAttribute("data-expanded", "false");
  assert.deepEqual(await collapsedDeckIsCompact(page), { compactDeck: true, extrasHidden: true });
  const box = await dock.locator(".composer-dock-sheet").boundingBox();
  assert.ok(box!.y + box!.height <= 667 - 56 + 1, "收起态贴在标签栏上方");
  await dock.locator("#prompt").tap();
  await expect(dock).toHaveAttribute("data-expanded", "true");
  await expect(page.locator(".mobile-tabbar")).toBeHidden();
  await expect(dock.locator("#prompt")).toHaveCSS("font-size", "16px");
  await page.keyboard.press("Escape");
  await expect(dock).toHaveAttribute("data-expanded", "false");
  await expect(page.locator(".mobile-tabbar")).toBeVisible();
  await dock.locator("#prompt").tap();
  await expect(dock).toHaveAttribute("data-expanded", "true");
  await page.locator(".composer-dock-backdrop").tap({ position: { x: 10, y: 10 } });
  await expect(dock).toHaveAttribute("data-expanded", "false");
  await dock.locator("#prompt").tap();
  await page.locator(".composer-dock-handle").tap();
  await expect(dock).toHaveAttribute("data-expanded", "false");
}

async function hasImageReferenceModel(page: Page) {
  const references = page.locator("#home-composer .composer-references");
  const noModel = (await page.locator("#home-composer .model-name").innerText()).includes("暂无可用模型");
  return !noModel && (await references.getAttribute("hidden")) === null;
}

async function clearReferences(page: Page) {
  if (!(await page.locator("#home-composer .reference-layer").count())) return;
  await page.locator('#home-composer [data-act="reference"]').tap();
  while (await page.locator('#popover [data-act="unref"]').count())
    await page.locator('#popover [data-act="unref"]').first().tap();
  await page.keyboard.press("Escape");
  await expect(page.locator("#home-composer .reference-layer")).toHaveCount(0);
}

async function checkLongDraft(page: Page) {               // Review Focus 1
  const dock = page.locator("#home-composer .composer-dock");
  const prompt = page.locator("#home-composer #prompt");
  const withRefs = await hasImageReferenceModel(page);
  await clearPrompt(page);
  if (withRefs) {
    await page.setInputFiles("#home-composer #files", { name: "draft-ref.png", mimeType: "image/png", buffer: png });
    await expect(page.locator("#home-composer .reference-layer")).toHaveCount(1);
  }
  await prompt.tap();
  // A remount would drop this marker together with the old element.
  await prompt.evaluate((element) => { element.dataset.mountProbe = "kept"; });
  await page.keyboard.insertText(longDraft);              // 与 mobile-asset-composer 测试相同的 24 行文本
  const caretAtEnd = () => prompt.evaluate((element) => {
    const selection = getSelection()!;
    if (!selection.rangeCount || !element.contains(selection.focusNode)) return false;
    const range = document.createRange();
    range.selectNodeContents(element);
    range.setEnd(selection.focusNode!, selection.focusOffset);
    return range.toString().length === element.textContent!.length;
  });
  await expect.poll(caretAtEnd).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dock).toHaveAttribute("data-expanded", "false");
  const collapsed = await page.locator("#home-composer .composer-dock-sheet").boundingBox();
  assert.ok(collapsed!.height <= 160, `收起态高度 ${collapsed!.height}`);
  const promptBox = await prompt.boundingBox();
  assert.ok(promptBox!.height <= 40, `收起态提示词高度 ${promptBox!.height}`);
  if (withRefs) {
    await expect(dock.locator(".reference-deck-count")).toHaveText("1");
    await expect(dock.locator(".reference-layer")).toBeHidden();
  }
  await prompt.tap();
  await expect(dock).toHaveAttribute("data-expanded", "true");
  assert.equal((await prompt.innerText()).trimEnd(), longDraft.trimEnd());
  await expect(prompt).toHaveAttribute("data-mount-probe", "kept");
  await expect.poll(caretAtEnd, { message: "caret returns after Escape fold" }).toBe(true);
  if (withRefs) {
    await expect(dock.locator(".reference-layer").first()).toBeVisible();
  }
  // Folding via the handle button (which blurs #prompt before click) also preserves caret.
  await page.locator(".composer-dock-handle").tap();
  await expect(dock).toHaveAttribute("data-expanded", "false");
  await prompt.tap();
  await expect(dock).toHaveAttribute("data-expanded", "true");
  await expect.poll(caretAtEnd, { message: "caret returns after handle fold" }).toBe(true);
  if (withRefs) await clearReferences(page);
  await page.keyboard.press("Escape");
  await clearPrompt(page);
}

async function checkWidenClearsDock(page: Page) {         // Review Focus 2
  await page.locator("#home-composer #prompt").tap();
  await expect(page.locator(".composer-dock-backdrop")).toHaveCount(1);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator(".composer-dock-backdrop")).toHaveCount(0);
  await expect(page.locator(".composer-dock-handle")).toHaveCount(0);
  await expect(page.locator(".mobile-tabbar")).toHaveCount(0);
  await expect(page.locator(".composer-dock-sheet")).toHaveCSS("position", "static");
  assert.equal(await page.evaluate(() => document.querySelector<HTMLElement>(".shell")!.style.getPropertyValue("--mobile-dock-height")), "");
  await page.setViewportSize({ width: 375, height: 667 });
  await expect(page.locator("#home-composer .composer-dock")).toHaveAttribute("data-expanded", "false");
}

async function checkPickingReturnsExpanded(page: Page) {  // Review Focus 5
  if (!(await hasImageReferenceModel(page))) {
    await page.locator("#home-composer #prompt").tap();
    await page.getByRole("button", { name: "添加参考内容" }).tap();
    await page.getByRole("button", { name: "从资产选择", exact: true }).tap();
    await page.getByRole("button", { name: "完成选择", exact: true }).tap();
    await expect(page.locator("#home-composer .composer-dock")).toHaveAttribute("data-expanded", "true");
    await expect(page.locator(".mobile-tabbar")).toBeHidden();
    await page.keyboard.press("Escape");
    console.log("checkPickingReturnsExpanded: verified expanded return (asset attach skipped without configured video/image model)");
    return;
  }
  // 先上传一张图片作为资产：ffmpeg 生成 64×64 PNG，写入 #files
  await page.setInputFiles("#home-composer #files", { name: "pick.png", mimeType: "image/png", buffer: png });
  await expect(page.locator("#home-composer .reference-layer")).not.toHaveCount(0);
  // 清空引用后再从资产里选回来
  await page.locator("#home-composer #prompt").tap();
  await clearReferences(page);
  await expect(page.locator("#home-composer .composer-dock")).toHaveAttribute("data-expanded", "true");
  await page.getByRole("button", { name: "添加参考内容" }).tap();
  await page.getByRole("button", { name: "从资产选择", exact: true }).tap();
  // Picking keeps the full floating composer over the grid (unchanged by the
  // dock), so tap the part of the first image that stays uncovered.
  const target = page.locator(".asset-preview").first();
  await target.scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const top = document.querySelector(".asset-top")!.getBoundingClientRect().bottom;
    scrollBy(0, document.querySelector(".asset-preview")!.getBoundingClientRect().top - top - 8);
  });
  const point = await target.evaluate((button) => {
    const box = button.getBoundingClientRect();
    for (let y = box.top + 4; y < box.bottom; y += 8)
      for (let x = box.left + 4; x < box.right; x += 8)
        if (button.contains(document.elementFromPoint(x, y))) return { x, y };
    return null;
  });
  assert.ok(point, "the first asset is reachable while picking");
  await page.touchscreen.tap(point.x, point.y);
  await expect(target).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "完成选择", exact: true }).tap();
  await expect(page.locator("#home-composer .composer-dock")).toHaveAttribute("data-expanded", "true");
  await expect(page.locator("#home-composer .reference-layer")).not.toHaveCount(0);
  await expect(page.locator(".mobile-tabbar")).toBeHidden();
  await clearReferences(page);
  await page.keyboard.press("Escape");
}

async function checkMenuSheet(page: Page) {
  const dock = page.locator("#home-composer .composer-dock");
  const sheet = page.locator("#popover");
  await page.locator("#home-composer #prompt").tap();
  await expect(dock).toHaveAttribute("data-expanded", "true");
  const triggers = ["#home-composer .creation-type"];
  if (await page.locator("#home-composer .model-name").isEnabled())
    triggers.push("#home-composer .model-name");
  for (const selector of triggers) {
    const trigger = page.locator(selector);
    await trigger.tap();
    await expect(sheet).toHaveAttribute("data-sheet", "");
    await expect(sheet).toHaveCSS("translate", "none");
    const box = (await sheet.boundingBox())!;
    assert.ok(
      Math.abs(box.x) <= 1 && Math.abs(box.width - 375) <= 1 && Math.abs(box.y + box.height - 667) <= 1,
      `unexpected sheet geometry for ${selector}: ${JSON.stringify(box)}`,
    );
    const stackedOnTop = await page.evaluate((y) => {
      const hit = document.elementFromPoint(187, y);
      return !!hit?.closest("#popover");
    }, box.y + Math.min(24, box.height / 2));
    assert.ok(stackedOnTop, `${selector} sheet stacks above expanded composer dock`);
    const optionHeights = await sheet.locator('[role="option"]:visible').evaluateAll((items) =>
      items.map((item) => item.getBoundingClientRect().height));
    assert.ok(optionHeights.length > 0 && optionHeights.every((height) => height >= 43.5), `option heights >= 44px: ${optionHeights}`);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(dock).toHaveAttribute("data-expanded", "true");
    await expect(trigger).toBeFocused();
  }
  await page.keyboard.press("Escape");
  await expect(dock).toHaveAttribute("data-expanded", "false");

  // Top-bar workspace sheet + dialog focus return to the visible mobile switch.
  const mobileSwitch = page.locator(".mobile-workspace-switch");
  await mobileSwitch.tap();
  await expect(sheet).toHaveAttribute("data-sheet", "");
  const itemHeights = await sheet.locator(".space-option:visible, .space-create:visible").evaluateAll((items) =>
    items.map((item) => item.getBoundingClientRect().height));
  assert.ok(itemHeights.length > 0 && itemHeights.every((height) => height >= 43.5), `workspace menu heights >= 44px: ${itemHeights}`);
  if (await sheet.locator('[data-act="create-workspace"]').count()) {
    await sheet.locator('[data-act="create-workspace"]').tap();
    await expect(page.locator("#modal[open]")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#modal[open]")).toHaveCount(0);
    await expect(mobileSwitch).toBeFocused();
  } else {
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  }

  // Desktop (>760px) removes data-sheet and positions popover next to trigger.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator("#home-composer .creation-type").click();
  await expect(sheet).toBeVisible();
  await expect(sheet).not.toHaveAttribute("data-sheet");
  const desktopBox = (await sheet.boundingBox())!;
  assert.ok(desktopBox.width < 375, `desktop popover width ${desktopBox.width}`);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await page.setViewportSize({ width: 375, height: 667 });
}

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((value) => {
    (window as Window & { setFumiaoTheme?: (next: "light" | "dark") => void }).setFumiaoTheme?.(value);
  }, theme);
}

async function checkDarkSurfaces(page: Page) {             // Review Focus 4
  await setTheme(page, "dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.locator(".mobile-account").tap();
  const sheet = page.locator("#popover");
  await expect(sheet).toHaveAttribute("data-sheet", "");
  const menuItemHeights = await sheet.locator(".menu-item:visible").evaluateAll((items) =>
    items.map((item) => item.getBoundingClientRect().height));
  assert.ok(menuItemHeights.length > 0 && menuItemHeights.every((height) => height >= 43.5), `menu-item heights >= 44px: ${menuItemHeights}`);
  const backgrounds = await page.evaluate(() =>
    [".mobile-topbar", ".mobile-tabbar", "#popover"].map((s) => getComputedStyle(document.querySelector(s)!).backgroundColor));
  for (const color of backgrounds) {
    assert.notEqual(color, "rgb(255, 255, 255)");
    assert.notEqual(color, "rgba(0, 0, 0, 0)");
  }
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await page.locator("#home-composer #prompt").tap();
  await expect(page.locator("#home-composer .composer-dock")).toHaveAttribute("data-expanded", "true");
  const dockColor = await page.evaluate(() =>
    getComputedStyle(document.querySelector("#home-composer .composer-dock-sheet")!).backgroundColor);
  assert.notEqual(dockColor, "rgb(255, 255, 255)");
  assert.notEqual(dockColor, "rgba(0, 0, 0, 0)");
  if (evidence) await page.screenshot({ path: `${evidence}/checkDarkSurfaces-dark.png`, animations: "disabled" });
  await page.keyboard.press("Escape");
  await setTheme(page, "light");
}

const checks = [
  checkTabBar, checkDrawerClosesAfterNavigation, checkLongWorkspaceName,
  checkDockCollapseExpand, checkLongDraft, checkWidenClearsDock, checkPickingReturnsExpanded,
  checkMenuSheet, checkDarkSurfaces,
];

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
