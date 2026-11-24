import { verifyImporters } from "./studio-importers.js";
import { verifyPublisherRotation } from "./studio-publisher.js";
import { verifyCanvasPluginNode } from "./studio-canvas-plugin-node.js";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { newNode, type Project } from "../../apps/web/canvas-editor/types.js";
import { H3, type StudioState } from "../../apps/web/studio/state.js";
import { one } from "@fumiao/platform/db.js";
import type { Actor, Platform } from "@fumiao/platform/platform.js";
import { imagesText } from "@fumiao/plugin-images/text.js";
import type { studioPayment } from "./studio-nest-payment.js";
import { verifyChatSettingsRetry } from "./studio-chat-settings.js";
import {
  assertStudio,
  open,
  request,
  settings,
  setTab,
} from "./studio-settings-browser.js";
import { checkStorageScope } from "./studio-storage-browser.js";

const imagePrompt = "隔离工作台生成图片";
const draft = "重启后恢复创作草稿";
const chatDraft = "重启后恢复未发对话";
const chatReply = "隔离验收回复";
const canvasTitle = "隔离工作台画布";
const apiTimeout = 20_000;

async function checkCreditHistoryRefresh(page: Page, state: StudioState) {
  const entries = Array.from({ length: 100 }, (_, index) => ({
    id: 101 - index,
    action: "adjust",
    amount: 1,
    created: 1700000000 + 101 - index,
    note: `credit-pagination-${101 - index}`,
  }));
  let live = false;
  let polled = entries.slice(0, 50);
  let failMore = true;
  let releaseMore!: () => void;
  const heldMore = new Promise<void>((resolve) => { releaseMore = resolve; });
  await page.route("**/api/state", (route) =>
    route.fulfill({
      json: {
        ...state,
        credits: {
          ...state.credits,
          available: state.credits.available + Number(live),
        },
        credit_history: polled,
      },
    }),
  );
  await page.route("**/api/credits?before=*", async (route) => {
    if (failMore) {
      failMore = false;
      return route.fulfill({ status: 500, headers: { "x-fumiao-web": "next" }, json: { detail: "分页暂不可用" } });
    }
    const before = Number(
      new URL(route.request().url()).searchParams.get("before"),
    );
    if (before === 300) await heldMore;
    if (before >= 300) {
      return route.fulfill({ json: { history: Array.from({ length: 50 }, (_, index) => ({
        ...entries[0], id: before - index - 1, note: `polled-credit-${before - index - 1}`,
      })) } });
    }
    return route.fulfill({
      json: {
        history: entries.filter((entry) => entry.id < before).slice(0, 50),
      },
    });
  });
  await page.goto(`/studio?workspace=${state.workspace_id}`);
  await settings(page);
  await setTab(page, "credits");
  await request(page, "/api/credits?before=52", "GET", () =>
    page.locator('[data-act="credit-more"]').click(),
  );
  await expect(page.locator(".credit-ledger-row")).toHaveCount(50);
  await expect(page.locator('[data-act="credit-more"]')).toBeEnabled();
  await page.locator('[data-act="credit-more"]').click();
  await expect(page.locator(".credit-ledger-row")).toHaveCount(100);
  const older = page
    .locator(".credit-ledger-row")
    .filter({ hasText: /credit-pagination-2\+1/ });
  await expect(older).toBeVisible();
  live = true;
  polled = [{ ...entries[0], id: 102, note: "credit-live-update" }, ...polled].slice(0, 50);
  await expect(page.locator(".credit-ledger-row").first()).toContainText(
    "credit-live-update",
    { timeout: 15000 },
  );
  await expect(older).toBeVisible();
  await expect(page.locator(".credit-ledger-row")).toHaveCount(101);
  await page.locator('[data-act="credit-more"]').click();
  await expect(page.locator(".credit-ledger-row")).toHaveCount(101);
  await expect(page.locator('[data-act="credit-more"]')).toHaveCount(0);
  async function pollBatch(first: number, count: number) {
    const added = Array.from({ length: count }, (_, index) => ({
      ...entries[0], id: first + index, note: `polled-credit-${first + index}`,
    })).reverse();
    polled = [...added, ...polled].slice(0, 50);
    await expect(page.locator(".credit-ledger-row").first()).toContainText(
      `polled-credit-${first + count - 1}`, { timeout: 15000 },
    );
  }
  await pollBatch(103, 1);
  const retained = page.locator(".credit-ledger-row").filter({ hasText: /polled-credit-103\+1/ });
  await expect(retained).toBeVisible();
  await pollBatch(104, 25);
  await pollBatch(129, 25);
  await expect(retained).toBeVisible();
  await expect(page.locator(".credit-ledger-row")).toHaveCount(152);
  await expect(page.locator('[data-act="credit-more"]')).toHaveCount(0);
  const labels = await page.locator(".credit-ledger-row small").allTextContents();
  assert.equal(new Set(labels).size, labels.length);
  console.log("Credit history retains every overlapping poll without duplicates: passed");
  await pollBatch(300, 50);
  await expect(page.locator(".credit-ledger-row")).toHaveCount(50);
  await expect(retained).toHaveCount(0);
  await expect(page.locator('[data-act="credit-more"]')).toHaveAttribute("data-before", "300");
  console.log("Credit history restarts pagination when a poll has a gap: passed");
  const more = page.locator('[data-act="credit-more"]');
  const pending = page.waitForRequest("**/api/credits?before=300");
  await more.click();
  await pending;
  try {
    await pollBatch(400, 50);
    await expect(more).toHaveAttribute("data-before", "400");
  } finally {
    releaseMore();
  }
  await expect(more).toBeEnabled();
  await expect(more).toHaveAttribute("data-before", "400");
  await expect(page.locator(".credit-ledger-row")).toHaveCount(50);
  const nextPage = page.waitForRequest("**/api/credits?before=400");
  await more.click();
  await nextPage;
  await expect(page.locator(".credit-ledger-row")).toHaveCount(100);
  await expect(more).toHaveAttribute("data-before", "350");
  const contiguous = await page.locator(".credit-ledger-row small").allTextContents();
  assert.deepEqual(contiguous, Array.from({ length: 100 }, (_, index) => ` · polled-credit-${449 - index}`));
  console.log("Credit history ignores in-flight pages from before a gap reset: passed");
  console.log("Credit history live refresh preserves loaded pages: passed");
  await page.close();
}

