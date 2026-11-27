import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

// Render the two real composers against deterministic browser responses. The
// companion advanced suite exercises the same requests against Nest and PG.
test("聊天和分镜按显示的最高扣费发送，报价冲突保留草稿，重开可展开账单", async (t) => {
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
   : <ChatWorkspace {...props}/>);
 `,
    },
    bundle: true,
    write: false,
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  });
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
    storyboard = false;
  const cid = "a".repeat(32);
  const conversation = () => ({
    id: cid,
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
            id: 2,
            role: "assistant",
            model: "native",
            content: "已交付",
            state: "complete",
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
                  kind: "token",
                  turn: "t",
                  message: 2,
                  user_message: 1,
                  held: "0.72",
                  charged: "0.64",
                  state: "complete",
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
        messages: storyboard ? [] : messages(),
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
});
