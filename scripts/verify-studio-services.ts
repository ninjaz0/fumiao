/** Differential tests for the pinned Studio service and storage settings. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { chromium, expect, type Page, type Response } from "@playwright/test";
import sharp from "sharp";
import type { StudioState } from "../apps/web/studio/state.js";
import {
  action,
  assertStudio,
  all,
  compare,
  open,
  pair,
  request,
  requestContract,
  settings,
  setTab,
  tab,
  type Comparison,
} from "./studio-settings-browser.js";
import {
  fetchAs,
  json,
  settingsFixture,
  type Backend,
} from "./studio-settings-fixture.js";

const out = resolve(".runtime-advanced/studio-services-parity");
const tabs = ["openai", "chatService", "storage"] as const;
const imageCheck = "/api/settings/openai/check";
const adminChat = "/api/admin/chat";
const model = "gpt-image-2.6-sunburst";
const imageWire = "/image/v1/models/" + model;
const deepseekWire = "/chat/deepseek/models";
const openaiWire = "/chat/openai/v1/models";
const imageKey = "sk-fixture-image-synthetic";
const deepseekKey = "sk-fixture-deepseek-synthetic";
const openaiKey = "sk-fixture-chat-openai-synthetic";
const replacement = "sk-fixture-deepseek-replacement";
const rejectedKey = "sk-fixture-never-written";
const headings = {
  openai: "OpenAI",
  chatService: "对话服务",
  storage: "存储空间",
};
const probe = (page: Page) => page.locator("#openai-check");
const chatForm = (page: Page, provider: string) =>
  page.locator(`[data-chat-provider="${provider}"]`);
const secret = (page: Page, provider: string) =>
  chatForm(page, provider).locator("input");
const chatStatus = (page: Page, provider: string) =>
  chatForm(page, provider).locator("[data-chat-status]");
const submit = (page: Page, provider: string) =>
  chatForm(page, provider).locator("button[type=submit]");
const testChat = (page: Page, provider: string) =>
  chatForm(page, provider).locator("[data-chat-test]");
const message = (page: Page, provider?: string) =>
  (provider
    ? chatForm(page, provider)
    : page.locator("#openai-settings-form")
  ).locator(".form-message");
type Pages = Awaited<ReturnType<typeof pair>>;

async function loopback() {
  const routes = new Map<
    string,
    {
      key: string;
      status: number;
      body: object;
      release?: Promise<void>;
    }
  >();
  const calls: {
    path: string;
    method: string | undefined;
    matched: boolean;
  }[] = [];
  const server = createServer(async (req, res) => {
    const path = req.url ?? "";
    const route = routes.get(path);
    const matched =
      req.method === "GET" &&
      !!route &&
      req.headers.authorization === "Bearer " + route.key &&
      req.headers["content-length"] === undefined;
    calls.push({ path, method: req.method, matched });
    if (!matched) {
      res.writeHead(500).end();
      return;
    }
    await route.release;
    res
      .writeHead(route.status, { "content-type": "application/json" })
      .end(JSON.stringify(route.body));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    calls,
    set(
      path: string,
      key: string,
      body: object,
      status = 200,
      release?: Promise<void>,
    ) {
      routes.set(path, { key, body, status, release });
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

const visual: Comparison[] = [];
const exchanges = new Map<string, unknown>();
const pageErrors: string[] = [];
const forbidden = { detail: "需要管理员权限" };
const wire = await loopback();
let fixture: Awaited<ReturnType<typeof settingsFixture>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let passed = false;

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, resolve: release };
}

function output(label: string, pages: Pages, heading: string) {
  return compare(
    out,
    label,
    pages.map(({ page }) => page),
    heading,
  ).then((result) => visual.push(result));
}

async function withPages(
  backend: Backend,
  role: "member" | "admin",
  width: number,
  theme: string,
  workspace: number,
  run: (pages: Pages) => Promise<void>,
) {
  const pages = await pair(browser!, pageErrors, backend, role, width, theme);
  try {
    await all(pages, async (page, react) => {
      await open(page, "/studio", react, workspace);
      await settings(page);
    });
    await run(pages);
  } finally {
    await Promise.all(pages.map(({ context }) => context.close()));
  }
}

async function contract(
  label: string,
  response: Response,
  backend: Backend,
  workspace: number,
  status: number,
  body: unknown,
  result: unknown,
) {
  const info = requestContract(response.request());
  const origin = info.method === "GET" ? undefined : backend.web;
  assert.equal(info.origin, origin);
  assert.equal(info.workspace, String(workspace));
  assert.deepEqual(info.body, body);
  assert.equal(response.status(), status, label);
  const actual = await response.json();
  assert.deepEqual(actual, result, label);
  const path = info.path.replace(
    /^\/api\/assets\/[a-f0-9]{32}$/,
    "/api/assets/<id>",
  );
  const snapshot = {
    ...info,
    path,
    origin: origin ? "<same origin>" : undefined,
    status,
    actual,
  };
  if (exchanges.has(label))
    assert.deepEqual(snapshot, exchanges.get(label), label);
  else exchanges.set(label, snapshot);
}

function active(page: Page, name: (typeof tabs)[number]) {
  return expect(tab(page, name)).toHaveAttribute("aria-current", "page");
}

async function readState(
  backend: Backend,
  workspace: number,
  role: "admin" | "member" = "admin",
) {
  return json<StudioState>(
    await fetchAs(backend.web, backend[role], "/api/state", { workspace }),
  );
}

async function inspectStorage(page: Page, state: StudioState) {
  const { used, reserved, quota, disk_free: diskFree } = state;
  assert.ok(used !== undefined && reserved !== undefined && quota && diskFree);
  const gb = (bytes: number) => (bytes / 1e9).toFixed(1) + " GB";
  await expect(page.locator(".storage-total strong")).toHaveText(gb(used));
  await expect(page.locator(".storage-total span")).toHaveText(
    `/ ${quota / 1e9} GB`,
  );
  await expect(page.locator(".settings-facts dd")).toHaveText(
    [
      gb(used),
      gb(reserved),
      gb(Math.max(0, quota - used - reserved)),
      gb(diskFree),
    ],
    { timeout: 10000 },
  );
  const progress = (used / quota) * 100;
  await expect(
    page.getByRole("progressbar", { name: "已用空间" }),
  ).toHaveAttribute("aria-valuenow", progress.toFixed(2));
  await expect(page.locator(".storage-track span")).toHaveAttribute(
    "style",
    `width:${progress}%`,
  );
}

async function inspectSecrets(page: Page) {
  for (const name of ["openai", "deepseek"]) {
    await expect(secret(page, name)).toHaveValue("");
    await expect(secret(page, name)).toHaveAttribute("type", "password");
    await expect(secret(page, name)).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    await expect(secret(page, name)).not.toHaveAttribute("value");
  }
  const markup = await page.content();
  for (const key of [
    imageKey,
    deepseekKey,
    openaiKey,
    replacement,
    rejectedKey,
  ])
    assert.ok(!markup.includes(key), "A synthetic key appeared in the DOM");
}

const config = (deepseek: boolean, openai: boolean) => ({
  providers: {
    deepseek: { label: "DeepSeek", configured: deepseek },
    openai: { label: "OpenAI", configured: openai },
  },
});

async function enterChat(
  page: Page,
  backend: Backend,
  workspace: number,
  deepseek: boolean,
  openai: boolean,
  step: string,
) {
  const read = await request(page, adminChat, "GET", () =>
    setTab(page, "chatService"),
  );
  await contract(
    step,
    read,
    backend,
    workspace,
    200,
    undefined,
    config(deepseek, openai),
  );
  await active(page, "chatService");
  await expect(chatStatus(page, "deepseek")).toHaveText(
    deepseek ? "已配置" : "未配置",
  );
  await expect(chatStatus(page, "openai")).toHaveText(
    openai ? "已配置" : "未配置",
  );
  await inspectSecrets(page);
}

async function matrix(prefix: string, backend: Backend, team: number) {
  for (const width of [1440, 390]) {
    for (const theme of ["light", "dark"]) {
      const label = [prefix, width, theme].join("-");
      await withPages(backend, "admin", width, theme, team, async (pages) => {
        const initial = await readState(backend, team);
        await all(pages, async (page) => {
          await setTab(page, "openai");
          await active(page, "openai");
          await expect(probe(page)).toBeDisabled();
          await expect(
            page.locator(".openai-settings .setting-row"),
          ).toHaveText(["连接状态未配置", "模型gpt-image-2.6"]);
          const usage = page.getByRole("link", { name: "查看用量 ↗" });
          await expect(usage).toHaveAttribute(
            "href",
            "https://platform.openai.com/usage",
          );
          await expect(usage).toHaveAttribute("target", "_blank");
          await expect(usage).toHaveAttribute("rel", "noopener noreferrer");
          await expect(page.locator(".openai-settings input")).toHaveCount(0);
        });
        await output(label + "-image-unconfigured", pages, headings.openai);
        await all(pages, (page) =>
          enterChat(
            page,
            backend,
            team,
            false,
            false,
            "chat read without keys",
          ),
        );
        await output(label + "-chat-unconfigured", pages, headings.chatService);
        await all(pages, async (page) => {
          await setTab(page, "storage");
          await active(page, "storage");
          await inspectStorage(page, initial);
        });
        await output(label + "-storage-empty", pages, headings.storage);
        for (const { page, react } of pages)
          await assertStudio(page, react);
      });
      await withPages(backend, "member", width, theme, team, async (pages) => {
        await all(pages, async (page) => {
          for (const name of tabs) await expect(tab(page, name)).toHaveCount(0);
          await setTab(page, "general");
        });
        await output(label + "-member", pages, "常规");
      });
    }
  }
}

async function services(prefix: string, backend: Backend, team: number) {
  await withPages(backend, "admin", 1440, "light", team, async (pages) => {
    for (const { page } of pages) {
      await setTab(page, "chatService");
      const check = await request(
        page,
        adminChat + "/deepseek/test",
        "POST",
        () => testChat(page, "deepseek").click(),
      );
      await contract(
        "chat check without key",
        check,
        backend,
        team,
        409,
        {},
        { detail: "请先配置密钥" },
      );
      await expect(message(page, "deepseek")).toHaveText("请先配置密钥");
      const put = adminChat + "/deepseek";
      const observed: string[] = [];
      page.on("request", (req) => {
        if (new URL(req.url()).pathname === put) observed.push(req.method());
      });
      await submit(page, "deepseek").click();
      await expect(message(page, "deepseek")).toHaveText("请输入密钥");
      assert.deepEqual(observed, []);
      await page.route(
        "**/api/admin/chat",
        (route) =>
          route.fulfill({
            status: 503,
            contentType: "application/json",
            body: '{"detail":"合成读取失败"}',
          }),
        { times: 1 },
      );
      await setTab(page, "general");
      await setTab(page, "chatService");
      await expect(page.locator("#toast")).toHaveText("合成读取失败");
      await expect(chatStatus(page, "openai")).toHaveText("载入中…");
      await setTab(page, "general");
      await enterChat(
        page,
        backend,
        team,
        false,
        false,
        "chat retry after read failure",
      );
    }
  });

  await fixture!.setImageCredential(backend.web, imageKey);
  await withPages(backend, "admin", 390, "dark", team, async (pages) => {
    await all(pages, async (page) => {
      await setTab(page, "openai");
      await expect(probe(page)).toBeEnabled();
      await expect(
        page.locator(".openai-settings .setting-row").first(),
      ).toHaveText("连接状态已配置");
    });
    await output(prefix + "-image-configured", pages, headings.openai);
    const delay = gate();
    wire.set(imageWire, imageKey, { error: {} }, 401, delay.promise);
    const pending = all(pages, async (page) => {
      const reply = request(page, imageCheck, "POST", () =>
        probe(page).click(),
      );
      await expect(probe(page)).toBeDisabled();
      await expect(message(page)).toHaveText("正在连接");
      return { reply };
    });
    try {
      const running = await pending;
      await output(prefix + "-image-checking", pages, headings.openai);
      delay.resolve();
      for (const [index, { reply }] of running.entries()) {
        const error = "OpenAI 密钥无效，请管理员检查配置";
        await contract(
          "image connection failure",
          await reply,
          backend,
          team,
          502,
          {},
          { detail: error },
        );
        await expect(message(pages[index].page)).toHaveText(error);
        await expect(probe(pages[index].page)).toBeEnabled();
      }
    } finally {
      delay.resolve();
    }
    await output(prefix + "-image-check-failure", pages, headings.openai);
    wire.set(imageWire, imageKey, {});
    await all(pages, async (page) => {
      const result = await request(page, imageCheck, "POST", () =>
        probe(page).click(),
      );
      await contract(
        "image check retry",
        result,
        backend,
        team,
        200,
        {},
        { ok: true, model },
      );
      await expect(message(page)).toHaveText("连接正常");
    });
    await output(prefix + "-image-check-success", pages, headings.openai);

    await all(pages, (page) =>
      enterChat(
        page,
        backend,
        team,
        false,
        true,
        "chat read with image fallback",
      ),
    );
    await output(prefix + "-chat-image-fallback", pages, headings.chatService);
    wire.set(openaiWire, imageKey, { data: [{ id: "gpt-4.1" }] });
    await all(pages, async (page) => {
      await secret(page, "openai").fill("unused draft");
      const result = await request(
        page,
        adminChat + "/openai/test",
        "POST",
        () => testChat(page, "openai").click(),
      );
      await contract(
        "chat test uses stored image fallback",
        result,
        backend,
        team,
        200,
        {},
        { ok: true },
      );
      await expect(message(page, "openai")).toHaveText("连接正常");
      await expect(secret(page, "openai")).toHaveValue("unused draft");
    });

    const save = async (
      page: Page,
      provider: string,
      input: string,
      step: string,
      status = 200,
    ) => {
      await secret(page, provider).fill(input);
      const response = await request(
        page,
        adminChat + "/" + provider,
        "PUT",
        () => submit(page, provider).click(),
      );
      const ok = status === 200;
      await contract(
        step,
        response,
        backend,
        team,
        status,
        { key: input.trim() },
        ok ? { configured: true } : { detail: "密钥格式无效" },
      );
      await expect(message(page, provider)).toHaveText(
        ok ? "已保存" : "密钥格式无效",
      );
      await expect(secret(page, provider)).toHaveValue(ok ? "" : input);
      await expect(submit(page, provider)).toBeEnabled();
    };
    await all(pages, (page) =>
      save(page, "deepseek", "invalid", "chat invalid key", 400),
    );
    await output(prefix + "-chat-invalid-key", pages, headings.chatService);
    await all(pages, (page) =>
      save(
        page,
        "deepseek",
        "  " + deepseekKey + "  ",
        "chat saves trimmed key",
      ),
    );
    await output(prefix + "-chat-saved", pages, headings.chatService);
    wire.set(deepseekWire, deepseekKey, { data: [{ id: "other-model" }] });
    const test = async (
      page: Page,
      provider: string,
      step: string,
      error?: string,
    ) => {
      const response = await request(
        page,
        `${adminChat}/${provider}/test`,
        "POST",
        () => testChat(page, provider).click(),
      );
      await contract(
        step,
        response,
        backend,
        team,
        error ? 502 : 200,
        {},
        error ? { detail: error } : { ok: true },
      );
      await expect(message(page, provider)).toHaveText(error ?? "连接正常");
      await expect(testChat(page, provider)).toBeEnabled();
    };
    await all(pages, (page) =>
      test(
        page,
        "deepseek",
        "chat model unavailable",
        "连接成功，但当前密钥不可使用所选模型",
      ),
    );
    wire.set(deepseekWire, deepseekKey, { data: [{ id: "deepseek-flash" }] });
    await all(pages, (page) => test(page, "deepseek", "chat check retry"));
    await all(pages, (page) =>
      save(page, "deepseek", replacement, "chat replaces existing key"),
    );
    wire.set(deepseekWire, replacement, { data: [{ id: "deepseek-flash" }] });
    await all(pages, (page) =>
      test(page, "deepseek", "chat tests replacement key"),
    );
    await all(pages, (page) =>
      save(page, "openai", openaiKey, "chat overrides image fallback"),
    );
    wire.set(openaiWire, openaiKey, { data: [{ id: "gpt-4.1" }] });
    await all(pages, (page) =>
      test(page, "openai", "chat test uses explicit key"),
    );
    await all(pages, async (page) => {
      await setTab(page, "general");
      await enterChat(
        page,
        backend,
        team,
        true,
        true,
        "chat read after writes",
      );
    });
    await output(prefix + "-chat-configured", pages, headings.chatService);
  });
}

