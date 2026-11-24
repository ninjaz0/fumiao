import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium, expect } from "@playwright/test";
import { request, settings, setTab } from "./studio-settings-browser.js";

const harness = spawn(process.execPath, ["--import", "tsx", "tests/integration/smoke-studio-nest.ts", "--serve"], {
  stdio: ["ignore", "pipe", "pipe"],
});
const exited = once(harness, "exit");
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  const [, origin, user, password] = await new Promise<RegExpMatchArray>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Studio harness startup timed out")), 180_000);
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
      const login = output.match(/Isolated Studio (http:\/\/\S+)\/studio\r?\nSynthetic login (\S+) \/ (\S+)\r?\n/);
      if (login) {
        clearTimeout(timer);
        resolve(login);
      }
    };
    harness.stdout.on("data", collect);
    harness.stderr.on("data", collect);
    harness.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Studio harness exited: ${code}`));
    });
  });
  browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto("/studio");
  await page.locator('[name="user"]').fill(user);
  await page.locator('[name="pw"]').fill(password);
  await page.locator('.auth-form [type="submit"]').click();
  await expect(page.locator(".shell")).toBeVisible();

  async function createTeam(name: string) {
    const response = await context.request.post("/api/workspaces", {
      headers: { Origin: origin },
      data: { name, members: [] },
    });
    assert.equal(response.status(), 200, await response.text());
    const { id } = await response.json();
    return { id, name };
  }

  const current = await createTeam("设计团队");
  const other = await createTeam("制作团队");
  await page.reload();
  const switchPath = (id: number) => `/api/workspaces/${id}/select`;
  await page.getByRole("button", { name: /^切换工作区/ }).click();
  const selected = await request(page, switchPath(current.id), "POST", () =>
    page.getByRole("option", { name: new RegExp(current.name) }).click(),
  );
  assert.equal(selected.status(), 200);
  await expect(page.getByRole("button", { name: `切换工作区，当前${current.name}` })).toBeVisible();

  await settings(page);
  await setTab(page, "workspaces");
  const heading = page.getByRole("heading", { name: "团队空间" });
  await expect(heading).toBeVisible();
  const row = (name: string) => page.locator(".workspace-row").filter({ hasText: name });
  await expect(row(current.name).getByText("当前空间", { exact: true })).toBeVisible();
  const currentEnter = row(current.name).getByRole("button", { name: "进入", exact: true });
  const otherEnter = row(other.name).getByRole("button", { name: "进入", exact: true });
  await expect(currentEnter).toBeVisible();
  await expect(otherEnter).toBeEnabled();

  if (process.env.TEAM_ENTRY_SCREENSHOT) {
    await page.mouse.move(5, 5);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.screenshot({ path: process.env.TEAM_ENTRY_SCREENSHOT, animations: "disabled" });
  }

  const switches: string[] = [];
  let navigations = 0;
  page.on("request", (pending) => {
    const path = new URL(pending.url()).pathname;
    if (pending.method() === "POST" && /^\/api\/workspaces\/\d+\/select$/.test(path))
      switches.push(path);
  });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations++;
  });
  const disabled = await currentEnter.isDisabled();
  await currentEnter.click({ force: true });
  await expect.poll(async () => ({
    disabled,
    switches,
    navigations,
    settingsVisible: await heading.isVisible(),
  }), { message: "Entering the current team must be disabled without a switch request or navigation" }).toEqual({
    disabled: true,
    switches: [],
    navigations: 0,
    settingsVisible: true,
  });
  console.log("Current team entry is disabled and keeps Settings open without a switch POST");

  const switched = await request(page, switchPath(other.id), "POST", () => otherEnter.click());
  assert.equal(switched.status(), 200);
  await expect(page).toHaveURL(`/studio?workspace=${other.id}`);
  await expect(page.getByRole("button", { name: `切换工作区，当前${other.name}` })).toBeVisible();
  assert.deepEqual(switches, [switchPath(other.id)]);
  console.log("Another team remains enterable and becomes the active workspace");
} finally {
  await browser?.close();
  harness.kill("SIGTERM");
  await exited;
}
