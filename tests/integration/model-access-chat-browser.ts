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
 const params=new URLSearchParams(location.search); const props={workspace:Number(params.get("workspace")||1),userId:Number(params.get("actor")||1)};
 createRoot(document.getElementById('root')).render(location.pathname==='/storyboard'
   ? <AiStoryboard {...props} project={params.get("project")||"project"} onApply={async()=>{}} onRecharge={()=>{}}/>
   : location.pathname==='/writeback'? <ChatWorkspace {...props} project="project" node="node" onApply={async(cid,message,mode,opts)=>{sessionStorage.setItem('applied',JSON.stringify({cid,id:message.id,opts}))}}/>
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
    storyboardFailed = false,
    sameChatHistory = false;
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
    if (/^\/api\/chat\/messages\/(2|4)\/source$/.test(path)) {
      const failed = path.includes("/4/"),
        message = failed ? 4 : 2;
      const turn = failed ? "failed" : sameChatHistory ? "prior" : "t";
      const state = failed ? "failed" : "complete";
      return route.fulfill({
        json: {
          cid: failed || sameChatHistory ? failedCid : cid,
          message,
          turn,
          state,
          actor: 1,
          workspace: 1,
          project: "project",
          content: failed
            ? ""
            : JSON.stringify([
                { title: "镜头", prompt: "光", narration: "", seconds: 5 },
              ]),
          bill: {
            kind: "token",
            message,
            turn,
            state,
            held: "0.72",
            charged: failed ? "0" : "0.64",
          },
        },
      });
    }
    if (path.endsWith("/bills"))
      return route.fulfill({
        json: {
          bills: accepted
            ? [
                ...(sameChatHistory && path.includes(failedCid)
                  ? [
                      {
                        kind: "fixed",
                        turn: "prior",
                        message: 2,
                        user_message: 1,
                        charged: "0.64",
                        state: "complete",
                      },
                    ]
                  : []),
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
        messages: sameChatHistory
          ? [
              {
                id: 2,
                role: "assistant",
                state: "complete",
                turn: "prior",
                content: "有效的早期回复",
              },
              ...messages(),
            ]
          : messages(),
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
  const key = "fm-storyboard-1-1-project-proposal";
  // Reopen an actual pre-upgrade cache after a later attempt has failed.
  await page.evaluate((key) => {
    const { shots } = JSON.parse(localStorage.getItem(key)!);
    localStorage.setItem(key, JSON.stringify({ message: 2, shots }));
  }, key);
  await page.reload();
  await expect(page.locator("summary")).toHaveText([
    "实扣 0 积分",
    "实扣 0.64 积分",
  ]);
  await expect(page.locator(".storyboard-proposal input").first()).toHaveValue(
    "镜头",
  );
  await page.reload();
  await expect(page.locator("summary")).toHaveText([
    "实扣 0 积分",
    "实扣 0.64 积分",
  ]);
  sameChatHistory = true;
  await page.evaluate((key) => {
    const { shots } = JSON.parse(localStorage.getItem(key)!);
    localStorage.setItem(key, JSON.stringify({ message: 2, shots }));
  }, key);
  await page.reload();
  await expect(page.locator("summary")).toHaveText([
    "实扣 0 积分",
    "实扣 0.64 积分",
  ]);
  await expect
    .poll(() =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!).source?.cid,
        key,
      ),
    )
    .toBe(failedCid);
  await page.goto("https://chat.test/storyboard?workspace=2");
  await expect(page.locator("summary")).toHaveCount(0);
  await expect(page.locator(".storyboard-proposal")).toHaveCount(0);
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

test("固定价重放原回合后只写回原助手消息和受理的画布版本", async (t) => {
  const { page, bundle } = await composerPage(t),
    cid = "d".repeat(32);
  const ctx = {
    project: "project",
    node: "node",
    writeback: true,
    expected_revision: 3,
  };
  const messages = [1, 2, 3, 4].map((id) => ({
    id,
    role: id % 2 ? "user" : "assistant",
    state: "complete",
    content: "消息" + id,
    context: id % 2 ? JSON.stringify({ ...ctx, text: "原文" }) : "{}",
    turn: id % 2 ? null : "t" + id,
    reply_to: id % 2 ? null : id - 1,
  }));
  const conversation = {
    id: cid,
    title: "固定价",
    model: "legacy",
    revision: 5,
    active_turn: null,
    can_delete: true,
    updated: 1,
  };
  await page.addInitScript(
    ({ cid, ctx }) => {
      const scope = "fm-chat-1-1-project-node";
      sessionStorage.setItem(scope + "-active", cid);
      sessionStorage.setItem(
        scope + "-pending-send-" + cid,
        JSON.stringify({
          cid,
          body: {
            uid: "test",
            model: "legacy",
            text: "消息1",
            expected_revision: 1,
            price_revision: 1,
            context: ctx,
          },
        }),
      );
    },
    { cid, ctx },
  );
  await page.route("https://chat.test/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/bundle")
      return route.fulfill({
        contentType: "application/javascript",
        body: bundle.outputFiles[0].text,
      });
    if (path === "/writeback")
      return route.fulfill({
        contentType: "text/html",
        body: '<main id="root"></main><script src="/bundle"></script>',
      });
    if (path.endsWith("/config"))
      return route.fulfill({
        json: {
          models: { legacy: { label: "固定价" } },
          pricing: { revision: 1, items: [{ key: "legacy|reply", amount: 1 }] },
          credits: { available: 0 },
        },
      });
    if (path.endsWith("/events"))
      return route.fulfill({
        contentType: "text/event-stream",
        body: ": live\n\n",
      });
    if (path.endsWith("/bills")) return route.fulfill({ json: { bills: [] } });
    if (path === "/api/chats")
      return route.fulfill({ json: { conversations: [conversation] } });
    return route.fulfill({
      json: {
        conversation,
        messages,
        ...(path.endsWith("/messages") ? { accepted_turn: "t2" } : {}),
      },
    });
  });
  await page.goto("https://chat.test/writeback");
  await page.getByRole("button", { name: "确认上次发送" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(sessionStorage.getItem("applied") || "{}").id,
      ),
    )
    .toBe(2);
  const applied = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("applied")!),
  );
  assert.equal(applied.cid, cid);
  assert.equal(applied.opts.expectedRevision, 3);
});

