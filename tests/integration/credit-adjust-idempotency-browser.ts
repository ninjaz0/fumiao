import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import {
  chromium,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { open, settings, setTab } from "./studio-settings-browser.js";

let harness: ChildProcess | undefined;
let exited: Promise<unknown[]> | undefined;
let browser: Browser | undefined;
let context: BrowserContext | undefined;
let page: Page;
let origin: string;
let teamWorkspace: number;
const teamName = "幂等调账验证组-" + Date.now();

before(
  async () => {
    let name = process.env.STUDIO_ADMIN_USER || "admin";
    let password = "";
    if (process.env.STUDIO_URL && process.env.STUDIO_PASSWORD_FILE) {
      origin = new URL(process.env.STUDIO_URL).origin;
      password = (await readFile(process.env.STUDIO_PASSWORD_FILE, "utf8")).trim();
    } else {
      harness = spawn(
        process.execPath,
        ["--import", "tsx", "tests/integration/smoke-studio-nest.ts", "--serve"],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      exited = once(harness, "exit");
      let output = "";
      const ready = new Promise<RegExpMatchArray>((resolve) => {
        const collect = (chunk: Buffer) => {
          output = (output + chunk.toString()).slice(-16000);
          const match = output.match(
            /Isolated Studio (http:\/\/[^\s]+)\/studio\r?\nSynthetic login (\S+) \/ (\S+)\r?\n/,
          );
          if (match) resolve(match);
        };
        harness!.stdout!.on("data", collect);
        harness!.stderr!.on("data", collect);
      });
      const [, readyOrigin, readyName, readyPassword] = await Promise.race([
        ready,
        exited.then(([code]) => {
          throw new Error(
            `Studio harness exited with ${code}: ${output.replace(/^Synthetic login .*$/gm, "Synthetic login [redacted]")}`,
          );
        }),
      ]);
      origin = readyOrigin;
      name = readyName;
      password = readyPassword;
    }
    browser = await chromium.launch();
    context = await browser.newContext({
      baseURL: origin,
      viewport: { width: 1280, height: 800 },
    });
    const login = await context.request.post("/api/login", {
      headers: { Origin: origin },
      data: { name, password },
    });
    assert.equal(login.status(), 200, await login.text());
    const createdTeam = await context.request.post("/api/workspaces", {
      headers: { Origin: origin },
      data: { name: teamName, members: [] },
    });
    assert.equal(createdTeam.status(), 200, await createdTeam.text());
    teamWorkspace = (await createdTeam.json()).id;
    page = await context.newPage();
  },
  { timeout: 190_000 },
);

after(
  async () => {
    try {
      await page?.unrouteAll({ behavior: "ignoreErrors" });
      await context?.close();
      await browser?.close();
    } finally {
      if (harness) {
        harness.kill("SIGTERM");
        await exited;
      }
    }
  },
  { timeout: 40_000 },
);

test("credit adjustment dialog settles at most once across lost response, edits, and retry", async () => {
  await open(page, "/studio", true);
  await settings(page);
  await setTab(page, "creditAdmin");

  const teamRow = page
    .locator(".credit-account-row")
    .filter({ hasText: teamName });
  await expect(teamRow).toBeVisible();
  await teamRow.locator('[data-act="credit-adjust"]').click();

  const form = page.locator("#credit-adjust-form");
  await expect(form).toBeVisible();

  let dropFirstResponse = true;
  const seenUids: string[] = [];
  await page.route("**/api/admin/credits/adjust", async (route) => {
    const body = route.request().postDataJSON() as { uid: string };
    seenUids.push(body.uid);
    if (dropFirstResponse) {
      dropFirstResponse = false;
      const committed = await route.fetch();
      assert.equal(committed.status(), 200, await committed.text());
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });

  // 1. Submit A (+50, "首次发放"): commits on server, response drops in transit.
  await form.locator('select[name="direction"]').selectOption("1");
  await form.locator('input[name="amount"]').fill("50");
  await form.locator('input[name="note"]').fill("首次发放");
  await form.locator('button[type="submit"]').click();
  await expect(form).toBeVisible();
  await expect(form.locator("#credit-adjust-error")).not.toBeEmpty();

  // 2a. Edit in same dialog to deduction B1 (-1 on 0-credit UI snapshot): blocked immediately on client.
  await form.locator('select[name="direction"]').selectOption("-1");
  await form.locator('input[name="amount"]').fill("1");
  await expect(form.locator('button[type="submit"]')).toBeDisabled();
  await expect(form.locator("#credit-adjust-error")).toHaveText(
    "当前账户可用 0 积分，余额不足无法扣减",
  );

  // 2b. Edit in same dialog to grant B2 (+20, "改试其他金额"): rejected on server by stable UID.
  await form.locator('select[name="direction"]').selectOption("1");
  await form.locator('input[name="amount"]').fill("20");
  await form.locator('input[name="note"]').fill("改试其他金额");
  await form.locator('button[type="submit"]').click();
  await expect(form.locator("#credit-adjust-error")).toHaveText(
    "该操作编号已使用",
  );

  // 3. Edit back to A (+50, "首次发放") and retry: succeeds idempotently and closes dialog.
  await form.locator('input[name="amount"]').fill("50");
  await form.locator('input[name="note"]').fill("首次发放");
  await form.locator('button[type="submit"]').click();
  await expect(form).toBeHidden();
  await expect(page.locator("#toast")).toHaveText("积分已调整");

  // Every network attempt from this dialog carried the exact same UID, and ledger settled once.
  assert.equal(seenUids.length, 3);
  assert.equal(new Set(seenUids).size, 1);

  const ledgerRes = await context!.request.get(
    `/api/admin/credits?workspace=${teamWorkspace}`,
  );
  assert.equal(ledgerRes.status(), 200);
  const ledgerBody = (await ledgerRes.json()) as {
    accounts: Array<{ workspace: number; available: number }>;
    history: Array<{ action: string; amount: number; note: string }>;
  };
  const accountAfter = ledgerBody.accounts.find(
    (a) => a.workspace === teamWorkspace,
  );
  assert.equal(accountAfter?.available, 50);
  const adjustEntries = ledgerBody.history.filter((e) => e.action === "adjust");
  assert.equal(adjustEntries.length, 1);
  assert.equal(adjustEntries[0].amount, 50);
  assert.equal(adjustEntries[0].note, "首次发放");
});
