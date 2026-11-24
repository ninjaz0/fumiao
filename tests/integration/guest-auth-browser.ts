import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium, expect, type Browser, type Page } from "@playwright/test";

const evidence = process.env.GUEST_AUTH_EVIDENCE;
const viewport = { width: 1280, height: 800 };
const harness = spawn(
  process.execPath,
  ["--import", "tsx", "tests/integration/smoke-studio-nest.ts", "--serve"],
  { stdio: ["ignore", "pipe", "pipe"] },
);
const closed = once(harness, "close");
let browser: Browser | undefined;
let baseURL: string;

before(
  async () => {
    const signal = AbortSignal.timeout(180_000);
    let output = "";
    harness.stdout.on("data", (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-16000);
      const ready = output.match(
        /Isolated Studio (http:\/\/[^\s]+)\/studio\r?\n/,
      );
      if (ready) harness.emit("studio-ready", ready[1]);
    });
    harness.stderr.on("data", (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-16000);
    });
    [baseURL] = await Promise.race([
      once(harness, "studio-ready", { signal }),
      closed.then(([code]) => {
        throw new Error(
          `Studio harness exited (${code}): ${output.replace(/^Synthetic login .*$/gm, "Synthetic login [redacted]")}`,
        );
      }),
    ]);
    browser = await chromium.launch();
  },
  { timeout: 190_000 },
);

after(
  async () => {
    try {
      await browser?.close();
    } finally {
      if (
        harness.pid &&
        harness.exitCode === null &&
        harness.signalCode === null
      ) {
        harness.kill("SIGTERM");
      }
      await closed;
    }
  },
  { timeout: 40_000 },
);

async function screenshot(page: Page, name: string) {
  if (evidence)
    await page.screenshot({
      path: join(evidence, `${name}.png`),
      animations: "disabled",
    });
}

test("guest Studio offers help and a home link without JavaScript", async () => {
  const context = await browser!.newContext({
    baseURL,
    javaScriptEnabled: false,
    viewport,
  });
  try {
    assert.equal((await context.request.get("/api/workspaces")).status(), 401);
    const page = await context.newPage();
    const response = await page.goto("/studio");
    assert.equal(response?.status(), 200);
    const loading = page.getByRole("status", { name: "弗淼 AIGC 正在加载" });
    const login = page.getByRole("button", { name: "登录", exact: true });
    const help = page.getByText(/请启用 JavaScript/);
    console.log(
      `Guest/no JS: ${response.status()}, loading=${await loading.isVisible()}, login=${await login.isVisible()}, help=${await help.isVisible()}`,
    );
    await screenshot(page, "guest-no-js");
    await expect(help).toBeVisible();
    await expect(page.getByRole("link", { name: "返回首页" })).toHaveAttribute(
      "href",
      "/",
    );
    await expect(loading).toBeHidden();
    await expect(login).toBeHidden();
  } finally {
    await context.close();
  }
});

test("JavaScript guest login, registration history, and retired invites still work", async () => {
  const context = await browser!.newContext({ baseURL, viewport });
  try {
    const page = await context.newPage();
    const login = page.getByRole("heading", { name: "登录工作台" });
    const register = page.getByRole("heading", { name: "注册账户" });
    await page.goto("/studio");
    await expect(login).toBeVisible();
    await expect(
      page.getByRole("button", { name: "登录", exact: true }),
    ).toBeEnabled();
    await expect(page.getByText(/请启用 JavaScript/)).toBeHidden();
    await screenshot(page, "guest-login");
    await page.getByRole("link", { name: "注册", exact: true }).click();
    await expect(page).toHaveURL(/\/studio#register$/);
    await expect(register).toBeVisible();
    await page.goBack();
    await expect(login).toBeVisible();
    await page.goForward();
    await expect(register).toBeVisible();
    await page.reload();
    await expect(register).toBeVisible();
    await expect(page.getByLabel("邀请码")).toBeVisible();
    await screenshot(page, "guest-register");

    await page.goto("/studio?workspace=1#invite=retired");
    await expect(page).toHaveURL(/\/studio\?workspace=1$/);
    await expect(login).toBeVisible();
    await expect(
      page.getByRole("alert").filter({ hasText: "邀请链接已停用" }),
    ).toHaveText("邀请链接已停用，请向管理员获取邀请码后注册。");
  } finally {
    await context.close();
  }
});
