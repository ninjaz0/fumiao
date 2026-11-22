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
  let release!: () => void;
  let fetched!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { fetched = resolve; });
  await page.route(`**/api/chats/${conversation.id}`, async route => {
    const response = await route.fetch();
    fetched();
    await held;
    await route.fulfill({ response });
  });
  await page.locator('nav [data-nav="chat"]').click();
  await page.locator(`[data-conversation="${conversation.id}"] .fm-chat-conversation-open`).click();
  await ready;
  const title = "Fresh title from SSE";
  const renamed = await context.request.patch(`/api/chats/${conversation.id}`, {
    headers, data: { title, expected_revision: conversation.revision },
  });
  assert.equal(renamed.status(), 200);
  const heading = page.locator(".fm-chat-header h1");
  await expect(heading).toHaveText(title);
  const completed = page.waitForResponse(response =>
    new URL(response.url()).pathname === `/api/chats/${conversation.id}`);
  release();
  await completed;
  // Allow React to commit the released response before inspecting the rendered title.
  await page.waitForTimeout(250);
  if (process.env.EVIDENCE_PATH) {
    await mkdir(new URL(".", `file://${process.env.EVIDENCE_PATH}`).pathname, { recursive: true });
    await page.screenshot({ path: process.env.EVIDENCE_PATH });
  }
  assert.equal(await heading.textContent(), title, "delayed GET must not overwrite the newer SSE title");
  console.log("PASS: delayed chat GET preserves the newer SSE title");
} finally {
  await browser.close();
}
