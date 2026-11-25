import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium, expect, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import sharp from "sharp";

const evidence = process.env.ASSET_PACK_DRAFT_EVIDENCE;
const viewport = { width: 1280, height: 800 };
const canvasTitle = "素材包草稿验证";
const teamName = "素材包隔离验证";
const savedName = "已保存素材包";
const draft = { name: "未保存的展台场景", description: "保留展台的灯光与布局" };
const harness = spawn(process.execPath, ["--import", "tsx", "tests/integration/smoke-studio-nest.ts", "--serve"], {
  stdio: ["ignore", "pipe", "pipe"],
});
const exited = once(harness, "exit");
let browser: Browser | undefined;
let context: BrowserContext | undefined;
let canvasId: string;
let assetId: string;

before(async () => {
  const [, origin, name, password] = await new Promise<RegExpMatchArray>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Studio harness startup timed out")), 180_000);
    let output = "";
    const collect = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-16_000);
      const login = output.match(/Isolated Studio (http:\/\/[^\s]+)\/studio\r?\nSynthetic login (\S+) \/ (\S+)\r?\n/);
      if (!login) return;
      clearTimeout(timer);
      resolve(login);
    };
    harness.stdout.on("data", collect);
    harness.stderr.on("data", collect);
    void exited.then(([code]) => {
      clearTimeout(timer);
      reject(new Error(`Studio harness exited: ${code}`));
    }, reject);
  });
  browser = await chromium.launch();
  context = await browser.newContext({
    baseURL: origin,
    viewport,
    ...(process.env.ASSET_PACK_DRAFT_VIDEO ? { recordVideo: { dir: process.env.ASSET_PACK_DRAFT_VIDEO, size: viewport } } : {}),
  });
  const signedIn = await context.request.post("/api/login", { data: { name, password } });
  assert.equal(signedIn.status(), 200);
  const { workspace_id: workspace } = await (await context.request.get("/api/state")).json();
  const headers = { Origin: origin, "X-Workspace-Id": String(workspace) };
  const image = await sharp({ create: { width: 240, height: 160, channels: 3, background: "#537ec5" } }).png().toBuffer();
  const asset = await context.request.post("/api/assets", { headers: { ...headers, "Content-Type": "image/png" }, data: image });
  assert.equal(asset.status(), 200, await asset.text());
  ({ id: assetId } = await asset.json());
  const pack = await context.request.post("/api/asset-packs", {
    headers,
    data: { name: savedName, purpose: "subject", description: "", media: [assetId] },
  });
  assert.equal(pack.status(), 200, await pack.text());
  const canvas = await context.request.post("/api/canvases", { headers, data: { title: canvasTitle } });
  assert.equal(canvas.status(), 200, await canvas.text());
  ({ id: canvasId } = await canvas.json());
  const team = await context.request.post("/api/workspaces", { headers, data: { name: teamName, members: [] } });
  assert.ok(team.ok(), await team.text());
});

after(async () => {
  try {
    await context?.close();
  } finally {
    try {
      await browser?.close();
    } finally {
      harness.kill("SIGTERM");
      await exited;
    }
  }
});

async function openStudioPacks(page: Page) {
  await page.getByRole("button", { name: "添加参考内容" }).click();
  await page.getByRole("button", { name: "素材包", exact: true }).click();
  return page.locator("#asset-packs-host .fm-packs");
}

async function enterNew(packs: Locator) {
  await packs.getByRole("button", { name: "新建素材包" }).click();
}

async function backToPacks(packs: Locator) {
  await packs.getByRole("button", { name: "返回素材包", exact: true }).click();
}

