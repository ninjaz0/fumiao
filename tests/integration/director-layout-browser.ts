import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { chromium, expect } from "@playwright/test";
import { build } from "esbuild";
import { OriginalCanvases, canvasConflict } from "@fumiao/original-api/canvases.js";
import { chatsFixture } from "../helpers/chats.js";

test("导演台三标签切换器在窄屏选中节点与中宽屏下均不与 AI 助手球或主工作区重叠，且非版本冲突 409 可重试保存", async (t) => {
  const f = await chatsFixture();
  let closeBrowser: (() => Promise<void>) | undefined;
  t.after(async () => {
    await closeBrowser?.();
    await f.cleanup();
  });
  await f.db.query(
    "INSERT INTO studio_plugin_profile(mode) VALUES('compatible') ON CONFLICT DO NOTHING",
  );

  const canvases = new OriginalCanvases(f.p);
  const created = await canvases.create(
    f.admin,
    { title: "导演台响应式验收" },
    String(f.workspace.public_id),
  );
  const saved = await canvases.save(
    f.admin,
    created.id,
    {
      title: created.title,
      expected_revision: created.revision,
      document: {
        schemaVersion: 1,
        nodes: [
          {
            id: "shot_1",
            type: "video",
            title: "S01-01 开场",
            x: 160,
            y: 160,
            width: 320,
            height: 240,
            text: "",
            prompt: "雨夜街道",
            narration_text: "",
            color: "none",
            params: {},
          } as any,
        ],
        edges: [],
        shots: ["shot_1"],
      },
    },
  );
  assert.equal(saved.revision, 2);

  const bundle = await build({
    stdin: {
      loader: "tsx",
      resolveDir: join(process.cwd(), "apps/web"),
      contents: `
        import { createRoot } from "react-dom/client";
        import CanvasEditor from "./canvas-editor/CanvasEditor";
        createRoot(document.getElementById("root")).render(<CanvasEditor loadingLogo="" />);
      `,
    },
    bundle: true,
    write: false,
    jsx: "automatic",
    outdir: "browser",
    external: ["/static/*"],
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const baseline = await readFile("baseline/production/static/canvas.css", "utf8");

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  closeBrowser = async () => {
    await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => {});
    await browser.close();
  };

  let nextSaveOverride: { status: number; detail: string } | null = null;

  await page.route("https://director-layout.test/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    if (path === "/editor.js") {
      return route.fulfill({
        contentType: "application/javascript",
        body: bundle.outputFiles.find((o) => o.path.endsWith(".js"))!.text,
      });
    }
    if (path === "/editor.css") {
      return route.fulfill({
        contentType: "text/css",
        body: baseline + bundle.outputFiles.find((o) => o.path.endsWith(".css"))!.text,
      });
    }
    if (path.startsWith("/canvas/")) {
      return route.fulfill({
        contentType: "text/html",
        body: '<meta charset="utf-8"><link rel="stylesheet" href="/editor.css"><div id="root"></div><script src="/editor.js"></script>',
      });
    }
    if (!path.startsWith("/api/")) {
      return route.fulfill({ status: 404, body: "" });
    }
    if (path === `/api/canvases/${created.id}/document` && req.method() === "PUT" && nextSaveOverride) {
      const override = nextSaveOverride;
      nextSaveOverride = null;
      return route.fulfill({ status: override.status, json: { detail: override.detail } });
    }
    const body = req.method() === "GET" ? undefined : (req.postDataJSON() ?? undefined);
    const result = await f.request(req.method(), path + url.search, body, 0);
    return route.fulfill({ status: result.status, json: result.body });
  });

  await page.goto(`https://director-layout.test/canvas/${created.id}`);
  await expect(page.locator(".fm-surface-switcher")).toBeVisible();

  // Select the video node so data-composer-open="true" activates on mobile!
  await page.locator('.react-flow__node[data-id="shot_1"]').click();
  await expect(page.locator(".canvas-workspace")).toHaveAttribute("data-composer-open", "true");

  // 1) Check 375x812 and 320x568: .fm-surface-switcher and .fm-agent-orb must NOT overlap, and 导演台 tab must be directly clickable!
  for (const [w, h] of [
    [375, 812],
    [320, 568],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(80);
    const switcher = await page.locator(".fm-surface-switcher").boundingBox();
    const orb = await page.locator(".fm-agent-orb").boundingBox();
    assert.ok(switcher && orb, `${w}px switcher and orb must be visible`);
    const overlaps =
      switcher.x < orb.x + orb.width &&
      switcher.x + switcher.width > orb.x &&
      switcher.y < orb.y + orb.height &&
      switcher.y + switcher.height > orb.y;
    assert.equal(
      overlaps,
      false,
      `${w}x${h} .fm-surface-switcher (${JSON.stringify(switcher)}) must not overlap .fm-agent-orb (${JSON.stringify(orb)})`,
    );

    await page.getByRole("tab", { name: "导演台" }).click({ timeout: 2000 });
    await expect(page.locator(".canvas-workspace")).toHaveAttribute("data-surface", "director");
    const deskBox = await page.locator(".fm-director-desk").boundingBox();
    const switcherOnDesk = await page.locator(".fm-surface-switcher").boundingBox();
    assert.ok(deskBox && switcherOnDesk);
    assert.ok(
      deskBox.y >= switcherOnDesk.y + switcherOnDesk.height - 2,
      `${w}x${h} .fm-director-desk (${deskBox.y}) must sit below .fm-surface-switcher (${switcherOnDesk.y + switcherOnDesk.height})`,
    );

    await page.getByRole("tab", { name: "画布" }).click({ timeout: 2000 });
    await expect(page.locator(".canvas-workspace")).toHaveAttribute("data-surface", "canvas");
  }

  // 2) Check 1250x800 (undocked) and 1560x900 (docked AI assistant): 3-tab switcher stacks below header and .fm-director-desk clears switcher!
  await page.setViewportSize({ width: 1250, height: 800 });
  await page.getByRole("tab", { name: "导演台" }).click();
  await page.waitForTimeout(80);
  {
    const header = await page.locator(".canvas-header").boundingBox();
    const switcher = await page.locator(".fm-surface-switcher").boundingBox();
    const desk = await page.locator(".fm-director-desk").boundingBox();
    assert.ok(header && switcher && desk);
    assert.ok(
      switcher.y >= header.y + header.height - 2,
      `1250px switcher (${switcher.y}) must stack below header (${header.y + header.height})`,
    );
    assert.ok(
      desk.y >= switcher.y + switcher.height - 2,
      `1250px .fm-director-desk (${desk.y}) must sit below switcher (${switcher.y + switcher.height})`,
    );
  }

  await page.setViewportSize({ width: 1560, height: 900 });
  await page.locator(".fm-agent-orb").click();
  await expect(page.locator(".fm-floating-agent.is-docked")).toBeVisible();
  await page.waitForTimeout(80);
  {
    const header = await page.locator(".canvas-header").boundingBox();
    const switcher = await page.locator(".fm-surface-switcher").boundingBox();
    const desk = await page.locator(".fm-director-desk").boundingBox();
    assert.ok(header && switcher && desk);
    assert.ok(
      switcher.y >= header.y + header.height - 2,
      `1560px docked switcher (${switcher.y}) must stack below header (${header.y + header.height})`,
    );
    assert.ok(
      desk.y >= switcher.y + switcher.height - 2,
      `1560px docked .fm-director-desk (${desk.y}) must sit below switcher (${switcher.y + switcher.height})`,
    );
  }

  // 3) Verify non-revision 409 ("主剧本文档版本不存在") enters retryable error state instead of permanent "保存冲突", whereas canvasConflict enters "保存冲突".
  const titleInput = page.getByRole("textbox", { name: "画布名称" });
  nextSaveOverride = { status: 409, detail: "主剧本文档版本不存在" };
  await titleInput.fill("导演台响应式验收 · 可重试修改");
  await titleInput.blur();
  await expect(page.locator(".save-state")).toHaveText("保存失败，重试");
  await page.locator(".save-state").click();
  await expect(page.locator(".save-state")).toHaveText("已保存");

  nextSaveOverride = { status: 409, detail: canvasConflict };
  await titleInput.fill("导演台响应式验收 · 真并发冲突");
  await titleInput.blur();
  await expect(page.locator(".save-state")).toHaveText("保存冲突");
});