async function checkMobileSidebar(page: Page) {
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: 375, height: 667 });
  const sidebar = page.locator(".side");
  const expand = sidebar.getByRole("button", { name: "展开侧边栏" });
  const collapse = sidebar.getByRole("button", { name: "收起侧边栏" });
  const brand = sidebar.getByRole("button", { name: "去首页" });
  const account = sidebar.getByRole("button", { name: "账户" });
  const backdrop = page.locator(".rail-backdrop");
  const workspace = page.locator(".workspace");
  const focused = () =>
    page.evaluate(() => {
      const element = document.activeElement;
      return element?.getAttribute("aria-label") ?? element?.tagName;
    });

  await expect(expand).toBeVisible();
  await settings(page);
  await setTab(page, "plugins");
  await expand.focus();
  await page.keyboard.press("Enter");
  await expect(backdrop).toBeVisible();
  await expect(collapse).toBeFocused();

  await account.focus();
  await page.keyboard.press("Tab");
  const afterTab = await focused();
  await brand.focus();
  await page.keyboard.press("Shift+Tab");
  const afterShiftTab = await focused();
  const workspaceInert = (await workspace.getAttribute("inert")) !== null;
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => ({
      afterTab,
      afterShiftTab,
      workspaceInert,
      closedOnEscape: !(await backdrop.isVisible()),
      afterEscape: await focused(),
    }))
    .toEqual({
      afterTab: "去首页",
      afterShiftTab: "账户",
      workspaceInert: true,
      closedOnEscape: true,
      afterEscape: "展开侧边栏",
    });
  await expect(workspace).toHaveJSProperty("inert", false);

  await page.keyboard.press("Enter");
  await expect(collapse).toBeFocused();
  await account.focus();
  await page.keyboard.press("Enter");
  const accountMenu = page.locator("#popover");
  const menuSettings = accountMenu.getByRole("button", { name: "设置" });
  await expect(menuSettings).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(menuSettings).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(account).toBeFocused();
  await expect(backdrop).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(expand).toBeFocused();
  await expect(backdrop).toBeHidden();

  await expand.click();
  await backdrop.click();
  await expect(expand).toBeFocused();
  await expect(workspace).toHaveJSProperty("inert", false);
  await page.setViewportSize(viewport);
  await expand.click();
  await page.keyboard.press("Escape");
  await expect(collapse).toBeVisible();
  await expect(workspace).toHaveJSProperty("inert", false);
}

