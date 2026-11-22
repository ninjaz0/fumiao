import assert from "node:assert/strict";
import { expect, type Page } from "@playwright/test";

export function tab(page: Page, name: string) {
  return page.locator(`.settings-navigation [data-value="${name}"]`);
}
export async function setTab(page: Page, name: string) {
  const drawerClose = page.getByRole("button", { name: "关闭插件设置" });
  if (await drawerClose.isVisible()) await drawerClose.click();
  const toggle = page.locator(".ledger-navigation-toggle");
  if (await toggle.isVisible() && await toggle.getAttribute("aria-expanded") === "false")
    await toggle.click();
  return tab(page, name).click();
}
export async function settings(page: Page) {
  await page.locator(".account").click();
  await page.locator('#popover [data-nav="settings"]').click();
  await expect(page.locator(".settings-title h1")).toHaveText("设置");
  await expect(page.locator("#popover")).toBeHidden();
}
export async function open(
  page: Page,
  path: string,
  react: boolean,
  workspace?: number,
) {
  const url = new URL(
    path,
    page.url().startsWith("http") ? page.url() : "http://local.invalid",
  );
  if (workspace) url.searchParams.set("workspace", String(workspace));
  const response = await page.goto(url.pathname + url.search);
  assert.equal(response?.status(), 200);
  const html = await response!.text();
  assert.equal(html.includes("/_next/static/"), react);
  assert.equal(/<script[^>]+src="\/static\/studio\.js/.test(html), !react);
  await expect(page.locator(".shell")).toBeVisible();
  await assertStudio(page, react);
}

export async function assertStudio(
  page: Page,
  react: boolean,
  explicitMode: "react" | null = null,
) {
  assert.equal(new URL(page.url()).searchParams.get("studio_ui"), explicitMode);
  const scripts = await page.evaluate(() =>
    [
      ...Array.from(document.scripts, ({ src }) => src).filter(Boolean),
      ...performance.getEntriesByType("resource").map(({ name }) => name),
    ].map((url) => new URL(url).pathname),
  );
  assert.equal(
    scripts.some((path) => path.startsWith("/_next/static/")),
    react,
  );
  assert.equal(scripts.includes("/static/studio.js"), !react);
  if (react)
    for (const script of ["flowpicker.js", "chat.js", "theme.js"])
      assert.ok(!scripts.includes("/static/" + script), script);
}
export async function request(
  page: Page,
  path: string,
  method: string,
  act: () => Promise<unknown>,
) {
  const response = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname + url.search === path &&
      response.request().method() === method
    );
  });
  await act();
  const result = await response;
  assert.equal(result.headers()["x-fumiao-web"], "next");
  return result;
}
