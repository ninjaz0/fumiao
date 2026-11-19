import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  expect,
  type Browser,
  type BrowserContext,
  type Page,
  type Request,
} from "@playwright/test";
import sharp from "sharp";
import type { Backend } from "./studio-settings-fixture.js";
import { surfaceTree, tree } from "./verify-homepage.js";

export function tab(page: Page, name: string) {
  return page.locator(`.settings-navigation [data-value="${name}"]`);
}
export async function setTab(page: Page, name: string) {
  const toggle = page.locator(".ledger-navigation-toggle");
  if (
    (await toggle.isVisible()) &&
    (await toggle.getAttribute("aria-expanded")) === "false"
  )
    await toggle.click();
  return tab(page, name).click();
}
export function action(page: Page, name: string) {
  return page.locator(`[data-act="${name}"]`);
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
  explicitMode: "legacy" | "react" | null = null,
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
export function requestContract(request: Request) {
  const url = new URL(request.url());
  return {
    path: url.pathname + url.search,
    method: request.method(),
    origin: request.headers().origin,
    workspace: request.headers()["x-workspace-id"],
    body: request.headers()["content-type"]?.startsWith("application/json")
      ? request.postDataJSON()
      : undefined,
  };
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
export type Comparison = Awaited<ReturnType<typeof compare>>;
export async function compare(
  out: string,
  name: string,
  pages: Page[],
  heading?: string,
) {
  await Promise.all(
    pages.map(async (page) => {
      if (heading) {
        const title = page
          .locator("#modal[open] h2, #view h2")
          .getByText(heading, { exact: true })
          .last();
        await expect(title).toBeVisible();
      }
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(
          Array.from(document.images)
            .filter((image) => image.getClientRects().length)
            .map((image) => image.decode().catch(() => {})),
        );
        await new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        );
      });
    }),
  );
  const [original, react] = pages;
  const redesigned =
    (await original.locator(".settings-page:not(.ledger-settings)").count()) >
      0 && (await react.locator(".ledger-settings").count()) > 0;
  if (redesigned) {
    const navigation = (page: Page) =>
      page
        .locator(".settings-navigation [data-value]")
        .evaluateAll((buttons) =>
          buttons
            .map((button) => [
              button.getAttribute("data-value"),
              button.getAttribute("aria-current"),
            ])
            .sort(([a], [b]) => a!.localeCompare(b!)),
        );
    assert.deepEqual(
      await navigation(react),
      await navigation(original),
      name + " settings navigation",
    );
  }
  // The settings shell and invite UI have an approved visual redesign. Keep
  // comparing the original markup for existing panes and unrelated dialogs.
  async function settingsTree(page: Page, selector: string) {
    return (await page.locator(selector).count())
      ? surfaceTree(page, selector)
      : null;
  }
  const [reference, candidate] = await Promise.all(
    pages.map((page) =>
      redesigned
        ? settingsTree(page, ".settings-content > :not(.invite-management)")
        : tree(page),
    ),
  );
  if (JSON.stringify(reference) !== JSON.stringify(candidate)) {
    await writeFile(
      join(out, name + "-original.json"),
      JSON.stringify(reference, null, 2),
    );
    await writeFile(
      join(out, name + "-react.json"),
      JSON.stringify(candidate, null, 2),
    );
  }
  assert.deepEqual(candidate, reference, name + " UI DOM");
  if (redesigned) {
    const inviteSheet = await react
      .locator(".ledger-invite-sheet[open]")
      .count();
    if (!inviteSheet) {
      assert.deepEqual(
        await settingsTree(react, "#modal[open]"),
        await settingsTree(original, "#modal[open]"),
        name + " dialog UI DOM",
      );
    }
  }
  const screenshots = await Promise.all(
    pages.map((page) => page.screenshot({ animations: "disabled" })),
  );
  const [a, b] = await Promise.all(
    screenshots.map((image) => sharp(image).ensureAlpha().raw().toBuffer()),
  );
  assert.equal(a.length, b.length);
  let differences = 0;
  for (let i = 0; i < a.length; i += 4)
    if (a.readUInt32LE(i) !== b.readUInt32LE(i)) differences++;
  if (differences)
    await Promise.all(
      screenshots.map((image, i) =>
        writeFile(
          join(out, name + (i ? "-react.png" : "-original.png")),
          image,
        ),
      ),
    );
  if (!redesigned) assert.equal(differences, 0, name + " differing pixels");
  return { name, differentPixels: differences, redesigned };
}
export async function pair(
  browser: Browser,
  errors: string[],
  backend: Backend,
  role: "member" | "admin",
  width: number,
  theme: string,
) {
  return Promise.all(
    [false, true].map(async (react) => {
      const context = await browser.newContext({
        baseURL: backend.web,
        viewport: { width, height: width === 390 ? 844 : 900 },
        deviceScaleFactor: 1,
        locale: "zh-CN",
        timezoneId: "Asia/Tokyo",
        colorScheme: "light",
        reducedMotion: "reduce",
      });
      await context.route("**/*", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== backend.web) return route.abort();
        if (
          !react &&
          request.isNavigationRequest() &&
          url.pathname === "/studio"
        ) {
          // Serve the pinned document on the reference side at the same URL.
          url.searchParams.set("studio_ui", "legacy");
          return route.fulfill({
            response: await route.fetch({ url: url.href }),
          });
        }
        return route.continue();
      });
      await context.addCookies([
        {
          name: "fm_session",
          value: backend[role].split("=")[1],
          url: backend.web,
          httpOnly: true,
          sameSite: "Strict",
        },
      ]);
      await context.addInitScript((theme) => {
        if (!localStorage.getItem("fumiao-appearance"))
          localStorage.setItem("fumiao-appearance", theme);
      }, theme);
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      return { page, context, react };
    }),
  );
}
export function all<T>(
  pairs: { page: Page; context: BrowserContext; react: boolean }[],
  run: (page: Page, react: boolean) => Promise<T>,
) {
  return Promise.all(pairs.map(({ page, react }) => run(page, react)));
}
