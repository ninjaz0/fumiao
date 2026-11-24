import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import { chromium, expect } from "@playwright/test";

test(
  "Studio validates registration usernames before submit without restricting login",
  { timeout: 190_000 },
  async () => {
    const harness = spawn(
      process.execPath,
      ["--import", "tsx", "tests/integration/smoke-studio-nest.ts", "--serve"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const exited = once(harness, "exit");
    let output = "";
    const ready = new Promise<string>((resolve) => {
      const collect = (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-16000);
        const origin = output.match(
          /Isolated Studio (http:\/\/[^\s]+)\/studio\r?\n/,
        )?.[1];
        if (origin) resolve(origin);
      };
      harness.stdout.on("data", collect);
      harness.stderr.on("data", collect);
    });
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
      const origin = await Promise.race([
        ready,
        exited.then(([code]) => {
          throw new Error(
            `Studio harness exited with ${code}: ${output.replace(/^Synthetic login .*$/gm, "Synthetic login [redacted]")}`,
          );
        }),
      ]);
      browser = await chromium.launch();
      const page = await browser.newPage({
        viewport: { width: 1280, height: 800 },
      });
      const registrations: string[] = [];
      page.on("request", (request) => {
        if (
          request.url() === `${origin}/api/register` &&
          request.method() === "POST"
        ) {
          registrations.push(request.postDataJSON().name);
        }
      });

      await page.goto(`${origin}/studio#register`);
      await expect(
        page.getByRole("heading", { name: "注册账户" }),
      ).toBeVisible();
      const username = page.getByLabel("用户名", { exact: true });
      const nickname = page.getByLabel("昵称", { exact: true });
      const feedback = page.getByText(
        "用户名仅支持 2–32 位中英文、数字或 _ . -，不能含空格",
        { exact: true },
      );
      const register = page.getByRole("button", { name: "注册并登录" });
      await username.fill("bad name!");
      await nickname.fill("测试用户");
      await page.getByLabel("密码", { exact: true }).fill("synthetic-password");
      await page
        .getByLabel("邀请码", { exact: true })
        .fill("BROWSER-INVALID-INVITE");
      await username.focus();
      await username.press("Tab");
      const screenshot = process.env.REGISTER_USERNAME_SCREENSHOT;
      if (screenshot) {
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: screenshot, animations: "disabled" });
      }
      assert.equal(
        await username.evaluate(
          (input: HTMLInputElement) => input.validity.valid,
        ),
        false,
        'registration username "bad name!" must be invalid on blur',
      );
      await expect(feedback).toBeVisible();
      await expect(username).toHaveAccessibleDescription(
        await feedback.innerText(),
      );
      await register.click();

      for (const invalid of ["a", "a😀"]) {
        await username.fill(invalid);
        await expect(username).toHaveValue(invalid);
        assert.equal(
          await username.evaluate(
            (input: HTMLInputElement) => input.validity.valid,
          ),
          false,
        );
      }

      await username.fill("𐐀".repeat(17));
      await expect(username).toHaveValue("𐐀".repeat(16));

      const valid = "汉É٩_.-" + "𐐀".repeat(12);
      await username.fill(` ${valid} `);
      await expect(username).toHaveValue(` ${valid} `);
      await expect(feedback).toBeHidden();
      assert.equal(
        await username.evaluate(
          (input: HTMLInputElement) => input.validity.valid,
        ),
        true,
      );
      const registered = page.waitForResponse(
        (response) =>
          response.url() === `${origin}/api/register` &&
          response.request().method() === "POST",
      );
      await register.click();
      assert.equal((await registered).status(), 403);
      assert.deepEqual(
        registrations,
        [valid],
        "only the corrected username should have reached registration",
      );

      await page.getByRole("link", { name: "登录", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "登录工作台" }),
      ).toBeVisible();
      await username.fill("bad name!");
      await page.getByLabel("密码", { exact: true }).fill("synthetic-password");
      assert.equal(
        await username.evaluate(
          (input: HTMLInputElement) => input.validity.valid,
        ),
        true,
      );
      await expect(feedback).toBeHidden();
      const login = page.waitForRequest(
        (request) =>
          request.url() === `${origin}/api/login` &&
          request.method() === "POST",
      );
      await page.getByRole("button", { name: "登录", exact: true }).click();
      assert.equal((await login).postDataJSON().name, "bad name!");
    } finally {
      try {
        await browser?.close();
      } finally {
        harness.kill("SIGTERM");
        await exited;
      }
    }
  },
);