test("真实固定价分镜编辑后保留原账单，复制到另一真实画布的来源不显示账单", async (t) => {
  const { chatsFixture } = await import("../helpers/chats.js");
  const f = await chatsFixture();
  t.after(f.cleanup);
  const { page, bundle } = await composerPage(t);
  const shot = { title: "山谷", prompt: "晨光", narration: "", seconds: 5 };
  const a = (await f.request("POST", "/api/canvases", { title: "画布甲" }))
    .body;
  const b = (await f.request("POST", "/api/canvases", { title: "画布乙" }))
    .body;
  const prefix =
    "fm-storyboard-" + f.admin.public_id + "-" + f.workspace.public_id + "-";
  const url = (project: string) =>
    "https://chat.test/storyboard?" +
    new URLSearchParams({
      project,
      workspace: String(f.workspace.public_id),
      actor: String(f.admin.public_id),
    });
  const submitted: any[] = [];
  let fail = false;
  await page.route("https://chat.test/**", async (route) => {
    const { pathname, search } = new URL(route.request().url()),
      method = route.request().method();
    if (pathname === "/bundle")
      return route.fulfill({
        contentType: "application/javascript",
        body: bundle.outputFiles[0].text,
      });
    if (!pathname.startsWith("/api/"))
      return route.fulfill({
        contentType: "text/html",
        body: '<main id="root"></main><script src="/bundle"></script>',
      });
    if (pathname.endsWith("/events"))
      return route.fulfill({
        contentType: "text/event-stream",
        body: ": keepalive\n\n",
      });
    if (pathname === "/api/chat/config")
      return route.fulfill({
        json: {
          models: { "deepseek-flash": { label: "旧固定价" } },
          pricing: {
            revision: (await f.draft({ conversation: { revision: 1 } }))
              .price_revision,
            items: [{ key: "deepseek-flash|reply", amount: 1 }],
          },
          credits: { available: 20 },
        },
      });
    const body = method === "POST" ? route.request().postDataJSON() : undefined;
    const r = await f.request(method, pathname + search, body);
    if (
      pathname.endsWith("/messages") &&
      method === "POST" &&
      r.status === 200
    ) {
      submitted.push(body);
      const turn = await f.turn(r.body.accepted_turn);
      await f.chats.finish(turn.id, {
        state: fail ? "failed" : "complete",
        text: fail ? "" : JSON.stringify([shot]),
        error: fail ? "本次生成失败" : undefined,
      });
      return route.fulfill({
        json: {
          ...(await f.chats.get(f.admin, r.body.conversation.id)),
          accepted_turn: r.body.accepted_turn,
        },
      });
    }
    return route.fulfill({ status: r.status, json: r.body });
  });
  const destination = await f.chats.create(f.admin, {
    context: { project: b.id, expected_revision: b.revision },
  });
  const sent = await f.chats.send(
    f.admin,
    destination.conversation.id,
    await f.draft(destination, {
      context: { project: b.id, expected_revision: b.revision },
    }),
  );
  const turn = await f.turn(sent.conversation.active_turn);
  await f.chats.finish(turn.id, {
    state: "complete",
    text: JSON.stringify([shot]),
  });
  const message = sent.messages.at(-1)!.id;
  const foreign = {
    cid: destination.conversation.id,
    message,
    turn: turn.public_id,
  };
  for (const shape of ["完整来源", "旧消息号", "仅活动会话"])
    await t.test(shape + "来自画布乙", async () => {
      await page.goto(url(b.id));
      await page.evaluate(
        ({ prefix, project, shot, foreign, shape }) => {
          const key = prefix + project;
          localStorage.setItem(key + "-chat", foreign.cid);
          localStorage.setItem(
            key + "-proposal",
            JSON.stringify({
              message: foreign.message,
              shots: [shot],
              ...(shape === "完整来源" ? { source: foreign } : {}),
            }),
          );
        },
        { prefix, project: b.id, shot, foreign, shape },
      );
      await page.reload();
      await expect(page.locator("summary")).toHaveText("实扣 1 积分");
      await page.evaluate(
        ({ prefix, a, b, shape }) => {
          for (const suffix of ["-chat", "-proposal"])
            localStorage.setItem(
              prefix + a + suffix,
              localStorage.getItem(prefix + b + suffix)!,
            );
          if (shape === "仅活动会话")
            localStorage.removeItem(prefix + a + "-proposal");
        },
        { prefix, a: a.id, b: b.id, shape },
      );
      const decision = page.waitForResponse(
        (r) =>
          r.url().includes("/" + message + "/source") ||
          r.url().endsWith("/" + foreign.cid + "/bills"),
      );
      await page.goto(url(a.id));
      const proof = await decision;
      await expect(
        page.locator(".storyboard-proposal input").first(),
      ).toHaveValue(shot.title);
      assert.equal(
        proof.status(),
        404,
        "The same authorized message must not be accepted as a receipt on another canvas",
      );
      await expect(page.locator("summary")).toHaveCount(0);
    });
  await t.test("固定价新受理带项目，成功编辑后另一会话失败并刷新", async () => {
    await page.evaluate(() => localStorage.clear());
    await page.goto(url(a.id));
    await page.getByRole("textbox", { name: "创作需求" }).fill("拟定湖光");
    await page.getByRole("button", { name: "拟定分镜", exact: true }).click();
    await expect(
      page.locator(".storyboard-proposal input").first(),
    ).toHaveValue(shot.title);
    assert.deepEqual(submitted[0].context, {
      project: a.id,
      expected_revision: a.revision,
    });
    await expect(page.locator("summary")).toHaveText("实扣 1 积分");
    await page
      .locator(".storyboard-proposal input")
      .first()
      .fill("编辑后的山谷");
    fail = true;
    await page.getByRole("button", { name: "拟定分镜", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("本次生成失败");
    await page.reload();
    await expect(
      page.locator(".storyboard-proposal input").first(),
    ).toHaveValue("编辑后的山谷");
    await expect(page.locator("summary")).toHaveText([
      "实扣 0 积分",
      "实扣 1 积分",
    ]);
  });
  await t.test(
    "同画布两笔实扣，裸数组只有跟踪游标，重载后不认领后一次账单",
    async () => {
      const context = { project: a.id, expected_revision: a.revision };
      const chat = await f.chats.create(f.admin, { context });
      const cid = chat.conversation.id;
      const titles = ["第一轮山林", "第二轮海岸"];
      let snapshot = chat;
      let message = 0;
      for (const [index, title] of titles.entries()) {
        await f.db.query(
          "UPDATE studio_prices SET amount=$1 WHERE key='deepseek-flash|reply'",
          [index + 1],
        );
        const sent = await f.chats.send(
          f.admin,
          cid,
          await f.draft(snapshot, { context }),
        );
        const turn = await f.turn(sent.conversation.active_turn);
        await f.chats.finish(turn.id, {
          state: "complete",
          text: JSON.stringify([{ ...shot, title }]),
        });
        message = sent.messages.at(-1)!.id;
        const receipt = await f.request(
          "GET",
          "/api/chat/messages/" + message + "/source?project=" + a.id,
        );
        assert.equal(receipt.body.bill.charged, String(index + 1));
        snapshot = await f.chats.get(f.admin, cid);
      }
      const key = prefix + a.id;
      const shots = [{ ...shot, title: titles[0] + "（编辑过）" }];
      await page.evaluate(
        ({ key, shots }) => {
          localStorage.removeItem(key + "-chat");
          localStorage.setItem(key + "-proposal", JSON.stringify(shots));
        },
        { key, shots },
      );
      await page.reload();
      await expect
        .poll(() =>
          page.evaluate(
            (key) => JSON.parse(localStorage.getItem(key + "-proposal")!),
            key,
          ),
        )
        .toEqual({ message: null, shots, source: null });
      await page.evaluate(
        ({ key, cid }) => localStorage.setItem(key + "-chat", cid),
        { key, cid },
      );
      // Recover the offline draft, then open a bare array directly with the
      // same active chat and reload its upgraded representation.
      for (const restoreBareArray of [false, true, false]) {
        if (restoreBareArray)
          await page.evaluate(
            ({ key, shots }) =>
              localStorage.setItem(key + "-proposal", JSON.stringify(shots)),
            { key, shots },
          );
        const read = page.waitForResponse(
          (r) => new URL(r.url()).pathname === "/api/chats/" + cid,
        );
        await page.reload();
        await read;
        await expect(
          page.locator(".storyboard-proposal input").first(),
        ).toHaveValue(shots[0].title);
        await expect
          .poll(() =>
            page.evaluate(
              (key) => JSON.parse(localStorage.getItem(key + "-proposal")!),
              key,
            ),
          )
          .toEqual({ message, shots, source: null });
        await expect(page.locator("summary")).toHaveCount(0);
      }
    },
  );
});
