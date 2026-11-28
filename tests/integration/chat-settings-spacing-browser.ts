import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { chromium, expect, type Browser } from "@playwright/test";
import { open, settings } from "./studio-settings-browser.js";

test(
  "chat settings space and align provider cards without hiding feedback",
  { timeout: 240_000 },
  async () => {
    const harness = spawn(
      process.execPath,
      ["--import", "tsx", "tests/integration/smoke-studio-nest.ts", "--serve"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const exited = new Promise((resolve) => harness.once("close", resolve));
    let browser: Browser | undefined;
    try {
      const [, baseURL, name, password] = await new Promise<RegExpMatchArray>(
        (resolve, reject) => {
          let output = "";
          const timer = setTimeout(
            () => finish(new Error("Studio harness startup timed out")),
            180_000,
          );
          function finish(error?: Error, ready?: RegExpMatchArray) {
            clearTimeout(timer);
            harness.stdout.off("data", collect);
            harness.stderr.off("data", collect);
            harness.off("close", closed);
            harness.off("error", finish);
            if (error) reject(error);
            else resolve(ready!);
          }
          function closed(code: number | null) {
            finish(
              new Error(
                `Studio harness exited (${code}): ${output.replace(/^Synthetic login .*$/gm, "Synthetic login [redacted]")}`,
              ),
            );
          }
          function collect(chunk: Buffer) {
            output = (output + chunk.toString()).slice(-16000);
            const ready = output.match(
              /Isolated Studio (http:\/\/[^\s]+)\/studio\r?\nSynthetic login (\S+) \/ (\S+)\r?\n/,
            );
            if (ready) finish(undefined, ready);
          }
          harness.stdout.on("data", collect);
          harness.stderr.on("data", collect);
          harness.once("close", closed);
          harness.once("error", finish);
        },
      );

      browser = await chromium.launch();
      const page = await browser.newPage({
        baseURL,
        viewport: { width: 1280, height: 800 },
      });
      const login = await page.request.post("/api/login", {
        data: { name, password },
      });
      assert.equal(login.status(), 200);
      await open(page, "/studio", true);
      await settings(page);

      const navigation = page.getByRole("navigation", { name: "设置分类" });
      await navigation
        .getByRole("button", { name: "个人资料", exact: true })
        .click();
      const profile = page.locator(".profile-section");
      await expect(
        profile.getByRole("heading", { name: "个人资料" }),
      ).toHaveCSS("margin-bottom", "6px");
      await expect(profile.locator(".console-description")).toHaveCSS(
        "margin-bottom",
        "24px",
      );

      const services = navigation.getByRole("region", { name: "生成服务" });
      await services
        .getByRole("button", { name: "OpenAI", exact: true })
        .click();
      const openAITitle = page.locator(".openai-settings > h2");
      await expect(openAITitle).toBeVisible();
      const openAIMargin = await openAITitle.evaluate(
        (title) => getComputedStyle(title).marginBottom,
      );

      await services
        .getByRole("button", { name: "对话服务", exact: true })
        .click();
      const section = page.locator(".fm-chat-service");
      const provider = section.locator("form").first();
      await expect(
        provider.getByRole("heading", { name: "DeepSeek" }),
      ).toBeVisible();
      const status = provider.locator(".form-message");
      await expect(status).toBeEmpty();
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const idle = await provider.evaluate((card) => {
        const title = card.parentElement!.querySelector("h2")!;
        const header = card.querySelector("header")!;
        const heading = header.querySelector("h3")!;
        const headingRect = heading.getBoundingClientRect();
        const badge = header
          .querySelector("[data-chat-status]")!
          .getBoundingClientRect();
        const row = card
          .querySelector(".service-secret")!
          .getBoundingClientRect();
        const message = card.querySelector(".form-message")!;
        const cardRect = card.getBoundingClientRect();
        return {
          titleGap: cardRect.top - title.getBoundingClientRect().bottom,
          headingMargin: getComputedStyle(heading).marginBottom,
          headingAndBadgeAligned:
            Math.abs(
              headingRect.top +
                headingRect.height / 2 -
                badge.top -
                badge.height / 2,
            ) < 1,
          headerGap: row.top - header.getBoundingClientRect().bottom,
          bottomGap:
            cardRect.bottom -
            row.bottom -
            parseFloat(getComputedStyle(card).borderBottomWidth),
          emptyStatusHeight: message.getBoundingClientRect().height,
        };
      });

      await provider.getByRole("button", { name: "保存", exact: true }).click();
      const feedback = provider.getByRole("status");
      await expect(feedback).toHaveText("请输入密钥");
      await expect(feedback).toBeVisible();

      assert.deepEqual(
        { openAIMargin, ...idle },
        {
          openAIMargin: "16px",
          titleGap: 16,
          headingMargin: "0px",
          headingAndBadgeAligned: true,
          headerGap: 16,
          bottomGap: 20,
          emptyStatusHeight: 0,
        },
      );
      await section
        .getByRole("button", { name: "接入模型或接管兼容对话连接" })
        .click();
      await expect(
        page.getByRole("heading", { name: "模型接入", exact: true }),
      ).toBeVisible();
      console.log(
        "Verified provider spacing, save feedback, and navigation to model access",
      );
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
