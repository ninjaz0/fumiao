import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import sharp from "sharp";

const harness = spawn(process.execPath, ["--import", "tsx", "tests/integration/smoke-studio-nest.ts", "--serve"], {
  env: process.env, stdio: ["ignore", "pipe", "pipe"],
});
const exited = once(harness, "exit");
let output = "";
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const evidence = process.env.ASSET_ACTION_EVIDENCE;
const before = process.env.ASSET_ACTION_BEFORE === "1";
try {
  const login = await new Promise<RegExpMatchArray>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Studio harness startup timed out: ${output}`)), 180_000);
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
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 900 },
    ...(evidence && !before ? { recordVideo: { dir: evidence, size: { width: 1280, height: 900 } } } : {}),
  });
  const page = await context.newPage();
  await page.goto("/studio");
  await page.locator('[name="user"]').fill(user);
  await page.locator('[name="pw"]').fill(password);
  await page.locator('.auth-form [type="submit"]').click();
  await expect(page.locator(".shell")).toBeVisible();
  const state = await (await context.request.get("/api/state")).json();
  const headers = { Origin: origin, "X-Workspace-Id": String(state.workspace_id) };
  const file = JSON.parse(await readFile("plugins/example-asset-tags/example-asset-tags.fmplugin.json", "utf8"));
  file.contributes.actions[0].title = "编辑素材备注";
  file.contributes.actions[0].fields = [{ name: "note", label: "备注", required: true }];
  file.contributes.actions[0].program = '({run(asset, values) {return {notice: "已保存：" + values.note}}})';
  const installed = await context.request.post("/api/admin/plugins/import", { headers, data: { file } });
  assert.equal(installed.status(), 201, await installed.text());
  const plugins = await (await context.request.get("/api/admin/plugins", { headers })).json();
  const plugin = plugins.find((p: { id: string }) => p.id === file.id);
  const enabled = await context.request.post(`/api/admin/plugins/${file.id}/state`, { headers, data: { revision: plugin.revision, action: "enable" } });
  assert.ok(enabled.ok(), await enabled.text());
  const uploaded = await context.request.post("/api/assets", { headers: { ...headers, "Content-Type": "image/png" },
    data: await sharp({ create: { width: 320, height: 240, channels: 3, background: "#c9d9ef" } }).png().toBuffer(),
  });
  assert.equal(uploaded.status(), 200, await uploaded.text());
  const asset = await uploaded.json();
  await page.reload();
  await page.locator('nav [data-nav="library"]').click();
  await page.getByRole("tab", { name: "图片", exact: true }).click();
  await page.locator(`button[data-key="${asset.id}"]`).first().click();
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await page.getByRole("button", { name: "编辑素材备注", exact: true }).click();
  const dialog = page.locator("#modal");
  const field = dialog.getByRole("textbox", { name: "备注" });
  const submit = dialog.getByRole("button", { name: "执行", exact: true });
  let calls = 0;
  let release: () => void = () => {};
  let fail = false;
  await page.route(`**/api/plugins/${file.id}/actions/classification`, async (route) => {
    calls++;
    assert.equal(route.request().postDataJSON().values.note, "提交的备注");
    await new Promise<void>((resolve) => { release = resolve; });
    await route.fulfill({ status: fail ? 500 : 200, json: fail ? { detail: "备注保存失败" } : { notice: "备注已保存" } });
  });
  await submit.click();
  assert.equal(calls, 0, "Required empty field must not submit");
  await field.fill("提交的备注");
  await submit.click();
  await expect.poll(() => calls).toBe(1);
  await expect(submit).toBeDisabled();
  if (before) {
    const disabled = await field.isDisabled();
    await field.fill("执行期间新写的备注（将丢失）");
    await page.mouse.move(10, 10);
    await field.blur();
    await page.screenshot({ path: `${evidence}/before.png` });
    release();
    await expect(dialog).not.toBeVisible();
    await page.screenshot({ path: `${evidence}/before-closed.png` });
    console.log("BEFORE: pending field edited; successful response closed dialog and discarded edit");
    assert.equal(disabled, true, "Pending asset action field must be disabled to prevent lost edits");
  }
  await expect(field).toBeDisabled();
  await field.fill("不能丢失的新备注", { timeout: 500 }).then(() => assert.fail("Pending field accepted an edit"), () => {});
  await expect(field).toHaveValue("提交的备注");
  await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "关闭对话框" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(dialog).toBeVisible();
  await dialog.locator("form").evaluate((form: HTMLFormElement) => { form.requestSubmit(); form.requestSubmit(); });
  assert.equal(calls, 1, "Other submit triggers must not duplicate pending request");
  await page.mouse.move(10, 10);
  if (evidence) await page.screenshot({ path: `${evidence}/after.png` });
  release();
  await expect(dialog).not.toBeVisible();
  console.log("Asset action pending fields, close controls and duplicate submits: passed");
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await page.getByRole("button", { name: "编辑素材备注", exact: true }).click();
  await expect(field).toBeEnabled();
  await field.fill("提交的备注");
  fail = true;
  await field.press("Enter");
  await expect.poll(() => calls).toBe(2);
  await expect(field).toBeDisabled();
  release();
  await expect(field).toBeEnabled();
  await expect(field).toHaveValue("提交的备注");
  await field.fill("失败后保留并修改的备注");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  console.log("Asset action Enter submit and error preserve editable draft: passed");
  await context.close();
} finally {
  await browser?.close();
  harness.kill("SIGTERM");
  await exited;
}
