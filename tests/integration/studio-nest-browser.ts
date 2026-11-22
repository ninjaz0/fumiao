import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { newNode, type Project } from "../../apps/web/canvas-editor/types.js";
import type { StudioState } from "../../apps/web/studio/state.js";
import { one } from "../../packages/platform/src/db.js";
import type { Actor, Platform } from "../../packages/platform/src/platform.js";
import { originalUI } from "../../packages/web-compat/src/ui.js";
import { imagesText } from "../../plugins/images/src/text.js";
import type { studioPayment } from "./studio-nest-payment.js";
import {
  assertStudio,
  open,
  request,
  settings,
  setTab,
} from "./studio-settings-browser.js";

const imagePrompt = "隔离工作台生成图片";
const draft = "重启后恢复创作草稿";
const chatDraft = "重启后恢复未发对话";
const chatReply = "隔离验收回复";
const canvasTitle = "隔离工作台画布";
const apiTimeout = 20_000;

async function dragPastImage(page: Page) {
  const fixed = page.getByAltText("固定参考图", { exact: true });
  const moving = page.getByAltText("拖动参考图", { exact: true });
  for (const image of [fixed, moving])
    await expect(image).toHaveJSProperty("naturalWidth", 24);

  const original = await fixed.elementHandle();
  assert.ok(original);
  const box = await moving.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(box && viewport);
  const y = box.y + box.height / 2;
  const viewportX = () =>
    page
      .locator(".react-flow__viewport")
      .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);
  const startX = await viewportX();
  const stationary = await fixed.boundingBox();
  assert.ok(stationary);
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  try {
    // Drag along the edge until auto-pan takes the other image out of view.
    await page.mouse.move(viewport.width - 2, y, { steps: 8 });
    await expect
      .poll(viewportX)
      .toBeLessThan(startX - stationary.x - stationary.width);
    await page.mouse.move(2, y, { steps: 8 });
    await expect.poll(viewportX).toBeGreaterThanOrEqual(startX);
    await page.mouse.move(viewport.width / 2, y);
    await expect(fixed).toBeInViewport();
    assert.ok(
      await original.evaluate((img) => img.isConnected),
      "drag remounted a loaded canvas image",
    );
  } finally {
    await page.mouse.up();
  }
  await expect(fixed).toHaveJSProperty("naturalWidth", 24);
  assert.ok(await original.evaluate((img) => img.isConnected));
}

async function checkPackRefreshRace(page: Page, studio: string, state: StudioState) {
  const [direct, packed] = state.assets;
  assert.ok(direct && packed);
  const pack = { id: "test-pack", revision: 1, media: [packed.id], name: "测试包" };
  const key = `fm-draft-${state.me.id}-workspace-${state.workspace_id}`;
  await page.addInitScript(({ key, pack, direct }) => {
    sessionStorage.setItem(key, JSON.stringify({
      draft: { kind: "image", packs: [pack] }, refs: [direct],
    }));
  }, { key, pack, direct: direct.id });

  let stateReads = 0, packReads = 0;
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/state", (route) => {
    const read = ++stateReads;
    return route.fulfill({ json: {
      ...state,
      me: { ...state.me, nickname: read >= 3 ? "刷新已完成" : "刷新前" },
      assets: read === 2 ? state.assets.filter((a) => a.id !== direct.id) : state.assets,
    } });
  });
  await page.route("**/api/asset-packs", async (route) => {
    if (++packReads === 2) {
      await delayed;
      await route.fulfill({ status: 503, json: { detail: "素材包暂不可用" } });
    } else {
      await route.fulfill({ json: { packs: [pack] } });
    }
  });
  try {
    await page.goto(studio);
    const refs = page.locator(".reference-deck-count");
    await expect(refs).toHaveText("2");
    await expect(page.locator(".account")).toHaveAttribute("title", "刷新已完成", {
      timeout: apiTimeout,
    });
    const failed = page.waitForResponse((r) =>
      new URL(r.url()).pathname === "/api/asset-packs" && r.status() === 503,
    );
    release();
    await (await failed).finished();
    // Type again so the mounted composer persists the draft after the late response.
    await page.locator("#prompt").fill("保留新引用");
    await expect(refs).toHaveText("2");
    assert.deepEqual(await page.evaluate((key) =>
      JSON.parse(sessionStorage.getItem(key)!).refs, key), [direct.id]);
  } finally {
    release();
    await page.close();
  }
}

