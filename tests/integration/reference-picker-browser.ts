import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import sharp from "sharp";

const harness = spawn(process.execPath, ["--import", "tsx", "tests/integration/smoke-studio-nest.ts", "--serve"], {
  env: process.env, stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
const exited = once(harness, "exit");
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const evidence = process.env.REFERENCE_PICKER_EVIDENCE;
try {
  const login = await new Promise<RegExpMatchArray>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Studio harness startup timed out\n${output}`)), 180_000);
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/Isolated Studio (http:\/\/[^\s]+)\/studio\nSynthetic login ([^\s]+) \/ ([^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match); }
    };
    harness.stdout.on("data", collect);
    harness.stderr.on("data", collect);
    harness.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Studio harness exited: ${code}\n${output}`)); });
  });
  const [, origin, user, password] = login;
  if (evidence) await mkdir(evidence, { recursive: true });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL: origin, viewport: { width: 1440, height: 1000 },
    ...(evidence ? { recordVideo: { dir: evidence, size: { width: 1440, height: 1000 } } } : {}),
  });
  const page = await context.newPage();
  try {
    await page.goto("/studio");
    await page.locator('[name="user"]').fill(user);
    await page.locator('[name="pw"]').fill(password);
    await page.locator('.auth-form [type="submit"]').click();
    await expect(page.locator(".shell")).toBeVisible();
    const state = await (await context.request.get("/api/state")).json();
    const bytes = await sharp({ create: { width: 320, height: 240, channels: 3, background: "#79a8cc" } }).png().toBuffer();
    const upload = await context.request.post("/api/assets", {
      headers: { Origin: origin, "X-Workspace-Id": String(state.workspace_id), "Content-Type": "image/png" },
      data: bytes,
    });
    assert.equal(upload.status(), 200, await upload.text());
    const asset = await upload.json();
    await page.reload();
    await expect(page.getByRole("button", { name: "选择模型，当前MiniMax H3" })).toBeVisible();
    await page.getByRole("button", { name: "添加参考内容" }).click();
    await page.getByRole("button", { name: "从资产选择", exact: true }).click();
    const image = page.locator(`.asset-preview[data-key="${asset.id}"]`);
    await expect(image).toHaveAttribute("aria-pressed", "false");
    const count = page.locator(".reference-pick-toolbar [role=status]");
    await expect(count).toHaveText("已添加 0 张图片");
    await image.click();
    await expect(image).toHaveAttribute("aria-pressed", "true");
    await expect(count).toHaveText("已添加 1 张图片");
    await image.click();
    await page.mouse.move(10, 10);
    if (evidence) await page.screenshot({ path: `${evidence}/reference-picker-${process.env.REFERENCE_PICKER_LABEL || "after"}.png` });
    await expect(image).toHaveAttribute("aria-pressed", "false");
    await expect(count).toHaveText("已添加 0 张图片");
    console.log("Reference picker: second click deselects individual image and decrements count to 0: passed");
    await page.getByRole("button", { name: "完成选择", exact: true }).click();
    const pack = await context.request.post("/api/asset-packs", {
      headers: { Origin: origin, "X-Workspace-Id": String(state.workspace_id) },
      data: { name: "Picker regression pack", purpose: "subject", description: "", media: [asset.id] },
    });
    assert.equal(pack.status(), 200, await pack.text());
    await page.getByRole("button", { name: "添加参考内容" }).click();
    await page.getByRole("button", { name: "素材包", exact: true }).click();
    await page.getByRole("button", { name: "打开素材包 Picker regression pack" }).click();
    await page.getByRole("button", { name: "导入整个素材包", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.locator('.composer [data-act="reference"]').click();
    await page.getByRole("button", { name: "从资产选择", exact: true }).click();
    await expect(image).toHaveAttribute("aria-pressed", "true");
    await image.click();
    await image.click();
    await expect(image).toHaveAttribute("aria-pressed", "true");
    await expect(count).toHaveText("已添加 1 张图片");
    console.log("Reference picker: pack-provided image remains selected after repeated clicks: passed");
  } finally {
    await context.close();
  }
} finally {
  await browser?.close();
  harness.kill("SIGTERM");
  await exited;
}
