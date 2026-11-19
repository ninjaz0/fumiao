/** Pinned Studio and Next run the same browser actions on independent fixtures. */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  chromium,
  expect,
  type Browser,
  type Page,
  type Response,
  type Route,
} from "@playwright/test";
import sharp from "sharp";
import type { ConnectionOptions } from "bullmq";
import { createOriginalApp } from "../apps/api/src/original.js";
import { ChatExecution } from "../packages/original-api/src/chat-execution.js";
import { ChatQueue } from "../packages/original-api/src/chat-queue.js";
import { ChatRuntime } from "../packages/original-api/src/chat-runtime.js";
import { OriginalChats } from "../packages/original-api/src/chats.js";
import type { Actor } from "../packages/platform/src/platform.js";
import { StudioCatalog } from "../packages/platform/src/catalog.js";
import {
  importLegacy,
  type LegacyExport,
} from "../packages/platform/src/importer.js";
import { chatStreaming } from "../plugins/chat/src/stream.js";
import { flowText } from "../plugins/flow/src/text.js";
import { gpuText } from "../plugins/gpu/src/text.js";
import { imagesText } from "../plugins/images/src/text.js";
import { museText } from "../plugins/muse/src/text.js";
import { databaseFixture } from "../tests/helpers/database.js";
import { tree } from "./verify-homepage.js";
import { assertStudio } from "./studio-settings-browser.js";
import {
  composerMedia,
  composerProviders,
  composerQueue,
  verifyStudioComposer,
} from "./verify-studio-composer.js";

const timeout = 15_000;
const password = "chat-http-fixture";
const composer = process.argv.includes("--composer");
const out = resolve(
  composer
    ? ".runtime-advanced/studio-composer-nest-parity"
    : ".runtime-advanced/studio-chat-parity",
);
const names = ["pinned", "compat", "nest"] as const;
type Side = (typeof names)[number];
type Target = { name: Side; origin: string; canvas: string };
type ProviderCall = { stream: boolean; messages: { content: string }[] };

const logs: string[] = [];
const children: ChildProcess[] = [];
const errors: string[] = [];
const pictures: { state: string; side: Side; differentPixels: number }[] = [];
const calls = new Map<Side, ProviderCall[]>();
const failedOnce = new Set<Side>();
const streams = new Map<Side, ServerResponse>();
const provider = createServer(async (request, response) => {
  try {
    const side = names.find((name) => request.url?.startsWith(`/${name}/`));
    assert.ok(side);
    assert.equal(request.url, `/${side}/chat/completions`);
    assert.equal(request.headers.authorization, "Bearer sk-" + password);
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    const input: ProviderCall = JSON.parse(Buffer.concat(chunks).toString());
    const requests = calls.get(side) ?? [];
    requests.push(input);
    calls.set(side, requests);
    if (!input.stream) {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          choices: [
            { finish_reason: "stop", message: { content: "实测对话标题" } },
          ],
        }),
      );
    } else if (
      input.messages.at(-1)?.content === "触发提供方错误" &&
      !failedOnce.has(side)
    ) {
      failedOnce.add(side);
      response.writeHead(503).end();
    } else {
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "X-Request-Id": "studio-chat-fixture",
      });
      response.flushHeaders();
      streams.set(side, response);
    }
  } catch (error) {
    errors.push(String(error));
    response.destroy();
  }
});

function delta(
  response: ServerResponse,
  content: string,
  finish_reason: string | null = null,
) {
  response.write(
    `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason }] })}\n\n`,
  );
}

async function takeStream(side: Side) {
  await expect.poll(() => streams.has(side), { timeout }).toBe(true);
  const stream = streams.get(side)!;
  streams.delete(side);
  // The request-id frame may consume the first partial-write interval.
  await delay(250);
  return stream;
}

async function listen(server: ReturnType<typeof createServer>) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as AddressInfo).port;
}

async function freePort() {
  const server = createServer();
  const port = await listen(server);
  await new Promise<void>((end) => server.close(() => end()));
  return port;
}
const local = (port: number) => `http://127.0.0.1:${port}`;

