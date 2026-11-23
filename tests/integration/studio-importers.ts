import { expect, type Page } from "@playwright/test";
import { request, settings, setTab } from "./studio-settings-browser.js";

export async function verifyImporters(page: Page, workspace: number) {
  await setTab(page, "plugins");
  await page
    .getByLabel("选择插件文件")
    .setInputFiles("plugins/example-importers/example-importers.fmplugin.json");
  await expect(page.getByText(/导入器 · 从图片链接导入/)).toBeVisible();
  await page.getByRole("button", { name: "确认导入", exact: true }).click();
  const toggle = page.getByRole("switch", { name: "外部素材与分镜导入开关" });
  const enabled = await request(
    page,
    "/api/admin/plugins/example-importers/state",
    "POST",
    () => toggle.click(),
  );
  expect(enabled.ok()).toBe(true);
  await page.getByRole("button", { name: "关闭插件设置" }).click();
  await verifyImportPaths(page, workspace);
}
export async function verifyImportPaths(page: Page, workspace: number) {
  await page.locator('nav [data-nav="library"]').click();
  await page.getByRole("button", { name: "导入素材" }).click();
  const asset = page.getByRole("dialog", { name: "导入素材" });
  await asset
    .getByLabel("图片地址")
    .fill("https://unapproved.example/cover.png");
  await asset.getByRole("button", { name: "导入", exact: true }).click();
  await expect(asset.getByRole("alert")).toBeVisible();
  await asset.getByRole("button", { name: "取消" }).click();
  await page.locator('nav [data-nav="canvas"]').click();
  await page.getByRole("button", { name: "导入画布" }).click();
  const project = page.getByRole("dialog", { name: "导入画布" });
  await project
    .getByLabel("分镜清单或 JSON 地址")
    .fill(JSON.stringify({ title: "导入的分镜", shots: ["日出", "远航"] }));
  const created = await request(
    page,
    "/api/plugins/example-importers/importers/story",
    "POST",
    () => project.getByRole("button", { name: "导入", exact: true }).click(),
  );
  expect(created.ok()).toBe(true);
  await expect(page).toHaveURL(
    new RegExp("/canvas/[a-f0-9]{32}\\?workspace=" + workspace),
  );
  const projectId = new URL(page.url()).pathname.split("/").pop();
  await page.reload();
  const saved = await page.request.get("/api/canvases/" + projectId, {
    headers: { "X-Workspace-Id": String(workspace) },
  });
  expect((await saved.json()).document.shots).toEqual(["shot-0", "shot-1"]);
  await page.goto("/studio?workspace=" + workspace);
  await settings(page);
}
