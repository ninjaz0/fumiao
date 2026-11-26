import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, expect, type Browser, type Page } from "@playwright/test";
import type { Project } from "../../apps/web/canvas-editor/types.js";

const evidence = process.env.CANVAS_LEAVE_EVIDENCE;
const label = process.env.CANVAS_LEAVE_EVIDENCE_LABEL ?? "after";
const viewport = { width: 1280, height: 800 };
const harness = spawn(
  process.execPath,
  ["--import", "tsx", "tests/integration/smoke-studio-nest.ts", "--serve"],
  { stdio: ["ignore", "pipe", "pipe"] },
);
const exited = once(harness, "exit");
let browser: Browser | undefined;

const exits = [
  { name: "toolbar", path: "/canvas", click: (page: Page) =>
    page.getByRole("button", { name: "所有画布", exact: true }).click() },
  { name: "menu list", path: "/canvas", click: async (page: Page) => {
    await page.getByRole("button", { name: "项目菜单" }).click();
    await page.locator(".project-menu").getByRole("button", { name: "所有画布", exact: true }).click();
  } },
  { name: "menu Studio", path: "/studio", click: async (page: Page) => {
    await page.getByRole("button", { name: "项目菜单" }).click();
    await page.getByRole("button", { name: "返回工作台", exact: true }).click();
  } },
  { name: "logo", path: "/studio", click: (page: Page) =>
    page.getByRole("link", { name: "返回工作台", exact: true }).click() },
];

