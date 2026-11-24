import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { chromium, expect, type Browser } from "@playwright/test";

const evidence = process.env.CANVAS_STICKY_EVIDENCE;
const label = process.env.CANVAS_STICKY_EVIDENCE_LABEL ?? "after";
const viewport = { width: 1280, height: 800 };
const harness = spawn(
  process.execPath,
  ["--import", "tsx", "tests/integration/smoke-studio-nest.ts", "--serve"],
  { stdio: ["ignore", "pipe", "pipe"] },
);
const exited = once(harness, "exit");
let browser: Browser | undefined;

try {
  const [, origin, name, password] = await new Promise<RegExpMatchArray>(
    (resolve, reject) => {
      let output = "";
      const cleanup = () => {
        clearTimeout(timer);
        harness.stdout.off("data", read);
        harness.stderr.off("data", read);
        harness.off("exit", earlyExit);
      };
      const earlyExit = (code: number | null) => {
        cleanup();
        reject(
          new Error(
            `Studio harness exited (${code}): ${output.replace(/^Synthetic login .*$/gm, "Synthetic login [redacted]")}`,
          ),
        );
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Studio harness startup timed out"));
      }, 180_000);
      const read = (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-16000);
        const ready = output.match(
          /Isolated Studio (http:\/\/[^\s]+)\/studio\nSynthetic login (\S+) \/ (\S+)\r?\n/,
        );
        if (!ready) return;
        cleanup();
        resolve(ready);
      };
      harness.stdout.on("data", read);
      harness.stderr.on("data", read);
      harness.once("exit", earlyExit);
    },
  );
  browser = await chromium.launch({ slowMo: evidence ? 300 : 0 });
  const context = await browser.newContext({
    baseURL: origin,
    viewport,
    colorScheme: "light",
    ...(evidence && label === "after"
      ? { recordVideo: { dir: evidence, size: viewport } }
      : {}),
  });
  try {
    const login = await context.request.post("/api/login", {
      data: { name, password },
    });
    assert.equal(login.status(), 200);
    const page = await context.newPage();
    await page.goto("/studio");
    await page.getByRole("button", { name: "画布", exact: true }).click();
    await page
      .locator(".project-list-heading")
      .getByRole("button", { name: "新建画布", exact: true })
      .click();
    await page.getByRole("button", { name: "添加便签", exact: true }).click();
    const note = page.getByRole("group", { name: /^便签节点 便签 1/ });
    const title = note.getByRole("textbox", { name: "节点名称 便签 1" });
    const editor = note.getByRole("textbox", { name: "便签内容" });

    await title.click();
    await page.keyboard.press("Enter");
    await expect(title).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(note).toBeFocused();
    await page.keyboard.press("Enter");
    if (evidence) {
      await page.mouse.move(10, 10);
      await page.screenshot({ path: join(evidence, `sticky-${label}.png`) });
    }
    await expect(
      editor,
      "Enter on the focused sticky note opens its editor",
    ).toBeFocused();
    await expect(note).toHaveAccessibleName(/按 Enter 编辑/);
    await page.keyboard.type("First line");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Second line");
    await expect(editor).toHaveValue("First line\nSecond line");
    await page.keyboard.press("Escape");
    await expect(editor).toHaveCount(0);
    await expect(note).toBeFocused();
    await expect(page.locator(".save-state")).toHaveText("已保存");
    await page.reload();
    const saved = note.getByText("First line Second line", { exact: true });
    await expect(saved).toBeVisible();
    await saved.dblclick();
    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue("First line\nSecond line");
    const video = page.video();
    if (video && evidence) {
      await context.close();
      await video.saveAs(join(evidence, "sticky-after.webm"));
    }
    console.log(
      "Sticky note opens with Enter, accepts a newline, restores focus with Escape, and saves across reload",
    );
  } finally {
    await context.close();
  }
} finally {
  await browser?.close();
  harness.kill("SIGTERM");
  await exited;
}
