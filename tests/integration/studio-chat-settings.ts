import assert from "node:assert/strict";
import { expect, type Page } from "@playwright/test";
import { setTab } from "./studio-settings-browser.js";

/** The caller has opened Studio settings as an administrator. */
export async function verifyChatSettingsRetry(page: Page) {
  let attempts = 0;
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/admin/chat", async (route) => {
    attempts++;
    if (attempts === 1)
      return route.fulfill({
        status: 500,
        json: { detail: "对话服务暂不可用" },
      });
    if (attempts === 2) return route.abort("failed");
    await pending;
    return route.fulfill({
      json: {
        providers: {
          openai: { label: "OpenAI", configured: true },
        },
      },
    });
  });
  const section = page.locator(".fm-chat-service");
  try {
    await setTab(page, "chatService");
    const alert = section.getByRole("alert");
    const retry = alert.getByRole("button", { name: "重试", exact: true });
    await expect(alert.locator("span")).toHaveText("对话服务暂不可用");
    await expect(alert).toHaveCSS("display", "flex");
    await expect(alert).toHaveCSS("justify-content", "space-between");
    await expect(alert).toHaveCSS("gap", "10px");
    await expect(retry).toHaveCSS("border-top-width", "1px");
    await expect(retry).toHaveCSS("min-height", "34px");
    await expect(section.getByText("正在读取对话服务…")).toBeHidden();
    await section.getByRole("button", { name: "重试", exact: true }).click();
    await expect(section.getByRole("alert")).toBeVisible();
    await section.getByRole("button", { name: "重试", exact: true }).click();
    await expect(section.getByText("正在读取对话服务…")).toBeVisible();
    await expect(section.getByRole("alert")).toBeHidden();
    release!();
    await expect(
      section.getByRole("heading", { name: "OpenAI" }),
    ).toBeVisible();
    await expect(section.locator("[data-chat-status]")).toHaveText("已配置");
    await expect(section.getByText("正在读取对话服务…")).toBeHidden();
    await expect(
      section.getByRole("button", { name: "重试", exact: true }),
    ).toBeHidden();
    assert.equal(attempts, 3);
  } finally {
    release!();
    await page.unroute("**/api/admin/chat");
  }
  await setTab(page, "general");
  await page.route("**/api/admin/chat", (route) =>
    route.fulfill({ json: { providers: {} } }),
  );
  try {
    await setTab(page, "chatService");
    await expect(section.getByText("暂无已接入的对话服务")).toBeVisible();
    await expect(section.getByText("正在读取对话服务…")).toBeHidden();
    await expect(section.getByRole("alert")).toBeHidden();
  } finally {
    await page.unroute("**/api/admin/chat");
  }
  console.log(
    "Verified chat settings HTTP/network failures, retry recovery and empty providers",
  );
}
