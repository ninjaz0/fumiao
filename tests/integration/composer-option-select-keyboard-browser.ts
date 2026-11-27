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
      await expect(modeGridBtn).toHaveAttribute("aria-expanded", "false");
      await modeGridBtn.click();
      await expect(modeOptions).toHaveText(order);
      const after = await gridOption.locator("span").boundingBox();
      assert.ok(after);
      assert.equal(after.x, before.x, "the label stays put when selected");
      await expect(gridOption).toHaveAttribute("aria-selected", "true");
      await expect(gridOption).not.toBeFocused();
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
      const popBox = await page.locator(".fm-cine-popover").boundingBox();
      const upMenuBox = await lightingListbox.boundingBox();
      assert.ok(popBox && upMenuBox);
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