async function checkNewDraft(page: Page, packs: Locator, surface: string) {
  await enterNew(packs);
  const name = packs.getByLabel("名称");
  const description = packs.getByLabel("说明");
  const purpose = packs.getByRole("button", { name: "场景" });
  const image = packs.getByRole("button", { name: `选择参考图 ${assetId.slice(0, 6)}` });
  await name.fill(draft.name);
  await purpose.click();
  await description.fill(draft.description);
  await image.click();
  await backToPacks(packs);
  await enterNew(packs);
  await page.mouse.move(5, 5);
  if (evidence) {
    await name.blur();
    await page.screenshot({ path: join(evidence, `${surface}-${process.env.ASSET_PACK_DRAFT_LABEL || "after"}.png`) });
  }
  await expect(name).toHaveValue(draft.name);
  await expect(description).toHaveValue(draft.description);
  await expect(purpose).toHaveAttribute("aria-pressed", "true");
  await expect(image).toHaveAttribute("aria-pressed", "true");
}

test("canvas video node: return and reopen keeps the new pack draft until it is saved", async () => {
  assert.ok(context);
  const page = await context.newPage();
  try {
    await page.goto("/studio");
    await page.getByRole("button", { name: "画布", exact: true }).click();
    await page.getByRole("link", { name: `打开画布 ${canvasTitle}` }).click();
    await expect(page).toHaveURL(new RegExp(`/canvas/${canvasId}\\?`));
    await page.getByRole("button", { name: "添加视频", exact: true }).click();
    await page.locator(".canvas-pack-entry").getByRole("button", { name: "素材包" }).click();
    const packs = page.getByRole("dialog", { name: "素材包" }).locator(".fm-packs");
    await checkNewDraft(page, packs, "canvas");
    await packs.getByRole("button", { name: "保存素材包" }).click();
    await expect(packs.getByRole("button", { name: `打开素材包 ${draft.name}` })).toBeVisible();
    await enterNew(packs);
    await expect(packs.getByLabel("名称")).toHaveValue("");
    await expect(packs.getByText("参考图片 · 0/9")).toBeVisible();
  } finally {
    await page.close();
  }
});

test("Studio composer: return and reopen keeps the new pack draft", async () => {
  assert.ok(context);
  const page = await context.newPage();
  try {
    await page.goto("/studio");
    await checkNewDraft(page, await openStudioPacks(page), "studio");
  } finally {
    await page.close();
  }
});

test("Studio composer: discarding existing-pack edits requires confirmation and keeps the new draft", async () => {
  assert.ok(context);
  const page = await context.newPage();
  try {
    await page.goto("/studio");
    const packs = await openStudioPacks(page);
    const name = packs.getByLabel("名称");
    const edit = packs.getByRole("button", { name: `编辑 ${savedName}` });
    await enterNew(packs);
    await name.fill(draft.name);
    await backToPacks(packs);
    await edit.click();
    await expect(name).toHaveValue(savedName);
    await name.fill("未保存的编辑");
    await backToPacks(packs);
    const confirmation = packs.getByRole("group", { name: "未保存的素材包修改" });
    await expect(confirmation.getByRole("button", { name: "继续编辑" })).toBeFocused();
    await confirmation.getByRole("button", { name: "继续编辑" }).click();
    await expect(name).toHaveValue("未保存的编辑");
    await backToPacks(packs);
    await confirmation.getByRole("button", { name: "放弃修改" }).click();
    await enterNew(packs);
    await expect(name).toHaveValue(draft.name);
    await backToPacks(packs);
    await edit.click();
    await expect(name).toHaveValue(savedName);
  } finally {
    await page.close();
  }
});

test("Studio composer: switching workspaces does not leak a pack draft", async () => {
  assert.ok(context);
  const page = await context.newPage();
  try {
    await page.goto("/studio");
    const packs = await openStudioPacks(page);
    await enterNew(packs);
    await packs.getByLabel("名称").fill(draft.name);
    await backToPacks(packs);
    await page.keyboard.press("Escape");
    const switcher = page.getByRole("button", { name: /^切换工作区/ });
    await switcher.click();
    await page.getByRole("option", { name: new RegExp(teamName) }).click();
    await expect(switcher).toHaveAccessibleName(`切换工作区，当前${teamName}`);
    await enterNew(await openStudioPacks(page));
    await expect(packs.getByLabel("名称")).toHaveValue("");
  } finally {
    await page.close();
  }
});