try {
  const [, origin, name, password] = await new Promise<RegExpMatchArray>(
    (resolve, reject) => {
      let output = "";
      const cleanup = () => {
        clearTimeout(timer);
        harness.stdout.off("data", read);
        harness.stderr.off("data", read);
        harness.off("error", failed);
        harness.off("exit", earlyExit);
      };
      const failed = (error: Error) => {
        cleanup();
        reject(error);
      };
      const earlyExit = (code: number | null) =>
        failed(new Error(
          `Studio harness exited (${code}): ${output.replace(/^Synthetic login .*$/gm, "Synthetic login [redacted]")}`,
        ));
      const timer = setTimeout(() => failed(new Error("Studio harness startup timed out")), 180_000);
      const read = (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-16000);
        const ready = output.match(
          /Isolated Studio (http:\/\/[^\s]+)\/studio\nSynthetic login (\S+) \/ (\S+)\r?\n/,
        );
        if (!ready) return;
        cleanup();
        resolve(ready);
      };
      harness.stdout.on("data", read);
      harness.stderr.on("data", read);
      harness.once("error", failed);
      harness.once("exit", earlyExit);
    },
  );
  browser = await chromium.launch({ slowMo: evidence ? 180 : 0 });
  const context = await browser.newContext({
    baseURL: origin,
    viewport,
    colorScheme: "light",
    acceptDownloads: true,
    ...(evidence && label === "after" ? { recordVideo: { dir: evidence, size: viewport } } : {}),
  });
  try {
    assert.equal((await context.request.post("/api/login", { data: { name, password } })).status(), 200);
    const { workspace_id: workspace } = await (await context.request.get("/api/state")).json();
    const headers = { Origin: origin, "X-Workspace-Id": String(workspace) };
    const cases = [
      ...[503, 409].flatMap((status) => exits.map((exit) => ({ status, exit, denyStorage: false }))),
      { status: 503, exit: exits[3], denyStorage: true },
      { status: 409, exit: exits[3], denyStorage: true },
      { status: 404, exit: exits[0], denyStorage: false },
    ];
    const failures: unknown[] = [];
    for (const { status, exit, denyStorage } of cases) {
      const scenario = `${status} ${exit.name}${denyStorage ? " (storage denied)" : ""}`;
      const capture = evidence && scenario === "503 toolbar";
      const page = await context.newPage();
      let beforeUnload = 0;
      let putCount = 0;
      page.on("dialog", async (dialog) => {
        if (dialog.type() === "beforeunload") beforeUnload++;
        await dialog.dismiss();
      });
      try {
        const initialTitle = "项目草图";
        const draftTitle = "项目草图 · 本地修改";
        const serverTitle = status === 409 ? "项目草图 · 团队版本" : initialTitle;
        const created = await context.request.post("/api/canvases", { headers, data: { title: initialTitle } });
        assert.equal(created.status(), 200, await created.text());
        const project: Project = await created.json();
        const apiPath = `/api/canvases/${project.id}`;
        const editPath = `/canvas/${project.id}?workspace=${workspace}`;
        let failSave = status === 503;
        let allowMissingRuns = false;
        if (status === 404) {
          await page.route(`**${apiPath}/runs`, (route) =>
            allowMissingRuns ? route.continue() : route.fulfill({ json: { runs: [] } }),
          );
        }
        await page.route(`**${apiPath}/document`, async (route) => {
          assert.equal(route.request().method(), "PUT");
          putCount++;
          // Delete only after the editor starts saving, so initial loads succeed.
          if (status === 404 && putCount === 1) {
            const removed = await context.request.delete(apiPath, { headers });
            assert.ok(removed.ok(), await removed.text());
          }
          if (failSave) {
            await route.fulfill({ status: 503, json: { detail: "保存服务暂时不可用" } });
          } else {
            await route.continue();
          }
        });
        if (denyStorage) {
          await page.setViewportSize({ width: 320, height: 568 });
          await page.addInitScript(() => {
            const setItem = Storage.prototype.setItem;
            Storage.prototype.setItem = function (key: string, value: string) {
              if (this === localStorage && key.startsWith("fm-canvas-")) {
                throw new DOMException("Test: storage quota exceeded", "QuotaExceededError");
              }
              return setItem.call(this, key, value);
            };
          });
        }
        await page.goto(editPath);
        const title = page.getByRole("textbox", { name: "画布名称" });
        await expect(title).toHaveValue(initialTitle);
        const conflictOnExit = status === 409 && denyStorage;
        if (status === 409) {
          const remote = await context.request.put(`${apiPath}/document`, {
            headers, data: {
              title: serverTitle, document: project.document, expected_revision: project.revision,
            },
          });
          assert.equal(remote.status(), 200, await remote.text());
        }
        if (conflictOnExit) {
          const now = new Date();
          await page.clock.install({ time: now });
          await page.clock.pauseAt(new Date(now.getTime() + 1000));
        }
        await title.fill(draftTitle);
        const failedSave = page.waitForResponse((response) =>
          new URL(response.url()).pathname === `${apiPath}/document` &&
          response.request().method() === "PUT" && response.status() === status,
        );
        await title.press("Enter");
        if (conflictOnExit) {
          assert.equal(putCount, 0, "the leave action must discover this conflict");
          await exit.click(page);
          await page.clock.resume();
        }
        await failedSave;
        await expect(page.locator(".save-state")).toHaveText(status === 409 ? "保存冲突" : "保存失败，重试");
        if (status === 404) {
          const missingRuns = page.waitForResponse((response) =>
            new URL(response.url()).pathname === `${apiPath}/runs` && response.status() === 404,
          );
          allowMissingRuns = true;
          await missingRuns;
        }
        if (!conflictOnExit) await exit.click(page);
        const dialog = page.getByRole("dialog", { name: "保存失败，仍要离开？" });
        if (capture) {
          await Promise.race([
            dialog.waitFor({ state: "visible" }),
            page.locator(".canvas-toast").waitFor({ state: "visible" }),
          ]);
          await page.mouse.move(10, 80);
          await page.screenshot({ path: join(evidence, `canvas-leave-${label}.png`) });
        }
        if (beforeUnload) {
          throw new Error("Canvas navigated outside the save guard and triggered native beforeunload");
        }
        await expect(dialog).toBeVisible({ timeout: 2_000 });
        await expect(page).toHaveURL(origin + editPath);
        const retry = dialog.getByRole("button", { name: "重试保存" });
        if (denyStorage) {
          await expect(dialog).not.toContainText("已保留");
          await expect(dialog).toContainText("未保存的修改将丢失");
          const actions = dialog.locator(".dialog-actions");
          assert.ok(
            await actions.evaluate((row) => {
              const bounds = row.getBoundingClientRect();
              return [...row.querySelectorAll("button")].every((button) => {
                const item = button.getBoundingClientRect();
                return item.left >= bounds.left && item.right <= bounds.right;
              });
            }),
            "All leave actions must fit inside the narrow dialog",
          );
        } else {
          await expect(dialog).toContainText("本地草稿已保留");
        }
        if (denyStorage || status === 404) {
          const exportButton = dialog.getByRole("button", { name: "下载本地副本" });
          await expect(exportButton).toBeVisible();
          const downloading = page.waitForEvent("download");
          await exportButton.click();
          const download = await downloading;
          assert.match(download.suggestedFilename(), /\.json$/);
          const exported = JSON.parse(await readFile(await download.path(), "utf8"));
          assert.equal(exported.title, draftTitle);
        }
        if (status === 409) {
          await expect(retry).toBeDisabled();
          assert.equal(putCount, 1, "known conflicts must not send another PUT");
        } else {
          await expect(retry).toBeEnabled();
          if (status === 503 && !denyStorage && exit.name === "toolbar") {
            const retryResponse = page.waitForResponse((response) =>
              new URL(response.url()).pathname === `${apiPath}/document` && response.status() === 503,
            );
            await retry.click();
            await retryResponse;
            await expect(retry).toBeEnabled();
            await expect(dialog).toBeVisible();
            await dialog.getByRole("button", { name: "取消", exact: true }).click();
            await expect(dialog).toBeHidden();
            await expect(title).toHaveValue(draftTitle);
            await exit.click(page);
            await expect(dialog).toBeVisible();
          }
        }
        const retrySucceeds = status === 503 && exit.name === "menu list";
        if (retrySucceeds) {
          failSave = false;
          await retry.click();
        } else {
          await dialog.getByRole("button", { name: "仍要离开", exact: true }).click();
        }
        await expect(page).toHaveURL(`${origin}${exit.path}?workspace=${workspace}`);
        assert.equal(beforeUnload, 0, "explicitly confirmed exits must not trigger a native prompt");
        if (capture) {
          await expect(page.getByText(initialTitle, { exact: true }).first()).toBeVisible();
          await page.screenshot({ path: join(evidence, "canvas-leave-destination.png") });
        }
        const storedResponse = await context.request.get(apiPath, { headers });
        if (status === 404) {
          assert.equal(storedResponse.status(), 404);
          console.log("PASS deleted canvas: retained draft can be exported before leaving");
          continue;
        }
        const stored: Project = await storedResponse.json();
        assert.equal(stored.title, retrySucceeds ? draftTitle : serverTitle);
        await page.goto(editPath);
        await expect(title).toHaveValue(denyStorage ? serverTitle : draftTitle);
        if (status === 409 && !denyStorage) {
          await expect(page.locator(".save-state")).toHaveText("保存冲突");
          await exit.click(page);
          await expect(dialog).toBeVisible();
          await dialog.getByRole("button", { name: "仍要离开", exact: true }).click();
          await expect(page).toHaveURL(`${origin}${exit.path}?workspace=${workspace}`);

          await page.goto(editPath);
          await expect(title).toHaveValue(draftTitle);
          await expect(page.locator(".save-state")).toHaveText("保存冲突");
          assert.equal(putCount, 1, "leaving a restored conflict must not rebase the draft or send a PUT");
          const latest: Project = await (await context.request.get(apiPath, { headers })).json();
          assert.equal(latest.revision, stored.revision);
          assert.equal(latest.title, serverTitle);
          console.log(`PASS ${scenario}: repeated leave and reopen preserved the conflict and team revision`);
        }
        console.log(`PASS ${scenario}: guarded exit, ${retrySucceeds ? "retry saved" : denyStorage ? "export available without claiming retention" : "local draft restored"}`);
      } catch (error) {
        console.error(`FAIL ${scenario}: ${String(error)} (PUTs: ${putCount}; native beforeunload prompts: ${beforeUnload})`);
        failures.push(error);
      } finally {
        await page.close();
        const video = page.video();
        if (video && evidence && capture) {
          await video.saveAs(join(evidence, "canvas-leave-after.webm"));
        }
        await video?.delete();
      }
    }
    assert.equal(failures.length, 0, "all canvas exits must work after a failed save");
  } finally {
    await context.close();
  }
} finally {
  await browser?.close();
  harness.kill("SIGTERM");
  await exited;
}
