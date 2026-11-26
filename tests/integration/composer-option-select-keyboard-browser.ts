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
    const [baseCss, overridesCss, bundle] = await Promise.all([
      readFile(join(root, "baseline/production/static/canvas.css"), "utf8"),
      readFile(
        join(root, "apps/web/canvas-editor/canvas-overrides.css"),
        "utf8",
      ),
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
  <style>${baseCss}\n${overridesCss}</style>
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
      await page.getByRole("option", { name: "宫格构图预览", exact: true }).click();
      const modeGridBtn = page.getByRole("button", {
        name: "分镜生成链路：宫格构图预览",
        exact: true,
      });
      await expect(modeGridBtn).toBeVisible();
      await expect(modeGridBtn).toHaveAttribute("aria-expanded", "false");

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
