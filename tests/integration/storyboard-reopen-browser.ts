import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

const harness = spawn(process.execPath, ["--import", "tsx", "tests/integration/smoke-studio-nest.ts", "--serve"], {
  env: process.env, stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
const exited = once(harness, "exit");
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  const login = await new Promise<RegExpMatchArray>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Studio harness startup timed out")), 180_000);
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/Isolated Studio (http:\/\/[^\s]+)\/studio\nSynthetic login ([^\s]+) \/ ([^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match); }
    };
    harness.stdout.on("data", collect);
    harness.stderr.on("data", collect);
    harness.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Studio harness exited: ${code}`)); });
  });
  const [, origin, user, password] = login;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto("/studio");
  await page.locator('[name="user"]').fill(user);
  await page.locator('[name="pw"]').fill(password);
  await page.locator('.auth-form [type="submit"]').click();
  await expect(page.locator(".shell")).toBeVisible();
  const state = await (await context.request.get("/api/state")).json();
  const headers = { Origin: origin, "X-Workspace-Id": String(state.workspace_id) };
  const created = await context.request.post("/api/canvases", { headers, data: { title: "AI 分镜编辑恢复验证" } });
  assert.equal(created.status(), 200);
  const { id } = await created.json();
  const key = `fm-storyboard-${state.me.id}-${state.workspace_id}-${id}`;
  const shot = { title: "原始镜头", prompt: "清晨，镜头缓缓掠过湖面。", narration: "清晨的湖光", seconds: 5 };
  await page.evaluate(({ key, shot }) => {
    localStorage.setItem(key + "-chat", "storyboard-test");
    localStorage.setItem(key + "-proposal", JSON.stringify([shot]));
    localStorage.setItem(key + "-brief", "记录清晨的湖光");
  }, { key, shot });
  let message: { id: number; role: string; state: string; content: string; turn?: string; error?: string } = { id: 101, role: "assistant", state: "complete", content: JSON.stringify([shot]) };
  let history: typeof message[] = [], activeTurn: string | null = null, revision = 1;
  const snapshot = () => ({ conversation: { id: "storyboard-test", active_turn: activeTurn, revision }, messages: [...history, message] });
  let eventSnapshots: ReturnType<typeof snapshot>[] | undefined;
  await page.route("**/api/chats/storyboard-test/events?*", route => route.fulfill({ contentType: "text/event-stream", body: (eventSnapshots || [snapshot()]).map(s => `data: ${JSON.stringify(s)}\n\n`).join("") }));
  await page.route("**/api/chats/storyboard-test", route => route.fulfill({ json: snapshot() }));
  await page.goto(`/canvas/${id}?workspace=${state.workspace_id}`);
  const open = page.getByRole("button", { name: "AI 分镜", exact: true });
  const dialog = page.getByRole("dialog", { name: "AI 分镜", exact: true });
  const title = dialog.getByRole("textbox", { name: "镜头 1", exact: true });
  await open.click();
  await expect(title).toHaveValue(shot.title);
  await title.fill("用户编辑的湖光镜头");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  const response = page.waitForResponse(r => r.url().endsWith("/api/chats/storyboard-test"));
  await open.click();
  await (await response).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.mouse.move(10, 10);
  if (process.env.STORYBOARD_EVIDENCE) {
    await mkdir(process.env.STORYBOARD_EVIDENCE, { recursive: true });
    await page.screenshot({ path: `${process.env.STORYBOARD_EVIDENCE}/storyboard-${process.env.STORYBOARD_LABEL || "after"}.png` });
  }
  await expect(title).toHaveValue("用户编辑的湖光镜头");
  console.log("Storyboard reopening preserves edited proposal: passed");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  message = { ...message, id: 102, content: JSON.stringify([{ ...shot, title: "全新助手分镜" }]) };
  await open.click();
  await expect(title).toHaveValue("全新助手分镜");
  console.log("Storyboard new assistant message replaces proposal: passed");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await page.evaluate(({ key, shot }) => {
    localStorage.setItem(key + "-proposal", JSON.stringify({ message: 101, shots: [{ ...shot, title: "旧标签页的编辑" }] }));
    localStorage.setItem(key + "-message", "102");
  }, { key, shot });
  await open.click();
  await expect(title).toHaveValue("全新助手分镜");
  console.log("Storyboard stale draft message id allows latest reply: passed");
  await title.fill("");
  await dialog.getByRole("textbox", { name: "画面", exact: true }).fill("");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await open.click();
  await expect(title).toHaveValue("");
  await expect(dialog.getByRole("textbox", { name: "画面", exact: true })).toHaveValue("");
  await expect(dialog.getByRole("button", { name: "采用分镜，不生成视频", exact: true })).toBeDisabled();
  console.log("Storyboard reopening preserves blank draft fields: passed");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  // A stored pointer is untrusted, including one whose message number is
  // valid but whose claimed conversation does not match the authorized source.
  eventSnapshots = undefined;
  history = [];
  activeTurn = null;
  message = { id: 104, role: "assistant", state: "failed", content: "", error: "最新回合失败" };
  let otherBills = 0;
  await page.route("**/api/chat/messages/101/source", route => route.fulfill({
    json: {cid:"storyboard-test",message:101,content:JSON.stringify([shot])},
  }));
  await page.route("**/api/chats/other-chat/bills", route => {
    otherBills++;
    return route.fulfill({json:{bills:[{turn:"other-turn",message:101,state:"complete",kind:"fixed",held:"9",charged:"9"}]}});
  });
  await page.evaluate(({key,shot})=>{
    localStorage.setItem(key+"-proposal",JSON.stringify({message:101,shots:[{...shot,title:"保留编辑"}],source:{cid:"other-chat",message:101,turn:"other-turn"}}));
  },{key,shot});
  await open.click();
  await expect(dialog.getByRole("alert")).toHaveText("最新回合失败");
  await expect(title).toHaveValue("保留编辑");
  assert.equal(otherBills,0,"An unverified cached source must not request another chat's bills");
  await expect(dialog.getByText("实扣 9 积分")).toHaveCount(0);
  console.log("Storyboard invalid cached source preserves edits without loading unrelated bills: passed");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  message = { id: 101, role: "assistant", state: "complete", content: JSON.stringify([shot]) };
  await page.evaluate(({ key, shot }) => {
    localStorage.setItem(key + "-chat", "storyboard-test");
    localStorage.setItem(key + "-proposal", JSON.stringify([{ ...shot, title: "升级前已编辑" }]));
  }, { key, shot });
  await open.click();
  await expect(title).toHaveValue("升级前已编辑");
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key + "-proposal") || "null"), key)).toMatchObject({ message: 101, shots: [{ ...shot, title: "升级前已编辑" }] });
  console.log("Storyboard legacy draft upgrade preserves edits and adopts reply id: passed");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  message = { ...message, id: 102, content: JSON.stringify([{ ...shot, title: "升级后的新分镜" }]) };
  await open.click();
  await expect(title).toHaveValue("升级后的新分镜");
  console.log("Storyboard new reply after legacy upgrade replaces proposal: passed");
  const failures: unknown[] = [];
  for (const failed of [false, true]) {
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await page.evaluate(({ key, shot, failed }) => {
      localStorage.setItem(key + "-proposal", JSON.stringify([{ ...shot, title: "生成前的编辑" }]));
      if (failed) localStorage.removeItem(key + "-pending");
      else localStorage.setItem(key + "-pending", JSON.stringify({ cid: "storyboard-test", body: { uid: "pending-turn", expected_revision: 1, text: "重新拟定" } }));
    }, { key, shot, failed });
    history = [{ id: 101, role: "assistant", state: "complete", turn: "previous-turn", content: JSON.stringify([shot]) }, { id: 102, role: "user", state: "complete", content: "重新拟定" }];
    message = { ...message, id: 103, turn: "active-turn", state: failed ? "running" : "complete", content: failed ? "" : JSON.stringify([{ ...shot, title: "升级中完成的新分镜" }]) };
    activeTurn = failed ? "active-turn" : null;
    revision = failed ? 2 : 3;
    eventSnapshots = failed ? [snapshot(), { conversation: { ...snapshot().conversation, active_turn: null, revision: 3 }, messages: [...history, { ...message, state: "failed", error: "分镜生成失败，积分已退回" }] }] : undefined;
    await open.click();
    try {
      if (failed) {
        await expect(dialog.getByRole("alert")).toHaveText("分镜生成失败，积分已退回");
        await expect(title).toHaveValue("生成前的编辑");
        console.log("Storyboard active legacy generation failure shows error and preserves edits: passed");
      } else {
        await expect(title).toHaveValue("升级中完成的新分镜");
        console.log("Storyboard pending legacy generation applies completed reply: passed");
      }
    } catch (error) { console.error(error); failures.push(error); }
  }
  assert.equal(failures.length, 0, "Legacy in-flight generation regression failures");

} finally {
  await browser?.close();
  harness.kill("SIGTERM");
  await exited;
}
