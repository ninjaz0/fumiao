import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";
import { signPackage } from "@fumiao/plugin-sdk/package-signing.js";
import { request, setTab } from "./studio-settings-browser.js";

export async function verifyPublisherRotation(page: Page) {
  await setTab(page, "plugins");
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
