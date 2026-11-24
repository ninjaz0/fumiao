import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium, expect } from "@playwright/test";
import { newNode } from "../../apps/web/canvas-editor/types.js";

const harness = spawn(process.execPath, ["--import", "tsx", "tests/integration/smoke-studio-nest.ts", "--serve"], {
  stdio: ["ignore", "pipe", "pipe"],
});
const exited = once(harness, "exit");
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  const [, origin, user, password] = await new Promise<RegExpMatchArray>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Studio harness startup timed out")), 180_000);
    const read = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-16_000);
      const match = output.match(/Isolated Studio (http:\/\/[^\s]+)\/studio\nSynthetic login (\S+) \/ (\S+)\r?\n/);
      if (!match) return;
      clearTimeout(timer);
      harness.stdout.off("data", read);
      harness.stderr.off("data", read);
      resolve(match);
    };
    harness.stdout.on("data", read);
    harness.stderr.on("data", read);
    void exited.then(([code]) => {
      clearTimeout(timer);
      reject(new Error(`Studio harness exited: ${code}`));
    }, reject);
  });

  browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 } });
  const signedIn = await context.request.post("/api/login", { data: { name: user, password } });
  assert.equal(signedIn.status(), 200);
  const { workspace_id: workspace } = await (await context.request.get("/api/state")).json();
  const headers = { Origin: origin, "X-Workspace-Id": String(workspace) };
  const created = await context.request.post("/api/canvases", { headers, data: { title: "素材包取消上传验证" } });
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
  await page.goto(`/canvas/${id}?workspace=${workspace}`);
  await page.locator(".react-flow__node").filter({ has: page.getByLabel("节点名称 素材包节点") }).click({ position: { x: 160, y: 140 } });
  const openPacks = page.locator(".canvas-pack-entry").getByRole("button");
  await openPacks.click();
  const dialog = page.getByRole("dialog", { name: "素材包" });
  await dialog.getByRole("button", { name: "新建素材包" }).click();
  const draftName = dialog.getByRole("textbox", { name: "名称" });
  await draftName.fill("未保存的素材包");

  const chooserPromise = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: "上传图片" }).click();
  const chooser = await chooserPromise;
  await chooser.element().dispatchEvent("cancel", { bubbles: true, cancelable: false });
  await expect(dialog, "Cancelling the image chooser should leave 素材包 open").toBeVisible();
  await expect(draftName).toHaveValue("未保存的素材包");
  console.log("Cancelling the image chooser keeps 素材包 and its draft open: passed");

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await openPacks.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "关闭" }).click();
  await expect(dialog).toBeHidden();
  console.log("Escape and the close button still close 素材包: passed");
} finally {
  try {
    await browser?.close();
  } finally {
    harness.kill("SIGTERM");
    await exited;
  }
}