async function checkImageToVideoFrames(page: Page, studio: string, state: StudioState) {
  const image = state.jobs.find((job) => job.kind === "image" && job.result);
  assert.ok(image?.result);
  const key = `fm-draft-${state.me.id}-workspace-${state.workspace_id}`;
  await page.addInitScript(({ key, model }) => {
    sessionStorage.setItem(key, JSON.stringify({
      draft: { kind: "video", videoModel: model, h3: { mode: "frames" } },
      refs: [],
    }));
  }, { key, model: H3 });
  await page.route("**/api/state", (route) => route.fulfill({ json: {
    ...state,
    model_access: { ...state.model_access, [H3]: true },
  } }));
  await page.goto(studio);
  await page.locator(`[data-act="detail"][data-id="${image.id}"]`).click();
  await page.locator('[data-act="image-to-video"]').click();
  await expect(page.locator('.h3-frame-preview[data-slot="first_frame"]'))
    .toHaveAttribute("data-key", image.result);
  await expect(page.locator('.h3-frame-preview[data-slot="last_frame"]'))
    .toHaveAttribute("data-key", "");
  await page.close();
}

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
  await page.route("**/api/state", (route) => {
    const read = ++stateReads;
    return route.fulfill({ json: {
      ...state,
      me: { ...state.me, nickname: read >= 3 ? "刷新已完成" : "刷新前" },
      assets: read === 2 ? state.assets.filter((a) => a.id !== direct.id) : state.assets,
    } });
  });
  await page.route("**/api/asset-packs", async (route) => {
    // Hold read 2 until the refresh that supersedes it cancels the request.
    if (++packReads === 2) return;
    await route.fulfill({ json: { packs: [pack] } });
  });
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { ...state.me, nickname: "资料已保存" } }),
  );
  try {
    await page.goto(studio);
    const refs = page.locator(".reference-deck-count");
    await expect(refs).toHaveText("2");
    await expect.poll(() => packReads, { timeout: apiTimeout }).toBe(2);
    const cancelled = page.waitForEvent("requestfailed", (r) =>
      new URL(r.url()).pathname === "/api/asset-packs",
    );
    // Polls wait for the held read, so supersede it with the refresh a profile save starts.
    await page.locator(".account").click();
    await page.locator('.menu-item[data-nav="settings"]').click();
    await page.locator('[data-act="settings-tab"][data-value="profile"]').click();
    await page.locator("#nickname").fill("资料已保存");
    await page.getByRole("button", { name: "保存更改" }).click();
    await expect(page.locator(".account")).toHaveAttribute("title", "刷新已完成", {
      timeout: apiTimeout,
    });
    assert.equal(stateReads, 3);
    await cancelled;
    await page.locator('nav [data-nav="home"]').click();
    // Type again so the mounted composer persists the draft after the cancelled read.
    await page.locator("#prompt").fill("保留新引用");
    await expect(refs).toHaveText("2");
    assert.deepEqual(await page.evaluate((key) =>
      JSON.parse(sessionStorage.getItem(key)!).refs, key), [direct.id]);
  } finally {
    await page.close();
  }
}

