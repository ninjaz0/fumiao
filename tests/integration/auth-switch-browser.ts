import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { after, before, test } from "node:test";
import { chromium, expect, type Browser } from "@playwright/test";

let baseURL: string;
let browser: Browser | undefined;
let harness: ReturnType<typeof spawn> | undefined;

before(async () => {
  const studio = spawn(
    process.execPath,
    ["--import", "tsx", "tests/integration/smoke-studio-nest.ts", "--serve"],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  harness = studio;
  baseURL = await new Promise<string>((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(
      () => finish(new Error("Studio harness startup timed out")),
      180_000,
    );
    const finish = (result: string | Error) => {
      clearTimeout(timeout);
      studio.stdout.off("data", read);
      studio.off("error", finish);
      studio.off("exit", exited);
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    const exited = (code: number | null, signal: NodeJS.Signals | null) =>
      finish(
        new Error(`Studio harness exited before startup (${code ?? signal})`),
      );
    const read = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-4096);
      const ready = output.match(
        /Isolated Studio (http:\/\/[^\s]+)\/studio\r?\n/,
      );
      if (ready) finish(ready[1]);
    };
    studio.stdout.on("data", read);
    studio.once("error", finish);
    studio.once("exit", exited);
  });
  browser = await chromium.launch();
});

after(async () => {
  try {
    await browser?.close();
  } finally {
    if (
      harness?.pid &&
      harness.exitCode === null &&
      harness.signalCode === null
    ) {
      const child = harness;
      const closed = once(child, "exit");
      const timeout = setTimeout(() => child.kill("SIGKILL"), 30_000);
      child.kill("SIGTERM");
      await closed.finally(() => clearTimeout(timeout));
    }
  }
});

for (const width of [320, 390, 1280]) {
  for (const registering of [false, true]) {
    const path = registering ? "/studio#register" : "/studio";
    test(`${path} mode switch at ${width}px is a usable touch and keyboard target`, async () => {
      const page = await browser!.newPage({
        baseURL,
        viewport: { width, height: 844 },
        hasTouch: true,
      });
      try {
        await page.goto(path);
        const link = page.locator("#auth-switch");
        await expect(link).toHaveAccessibleName(registering ? "登录" : "注册");
        const box = await link.boundingBox();
        assert.ok(box);
        console.log(
          `${path} at ${width}px: ${box.width} × ${box.height} CSS px`,
        );
        const { height, lineHeight } = await page
          .locator(".auth-switch")
          .evaluate((row) => ({
            height: row.getBoundingClientRect().height,
            lineHeight: Number.parseFloat(getComputedStyle(row).lineHeight),
          }));
        assert.ok(
          Math.abs(height - lineHeight) <= 1 / 64,
          `Expected the switch row to stay one line tall (height ${height}px; line height ${lineHeight}px)`,
        );
        assert.ok(
          box.width >= 44 && box.height >= 44,
          "Expected a 44 × 44 CSS px target or larger",
        );

        await page
          .getByRole("button", {
            name: registering ? "注册并登录" : "登录",
            exact: true,
          })
          .focus();
        await page.keyboard.press("Tab");
        await expect(link).toBeFocused();
        await expect(link).toHaveCSS("outline-style", "solid");
        await expect(link).toHaveCSS("outline-width", "2px");
        await expect(link).not.toHaveCSS("outline-color", "rgba(0, 0, 0, 0)");

        await page.touchscreen.tap(
          box.x + box.width - 2,
          box.y + box.height / 2,
        );
        await expect(page).toHaveURL(registering ? /#login$/ : /#register$/);
        await expect(
          page.getByRole("heading", {
            name: registering ? "登录工作台" : "注册账户",
          }),
        ).toBeVisible();
      } finally {
        await page.close();
      }
    });
  }
}