export async function studioBrowser(
  platform: Platform,
  web: string,
  user: { name: string; password: string },
  payment: Awaited<ReturnType<typeof studioPayment>>,
  mediaOrigin?: string,
) {
  const bytes = await sharp({
    create: { width: 24, height: 24, channels: 3, background: "#3672a1" },
  })
    .png()
    .toBuffer();
  const providerPrompts: string[] = [];
  const providerErrors: unknown[] = [];
  const key = "sk-studio-browser-fixture";
  const provider = createServer(async (req, res) => {
    try {
      assert.equal(req.method, "POST");
      assert.equal(req.url, "/v1/images/generations");
      assert.equal(req.headers.authorization, "Bearer " + key);
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      providerPrompts.push(body.prompt);
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({ data: [{ b64_json: bytes.toString("base64") }] }),
      );
    } catch (error) {
      providerErrors.push(error);
      res.writeHead(500).end();
    }
  }).listen(0, "127.0.0.1");
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const close = async () => {
    try {
      await browser?.close();
    } finally {
      provider.closeAllConnections();
      await new Promise<void>((done) => provider.close(() => done()));
    }
  };
  try {
    await once(provider, "listening");
    const {
      rows: [admin],
    } = await platform.db.query<Actor>(
      "SELECT id,name,nickname,role FROM users WHERE name=$1",
      [user.name],
    );
    assert.ok(admin);
    const { id } = await platform.createConnection(admin, {
      name: "Loopback Studio image fixture",
      pluginId: imagesText.manifest.id,
      version: imagesText.manifest.version,
      config: {
        baseUrl: "http://127.0.0.1:" + (provider.address() as AddressInfo).port,
        apiKey: key,
      },
    });
    await platform.updateConnection(admin, id, {
      revision: 1,
      enabled: true,
      concurrency: 1,
    });
    await payment.configure(platform, admin);
    browser = await chromium.launch();
    const context = await browser.newContext({
      baseURL: web,
      ignoreHTTPSErrors: true,
    });
    await context.route("**/*", (route) => {
      const { origin } = new URL(route.request().url());
      return origin === web ||
        origin === mediaOrigin ||
        origin === payment.origin
        ? route.continue()
        : route.abort();
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/studio");
    await assertStudio(page, true);
    await page.locator('[name="user"]').fill(user.name);
    await page.locator('[name="pw"]').fill(user.password);
    const login = await request(page, "/api/login", "POST", () =>
      page.locator('.auth-form [type="submit"]').click(),
    );
    assert.equal(login.status(), 200);
    await expect(page.locator(".shell")).toBeVisible();
    assert.equal(page.url(), web + "/studio");
    await assertStudio(page, true);
    const original = await context.request.get("/studio?studio_ui=legacy");
    assert.equal(await original.text(), await originalUI().html("index.html"));
    const session = (await context.cookies()).find(
      ({ name }) => name === "fm_session",
    );
    assert.ok(session);

    async function read<T>(path: string, workspace?: number): Promise<T> {
      const headers = workspace
        ? { "X-Workspace-Id": String(workspace) }
        : undefined;
      const response = await context.request.get(path, { headers });
      assert.equal(response.status(), 200, await response.text());
      return response.json();
    }
    const { workspace_id: workspace } = await read<StudioState>("/api/state");
    const state = () => read<StudioState>("/api/state", workspace);
    const studio = `/studio?workspace=${workspace}`;
    const nav = (name: string) =>
      page.locator(`nav [data-nav="${name}"]`).click();
    const available = (await state()).credits.available;
    const sidebar = page.locator(".side");
    const currentSettings = sidebar.locator('nav [data-nav="settings"]');
    await expect(currentSettings).toHaveCount(0);
    await sidebar.getByRole("button", { name: "收起侧边栏" }).click();
    await settings(page);
    await expect(currentSettings).toHaveAttribute("aria-current", "page");
    await expect(sidebar.locator(".workspace-switch")).toBeVisible();
    await expect.poll(() => sidebar.evaluate((rail) => {
      const bounds = rail.getBoundingClientRect();
      const center = bounds.x + bounds.width / 2;
      const icons = rail.querySelectorAll(".brand img, .expand-button svg, .space-badge, nav svg, .account img");
      return Math.max(...Array.from(icons, (icon) => {
        const box = icon.getBoundingClientRect();
        return Math.abs(box.x + box.width / 2 - center);
      }));
    })).toBeLessThanOrEqual(0.5);
    await sidebar.getByRole("button", { name: "展开侧边栏" }).click();
    await nav("home");
    await expect(currentSettings).toHaveCount(0);
    await settings(page);
    await setTab(page, "credits");
    await page.locator('[data-act="recharge"]').click();
    await page.locator('#recharge-form input[name="yuan"]').fill("1");
    const createOrder = await request(
      page,
      "/api/recharge/orders",
      "POST",
      () => page.locator('#recharge-form [type="submit"]').click(),
    );
    assert.equal(createOrder.status(), 200, await createOrder.text());
    const order = await createOrder.json();
    assert.equal(order.workspace, workspace);
    assert.equal(order.state, "pending");
    const checkout = page.locator("#recharge-pay");
    await expect(checkout).toBeVisible();
    const paymentPage = await checkout.getAttribute("href");
    assert.equal(paymentPage, order.payment_url);
    await page.goto(paymentPage!);
    await expect(page.locator(".recharge-status")).toHaveText("已到账");
    await expect(page.locator(".recharge-order-id")).toHaveText(order.id);
    await expect(page.locator(".settings-content h2").first()).toHaveText(
      "积分",
    );
    await expect(page).toHaveURL(web + "/studio");
    await assertStudio(page, true);
    await payment.verifyCallback(order.id);
    const recharged = await state();
    assert.equal(recharged.credits.available, available + 10);
    assert.deepEqual(
      recharged.credit_history
        .filter((entry) => entry.action === "recharge")
        .map((entry) => entry.amount),
      [10],
    );
    await open(page, "/payments/return", true);
    await expect(page.locator("#modal h2")).toHaveText("充值记录");

    await open(page, "/studio", true, workspace);
    await settings(page);
    await setTab(page, "prices");
    const priceInput = page.locator('[data-price="gpt-image-2.6-sunburst|1K|medium"]');
    // A slow save must preserve edits from the administrator's next visit.
    let releaseSave!: () => void;
    const delayedSave = new Promise<void>((resolve) => { releaseSave = resolve; });
    await page.route("**/api/settings/prices", async (route) => {
      await delayedSave;
      await route.continue();
    }, { times: 1 });
    await priceInput.fill("10");
    try {
      await Promise.all([
        page.waitForRequest((r) => new URL(r.url()).pathname === "/api/settings/prices" && r.method() === "PUT"),
        page.locator("#price-form button").click(),
      ]);
      await setTab(page, "general");
      await setTab(page, "prices");
      await expect(priceInput).toHaveValue("10");
      await priceInput.fill("7");
    } finally {
      releaseSave();
    }
    await expect(page.locator("#toast")).toHaveText("价格已保存");
    await setTab(page, "general");
    await setTab(page, "prices");
    await expect(priceInput).toHaveValue("7");
    await expect(page.getByText("有未保存的修改", { exact: true })).toBeVisible();
    const pricing = await request(page, "/api/settings/prices", "PUT", () =>
      page.locator("#price-form button").click(),
    );
    assert.equal(pricing.status(), 200, await pricing.text());
    const { revision: priceRevision } = await pricing.json();
    assert.ok(Number.isSafeInteger(priceRevision));
    await expect(page.locator("#toast")).toHaveText("价格已保存");
    await nav("home");
    const composerCreation = page.locator('.composer [data-menu="creation"]');
    await composerCreation.focus();
    await page.keyboard.press("Enter");
    const composerPopover = page.locator("#popover");
    await expect(composerPopover.locator('[aria-selected="true"]')).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(composerPopover.getByRole("option", { name: "图片生成" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(composerPopover.getByRole("option", { name: "语音生成" })).toBeFocused();
    await composerCreation.evaluate((trigger) => {
      window.document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      (trigger as HTMLButtonElement).click();
    });
    await expect(composerPopover.locator('[aria-selected="true"]')).toBeFocused();
    await composerCreation.evaluate((trigger) => {
      window.document.querySelector<HTMLElement>(
        '#popover [aria-selected="true"]',
      )!.click();
      (trigger as HTMLButtonElement).click();
    });
    await expect(composerPopover.locator('[aria-selected="true"]')).toBeFocused();
    console.log("Verified immediate same-menu reopen focuses the selected option after Escape and selection");
    await page.keyboard.press("Escape");
    await expect(composerPopover).toBeHidden();
    await expect(composerCreation).toBeFocused();
    for (const selector of [
      '[data-menu="h3-mode"]',
      '[data-menu="format"]',
      '[data-menu="advanced"]',
      '[data-act="reference"]',
      '[data-menu="mention"]',
      '[data-menu="image-model"]',
      '[data-menu="duration"]',
    ]) {
      const trigger = page.locator(`.composer ${selector}`);
      await trigger.focus();
      await page.keyboard.press("Enter");
      await expect.poll(() => composerPopover.evaluate(
        (element) => element.contains(window.document.activeElement),
      )).toBe(true);
      await page.keyboard.press("Escape");
      await expect(composerPopover).toBeHidden();
      await expect(trigger).toBeFocused();
    }
    console.log("Verified composer popover focus, arrow/Tab navigation and Escape restoration");
    await page.locator('#files').setInputFiles({
      name: "mention-focus.png", mimeType: "image/png", buffer: bytes,
    });
    await expect(page.locator('.composer [data-act="reference"]')).toHaveAttribute(
      "aria-label", "管理参考内容，已添加 1 个素材",
    );
    const mentionPrompt = page.locator("#prompt");
    await mentionPrompt.fill("");
    await mentionPrompt.press("@");
    await expect(composerPopover).toBeVisible();
    await expect(mentionPrompt).toBeFocused();
    await page.keyboard.type("continued");
    await expect(mentionPrompt).toHaveText("@continued");
    await page.keyboard.press("Escape");
    await expect(composerPopover).toBeHidden();
    await expect(mentionPrompt).toBeFocused();
    await mentionPrompt.fill("");
    await mentionPrompt.press("@");
    await expect(mentionPrompt).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(composerPopover.locator(".ref-entry").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(composerPopover).toBeHidden();
    await expect(mentionPrompt).toBeFocused();
    const mentionTrigger = page.locator('.composer [data-menu="mention"]');
    await mentionTrigger.click();
    await expect(composerPopover.locator(".ref-entry").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(mentionTrigger).toBeFocused();
    await page.locator('.composer [data-act="reference"]').click();
    await composerPopover.locator('[data-act="unref"]').click();
    await page.keyboard.press("Escape");
    console.log("Verified typed mention keeps prompt focus, continued typing and Escape restoration");
    await page.locator('.composer [data-menu="creation"]').click();
    await page.evaluate(() => window.document.dispatchEvent(new Event("scroll")));
    await expect(composerPopover.locator('[aria-selected="true"]')).toBeFocused();
    await page
      .locator('#popover [data-act="creation"][data-value="image"]')
      .click();
    await expect(composerCreation).toBeFocused();
    console.log("Verified creation menu survives queued scroll and restores live trigger focus after selection");
    await page.locator("#prompt").fill(imagePrompt);
    await expect(page.locator(".composer-credit")).toHaveAttribute(
      "aria-label",
      "7 积分",
    );
    await expect(page.locator(".generate-button")).toBeEnabled();
    const submission = await request(page, "/api/image-jobs", "POST", () =>
      page.locator(".generate-button").click(),
    );
    assert.equal(submission.status(), 200, await submission.text());
    assert.equal(
      submission.request().postDataJSON().price_revision,
      priceRevision,
    );
    const { id: jobId } = await submission.json();
    assert.ok(Number.isSafeInteger(jobId) && jobId > 0);
    await expect
      .poll(
        async () =>
          (await state()).jobs.find((job) => job.id === jobId)?.status,
        {
          timeout: apiTimeout,
        },
      )
      .toBe("done");
    const job = (await state()).jobs.find((job) => job.id === jobId);
    const result = job?.result;
    assert.ok(result);
    const jobVersion = (platform: Platform) =>
      one(
        platform.db,
        "SELECT plugin_id, plugin_version FROM jobs WHERE public_id=$1",
        [jobId],
      );
    const expectedVersion = {
      plugin_id: imagesText.manifest.id,
      plugin_version: imagesText.manifest.version,
    };
    assert.deepEqual(await jobVersion(platform), expectedVersion);
    const media = await context.request.get("/media/" + result);
    assert.equal(media.status(), 200);
    assert.deepEqual(await media.body(), bytes);
    assert.deepEqual(providerErrors, []);
    assert.deepEqual(providerPrompts, [imagePrompt]);
    await expect(page.locator(`#job-${jobId} .asset-preview img`)).toHaveAttribute(
      "src", "/media/" + result, { timeout: apiTimeout },
    );
    await page
      .locator(`#job-${jobId} .asset-preview`)
      .click({ timeout: apiTimeout });
    const image = page.locator(".detail-image");
    await expect(image).toHaveAttribute("src", "/media/" + result);
    await expect(image).toHaveJSProperty("naturalWidth", 24);
    await page.locator('.edit-actions [data-act="edit"]').click();
    await expect(page.locator(".detail-view.editing #prompt")).toHaveText(
      imagePrompt,
    );
    await nav("home");

    const audioScript = "这段语音草稿还没有发送。";
    const voiceDescription = "温柔自然，语速舒缓";
    const creation = page.locator('.composer [data-menu="creation"]');
    const voiceSettings = page.locator('.composer [data-menu="duration"]');
    const voice = page.getByRole("textbox", { name: "音色描述" });
    const prompt = page.locator("#prompt");
    const switchToAudio = async () => {
      await creation.click();
      await page.getByRole("option", { name: "语音生成" }).click();
    };
    await switchToAudio();
    await prompt.fill(audioScript);
    await voiceSettings.click();
    await voice.fill(voiceDescription);
    await page.getByRole("button", { name: "确定", exact: true }).click();
    await page.locator(`#job-${jobId} .asset-preview`).click();
    await page.getByRole("button", { name: "生成视频", exact: true }).click();
    await expect(creation).toHaveText("视频生成");
    await expect(prompt).toBeEmpty();
    await switchToAudio();
    await voiceSettings.click();
    await expect(voice).toHaveValue(voiceDescription);
    await expect(prompt).toHaveText(audioScript);
    await page.keyboard.press("Escape");
    await creation.click();
    await page.getByRole("option", { name: "图片生成" }).click();

    await page.locator("#prompt").fill(draft);

    const canvas = await context.request.post("/api/canvases", {
      headers: { Origin: web, "X-Workspace-Id": String(workspace) },
      data: { title: canvasTitle },
    });
    assert.equal(canvas.status(), 200, await canvas.text());
    const { id: canvasId } = await canvas.json();
    const canvasPath = "/api/canvases/" + canvasId;
    const document = () => read<Project>(canvasPath, workspace);
    await nav("chat");
    const edit = page.getByRole("textbox", { name: "发送消息" });
    await edit.fill("把本地回复放入画布");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    const assistant = page.locator(".fm-chat-message.assistant").last();
    await expect(assistant.locator(".fm-chat-prose")).toHaveText(chatReply, {
      timeout: apiTimeout,
    });
    await edit.fill(chatDraft);
    await assistant.getByRole("button", { name: "放入画布" }).click();
    const picker = page.getByRole("region", { name: "放入画布" });
    await picker.getByLabel("选择画布").selectOption(canvasId);
    await picker.getByRole("button", { name: "添加文本节点" }).click();
    await expect
      .poll(async () =>
        (await document()).document.nodes.map((item) => item.text),
      )
      .toEqual([chatReply]);
    const headers = { Origin: web, "X-Workspace-Id": String(workspace) };
    const project = await document();
    for (const [i, title] of ["固定参考图", "拖动参考图"].entries()) {
      const upload = await context.request.post("/api/assets", {
        headers: { ...headers, "Content-Type": "image/png" },
        data: bytes,
      });
      assert.equal(upload.status(), 200, await upload.text());
      project.document.nodes.push({
        ...newNode("image", i === 0 ? -150 : 430, 190, i + 1),
        title,
        width: 200,
        height: 160,
        media_id: (await upload.json()).id,
      });
    }
    const seeded = await context.request.put(canvasPath + "/document", {
      headers,
      data: {
        title: canvasTitle,
        expected_revision: project.revision,
        document: project.document,
      },
    });
    assert.equal(seeded.status(), 200, await seeded.text());
    await assistant.getByRole("link", { name: "打开画布" }).click();
    await expect(page).toHaveURL(
      web + `/canvas/${canvasId}?workspace=${workspace}`,
    );
    await expect(page.getByRole("textbox", { name: "画布名称" })).toHaveValue(
      canvasTitle,
    );
    await dragPastImage(page);
    await expect(page.locator(".save-state")).toHaveText("已保存");
    await page.getByRole("link", { name: "返回工作台" }).click();
    await expect(page).toHaveURL(web + studio);
    await expect(page.locator("#prompt")).toHaveText(draft);
    await assertStudio(page, true);
    await settings(page);
    for (const [tab, title] of [
      ["models", "模型管理"],
      ["prices", "生成定价"],
      ["creditAdmin", "积分管理"],
      ["openai", "OpenAI"],
      ["chatService", "对话服务"],
      ["storage", "存储空间"],
    ]) {
      await setTab(page, tab);
      await expect(page.locator(".settings-content h2")).toHaveText(title);
      await expect(page).toHaveURL(web + studio);
    }
    const savedCanvas = await document();
    const before = await state();
    await checkPackRefreshRace(await context.newPage(), studio, before);
    const jobEntries = before.credit_history.filter(
      (entry) => entry.job === jobId,
    );
    assert.deepEqual(
      jobEntries.map((entry) => entry.action),
      ["spend", "reserve"],
    );
    assert.deepEqual(
      jobEntries.map((entry) => entry.amount),
      [7, 7],
    );
    assert.equal(before.credits.reserved, 0);
    assert.deepEqual(errors, []);
    console.log(
      "Verified Chromium default login, React payment return and one recharge, generation, asset backfill, chat-to-canvas, settings and ledger through the normal launcher",
    );
    return {
      close,
      async verifyRestarted(platform: Platform) {
        await page.reload();
        await expect(page.locator("#prompt")).toHaveText(draft);
        await nav("chat");
        await expect(edit).toHaveValue(chatDraft);
        await expect(assistant.locator(".fm-chat-prose")).toHaveText(chatReply);
        const after = await state();
        assert.deepEqual(after.credits, before.credits);
        assert.deepEqual(after.credit_history, before.credit_history);
        assert.deepEqual(await document(), savedCanvas);
        assert.deepEqual(
          after.jobs.find((item) => item.id === jobId),
          job,
        );
        assert.deepEqual(await jobVersion(platform), expectedVersion);
        assert.deepEqual(
          await (await context.request.get("/media/" + result)).body(),
          bytes,
        );
        assert.deepEqual(
          (await context.cookies()).find(({ name }) => name === "fm_session"),
          session,
        );
        assert.deepEqual(providerPrompts, [imagePrompt]);
        assert.deepEqual(providerErrors, []);
        assert.deepEqual(errors, []);
        console.log(
          "Verified Chromium session, both drafts, chat, canvas, generated asset and ledger after PostgreSQL, Redis and launcher restart",
        );
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
