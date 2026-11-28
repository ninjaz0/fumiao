import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";
import { request, setTab } from "./studio-settings-browser.js";

/** Starts on Settings in a signed-in Studio, through the production Web gateway. */
export async function verifyCanvasPluginNode(page: Page, workspace: number) {
  await setTab(page, "plugins");
  const fixture = JSON.parse(await readFile("tests/fixtures/legacy-shot-prompt.fmplugin.json", "utf8"));
  const pluginId = "test-canvas-node";
  await page.getByLabel("选择插件文件").setInputFiles({
    name: `${pluginId}.fmplugin.json`,
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...fixture, id: pluginId })),
  });
  await expect(page.getByText(/工作区画布节点 · 镜头提示词/)).toBeVisible();
  await page.getByRole("button", { name: "确认导入", exact: true }).click();
  const toggle = page.getByRole("switch", { name: "镜头提示词开关" });
  const enabled = await request(
    page,
    `/api/admin/plugins/${pluginId}/state`,
    "POST",
    () => toggle.click(),
  );
  assert.ok(enabled.ok(), await enabled.text());
  const headers = {
    Origin: new URL(page.url()).origin,
    "X-Workspace-Id": String(workspace),
  };
  const created = await page.request.post("/api/canvases", {
    headers,
    data: { title: "插件节点验收" },
  });
  assert.equal(created.status(), 200, await created.text());
  const project = await created.json();
  const path = "/api/canvases/" + project.id;
  const saved = await page.request.put(path + "/document", {
    headers,
    data: {
      title: project.title,
      expected_revision: project.revision,
      document: {
        nodes: [
          {
            id: "script",
            type: "text",
            title: "分镜文案",
            x: 0,
            y: 0,
            text: "海面日出",
          },
        ],
        edges: [],
      },
    },
  });
  assert.equal(saved.status(), 200, await saved.text());
  await page.goto("/canvas/" + project.id + "?workspace=" + workspace);
  await page.getByRole("button", { name: "添加镜头提示词" }).click();
  const form = page.getByRole("region", { name: "镜头提示词参数" });
  await form.getByLabel("景别").selectOption("全景");
  const source = page.locator('[data-id="script"] .react-flow__handle.source');
  const destination = page.locator(
    '.react-flow__handle.target[data-handleid="script"]',
  );
  await expect(page.locator(".save-state")).toHaveText("已保存");
  const start = await source.boundingBox();
  const end = await destination.boundingBox();
  assert.ok(start && end);
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, {
    steps: 16,
  });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(path, { headers })).json()).document
          .edges.length,
    )
    .toBe(1);
  const node = page.locator(".react-flow__node").filter({
    has: page.getByRole("textbox", { name: "节点名称 镜头提示词" }),
  });
  await node.locator(".node-content").click();
  await form.getByRole("button", { name: "运行节点" }).click();
  await expect(node.getByText("全景：海面日出")).toBeVisible();
  await page.reload();
  await expect(node.getByText("全景：海面日出")).toBeVisible();
  const stored = await (await page.request.get(path, { headers })).json();
  assert.equal(
    stored.document.nodes.find((n: { type: string }) => n.type === "plugin")
      .extension.result.prompt,
    "全景：海面日出",
  );
}
