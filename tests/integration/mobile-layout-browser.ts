import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { chromium, expect, type Browser, type Page } from "@playwright/test";

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
  // Keyboard: navigating to Settings via the drawer's Account menu (#popover)
  // closes the drawer and returns focus to the mobile menu opener.
  await page.keyboard.press("Enter");
  await expect(page.locator(".side .collapse-button")).toBeFocused();
  await page.locator(".side .account").focus();
  await page.keyboard.press("Enter");
  const popoverSettings = page.locator('#popover [data-nav="settings"]');
  await expect(popoverSettings).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(popoverSettings).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".rail-backdrop")).toBeHidden();
  await expect(page.locator("#popover")).toBeHidden();
  await expect(page.locator(".workspace")).toHaveJSProperty("inert", false);
  await expect(page.locator(".ledger-settings")).toBeVisible();
  await expect(menu).toBeFocused();
  // Same-page keyboard selection via drawer Account -> Settings also returns focus.
  await page.keyboard.press("Enter");
  await expect(page.locator(".side .collapse-button")).toBeFocused();
  await page.locator(".side .account").focus();
  await page.keyboard.press("Enter");
  await expect(popoverSettings).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(popoverSettings).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".rail-backdrop")).toBeHidden();
  await expect(menu).toBeFocused();
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
  const expandedScrollTop = await prompt.evaluate((element) => element.scrollTop);
  assert.ok(expandedScrollTop > 0, `展开态长草稿应滚动到底部: scrollTop=${expandedScrollTop}`);
  await page.keyboard.press("Escape");
  await expect(dock).toHaveAttribute("data-expanded", "false");
  assert.equal(await prompt.evaluate((element) => element.scrollTop), 0, "Escape 收起后 #prompt.scrollTop 归零");
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
  await expect
    .poll(() => prompt.evaluate((element) => element.scrollTop), { message: "scrollTop restores after Escape fold" })
    .toBe(expandedScrollTop);
  if (withRefs) {
    await expect(dock.locator(".reference-layer").first()).toBeVisible();
  }
  // Folding via the handle button (which blurs #prompt before click) also preserves caret and resets scrollTop.
  await page.locator(".composer-dock-handle").tap();
  await expect(dock).toHaveAttribute("data-expanded", "false");
  assert.equal(await prompt.evaluate((element) => element.scrollTop), 0, "手柄收起后 #prompt.scrollTop 归零");
  await prompt.tap();
  await expect(dock).toHaveAttribute("data-expanded", "true");
  await expect.poll(caretAtEnd, { message: "caret returns after handle fold" }).toBe(true);
  await expect
    .poll(() => prompt.evaluate((element) => element.scrollTop), { message: "scrollTop restores after handle fold" })
    .toBe(expandedScrollTop);
  await page.locator(".composer-dock-backdrop").tap({ position: { x: 10, y: 10 } });
  await expect(dock).toHaveAttribute("data-expanded", "false");
  assert.equal(await prompt.evaluate((element) => element.scrollTop), 0, "遮罩收起后 #prompt.scrollTop 归零");
  if (withRefs) {
    await prompt.tap();
    await clearReferences(page);
    if (await dock.locator(".generate-button").isEnabled()) {
      const interceptSubmit = (route: import("@playwright/test").Route) =>
        route.request().method() === "POST" ? route.fulfill({ json: { id: 999999 } }) : route.continue();
      await page.route("**/api/*jobs", interceptSubmit);
      try {
        await dock.locator(".generate-button").tap();
        await expect(dock).toHaveAttribute("data-expanded", "false");
        assert.equal(await prompt.evaluate((element) => element.scrollTop), 0, "提交收起后 #prompt.scrollTop 归零");
      } finally {
        await page.unroute("**/api/*jobs", interceptSubmit);
      }
    } else {
      await page.keyboard.press("Escape");
    }
  }
  await clearPrompt(page);
  // Pressing Enter in contentEditable creates child block elements (<div>) that must also truncate with ellipsis when collapsed.
  await prompt.tap();
  await page.keyboard.type("第一行非常非常长的提示词内容用于验证回车生成子块元素时的单行省略号截断效果");
  await page.keyboard.press("Enter");
  await page.keyboard.type("第二行内容");
  await page.keyboard.press("Escape");
  await expect(dock).toHaveAttribute("data-expanded", "false");
  const blockEllipsis = await prompt.evaluate((element) => {
    const block = element.querySelector<HTMLElement>("div, p");
    const style = block ? getComputedStyle(block) : getComputedStyle(element);
    return {
      hasBlock: !!block,
      scrollTop: element.scrollTop,
      textOverflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
      overflow: style.overflow,
    };
  });
  assert.equal(blockEllipsis.hasBlock, true);
  assert.equal(blockEllipsis.scrollTop, 0);
  assert.equal(blockEllipsis.textOverflow, "ellipsis");
  assert.equal(blockEllipsis.whiteSpace, "nowrap");
  assert.equal(blockEllipsis.overflow, "hidden");
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
  // Opening the mobile drawer and widening to desktop clears backdrop and workspace inertness.
  await page.getByRole("button", { name: "打开导航" }).tap();
  await expect(page.locator(".rail-backdrop")).toBeVisible();
  await expect(page.locator(".workspace")).toHaveJSProperty("inert", true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator(".rail-backdrop")).toBeHidden();
  await expect(page.locator(".workspace")).toHaveJSProperty("inert", false);
  await page.setViewportSize({ width: 375, height: 667 });
  await expect(page.locator(".rail-backdrop")).toBeHidden();
  await expect(page.locator(".workspace")).toHaveJSProperty("inert", false);
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
  // Verify #popover[data-sheet] .advanced-mode-row .model-switch hit target (>= 44×44px) and 36×20px pill track.
  const measureSwitch = () =>
    page.evaluate(() => {
      const label = document.querySelector<HTMLElement>("#popover .advanced-mode-row .model-switch")!;
      const track = label.querySelector<HTMLElement>(":scope > span")!;
      const thumb = getComputedStyle(track, "::before");
      const labelRect = label.getBoundingClientRect();
      const trackRect = track.getBoundingClientRect();
      return {
        labelW: labelRect.width,
        labelH: labelRect.height,
        trackW: trackRect.width,
        trackH: trackRect.height,
        trackCenteredY: Math.abs(trackRect.top + trackRect.height / 2 - (labelRect.top + labelRect.height / 2)) <= 1,
        trackRightAligned: Math.abs(labelRect.right - trackRect.right) <= 1,
        thumbW: thumb.width,
        thumbH: thumb.height,
      };
    });
  const advancedTrigger = page.locator('#home-composer [data-menu="advanced"]');
  let checkedLiveAdvancedSwitch = false;
  if (await advancedTrigger.isVisible()) {
    await advancedTrigger.tap();
    await expect(sheet).toHaveAttribute("data-sheet", "");
    const switchLabel = sheet.locator(".advanced-mode-row .model-switch");
    if (await switchLabel.count()) {
      checkedLiveAdvancedSwitch = true;
      const metrics = await measureSwitch();
      assert.ok(
        metrics.labelW >= 43.5 && metrics.labelH >= 43.5,
        `快速模式开关触控尺寸 >= 44×44px: ${JSON.stringify(metrics)}`,
      );
      assert.equal(Math.round(metrics.trackW), 36, `快速模式开关胶囊轨道宽度保持 36px: ${metrics.trackW}`);
      assert.equal(Math.round(metrics.trackH), 20, `快速模式开关胶囊轨道高度保持 20px: ${metrics.trackH}`);
      assert.equal(metrics.trackCenteredY, true, "快速模式开关胶囊轨道垂直居中");
      assert.equal(metrics.trackRightAligned, true, "快速模式开关胶囊轨道右对齐");
      assert.equal(metrics.thumbW, "14px");
      assert.equal(metrics.thumbH, "14px");
      const fastInput = sheet.locator("#fast-mode");
      const initialChecked = await fastInput.isChecked();
      // Tap the outer expanded hit area (x: 4, y: 4 is outside the 36×20px track).
      await switchLabel.tap({ position: { x: 4, y: 4 } });
      assert.equal(await fastInput.isChecked(), !initialChecked, "点击扩展触控区域可切换快速模式开关");
      await switchLabel.tap({ position: { x: 4, y: 4 } });
      assert.equal(await fastInput.isChecked(), initialChecked);
    }
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  }
  if (!checkedLiveAdvancedSwitch) {
    await page.locator("#home-composer .creation-type").tap();
    await expect(sheet).toHaveAttribute("data-sheet", "");
    const metrics = await page.evaluate(() => {
      const pop = document.querySelector("#popover")!;
      const probe = document.createElement("div");
      probe.className = "advanced-mode-row";
      probe.innerHTML =
        '<span>快速模式</span><label class="model-switch"><input type="checkbox" role="switch" aria-label="快速模式"><span aria-hidden="true"></span></label>';
      pop.appendChild(probe);
      try {
        const label = probe.querySelector<HTMLElement>(".model-switch")!;
        const track = label.querySelector<HTMLElement>(":scope > span")!;
        const thumb = getComputedStyle(track, "::before");
        const labelRect = label.getBoundingClientRect();
        const trackRect = track.getBoundingClientRect();
        return {
          labelW: labelRect.width,
          labelH: labelRect.height,
          trackW: trackRect.width,
          trackH: trackRect.height,
          trackCenteredY: Math.abs(trackRect.top + trackRect.height / 2 - (labelRect.top + labelRect.height / 2)) <= 1,
          trackRightAligned: Math.abs(labelRect.right - trackRect.right) <= 1,
          thumbW: thumb.width,
          thumbH: thumb.height,
        };
      } finally {
        probe.remove();
      }
    });
    assert.ok(
      metrics.labelW >= 43.5 && metrics.labelH >= 43.5,
      `快速模式开关触控尺寸 >= 44×44px: ${JSON.stringify(metrics)}`,
    );
    assert.equal(Math.round(metrics.trackW), 36, `快速模式开关胶囊轨道宽度保持 36px: ${metrics.trackW}`);
    assert.equal(Math.round(metrics.trackH), 20, `快速模式开关胶囊轨道高度保持 20px: ${metrics.trackH}`);
    assert.equal(metrics.trackCenteredY, true, "快速模式开关胶囊轨道垂直居中");
    assert.equal(metrics.trackRightAligned, true, "快速模式开关胶囊轨道右对齐");
    assert.equal(metrics.thumbW, "14px");
    assert.equal(metrics.thumbH, "14px");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
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
        // Pinch-zoom (visualViewport.scale !== 1) clears --visual-viewport-height instead of shrinking #chat-root.
        const chatFullHeight = (await page.locator("#chat-root").boundingBox())!.height;
        const cdp = await page.context().newCDPSession(page);
        try {
          await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
          await expect
            .poll(() => page.evaluate(() => Math.round((window.visualViewport?.scale ?? 1) * 100)))
            .toBe(200);
          assert.equal(
            await page.evaluate(() => document.documentElement.style.getPropertyValue("--visual-viewport-height")),
            "",
            "双指缩放时移除 --visual-viewport-height",
          );
          const zoomedLayoutHeight = await page.evaluate(
            () => parseFloat(getComputedStyle(document.querySelector("#chat-root")!).height),
          );
          assert.ok(
            Math.abs(zoomedLayoutHeight - chatFullHeight) <= 1,
            `双指缩放不压缩 #chat-root 高度: ${zoomedLayoutHeight} vs ${chatFullHeight}`,
          );
        } finally {
          await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
          await cdp.detach();
        }
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
    await toggle.tap();
    await expect(page.locator('.ledger-navigation-panel [data-act="settings-tab"][data-value="general"]')).toHaveCount(0);
    await expect(page.locator('.ledger-navigation-panel [data-act="settings-tab"][data-value="budgets"]')).toContainText("预算控制");
    await toggle.tap();
    const sections = [
      "profile", "credits", "budgets", "apiTokens",
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
      if (section === "apiTokens") {
        await expect(page.getByRole("heading", { name: "工作区技能（SKILL.md）" })).toBeVisible();
        await page.getByRole("button", { name: "新建 SKILL.md", exact: true }).tap();
        await expect(page.getByRole("textbox", { name: "SKILL.md 内容" })).toBeVisible();
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          "设置(apiTokens) 展开技能编辑器后无横向滚动",
        );
        assert.equal(await lastViewControlCovered(page), null, "设置(apiTokens) 技能编辑器最后一个可交互元素未被遮挡");
        await page.getByRole("button", { name: "取消", exact: true }).tap();
      }
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

async function checkCanvasList(page: Page) {
  await page.locator('.mobile-tabbar [data-tab="canvas"]').tap();
  await page.waitForURL(/\/canvas/);
  await expect(page.locator(".list-header")).toBeVisible();
  await hideDevPortal(page);
  const header = (await page.locator(".list-header").boundingBox())!;
  assert.ok(header.height <= 52 + 1, `画布列表顶栏 ${header.height}`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await expect(page.locator(".list-header .back-link")).toHaveCSS("min-height", "44px");

  // 顶栏背景、底边线与右侧空间名省略截断
  const listHeaderMetrics = await page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>(".list-header")!;
    const style = getComputedStyle(bar);
    const meta = bar.querySelector<HTMLElement>(":scope > span")!;
    const original = meta.textContent;
    meta.textContent = "非常非常长的团队空间名称用于测试画布顶栏省略 · 超级管理员".repeat(2);
    try {
      const metaStyle = getComputedStyle(meta);
      return {
        bg: style.backgroundColor,
        borderBottom: style.borderBottomWidth,
        noOverflow: bar.scrollWidth <= bar.clientWidth && document.documentElement.scrollWidth <= innerWidth,
        ellipsis: metaStyle.textOverflow,
      };
    } finally {
      meta.textContent = original;
    }
  });
  assert.notEqual(listHeaderMetrics.bg, "rgba(0, 0, 0, 0)", "画布列表顶栏具有实体背景色");
  assert.equal(listHeaderMetrics.borderBottom, "1px", "画布列表顶栏具有 1px 底边线");
  assert.equal(listHeaderMetrics.noOverflow, true, "画布列表顶栏右侧长空间名不溢出");
  assert.equal(listHeaderMetrics.ellipsis, "ellipsis", "画布列表顶栏右侧文字省略显示");

  // 深色主题下画布列表顶栏不透底、不发白
  await setTheme(page, "dark");
  const listDarkBg = await page.evaluate(() => getComputedStyle(document.querySelector(".list-header")!).backgroundColor);
  assert.notEqual(listDarkBg, "rgb(255, 255, 255)");
  assert.notEqual(listDarkBg, "rgba(0, 0, 0, 0)");
  if (evidence) await page.screenshot({ path: `${evidence}/page-canvas-list-dark.png`, animations: "disabled" });
  await setTheme(page, "light");

  // 剧集项目树已下线：页面不再渲染 .fm-series-panel，桌面端 72px 顶栏保持不变
  await expect(page.locator(".fm-series-panel")).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  const desktopHeader = (await page.locator(".list-header").boundingBox())!;
  assert.ok(Math.abs(desktopHeader.height - 72) <= 1, `桌面端画布列表顶栏保持 72px: ${desktopHeader.height}`);
  if (evidence) await page.screenshot({ path: `${evidence}/page-canvas-list-desktop.png`, animations: "disabled" });
  await page.setViewportSize({ width: 375, height: 667 });

  // 页面标题 20px、“新建画布”按钮 40px（触控 >= 44px）、分段切换 40px（触控 >= 44px）
  await expect(page.locator(".project-list-heading h1")).toHaveCSS("font-size", "20px");
  const headingControls = await page.evaluate(() => {
    const createBtn = document.querySelector<HTMLElement>('.project-list-heading button[aria-label="新建画布"]')!;
    const createRect = createBtn.getBoundingClientRect();
    const createAfter = getComputedStyle(createBtn, "::after");
    const createHasAfter = createAfter.content !== "none" && createAfter.content !== "normal";
    const createHitH = createHasAfter
      ? createRect.height - (parseFloat(createAfter.top) || 0) - (parseFloat(createAfter.bottom) || 0)
      : createRect.height;
    const tabs = document.querySelector<HTMLElement>(".canvas-list-tabs")!;
    const tabsRect = tabs.getBoundingClientRect();
    const tabBtns = [...tabs.querySelectorAll<HTMLElement>(":scope > button")];
    const tabHitHeights = tabBtns.map((b) => {
      const r = b.getBoundingClientRect();
      const a = getComputedStyle(b, "::after");
      const has = a.content !== "none" && a.content !== "normal";
      return has ? r.height - (parseFloat(a.top) || 0) - (parseFloat(a.bottom) || 0) : r.height;
    });
    return {
      createHeight: createRect.height,
      createHitH,
      tabsHeight: tabsRect.height,
      tabHitHeights,
    };
  });
  assert.ok(Math.abs(headingControls.createHeight - 40) <= 1, `新建画布按钮高度 40px: ${headingControls.createHeight}`);
  assert.ok(headingControls.createHitH >= 43.5, `新建画布按钮触控高度 >= 44px: ${headingControls.createHitH}`);
  assert.ok(Math.abs(headingControls.tabsHeight - 40) <= 1, `分段切换高度 40px: ${headingControls.tabsHeight}`);
  assert.ok(
    headingControls.tabHitHeights.every((h) => h >= 43.5),
    `分段切换按钮触控高度 >= 44px: ${headingControls.tabHitHeights.join(", ")}`,
  );

  // 画布编辑器顶栏验证：临时新建画布，检查 52px 顶栏、44px 返回按钮点击区、标题省略与无横向溢出，最后清理临时画布
  await page.getByRole("button", { name: "新建画布", exact: true }).tap();
  await page.waitForURL(/\/canvas\/[^/?]+/);
  const editorUrl = new URL(page.url());
  const canvasId = editorUrl.pathname.split("/")[2];
  const workspace = editorUrl.searchParams.get("workspace");
  try {
    await expect(page.locator(".canvas-header")).toBeVisible();
    await hideDevPortal(page);
    const editorHeader = (await page.locator(".canvas-header").boundingBox())!;
    assert.ok(Math.abs(editorHeader.height - 52) <= 1, `画布编辑器顶栏高度 52px: ${editorHeader.height}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "画布编辑器无横向滚动");

    const editorMetrics = await page.evaluate(() => {
      const bar = document.querySelector<HTMLElement>(".canvas-header")!;
      const barStyle = getComputedStyle(bar);
      const back = bar.querySelector<HTMLElement>(".cv-brand")!;
      const backRect = back.getBoundingClientRect();
      const after = getComputedStyle(back, "::after");
      const hasAfter = after.content !== "none" && after.content !== "normal";
      const backHitW = hasAfter ? backRect.width - (parseFloat(after.left) || 0) - (parseFloat(after.right) || 0) : backRect.width;
      const backHitH = hasAfter ? backRect.height - (parseFloat(after.top) || 0) - (parseFloat(after.bottom) || 0) : backRect.height;
      const input = bar.querySelector<HTMLInputElement>('.project-heading input[aria-label="画布名称"]')!;
      const prevVal = input.value;
      input.value = "非常非常长的画布项目标题用于测试手机端编辑器顶栏单行省略不换行".repeat(2);
      try {
        return {
          bg: barStyle.backgroundColor,
          borderBottom: barStyle.borderBottomWidth,
          backHitW,
          backHitH,
          titleEllipsis: getComputedStyle(input).textOverflow,
          headerHeightAfterLongTitle: bar.getBoundingClientRect().height,
          noPageOverflow: document.documentElement.scrollWidth <= innerWidth,
        };
      } finally {
        input.value = prevVal;
      }
    });
    assert.notEqual(editorMetrics.bg, "rgba(0, 0, 0, 0)", "画布编辑器顶栏具有实体背景色");
    assert.equal(editorMetrics.borderBottom, "1px", "画布编辑器顶栏具有 1px 底边线");
    assert.ok(
      editorMetrics.backHitW >= 43.5 && editorMetrics.backHitH >= 43.5,
      `画布编辑器返回按钮触控区 >= 44×44px: ${JSON.stringify(editorMetrics)}`,
    );
    assert.equal(editorMetrics.titleEllipsis, "ellipsis", "画布编辑器标题省略显示");
    assert.ok(
      editorMetrics.headerHeightAfterLongTitle <= 53 && editorMetrics.noPageOverflow,
      `长标题下画布编辑器顶栏保持单行 52px 且不溢出: ${JSON.stringify(editorMetrics)}`,
    );

    await setTheme(page, "dark");
    const editorDarkBg = await page.evaluate(() => getComputedStyle(document.querySelector(".canvas-header")!).backgroundColor);
    assert.notEqual(editorDarkBg, "rgb(255, 255, 255)");
    assert.notEqual(editorDarkBg, "rgba(0, 0, 0, 0)");
    if (evidence) await page.screenshot({ path: `${evidence}/page-canvas-editor-dark.png`, animations: "disabled" });
    await setTheme(page, "light");
    if (evidence) await page.screenshot({ path: `${evidence}/page-canvas-editor.png`, animations: "disabled" });
  } finally {
    const deleteRes = await page.context().request.delete(`/api/canvases/${encodeURIComponent(canvasId)}`, {
      headers: {
        Origin: editorUrl.origin,
        ...(workspace ? { "X-Workspace-Id": workspace } : {}),
      },
    });
    assert.ok([200, 204, 404].includes(deleteRes.status()), `清理临时画布失败: ${deleteRes.status()}`);
  }
  await page.goto(`/canvas${workspace ? `?workspace=${encodeURIComponent(workspace)}` : ""}`);
  await expect(page.locator(".list-header")).toBeVisible();
  await expect(page.locator(".project-list-body .empty")).toHaveCount(0);
  await hideDevPortal(page);

  const reqHeaders = {
    Origin: editorUrl.origin,
    ...(workspace ? { "X-Workspace-Id": workspace } : {}),
  };
  const seriesRes = await page.context().request.post("/api/series", {
    headers: reqHeaders,
    data: { title: "旧剧集接口下线验证", synopsis: "" },
  });
  assert.equal(seriesRes.status(), 404, "旧 /api/series 接口已下线并返回 404");
}

async function checkHomeAndLogin(browser: Browser, origin: string) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 667 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  try {
    const page = await context.newPage();
    await page.goto(origin + "/");
    await hideDevPortal(page);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "首页无横向滚动");
    const topRow = (await page.locator(".top-row").boundingBox())!;
    assert.ok(topRow.height <= 60, "首页顶栏一行放下");
    const ctas = await page.locator(".cta-row .button").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
    for (const w of ctas) assert.ok(w >= 375 - 32 - 1, "CTA 占满宽度");
    const ctaHeights = await page.locator(".cta-row .button").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    for (const h of ctaHeights) assert.ok(Math.abs(h - 48) <= 1, `CTA 高度 48px: ${h}`);
    await expect(page.locator(".stage")).toBeInViewport({ ratio: 0.05 });   // 首屏能看到示例画布上沿

    // 功能卡片、步骤首行对齐与首页触控热区
    const homeMetrics = await page.evaluate(() => {
      const featureCards = [...document.querySelectorAll<HTMLElement>("#main .features > li")];
      const cardsOk = featureCards.length === 4 && featureCards.every((li) => {
        const s = getComputedStyle(li);
        return (
          s.borderRadius === "14px" &&
          s.borderTopWidth === "1px" &&
          s.borderRightWidth === "1px" &&
          s.backgroundColor !== "rgba(0, 0, 0, 0)"
        );
      });
      const stepRow = document.querySelector<HTMLElement>("#main .steps > li")!;
      const stepNo = stepRow.querySelector<HTMLElement>(".step-no")!.getBoundingClientRect();
      const stepTitle = stepRow.querySelector<HTMLElement>("h3")!.getBoundingClientRect();
      const stepAligned = Math.abs(stepNo.top + stepNo.height / 2 - (stepTitle.top + stepTitle.height / 2)) <= 3;

      const controls = [
        ...document.querySelectorAll<HTMLElement>(
          ".top-row .brand, .top-actions button, .top-actions a, .cta-row .button, .foot .brand, .foot-links a",
        ),
      ].filter((e) => e.getClientRects().length > 0);
      const smallHit = controls
        .map((e) => {
          const r = e.getBoundingClientRect();
          const after = getComputedStyle(e, "::after");
          const hasAfter = after.content !== "none" && after.content !== "normal";
          const w = hasAfter ? r.width - (parseFloat(after.left) || 0) - (parseFloat(after.right) || 0) : r.width;
          const h = hasAfter ? r.height - (parseFloat(after.top) || 0) - (parseFloat(after.bottom) || 0) : r.height;
          return { tag: e.textContent?.trim() || e.getAttribute("aria-label") || e.tagName, w, h };
        })
        .filter((m) => m.w < 43.5 || m.h < 43.5);
      return { cardsOk, stepAligned, smallHit };
    });
    assert.equal(homeMetrics.cardsOk, true, "首页功能列表改为 14px 圆角四边卡片");
    assert.equal(homeMetrics.stepAligned, true, "步骤列表编号与正文标题首行对齐");
    assert.deepEqual(homeMetrics.smallHit, [], `首页交互元素触控尺寸均 >= 44×44px: ${JSON.stringify(homeMetrics.smallHit)}`);

    // 首页深色模式表面检查
    await setTheme(page, "dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const homeDarkCardBg = await page.evaluate(() =>
      getComputedStyle(document.querySelector("#main .features > li")!).backgroundColor,
    );
    assert.notEqual(homeDarkCardBg, "rgb(255, 255, 255)", "深色下首页功能卡片不发白");
    assert.notEqual(homeDarkCardBg, "rgba(0, 0, 0, 0)", "深色下首页功能卡片具有实体背景");
    if (evidence) await page.screenshot({ path: `${evidence}/page-home-dark.png`, animations: "disabled" });
    await setTheme(page, "light");
    if (evidence) await page.screenshot({ path: `${evidence}/page-home.png`, animations: "disabled" });

    // 320×568：覆盖 ≤380px 的顶栏规则与窄屏无横向滚动
    await page.setViewportSize({ width: 320, height: 568 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "320×568 首页无横向滚动");
    const narrowTopRow = (await page.locator(".top-row").boundingBox())!;
    assert.ok(narrowTopRow.height <= 60, `320×568 首页顶栏一行放下: ${narrowTopRow.height}`);
    await expect(page.locator(".top-actions .text-link.guest-only")).toBeHidden();

    // 1440×900 桌面端首页保持原布局不变
    await page.setViewportSize({ width: 1440, height: 900 });
    const desktopTopRow = (await page.locator(".top-row").boundingBox())!;
    assert.ok(Math.abs(desktopTopRow.height - 64) <= 1, `桌面端首页顶栏保持 64px: ${desktopTopRow.height}`);
    await expect(page.locator(".top-row .nav")).toBeVisible();
    await page.setViewportSize({ width: 375, height: 667 });

    // 登录与注册页检查
    await page.goto(origin + "/studio#login");
    await expect(page.getByRole("heading", { name: "登录工作台" })).toBeVisible();
    await hideDevPortal(page);
    await expect(page.locator('[name="user"]')).toHaveCSS("font-size", "16px");
    await expect(page.locator('[name="user"]')).toHaveCSS("height", "48px");
    await expect(page.locator('[name="pw"]')).toHaveCSS("font-size", "16px");
    await expect(page.locator('[name="pw"]')).toHaveCSS("height", "48px");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "登录无横向滚动");

    const authMetrics = await page.evaluate(() => {
      const wrap = document.querySelector<HTMLElement>(".auth-wrap")!;
      const wrapStyle = getComputedStyle(wrap);
      const art = document.querySelector<HTMLElement>(".auth-art")!.getBoundingClientRect();
      const form = document.querySelector<HTMLElement>(".auth-form")!.getBoundingClientRect();
      const controls = [
        ...document.querySelectorAll<HTMLElement>(
          '.auth .appearance, .auth .auth-home, .auth [data-act="toggle-password"], .auth-form .primary, #auth-switch',
        ),
      ];
      const smallHit = controls
        .map((e) => {
          const r = e.getBoundingClientRect();
          const after = getComputedStyle(e, "::after");
          const hasAfter = after.content !== "none" && after.content !== "normal";
          const w = hasAfter ? r.width - (parseFloat(after.left) || 0) - (parseFloat(after.right) || 0) : r.width;
          const h = hasAfter ? r.height - (parseFloat(after.top) || 0) - (parseFloat(after.bottom) || 0) : r.height;
          return { id: e.id || e.className, w, h };
        })
        .filter((m) => m.w < 43.5 || m.h < 43.5);
      return {
        borderTop: wrapStyle.borderTopWidth,
        boxShadow: wrapStyle.boxShadow,
        artHeight: art.height,
        formLeft: form.left,
        formWidth: form.width,
        smallHit,
      };
    });
    assert.equal(authMetrics.borderTop, "0px", "手机端登录卡片去掉边框");
    assert.equal(authMetrics.boxShadow, "none", "手机端登录卡片去掉阴影");
    assert.ok(authMetrics.artHeight <= 88, `登录品牌横幅高度 <= 88px: ${authMetrics.artHeight}`);
    assert.ok(
      Math.abs(authMetrics.formLeft - 16) <= 1 && Math.abs(authMetrics.formWidth - (375 - 32)) <= 1,
      `登录表单左右留白 16px: left=${authMetrics.formLeft}, width=${authMetrics.formWidth}`,
    );
    assert.deepEqual(authMetrics.smallHit, [], `登录页交互元素触控尺寸均 >= 44×44px: ${JSON.stringify(authMetrics.smallHit)}`);

    await setTheme(page, "dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const authDarkBg = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
    assert.notEqual(authDarkBg, "rgb(255, 255, 255)", "深色下登录页背景不发白");
    if (evidence) await page.screenshot({ path: `${evidence}/page-login-dark.png`, animations: "disabled" });
    await setTheme(page, "light");
    if (evidence) await page.screenshot({ path: `${evidence}/page-login.png`, animations: "disabled" });

    // 1440×900 桌面端登录页保持双栏有边框卡片
    await page.setViewportSize({ width: 1440, height: 900 });
    const desktopAuth = await page.evaluate(() => {
      const wrap = document.querySelector<HTMLElement>(".auth-wrap")!;
      return {
        borderTop: getComputedStyle(wrap).borderTopWidth,
        artHeight: document.querySelector<HTMLElement>(".auth-art")!.getBoundingClientRect().height,
      };
    });
    assert.notEqual(desktopAuth.borderTop, "0px", "桌面端登录卡片保留边框");
    assert.ok(desktopAuth.artHeight >= 400, `桌面端登录卡片保留双栏高度: ${desktopAuth.artHeight}`);
  } finally {
    await context.close();
  }
}

const checks = [
  checkTabBar, checkDrawerClosesAfterNavigation, checkLongWorkspaceName,
  checkDockCollapseExpand, checkLongDraft, checkWidenClearsDock, checkPickingReturnsExpanded,
  checkMenuSheet, checkDarkSurfaces,
  checkTouchTargets, checkNoOverflowAndNoCover,
  checkCanvasList,
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
  await checkHomeAndLogin(browser, origin);
  console.log("checkHomeAndLogin: passed");
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
