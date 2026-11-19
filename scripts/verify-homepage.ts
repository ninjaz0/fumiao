/** Differential browser tests against the pinned original; no production data or providers. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { chromium, expect, type Page } from "@playwright/test";
import sharp from "sharp";

export function tree(page: Page) {
  return surfaceTree(page);
}

export async function surfaceTree(page: Page, selector?: string) {
  return page.evaluate(`(() => {
    function visit(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.replace(/\\s+/g, " ").trim();
        return text || null;
      }
      if (!(node instanceof Element)) return null;
      if (node.tagName === "SCRIPT" || node.tagName === "NEXT-ROUTE-ANNOUNCER")
        return null;
      // React's empty streaming placeholder is not a UI element.
      if (
        node.tagName === "DIV" &&
        !node.id &&
        node.hasAttribute("hidden") &&
        !node.textContent &&
        node.children.length === 0
      )
        return null;
      return {
        tag: node.tagName,
        attrs: Object.fromEntries(
          [...node.attributes]
            .map((a) => [a.name, a.value])
            .sort(([a], [b]) => a.localeCompare(b)),
        ),
        children: [...node.childNodes].map(visit).filter((v) => v !== null),
      };
    }
    const selector = ${JSON.stringify(selector ?? null)};
    return visit(selector ? document.querySelector(selector) : document.body);
})()`);
}
async function settled(page: Page, dark: boolean) {
  await expect(page.locator("svg[data-scene] path")).toHaveCount(110);
  await expect(page.locator('[data-act="theme"]')).toHaveAttribute(
    "aria-pressed",
    String(dark),
  );
  await page.evaluate(() => document.fonts.ready);
}
export async function verifyHomepage(
  original: string,
  migrated: string,
  cookie: string,
) {
  const out = resolve(".runtime-advanced/home-parity");
  await mkdir(out, { recursive: true });
  const browser = await chromium.launch();
  const report: { name: string; differentPixels: number }[] = [];
  let passed = false;
  try {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      for (const dark of [false, true])
        for (const member of [false, true]) {
          const name = `${viewport.width}-${dark ? "dark" : "light"}-${member ? "member" : "guest"}`;
          const context = await browser.newContext({
            viewport,
            deviceScaleFactor: 1,
            colorScheme: "light",
            reducedMotion: "reduce",
          });
          await context.route("**/*", (route) => {
            const url = new URL(route.request().url());
            return [
              new URL(original).origin,
              new URL(migrated).origin,
            ].includes(url.origin)
              ? route.continue()
              : route.abort();
          });
          await context.addInitScript(
            (theme) => {
              if (localStorage.getItem("fumiao-appearance") === null)
                localStorage.setItem("fumiao-appearance", theme);
            },
            dark ? "dark" : "light",
          );
          if (member)
            await context.addCookies([
              {
                name: "fm_session",
                value: cookie.slice("fm_session=".length),
                domain: "127.0.0.1",
                path: "/",
                httpOnly: true,
                sameSite: "Strict",
              },
            ]);
          const pages = [await context.newPage(), await context.newPage()];
          const errors: string[] = [];
          for (const page of pages) {
            page.on("pageerror", (error) => errors.push(error.message));
            page.on("console", (message) => {
              if (message.type() === "error") errors.push(message.text());
            });
          }
          try {
            await Promise.all(
              pages.map((page, i) => page.goto(i ? migrated : original)),
            );
            await Promise.all(pages.map((page) => settled(page, dark)));
            for (const page of pages) {
              await expect(page.locator("html")).toHaveAttribute(
                "data-session",
                member ? "member" : "guest",
              );
              await expect(
                page.locator('meta[name="theme-color"]'),
              ).toHaveAttribute("content", dark ? "#171918" : "#f8f9fa");
            }
            const trees = await Promise.all(pages.map(tree));
            await writeFile(
              join(out, name + "-dom.json"),
              JSON.stringify(trees, null, 2),
            );
            assert.deepEqual(trees[1], trees[0], name + " DOM changed");
            const shots = await Promise.all(
              pages.map((page, i) =>
                page.screenshot({
                  path: join(out, name + (i ? "-react.png" : "-original.png")),
                  fullPage: true,
                  animations: "disabled",
                }),
              ),
            );
            const raw = await Promise.all(
              shots.map((png) =>
                sharp(png)
                  .ensureAlpha()
                  .raw()
                  .toBuffer({ resolveWithObject: true }),
              ),
            );
            assert.deepEqual(
              raw[0].info,
              raw[1].info,
              name + " screenshot dimensions",
            );
            let differentPixels = 0;
            for (let i = 0; i < raw[0].data.length; i += 4)
              if (
                !raw[0].data
                  .subarray(i, i + 4)
                  .equals(raw[1].data.subarray(i, i + 4))
              )
                differentPixels++;
            report.push({ name, differentPixels });
            assert.equal(differentPixels, 0, name + " pixels changed");
            // React hydration must retain working controls, not just an SSR screenshot.
            for (const page of pages) {
              await page.locator('[data-act="theme"]').click();
              await expect(page.locator("html")).toHaveAttribute(
                "data-theme",
                dark ? "light" : "dark",
              );
              await expect(page.locator('[data-act="theme"]')).toHaveAttribute(
                "aria-pressed",
                String(!dark),
              );
              await page.reload();
              await settled(page, !dark);
              await page.locator('[data-act="theme"]').focus();
              await page.keyboard.press("Enter");
              await expect(page.locator("html")).toHaveAttribute(
                "data-theme",
                dark ? "dark" : "light",
              );
              await page.evaluate(() => window.scrollTo(0, 200));
              await expect(page.locator("header.top")).toHaveClass(
                "top scrolled",
              );
            }
            assert.deepEqual(
              await tree(pages[1]),
              await tree(pages[0]),
              name + " interaction DOM",
            );
            assert.deepEqual(errors, [], name + " browser errors");
            console.log(
              `PASS ${name}: identical DOM and pixels; theme/keyboard/scroll`,
            );
          } finally {
            await context.close();
          }
        }
    }
    // Legacy fragment links must preserve their query and fragment on arrival.
    const context = await browser.newContext();
    try {
      for (const origin of [original, migrated]) {
        const page = await context.newPage();
        await page.route("**/studio*", (route) =>
          route.fulfill({
            contentType: "text/html",
            body: "<!doctype html><title>destination</title>",
          }),
        );
        for (const hash of ["#login", "#register", "#invite=sample%20code"]) {
          await page.goto(origin + "/?from=homepage" + hash);
          await expect(page).toHaveURL(origin + "/studio?from=homepage" + hash);
        }
        await page.goto(origin);
        await page.evaluate(() => {
          location.hash = "register";
        });
        await expect(page).toHaveURL(origin + "/studio#register");
        if (origin === migrated) {
          await page.goto(origin + "/?from=homepage");
          await page.evaluate(() => {
            const canonical = location.href;
            location.hash = "invite=sample%20code";
            // Reproduce the router restoring its URL before hashchange delivery.
            history.replaceState(history.state, "", canonical);
          });
          await expect(page).toHaveURL(
            origin + "/studio?from=homepage#invite=sample%20code",
          );
        }
        await page.close();
      }
      // Real cross-tab storage events, including clear, stay synchronized.
      const first = await context.newPage(),
        second = await context.newPage();
      await first.goto(migrated);
      await second.goto(migrated);
      await settled(first, false);
      await settled(second, false);
      await first.locator('[data-act="theme"]').click();
      await expect(second.locator('[data-act="theme"]')).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await first.evaluate(() => localStorage.clear());
      await expect(second.locator('[data-act="theme"]')).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      await first.close();
      await second.close();
      // Browsers denying localStorage must still allow appearance changes.
      const blocked = await context.newPage();
      await blocked.addInitScript(() => {
        Object.defineProperty(window, "localStorage", {
          get() {
            throw new DOMException("Blocked", "SecurityError");
          },
        });
      });
      await blocked.goto(migrated);
      await settled(blocked, false);
      await blocked.locator('[data-act="theme"]').click();
      await expect(blocked.locator("html")).toHaveAttribute(
        "data-theme",
        "dark",
      );
      await blocked.close();
    } finally {
      await context.close();
    }
    passed = true;
  } finally {
    await browser.close();
    await writeFile(
      join(out, "report.json"),
      JSON.stringify(
        { passed, report, capturedAt: new Date().toISOString() },
        null,
        2,
      ),
    );
  }
  console.log(
    "PASS homepage redirects, cross-tab appearance, blocked storage; reports: " +
      out,
  );
}
