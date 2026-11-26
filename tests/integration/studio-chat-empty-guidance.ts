import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  chromium,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { newNode } from "../../apps/web/canvas-editor/types.js";

const emptyConfigPayload = {
  models: {},
  pricing: { revision: 1, items: [] },
  credits: { available: 100 },
};

export async function verifyChatEmptyGuidance(page: Page) {
  const state = await (await page.request.get("/api/state")).json();
  const expectedHeading = state.studio_plugins ? "插件" : "对话服务";
  await page.locator('nav [data-nav="home"]').click();
  await page.route("**/api/chat/config", (route) =>
    route.fulfill({ json: emptyConfigPayload }),
  );
  try {
    await page.locator('nav [data-nav="chat"]').click();
    const newChatBtn = page.locator(".fm-chat-new");
    if (await newChatBtn.isVisible()) await newChatBtn.click();

    const empty = page.locator(".fm-chat-empty-unavailable");
    await expect(empty).toBeVisible();
    await expect(empty.locator("h2")).toHaveText("暂无可用对话模型");
    await expect(empty.locator("p")).toContainText(
      "请前往设置完成配置或开通模型权限",
    );
    await expect(page.locator(".fm-chat-starters")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "对话模型：无模型" }),
    ).toBeHidden();

    const composer = page.getByRole("textbox", { name: "发送消息" });
    const draft = "未配置模型时保留的测试草稿";
    await composer.fill(draft);
    await expect(
      page.getByRole("button", { name: "发送", exact: true }),
    ).toBeHidden();

    const configure = empty.getByRole("button", { name: "前往配置对话模型" });
    await expect(configure).toBeVisible();
    await configure.click();
    await expect(page.locator(".settings-section h2")).toHaveText(
      expectedHeading,
    );

    await page.locator('nav [data-nav="chat"]').click();
    await expect(composer).toHaveValue(draft);
    await composer.fill("");

    // Existing conversation view also displays no-model guidance above composer
    const existingConversation = {
      id: "conv-empty-model-check",
      title: "已有历史对话",
      model: "deepseek-flash",
      revision: 1,
      updated: 1700000000,
      active_turn: null,
      can_delete: false,
    };
    await page.route("**/api/chats", (route) => {
      if (route.request().method() !== "GET") return route.continue();
      return route.fulfill({ json: { conversations: [existingConversation] } });
    });
    await page.route("**/api/chats/conv-empty-model-check", (route) =>
      route.fulfill({
        json: {
          conversation: existingConversation,
          messages: [
            {
              id: 1,
              role: "user",
              content: "之前讨论的脚本提纲",
              state: "complete",
              model: "deepseek-flash",
              author_name: "管理员",
              context: "{}",
              reply_to: null,
            },
          ],
        },
      }),
    );
    await page.route("**/api/chats/conv-empty-model-check/events*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: "",
      }),
    );
    try {
      await page.locator('nav [data-nav="chat"]').click();
      await page
        .locator(
          '[data-conversation="conv-empty-model-check"] .fm-chat-conversation-open',
        )
        .click();
      await expect(page.locator(".fm-chat-message.user")).toBeVisible();
      const composeBanner = page.locator(
        ".fm-chat-compose-area .fm-chat-no-model",
      );
      await expect(composeBanner).toContainText("当前空间暂无可用对话模型");
      await expect(
        composeBanner.getByRole("button", { name: "前往配置对话模型" }),
      ).toBeVisible();
      await page.locator(".fm-chat-new").click();
    } finally {
      await page.unroute("**/api/chats/conv-empty-model-check/events*");
      await page.unroute("**/api/chats/conv-empty-model-check");
      await page.unroute("**/api/chats");
    }

    console.log(
      `PASS admin chat empty guidance: hides starters, navigates to ${expectedHeading}, preserves draft, covers existing chat`,
    );
  } finally {
    await page.unroute("**/api/chat/config");
  }
}

