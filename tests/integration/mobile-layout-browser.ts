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

async function hideDevPortal(page: Page) {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
}

async function ensureLibraryImage(page: Page): Promise<string | null> {
  await page.locator('.mobile-tabbar [data-tab="library"]').tap();
  if (await page.locator(".asset-card").count()) return null;
  await page.locator('.asset-filter [data-tab="images"]').tap();
  if (await page.locator(".asset-card").count()) return null;
  const createdId = await page.evaluate(async (bytes) => {
    const response = await fetch("/api/assets", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "image/png", "X-File-Name": "touch-target.png" },
      body: new Uint8Array(bytes),
    });
    if (!response.ok) throw new Error(`upload failed: ${response.status}`);
    const data = (await response.json()) as { id: string };
    return data.id;
  }, [...png]);
  await page.goto("/studio");
  await expect(page.locator(".shell")).toBeVisible();
  await hideDevPortal(page);
  await page.locator('.mobile-tabbar [data-tab="library"]').tap();
  await page.locator('.asset-filter [data-tab="images"]').tap();
  await expect(page.locator(".asset-card").first()).toBeVisible();
  return createdId;
}

async function removeAsset(page: Page, id: string | null) {
  if (!id) return;
  await page.evaluate(async (assetId) => {
    await fetch(`/api/assets/${encodeURIComponent(assetId)}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
  }, id);
}

async function lastViewControlCovered(page: Page) {
  return page.evaluate(() => {
    scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
    const items = [
      ...document.querySelectorAll<HTMLElement>("#view button, #view a[href], #view label.model-switch"),
    ].filter(
      (e) =>
        !e.closest(".composer-dock, #asset-composer, .mobile-tabbar, .mobile-topbar") &&
        !e.closest("details:not([open]) > :not(summary)") &&
        e.checkVisibility() &&
        e.getClientRects().length > 0,
    );
    const last = items.at(-1);
    if (!last) return null;
    let r = last.getBoundingClientRect();
    // When a tall page ends with read-only cards/tables, its last button sits
    // near the top and scrolls above the sticky bars at max scrollY. Verify the
    // bottom card clears the tab bar first, then bring the button below headers.
    if (r.top < 104) {
      const tabbar = document.querySelector<HTMLElement>(".mobile-tabbar:not([hidden])");
      const blocks = [...document.querySelectorAll<HTMLElement>("#view .ledger-card, #view .empty-state")].filter(
        (e) => e.checkVisibility(),
      );
      const bottomBlock = blocks.at(-1);
      if (tabbar && bottomBlock) {
        const blockBottom = bottomBlock.getBoundingClientRect().bottom;
        const barTop = tabbar.getBoundingClientRect().top;
        if (blockBottom > barTop + 1) {
          return `bottomBlock=${bottomBlock.className} bottom=${blockBottom} > tabbarTop=${barTop}`;
        }
      }
      scrollBy({ top: r.top - 104, behavior: "instant" });
      r = last.getBoundingClientRect();
    }
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (hit && last.contains(hit)) return null;
    return `last=<${last.tagName.toLowerCase()} class="${last.className}" text="${last.textContent?.trim().slice(0, 24)}"> rect=${JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height })} hit=<${hit?.tagName.toLowerCase()} class="${(hit as HTMLElement | null)?.className}">`;
  });
}

async function checkNoOverflowAndNoCover(page: Page) {
  const createdId = await ensureLibraryImage(page);
  try {
    for (const tab of ["home", "chat", "library", "queue"] as const) {
      await page.locator(`.mobile-tabbar [data-tab="${tab}"]`).tap();
      if (tab === "library" && !(await page.locator(".asset-card").count())) {
        await page.locator('.asset-filter [data-tab="images"]').tap();
      }
      await page.waitForTimeout(300);
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${tab} 无横向滚动`,
      );
      if (tab === "chat") {
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1),
          "chat 无多余纵向页面滚动",
        );
      }
      if (evidence) {
        await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
        await page.screenshot({ path: `${evidence}/page-${tab}.png`, animations: "disabled" });
      }
      assert.equal(await lastViewControlCovered(page), null, `${tab} 最后一个可交互元素未被遮挡`);
      if (tab === "library") {
        await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
        await page.getByRole("button", { name: "多选", exact: true }).tap();
        const bulk = page.locator(".bulk-toolbar");
        await expect(bulk).toBeVisible();
        const bulkBox = (await bulk.boundingBox())!;
        assert.ok(
          Math.abs(bulkBox.y + bulkBox.height - (667 - 56 - 8)) <= 1.5,
          `多选工具条位于标签栏上方 8px: ${JSON.stringify(bulkBox)}`,
        );
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          "library 多选态无横向滚动",
        );
        if (evidence) {
          await page.screenshot({ path: `${evidence}/page-library-selecting.png`, animations: "disabled" });
        }
        await page.getByRole("button", { name: "取消选择", exact: true }).tap();
      }
    }
    // 设置页：通过账户菜单进入，并覆盖各分类横向溢出与底部遮挡检查
    await page.locator(".mobile-account").tap();
    await page.locator("#popover").getByRole("button", { name: "设置" }).tap();
    await expect(page.locator(".ledger-settings")).toBeVisible();
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      "设置无横向滚动",
    );
    assert.equal(await lastViewControlCovered(page), null, "设置默认分类最后一个可交互元素未被遮挡");
    const toggle = page.locator(".ledger-navigation-toggle");
    await expect(toggle).toBeVisible();
    const sections = [
      "profile", "general", "credits", "budgets", "apiTokens",
      "plugins", "models", "prices", "creditAdmin", "redeemAdmin",
      "workspaces", "team", "invites", "storage", "observability",
    ];
    for (const section of sections) {
      await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
      await toggle.tap();
      const option = page.locator(`.ledger-navigation-panel [data-act="settings-tab"][data-value="${section}"]`);
      if (!(await option.count())) {
        await toggle.tap();
        continue;
      }
      await option.tap();
      await page.waitForTimeout(200);
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `设置(${section}) 无横向滚动`,
      );
      if (section === "prices") {
        const priceWidths = await page.locator(".price-row input").evaluateAll((inputs) =>
          inputs.map((input) => getComputedStyle(input).width),
        );
        assert.ok(priceWidths.length > 0, "生成定价分类至少渲染一个价格输入框");
        assert.ok(
          priceWidths.every((width) => width === "112px"),
          `生成定价输入框保持 112px 宽度: ${priceWidths.join(", ")}`,
        );
        if (evidence) {
          await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
          await page.screenshot({ path: `${evidence}/page-settings-prices.png`, animations: "disabled" });
        }
      }
      if (evidence && ["plugins", "models", "credits", "team", "workspaces"].includes(section)) {
        await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
        await page.screenshot({ path: `${evidence}/page-settings-${section}.png`, animations: "disabled" });
      }
      assert.equal(await lastViewControlCovered(page), null, `设置(${section}) 最后一个可交互元素未被遮挡`);
    }
  } finally {
    await removeAsset(page, createdId);
  }
}

