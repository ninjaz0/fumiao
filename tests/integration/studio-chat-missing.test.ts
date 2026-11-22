import assert from "node:assert/strict";
import test from "node:test";
import { chromium, expect } from "@playwright/test";

test("deleted conversation explanation survives resetting the active chat", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    baseURL: process.env.STUDIO_URL,
    viewport: { width: 1440, height: 1000 },
  });
  try {
    await page.clock.install();
    await page.goto("/studio");
    await page.locator('[name="user"]').fill(process.env.STUDIO_USER!);
    await page.locator('[name="pw"]').fill(process.env.STUDIO_PASSWORD!);
    await page.locator('.auth-form [type="submit"]').click();
    await expect(page.locator(".shell")).toBeVisible();
    const state = await (await page.request.get("/api/state")).json();
    const headers = { "X-Workspace-Id": String(state.workspace_id) };
    const created = await page.request.post("/api/chats", {
      headers,
      data: {},
    });
    assert.ok(created.ok(), await created.text());
    const { conversation } = await created.json();
    await page.locator('nav [data-nav="chat"]').click();
    const row = page.locator(
      `[data-conversation="${conversation.id}"] .fm-chat-conversation-open`,
    );
    await row.click();
    await expect(row).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("status").filter({ hasText: "正在载入对话" }),
    ).toHaveCount(0);
    await expect(page.locator(".fm-chat-error")).toHaveCount(0);
    await page.locator(".fm-chat-new").click();
    await expect(page.locator(".fm-chat-empty")).toBeVisible();

    // Keep the stale history row, just as when another tab deletes a chat.
    const removed = await page.request.delete(`/api/chats/${conversation.id}`, {
      headers,
    });
    assert.ok(removed.ok(), await removed.text());
    const missing = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/chats/${conversation.id}`) &&
        response.request().method() === "GET",
    );
    await row.click();
    const response = await missing;
    assert.equal(response.status(), 404);
    const { detail } = await response.json();
    await expect(page.locator(".fm-chat-empty")).toBeVisible();
    await expect(row).not.toHaveAttribute("aria-current", "page");
    try {
      await expect(page.locator(".fm-chat-error")).toHaveText(detail);
      // A background history refresh must not dismiss the explanation either.
      await page.clock.fastForward(10_000);
      await expect(row).toHaveCount(0);
      await expect(page.locator(".fm-chat-error")).toHaveText(detail);
    } finally {
      if (process.env.STUDIO_SCREENSHOT)
        await page.screenshot({ path: process.env.STUDIO_SCREENSHOT });
    }
    await page.getByRole("button", { name: "关闭错误提示" }).click();
    await expect(page.locator(".fm-chat-error")).toHaveCount(0);
    console.log(
      "404 explanation survives chat reset and list refresh; dismissal works",
    );
  } finally {
    await browser.close();
  }
});
