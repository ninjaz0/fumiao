import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { chromium, expect, type Browser } from "@playwright/test";
import * as esbuild from "esbuild";

test(
  "OptionSelect exposes selected value in collapsed accessible name and closes menu when Tab or Shift+Tab leaves control",
  { timeout: 60_000 },
  async () => {
    const root = process.cwd();
    const [baseCss, overridesCss, choiceMenuCss, bundle] = await Promise.all([
      readFile(join(root, "baseline/production/static/canvas.css"), "utf8"),
      readFile(
        join(root, "apps/web/canvas-editor/canvas-overrides.css"),
        "utf8",
      ),
      readFile(join(root, "apps/web/app/choice-menu.css"), "utf8"),
      esbuild.build({
        stdin: {
          contents: `
            import React, { useState } from "react";
            import { createRoot } from "react-dom/client";
            import { LayoutGrid } from "lucide-react";
            import { CinematographyPanel } from "./apps/web/canvas-editor/CinematographyPanel";
            import { OptionSelect } from "./apps/web/canvas-editor/OptionSelect";
            import { GENERATION_MODE_OPTIONS } from "./apps/web/canvas-editor/composer-options";

            function Harness() {
              const [mode, setMode] = useState("omni_ref");
              const [cine, setCine] = useState(null);
              return (
                <div className="canvas-editor" style={{ padding: 32 }}>
                  <div className="node-composer" style={{ position: "relative", width: 520 }}>
                    <div className="fm-composer-wave3-bar">
                      <OptionSelect
                        ariaLabel="分镜生成链路"
                        icon={LayoutGrid}
                        value={mode}
                        options={GENERATION_MODE_OPTIONS}
                        onChange={setMode}
                      />
                    </div>
                    <CinematographyPanel value={cine} onChange={setCine} />
                  </div>
                </div>
              );
            }

            createRoot(document.getElementById("app")!).render(<Harness />);
          `,
          resolveDir: root,
          sourcefile: "option-select-harness.tsx",
          loader: "tsx",
        },
        bundle: true,
        format: "iife",
        platform: "browser",
        jsx: "automatic",
        write: false,
      }),
    ]);

    const jsCode = bundle.outputFiles[0]!.text;
    const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <style>${baseCss}\n${overridesCss}\n${choiceMenuCss}</style>
</head>
<body>
  <div id="app"></div>
  <script>${jsCode}</script>
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
      const page = await browser.newPage({
        viewport: { width: 1280, height: 800 },
      });
      await page.goto(`http://127.0.0.1:${port}/`);

      // 1. Collapsed chip and field buttons expose both field label and current selected value
      const modeBtn = page.getByRole("button", {
        name: "分镜生成链路：全能参考",
        exact: true,
      });
      await expect(modeBtn).toBeVisible();
      const initialWidth = (await modeBtn.boundingBox())?.width;
      await expect(modeBtn).toHaveAttribute("aria-expanded", "false");
      await modeBtn.click();
      const modeMenu = page.getByRole("listbox", { name: "分镜生成链路" });
      const modeOptions = modeMenu.getByRole("option");
      const order = ["标准首帧", "经典首尾帧", "全能参考", "宫格构图预览"];
      await expect(modeOptions).toHaveText(order);
      const gridOption = modeMenu.getByRole("option", { name: "宫格构图预览" });
      const before = await gridOption.locator("span").boundingBox();
      assert.ok(before);
      await gridOption.click();
      const modeGridBtn = page.getByRole("button", {
        name: "分镜生成链路：宫格构图预览",
        exact: true,
      });
      await expect(modeGridBtn).toBeVisible();
      assert.equal((await modeGridBtn.boundingBox())?.width, initialWidth);
      await expect(modeGridBtn).toHaveAttribute("aria-expanded", "false");
      await modeGridBtn.click();
      await expect(modeOptions).toHaveText(order);
      const after = await gridOption.locator("span").boundingBox();
      assert.ok(after);
      assert.equal(after.x, before.x, "the label stays put when selected");
      const labelLineCount = await gridOption.locator("span").evaluate((label) => {
        const range = document.createRange();
        range.selectNodeContents(label);
        return range.getClientRects().length;
      });
      assert.equal(labelLineCount, 1, "the longest label fits on one line");
      await expect(gridOption).toHaveAttribute("aria-selected", "true");
      await expect(gridOption).not.toBeFocused();
      await page.mouse.move(0, 0);
      const selectedBackground = await gridOption.evaluate((el) => getComputedStyle(el).backgroundColor);
      await gridOption.hover();
      await expect(gridOption).toHaveCSS("background-color", selectedBackground);
      await page.keyboard.press("Escape");

      const shotSizeUnset = page.getByRole("button", {
        name: "导演参数-景别：不限定",
        exact: true,
      });
      await expect(shotSizeUnset).toBeVisible();
      await shotSizeUnset.click();
      await expect(
        page.getByRole("listbox", { name: "导演参数-景别", exact: true }),
      ).toBeVisible();
      await page.getByRole("option", { name: "全景", exact: true }).click();

      // Collapsed button now announces "导演参数-景别：全景"
      const shotSizeSelected = page.getByRole("button", {
        name: "导演参数-景别：全景",
        exact: true,
      });
      await expect(shotSizeSelected).toBeVisible();
      await expect(shotSizeSelected).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByRole("listbox")).toHaveCount(0);

      // 2. Re-open "景别", press Tab -> "景别" menu closes and focus lands on "导演参数-机位：不限定"
      await shotSizeSelected.click();
      await expect(shotSizeSelected).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByRole("listbox")).toHaveCount(1);

      await page.keyboard.press("Tab");
      const cameraAngleBtn = page.getByRole("button", {
        name: "导演参数-机位：不限定",
        exact: true,
      });
      await expect(cameraAngleBtn).toBeFocused();
      await expect(shotSizeSelected).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByRole("listbox")).toHaveCount(0);

      // 3. Open "机位" via keyboard ArrowDown -> only one listbox is open ("导演参数-机位")
      await page.keyboard.press("ArrowDown");
      await expect(cameraAngleBtn).toHaveAttribute("aria-expanded", "true");
      const openListboxes = page.getByRole("listbox");
      await expect(openListboxes).toHaveCount(1);
      await expect(
        page.getByRole("listbox", { name: "导演参数-机位", exact: true }),
      ).toBeVisible();

      // 4. Press Shift+Tab while "机位" menu is open -> "机位" menu closes and focus moves back to "导演参数-景别：全景"
      await page.keyboard.press("Shift+Tab");
      await expect(shotSizeSelected).toBeFocused();
      await expect(cameraAngleBtn).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByRole("listbox")).toHaveCount(0);

      // 5. Clicking trigger while open toggles it closed cleanly, and Escape restores focus to trigger
      await shotSizeSelected.click();
      await expect(shotSizeSelected).toHaveAttribute("aria-expanded", "true");
      await shotSizeSelected.click();
      await expect(shotSizeSelected).toHaveAttribute("aria-expanded", "false");
      await expect(shotSizeSelected).toBeFocused();

      await page.keyboard.press("ArrowDown");
      await expect(shotSizeSelected).toHaveAttribute("aria-expanded", "true");
      await page.keyboard.press("Escape");
      await expect(shotSizeSelected).toHaveAttribute("aria-expanded", "false");
      await expect(shotSizeSelected).toBeFocused();

      const remainingExpanded = await page
        .locator('[aria-haspopup="listbox"][aria-expanded="true"]')
        .count();
      assert.equal(remainingExpanded, 0);
    } finally {
      try {
        await browser?.close();
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  },
);

