import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { newNode } from "../../apps/web/canvas-editor/types.js";

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
  const created = await context.request.post("/api/canvases", { headers, data: { title: "成片轮询恢复验证" } });
  assert.equal(created.status(), 200);
  const { id } = await created.json();
  const path = `/api/canvases/${id}`;
  // Supply a ready video without running a paid generation or composition job.
  await page.route(`**${path}`, async (route) => {
    const response = await route.fetch();
    const project = await response.json();
    const node = { ...newNode("video", 0, 0, 1), media_id: "poll-test-video" };
    await route.fulfill({ json: { ...project, document: { ...project.document, nodes: [node], shots: [node.id] } } });
  });
  let polls = 0;
  await page.route(`**${path}/exports`, async (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({ status: 400, json: { detail: "启动成片失败" } });
    }
    polls++;
    if (polls === 1) return route.fulfill({ status: 500, json: { detail: "成片列表暂不可用" } });
    return route.fulfill({ json: { exports: [] } });
  });
  await page.goto(`/canvas/${id}?workspace=${state.workspace_id}`);
  await page.getByRole("button", { name: "镜头列表", exact: true }).click();
  const composition = page.getByRole("region", { name: "成片预览与导出" });
  await expect(composition.getByRole("alert")).toHaveText("成片列表暂不可用");
  const recovered = await page.waitForResponse((response) => response.url().endsWith("/exports") && response.ok());
  await recovered.finished();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  assert.ok(polls >= 2);
  await page.mouse.move(10, 10);
  if (process.env.COMPOSITION_EVIDENCE) {
    await mkdir(process.env.COMPOSITION_EVIDENCE, { recursive: true });
    await page.screenshot({ path: `${process.env.COMPOSITION_EVIDENCE}/composition-${process.env.COMPOSITION_LABEL || "recovered"}.png` });
  }
  await expect(composition.getByRole("alert")).toHaveCount(0);
  console.log("Composition poll error clears after successful empty poll: passed");
  await composition.getByRole("button", { name: "合成预览" }).click();
  await expect(composition.getByRole("alert")).toHaveText("启动成片失败");
  const next = await page.waitForResponse((response) => response.url().endsWith("/exports") && response.ok());
  await next.finished();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(composition.getByRole("alert")).toHaveText("启动成片失败");
  console.log("Composition successful poll preserves export action error: passed");
} finally {
  await browser?.close();
  harness.kill("SIGTERM");
  await exited;
}
