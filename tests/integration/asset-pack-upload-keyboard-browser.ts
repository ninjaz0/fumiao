import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { chromium, expect, type FileChooser } from "@playwright/test";
import sharp from "sharp";
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
  const evidence = process.env.PACK_UPLOAD_EVIDENCE;
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width: 1440, height: 1000 },
    ...(evidence && { recordVideo: { dir: evidence, size: { width: 1440, height: 1000 } } }),
  });
  const signedIn = await context.request.post("/api/login", { data: { name: user, password } });
  assert.equal(signedIn.status(), 200);
  const { workspace_id: workspace } = await (await context.request.get("/api/state")).json();
  const headers = { Origin: origin, "X-Workspace-Id": String(workspace) };
  const image = await sharp({ create: { width: 240, height: 160, channels: 3, background: "#537ec5" } }).png().toBuffer();
  const uploaded = await context.request.post("/api/assets", { headers: { ...headers, "Content-Type": "image/png" }, data: image });
  assert.equal(uploaded.status(), 200, await uploaded.text());
  const created = await context.request.post("/api/canvases", { headers, data: { title: "素材包键盘上传验证" } });
  assert.equal(created.status(), 200, await created.text());
  const { id } = await created.json();
  const path = `/api/canvases/${id}`;
  const project = await (await context.request.get(path, { headers })).json();
  const node = { ...newNode("image", 40, 80, 1), title: "素材包节点" };
  const seeded = await context.request.put(`${path}/document`, {
    headers, data: { title: project.title, expected_revision: project.revision, document: { ...project.document, nodes: [node] } },
  });
  assert.equal(seeded.status(), 200, await seeded.text());

  const page = await context.newPage();
  // Listen before the page loads so Playwright has enabled chooser interception by the keypress.
  const choosers: FileChooser[] = [];
  page.on("filechooser", (chooser) => choosers.push(chooser));
  await page.goto(`/canvas/${id}?workspace=${workspace}`);
  await page.locator(".react-flow__node").filter({ has: page.getByLabel("节点名称 素材包节点") }).click({ position: { x: 160, y: 140 } });
  await page.locator(".canvas-pack-entry").getByRole("button", { name: /^素材包/ }).click();
  const packs = page.locator(".fm-packs");
  await packs.getByRole("button", { name: "新建素材包" }).click();
  await expect(packs.getByRole("button", { name: /^选择参考图/ }).first()).toBeVisible();
  await packs.getByLabel("说明").focus();
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => {
    const el = document.activeElement;
    return { tag: el?.tagName, text: el?.textContent?.trim(), label: el?.getAttribute("aria-label") };
  });
  await page.mouse.move(5, 5);
  if (evidence) {
    await mkdir(evidence, { recursive: true });
    await page.getByRole("dialog", { name: "素材包" }).screenshot({ path: `${evidence}/pack-upload-${process.env.PACK_UPLOAD_LABEL || "after"}.png` });
  }
  assert.deepEqual(focused, { tag: "BUTTON", text: "上传图片", label: null }, `Tab from 说明 focused ${JSON.stringify(focused)}`);
  console.log("Tab from 说明 reaches 上传图片: passed");

  const upload = packs.getByRole("button", { name: "上传图片" });
  await expect(upload).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => choosers.length).toBe(1);
  await choosers[0].setFiles({ name: "keyboard.png", mimeType: "image/png", buffer: image });
  await expect(packs.getByText("参考图片 · 1/9")).toBeVisible();
  console.log("Enter on 上传图片 opens the chooser and uploads into the draft: passed");
} finally {
  await browser?.close();
  harness.kill("SIGTERM");
  await exited;
}
