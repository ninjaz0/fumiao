import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { chromium, expect, type Page } from "@playwright/test";
import { verifyChatEmptyGuidance } from "./studio-chat-empty-guidance.js";

export async function verifyChatHistory(page: Page) {
  let fail = true;
  let empty = false;
  let release!: () => void;
  let hold: Promise<void> | undefined;
  try {
    await page.route("**/api/chats", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      if (hold) await hold;
      if (fail)
        return route.fulfill({
          status: 503,
          json: { detail: "对话历史暂不可用" },
        });
      if (empty) return route.fulfill({ json: { conversations: [] } });
      return route.continue();
    });
    const config = page.waitForResponse((response) =>
      response.url().endsWith("/api/chat/config"),
    );
    await page.locator('nav [data-nav="chat"]').click();
    expect((await config).status()).toBe(200);
    await expect(
      page.getByRole("button", { name: "对话模型：DeepSeek Flash" }),
    ).toBeEnabled();
    await expect(page.getByText("正在载入对话…", { exact: true })).toBeHidden();
    const history = page.locator(".fm-chat-history-items");
    await expect(history.getByRole("alert")).toContainText("对话历史暂不可用");
    await expect(history.getByText("暂无对话", { exact: true })).toBeHidden();
    fail = false;
    await history.getByRole("button", { name: "重试", exact: true }).click();
    await expect(
      history.locator(".fm-chat-conversation-row").first(),
    ).toBeVisible();
    await expect(history.getByRole("alert")).toBeHidden();
    fail = true;
    await expect(history.getByRole("alert")).toBeVisible({ timeout: 15000 });
    fail = false;
    await expect(history.getByRole("alert")).toBeHidden({ timeout: 15000 });
    await expect(
      history.locator(".fm-chat-conversation-row").first(),
    ).toBeVisible();
    await page.locator('nav [data-nav="home"]').click();
    empty = true;
    hold = new Promise((resolve) => {
      release = resolve;
    });
    await page.locator('nav [data-nav="chat"]').click();
    await expect(history.getByRole("status")).toHaveText("正在载入对话历史…");
    await expect(history.getByText("暂无对话", { exact: true })).toBeHidden();
    hold = undefined;
    release();
    await expect(history.getByText("暂无对话", { exact: true })).toBeVisible();
    await expect(history.getByRole("alert")).toBeHidden();
    await page.locator('nav [data-nav="home"]').click();
    await page.route("**/api/chat/config", (route) =>
      route.fulfill({ status: 503, json: { detail: "配置暂不可用" } }),
    );
    await page.locator('nav [data-nav="chat"]').click();
    await expect(page.locator(".fm-chat-error")).toContainText("配置暂不可用");
    await expect(history.getByText("暂无对话", { exact: true })).toBeVisible();
    console.log(
      "PASS chat history: HTTP failure, retry, polling recovery, loading, empty success and unchanged config failure",
    );
  } finally {
    release?.();
    await page.unroute("**/api/chats");
    await page.unroute("**/api/chat/config");
  }
  await verifyChatEmptyGuidance(page);
}

// Also run independently against smoke-studio-nest --serve.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const log = await readFile(process.env.STUDIO_SERVE_LOG!, "utf8");
  const origin = log.match(/Isolated Studio (http:\/\/[^/]+)/)![1];
  const [, user, password] = log.match(/Synthetic login (\S+) \/ (\S+)/)!;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      baseURL: origin,
      viewport: { width: 1440, height: 1000 },
    });
    await page.goto("/studio");
    await page.locator('[name="user"]').fill(user);
    await page.locator('[name="pw"]').fill(password);
    await page.locator('.auth-form [type="submit"]').click();
    await expect(page.locator(".shell")).toBeVisible();
    await verifyChatHistory(page);
  } finally {
    await browser.close();
  }
}