function start(
  command: string,
  args: string[],
  additions: NodeJS.ProcessEnv = {},
) {
  const child = spawn(command, args, {
    env: { ...process.env, ...additions },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  for (const stream of [child.stdout!, child.stderr!])
    stream.on("data", (chunk) => logs.push(String(chunk)));
  child.on("error", (error) => logs.push(String(error)));
  return child;
}

async function startOracle(
  directory: string,
  providerUrl: string,
  site: string,
  media?: string,
) {
  const child = start(
    process.env.STUDIO_PYTHON ||
      resolve(".runtime-advanced/original/.venv/bin/python"),
    [
      "scripts/chat-http-oracle.py",
      directory,
      providerUrl,
      site,
      ...(media ? [media] : []),
    ],
  );
  const path = join(directory, "server.json");
  await expect
    .poll(
      async () => {
        assert.equal(child.exitCode, null);
        return Boolean(await readFile(path).catch(() => null));
      },
      { timeout },
    )
    .toBe(true);
  const fixture: { port: number; canvas: { id: string } } = JSON.parse(
    await readFile(path, "utf8"),
  );
  return { origin: local(fixture.port), canvas: fixture.canvas.id };
}

async function startWeb(port: number, backend: string) {
  const child = start(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "apps/web",
      "-H",
      "127.0.0.1",
      "-p",
      String(port),
    ],
    {
      STUDIO_MODE: undefined,
      STUDIO_CANVAS_EDITOR: undefined,
      LEGACY_API_INTERNAL_URL: backend,
      FUMIAO_REPOSITORY_ROOT: process.cwd(),
      NEXT_TELEMETRY_DISABLED: "1",
    },
  );
  await expect
    .poll(
      async () => {
        assert.equal(child.exitCode, null);
        return fetch(local(port) + "/api/workspaces", {
          signal: AbortSignal.timeout(1000),
        })
          .then(async (r) => {
            await r.body?.cancel();
            return r.status;
          })
          .catch(() => 0);
      },
      { timeout },
    )
    .toBe(401);
}

type Snapshot = {
  conversation: {
    id: string;
    model: string;
    revision: number;
    active_turn: string | null;
  };
  messages: { id: number; role: string; content: string; state: string }[];
};

async function exercise(browser: Browser, target: Target, mobile = false) {
  const context = await browser.newContext({
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    locale: "zh-CN",
  });
  try {
    await context.addInitScript(
      (theme) => {
        localStorage.setItem("fumiao-appearance", theme);
      },
      mobile ? "dark" : "light",
    );
    const login = await context.request.post(target.origin + "/api/login", {
      headers: { Origin: target.origin },
      data: { name: "admin", password },
    });
    assert.equal(login.status(), 200, await login.text());
    const state = await context.request.get(target.origin + "/api/state");
    assert.equal(state.status(), 200, await state.text());
    const { workspace_id: workspace, workspaces } = await state.json();
    const team = workspaces.find(
      (space: { kind: string }) => space.kind === "team",
    ).id;
    const page = await context.newPage();
    page.setDefaultTimeout(timeout);
    page.on("pageerror", (error) =>
      errors.push(`${target.name}: ${error.message}`),
    );
    const scriptPaths: string[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "script")
        scriptPaths.push(new URL(request.url()).pathname);
    });
    const firstPage = await page.goto(target.origin + "/studio");
    assert.equal(firstPage?.status(), 200);
    const chatNav = page.locator("nav [data-nav=chat]");
    const homeNav = page.locator("nav [data-nav=home]");
    const edit = page.getByRole("textbox", { name: "发送消息" });
    const model = page.getByRole("button", { name: /^对话模型：/ });
    const send = page.getByRole("button", { name: "发送", exact: true });
    const stop = page.getByRole("button", { name: "停止回复" });
    const assistant = page.locator(".fm-chat-message.assistant").last();
    const nav = async () => {
      const documentStarted = await page.evaluate(() => performance.timeOrigin);
      await chatNav.click();
      await expect(page.locator("#chat-root")).toBeVisible();
      assert.equal(
        await page.evaluate(() => performance.timeOrigin),
        documentStarted,
      );
    };
    const aliases = new Map([[target.canvas, "$canvas"]]);
    const requests: unknown[] = [];
    const ledger: unknown[] = [];
    const snapshots: string[] = [];
    let conversation = "";
    const stablePath = (path: string) =>
      [...aliases].reduce(
        (value, [id, alias]) => value.replaceAll(id, alias),
        path,
      );
    const canvas = "/api/canvases/" + target.canvas;
    async function picture(name: string) {
      const state = (mobile ? "mobile-" : "") + name;
      const file = join(out, state + "-" + target.name);
      await page.evaluate(() => document.fonts.ready);
      const dom = JSON.stringify(await tree(page), (key, value) => {
        if (typeof value !== "string") return value;
        if (
          ["id", "aria-controls"].includes(key) &&
          /^_[rR]_[a-z0-9]+_$/.test(value)
        )
          return "_react_id_";
        return stablePath(value);
      });
      await writeFile(file + ".json", dom);
      const png = await page.screenshot({
        path: file + ".png",
        animations: "disabled",
      });
      snapshots.push(state);
      if (target.name === "pinned") return;
      const reference = join(out, state + "-pinned");
      assert.deepEqual(
        JSON.parse(dom),
        JSON.parse(await readFile(reference + ".json", "utf8")),
        state + " DOM",
      );
      const [before, after] = await Promise.all(
        [reference + ".png", png].map((image) =>
          sharp(image)
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true }),
        ),
      );
      assert.deepEqual(after.info, before.info, state + " dimensions");
      let differentPixels = 0;
      for (let i = 0; i < before.data.length; i += 4)
        if (before.data.readUInt32LE(i) !== after.data.readUInt32LE(i))
          differentPixels++;
      pictures.push({ state, side: target.name, differentPixels });
      assert.equal(differentPixels, 0, state + " pixels");
    }

    async function mutation(
      path: string,
      action: () => Promise<void>,
      selected = workspace,
      map?: (value: Snapshot) => void,
    ) {
      const [result] = await Promise.all([
        page.waitForResponse(
          (candidate) =>
            new URL(candidate.url()).pathname === path &&
            candidate.request().method() !== "GET",
        ),
        action(),
      ]);
      const request = result.request();
      assert.equal(
        result.status(),
        200,
        result.ok() ? path : await result.text().catch(() => path),
      );
      assert.equal(request.headers()["x-workspace-id"], String(selected));
      assert.equal((await request.allHeaders()).origin, target.origin);
      if (target.name !== "pinned")
        assert.equal(result.headers()["x-fumiao-web"], "next");
      if (map) map(await result.json());
      const body = request.postDataJSON();
      if (body?.uid) {
        assert.match(body.uid, /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
        body.uid = "$uid";
      }
      if (body?.project) body.project = stablePath(body.project);
      if (body?.message) {
        assert.equal(body.message, firstReply);
        body.message = "$firstReply";
      }
      if (body?.retry) {
        assert.equal(body.retry, failedReply);
        body.retry = "$failedReply";
      }
      requests.push({
        path: stablePath(path),
        method: request.method(),
        workspace: selected,
        body,
      });
    }
    async function credits(
      balance: number,
      reserved: number,
      selected = workspace,
    ) {
      const response = await context.request.get(
        target.origin + "/api/credits",
        {
          headers: { "X-Workspace-Id": String(selected) },
        },
      );
      assert.equal(response.status(), 200);
      const { wallet, history } = await response.json();
      assert.deepEqual(
        [wallet.balance, wallet.reserved, wallet.available],
        [balance, reserved, balance - reserved],
      );
      ledger.push({
        selected,
        wallet,
        history: history.map(
          ({
            action,
            amount,
            balance,
            reserved,
            actor_name,
          }: Record<string, unknown>) => ({
            action,
            amount,
            balance,
            reserved,
            actor_name,
          }),
        ),
      });
    }
    const eventPath = () => "/api/chats/" + conversation + "/events";
    function eventResponse() {
      return page.waitForResponse(
        (response) => new URL(response.url()).pathname === eventPath(),
      );
    }
    async function verifyEvents(pending: Promise<Response>) {
      const response = await pending;
      assert.equal(response.status(), 200);
      assert.match(response.headers()["content-type"], /^text\/event-stream/);
      assert.equal(
        new URL(response.url()).searchParams.get("workspace"),
        String(workspace),
      );
      if (target.name !== "pinned")
        assert.equal(response.headers()["x-fumiao-web"], "next");
    }
    const checkReact = async () => {
      await expect(chatNav).toHaveAttribute("aria-current", "page");
      if (target.name !== "pinned") {
        await assertStudio(page, true);
        assert.ok(
          !scriptPaths.some((path) =>
            ["/static/studio.js", "/static/chat.js"].includes(path),
          ),
        );
      } else assert.ok(scriptPaths.includes("/static/chat.js"));
    };

    await nav();
    await expect(model).toBeEnabled();
    await expect(edit).toHaveAttribute("placeholder", "发送消息…");
    await checkReact();
    await expect(page.locator(".fm-chat-cost")).toHaveText("1");
    await picture("empty");
    await model.press("ArrowDown");
    const alternate = page.getByRole("option", { name: "GPT-4.1" });
    await expect(alternate).toBeVisible();
    const pickerId = await page
      .getByRole("listbox", { name: "对话模型" })
      .getAttribute("id");
    assert.ok(pickerId);
    await expect(model).toHaveAttribute("aria-controls", pickerId);
    await picture("model-picker");
    await alternate.click();
    await expect(model).toHaveAccessibleName("对话模型：GPT-4.1");
    if (mobile) {
      await page.getByRole("button", { name: "对话历史", exact: true }).click();
      await expect(
        page.getByRole("complementary", { name: "对话历史" }),
      ).toBeVisible();
      await expect(page.locator(".fm-chat-main")).toHaveAttribute("inert", "");
      await picture("history");
      await page.getByRole("button", { name: "关闭对话历史" }).click();
      await expect(edit).toBeVisible();
      return { snapshots };
    }

    const config = await (
      await context.request.get(target.origin + "/api/chat/config", {
        headers: { "X-Workspace-Id": String(workspace) },
      })
    ).json();
    const price: number = config.pricing.items.find(
      ({ key }: { key: string }) => key === "gpt-4.1|reply",
    ).amount;
    assert.ok(price > 0);
    const showAvailable = (available: number) =>
      expect(page.locator(".fm-chat-cost")).toHaveAttribute(
        "title",
        `每条完整回复 ${price} 积分，可用 ${available}`,
        { timeout },
      );
    let firstReply = 0;
    let failedReply = 0;
    await edit.fill("写作首发 😀");
    const [messageSaved] = await Promise.all([
      page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname.endsWith("/messages") &&
          response.request().method() === "POST",
      ),
      mutation(
        "/api/chats",
        () => send.click(),
        workspace,
        (data: Snapshot) => {
          conversation = data.conversation.id;
          assert.match(conversation, /^[a-f0-9]{32}$/);
          aliases.set(conversation, "$conversation");
          assert.equal(data.conversation.model, "gpt-4.1");
          assert.deepEqual(data.messages, []);
        },
      ),
    ]);
    const firstRequest = messageSaved.request();
    const first: Snapshot = await messageSaved.json();
    const body = firstRequest.postDataJSON();
    const firstPath = new URL(messageSaved.url()).pathname;
    assert.equal(firstPath, "/api/chats/" + conversation + "/messages");
    assert.equal(messageSaved.status(), 200, JSON.stringify(first));
    if (target.name !== "pinned")
      assert.equal(messageSaved.headers()["x-fumiao-web"], "next");
    assert.equal(firstRequest.headers()["x-workspace-id"], String(workspace));
    assert.equal((await firstRequest.allHeaders()).origin, target.origin);
    assert.match(body.uid, /^[a-f0-9-]{36}$/);
    assert.deepEqual(
      { ...body, uid: "$uid" },
      {
        uid: "$uid",
        model: "gpt-4.1",
        text: "写作首发 😀",
        expected_revision: 1,
        price_revision: config.pricing.revision,
        retry: null,
      },
    );
    requests.push({
      path: stablePath(firstPath),
      method: "POST",
      workspace,
      body: { ...body, uid: "$uid" },
    });
    firstReply = first.messages.at(-1)!.id;
    assert.ok(first.conversation.active_turn);
    const firstStream = await takeStream(target.name);
    delta(firstStream, "**已流入**");
    await expect(assistant.locator("strong")).toHaveText("已流入");
    await expect(stop).toBeEnabled();
    await credits(100, price);
    await picture("streaming");

    // Leaving chat closes its live browser stream while the provider keeps working.
    await edit.fill("流中保留的后续草稿");
    await Promise.all([
      page.waitForEvent(
        "requestfailed",
        (request) => new URL(request.url()).pathname === eventPath(),
      ),
      homeNav.click(),
    ]);
    await expect(page.locator("#chat-root")).toHaveCount(0);
    await expect(page.locator("#prompt")).toBeVisible();
    await page.locator("#prompt").fill("创作页面独立草稿");
    let block = true;
    const glitch = async (route: Route) => {
      if (block) await route.abort("connectionreset");
      else await route.continue();
    };
    const eventsURL = (url: URL) => url.pathname === eventPath();
    await page.route(eventsURL, glitch);
    // Both bundles restore the saved model when config precedes the snapshot.
    // Match that response order before comparing the reconnecting UI.
    await page.route(
      "**/api/chats/" + conversation,
      async (route) => {
        await expect(model).toBeEnabled();
        await route.continue();
      },
      { times: 1 },
    );
    await nav();
    await expect(edit).toHaveValue("流中保留的后续草稿");
    await expect(
      page.getByText("正在重新连接，回复会在后台继续"),
    ).toBeVisible();
    await expect(assistant.locator("strong")).toHaveText("已流入");
    await expect(model).toHaveAccessibleName("对话模型：GPT-4.1");
    await picture("reconnecting");
    const reconnected = eventResponse();
    block = false;
    await verifyEvents(reconnected);
    await expect(page.getByText("正在重新连接，回复会在后台继续")).toHaveCount(
      0,
    );
    await page.unroute(eventsURL, glitch);
    await expect(assistant.locator("strong")).toHaveText("已流入");
    assert.equal(firstStream.destroyed, false);
    delta(firstStream, "\n\n完整回答。", "stop");
    firstStream.end("data: [DONE]\n\n");
    await expect(
      page.getByRole("heading", { name: "实测对话标题" }),
    ).toBeVisible();
    await expect(assistant.locator("p").last()).toHaveText("完整回答。");
    await showAvailable(100 - price);
    await credits(100 - price, 0);
    await picture("complete");

    const history = page.locator(".fm-chat-history");
    const row = () => history.locator(`[data-conversation="${conversation}"]`);
    async function holdRequest(path: string) {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const match = (url: URL) => url.pathname === path;
      const hold = async (route: Route) => {
        await gate;
        await route.continue();
      };
      await page.route(match, hold);
      return {
        release,
        remove: () => page.unroute(match, hold),
      };
    }
    for (const configFirst of [true, false]) {
      await homeNav.click();
      await expect(page.locator("#chat-root")).toHaveCount(0);
      const delayed = await holdRequest(
        configFirst ? "/api/chats/" + conversation : "/api/chat/config",
      );
      // SSE also sends a snapshot. Hold it until the two HTTP responses arrive.
      const events = await holdRequest(eventPath());
      await nav();
      const reply = assistant.locator("p").last();
      if (configFirst) {
        await expect(model).toBeEnabled();
        await expect(assistant).toHaveCount(0);
      } else {
        await expect(reply).toHaveText("完整回答。");
        await expect(model).toBeDisabled();
      }
      delayed.release();
      await expect(reply).toHaveText("完整回答。");
      await expect(edit).toHaveValue("流中保留的后续草稿");
      await expect(model).toBeEnabled();
      await expect(model).toHaveAccessibleName(
        configFirst ? "对话模型：GPT-4.1" : "对话模型：DeepSeek Flash",
      );
      const subscribed = verifyEvents(eventResponse());
      events.release();
      await subscribed;
      await Promise.all([events.remove(), delayed.remove()]);
      await picture(
        configFirst ? "history-config-first" : "history-snapshot-first",
      );
    }

    await history.getByRole("button", { name: "新对话" }).click();
    await expect(edit).toHaveValue("");
    await row().getByRole("button").click();
    await expect(edit).toHaveValue("流中保留的后续草稿");
    await expect(model).toHaveAccessibleName("对话模型：GPT-4.1");
    await row().click({ button: "right" });
    await expect(page.getByRole("menu", { name: "对话操作" })).toBeVisible();
    await picture("history-menu");
    await page.getByRole("menuitem", { name: /重命名/ }).click();
    await history.getByRole("textbox").fill("重命名后的历史");
    await mutation("/api/chats/" + conversation, () =>
      history.getByRole("textbox").press("Enter"),
    );
    await expect(
      page.getByRole("heading", { name: "重命名后的历史" }),
    ).toBeVisible();

    await assistant.getByRole("button", { name: "放入画布" }).click();
    const picker = page.getByRole("region", { name: "放入画布" });
    await picker.getByLabel("选择画布").selectOption(target.canvas);
    await picture("apply-picker");
    await mutation("/api/chats/" + conversation + "/apply", () =>
      picker.getByRole("button", { name: "添加文本节点" }).click(),
    );
    await expect(page.getByText("已放入画布")).toBeVisible();
    const open = assistant.getByRole("link", { name: "打开画布" });
    await expect(open).toHaveAttribute(
      "href",
      `/canvas/${target.canvas}?workspace=${workspace}`,
    );
    await expect(model).toBeEnabled();
    await picture("applied");
    const saved = await context.request.get(target.origin + canvas, {
      headers: { "X-Workspace-Id": String(workspace) },
    });
    assert.equal(saved.status(), 200);
    const { document } = await saved.json();
    assert.deepEqual(
      document.nodes.map(({ type, text }: { type: string; text: string }) => ({
        type,
        text,
      })),
      [
        { type: "text", text: "原文😀" },
        { type: "text", text: "**已流入**\n\n完整回答。" },
      ],
    );
    await expect(page.getByText("已放入画布")).toHaveCount(0);

    await edit.fill("停止这次回复");
    await mutation("/api/chats/" + conversation + "/messages", () =>
      send.click(),
    );
    const stoppedStream = await takeStream(target.name);
    delta(stoppedStream, "保留已生成的部分");
    await expect(assistant.locator(".fm-chat-prose")).toHaveText(
      "保留已生成的部分",
    );
    await credits(100 - price, price);
    await mutation("/api/chats/" + conversation + "/stop", () => stop.click());
    await expect(assistant.getByText("已停止，积分已退回")).toBeVisible();
    await expect(model).toBeEnabled();
    await credits(100 - price, 0);
    await showAvailable(100 - price);
    await picture("stopped");

    await edit.fill("触发提供方错误");
    await mutation(
      "/api/chats/" + conversation + "/messages",
      () => send.click(),
      workspace,
      (result: Snapshot) => {
        failedReply = result.messages.at(-1)!.id;
      },
    );
    await expect(
      assistant.getByText("对话服务暂时不可用，请稍后重试"),
    ).toBeVisible();
    await expect(model).toBeEnabled();
    await credits(100 - price, 0);
    await showAvailable(100 - price);
    await picture("provider-error");
    await mutation("/api/chats/" + conversation + "/messages", () =>
      assistant.getByRole("button", { name: "重试" }).click(),
    );
    const retried = await takeStream(target.name);
    delta(retried, "重试成功", "stop");
    retried.end("data: [DONE]\n\n");
    await expect(assistant.getByText("重试成功")).toBeVisible();
    await expect(
      assistant.getByRole("button", { name: "放入画布" }),
    ).toBeEnabled();
    await credits(100 - 2 * price, 0);

    await edit.fill("个人空间未发送草稿");
    await homeNav.click();
    await expect(page.locator("#prompt")).toHaveText("创作页面独立草稿");
    await nav();
    await expect(edit).toHaveValue("个人空间未发送草稿");
    const scopeButton = page.locator("[data-menu=workspaces]");
    const pickWorkspace = async (from: number, to: number) => {
      await scopeButton.click();
      await mutation(
        `/api/workspaces/${to}/select`,
        () => page.locator(`#popover [data-id="${to}"]`).click(),
        from,
      );
      await page.waitForURL(
        (url) => url.searchParams.get("workspace") === String(to),
      );
      await expect(homeNav).toHaveAttribute("aria-current", "page");
    };
    await pickWorkspace(workspace, team);
    await nav();
    await checkReact();
    await expect(edit).toHaveValue("");
    await expect(history.getByText("暂无对话")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "从一个想法开始" }),
    ).toBeVisible();
    await expect(page.locator(".fm-chat-cost")).toHaveText("1");
    await credits(100, 0, team);
    await picture("team-empty");
    await edit.fill("团队空间独立草稿");
    await pickWorkspace(team, workspace);
    await expect(page.locator("#prompt")).toHaveText("创作页面独立草稿");
    await nav();
    await expect(edit).toHaveValue("个人空间未发送草稿");
    await expect(row().getByRole("button")).toHaveText("重命名后的历史");
    await credits(100 - 2 * price, 0);

    await mutation("/api/chats/" + conversation, () =>
      page.getByRole("button", { name: "删除对话", exact: true }).click(),
    );
    await expect(page.getByText("对话已删除", { exact: false })).toBeVisible();
    await expect(row()).toHaveCount(0);
    await mutation("/api/chats/" + conversation + "/restore", () =>
      page.getByRole("button", { name: "撤销" }).click(),
    );
    await expect(row()).toBeVisible();
    await expect(assistant.getByText("重试成功")).toBeVisible();
    await expect(edit).toHaveValue("个人空间未发送草稿");
    await checkReact();
    await credits(100 - 2 * price, 0);
    const settlement = (ledger.at(-1) as { history: { action: string }[] })
      .history;
    assert.deepEqual(settlement.map(({ action }) => action).reverse(), [
      "reserve",
      "spend",
      "reserve",
      "refund",
      "reserve",
      "refund",
      "reserve",
      "spend",
    ]);

    // Follow the real canvas entry and return links with the current session.
    const cookies = await context.cookies();
    const originalSession = cookies.find(({ name }) => name === "fm_session");
    assert.ok(originalSession);
    await homeNav.click();
    await expect(page.locator("#prompt")).toHaveText("创作页面独立草稿");
    const documentStarted = await page.evaluate(() => performance.timeOrigin);
    const libraryNav = page.locator("nav [data-nav=library]");
    await libraryNav.click();
    await expect(libraryNav).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".assets-view")).toBeVisible();
    await expect(page.locator("#asset-composer #prompt")).toHaveText(
      "创作页面独立草稿",
    );
    await nav();
    await expect(edit).toHaveValue("个人空间未发送草稿");
    await expect(row().getByRole("button")).toHaveText("重命名后的历史");
    await expect(assistant.getByText("重试成功")).toBeVisible();
    assert.equal(
      await page.evaluate(() => performance.timeOrigin),
      documentStarted,
    );
    await checkReact();
    await page.locator("nav [data-nav=canvas]").click();
    await page.waitForURL(`**/canvas?workspace=${workspace}`);
    await page
      .locator(`a[href="/canvas/${target.canvas}?workspace=${workspace}"]`)
      .first()
      .click();
    await page.waitForURL(`**/canvas/${target.canvas}?workspace=${workspace}`);
    await expect(page.getByRole("textbox", { name: "画布名称" })).toHaveValue(
      "对话画布",
    );
    await page.getByRole("link", { name: "返回工作台" }).click();
    await expect(page).toHaveURL(
      `${target.origin}/studio?workspace=${workspace}`,
    );
    await expect(page.locator("#prompt")).toHaveText("创作页面独立草稿");
    await nav();
    await expect(edit).toHaveValue("个人空间未发送草稿");
    await expect(row().getByRole("button")).toHaveText("重命名后的历史");
    await expect(assistant.getByText("重试成功")).toBeVisible();
    assert.deepEqual(
      (await context.cookies()).find(({ name }) => name === "fm_session"),
      originalSession,
    );
    return { snapshots, requests, ledger, provider: calls.get(target.name) };
  } finally {
    await context.close();
  }
}