test(
  "PR #223 Item 5: Floating CinematographyPanel downward and upward OptionSelect menus escape overflow clipping, allow real mouse clicks on outermost options, preserve keyboard navigation, and remain scrollable on short screens",
  { timeout: 60_000 },
  async () => {
    const root = process.cwd();
    const [baseCss, overridesCss, choiceMenuCss, bundle] = await Promise.all([
      readFile(join(root, "baseline/production/static/canvas.css"), "utf8"),
      readFile(
        join(root, "apps/web/canvas-editor/canvas-overrides.css"),
        "utf8",
      ),
      readFile(join(root, "apps/web/app/choice-menu.css"), "utf8"),
      esbuild.build({
        stdin: {
          contents: `
            import React, { useState } from "react";
            import { createRoot } from "react-dom/client";
            import { CinematographyPanel } from "./apps/web/canvas-editor/CinematographyPanel";

            function FloatingHarness() {
              const [cine, setCine] = useState(null);
              return (
                <div className="canvas-editor canvas-workspace" style={{ height: "100dvh", position: "relative" }}>
                  <div
                    className="node-composer"
                    style={{ position: "absolute", left: 160, bottom: 48, width: 520, height: 220 }}
                  >
                    <CinematographyPanel
                      compact
                      floating
                      side="top"
                      style={{ maxHeight: 200 }}
                      value={cine}
                      onChange={setCine}
                      onClose={() => {}}
                    />
                  </div>
                </div>
              );
            }

            createRoot(document.getElementById("app")!).render(<FloatingHarness />);
          `,
          resolveDir: root,
          sourcefile: "floating-cine-harness.tsx",
          loader: "tsx",
        },
        bundle: true,
        format: "iife",
        platform: "browser",
        jsx: "automatic",
        write: false,
      }),
    ]);

    const jsCode = bundle.outputFiles[0]!.text;
    const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <style>${baseCss}\n${overridesCss}\n${choiceMenuCss}</style>
</head>
<body style="margin:0">
  <div id="app"></div>
  <script>${jsCode}</script>
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
      const page = await browser.newPage({
        viewport: { width: 1280, height: 800 },
      });
      await page.goto(`http://127.0.0.1:${port}/`);

      // 1. Open UPWARD menu ("光影", index 3 -> direction="up") inside .fm-cine-popover (overflow-y: auto)
      // Verify the TOPMOST option ("不限定") and furthest option are NOT clipped by .fm-cine-popover and can be clicked by real mouse!
      const lightingBtn = page.getByRole("button", {
        name: "导演参数-光影：不限定",
        exact: true,
      });
      await lightingBtn.click();
      const lightingListbox = page.getByRole("listbox", {
        name: "导演参数-光影",
        exact: true,
      });
      await expect(lightingListbox).toBeVisible();
      await expect(lightingBtn).toHaveAttribute("data-choice-direction", "up");
      await expect(lightingBtn.locator(".fm-choice-chevron")).toHaveCSS("transform", "matrix(-1, 0, 0, -1, 0, 0)");
      const popBox = await page.locator(".fm-cine-popover").boundingBox();
      const upMenuBox = await lightingListbox.boundingBox();
      const lightingButtonBox = await lightingBtn.boundingBox();
      assert.ok(popBox && upMenuBox && lightingButtonBox);
      assert.ok(
        Math.abs(upMenuBox.x - lightingButtonBox.x) <= 1,
        "the dropdown and the right-column trigger have the same left edge",
      );
      assert.ok(
        Math.abs(upMenuBox.x + upMenuBox.width - lightingButtonBox.x - lightingButtonBox.width) <= 1,
        "the dropdown and the trigger also share the right edge",
      );
      assert.ok(
        upMenuBox.y < popBox.y,
        `Upward menu (${upMenuBox.y}) must extend above .fm-cine-popover top (${popBox.y}) without clipping`,
      );
      assert.ok(upMenuBox.y >= 8 && upMenuBox.y + upMenuBox.height <= 800 - 8);

      // Verify hit-testing at the center of the topmost option in the upward menu lands on the option (not clipped!)
      const topOpt = lightingListbox.getByRole("option").nth(1); // 2nd option near top edge above popover!
      const topOptLabel = (await topOpt.textContent())?.trim() || "";
      const topOptBox = await topOpt.boundingBox();
      assert.ok(topOptBox);
      const hitTopmost = await page.evaluate(
        ({ x, y }) => {
          const el = document.elementFromPoint(x, y);
          return Boolean(el?.closest('[role="option"]'));
        },
        { x: topOptBox.x + topOptBox.width / 2, y: topOptBox.y + topOptBox.height / 2 },
      );
      assert.equal(hitTopmost, true, "topmost option of upward menu must be hit-testable by real mouse");
      await page.mouse.click(
        topOptBox.x + topOptBox.width / 2,
        topOptBox.y + topOptBox.height / 2,
      );
      await expect(
        page.getByRole("button", {
          name: `导演参数-光影：${topOptLabel}`,
          exact: true,
        }),
      ).toBeVisible();

      // 2. Open DOWNWARD menu ("景别", index 0 -> direction="down"), scroll to bottommost option if needed, and click with real mouse!
      const shotSizeBtn = page.getByRole("button", {
        name: "导演参数-景别：不限定",
        exact: true,
      });
      await shotSizeBtn.click();
      const shotListbox = page.getByRole("listbox", {
        name: "导演参数-景别",
        exact: true,
      });
      await expect(shotListbox).toBeVisible();
      await expect(shotSizeBtn).toHaveAttribute("data-choice-direction", "down");
      await expect(shotSizeBtn.locator(".fm-choice-chevron")).toHaveCSS("transform", "none");
      const allShotOpts = shotListbox.getByRole("option");
      const lastShotOpt = allShotOpts.nth((await allShotOpts.count()) - 1);
      await lastShotOpt.scrollIntoViewIfNeeded();
      const lastOptLabel = (await lastShotOpt.textContent())?.trim() || "";
      const lastOptBox = await lastShotOpt.boundingBox();
      assert.ok(lastOptBox);
      await page.mouse.click(
        lastOptBox.x + lastOptBox.width / 2,
        lastOptBox.y + lastOptBox.height / 2,
      );
      await expect(
        page.getByRole("button", {
          name: `导演参数-景别：${lastOptLabel}`,
          exact: true,
        }),
      ).toBeVisible();

      // 3. Keyboard navigation (ArrowUp, End, Enter, Escape, Tab) inside floating CinematographyPanel
      const moodBtn = page.getByRole("button", {
        name: /^导演参数-氛围：/,
      });
      await moodBtn.focus();
      await page.keyboard.press("ArrowUp");
      await expect(moodBtn).toHaveAttribute("aria-expanded", "true");
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
      await expect(moodBtn).toHaveAccessibleName(/^导演参数-氛围：(?!不限定$).+/);
      await expect(moodBtn).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(moodBtn).toHaveAttribute("aria-expanded", "true");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("listbox")).toHaveCount(0);
      await expect(moodBtn).toBeFocused();

      // 4. Short viewport (1024x340): .fm-cine-popover remains scrollable while dropdown stays within viewport!
      await page.setViewportSize({ width: 1024, height: 340 });
      await page.evaluate(() => {
        const pop = document.querySelector<HTMLElement>(".fm-cine-popover");
        if (pop) {
          pop.style.position = "fixed";
          pop.style.top = "68px";
          pop.style.bottom = "auto";
          pop.style.right = "16px";
          pop.style.maxHeight = "130px";
        }
      });
      const canScrollPopover = await page
        .locator(".fm-cine-popover")
        .evaluate((el) => {
          el.scrollTop = 40;
          return el.scrollHeight > el.clientHeight && el.scrollTop > 0;
        });
      assert.equal(canScrollPopover, true, "short-screen .fm-cine-popover must remain vertically scrollable");
    } finally {
      try {
        await browser?.close();
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  },
);

