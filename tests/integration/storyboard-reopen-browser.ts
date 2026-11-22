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
  let message = { id: 101, role: "assistant", state: "complete", content: JSON.stringify([shot]) };
  const snapshot = () => ({ conversation: { id: "storyboard-test", active_turn: null }, messages: [message] });
  await page.route("**/api/chats/storyboard-test/events?*", route => route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify(snapshot())}\n\n` }));
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
  await title.fill("");
  await dialog.getByRole("textbox", { name: "画面", exact: true }).fill("");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await open.click();
  await expect(title).toHaveValue("");
  await expect(dialog.getByRole("textbox", { name: "画面", exact: true })).toHaveValue("");
  await expect(dialog.getByRole("button", { name: "采用分镜，不生成视频", exact: true })).toBeDisabled();
  console.log("Storyboard reopening preserves blank draft fields: passed");
} finally {
  await browser?.close();
  harness.kill("SIGTERM");
  await exited;
}