export async function verifyMemberContextEmptyGuidance(
  memberCtx: BrowserContext,
  origin: string,
) {
  const memberState = await (await memberCtx.request.get("/api/state")).json();
  assert.equal(memberState.me.role, "member");
  const workspace = memberState.workspace_id;
  const headers = { Origin: origin, "X-Workspace-Id": String(workspace) };

  const memberPage = await memberCtx.newPage();
  try {
    await memberPage.route("**/api/chat/config", (route) =>
      route.fulfill({ json: emptyConfigPayload }),
    );
    await memberPage.goto("/studio");
    await expect(memberPage.locator(".shell")).toBeVisible();
    await memberPage.locator('nav [data-nav="chat"]').click();

    const empty = memberPage.locator(".fm-chat-empty-unavailable");
    await expect(empty).toBeVisible();
    await expect(empty.locator("h2")).toHaveText("暂无可用对话模型");
    await expect(empty.locator("p")).toHaveText(
      "当前空间暂无可用对话模型，请联系管理员开通。",
    );
    await expect(memberPage.locator(".fm-chat-starters")).toHaveCount(0);
    await expect(
      memberPage.getByRole("button", { name: "前往配置对话模型" }),
    ).toHaveCount(0);
    await expect(
      memberPage.getByRole("link", { name: "前往配置对话模型" }),
    ).toHaveCount(0);

    const created = await memberCtx.request.post("/api/canvases", {
      headers,
      data: { title: "成员无模型画布" },
    });
    assert.equal(created.status(), 200, await created.text());
    const project = await created.json();
    const textNode = { ...newNode("text", 200, 160, 1), title: "成员文案" };
    const saved = await memberCtx.request.put(
      `/api/canvases/${project.id}/document`,
      {
        headers,
        data: {
          title: project.title,
          expected_revision: project.revision,
          document: { ...project.document, nodes: [textNode], edges: [] },
        },
      },
    );
    assert.equal(saved.status(), 200, await saved.text());

    await memberPage.goto(`/canvas/${project.id}?workspace=${workspace}`);
    await memberPage
      .locator(`.react-flow__node[data-id="${textNode.id}"]`)
      .click();
    await expect(
      memberPage.locator(".fm-chat-node .fm-text-presets"),
    ).toHaveCount(0);
    await expect(
      memberPage.locator(".fm-chat-node .fm-chat-no-model"),
    ).toHaveText("当前空间暂无可用对话模型，请联系管理员开通");
    await expect(
      memberPage
        .locator(".fm-chat-node")
        .getByRole("link", { name: "前往配置对话模型" }),
    ).toHaveCount(0);
    console.log(
      "PASS member chat empty guidance: Studio chat + Canvas inline show contact-admin message without admin CTA",
    );
  } finally {
    await memberPage.unroute("**/api/chat/config");
    await memberPage.close();
  }
}

export async function verifyMemberChatEmptyGuidance(
  browser: Browser,
  origin: string,
  inviteCode: string,
) {
  const memberCtx = await browser.newContext({
    baseURL: origin,
    viewport: { width: 1280, height: 800 },
  });
  try {
    const registered = await memberCtx.request.post("/api/register", {
      headers: { Origin: origin },
      data: {
        name: "chat_empty_" + randomUUID().slice(0, 8),
        nickname: "无模型验证成员",
        password: randomUUID(),
        code: inviteCode,
      },
    });
    assert.equal(registered.status(), 200, await registered.text());
    await verifyMemberContextEmptyGuidance(memberCtx, origin);
  } finally {
    await memberCtx.close();
  }
}

