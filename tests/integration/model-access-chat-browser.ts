import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

// Render the two real composers against deterministic browser responses. The
// companion advanced suite exercises the same requests against Nest and PG.
async function composerPage(t: test.TestContext) {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  const bundle = await build({
    stdin: {
      loader: "tsx",
      resolveDir: join(process.cwd(), "apps/web"),
      contents: `
 import {createRoot} from 'react-dom/client';
 import {ChatWorkspace} from './canvas-editor/chat/ChatWorkspace';
 import {AiStoryboard} from './canvas-editor/AiStoryboard';
 const props={workspace:1,userId:1};
 createRoot(document.getElementById('root')).render(location.pathname==='/storyboard'
   ? <AiStoryboard {...props} project="project" onApply={async()=>{}} onRecharge={()=>{}}/>
   : <ChatWorkspace {...props} getContext={async()=>({project:'project',node:'',expected_revision:Number(sessionStorage.getItem('canvasRev')||3)})}/>);
 `,
    },
    bundle: true,
    write: false,
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  await page.route("https://chat.test/bundle", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: bundle.outputFiles[0].text,
    }),
  );
  return { page, bundle };
}
test("聊天和分镜按显示的最高扣费发送，报价冲突保留草稿，重开可展开账单", async (t) => {
  const { page, bundle } = await composerPage(t);
  const auth = {
    max_charge: "0.72",
    max_output_tokens: 4000,
    price_revision: "price",
    route_revision: "route",
    quote_context: "prompt",
  };
  let revision = 1,
    accepted = false,
    conflict = true,
    storyboard = false,
    storyboardFailed = false;
  const cid = "a".repeat(32),
    failedCid = "b".repeat(32);
  const conversation = () => ({
    id: storyboardFailed ? failedCid : cid,
    title: "验收",
    revision,
    model: "native",
    active_turn: null,
    updated: 1,
    can_delete: true,
  });
  const messages = () =>
    accepted
      ? [
          {
            id: 1,
            role: "user",
            content: "我的草稿",
            context: "{}",
            state: "complete",
          },
          {
            id: storyboardFailed ? 4 : 2,
            role: "assistant",
            model: "native",
            content: storyboard
              ? JSON.stringify([
                  { title: "镜头", prompt: "光", narration: "", seconds: 5 },
                ])
              : "已交付",
            state: storyboardFailed ? "failed" : "complete",
            reply_to: 1,
          },
        ]
      : [];
  const submitted: Record<string, any>[] = [];
  await page.route("https://chat.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path === "/bundle")
      return route.fulfill({
        contentType: "application/javascript",
        body: bundle.outputFiles[0].text,
      });
    if (!path.startsWith("/api/"))
      return route.fulfill({
        contentType: "text/html",
        body: '<main id="root"></main><script src="/bundle"></script>',
      });
    if (path === "/api/chat/config")
      return route.fulfill({
        json: {
          models: { native: { billing: "token", label: "按量模型" } },
          pricing: { revision: 1, items: [] },
          credits: { available: 2, exact: { available: "2" } },
        },
      });
    if (path === "/api/canvases/project")
      return route.fulfill({ json: { id: "project", revision: 3 } });
    if (path === "/api/chat/quote") return route.fulfill({ json: auth });
    if (path === "/api/chats" && method === "GET")
      return route.fulfill({ json: { conversations: [] } });
    if (path.endsWith("/events"))
      return route.fulfill({
        contentType: "text/event-stream",
        body: ": keepalive\n\n",
      });
    if (path.endsWith("/bills"))
      return route.fulfill({
        json: {
          bills: accepted
            ? [
                {
                  kind: "fixed",
                  turn: "other",
                  message: 7,
                  user_message: 6,
                  held: "9",
                  charged: "9",
                  state: "complete",
                },
                {
                  kind: "token",
                  turn: "t",
                  message: path.includes(failedCid) ? 4 : 2,
                  user_message: 1,
                  held: "0.72",
                  charged: path.includes(failedCid) ? "0" : "0.64",
                  state: path.includes(failedCid) ? "failed" : "complete",
                  lines: [
                    {
                      key: "cacheWrite",
                      tokens: "1000",
                      rate: "100",
                      subtotal: "0.1",
                      inherited_from: "input",
                    },
                  ],
                },
              ]
            : [],
        },
      });
    if (path.endsWith("/messages")) {
      submitted.push(route.request().postDataJSON());
      if (conflict) {
        conflict = false;
        return route.fulfill({ status: 409, json: { detail: "报价已变化" } });
      }
      accepted = true;
      revision++;
    }
    return route.fulfill({
      json: {
        conversation: conversation(),
        messages: messages(),
      },
    });
  });
  await page.goto("https://chat.test/chat");
  const input = page.getByRole("textbox", { name: "发送消息" });
  await input.fill("我的草稿");
  const send = page.getByRole("button", { name: "发送", exact: true });
  await expect(page.locator(".fm-chat-cost")).toContainText("最高 0.72");
  await send.click();
  await expect(page.getByRole("alert")).toContainText("报价已变化");
  await expect(input).toHaveValue("我的草稿");
  await send.click();
  await expect(page.locator("summary")).toHaveText("实扣 0.64 积分");
  await page.reload();
  await page.locator("summary").click();
  await expect(page.locator(".fm-chat-bill")).toContainText(
    "缓存写入 1000 Token × 100",
  );
  for (const body of submitted)
    for (const [key, value] of Object.entries(auth))
      assert.equal(body[key], value);
  assert.equal(submitted[0].uid, submitted[1].uid);
  storyboard = true;
  await page.goto("https://chat.test/storyboard");
  await page.getByRole("textbox", { name: "创作需求" }).fill("花园");
  await expect(page.locator(".storyboard-request")).toContainText("最高 0.72");
  const posted = page.waitForRequest((r) => r.url().endsWith("/messages"));
  await page.getByRole("button", { name: "拟定分镜" }).click();
  const body = (await posted).postDataJSON();
  assert.match(body.text, /花园/);
  assert.deepEqual(body.context, { project: "project", expected_revision: 3 });
  for (const [key, value] of Object.entries(auth))
    assert.equal(body[key], value);
  await expect(page.locator("summary")).toHaveText("实扣 0.64 积分");
  await page.reload();
  await expect(page.locator("summary")).toHaveText("实扣 0.64 积分");
  storyboardFailed = true;
  // A second conversation can fail while keeping the previous editable shots.
  await page.getByRole("button", { name: "拟定分镜", exact: true }).click();
  await expect(page.locator("summary")).toHaveText([
    "实扣 0 积分",
    "实扣 0.64 积分",
  ]);
  await page.reload();
  await expect(page.locator("summary")).toHaveText([
    "实扣 0 积分",
    "实扣 0.64 积分",
  ]);
  await expect(page.getByRole("alert")).toContainText("未完成");
  await expect(page.locator(".storyboard-proposal input").first()).toHaveValue(
    "镜头",
  );
});

