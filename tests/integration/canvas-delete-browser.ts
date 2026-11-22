import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

const harness = spawn(process.execPath, ["--import", "tsx", "tests/integration/smoke-studio-nest.ts", "--serve"], {
  env: process.env, stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
const exited = once(harness, "exit");
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  const login = await new Promise<RegExpMatchArray>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Studio harness startup timed out")), 180_000);
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/Isolated Studio (http:\/\/[^\s]+)\/studio\nSynthetic login ([^\s]+) \/ ([^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match); }
    };
    harness.stdout.on("data", collect);
    harness.stderr.on("data", collect);
    harness.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Studio harness exited: ${code}`)); });
  });
  const [, origin, user, password] = login;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto("/studio");
  await page.locator('[name="user"]').fill(user);
  await page.locator('[name="pw"]').fill(password);
  await page.locator('.auth-form [type="submit"]').click();
  await expect(page.locator(".shell")).toBeVisible();
  const state = await (await context.request.get("/api/state")).json();
  const headers = { Origin: origin, "X-Workspace-Id": String(state.workspace_id) };
  const title = "画布删除验证";
  const created = await context.request.post("/api/canvases", { headers, data: { title } });
  assert.equal(created.status(), 200);
  const { id } = await created.json();
  let deletes = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`**/api/canvases/${id}`, async (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    deletes++;
    await held;
    await route.fulfill({ status: 503, json: { detail: "删除失败，请稍后重试" } });
  });
  await page.goto(`/canvas?workspace=${state.workspace_id}`);
  const open = page.getByRole("button", { name: `删除画布 ${title}`, exact: true });
  await open.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  const submit = dialog.getByRole("button", { name: "删除画布", exact: true });
  await submit.click();
  // Native click attempts a second submission without waiting for a disabled button.
  await submit.evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(() => deletes).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  const pendingCount = deletes;
  const submitDisabled = await submit.isDisabled();
  const cancelDisabled = await dialog.getByRole("button", { name: "取消", exact: true }).isDisabled();
  release();
  await expect(page.locator("p.error")).toHaveText("删除失败，请稍后重试");
  await expect(dialog).toBeVisible();
  if (await dialog.getByRole("alert").isVisible()) {
    await expect(dialog.getByRole("alert")).toHaveCSS("color", "rgb(166, 46, 46)");
    await expect(dialog.getByRole("alert")).toHaveCSS("background-color", "rgb(255, 240, 237)");
  }
  await page.mouse.move(10, 10);
  if (process.env.CANVAS_DELETE_EVIDENCE) {
    await mkdir(process.env.CANVAS_DELETE_EVIDENCE, { recursive: true });
    await page.screenshot({ path: `${process.env.CANVAS_DELETE_EVIDENCE}/canvas-delete-${process.env.CANVAS_DELETE_LABEL || "after"}.png` });
  }
  const modalError = await dialog.getByRole("alert").isVisible();
  console.log(`Pending DELETE requests: ${pendingCount}; error visible inside open dialog: ${modalError}`);
  assert.equal(pendingCount, 1, "pending deletion must not be submitted twice");
  assert.ok(modalError, "delete failure must be visible inside the modal");
  assert.ok(submitDisabled && cancelDisabled, "submit and cancel must be disabled while deletion is pending");
  await expect(submit).toBeEnabled();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await open.click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await open.click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await page.unroute(`**/api/canvases/${id}`);
  await dialog.getByRole("button", { name: "删除画布", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(open).toHaveCount(0);
  console.log("Canvas delete pending guard, modal error, close/reopen reset and successful retry: passed");
} finally {
  await browser?.close();
  harness.kill("SIGTERM");
  await exited;
}