async function checkDeletedH3Frame(page: Page, studio: string, state: StudioState) {
  const model = Object.keys(state.model_forms).find((id) =>
    state.model_forms[id].referenceModes?.includes("frames"),
  );
  assert.ok(model, "Studio fixture must include H3 frame mode");
  const image = state.assets.find((asset) => asset.kind === "ref");
  assert.ok(image);
  const key = `fm-draft-${state.me.id}-workspace-${state.workspace_id}`;
  await page.addInitScript(({ key, model, image }) => {
    sessionStorage.setItem(key, JSON.stringify({
      draft: { kind: "video", videoModel: model, prompt: "删除首帧回归", h3: { mode: "frames", first_frame: image } },
      refs: [],
    }));
  }, { key, model, image: image.id });
  let deleted = false;
  await page.route("**/api/state", (route) => route.fulfill({ json: {
    ...state,
    assets: deleted ? state.assets.filter((asset) => asset.id !== image.id) : state.assets,
  } }));
  try {
    await page.goto(studio);
    const frame = page.locator('.h3-frame-preview[data-slot="first_frame"]');
    await expect(frame).toHaveAttribute("data-key", image.id);
    deleted = true;
    await expect(frame).toHaveAttribute("data-act", "h3-upload", { timeout: apiTimeout });
    await expect(frame).toHaveAttribute("data-key", "");
    await expect(frame.locator("img")).toHaveCount(0);
    await expect.poll(() => page.evaluate(({ key, id }) => {
      const draft = sessionStorage.getItem(key);
      return draft !== null && !draft.includes(JSON.stringify(id));
    }, { key, id: image.id })).toBe(true);
  } finally {
    await page.close();
  }
}

