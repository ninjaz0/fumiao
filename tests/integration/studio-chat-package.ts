import { seedLegacyPackage, legacyPackage } from "../helpers/legacy-studio.js";
import type { Platform } from "@fumiao/platform/platform.js";
import assert from "node:assert/strict";
import { expect, type Page } from "@playwright/test";
import { chatProviderFixture } from "../helpers/chat-provider.js";
import { request, settings, setTab } from "./studio-settings-browser.js";

/** The caller has logged into a fresh, funded Studio and opened Settings → Plugins. */
export async function verifyChatPackage(page: Page, p: Platform) {
  const provider = await chatProviderFixture();
  try {
    await page
      .getByLabel("选择插件文件")
      .setInputFiles(
        "plugins/compatible-chat/package/legacy-1.2.1.fmplugin.json",
      );
    await expect(
      page.getByText(/旧版原生插件已停止导入/).first(),
    ).toBeVisible();
    await seedLegacyPackage(p, await legacyPackage("compatible-chat"));
    await page.reload();
    await settings(page);
    await setTab(page, "plugins");
    await page
      .locator("article.plugin-connection")
      .filter({ has: page.getByText("兼容对话", { exact: true }) })
      .getByRole("button", { name: "设置", exact: true })
      .click();
    const toggle = page.getByRole("switch", { name: "兼容对话开关" });
    await expect(toggle).not.toBeChecked();
    const connection = provider.config();
    await page
      .getByLabel("提供方", { exact: true })
      .selectOption(connection.provider);
    const form = page
      .locator("form")
      .filter({ has: page.getByLabel("服务名称") });
    for (const details of await form.locator("details > summary").all())
      await details.click();
    await form.getByLabel("服务地址").fill(connection.baseUrl);
    await form.getByLabel("API 密钥").fill(connection.apiKey);
    const saved = await request(page, "/api/admin/connections", "POST", () =>
      form.getByRole("button", { name: "保存服务设置" }).click(),
    );
    assert.equal(saved.status(), 201, await saved.text());
    provider.setWire("probe", {
      raw: JSON.stringify({ data: [{ id: "deepseek-flash" }] }),
    });
    await page.getByRole("button", { name: "测试连接" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "服务可达" }),
    ).toBeVisible();
    const enabled = await request(
      page,
      "/api/admin/plugins/compatible-chat/state",
      "POST",
      () => toggle.click(),
    );
    assert.ok(enabled.ok(), await enabled.text());
    await expect(toggle).toBeChecked();
    await expect
      .poll(async () => {
        const config = await (
          await page.request.get("/api/chat/config")
        ).json();
        return Object.keys(config.models);
      })
      .toEqual(["deepseek-flash"]);
    provider.setWire("stream", {
      raw: 'data: {"choices":[{"delta":{"content":"插件回复"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    });
    await page.getByRole("button", { name: "关闭插件设置" }).click();
    await page.locator('nav [data-nav="chat"]').click();
    await page
      .getByRole("textbox", { name: "发送消息" })
      .fill("测试独立聊天插件");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(
      page.locator(".fm-chat-message.assistant .fm-chat-prose"),
    ).toHaveText("插件回复", { timeout: 20_000 });
    assert.deepEqual(
      provider.requests.filter((r) => r.body?.stream).map((r) => r.body.model),
      ["deepseek-flash"],
    );
    await settings(page);
    await setTab(page, "plugins");
    // The new release only connects to public HTTPS services. An old loopback
    // connection still drains and the administrator can inspect its upgrade.
    await page
      .getByLabel("选择插件文件")
      .setInputFiles("plugins/compatible-chat/compatible-chat.fmplugin.json");
    await expect(
      page.getByText(/对管理员配置的服务地址注入连接密钥/),
    ).toBeVisible();
    const upgrade = await request(
      page,
      "/api/admin/plugins/import",
      "POST",
      () => page.getByRole("button", { name: "确认更新", exact: true }).click(),
    );
    assert.ok(upgrade.ok(), await upgrade.text());
    await expect(page.getByText(/此连接已暂停接收新任务/)).toBeVisible();
    const config = await (await page.request.get("/api/chat/config")).json();
    assert.deepEqual(Object.keys(config.models), []);
    await setTab(page, "plugins");
  } finally {
    await provider.cleanup();
  }
}