export async function verifyAdminCanvasEmptyGuidance(
  page: Page,
  origin: string,
) {
  const state = await (await page.request.get("/api/state")).json();
  const workspace = state.workspace_id;
  const expectedTab = state.studio_plugins ? "plugins" : "chatService";
  const expectedHeading = state.studio_plugins ? "插件" : "对话服务";
  const headers = { Origin: origin, "X-Workspace-Id": String(workspace) };

  const created = await page.request.post("/api/canvases", {
    headers,
    data: { title: "管理员无模型画布" },
  });
  assert.equal(created.status(), 200, await created.text());
  const project = await created.json();
  const textNode = { ...newNode("text", 200, 160, 1), title: "画布文案" };
  const saved = await page.request.put(`/api/canvases/${project.id}/document`, {
    headers,
    data: {
      title: project.title,
      expected_revision: project.revision,
      document: { ...project.document, nodes: [textNode], edges: [] },
    },
  });
  assert.equal(saved.status(), 200, await saved.text());

  await page.route("**/api/chat/config", (route) =>
    route.fulfill({ json: emptyConfigPayload }),
  );
  try {
    await page.goto(`/canvas/${project.id}?workspace=${workspace}`);
    await page.locator(`.react-flow__node[data-id="${textNode.id}"]`).click();
    const inlineInput = page.getByRole("textbox", { name: "文本生成要求" });
    await expect(inlineInput).toBeVisible();
    await expect(page.locator(".fm-chat-node .fm-text-presets")).toHaveCount(0);

    const banner = page.locator(".fm-chat-node .fm-chat-no-model");
    await expect(banner).toContainText("当前空间暂无可用对话模型");
    const link = banner.getByRole("link", { name: "前往配置对话模型" });
    await expect(link).toHaveAttribute(
      "href",
      `/studio?settings=${expectedTab}&workspace=${workspace}`,
    );

    const draft = "画布内联写作草稿保留测试";
    await inlineInput.fill(draft);
    await link.click();
    await expect(page.locator(".settings-section h2")).toHaveText(
      expectedHeading,
    );

    await page.goBack();
    await page.locator(`.react-flow__node[data-id="${textNode.id}"]`).click();
    await expect(inlineInput).toHaveValue(draft);
    await inlineInput.fill("");
    await page.goto(`/studio?workspace=${workspace}`);
    await expect(page.locator(".shell")).toBeVisible();
    console.log(
      "PASS admin canvas inline empty guidance: link navigates to settings and preserves draft",
    );
  } finally {
    await page.unroute("**/api/chat/config");
  }
}

