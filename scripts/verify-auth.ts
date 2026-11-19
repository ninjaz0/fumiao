import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, expect, request, type Page } from "@playwright/test";
import sharp from "sharp";
import { tree } from "./verify-homepage.js";
type Credentials = { name: string; password: string };

export async function verifyAuth(
  original: string,
  migrated: string,
  originalCredentials: Credentials,
  credentials: Credentials,
) {
  const out = resolve(".runtime-advanced/auth-parity");
  await mkdir(out, { recursive: true });
  const browser = await chromium.launch();
  const report: { name: string; differentPixels: number }[] = [];
  let passed = false;
  const compare = async (pages: Page[], name: string) => {
    await Promise.all(
      pages.map(async (p) => {
        await p.mouse.move(0, 0);
        await p.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all(
            document
              .getAnimations()
              .map((animation) => animation.finished.catch(() => {})),
          );
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          // Chromium can retain a temporary opacity compositing layer after
          // transitionend. Capture both pages after the same settling period.
          await new Promise((resolve) => setTimeout(resolve, 500));
        });
      }),
    );
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
        sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
      ),
    );
    assert.deepEqual(raw[1].info, raw[0].info, name + " dimensions");
    let differentPixels = 0;
    for (let i = 0; i < raw[0].data.length; i += 4)
      if (
        !raw[0].data.subarray(i, i + 4).equals(raw[1].data.subarray(i, i + 4))
      )
        differentPixels++;
    report.push({ name, differentPixels });
    assert.equal(differentPixels, 0, name + " pixel difference");
    console.log("PASS " + name + ": identical DOM and pixels");
  };
  try {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ])
      for (const dark of [false, true])
        for (const mode of ["login", "register", "invite=retired"]) {
          const name = `${viewport.width}-${dark ? "dark" : "light"}-${mode.split("=")[0]}`;
          const context = await browser.newContext({
            viewport,
            deviceScaleFactor: 1,
            colorScheme: "light",
            reducedMotion: "reduce",
          });
          await context.route("**/*", (route) =>
            [original, migrated].includes(new URL(route.request().url()).origin)
              ? route.continue()
              : route.abort(),
          );
          await context.addInitScript(
            (theme) => {
              localStorage.setItem("fumiao-appearance", theme);
              sessionStorage.setItem("fm-invite", "old");
            },
            dark ? "dark" : "light",
          );
          const pages = [await context.newPage(), await context.newPage()];
          const errors: string[] = [];
          pages.forEach((p) =>
            p.on("pageerror", (e) => errors.push(e.message)),
          );
          try {
            await Promise.all(
              pages.map((p, i) =>
                p.goto(
                  (i ? migrated : original) + "/studio?workspace=777#" + mode,
                ),
              ),
            );
            for (const page of pages) {
              await expect(page.locator(".auth-form")).toBeVisible();
              await expect(page.locator('[data-act="theme"]')).toHaveAttribute(
                "aria-pressed",
                String(dark),
              );
              assert.equal(
                await page.evaluate(() => sessionStorage.getItem("fm-invite")),
                null,
              );
              if (mode.startsWith("invite")) {
                assert.equal(new URL(page.url()).hash, "");
                await expect(page.locator(".authnote")).toHaveText(
                  "邀请链接已停用，请向管理员获取邀请码后注册。",
                );
              }
            }
            await compare(pages, name);
            for (const page of pages) {
              await page.locator('[data-act="theme"]').click();
              await expect(page.locator("html")).toHaveAttribute(
                "data-theme",
                dark ? "light" : "dark",
              );
              await expect(page.locator('[data-act="theme"]')).toHaveAttribute(
                "title",
                dark ? "切换到深色" : "切换到浅色",
              );
              await page.locator('[name="user"]').fill("discard");
              await page.locator("#auth-switch").click();
              await expect(page.locator('[name="user"]')).toBeFocused();
              await expect(page.locator('[name="user"]')).toHaveValue("");
              await expect(page.locator(".authnote")).toHaveText("");
              // Switching back resets fields and labels just like rebuilding the old form.
              await page.locator("#auth-switch").click();
              await expect(page.locator('[name="user"]')).toBeFocused();
            }
            assert.deepEqual(
              await tree(pages[1]),
              await tree(pages[0]),
              name + " switched form DOM",
            );
            if (!mode.startsWith("invite")) {
              const calls: { body: unknown; workspace?: string }[][] = [[], []];
              for (const [i, page] of pages.entries()) {
                page.on("request", (req) => {
                  if (
                    req.method() === "POST" &&
                    /\/api\/(login|register)$/.test(req.url())
                  )
                    calls[i].push({
                      body: req.postDataJSON(),
                      workspace: req.headers()["x-workspace-id"],
                    });
                });
                await page.locator('[name="user"]').fill(" unknown-user ");
                await page.locator('[name="pw"]').fill("invalid-password");
                if (mode === "register") {
                  await page.locator('[name="nickname"]').fill(" 测试昵称 ");
                  await page.locator('[name="code"]').fill(" invalid-code ");
                }
                await page.locator('.auth-form [type="submit"]').click();
                await expect(page.locator(".authnote")).toHaveText(
                  mode === "register"
                    ? "邀请码无效、已过期或已停用，请向管理员获取有效邀请码"
                    : "用户名或密码有误",
                );
                await expect(
                  page.locator('.auth-form [type="submit"]'),
                ).toBeEnabled();
              }
              assert.deepEqual(calls[1], calls[0]);
              assert.equal(calls[0].length, 1);
              await compare(pages, name + "-error");
            }
            assert.deepEqual(errors, []);
          } finally {
            await context.close();
          }
        }
    // Each server has isolated credentials and invitation state. Exercise real writes.
    for (const [origin, login] of [
      [original, originalCredentials],
      [migrated, credentials],
    ] as const) {
      const setup = await request.newContext({ baseURL: origin });
      const context = await browser.newContext();
      try {
        assert.equal(
          (await setup.post("/api/login", { data: login })).status(),
          200,
        );
        const invitation = await setup.post("/api/invite-codes", {
          data: {
            name: "Auth parity",
            grant_credits: true,
            initial_credits: 37,
          },
        });
        assert.equal(invitation.status(), 200);
        const code = (await invitation.json()).code;
        const page = await context.newPage();
        await page.goto(origin + "/studio#register");
        await page.locator('[name="user"]').fill("parity-member");
        await page.locator('[name="nickname"]').fill("一致性成员");
        await page.locator('[name="pw"]').fill("parity-password-123");
        await page.locator('[name="code"]').fill(code.toLowerCase());
        const registration = page.waitForResponse(
          (r) =>
            r.url().endsWith("/api/register") &&
            r.request().method() === "POST",
        );
        await page.locator('.auth-form [type="submit"]').click();
        assert.equal((await registration).status(), 200);
        await expect(page.locator(".shell")).toBeVisible();
        assert.equal(new URL(page.url()).hash, "");
        assert.equal(new URL(page.url()).search, "");
        const state = await (
          await context.request.get(origin + "/api/state")
        ).json();
        assert.equal(state.me.nickname, "一致性成员");
        assert.equal(typeof state.me.id, "number");
        assert.equal(state.credits.balance, 37);
        const before = await setup.get("/api/invite-codes");
        assert.equal(
          (await before.json()).items.find(
            (i: { code: string }) => i.code === code,
          ).uses,
          1,
        );
        await page.locator('[data-menu="account"]').click();
        await page.locator('[data-act="logout"]').click();
        await expect(page.locator(".auth-form")).toBeVisible();
        await page.locator('[name="user"]').fill(" parity-member ");
        await page.locator('[name="pw"]').fill("parity-password-123");
        await page.locator('.auth-form [type="submit"]').click();
        await expect(page.locator(".shell")).toBeVisible();
        await page.locator('[data-menu="account"]').click();
        await page.locator('[data-act="logout"]').click();
        await expect(page.locator(".auth-form")).toBeVisible();
        // Registration's browser validation must not send incomplete requests.
        await page.locator("#auth-switch").click();
        let submissions = 0;
        page.on("request", (r) => {
          if (r.url().endsWith("/api/register") && r.method() === "POST")
            submissions++;
        });
        await page.locator('.auth-form [type="submit"]').click();
        assert.equal(submissions, 0);
      } finally {
        await setup.dispose();
        await context.close();
      }
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
    "PASS auth parity: theme, mode/reset/focus, retired links, request bodies, errors, real registration/login/logout",
  );
}