async function upload(backend: Backend, workspace: number) {
  const png = await sharp({
    create: { width: 144, height: 144, channels: 3, background: "#3288aa" },
  })
    .png()
    .toBuffer();
  const response = await fetch(backend.web + "/api/assets", {
    method: "POST",
    headers: {
      cookie: backend.admin,
      origin: backend.web,
      "x-workspace-id": String(workspace),
      "x-file-name": "synthetic.png",
      "content-type": "image/png",
    },
    body: new Uint8Array(png),
  });
  const asset = await json<{ id: string; size: number }>(response);
  assert.match(asset.id, /^[a-f0-9]{32}$/);
  assert.ok(asset.size > 0);
  return asset;
}

async function storage(prefix: string, backend: Backend, team: number) {
  const before = await readState(backend, team);
  const asset = await upload(backend, team);
  const job = await json<{ id: number }>(
    await fetchAs(backend.web, backend.admin, "/api/jobs", {
      workspace: team,
      body: { uid: randomUUID(), prompt: "合成存储预留", model: "MiniMax H3" },
    }),
  );
  const populated = await readState(backend, team);
  assert.equal(populated.used, before.used! + asset.size);
  assert.equal(populated.reserved, before.reserved! + 64 * 1024 ** 2);
  assert.equal(populated.quota, before.quota);
  assert.ok(populated.disk_free! > 0);
  const mediaPath = "/media/" + asset.id;
  const anonymous = await fetch(backend.web + mediaPath);
  assert.equal(anonymous.status, 401);
  await anonymous.body?.cancel();
  const authorized = await fetchAs(backend.web, backend.admin, mediaPath, {
    workspace: team,
  });
  assert.equal(authorized.status, 200);
  assert.equal((await authorized.arrayBuffer()).byteLength, asset.size);

  function manage(page: Page) {
    return page.locator(".settings-content [data-nav=library]").click();
  }
  async function confirmDialog(page: Page, id: string) {
    await page.locator('.asset-filter [data-tab="images"]').click();
    await page.locator(`[data-act="image-detail"][data-key="${id}"]`).click();
    await action(page, "delete-image").click();
    await expect(page.locator("#modal h2")).toHaveText("删除该图片？");
    await expect(page.locator("#modal p")).toHaveText(
      "正在被任务或作品引用的图片会保留。",
    );
  }

  await withPages(backend, "admin", 1440, "light", team, async (pages) => {
    await all(pages, async (page) => {
      await setTab(page, "storage");
      await inspectStorage(page, populated);
    });
    await output(prefix + "-storage-populated", pages, headings.storage);
    await all(pages, async (page) => {
      await manage(page);
      await expect(page.locator(".assets-view")).toBeVisible();
      await confirmDialog(page, asset.id);
    });
    await output(
      prefix + "-storage-delete-confirmation",
      pages,
      "删除该图片？",
    );
    await all(pages, async (page) => {
      let deletes = 0;
      page.on("request", (req) => {
        if (req.method() === "DELETE") deletes++;
      });
      await page.locator("#modal #back").click();
      await expect(page.locator("#modal")).toBeHidden();
      assert.equal(deletes, 0);
    });
    const unchanged = await readState(backend, team);
    assert.equal(unchanged.used, populated.used);
    for (const { page, react } of pages) {
      const target = react ? await upload(backend, team) : asset;
      const prior = await readState(backend, team);
      await open(page, "/studio", react, team);
      await settings(page);
      await setTab(page, "storage");
      await manage(page);
      await confirmDialog(page, target.id);
      const removed = await request(
        page,
        "/api/assets/" + target.id,
        "DELETE",
        () => page.locator("#modal #confirm").click(),
      );
      await contract(
        "storage confirmed asset delete",
        removed,
        backend,
        team,
        200,
        undefined,
        { ok: true },
      );
      await expect(page.locator("#modal")).toBeHidden();
      await expect(
        page.locator(`[data-asset-key="asset:${target.id}"]`),
      ).toHaveCount(0);
      const after = await readState(backend, team);
      assert.equal(after.used, prior.used! - target.size);
      assert.equal(after.reserved, populated.reserved);
      const gone = await fetchAs(
        backend.web,
        backend.admin,
        "/media/" + target.id,
        { workspace: team },
      );
      assert.equal(gone.status, 404);
      await gone.body?.cancel();
      await settings(page);
      await active(page, "storage");
      await inspectStorage(page, after);
    }
    await json(
      await fetchAs(
        backend.web,
        backend.admin,
        "/api/jobs/" + job.id + "/cancel",
        {
          workspace: team,
          body: {},
        },
      ),
    );
    const after = await readState(backend, team);
    assert.equal(after.used, before.used);
    assert.equal(after.reserved, before.reserved);
    await all(pages, (page) => inspectStorage(page, after));
    await output(prefix + "-storage-after-cleanup", pages, headings.storage);
  });
}