export async function verifyTeamCanvasModelScopeGuidance(
  context: BrowserContext,
  origin: string,
  team: { id: number; name: string },
) {
  const headers = { Origin: origin, "X-Workspace-Id": String(team.id) };
  const initialState = await (
    await context.request.get("/api/state", { headers })
  ).json();
  const chatModels = Object.values<any>(initialState.model_groups || {})
    .filter((group) => group.kind === "chat")
    .flatMap((group) => group.models as string[]);
  assert.ok(
    chatModels.length > 0,
    "Expected at least one chat model in catalog before testing team policy scope",
  );

  for (const model of chatModels) {
    const latest = await (
      await context.request.get("/api/state", { headers })
    ).json();
    const teamPolicy = latest.team_model_policies[String(team.id)];
    const toggled = await context.request.patch("/api/settings/models", {
      headers,
      data: {
        model,
        enabled: false,
        group: true,
        expected_revision: teamPolicy.revision,
        workspace: team.id,
      },
    });
    assert.ok(toggled.ok(), await toggled.text());
  }

  const teamPage = await context.newPage();
  try {
    const created = await context.request.post("/api/canvases", {
      headers,
      data: { title: "团队模型范围验证画布" },
    });
    assert.equal(created.status(), 200, await created.text());
    const project = await created.json();
    const textNode = { ...newNode("text", 200, 160, 1), title: "团队文案" };
    const saved = await context.request.put(
      `/api/canvases/${project.id}/document`,
      {
        headers,
        data: {
          title: project.title,
          expected_revision: project.revision,
          document: { ...project.document, nodes: [textNode], edges: [] },
        },
      },
    );
    assert.equal(saved.status(), 200, await saved.text());

    await teamPage.goto(`/canvas/${project.id}?workspace=${team.id}`);
    await teamPage
      .locator(`.react-flow__node[data-id="${textNode.id}"]`)
      .click();
    const inlineInput = teamPage.getByRole("textbox", { name: "文本生成要求" });
    await expect(inlineInput).toBeVisible();
    await expect(
      teamPage.locator(".fm-chat-node .fm-text-presets"),
    ).toHaveCount(0);

    const banner = teamPage.locator(".fm-chat-node .fm-chat-no-model");
    await expect(banner).toContainText("当前空间暂无可用对话模型");
    const link = banner.getByRole("link", { name: "前往配置对话模型" });
    await expect(link).toHaveAttribute(
      "href",
      `/studio?settings=models&scope=${team.id}&workspace=${team.id}`,
    );

    // Verify #192 draft length indicator works alongside empty-model state and draft persists
    await inlineInput.fill("草".repeat(10_850));
    await expect(teamPage.locator(".fm-chat-node .fm-chat-limit")).toHaveText(
      "10850/12000 字",
    );
    const teamDraft = "团队策略关闭时的画布草稿";
    await inlineInput.fill(teamDraft);
    await expect(teamPage.locator(".fm-chat-node .fm-chat-limit")).toBeHidden();

    await link.click();
    await expect(teamPage.locator(".settings-section h2")).toHaveText(
      "模型管理",
    );
    await expect(
      teamPage.locator(".console-scope summary strong"),
    ).toHaveText(team.name);
    await expect(teamPage).toHaveURL(
      new RegExp(`/studio\\?workspace=${team.id}$`),
    );
    const chatSwitch = teamPage
      .getByRole("switch", { name: /开放AI 对话模型/ })
      .first();
    await expect(chatSwitch).not.toBeChecked();

    await teamPage.goBack();
    await teamPage
      .locator(`.react-flow__node[data-id="${textNode.id}"]`)
      .click();
    await expect(inlineInput).toHaveValue(teamDraft);
    console.log(
      "PASS team canvas model scope guidance: opens 模型管理 scoped to current team and preserves draft",
    );
  } finally {
    await teamPage.close();
    for (const model of chatModels) {
      const latest = await (
        await context.request.get("/api/state", { headers })
      ).json();
      const teamPolicy = latest.team_model_policies[String(team.id)];
      const restored = await context.request.patch("/api/settings/models", {
        headers,
        data: {
          model,
          enabled: true,
          group: true,
          expected_revision: teamPolicy.revision,
          workspace: team.id,
        },
      });
      assert.ok(restored.ok(), await restored.text());
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  let origin = process.env.STUDIO_ORIGIN;
  let user = process.env.STUDIO_USER;
  let password = process.env.STUDIO_PASSWORD;
  if (!origin && process.env.STUDIO_SERVE_LOG) {
    const log = await readFile(process.env.STUDIO_SERVE_LOG, "utf8");
    origin = log.match(/Isolated Studio (http:\/\/[^/]+)/)![1];
    [, user, password] = log.match(/Synthetic login (\S+) \/ (\S+)/)!;
  }
  assert.ok(
    origin && user && password,
    "Set STUDIO_ORIGIN/STUDIO_USER/STUDIO_PASSWORD or STUDIO_SERVE_LOG",
  );
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      baseURL: origin,
      viewport: { width: 1280, height: 800 },
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const login = await context.request.post("/api/login", {
      headers: { Origin: origin },
      data: { name: user, password },
    });
    assert.equal(login.status(), 200);
    const state = await (await context.request.get("/api/state")).json();
    const page = await context.newPage();
    await page.goto("/studio");
    await expect(page.locator(".shell")).toBeVisible();

    await verifyChatEmptyGuidance(page);
    await verifyAdminCanvasEmptyGuidance(page, origin);

    // Verify #192 paste overflow alert on Studio chat composer
    await page.locator('nav [data-nav="chat"]').click();
    const chatInput = page.getByRole("textbox", { name: "发送消息" });
    await chatInput.fill("");
    await chatInput.click();
    await page.evaluate(
      (value) => navigator.clipboard.writeText(value),
      "字".repeat(12_005),
    );
    await page.keyboard.press("ControlOrMeta+V");
    await expect(
      page.locator(".fm-chat-limit").getByRole("alert"),
    ).toContainText("粘贴内容末尾 5 字未保留");
    await chatInput.fill("");
    await expect(page.locator(".fm-chat-limit")).toBeHidden();

    const hasChatCatalog = Object.values<any>(state.model_groups || {}).some(
      (group) => group.kind === "chat",
    );
    if (hasChatCatalog) {
      const teamName = "画布策略范围团队_" + randomUUID().slice(0, 6);
      const teamRes = await context.request.post("/api/workspaces", {
        headers: {
          Origin: origin,
          "X-Workspace-Id": String(state.workspace_id),
        },
        data: { name: teamName },
      });
      assert.equal(teamRes.status(), 200, await teamRes.text());
      const team = await teamRes.json();
      await verifyTeamCanvasModelScopeGuidance(context, origin, {
        id: team.id,
        name: teamName,
      });
    }

    const inviteRes = await context.request.post("/api/invite-codes", {
      headers: {
        Origin: origin,
        "X-Workspace-Id": String(state.workspace_id),
      },
      data: { name: "对话无模型成员测试" },
    });
    assert.equal(inviteRes.status(), 200);
    const invite = await inviteRes.json();
    await verifyMemberChatEmptyGuidance(browser, origin, invite.code);
    await context.close();
  } finally {
    await browser.close();
  }
}
