import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";
import { signPackage } from "@fumiao/plugin-sdk/package-signing.js";
import { request, setTab } from "./studio-settings-browser.js";

export async function verifyPublisherRotation(page: Page) {
  await setTab(page, "plugins");
  await page.getByLabel("选择插件文件").setInputFiles({
    name: "invalid.fmplugin.json",
    mimeType: "application/json",
    buffer: Buffer.from('{\n  "id": "broken",\n}'),
  });
  await expect(
    page.getByRole("alert").filter({
      hasText: /插件文件 JSON 格式错误（第 3 行第 1 列）/,
    }),
  ).toBeVisible();
  const example = JSON.parse(
    await readFile(
      "plugins/example-reading-time/example-reading-time.fmplugin.json",
      "utf8",
    ),
  );
  const base = { ...example, id: "example-publisher", label: "签名验收示例" };
  const choose = async (file: unknown) =>
    page
      .getByLabel("选择插件文件")
      .setInputFiles({
        name: "publisher.fmplugin.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(file)),
      });
  await choose(base);
  await expect(
    page.getByText("发布者签名 · 未签名", { exact: true }),
  ).toBeVisible();
  await request(page, "/api/admin/plugins/import", "POST", () =>
    page.getByRole("button", { name: "确认导入", exact: true }).click(),
  );
  const versions = page.locator("summary").filter({ hasText: "版本与更新" });
  await versions.click();
  await expect(
    page.getByText("发布者签名 · 未签名", { exact: true }),
  ).toBeVisible();
  const drawer = page.getByRole("dialog", { name: /签名验收示例/ });
  const updateUrlInput = drawer.getByLabel("更新地址");
  const updateTokenInput = drawer.getByLabel("只读令牌");
  await updateUrlInput.fill("https://updates.example.com/update.json");
  await updateTokenInput.fill("readonly-fixture-token");
  await request(
    page,
    "/api/admin/plugins/example-publisher/source",
    "POST",
    () => drawer.getByRole("button", { name: "保存更新设置" }).click(),
  );
  const clearTokenBtn = drawer.getByRole("button", { name: "清除已保存令牌" });
  await expect(clearTokenBtn).toBeVisible();
  await request(
    page,
    "/api/admin/plugins/example-publisher/source",
    "POST",
    () => drawer.getByRole("button", { name: "保存更新设置" }).click(),
  );
  await expect(clearTokenBtn).toBeVisible();
  await request(
    page,
    "/api/admin/plugins/example-publisher/source",
    "POST",
    () => clearTokenBtn.click(),
  );
  await expect(clearTokenBtn).toBeHidden();
  await expect(updateUrlInput).toHaveValue(
    "https://updates.example.com/update.json",
  );
  await updateUrlInput.fill("");
  await request(
    page,
    "/api/admin/plugins/example-publisher/source",
    "POST",
    () => drawer.getByRole("button", { name: "保存更新设置" }).click(),
  );
  await page.getByRole("button", { name: "关闭插件设置" }).click();
  const first = signPackage(
    { ...base, version: "1.1.0" },
    "作者甲",
    generateKeyPairSync("ed25519").privateKey,
  );
  await choose(first);
  await expect(
    page.getByText("发布者 · 作者甲", { exact: true }),
  ).toBeVisible();
  await request(page, "/api/admin/plugins/import", "POST", () =>
    page.getByRole("button", { name: "确认更新", exact: true }).click(),
  );
  await page.getByRole("button", { name: "关闭插件设置" }).click();
  const second = signPackage(
    { ...base, version: "1.2.0" },
    "作者乙",
    generateKeyPairSync("ed25519").privateKey,
  );
  await choose(second);
  const consent = page.getByRole("checkbox", { name: /我已核对新公钥指纹/ });
  await expect(consent).not.toBeChecked();
  await expect(
    page.getByText("原公钥指纹", { exact: false }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "确认更新", exact: true }).click();
  await expect(consent).toBeFocused();
  await consent.check();
  const applied = await request(page, "/api/admin/plugins/import", "POST", () =>
    page.getByRole("button", { name: "确认更新", exact: true }).click(),
  );
  expect(applied.ok()).toBe(true);
  await page.getByRole("button", { name: "关闭插件设置" }).click();
}
