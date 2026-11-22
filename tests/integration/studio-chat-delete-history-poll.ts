import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

const origin = process.env.STUDIO_ORIGIN!;
assert.ok(origin && process.env.STUDIO_USER && process.env.STUDIO_PASSWORD,
  "Set STUDIO_ORIGIN, STUDIO_USER and STUDIO_PASSWORD for an isolated Studio --serve instance");
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto("/studio");
  await page.locator('[name="user"]').fill(process.env.STUDIO_USER!);
  await page.locator('[name="pw"]').fill(process.env.STUDIO_PASSWORD!);
  await page.locator('.auth-form [type="submit"]').click();
  await expect(page.locator(".shell")).toBeVisible();
  const state = await (await context.request.get("/api/state")).json();
  const headers = { Origin: origin, "X-Workspace-Id": String(state.workspace_id) };
  const created = await context.request.post("/api/chats", { headers, data: { model: "deepseek-flash" } });
  assert.equal(created.status(), 200);
  const { conversation } = await created.json();
  await page.locator('nav [data-nav="chat"]').click();
  const row = page.locator(`[data-conversation="${conversation.id}"]`);
  await expect(row).toBeVisible();
  let release!: () => void;
  let fetched!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { fetched = resolve; });
  const history = (url: URL) => url.pathname === "/api/chats";
  await page.route(history, async route => {
    const response = await route.fetch();
    fetched();
    await held;
    await route.fulfill({ response });
  }, { times: 1 });
  await ready;
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "删除", exact: true }).click();
  await expect(row).toHaveCount(0);
  await expect(page.getByRole("button", { name: "撤销", exact: true })).toBeVisible();
  const completed = page.waitForResponse(response => history(new URL(response.url())));
  release();
  await completed;
  await page.waitForTimeout(250);
  if (process.env.EVIDENCE_PATH) {
    await mkdir(new URL(".", `file://${process.env.EVIDENCE_PATH}`).pathname, { recursive: true });
    await page.screenshot({ path: process.env.EVIDENCE_PATH });
  }
  assert.equal(await row.count(), 0, "delayed history GET must not resurrect the deleted chat");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(row).toBeVisible();
  await page.waitForResponse(response => history(new URL(response.url())));
  await page.waitForTimeout(250);
  await expect(row).toBeVisible();
  if (process.env.EVIDENCE_PATH)
    await page.screenshot({ path: process.env.EVIDENCE_PATH.replace(/\.png$/, "-undo.png") });
  console.log("PASS: delayed history GET cannot resurrect a deleted chat; undo survives a subsequent poll");
} finally {
  await browser.close();
}