async function checkH3ImageUploadLimit(
  page: Page,
  studio: string,
  bytes: Buffer,
) {
  try {
    await page.goto(studio);
    await expect(
      page.getByRole("button", { name: "选择模型，当前MiniMax H3" }),
    ).toBeVisible();
    const mode = page.getByRole("button", { name: "选择参考模式" });
    await expect(mode).toHaveText("全能参考");

    let uploads = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/assets"
      ) {
        uploads++;
      }
    });
    await page.getByRole("button", { name: "添加参考内容" }).click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "上传素材" }).click();
    await (await chooser).setFiles(
      Array.from({ length: 10 }, (_, i) => ({
        name: `h3-reference-${i + 1}.png`,
        mimeType: "image/png",
        buffer: bytes,
      })),
    );

    await expect(page.locator(".reference-deck-count")).toHaveText(/^(9|10)$/, {
      timeout: apiTimeout,
    });
    await expect(mode).toBeEnabled({ timeout: apiTimeout });
    assert.equal(uploads, 9, "The tenth image must not reach /api/assets");
    await expect(page.locator(".reference-deck-count")).toHaveText("9");
    await expect(page.locator("#toast")).toHaveText(
      "最多选择 9 张参考图片，请先移除部分图片",
    );
    console.log(
      "Verified H3 upload: nine images accepted, tenth rejected before /api/assets",
    );
  } finally {
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
    const ignored = await context.request.get("/studio?studio_ui=legacy");
    assert.equal(ignored.status(), 200);
    assert.doesNotMatch(await ignored.text(), /\/static\/studio\.js/);
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
    await checkCreditHistoryRefresh(await context.newPage(), await state());
    const sidebar = page.locator(".side");
    const currentSettings = sidebar.locator('nav [data-nav="settings"]');
    await expect(currentSettings).toHaveCount(0);
    await sidebar.getByRole("button", { name: "收起侧边栏" }).click();
    await settings(page);
    await verifyChatSettingsRetry(page);
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
    await checkMobileSidebar(page);
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
    const priceForm = page.locator("#price-form");
    const savePrice = priceForm.getByRole("button", { name: "保存价格" });
    const restorePrice = priceForm.getByRole("button", { name: "还原" });
    const dirtyPrice = priceForm.getByText("有未保存的修改", { exact: true });
    const firstTier = priceForm.locator("[data-price]").first();
    const firstValue = await firstTier.inputValue();
    const editedValue = firstValue === "23" ? "24" : "23";

    await page.evaluate(() => window.scrollTo(0, window.document.body.scrollHeight));
    await expect(savePrice).toBeInViewport({ ratio: 1 });
    const lastCard = await priceForm.locator(".ledger-card").last().boundingBox();
    const saveButton = await savePrice.boundingBox();
    assert.ok(lastCard && saveButton);
    assert.ok(
      saveButton.y - lastCard.y - lastCard.height >= 16,
      "Save must have at least 16px of space below the last price card",
    );
    await expect(savePrice).toBeDisabled();
    await expect(priceForm.getByRole("alert")).toBeHidden();

    await firstTier.scrollIntoViewIfNeeded();
    await firstTier.fill(editedValue);
    for (const scroll of [0, 0.5, 1]) {
      await page.evaluate((fraction) => window.scrollTo(
        0,
        (window.document.documentElement.scrollHeight - window.innerHeight) * fraction,
      ), scroll);
      for (const action of [savePrice, restorePrice, dirtyPrice])
        await expect(action).toBeInViewport({ ratio: 1 });
    }

    const tiers = priceForm.locator("[data-price]");
    const nextTier = tiers.nth(24);
    const distanceFromActions = () => nextTier.evaluate((input) => {
      const bar = input.closest("form")!.querySelector(".price-form-actions")!;
      return bar.getBoundingClientRect().top - input.getBoundingClientRect().bottom;
    });
    await nextTier.evaluate((input) => input.scrollIntoView({ block: "center" }));
    await page.evaluate(
      (distance) => window.scrollBy(0, -distance - 20),
      await distanceFromActions(),
    );
    assert.ok(await distanceFromActions() < 0, "Next price input starts behind the bar");
    await tiers.nth(23).focus();
    await page.keyboard.press("Tab");
    await expect(nextTier).toBeFocused();
    await expect.poll(distanceFromActions).toBeGreaterThanOrEqual(0);

    // A mobile keyboard may move the action bar after the input gains focus.
    await nextTier.blur();
    await page.evaluate(
      (distance) => window.scrollBy(0, 32 - distance),
      await distanceFromActions(),
    );
    await nextTier.focus();
    await page.evaluate(() => new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    }));
    const keyboardHeight = 80;
    const clearance = await distanceFromActions();
    assert.ok(clearance > 0 && clearance < keyboardHeight, "Focused input starts just above the bar");
    const barTop = () => priceForm.locator(".price-form-actions").evaluate(
      (bar) => bar.getBoundingClientRect().top,
    );
    const originalTop = await barTop();
    await page.evaluate((height) => {
      const viewport = window.visualViewport!;
      Object.defineProperty(viewport, "height", {
        configurable: true,
        value: viewport.height - height,
      });
      viewport.dispatchEvent(new Event("resize"));
    }, keyboardHeight);
    try {
      await expect(nextTier).toBeFocused();
      await expect.poll(barTop).toBeLessThan(originalTop);
      await expect.poll(distanceFromActions, {
        message: "Focused price input must stay above the bar when the keyboard opens",
      }).toBeGreaterThanOrEqual(0);
    } finally {
      await page.evaluate(() => {
        const viewport = window.visualViewport!;
        Reflect.deleteProperty(viewport, "height");
        viewport.dispatchEvent(new Event("resize"));
      });
    }

    // Exercise the real API's conflict response without changing the fixture.
    await page.route("**/api/settings/prices", async (route) => {
      const draft = route.request().postDataJSON();
      const response = await route.fetch({
        postData: { ...draft, expected_revision: draft.expected_revision + 1 },
      });
      await route.fulfill({ response });
    }, { times: 1 });
    const conflict = await request(page, "/api/settings/prices", "PUT", () => savePrice.click());
    assert.equal(conflict.status(), 409, await conflict.text());
    const priceError = priceForm.getByRole("alert");
    await expect(priceError).toHaveText("价格已更新，请刷新后重试");
    await expect(priceError).toBeInViewport({ ratio: 1 });
    assert.ok(await priceError.evaluate((element) => {
      const danger = window.document.createElement("span");
      danger.style.color = "var(--danger)";
      element.append(danger);
      const matches = getComputedStyle(element).color === getComputedStyle(danger).color;
      danger.remove();
      return matches;
    }), "Price save errors must use the theme's danger color");
    await expect(firstTier).toHaveValue(editedValue);
    await restorePrice.click();
    await expect(firstTier).toHaveValue(firstValue);
    await expect(priceError).toBeHidden();
    await expect(savePrice).toBeDisabled();
    console.log("Verified spaced pricing actions, unobscured keyboard focus, conflict feedback and draft restore");

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
        savePrice.click(),
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
      savePrice.click(),
    );
    assert.equal(pricing.status(), 200, await pricing.text());
    const { revision: priceRevision } = await pricing.json();
    assert.ok(Number.isSafeInteger(priceRevision));
    await expect(page.locator("#toast")).toHaveText("价格已保存");
    await expect(savePrice).toBeDisabled();
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
    await page.locator("button.fm-chat-new").click();
    const failedDraft = "首次发送失败后仍保留的草稿";
    const failedMessagePath = "**/api/chats/*/messages";
    await page.route(failedMessagePath, (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "首次消息发送失败" }),
      }),
    );
    let failedConversationId: string | null = null;
    try {
      await edit.fill(failedDraft);
      await page.getByRole("button", { name: "发送", exact: true }).click();
      await expect(page.getByText("首次消息发送失败", { exact: true })).toBeVisible();
      failedConversationId = await page
        .locator(".fm-chat-conversation-row.selected")
        .getAttribute("data-conversation");
      assert.ok(failedConversationId);
      await expect(edit).toHaveValue(failedDraft);
    } finally {
      await page.unroute(failedMessagePath);
    }
    await page.reload();
    await nav("chat");
    await page.locator("button.fm-chat-new").click();
    await page
      .locator(`[data-conversation="${failedConversationId}"] .fm-chat-conversation-open`)
      .click();
    await expect(edit).toHaveValue(failedDraft);
    console.log("Verified failed first chat message draft survives reload in its conversation");
    await page.locator("button.fm-chat-new").click();
    await expect(edit).toHaveValue("");
    await edit.fill("把本地回复放入画布");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    const assistant = page.locator(".fm-chat-message.assistant").last();
    await expect(assistant.locator(".fm-chat-prose")).toHaveText(chatReply, {
      timeout: apiTimeout,
    });
    const sentId = await page
      .locator(".fm-chat-conversation-row.selected")
      .getAttribute("data-conversation");
    const other = await context.request.post("/api/chats", {
      headers: { Origin: web, "X-Workspace-Id": String(workspace) },
      data: { model: "deepseek-flash" },
    });
    assert.equal(other.status(), 200, await other.text());
    const { conversation: otherConversation } = await other.json();
    await nav("home");
    await nav("chat");
    const selectConversation = async (id: string) => {
      const row = page.locator(
        `[data-conversation="${id}"] .fm-chat-conversation-open`,
      );
      if ((await row.getAttribute("aria-current")) !== "page")
        await row.click();
      await expect(
        page.getByText("正在载入对话…", { exact: true }),
      ).not.toBeVisible();
    };
    await selectConversation(sentId!);
    let release!: () => void;
    let received!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const intercepted = new Promise<void>((resolve) => {
      received = resolve;
    });
    const messagePath = `**/api/chats/${sentId}/messages`;
    await page.route(messagePath, async (route) => {
      const response = await route.fetch();
      received();
      await held;
      await route.fulfill({ response });
    });
    try {
      await edit.fill("延迟发送的 A 消息");
      await page.getByRole("button", { name: "发送", exact: true }).click();
      await intercepted;
      await selectConversation(otherConversation.id);
      await edit.fill("B 的未发送草稿");
      release();
      await expect(
        page.getByRole("button", { name: "发送", exact: true }),
      ).toBeEnabled();
      await expect(edit).toHaveValue("B 的未发送草稿");
      await selectConversation(sentId!);
      await expect(edit).not.toHaveValue("B 的未发送草稿");
      await selectConversation(otherConversation.id);
      await expect(edit).toHaveValue("B 的未发送草稿");
      await selectConversation(sentId!);
      console.log(
        "Verified delayed chat send keeps conversation drafts isolated",
      );
    } finally {
      release();
      await page.unroute(messagePath);
    }
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
    const conversationId = await page
      .locator(".fm-chat-conversation-row.selected")
      .getAttribute("data-conversation");
    await assistant.getByRole("button", { name: "放入画布" }).click();
    await expect(picker).toBeVisible();
    await page.locator("button.fm-chat-new").click();
    await expect(picker).toBeHidden();
    await page
      .locator(
        `[data-conversation="${conversationId}"] .fm-chat-conversation-open`,
      )
      .click();
    await expect(assistant.locator(".fm-chat-prose")).toHaveText(chatReply);
    await expect(edit).toHaveValue(chatDraft);
    await expect(picker).toBeHidden();
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
    await setTab(page, "plugins");
    await page
      .getByLabel("选择插件文件")
      .setInputFiles(
        "plugins/example-review-board/example-review-board.fmplugin.json",
      );
    await expect(page.getByText(/工作台页面「审片清单」/)).toBeVisible();
    await page.getByRole("button", { name: "确认导入", exact: true }).click();
    const boardSwitch = page.getByRole("switch", { name: "审片清单开关" });
    const enabled = await request(
      page,
      "/api/admin/plugins/example-review-board/state",
      "POST",
      () => boardSwitch.click(),
    );
    assert.ok(enabled.ok(), await enabled.text());
    await expect(boardSwitch).toBeChecked();
    await page.getByRole("button", { name: "关闭插件设置" }).click();
    const board = sidebar.getByRole("button", {
      name: "审片清单",
      exact: true,
    });
    await board.click();
    await expect(page.getByRole("heading", { name: "审片清单" })).toBeVisible();
    const queueReview = await context.request.post(
      "/api/plugins/example-review-board/actions/queue",
      {
        headers,
        data: {
          version: "1.0.0",
          requestId: crypto.randomUUID(),
          target: jobId,
        },
      },
    );
    assert.equal(queueReview.status(), 200, await queueReview.text());
    await page.reload();
    await expect(board).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("progressbar", { name: /已完成审片/ }),
    ).toHaveAttribute("max", "1");
    await expect(page.getByRole("cell", { name: "#" + jobId })).toBeVisible();
    await page.getByRole("tab", { name: "待审" }).press("ArrowRight");
    await expect(page.getByRole("tab", { name: "已审" })).toBeFocused();
    await expect(page.getByText("暂无已审任务")).toBeVisible();
    await nav("home");
    await settings(page);
    await verifyPublisherRotation(page);
    await verifyImporters(page, workspace);
    await verifyCanvasPluginNode(page, workspace);
    await page.goto(studio);
    const savedCanvas = await document();
    const before = await state();
    await checkImageToVideoFrames(await context.newPage(), studio, before);
    await checkPackRefreshRace(await context.newPage(), studio, before);
    await checkDeletedH3Frame(await context.newPage(), studio, before);
    await checkH3ImageUploadLimit(await context.newPage(), studio, bytes);
    await checkStorageScope(await context.newPage(), web, await state());
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