async function checkTouchTargets(page: Page) {
  const createdId = await ensureLibraryImage(page);
  try {
    const metrics = await page.evaluate(() => {
      const actions = [...document.querySelectorAll<HTMLElement>(".asset-actions button, .asset-actions a")].filter(
        (e) => e.getClientRects().length > 0,
      );
      const all = [
        ...document.querySelectorAll<HTMLElement>(
          ".mobile-tabbar button, .mobile-topbar button, .asset-actions button, .asset-actions a",
        ),
      ].filter((e) => e.getClientRects().length > 0);
      const small = all
        .map((e) => e.getBoundingClientRect())
        .filter((r) => r.width < 36 || r.height < 36).length;
      const actionVisible = actions.every((e) => Number(getComputedStyle(e.closest(".asset-actions")!).opacity) > 0);
      const expandedHit = actions.every((e) => {
        const after = getComputedStyle(e, "::after");
        if (after.content === "none" || after.content === "normal") return false;
        const r = e.getBoundingClientRect();
        const top = parseFloat(after.top) || 0;
        const bottom = parseFloat(after.bottom) || 0;
        const left = parseFloat(after.left) || 0;
        const right = parseFloat(after.right) || 0;
        return r.width - left - right >= 43.5 && r.height - top - bottom >= 43.5;
      });
      return { actionCount: actions.length, small, actionVisible, expandedHit };
    });
    assert.ok(metrics.actionCount > 0, "资产页至少渲染一组卡片操作按钮");
    assert.equal(metrics.small, 0, "顶栏、标签栏与卡片操作按钮尺寸均不小于 36px");
    assert.equal(metrics.actionVisible, true, "手机触屏下资产卡片操作按钮可见可达");
    assert.equal(metrics.expandedHit, true, "资产卡片操作按钮 ::after 触控区扩展至 44px");
    await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
    await page.getByRole("button", { name: "多选", exact: true }).tap();
    await expect(page.locator(".bulk-toolbar")).toBeVisible();
    const bulkTargets = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll<HTMLElement>(".bulk-toolbar button")].filter(
        (e) => e.getClientRects().length > 0,
      );
      const actionCount = document.querySelectorAll(".bulk-actions button").length;
      const under44 = buttons.filter((e) => {
        const r = e.getBoundingClientRect();
        const after = getComputedStyle(e, "::after");
        const hasAfter = after.content !== "none" && after.content !== "normal";
        const w = hasAfter ? r.width - (parseFloat(after.left) || 0) - (parseFloat(after.right) || 0) : r.width;
        const h = hasAfter ? r.height - (parseFloat(after.top) || 0) - (parseFloat(after.bottom) || 0) : r.height;
        return w < 43.5 || h < 43.5;
      }).length;
      return { actionCount, under44 };
    });
    assert.ok(bulkTargets.actionCount > 0, "多选工具条至少包含一组批量操作按钮");
    assert.equal(bulkTargets.under44, 0, "多选工具条与批量操作按钮触控尺寸均不小于 44px");
    await page.getByRole("button", { name: "取消选择", exact: true }).tap();

    await page.locator('.mobile-tabbar [data-tab="queue"]').tap();
    const queueActionTarget = await page.evaluate(() => {
      const surface = document.querySelector("#view .list-surface")!;
      const probe = document.createElement("div");
      probe.className = "job-row";
      probe.innerHTML = '<div class="job-actions"><button type="button" class="quiet-button">取消生成</button></div>';
      surface.appendChild(probe);
      try {
        const btn = probe.querySelector<HTMLElement>(".job-actions button")!;
        const r = btn.getBoundingClientRect();
        const after = getComputedStyle(btn, "::after");
        const hasAfter = after.content !== "none" && after.content !== "normal";
        const w = hasAfter ? r.width - (parseFloat(after.left) || 0) - (parseFloat(after.right) || 0) : r.width;
        const h = hasAfter ? r.height - (parseFloat(after.top) || 0) - (parseFloat(after.bottom) || 0) : r.height;
        return { w, h };
      } finally {
        probe.remove();
      }
    });
    assert.ok(
      queueActionTarget.w >= 43.5 && queueActionTarget.h >= 43.5,
      `队列任务操作按钮触控尺寸 >= 44×44px: ${JSON.stringify(queueActionTarget)}`,
    );

    await page.locator(".mobile-account").tap();
    await page.locator("#popover").getByRole("button", { name: "设置" }).tap();
    const toggleBox = (await page.locator(".ledger-navigation-toggle").boundingBox())!;
    assert.ok(toggleBox.height >= 43.5, `设置分类折叠按钮高度 >= 44px: ${toggleBox.height}`);
  } finally {
    await removeAsset(page, createdId);
  }
}

const checks = [
  checkTabBar, checkDrawerClosesAfterNavigation, checkLongWorkspaceName,
  checkDockCollapseExpand, checkLongDraft, checkWidenClearsDock, checkPickingReturnsExpanded,
  checkMenuSheet, checkDarkSurfaces,
  checkTouchTargets, checkNoOverflowAndNoCover,
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
    await hideDevPortal(page);
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
