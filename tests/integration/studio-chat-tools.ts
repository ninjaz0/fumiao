import assert from "node:assert/strict";
import { expect, type Page } from "@playwright/test";
import { Queue } from "bullmq";
import { one } from "@fumiao/platform/db.js";
import { redisConnection } from "@fumiao/platform/redis.js";
import type { Platform } from "@fumiao/platform/platform.js";
import { PluginRegistry } from "@fumiao/platform/plugins.js";
import { OriginalChats } from "@fumiao/original-api/chats.js";
import { ChatExecution } from "@fumiao/original-api/chat-execution.js";
import { ChatRuntime } from "@fumiao/original-api/chat-runtime.js";
import {
  chatToolProvider,
  toolTestOrigin,
} from "../helpers/chat-tool-provider.js";
import { request, setTab, settings } from "./studio-settings-browser.js";

// The harness has a private Redis. Hold its queue while the same worker runtime
// uses a synthetic HTTPS transport; no test transport is available to Studio.
export async function verifyToolConversation(
  page: Page,
  p: Platform,
  redisUrl: string,
) {
  const queue = new Queue("fumiao-chat", {
    connection: redisConnection(redisUrl),
  });
  const prior = p.registry;
  const model = chatToolProvider();
  const runtime = new ChatRuntime(new ChatExecution(new OriginalChats(p)));
  await queue.pause();
  try {
    p.registry = new PluginRegistry(undefined, [], model.send);
    const admin = await one(
      p.db,
      "SELECT id,name,nickname,role FROM users WHERE role='admin' AND active LIMIT 1",
    );
    const pkg = await one(
      p.db,
      "SELECT version FROM studio_packages WHERE id='compatible-chat'",
    );
    await p.createConnection(
      {
        id: admin.id,
        name: admin.name,
        nickname: admin.nickname,
        role: admin.role,
      },
      {
        name: "浏览器对话工具测试",
        pluginId: "compatible-chat",
        version: pkg.version,
        config: {
          provider: "openai",
          baseUrl: toolTestOrigin + "/v1",
          apiKey: "synthetic-browser-credential",
        },
      },
      true,
    );
    await page
      .getByLabel("选择插件文件")
      .setInputFiles(
        "plugins/example-reading-time/example-reading-time.fmplugin.json",
      );
    await expect(page.getByText(/对话工具 · 估算旁白时长/)).toBeVisible();
    await page.getByRole("button", { name: "确认导入", exact: true }).click();
    const enabled = await request(
      page,
      "/api/admin/plugins/example-reading-time/state",
      "POST",
      () => page.getByRole("switch", { name: "旁白时长估算开关" }).click(),
    );
    assert.ok(enabled.ok(), await enabled.text());
    await page.getByRole("button", { name: "关闭插件设置" }).click();
    await page.locator('nav [data-nav="chat"]').click();
    const input = page.getByRole("textbox", { name: "发送消息" });
    await input.fill("请估算这段旁白的时长：海面日出，海风徐来。");
    const sent = page.waitForResponse(
      (r) =>
        /\/api\/chats\/[a-f0-9]+\/messages$/.test(new URL(r.url()).pathname) &&
        r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "发送", exact: true }).click();
    const response = await sent;
    assert.ok(response.ok(), await response.text());
    const { conversation } = await response.json();
    const turn = await one(
      p.db,
      "SELECT id FROM chat_turns WHERE public_id=$1",
      [conversation.active_turn],
    );
    await runtime.execute(turn.id);
    await expect(
      page.locator(".fm-chat-message.assistant .fm-chat-prose").last(),
    ).toHaveText("旁白预计 2 秒。", { timeout: 20000 });
    assert.equal(model.streams.length, 2);
    assert.equal(model.streams[1].messages.at(-1).role, "tool");
    await settings(page);
    await setTab(page, "plugins");
  } finally {
    await runtime.close();
    p.registry = prior;
    try {
      await queue.resume();
    } finally {
      await queue.close();
    }
  }
}
