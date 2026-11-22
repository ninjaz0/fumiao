import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium, expect, type Browser } from "@playwright/test";

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
        const origin = output.match(/Isolated Studio (http:\/\/[^\s]+)\/studio/);
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

test("state polls slower than the poll interval still update Studio", { timeout: 60_000 }, async () => {
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
    await page.goto("/studio");
    const name = page.locator(".account [data-current-name]");
    await expect(name).toBeVisible();
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
          path: join(process.env.STUDIO_EVIDENCE, `state-poll-${process.env.STUDIO_LABEL || "run"}.png`),
        });
      console.log(`Slow state reads: ${JSON.stringify(reads)}`);
    }
    assert.equal(reads.maxInFlight, 1, "periodic state reads overlapped");
  } finally {
    await context.close();
  }
});
