import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { test } from "node:test";
import { chromium, expect } from "@playwright/test";
import { settings, setTab } from "./studio-settings-browser.js";

test(
  "model management search reports no matches and restores results when cleared",
  { timeout: 190_000 },
  async (t) => {
    const harness = spawn(
      process.execPath,
      ["--import", "tsx", "tests/integration/smoke-studio-nest.ts", "--serve"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const exited = once(harness, "exit");
    t.after(async () => {
      harness.kill("SIGTERM");
      await exited;
    });
    let output = "";
    const ready = new Promise<RegExpMatchArray>((resolve) => {
      const collect = (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-16000);
        const match = output.match(
          /Isolated Studio (http:\/\/[^\s]+)\/studio\r?\nSynthetic login (\S+) \/ (\S+)\r?\n/,
        );
        if (match) resolve(match);
      };
      harness.stdout.on("data", collect);
      harness.stderr.on("data", collect);
    });
    const [, origin, name, password] = await Promise.race([
      ready,
      exited.then(([code]) => {
        throw new Error(
          `Studio harness exited with ${code}: ${output.replace(/^Synthetic login .*$/gm, "Synthetic login [redacted]")}`,
        );
      }),
    ]);

    const evidence = process.env.MODEL_SEARCH_EVIDENCE;
    const viewport = { width: 1280, height: 800 };
    const browser = await chromium.launch({ slowMo: evidence ? 500 : 0 });
    try {
      const context = await browser.newContext({
        baseURL: origin,
        viewport,
        ...(evidence ? { recordVideo: { dir: evidence, size: viewport } } : {}),
      });
      try {
        const login = await context.request.post("/api/login", {
          data: { name, password },
        });
        assert.equal(login.status(), 200);
        const page = await context.newPage();
        await page.goto("/studio");
        await settings(page);
        await setTab(page, "models");

        const panel = page.locator(".model-settings");
        const search = panel.getByRole("textbox", { name: "搜索模型管理" });
        const models = panel.getByRole("switch");
        const h3 = panel.getByRole("switch", { name: /MiniMax H3/ });
        const noResults = panel
          .getByRole("status")
          .filter({ hasText: "没有匹配的模型" });
        await expect(h3).toBeVisible();
        const initialCount = await models.count();
        assert.ok(initialCount > 1);
        await expect(noResults).toBeHidden();

        await search.fill("  minimax h3  ");
        await expect(h3).toBeVisible();
        assert.ok((await models.count()) < initialCount);
        await expect(noResults).toBeHidden();

        await search.fill("no-such-model-56");
        if (evidence) {
          await search.blur();
          await page.mouse.move(10, 10);
          await page.screenshot({ path: join(evidence, "model-search.png") });
        }
        await expect(noResults).toBeVisible();
        await expect(models).toHaveCount(0);
        await expect(panel.locator(".model-group:visible")).toHaveCount(0);

        await search.fill("   ");
        await expect(models).toHaveCount(initialCount);
        await expect(noResults).toBeHidden();
        await search.clear();
        await expect(models).toHaveCount(initialCount);
        await expect(noResults).toBeHidden();
      } finally {
        await context.close();
      }
    } finally {
      await browser.close();
    }
  },
);
