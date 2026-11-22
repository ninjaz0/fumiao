import assert from "node:assert/strict";
import { expect, type Page } from "@playwright/test";
import type { Space, StudioState } from "../../apps/web/studio/state.js";
import { settings, setTab } from "./studio-settings-browser.js";

export async function checkStorageScope(
  page: Page,
  web: string,
  current: StudioState,
) {
  try {
    const created = await page.request.post("/api/workspaces", {
      headers: { Origin: web },
      data: { name: "存储范围验收", members: [] },
    });
    assert.equal(created.status(), 200, await created.text());
    const team: Space = await created.json();
    const response = await page.request.get("/api/state", {
      headers: { "X-Workspace-Id": String(team.id) },
    });
    assert.equal(response.status(), 200, await response.text());
    const empty: StudioState = await response.json();
    assert.ok(current.used! > 0, "The current space must hold media");
    assert.equal(empty.used, current.used, "Storage usage is instance-wide");

    await page.goto(`/studio?workspace=${team.id}`);
    await settings(page);
    await setTab(page, "storage");
    const section = page.locator(".settings-content");
    await expect(section.locator(".console-description")).toHaveText(
      "查看全站所有空间共用的媒体用量和任务预留容量。",
    );
    await section.getByRole("button", { name: "管理当前空间资产" }).click();
    await expect(page.locator("#library-grid .empty-state")).toHaveText(
      "暂无相关资产",
    );
    console.log(
      "Verified storage settings label instance-wide usage and open the current space's assets",
    );
  } finally {
    await page.close();
  }
}