assert.ok(
  process.env.TEST_DATABASE_URL && process.env.TEST_REDIS_URL,
  "Set TEST_DATABASE_URL and TEST_REDIS_URL to isolated test services",
);
const redis = new URL(process.env.TEST_REDIS_URL);
assert.match(redis.protocol, /^rediss?:$/);
const redisConnection: ConnectionOptions = {
  host: redis.hostname,
  port: Number(redis.port || 6379),
  username: decodeURIComponent(redis.username) || undefined,
  password: decodeURIComponent(redis.password) || undefined,
  db: Number(redis.pathname.slice(1) || 0),
  ...(redis.protocol === "rediss:" ? { tls: {} } : {}),
  retryStrategy: () => null,
};
const f = await databaseFixture();
let browser: Browser | undefined;
let queue: ChatQueue | undefined;
let generation: Awaited<ReturnType<typeof composerQueue>> | undefined;
let app: Awaited<ReturnType<typeof createOriginalApp>> | undefined;
let composerReport:
  Awaited<ReturnType<typeof verifyStudioComposer>> | undefined;
let passed = false;
try {
  await mkdir(out, { recursive: true });
  const [compatPort, nestPort] = await Promise.all([freePort(), freePort()]);
  const providerUrl = local(await listen(provider));
  const media = composer ? await composerMedia(f.directory) : undefined;
  const [pinned, compat] = await Promise.all([
    startOracle(f.directory, providerUrl + "/pinned", "direct", media),
    startOracle(
      join(f.directory, "compat"),
      providerUrl + "/compat",
      local(compatPort),
      media,
    ),
  ]);
  await f.p.registry.installBuiltins(f.db);
  await f.db.transaction(async (sql) => {
    const catalog = new StudioCatalog(f.db);
    for (const plugin of [
      flowText,
      gpuText,
      imagesText,
      museText,
      chatStreaming,
    ])
      await catalog.activate(sql, plugin.manifest);
  });
  const source: LegacyExport = JSON.parse(
    await readFile(join(f.directory, "export.json"), "utf8"),
  );
  await importLegacy(f.p, source, join(f.directory, "sqlite/media"));
  const generationProviders = media
    ? await composerProviders(f, media)
    : undefined;
  if (generationProviders)
    await f.db.transaction(async (sql) => {
      const catalog = new StudioCatalog(f.db);
      for (const mock of generationProviders.mocks)
        await catalog.activate(sql, mock.manifest);
      // The mocks use the same rates. Restore the imported revision bumped
      // when each synthetic provider version was activated in this fixture.
      const revision = Number(
        source.tables.model_settings.find(
          ({ key }) => key === "credit_price_revision",
        )?.value,
      );
      assert.ok(Number.isSafeInteger(revision) && revision > 0);
      await sql.query("UPDATE studio_policy SET price_revision=$1", [revision]);
    });
  const {
    rows: [admin],
  } = await f.db.query<Actor>(
    "SELECT id,name,role,nickname FROM users WHERE name='admin'",
  );
  const generationConnections = generationProviders
    ? [...generationProviders.mocks, flowText]
    : [];
  for (const { manifest } of generationConnections) {
    const connection = await f.p.createConnection(admin, {
      name: manifest.id,
      pluginId: manifest.id,
      version: manifest.version,
      config:
        manifest.id === "gpu"
          ? {}
          : {
              baseUrl: providerUrl,
              apiKey: "sk-studio-composer-fixture",
            },
    });
    await f.p.updateConnection(admin, connection.id, {
      revision: 1,
      enabled: true,
      concurrency: 1,
    });
  }
  for (const id of ["deepseek", "openai"]) {
    const connection = await f.p.createConnection(
      {
        id: admin.id,
        name: admin.name,
        role: admin.role,
        nickname: admin.nickname,
      },
      {
        name: id,
        pluginId: chatStreaming.manifest.id,
        version: chatStreaming.manifest.version,
        config: {
          provider: id,
          baseUrl: providerUrl + "/nest/",
          apiKey: "sk-" + password,
        },
      },
    );
    await f.db.query("UPDATE connections SET enabled=true WHERE id=$1", [
      connection.id,
    ]);
  }
  queue = new ChatQueue(
    new ChatRuntime(new ChatExecution(new OriginalChats(f.p)), { pollMs: 80 }),
    redisConnection,
    {
      name: "test-studio-chat-" + randomUUID(),
      dispatchMs: 80,
      onError: (error) => errors.push(String(error)),
    },
  );
  await queue.start();
  process.env.PUBLIC_URL = local(nestPort);
  process.env.FUMIAO_PAYMENT_AUTOSTART = "0";
  app = await createOriginalApp(f.p);
  await app.listen(0, "127.0.0.1");
  await Promise.all([
    startWeb(compatPort, compat.origin),
    startWeb(nestPort, await app.getUrl()),
  ]);
  const originalHTML = await (await fetch(pinned.origin + "/studio")).text();
  for (const origin of [local(compatPort), local(nestPort)]) {
    const login = await fetch(origin + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ name: "admin", password }),
    });
    assert.equal(login.status, 200);
    const headers = { cookie: login.headers.get("set-cookie")!.split(";")[0] };
    const [defaultStudio, explicitLegacy] = await Promise.all([
      fetch(origin + "/studio", { headers }),
      fetch(origin + "/studio?studio_ui=legacy", { headers }),
    ]);
    assert.doesNotMatch(await defaultStudio.text(), /\/static\/studio\.js/);
    assert.equal(await explicitLegacy.text(), originalHTML);
  }
  browser = await chromium.launch({ args: ["--disable-partial-raster"] });
  if (media) {
    generation = await composerQueue(f, redisConnection);
    async function reply(side: Side) {
      const response = await takeStream(side);
      delta(response, "工作台集成模拟回复", "stop");
      response.end("data: [DONE]\n\n");
    }
    const oracle = (name: "pinned" | "compat", backend: typeof pinned, origin: string) => ({
      name,
      origin,
      canvas: backend.canvas,
      reply: () => reply(name),
      async complete(id: number) {
        const response = await fetch(
          backend.origin + "/__fixture/composer-results/" + id,
          { method: "POST" },
        );
        assert.equal(response.status, 200, await response.text());
      },
      async demote() {
        const response = await fetch(backend.origin + "/__fixture/demote-admin", {
          method: "POST",
        });
        assert.equal(response.status, 200, await response.text());
      },
    });
    composerReport = await verifyStudioComposer(
      browser,
      [
        oracle("pinned", pinned, pinned.origin),
        oracle("compat", compat, local(compatPort)),
        {
          name: "nest",
          origin: local(nestPort),
          canvas: pinned.canvas,
          complete: generation.complete,
          reply: () => reply("nest"),
          async demote() {
            await f.db.query("UPDATE users SET role='member' WHERE id=$1", [admin.id]);
          },
        },
      ],
      password,
      media,
      out,
    );
    assert.deepEqual(
      generationProviders!.calls.map(({ kind, model, references }) => [
        kind,
        model,
        references,
      ]),
      [
        ["video", "MiniMax H3", 0],
        ["image", "gpt-image-2.6-sunburst", 0],
        ["video", "MiniMax H3", 1],
        ["audio", "breeze-tts-2", 0],
      ],
    );
    console.log(
      `PASS Studio through Next/Python and Next/Nest: ${composerReport.comparisons.length} matching DOM/pixel comparisons, generation, replay, media, chat, canvas, settings, role and credit contracts`,
    );
  } else {
    const targets: Target[] = [
      { name: "pinned", ...pinned },
      { name: "compat", origin: local(compatPort), canvas: compat.canvas },
      { name: "nest", origin: local(nestPort), canvas: pinned.canvas },
    ];
    const [reference, ...candidates] = targets;
    const mobile = await exercise(browser, reference, true);
    const desktop = await exercise(browser, reference);
    for (const target of candidates) {
      assert.deepEqual(
        await exercise(browser, target, true),
        mobile,
        target.name + " mobile",
      );
      assert.deepEqual(
        await exercise(browser, target),
        desktop,
        target.name + " request, provider and credit contracts",
      );
    }
    console.log(
      `PASS Studio chat: ${pictures.length} exact DOM/pixel comparisons, browser mutations, SSE reconnect and PostgreSQL/BullMQ credit settlement`,
    );
  }
  assert.deepEqual(errors, []);
  passed = true;
} catch (error) {
  console.error(logs.join("").slice(-8000));
  throw error;
} finally {
  await writeFile(
    join(out, "report.json"),
    JSON.stringify(
      { passed, pictures, composer: composerReport, errors },
      null,
      2,
    ),
  );
  await browser?.close();
  for (const child of children.reverse()) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const closed = once(child, "close");
    child.kill("SIGTERM");
    const force = setTimeout(() => child.kill("SIGKILL"), 3000);
    await closed;
    clearTimeout(force);
  }
  await app?.close();
  await generation?.close();
  await queue?.close();
  provider.closeAllConnections();
  await new Promise<void>((done) => provider.close(() => done()));
  await f.cleanup();
}