test("画布受理后丢失响应，刷新零余额原样重放并保留编辑后的草稿", async (t) => {
  const { page, bundle } = await composerPage(t);
  const cid = "c".repeat(32),
    submitted: any[] = [];
  let accepted = false,
    quoteCount = 0;
  await page.route("https://chat.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname,
      method = route.request().method();
    if (path === "/bundle")
      return route.fulfill({
        contentType: "application/javascript",
        body: bundle.outputFiles[0].text,
      });
    if (!path.startsWith("/api/"))
      return route.fulfill({
        contentType: "text/html",
        body: '<main id="root"></main><script src="/bundle"></script>',
      });
    if (path === "/api/chat/config")
      return route.fulfill({
        json: {
          models: { native: { billing: "token", label: "测试" } },
          pricing: { revision: 1, items: [] },
          credits: {
            available: accepted ? 0 : 1,
            exact: { available: accepted ? "0" : "1" },
          },
        },
      });
    if (path === "/api/chats" && method === "GET")
      return route.fulfill({
        json: {
          conversations: accepted
            ? [
                {
                  id: cid,
                  title: "画布",
                  model: "native",
                  active_turn: null,
                  updated: 1,
                  revision: 3,
                  can_delete: true,
                },
              ]
            : [],
        },
      });
    if (path === "/api/chat/quote") {
      quoteCount++;
      return accepted
        ? route.fulfill({ status: 409, json: { detail: "余额不足" } })
        : route.fulfill({
            json: {
              max_charge: "1",
              max_output_tokens: 256,
              price_revision: "p",
              route_revision: "r",
              quote_context: "ctx",
            },
          });
    }
    if (path.endsWith("/events"))
      return route.fulfill({
        contentType: "text/event-stream",
        body: ": live\n\n",
      });
    if (path.endsWith("/bills")) return route.fulfill({ json: { bills: [] } });
    if (path.endsWith("/messages")) {
      submitted.push(route.request().postDataJSON());
      if (!accepted) {
        accepted = true;
        return route.abort("failed");
      }
    }
    return route.fulfill({
      json: {
        conversation: {
          id: cid,
          title: "画布",
          model: "native",
          active_turn: null,
          updated: 1,
          revision: accepted ? 3 : 1,
          can_delete: true,
        },
        messages: [],
      },
    });
  });
  await page.goto("https://chat.test/chat");
  const input = page.getByRole("textbox", { name: "发送消息" });
  await input.fill("第一条");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  const quotes = quoteCount;
  await page.evaluate(() => sessionStorage.setItem("canvasRev", "4"));
  await page.reload();
  await expect(input).toHaveValue("第一条");
  await page.getByRole("button", { name: "新对话", exact: true }).click();
  await expect(page.getByRole("button", { name: "确认上次发送" })).toHaveCount(
    0,
  );
  await page.locator(".fm-chat-conversation-open").click();
  await expect(input).toHaveValue("第一条");
  await input.fill("修改后的下一条");
  await page
    .getByRole("button", { name: "确认上次发送" })
    .click({ timeout: 2000 });
  await expect.poll(() => submitted.length).toBe(2);
  assert.deepEqual(submitted[0], submitted[1]);
  assert.equal(submitted[1].context.expected_revision, 3);
  assert.equal(quoteCount, quotes);
  await expect(input).toHaveValue("修改后的下一条");
});