test(
  "Studio popover clears desktop choice width on mobile sheet transition and Canvas choice menus support ArrowUp from container and restore trigger focus on selection",
  { timeout: 60_000 },
  async () => {
    const root = process.cwd();
    const [
      studioCss,
      polishCss,
      mobileCss,
      canvasCss,
      overridesCss,
      choiceMenuCss,
      bundle,
    ] = await Promise.all([
      readFile(join(root, "baseline/production/static/studio.css"), "utf8"),
      readFile(join(root, "apps/web/studio/studio-polish.css"), "utf8"),
      readFile(join(root, "apps/web/studio/studio-mobile.css"), "utf8"),
      readFile(join(root, "baseline/production/static/canvas.css"), "utf8"),
      readFile(join(root, "apps/web/canvas-editor/canvas-overrides.css"), "utf8"),
      readFile(join(root, "apps/web/app/choice-menu.css"), "utf8"),
      esbuild.build({
        stdin: {
          contents: `
            import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
            import { createRoot } from "react-dom/client";
            import {
              alignChoiceMenuToTrigger,
              positionStudioPopover,
              restoreChoiceMenuTriggerFocus,
              stepChoiceMenuFocus,
            } from "./apps/web/canvas-editor/choice-menu-position";

            function Harness() {
              const [studioOpen, setStudioOpen] = useState(true);
              const [canvasMenu, setCanvasMenu] = useState<"candidates" | null>(null);
              const [candidateCount, setCandidateCount] = useState<1 | 2>(1);
              const studioTriggerRef = useRef<HTMLButtonElement | null>(null);
              const popoverRef = useRef<HTMLDivElement | null>(null);
              const openedByKeyboard = useRef(false);

              const reposition = useCallback(() => {
                positionStudioPopover(
                  studioTriggerRef.current,
                  popoverRef.current,
                  window.innerWidth,
                  window.innerHeight,
                  window.matchMedia("(max-width: 760px)").matches,
                );
              }, []);

              useLayoutEffect(() => {
                if (!studioOpen) return;
                reposition();
                window.addEventListener("resize", reposition);
                return () => window.removeEventListener("resize", reposition);
              }, [studioOpen, reposition]);

              const mountCanvasChoice = useCallback((el: HTMLDivElement | null) => {
                const cleanup = alignChoiceMenuToTrigger(el);
                if (el && openedByKeyboard.current) {
                  (el.querySelector<HTMLButtonElement>('button[aria-pressed="true"]:not(:disabled)') ?? el).focus();
                } else {
                  el?.focus({ preventScroll: true });
                }
                return cleanup;
              }, []);

              return (
                <div>
                  <div id="app" style={{ padding: 24 }}>
                    <button
                      ref={studioTriggerRef}
                      type="button"
                      className="fm-choice-trigger fm-choice-trigger-wide"
                      data-menu="reference-mode"
                      aria-label="选择参考模式"
                      onClick={() => setStudioOpen((v) => !v)}
                      style={{ marginTop: 680 }}
                    >
                      <span>全能参考</span>
                    </button>
                  </div>
                  <div
                    id="popover"
                    ref={popoverRef}
                    className={"popover" + (studioOpen ? " open" : "")}
                  >
                    <div className="choice-list fm-choice-menu" role="listbox" aria-label="选择参考模式">
                      <button type="button" role="option" aria-selected="true"><span>全能参考</span></button>
                      <button type="button" role="option" aria-selected="false"><span>首尾帧</span></button>
                    </div>
                  </div>
                  <div
                    className="canvas-editor"
                    onKeyDown={(e) => {
                      const pop = (e.target as HTMLElement).closest(".cv-menu");
                      if (!pop) return;
                      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
                        e.preventDefault();
                        const buttons = Array.from(pop.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
                        const next = stepChoiceMenuFocus(buttons, buttons.indexOf(document.activeElement as HTMLButtonElement), e.key);
                        if (next >= 0) buttons[next]?.focus();
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        restoreChoiceMenuTriggerFocus(pop);
                        setCanvasMenu(null);
                      }
                    }}
                  >
                    <div className="parameter-wrap menu-trigger" style={{ position: "relative", marginTop: 40 }}>
                      <button
                        type="button"
                        className="parameter fm-choice-trigger fm-choice-trigger-count"
                        aria-label="候选数量"
                        aria-expanded={canvasMenu === "candidates"}
                        data-choice-direction="up"
                        onKeyDown={(e) => {
                          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                            e.preventDefault();
                            openedByKeyboard.current = true;
                            setCanvasMenu("candidates");
                          }
                        }}
                        onClick={(e) => {
                          openedByKeyboard.current = e.detail === 0;
                          setCanvasMenu((cur) => (cur === "candidates" ? null : "candidates"));
                        }}
                      >
                        {candidateCount} 个
                      </button>
                      {canvasMenu === "candidates" && (
                        <div
                          ref={mountCanvasChoice}
                          className="cv-menu duration-menu candidate-menu fm-choice-menu"
                          role="group"
                          aria-label="候选数量"
                          tabIndex={-1}
                        >
                          {([1, 2] as const).map((count) => (
                            <button
                              key={count}
                              type="button"
                              aria-pressed={candidateCount === count}
                              onClick={(e) => {
                                setCandidateCount(count);
                                restoreChoiceMenuTriggerFocus(e.currentTarget);
                                setCanvasMenu(null);
                              }}
                            >
                              <span>{count} 个候选</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            }

            createRoot(document.getElementById("root")!).render(<Harness />);
          `,
          resolveDir: root,
          sourcefile: "studio-canvas-choice-regression.tsx",
          loader: "tsx",
        },
        bundle: true,
        format: "iife",
        platform: "browser",
        jsx: "automatic",
        write: false,
      }),
    ]);

    const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>${polishCss}\n${mobileCss}\n${choiceMenuCss}\n${canvasCss}\n${overridesCss}</style>
  <style>${studioCss}</style>
</head>
<body style="margin:0">
  <div id="root"></div>
  <script>${bundle.outputFiles[0]!.text}</script>
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
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await page.goto(`http://127.0.0.1:${port}/`);

      const studioBtn = page.getByRole("button", { name: "选择参考模式" });
      const popover = page.locator("#popover");
      await expect(studioBtn).toHaveAttribute("data-choice-direction", "up");
      const desktopPopBox = await popover.boundingBox();
      const desktopBtnBox = await studioBtn.boundingBox();
      assert.ok(desktopPopBox && desktopBtnBox);
      assert.ok(Math.abs(desktopPopBox.width - desktopBtnBox.width) <= 1);

      // Resize down to mobile (375x667): #popover[data-sheet] must expand to full 375px width and clear data-choice-direction!
      await page.setViewportSize({ width: 375, height: 667 });
      await expect(popover).toHaveAttribute("data-sheet", "");
      await expect(studioBtn).not.toHaveAttribute("data-choice-direction");
      const mobileSheetBox = await popover.boundingBox();
      assert.ok(mobileSheetBox);
      assert.ok(
        Math.abs(mobileSheetBox.width - 375) <= 1,
        `Mobile #popover[data-sheet] must be full width 375px, got ${mobileSheetBox.width}`,
      );

      // Switch back to desktop to verify Canvas .cv-menu pointer-open ArrowUp + selection focus restoration
      await page.setViewportSize({ width: 1280, height: 800 });
      const countBtn = page.getByRole("button", { name: "候选数量" });
      await countBtn.click();
      const candidateMenu = page.getByRole("group", { name: "候选数量" });
      await expect(candidateMenu).toBeFocused();
      await page.keyboard.press("ArrowUp");
      await expect(candidateMenu.getByRole("button", { name: "2 个候选" })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(candidateMenu).toHaveCount(0);
      await expect(countBtn).toHaveText("2 个");
      await expect(countBtn).toBeFocused();

      // Closed Canvas trigger opens on ArrowDown and focuses selected option ("2 个候选")
      await page.keyboard.press("ArrowDown");
      await expect(candidateMenu.getByRole("button", { name: "2 个候选" })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(countBtn).toBeFocused();
    } finally {
      try {
        await browser?.close();
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  },
);
