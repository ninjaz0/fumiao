import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { chromium, expect } from "@playwright/test";
import { build } from "esbuild";
import { OriginalCanvases } from "@fumiao/original-api/canvases.js";
import { OriginalModelAccess } from "@fumiao/original-api/model-access.js";
import { chatsFixture } from "../helpers/chats.js";

test("画布报价服务短断后可直接重试，保留原镜头和参数到主动提交", async (t) => {
  const f = await chatsFixture();
  t.after(f.cleanup);
  await f.db.query(
    "INSERT INTO studio_plugin_profile(mode) VALUES('compatible') ON CONFLICT DO NOTHING",
  );
  const api = new OriginalModelAccess(f.identity);
  const conn = await api.create(f.admin, {
    base_url: "https://1.1.1.1/v1",
    api_key: "synthetic-video",
    default_video_protocol: "openrouter-videos",
  });
  const id = randomUUID();
  await api.saveDraft(f.admin, id, {
    expected_revision: 0,
    connection_id: conn.id,
    connection_revision: 1,
    upstream_id: "clip",
    purpose: "video",
    price: "3",
    overrides: {
      durations: [8],
      sizes: ["1280x720"],
      resolutions: ["720p"],
      aspect_ratios: ["16:9"],
    },
  });
  const pub = await api.publish(f.admin, {
    uid: randomUUID(),
    items: [{ draft_id: id, draft_revision: 1, action: "create" }],
  });
  const model = pub.items[0].catalog_id;
  const canvases = new OriginalCanvases(f.p);
  const canvas = await canvases.create(f.member, { title: "报价重试" });
  await canvases.save(f.member, canvas.id, {
    title: "报价重试",
    expected_revision: 1,
    document: {
      nodes: [
        {
          id: "clip",
          type: "video",
          title: "镜头",
          x: 0,
          y: 0,
          prompt: "保留这段提示词",
          params: { model, seconds: 8 },
          extra_params: { size: "1280x720" },
        },
        {
          id: "old",
          type: "video",
          title: "旧镜头",
          x: 420,
          y: 0,
          prompt: "旧草稿",
          params: { model, seconds: 8 },
          extra_params: {
            size: "1920x1080",
            resolution: "720p",
            aspect_ratio: "16:9",
          },
        },
      ],
      edges: [],
    },
  });
  const bundle = await build({
    stdin: {
      loader: "tsx",
      resolveDir: join(process.cwd(), "apps/web"),
      contents: `
      import { createRoot } from "react-dom/client";
      import CanvasEditor from "./canvas-editor/CanvasEditor";
      createRoot(document.getElementById("root")).render(<CanvasEditor loadingLogo="" />);`,
    },
    bundle: true,
    write: false,
    jsx: "automatic",
    outdir: "browser",
    external: ["/static/*"],
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const baseline = await readFile(
    "baseline/production/static/canvas.css",
    "utf8",
  );
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  });
  const quotes: unknown[] = [];
  const paid: unknown[] = [];
  await page.route("https://canvas.test/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/editor.js")
      return route.fulfill({
        contentType: "application/javascript",
        body: bundle.outputFiles.find((o) => o.path.endsWith(".js"))!.text,
      });
    if (path === "/editor.css")
      return route.fulfill({
        contentType: "text/css",
        body:
          baseline +
          bundle.outputFiles.find((o) => o.path.endsWith(".css"))!.text,
      });
    if (path.startsWith("/canvas/"))
      return route.fulfill({
        contentType: "text/html",
        body: '<meta charset="utf-8"><link rel="stylesheet" href="/editor.css"><div id="root"></div><script src="/editor.js"></script>',
      });
    if (!path.startsWith("/api/"))
      return route.fulfill({ status: 404, body: "" });
    const body = request.postDataJSON() ?? undefined;
    if (path === "/api/quotes/batch") {
      quotes.push(body);
      if (quotes.length === 1)
        return route.fulfill({
          status: 503,
          json: { detail: "报价服务暂不可用" },
        });
    }
    if (
      (path.endsWith("/runs") || path.endsWith("/candidates")) &&
      request.method() === "POST"
    )
      paid.push(body);
    const result = await f.request(request.method(), path, body, 1);
    return route.fulfill({ status: result.status, json: result.body });
  });
  await page.goto("https://canvas.test/canvas/" + canvas.id);
  await page.locator('.react-flow__node[data-id="clip"]').click();
  const panel = page.locator(".node-composer:visible").first();
  await expect(
    panel.getByRole("status").filter({ hasText: "报价服务暂不可用" }),
  ).toBeVisible();
  const generate = panel.getByRole("button", { name: "生成", exact: true });
  await expect(generate).toBeDisabled();
  await expect(panel.getByLabel("分辨率", { exact: true })).toBeDisabled();
  await panel.getByRole("button", { name: "重新报价" }).click();
  await expect(panel.locator(".canvas-credit")).toContainText("最高 24");
  await expect(generate).toBeEnabled();
  assert.equal(quotes.length, 2);
  assert.deepEqual(quotes[0], quotes[1]);
  assert.deepEqual(paid, []);
  assert.equal((await f.db.query("SELECT id FROM jobs")).rows.length, 0);
  await generate.click();
  await expect.poll(() => paid.length).toBe(1);
  await expect
    .poll(async () => (await f.db.query("SELECT id FROM jobs")).rows.length)
    .toBe(1);
  await page.locator('.react-flow__node[data-id="old"]').click();
  const size = panel.getByLabel("尺寸", { exact: true });
  const resolution = panel.getByLabel("分辨率", { exact: true });
  await expect(size).toHaveValue(JSON.stringify("1920x1080"));
  await expect(resolution).toHaveValue(JSON.stringify("720p"));
  await expect(generate).toBeDisabled();
  await size.selectOption("");
  await expect(resolution).toHaveValue(JSON.stringify("720p"));
  await expect(panel.locator(".canvas-credit")).toContainText("最高 24");
  assert.equal(paid.length, 1);
});
