import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium, expect, type Browser, type Page } from "@playwright/test";

let baseURL: string;
let username: string;
let password: string;
let harness: ChildProcess;
let browser: Browser;
before(
  async () => {
    harness = spawn(
      process.execPath,
      ["--import", "tsx", "tests/integration/smoke-studio-nest.ts", "--serve"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    const started = new Promise<void>((resolve) => {
      harness.stdout!.on("data", (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-16000);
        const origin = output.match(
          /Isolated Studio (http:\/\/[^\s]+)\/studio/,
        );
        const login = output.match(/Synthetic login (\S+) \/ (\S+)\r?\n/);
        if (!origin || !login) return;
        [baseURL, username, password] = [origin[1], login[1], login[2]];
        resolve();
      });
    });
    harness.stderr!.on("data", (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-16000);
    });
    const exited = once(harness, "exit").then(([code]) => {
      throw new Error(`Studio harness exited with ${code}`);
    });
    await Promise.race([started, exited]);
    browser = await chromium.launch({ headless: true });
  },
  { timeout: 190_000 },
);
after(
  async () => {
    await browser?.close();
    if (harness?.exitCode === null && harness.signalCode === null) {
      const closed = once(harness, "exit");
      const timer = setTimeout(() => harness.kill("SIGKILL"), 30_000);
      harness.kill("SIGTERM");
      await closed.finally(() => clearTimeout(timer));
    }
  },
  { timeout: 40_000 },
);

async function openStudio() {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  const login = await context.request.post("/api/login", {
    data: { name: username, password },
  });
  assert.equal(login.status(), 200);
  const page = await context.newPage();
  await page.goto("/studio");
  const name = page.locator(".account [data-current-name]");
  await expect(name).toBeVisible();
  return { context, page, name };
}

async function saveNickname(page: Page, nickname: string) {
  await page.locator(".account").click();
  await page.locator('.menu-item[data-nav="settings"]').click();
  await page.locator('[data-act="settings-tab"][data-value="profile"]').click();
  await page.locator("#nickname").fill(nickname);
  await page.getByRole("button", { name: "保存更改" }).click();
}

test(
  "state polls slower than the poll interval still update Studio",
  { timeout: 60_000 },
  async () => {
    const { context, page, name } = await openStudio();
    try {
      const nickname = "慢速轮询昵称";
      const reads = { started: 0, finished: 0, inFlight: 0, maxInFlight: 0 };
      await page.route("**/api/state", async (route) => {
        reads.started++;
        reads.maxInFlight = Math.max(reads.maxInFlight, ++reads.inFlight);
        try {
          const response = await route.fetch();
          const state = await response.json();
          await new Promise((resolve) => setTimeout(resolve, 7200));
          await route.fulfill({
            response,
            json: { ...state, me: { ...state.me, nickname } },
          });
          reads.finished++;
        } finally {
          reads.inFlight--;
        }
      });
      try {
        await expect(name).toHaveText(nickname, { timeout: 22_000 });
      } finally {
        if (process.env.STUDIO_EVIDENCE)
          await page.screenshot({
            path: join(
              process.env.STUDIO_EVIDENCE,
              `state-poll-${process.env.STUDIO_LABEL || "run"}.png`,
            ),
          });
        console.log(`Slow state reads: ${JSON.stringify(reads)}`);
      }
      assert.equal(reads.maxInFlight, 1, "periodic state reads overlapped");
    } finally {
      await context.close();
    }
  },
);

test(
  "a superseded state read that never answers does not stop polling",
  { timeout: 60_000 },
  async () => {
    const { context, page, name } = await openStudio();
    try {
      let reads = 0;
      await page.route("**/api/state", async (route) => {
        if (++reads === 1) return;
        const response = await route.fetch();
        const state = await response.json();
        await route.fulfill({
          response,
          json: { ...state, me: { ...state.me, nickname: `轮询${reads}` } },
        });
      });
      await expect.poll(() => reads, { timeout: 8_000 }).toBe(1);
      await saveNickname(page, "资料已保存");
      await expect
        .poll(() => reads, { timeout: 5_000 })
        .toBeGreaterThanOrEqual(2);
      const saved = reads;
      await expect(name).toHaveText(`轮询${saved}`);
      await expect
        .poll(() => reads, { timeout: 16_000 })
        .toBeGreaterThanOrEqual(saved + 2);
      await expect(name).toHaveText(`轮询${saved + 2}`);
      console.log(`Superseded hung state read, later reads: ${reads}`);
    } finally {
      await context.close();
    }
  },
);

test(
  "the latest state read that never answers is abandoned after its deadline",
  { timeout: 75_000 },
  async () => {
    const { context, page, name } = await openStudio();
    try {
      const started: number[] = [];
      await page.route("**/api/state", async (route) => {
        started.push(Date.now());
        if (started.length === 1) return;
        const response = await route.fetch();
        const state = await response.json();
        await route.fulfill({
          response,
          json: { ...state, me: { ...state.me, nickname: "超时后恢复" } },
        });
      });
      await expect(name).toHaveText("超时后恢复", { timeout: 40_000 });
      const gap = started[1] - started[0];
      console.log(`Hung state read replaced after ${gap}ms`);
      assert.ok(gap >= 19_000, `poll overlapped the hung read after ${gap}ms`);
    } finally {
      await context.close();
    }
  },
);

test(
  "a first state read slower than the poll deadline still opens Studio",
  { timeout: 60_000 },
  async () => {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 1440, height: 1000 },
    });
    try {
      const login = await context.request.post("/api/login", {
        data: { name: username, password },
      });
      assert.equal(login.status(), 200);
      const page = await context.newPage();
      let reads = 0;
      await page.route("**/api/state", async (route) => {
        const read = ++reads;
        const response = await route.fetch();
        if (read === 1)
          await new Promise((resolve) => setTimeout(resolve, 24_000));
        await route.fulfill({ response });
      });
      const started = Date.now();
      await page.goto("/studio");
      await expect(page.locator(".account [data-current-name]")).toBeVisible({
        timeout: 35_000,
      });
      console.log(
        `Slow first state read opened Studio after ${Date.now() - started}ms`,
      );
      assert.equal(reads, 1, "slow first state read was abandoned");
    } finally {
      await context.close();
    }
  },
);