async function permissions(prefix: string, backend: Backend, team: number) {
  const checks = [
    { path: adminChat, method: "GET" },
    {
      path: adminChat + "/deepseek",
      method: "PUT",
      body: { key: rejectedKey },
    },
    { path: adminChat + "/openai/test", method: "POST", body: {} },
    { path: imageCheck, method: "POST", body: {} },
    {
      path: "/api/settings/openai",
      method: "PUT",
      body: { enabled: false, default_model: model },
    },
  ];
  async function forbiddenFor(cookie: string) {
    const calls = wire.calls.length;
    for (const { path, ...options } of checks)
      assert.deepEqual(
        await json(
          await fetchAs(backend.web, cookie, path, {
            ...options,
            workspace: team,
          }),
          403,
        ),
        forbidden,
        path,
      );
    assert.equal(wire.calls.length, calls);
  }
  await forbiddenFor(backend.member);
  const userState = await readState(backend, team, "member");
  for (const name of ["used", "reserved", "quota", "disk_free"])
    assert.ok(
      !Object.hasOwn(userState, name),
      name + " leaked to member state",
    );
  const personal = (await readState(backend, team)).workspaces.find(
    (workspace) => workspace.kind === "personal",
  )!.id;
  await withPages(backend, "admin", 1440, "light", personal, async (pages) => {
    await all(pages, (page) =>
      enterChat(
        page,
        backend,
        personal,
        true,
        true,
        "chat read before revocation",
      ),
    );
    const release = gate();
    const waits = await all(pages, async (page) => {
      const held = gate();
      await page.route(
        "**/api/admin/chat/deepseek",
        async (route) => {
          held.resolve();
          await release.promise;
          await route.continue();
        },
        { times: 1 },
      );
      await secret(page, "deepseek").fill(rejectedKey);
      const response = request(page, adminChat + "/deepseek", "PUT", () =>
        submit(page, "deepseek").click(),
      );
      await held.promise;
      await expect(submit(page, "deepseek")).toBeDisabled();
      await expect(testChat(page, "deepseek")).toBeDisabled();
      await expect(testChat(page, "openai")).toBeEnabled();
      return { response };
    });
    try {
      await fixture!.demoteAdmin(backend.web);
    } finally {
      release.resolve();
    }
    for (const { response } of waits)
      await contract(
        "chat save after role revoked",
        await response,
        backend,
        personal,
        403,
        { key: rejectedKey },
        forbidden,
      );
    for (const { page, react } of pages) {
      if (react) {
        for (const name of tabs) await expect(tab(page, name)).toHaveCount(0);
        await expect(tab(page, "general")).toHaveAttribute(
          "aria-current",
          "page",
        );
        await expect(chatForm(page, "deepseek")).toHaveCount(0);
      } else {
        await expect(message(page, "deepseek")).toHaveText(forbidden.detail);
      }
      await open(page, "/studio", react, personal);
      await settings(page);
      for (const name of tabs) await expect(tab(page, name)).toHaveCount(0);
      await setTab(page, "general");
    }
    await output(prefix + "-revoked", pages, "常规");
  });
  await forbiddenFor(backend.admin);
  const revoked = await readState(backend, personal);
  for (const name of ["used", "reserved", "quota", "disk_free"])
    assert.ok(
      !Object.hasOwn(revoked, name),
      name + " leaked after role revocation",
    );
  await fixture!.restoreAdmin(backend.web);
  assert.deepEqual(
    await json(
      await fetchAs(backend.web, backend.admin, adminChat + "/deepseek/test", {
        workspace: personal,
        body: {},
      }),
    ),
    { ok: true },
    "Denied save preserved the previous provider credential",
  );
}

