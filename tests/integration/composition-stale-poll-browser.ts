import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium, expect } from "@playwright/test";
import { newNode } from "../../apps/web/canvas-editor/types.js";

const harness = spawn(process.execPath, ["--import", "tsx", "tests/integration/smoke-studio-nest.ts", "--serve"], {
  env: process.env, stdio: ["ignore", "pipe", "pipe"],
});
const exited = once(harness, "exit");
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  const [, origin, user, password] = await new Promise<RegExpMatchArray>((resolve, reject) => {
    let output = "";
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
  browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto("/studio");
  await page.locator('[name="user"]').fill(user);
  await page.locator('[name="pw"]').fill(password);
  await page.locator('.auth-form [type="submit"]').click();
  await expect(page.locator(".shell")).toBeVisible();
  const { workspace_id: workspace } = await (await context.request.get("/api/state")).json();
  const created = await context.request.post("/api/canvases", {
    headers: { Origin: origin, "X-Workspace-Id": String(workspace) },
    data: { title: "成片轮询顺序验证" },
  });
  assert.equal(created.status(), 200);
  const { id } = await created.json();
  const path = `/api/canvases/${id}`;
  await page.route(`**${path}`, async (route) => {
    const project = await (await route.fetch()).json();
    const node = { ...newNode("video", 0, 0, 1), media_id: "poll-test-video" };
    await route.fulfill({ json: { ...project, document: { ...project.document, nodes: [node], shots: [node.id] } } });
  });
  const queuedExport = {
    id: "queued-export", state: "queued", result: null, error: "", revision: 1, created: 1795464000,
  };
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let polls = 0;
  let submitted = false;
  let releaseRefresh!: () => void;
  const refreshHeld = new Promise<void>((resolve) => { releaseRefresh = resolve; });
  let refreshPending = false;
  await page.route((url) => url.pathname === `${path}/exports`, async (route) => {
    if (route.request().method() === "POST") {
      submitted = true;
      return route.fulfill({ json: {} });
    }
    if (submitted) {
      if (!refreshPending) {
        refreshPending = true;
        await refreshHeld;
        return route.fulfill({ status: 503, json: { detail: "提交后列表暂不可用" } });
      }
      return route.fulfill({ json: { exports: [queuedExport] } });
    }
    const poll = ++polls;
    if (poll === 1) await held;
    await route.fulfill({ json: { exports: poll === 2 ? [queuedExport] : [] } });
  });

  await page.goto(`/canvas/${id}?workspace=${workspace}`);
  const firstPoll = page.waitForRequest((request) => request.url().endsWith(`${path}/exports?scope=canvas`) && request.method() === "GET");
  await page.getByRole("button", { name: "镜头列表", exact: true }).click();
  const composition = page.getByRole("region", { name: "全画布成片预览与导出" });
  const queuedStatus = composition.getByText("等待合成", { exact: true });
  const firstRequest = await firstPoll;
  await expect(queuedStatus).toBeVisible({ timeout: 10_000 });
  await expect(composition.getByRole("button", { name: "合成中…" })).toBeDisabled();

  const staleResponse = page.waitForResponse((response) => response.request() === firstRequest);
  release();
  await (await staleResponse).finished();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  if (process.env.COMPOSITION_STALE_POLL_SCREENSHOT) {
    await page.mouse.move(10, 10);
    await page.screenshot({ path: process.env.COMPOSITION_STALE_POLL_SCREENSHOT });
  }
  assert.ok(await queuedStatus.isVisible(), "Queued export disappeared after the older empty poll arrived");
  await expect(composition.getByRole("button", { name: "合成中…" })).toBeDisabled();
  console.log("Queued export stays visible and composition stays disabled after the older empty poll: passed");

  const submit = composition.getByRole("button", { name: "合成预览" });
  await expect(submit).toBeEnabled({ timeout: 10_000 });
  await submit.click();
  await expect.poll(() => refreshPending, { timeout: 5_000 }).toBe(true);
  await expect(queuedStatus).toBeVisible({ timeout: 10_000 });
  const failedRefresh = page.waitForResponse(
    (response) => response.url().endsWith(`${path}/exports?scope=canvas`) && response.status() === 503,
  );
  releaseRefresh();
  await (await failedRefresh).finished();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(composition.getByRole("alert")).toHaveCount(0);
  await expect(queuedStatus).toBeVisible();
  console.log("A stale post-submit refresh error does not replace the newer export status: passed");
} finally {
  await browser?.close();
  harness.kill("SIGTERM");
  await exited;
}
