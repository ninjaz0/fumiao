import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { chromium, expect, type Browser } from "@playwright/test";

const evidence = process.env.AUTH_EVIDENCE;
const repoRoot = resolve(process.cwd());
const submitted: Array<{ url: string; body: Record<string, unknown> }> = [];

let mockApi: Server;
let web: ChildProcess;
let browser: Browser | undefined;
let baseURL: string;

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function getFreePort(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((resolvePort) =>
    srv.listen(0, "127.0.0.1", resolvePort),
  );
  const { port } = srv.address() as AddressInfo;
  await new Promise<void>((resolveClose) => srv.close(() => resolveClose()));
  return port;
}

before(async () => {
  if (evidence) await mkdir(evidence, { recursive: true });
  mockApi = createServer(async (req, res) => {
    const url = req.url ?? "/";
    if (url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ service: "fumiao" }));
      return;
    }
    if (url === "/api/workspaces") {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ detail: "未登录" }));
      return;
    }
    if (
      (url === "/api/login" || url === "/api/register") &&
      req.method === "POST"
    ) {
      const raw = await readBody(req);
      submitted.push({
        url,
        body: JSON.parse(raw || "{}") as Record<string, unknown>,
      });
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ detail: "凭证校验未通过" }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ detail: "not found" }));
  });

  await new Promise<void>((resolveListen) =>
    mockApi.listen(0, "127.0.0.1", resolveListen),
  );
  const apiPort = (mockApi.address() as AddressInfo).port;
  const webPort = await getFreePort();
  baseURL = `http://127.0.0.1:${webPort}`;

  web = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "apps/web",
      "-p",
      String(webPort),
      "-H",
      "127.0.0.1",
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        API_INTERNAL_URL: `http://127.0.0.1:${apiPort}`,
        FUMIAO_REPOSITORY_ROOT: repoRoot,
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseURL}/health`);
      if (response.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  try {
    await browser?.close();
  } finally {
    if (web?.pid && web.exitCode === null && web.signalCode === null) {
      const closed = once(web, "exit");
      web.kill("SIGTERM");
      await closed;
    }
    if (mockApi?.listening) {
      await new Promise<void>((resolveClose) =>
        mockApi.close(() => resolveClose()),
      );
    }
  }
});

test("login and registration password fields support accessible show/hide toggle and reset on mode changes", async () => {
  const context = await browser!.newContext({
    baseURL,
    viewport: { width: 1280, height: 800 },
  });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/studio");
    await expect(
      page.getByRole("heading", { name: "登录工作台" }),
    ).toBeVisible();

    const pwInput = page.getByLabel("密码", { exact: true });
    const toggle = page.locator('[data-act="toggle-password"]');

    await expect(pwInput).toHaveAttribute("type", "password");
    await expect(pwInput).toHaveAttribute("name", "pw");
    await expect(toggle).toHaveAttribute("type", "button");
    await expect(toggle).toHaveAttribute("aria-label", "显示密码");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    const secret = "LongPasswordValue_1234567890!@#";
    await page.locator('[name="user"]').fill("alice");
    await pwInput.fill(secret);

    const inputPaddingRight = await pwInput.evaluate((el) =>
      Number.parseFloat(getComputedStyle(el).paddingRight),
    );
    const [inputBox, toggleBox] = await Promise.all([
      pwInput.boundingBox(),
      toggle.boundingBox(),
    ]);
    assert.ok(inputBox && toggleBox);
    assert.ok(
      inputPaddingRight >= inputBox.x + inputBox.width - toggleBox.x + 4,
      `Expected input right padding (${inputPaddingRight}px) to clear toggle button`,
    );

    if (evidence) {
      await page.screenshot({
        path: join(evidence, "desktop-login-masked-light.png"),
        animations: "disabled",
      });
    }

    const initialCount = submitted.length;
    await toggle.click();
    await expect(pwInput).toHaveAttribute("type", "text");
    await expect(pwInput).toHaveValue(secret);
    await expect(toggle).toHaveAttribute("aria-label", "隐藏密码");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    assert.equal(submitted.length, initialCount);

    if (evidence) {
      await page.screenshot({
        path: join(evidence, "desktop-login-revealed-light.png"),
        animations: "disabled",
      });
      await page.getByRole("button", { name: "切换外观" }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await page.screenshot({
        path: join(evidence, "desktop-login-revealed-dark.png"),
        animations: "disabled",
      });
      await page.getByRole("button", { name: "切换外观" }).click();
    }

    await pwInput.focus();
    await page.keyboard.press("Tab");
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveCSS("outline-style", "solid");
    await expect(toggle).toHaveCSS("outline-width", "2px");

    await page.keyboard.press("Enter");
    await expect(pwInput).toHaveAttribute("type", "password");
    await expect(pwInput).toHaveValue(secret);
    await expect(toggle).toHaveAttribute("aria-label", "显示密码");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    assert.equal(submitted.length, initialCount);

    await page.keyboard.press("Space");
    await expect(pwInput).toHaveAttribute("type", "text");
    await expect(toggle).toHaveAttribute("aria-label", "隐藏密码");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    assert.equal(submitted.length, initialCount);

    await page.locator("#auth-switch").click();
    await expect(page).toHaveURL(/#register$/);
    await expect(page.getByRole("heading", { name: "注册账户" })).toBeVisible();
    await expect(pwInput).toHaveAttribute("type", "password");
    await expect(toggle).toHaveAttribute("aria-label", "显示密码");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    await page.locator('[name="user"]').fill("newuser");
    await page.locator('[name="nickname"]').fill("新用户");
    await pwInput.fill("RegisterPass_10Chars!");
    await page.locator('[name="code"]').fill("INVITE-2026");
    await toggle.click();
    await expect(pwInput).toHaveAttribute("type", "text");

    await page.getByRole("button", { name: "注册并登录" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "凭证校验未通过" }),
    ).toHaveText("凭证校验未通过");
    assert.equal(submitted.at(-1)?.url, "/api/register");
    assert.equal(submitted.at(-1)?.body.password, "RegisterPass_10Chars!");
    await expect(pwInput).toHaveAttribute("type", "text");

    await page.evaluate(() => {
      window.location.hash = "#login";
    });
    await expect(
      page.getByRole("heading", { name: "登录工作台" }),
    ).toBeVisible();
    await expect(pwInput).toHaveAttribute("type", "password");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    await toggle.click();
    await expect(pwInput).toHaveAttribute("type", "text");
    await page.goBack();
    await expect(page.getByRole("heading", { name: "注册账户" })).toBeVisible();
    await expect(pwInput).toHaveAttribute("type", "password");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

const mobileViewports = [
  { width: 390, height: 844, requireSubmitInFirstScreen: true },
  { width: 375, height: 667, requireSubmitInFirstScreen: true },
  { width: 320, height: 568, requireSubmitInFirstScreen: false },
  { width: 667, height: 375, requireSubmitInFirstScreen: false },
] as const;

for (const vp of mobileViewports) {
  for (const theme of ["light", "dark"] as const) {
    test(`/studio#register fits mobile viewport ${vp.width}×${vp.height} (${theme}) without truncating inputs`, async () => {
      const context = await browser!.newContext({
        baseURL,
        viewport: { width: vp.width, height: vp.height },
      });
      try {
        const page = await context.newPage();
        await page.goto("/studio#register");
        await expect(
          page.getByRole("heading", { name: "注册账户" }),
        ).toBeVisible();
        if (theme === "dark") {
          await page.getByRole("button", { name: "切换外观" }).click();
          await expect(page.locator("html")).toHaveAttribute(
            "data-theme",
            "dark",
          );
        }

        const metrics = await page.evaluate((selectors) => {
          const boxes = Object.fromEntries(
            Object.entries(selectors).map(([key, sel]) => {
              const el = document.querySelector(sel);
              if (!el) throw new Error(`Missing ${sel}`);
              const r = el.getBoundingClientRect();
              return [
                key,
                {
                  top: Math.round(r.top * 10) / 10,
                  bottom: Math.round(r.bottom * 10) / 10,
                  left: Math.round(r.left * 10) / 10,
                  right: Math.round(r.right * 10) / 10,
                  width: Math.round(r.width * 10) / 10,
                  height: Math.round(r.height * 10) / 10,
                },
              ];
            }),
          );
          const homeEl = document.querySelector(".auth-home")!;
          const homeRect = homeEl.getBoundingClientRect();
          const homeHit = document.elementFromPoint(
            homeRect.left + homeRect.width / 2,
            homeRect.top + homeRect.height / 2,
          );
          const appEl = document.querySelector(".appearance")!;
          const appRect = appEl.getBoundingClientRect();
          const appHit = document.elementFromPoint(
            appRect.left + appRect.width / 2,
            appRect.top + appRect.height / 2,
          );
          return {
            scrollWidth: document.documentElement.scrollWidth,
            topBar: boxes.topBar,
            appearance: boxes.appearance,
            art: boxes.art,
            homeLink: boxes.homeLink,
            heading: boxes.heading,
            firstInput: boxes.firstInput,
            codeInput: boxes.codeInput,
            submitBtn: boxes.submitBtn,
            switchRow: boxes.switchRow,
            homeHitOk: Boolean(homeHit && homeEl.contains(homeHit)),
            appearanceHitOk: Boolean(appHit && appEl.contains(appHit)),
          };
        }, {
          topBar: ".auth-top",
          appearance: ".appearance",
          art: ".auth-art",
          homeLink: ".auth-home",
          heading: ".auth-form h1",
          firstInput: '[name="user"]',
          codeInput: '[name="code"]',
          submitBtn: '.auth-form [type="submit"]',
          switchRow: ".auth-switch",
        });

        console.log(
          `[${vp.width}x${vp.height} ${theme}] top=${metrics.topBar.bottom} art=${metrics.art.top}-${metrics.art.bottom} h1=${metrics.heading.top}-${metrics.heading.bottom} user=${metrics.firstInput.top}-${metrics.firstInput.bottom} submit=${metrics.submitBtn.top}-${metrics.submitBtn.bottom} scrollW=${metrics.scrollWidth}`,
        );

        assert.ok(
          metrics.scrollWidth <= vp.width,
          `Horizontal overflow at ${vp.width}x${vp.height}: scrollWidth=${metrics.scrollWidth}`,
        );
        assert.ok(metrics.homeHitOk, "Brand home link must be unobstructed");
        assert.ok(
          metrics.appearanceHitOk,
          "Appearance toggle button must be unobstructed",
        );
        assert.ok(
          metrics.homeLink.left >= 0 &&
            metrics.homeLink.right <= vp.width &&
            metrics.homeLink.top >= 0 &&
            metrics.homeLink.bottom <= vp.height,
        );
        assert.ok(
          metrics.appearance.left >= 0 &&
            metrics.appearance.right <= vp.width &&
            metrics.appearance.top >= 0 &&
            metrics.appearance.bottom <= vp.height,
        );
        assert.ok(
          metrics.heading.top >= 0 && metrics.heading.bottom <= vp.height,
          `Heading truncated at ${vp.width}x${vp.height}`,
        );
        assert.ok(
          metrics.firstInput.top >= 0 && metrics.firstInput.bottom <= vp.height,
          `First input truncated at ${vp.width}x${vp.height}`,
        );
        if (vp.requireSubmitInFirstScreen) {
          assert.ok(
            metrics.codeInput.bottom <= vp.height &&
              metrics.submitBtn.top >= 0 &&
              metrics.submitBtn.bottom <= vp.height,
            `Register form / submit button truncated at ${vp.width}x${vp.height}`,
          );
        }

        if (evidence) {
          await page.screenshot({
            path: join(evidence, `register-${vp.width}x${vp.height}-${theme}.png`),
            animations: "disabled",
          });
        }
      } finally {
        await context.close();
      }
    });
  }
}