try {
  await mkdir(out, { recursive: true });
  fixture = await settingsFixture({ services: wire.origin });
  browser = await chromium.launch();
  for (const [name, backend] of Object.entries(fixture.backends)) {
    console.log("Comparing Studio service and storage settings over " + name);
    await matrix(name, backend, fixture.team);
    await services(name, backend, fixture.team);
    await storage(name, backend, fixture.team);
    await permissions(name, backend, fixture.team);
  }
  assert.deepEqual(pageErrors, []);
  assert.equal(
    wire.calls.length,
    30,
    "Unexpected extra calls or missing provider probes",
  );
  assert.ok(
    wire.calls.every((call) => call.matched),
    JSON.stringify(wire.calls),
  );
  passed = true;
} finally {
  await browser?.close();
  await fixture?.cleanup();
  await wire.close();
  const result = {
    passed,
    nativeDatabase: process.env.TEST_DATABASE_URL ? "PostgreSQL" : "PGlite",
    visual,
    contracts: [...exchanges.keys()],
    providerCalls: wire.calls.length,
    pageErrors,
  };
  await writeFile(
    join(out, "results.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(
    `Studio service settings comparisons ${visual.length}, HTTP contracts ${exchanges.size}, loopback provider probes ${wire.calls.length}`,
  );
}
