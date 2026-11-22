import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { join } from "node:path";
import { chromium, expect, type Browser, type Page } from "@playwright/test";

// Run against smoke-studio-nest.ts --serve with its synthetic login.
const baseURL = process.env.STUDIO_URL;
const username = process.env.STUDIO_USER;
const password = process.env.STUDIO_PASSWORD;
assert.ok(
  baseURL && username && password,
  "Set STUDIO_URL, STUDIO_USER and STUDIO_PASSWORD",
);
let browser: Browser;
before(async () => {
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
});

async function authenticated(run: (page: Page) => Promise<void>) {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  try {
    const response = await context.request.post("/api/login", {
      data: { name: username, password },
    });
    assert.equal(response.status(), 200);
    await run(await context.newPage());
  } finally {
    await context.close();
  }
}

async function screenshot(page: Page, name: string) {
  if (process.env.STUDIO_EVIDENCE)
    await page.screenshot({
      path: join(process.env.STUDIO_EVIDENCE, name + ".png"),
      fullPage: true,
    });
}

for (const failure of ["503", "network"] as const) {
  for (const recovery of ["automatic", "explicit"] as const) {
    test(`bootstrap ${failure}: ${recovery} retry recovers Studio`, async () => {
      await authenticated(async (page) => {
        let requests = 0;
        await page.route("**/api/state", async (route) => {
          if (++requests > 1) return route.continue();
          if (failure === "network") return route.abort("failed");
          return route.fulfill({
            status: 503,
            json: { detail: "工作台暂不可用" },
          });
        });
        await page.goto("/studio");
        if (
          process.env.STUDIO_BEFORE &&
          failure === "503" &&
          recovery === "automatic"
        ) {
          await screenshot(page, "before-initial");
          await page.waitForTimeout(7100);
          await screenshot(page, "before-after-7s");
          console.log(
            `Before fix after 7s: state requests=${requests}, loading=${await page.locator(".loading-screen").isVisible()}`,
          );
        }
        const alert = page
          .getByRole("alert")
          .filter({ hasText: "工作台加载失败" });
        await expect(alert).toContainText("工作台加载失败");
        const retry = alert.getByRole("button", { name: "重试", exact: true });
        await expect(retry).toBeVisible();
        if (failure === "503" && recovery === "automatic")
          await screenshot(page, "after-error");
        if (recovery === "explicit") await retry.click();
        await expect(page.locator(".account")).toBeVisible({ timeout: 12000 });
        assert.ok(
          requests >= 2,
          `Expected retry, got ${requests} state requests`,
        );
        await expect(alert).toBeHidden();
        if (failure === "503" && recovery === "automatic")
          await screenshot(page, "after-recovered");
        console.log(
          `${failure} ${recovery}: visible Studio, state requests=${requests}`,
        );
      });
    });
  }
}

test("initial 401 keeps login behavior without bootstrap retry", async () => {
  await authenticated(async (page) => {
    let requests = 0;
    await page.route("**/api/state", (route) => {
      requests++;
      return route.fulfill({ status: 401, json: { detail: "请登录" } });
    });
    await page.goto("/studio");
    await expect(
      page.getByRole("heading", { name: "登录工作台" }),
    ).toBeVisible();
    await page.waitForTimeout(7100);
    assert.equal(requests, 1);
    await expect(
      page.getByRole("button", { name: "重试", exact: true }),
    ).toBeHidden();
  });
});

test("normal authenticated load is unchanged", async () => {
  await authenticated(async (page) => {
    await page.goto("/studio");
    await expect(page.locator(".account")).toBeVisible();
    await expect(
      page.getByRole("alert").filter({ hasText: "工作台加载失败" }),
    ).toBeHidden();
  });
});

test("anonymous Studio still shows login", async () => {
  const context = await browser.newContext({ baseURL });
  try {
    const page = await context.newPage();
    await page.goto("/studio");
    await expect(
      page.getByRole("heading", { name: "登录工作台" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "重试", exact: true }),
    ).toBeHidden();
  } finally {
    await context.close();
  }
});
