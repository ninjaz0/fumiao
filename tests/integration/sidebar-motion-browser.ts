import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { chromium, type Browser } from "@playwright/test";

test(
  "Studio sidebar rail and phone drawer preserve motion choreography, specificity over studio.css, popover tracking, and reduced-motion",
  { timeout: 60_000 },
  async () => {
    const root = process.cwd();
    const [motionCss, polishCss, mobileCss, baselineStudioCss] =
      await Promise.all([
        readFile(join(root, "apps/web/app/motion.css"), "utf8"),
        readFile(join(root, "apps/web/studio/studio-polish.css"), "utf8"),
        readFile(join(root, "apps/web/studio/studio-mobile.css"), "utf8"),
        readFile(join(root, "baseline/production/static/studio.css"), "utf8"),
      ]);

    // Match apps/web/app/layout.tsx order: Next hoisted CSS first, baseline studio.css last.
    const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>${motionCss}\n${polishCss}\n${mobileCss}</style>
  <style id="baseline-studio">${baselineStudioCss}</style>
</head>
<body>
  <div id="app">
    <div class="shell">
      <aside class="side">
        <div class="side-head">
          <div class="brand">
            <img alt="" width="28" height="28" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" />
            <span>弗淼 AIGC</span>
          </div>
          <button class="collapse-button" type="button" aria-label="收起侧栏"></button>
          <button class="expand-button" type="button" aria-label="展开侧栏"></button>
        </div>
        <button class="workspace-switch" data-menu="workspaces" type="button" style="width:100%;height:36px">
          <span class="space-badge">W</span>
          <span class="nav-label">默认工作区</span>
        </button>
        <nav>
          <button type="button"><span class="nav-label">创作</span></button>
        </nav>
      </aside>
      <button class="rail-backdrop" type="button" aria-label="关闭导航"></button>
      <main class="workspace"></main>
      <div class="floating-composer"></div>
      <div class="detail-view"></div>
    </div>
  </div>
  <div id="popover" class="popover" style="width:200px;height:120px"></div>
  <script>
    const shell = document.querySelector(".shell");
    const side = document.querySelector(".side");
    const trigger = document.querySelector('[data-menu="workspaces"]');
    const popover = document.getElementById("popover");
    function positionMenu() {
      if (!popover.classList.contains("open")) return;
      if (matchMedia("(max-width: 760px)").matches) return;
      const box = trigger.getBoundingClientRect();
      popover.style.left = Math.min(Math.max(12, box.right + 12), innerWidth - popover.offsetWidth - 12) + "px";
      popover.style.top = box.top + "px";
    }
    new ResizeObserver(positionMenu).observe(side);
    window.__openMenu = () => {
      popover.classList.add("open");
      positionMenu();
    };
  </script>
</body>
</html>`;

    const server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        viewport: { width: 1080, height: 680 },
      });
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${port}/`);

      // 1. Desktop expanded choreography & brand specificity over /static/studio.css
      const desktopExpanded = await page.evaluate(() => {
        const side = getComputedStyle(document.querySelector(".side")!);
        const floating = getComputedStyle(
          document.querySelector(".floating-composer")!,
        );
        const detail = getComputedStyle(document.querySelector(".detail-view")!);
        const navLabel = getComputedStyle(
          document.querySelector(".nav-label")!,
        );
        const brandSpan = getComputedStyle(
          document.querySelector(".side-head .brand > span")!,
        );
        return {
          sideDuration: side.transitionDuration,
          floatingDuration: floating.transitionDuration,
          detailDuration: detail.transitionDuration,
          navProperty: navLabel.transitionProperty,
          navDelay: navLabel.transitionDelay,
          brandProperty: brandSpan.transitionProperty,
          brandDelay: brandSpan.transitionDelay,
        };
      });
      assert.match(desktopExpanded.sideDuration, /^0\.24s/);
      assert.equal(desktopExpanded.floatingDuration, "0.24s");
      assert.equal(desktopExpanded.detailDuration, "0.24s");
      assert.match(desktopExpanded.navProperty, /translate/);
      assert.match(desktopExpanded.navDelay, /0\.056s/);
      assert.match(
        desktopExpanded.brandProperty,
        /translate/,
        "Brand label must retain translate transition over baseline studio.css",
      );
      assert.match(
        desktopExpanded.brandProperty,
        /visibility/,
        "Brand label must retain visibility transition over baseline studio.css",
      );
      assert.match(
        desktopExpanded.brandDelay,
        /0\.056s/,
        "Brand label must retain 56ms stagger delay on expand",
      );

      // 2. Desktop collapse choreography + ResizeObserver menu tracking
      await page.evaluate(() => {
        (window as unknown as { __openMenu: () => void }).__openMenu();
        document.querySelector(".shell")!.classList.add("collapsed");
      });
      const desktopCollapsed = await page.evaluate(() => {
        const side = getComputedStyle(document.querySelector(".side")!);
        const brandSpan = getComputedStyle(
          document.querySelector(".side-head .brand > span")!,
        );
        return {
          sideDuration: side.transitionDuration,
          brandDuration: brandSpan.transitionDuration,
          brandTranslate: brandSpan.translate,
        };
      });
      assert.match(desktopCollapsed.sideDuration, /^0\.19s/);
      assert.match(desktopCollapsed.brandDuration, /0\.09s/);

      await page.waitForFunction(() => {
        const sideRight = document
          .querySelector(".side")!
          .getBoundingClientRect().right;
        const triggerRight = document
          .querySelector('[data-menu="workspaces"]')!
          .getBoundingClientRect().right;
        const popLeft = document
          .getElementById("popover")!
          .getBoundingClientRect().left;
        const brandTranslate = getComputedStyle(
          document.querySelector(".side-head .brand > span")!,
        ).translate;
        return (
          Math.abs(sideRight - 64) <= 1 &&
          Math.abs(popLeft - (triggerRight + 12)) <= 2 &&
          brandTranslate.startsWith("-4px")
        );
      });

      // 3. Phone (375x667): no -4px label shift leak, and backdrop left tracks drawer width
      await page.setViewportSize({ width: 375, height: 667 });
      const mobileCollapsed = await page.evaluate(() => {
        const navLabel = getComputedStyle(
          document.querySelector(".collapsed .side .nav-label")!,
        );
        const brandSpan = getComputedStyle(
          document.querySelector(".collapsed .side .brand > span")!,
        );
        const backdrop = getComputedStyle(
          document.querySelector(".shell > .rail-backdrop")!,
        );
        return {
          navTranslate: navLabel.translate,
          brandTranslate: brandSpan.translate,
          backdropLeft: backdrop.left,
          backdropTransition: backdrop.transitionProperty,
        };
      });
      assert.equal(
        mobileCollapsed.navTranslate,
        "none",
        "Phone drawer labels must not shift -4px while sliding closed",
      );
      assert.equal(
        mobileCollapsed.brandTranslate,
        "none",
        "Phone drawer brand must not shift -4px while sliding closed",
      );
      assert.equal(
        mobileCollapsed.backdropLeft,
        "0px",
        "Collapsed phone backdrop edge starts at 0px to follow drawer",
      );
      assert.match(
        mobileCollapsed.backdropTransition,
        /\bleft\b/,
        "Phone backdrop must transition left alongside drawer transform",
      );

      await page.evaluate(() => {
        document.querySelector(".shell")!.classList.remove("collapsed");
      });
      await page.waitForFunction(() => {
        const sideWidth = document
          .querySelector(".side")!
          .getBoundingClientRect().width;
        const backdropLeft = parseFloat(
          getComputedStyle(document.querySelector(".shell > .rail-backdrop")!)
            .left,
        );
        return sideWidth > 200 && Math.abs(backdropLeft - sideWidth) <= 1;
      });

      // 4. prefers-reduced-motion disables rail transitions immediately
      await page.setViewportSize({ width: 1080, height: 680 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const reduced = await page.evaluate(
        () => getComputedStyle(document.querySelector(".side")!).transitionDuration,
      );
      assert.match(reduced, /^0s(, 0s)*$/);
    } finally {
      await browser?.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
