import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { chromium, expect, type Browser } from "@playwright/test";
import { newNode, type Project } from "../../apps/web/canvas-editor/types.js";

const externalOrigin = process.env.STUDIO_TEST_ORIGIN;
const externalUser = process.env.STUDIO_TEST_USER ?? "admin";
const externalPasswordFile = process.env.STUDIO_TEST_PASSWORD_FILE;

let harness: ChildProcess | undefined;
let exited: Promise<unknown[]> | undefined;
let browser: Browser | undefined;

try {
  let origin: string;
  let name: string;
  let password: string;

  if (externalOrigin && externalPasswordFile) {
    origin = externalOrigin.replace(/\/+$/, "");
    name = externalUser;
    password = (await readFile(externalPasswordFile, "utf8")).trim();
  } else {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "tests/integration/smoke-studio-nest.ts", "--serve"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    harness = child;
    exited = once(child, "exit");
    [, origin, name, password] = await new Promise<RegExpMatchArray>(
      (resolve, reject) => {
        let output = "";
        const cleanup = () => {
          clearTimeout(timer);
          child.stdout?.off("data", read);
          child.stderr?.off("data", read);
          child.off("error", failed);
          child.off("exit", earlyExit);
        };
        const failed = (error: Error) => {
          cleanup();
          reject(error);
        };
        const earlyExit = (code: number | null) =>
          failed(
            new Error(
              `Studio harness exited (${code}): ${output.replace(/^Synthetic login .*$/gm, "Synthetic login [redacted]")}`,
            ),
          );
        const timer = setTimeout(
          () => failed(new Error("Studio harness startup timed out")),
          180_000,
        );
        const read = (chunk: Buffer) => {
          output = (output + chunk.toString()).slice(-16000);
          const ready = output.match(
            /Isolated Studio (http:\/\/[^\s]+)\/studio\r?\nSynthetic login (\S+) \/ (\S+)\r?\n/,
          );
          if (!ready) return;
          cleanup();
          resolve(ready);
        };
        child.stdout?.on("data", read);
        child.stderr?.on("data", read);
        child.once("error", failed);
        child.once("exit", earlyExit);
      },
    );
  }

  browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width: 1360, height: 860 },
    colorScheme: "light",
  });

  try {
    const loginRes = await context.request.post("/api/login", {
      data: { name, password },
    });
    assert.equal(loginRes.status(), 200);
    const { workspace_id: workspace } = await (
      await context.request.get("/api/state")
    ).json();
    const headers = { Origin: origin, "X-Workspace-Id": String(workspace) };
    const runTag = Date.now().toString(36);
    const fileAName = `${runTag}_01_EP01.md`;
    const fileBName = `${runTag}_02_EP02.md`;
    const heroBefore = `林默_${runTag}`;
    const heroAfter = `沈默_${runTag}`;
    const canvasBTitle = `副画布_${runTag}`;

    // Create primary and secondary canvases in the same workspace
    const createdA = await context.request.post("/api/canvases", {
      headers,
      data: { title: `主画布_${runTag}` },
    });
    assert.equal(createdA.status(), 200);
    const canvasA: Project = await createdA.json();

    const createdB = await context.request.post("/api/canvases", {
      headers,
      data: { title: canvasBTitle },
    });
    assert.equal(createdB.status(), 200);
    const canvasB: Project = await createdB.json();

    const putB = await context.request.put(
      `/api/canvases/${canvasB.id}/document`,
      {
        headers,
        data: {
          title: canvasB.title,
          expected_revision: canvasB.revision,
          document: {
            schemaVersion: 1,
            nodes: [
              {
                ...newNode("text", 120, 120, 1),
                id: "roof-text-1",
                title: "天台场记",
                text: `${heroBefore}在天台等候黎明`,
              },
            ],
            edges: [],
            shots: [],
          },
        },
      },
    );
    assert.equal(putB.status(), 200, await putB.text());

    // Create two script documents
    const scriptARes = await context.request.post("/api/workspace/scripts", {
      headers,
      data: {
        path: fileAName,
        entry_type: "file",
        doc_kind: "script",
        canvas_id: canvasA.id,
        body_md: [
          "# EP01 午夜钟声",
          "",
          "### S01 钟表铺 夜 内",
          "",
          `△${heroBefore}推门走进钟表铺环顾四周。`,
          `△${heroBefore}低头凝视柜台上的黄铜怀表。`,
          `${heroBefore}：怀表停在了午夜十二点。`,
        ].join("\n"),
      },
    });
    assert.equal(scriptARes.status(), 200, await scriptARes.text());
    const docA = await scriptARes.json();

    const scriptBRes = await context.request.post("/api/workspace/scripts", {
      headers,
      data: {
        path: fileBName,
        entry_type: "file",
        doc_kind: "script",
        canvas_id: canvasA.id,
        body_md: `# EP02 雨巷\n\n### S01 雨巷 夜 外\n\n△${heroBefore}撑伞走过青石板路。`,
      },
    });
    assert.equal(scriptBRes.status(), 200, await scriptBRes.text());
    const docB = await scriptBRes.json();

    const page = await context.newPage();
    let failDocBSave = false;
    await page.route(`**/api/workspace/scripts/${docB.id}`, async (route) => {
      if (route.request().method() === "PUT" && failDocBSave) {
        await route.fulfill({
          status: 503,
          json: { detail: "模拟网络中断，保留草稿" },
        });
        return;
      }
      await route.continue();
    });

    const editPath = `/canvas/${canvasA.id}?workspace=${workspace}`;
    await page.goto(editPath);

    // 1. Narrow viewport layout check: switcher does not overlap header or document workspace
    await page.setViewportSize({ width: 840, height: 780 });
    await page.getByRole("tab", { name: "文档" }).click();
    await expect(page.getByText(fileAName).first()).toBeVisible();
    const headerBox = await page.locator(".canvas-header").boundingBox();
    const switcherBox = await page.locator(".fm-surface-switcher").boundingBox();
    const docWsBox = await page.locator(".fm-doc-workspace").boundingBox();
    assert.ok(headerBox && switcherBox && docWsBox);
    assert.ok(
      switcherBox.y >= headerBox.y + headerBox.height - 2,
      `switcher (${switcherBox.y}) must sit below header (${headerBox.y + headerBox.height})`,
    );
    assert.ok(
      docWsBox.y >= switcherBox.y + switcherBox.height - 2,
      `doc workspace (${docWsBox.y}) must sit below switcher (${switcherBox.y + switcherBox.height})`,
    );

    await page.setViewportSize({ width: 1360, height: 860 });

    // 2. Make an unsaved local draft in fileBName, then batch-replace heroBefore -> heroAfter across workspace
    failDocBSave = true;
    await page.getByRole("treeitem").filter({ hasText: fileBName }).dblclick();
    await expect(
      page.getByRole("tab", { selected: true }).filter({ hasText: fileBName }),
    ).toBeVisible();
    await page.getByRole("button", { name: "原文", exact: true }).click();
    const sourceEditor = page.getByRole("textbox", {
      name: "剧本文档原文编辑器",
    });
    const docBUnsavedDraft = `# EP02 雨巷\n\n### S01 雨巷 夜 外\n\n△${heroBefore}撑伞走过青石板路。\n△本地未保存草稿绝不能被替换清空！`;
    await sourceEditor.fill(docBUnsavedDraft);
    await expect(page.getByText("保存失败（本地草稿已保留）")).toBeVisible({
      timeout: 5000,
    });

    await page.getByRole("button", { name: "工作区全文搜索与替换" }).click();
    const searchDialog = page.getByRole("dialog", {
      name: "工作区全文搜索与替换",
    });
    await expect(searchDialog).toBeVisible();

    const queryInput = searchDialog.getByRole("textbox", {
      name: "查找文本",
    });
    const replaceInput = searchDialog.getByRole("textbox", {
      name: "替换文本",
    });
    await queryInput.fill(heroBefore);
    await searchDialog.getByRole("button", { name: "搜索", exact: true }).click();

    // Cross-canvas hit and script hit appear; dirty fileBName is protected
    await expect(searchDialog.getByText(fileAName)).toBeVisible();
    await expect(searchDialog.getByText(new RegExp(canvasBTitle))).toBeVisible();
    await expect(searchDialog.getByText(/有未保存草稿，已保护跳过/)).toBeVisible();

    await replaceInput.fill(heroAfter);
    await searchDialog.getByRole("button", { name: /预览替换/ }).click();
    await expect(
      searchDialog.getByRole("button", { name: /确认替换已选/ }),
    ).toBeVisible();

    // Changing query invalidates stale preview immediately so confirm button disappears
    await queryInput.fill("怀表");
    await expect(
      searchDialog.getByRole("button", { name: /确认替换已选/ }),
    ).toHaveCount(0);

    // Re-search heroBefore, preview, and confirm replace
    await queryInput.fill(heroBefore);
    await searchDialog.getByRole("button", { name: "搜索", exact: true }).click();
    await expect(searchDialog.getByText(fileAName)).toBeVisible();
    await searchDialog.getByRole("button", { name: /预览替换/ }).click();
    await searchDialog.getByRole("button", { name: /确认替换已选/ }).click();
    await expect(searchDialog.getByText(/已完成替换/)).toBeVisible();
    await searchDialog.getByRole("button", { name: "关闭全文搜索" }).click();

    // Verify fileBName unsaved draft was NOT overwritten!
    await expect(sourceEditor).toHaveValue(docBUnsavedDraft);

    // Unblock Doc B save and retry saving cleanly
    failDocBSave = false;
    await page.getByRole("button", { name: "重试保存" }).click();
    await expect(page.getByText(/✓ 已保存/)).toBeVisible();

    // Verify cross-canvas node text on canvasB was updated on server
    const canvasBAfter: Project = await (
      await context.request.get(`/api/canvases/${canvasB.id}`, { headers })
    ).json();
    assert.equal(
      canvasBAfter.document.nodes[0]?.text,
      `${heroAfter}在天台等候黎明`,
    );

    // Verify fileAName got updated to heroAfter
    await page.getByRole("tab").filter({ hasText: fileAName }).click();
    await page.getByRole("button", { name: "原文", exact: true }).click();
    await expect(sourceEditor).toHaveValue(
      new RegExp(`△${heroAfter}推门走进钟表铺环顾四周。`),
    );

    // 3. Sync 01_EP01.md to Canvas & test "查看源剧本" in both Rich mode and Source mode
    await page.getByRole("button", { name: "富文本", exact: true }).click();
    await page.getByRole("button", { name: "同步分镜到画布" }).click();
    const syncDialog = page.getByRole("dialog", {
      name: "从剧本拆解并同步至画布",
    });
    await expect(syncDialog).toBeVisible();
    await syncDialog.getByRole("button", { name: "一键落图并查看画布" }).click();
    await expect(syncDialog).toHaveCount(0);

    // Clear multi-selection, select second shot video node (S01-02), and click "查看源剧本"
    const secondShotNode = page
      .getByRole("group", { name: /^视频节点 S01-02/ })
      .first();
    await expect(secondShotNode).toBeVisible();
    await page.locator(".react-flow__pane").click({ position: { x: 24, y: 90 } });
    await secondShotNode.click();
    await page.getByRole("button", { name: "查看源剧本" }).click();

    // Rich mode highlights the S01-02 action beat
    const highlightedBeat = page.locator(
      '[data-shot-anchor="S01-02"].fm-rich-jump-highlight',
    );
    await expect(highlightedBeat).toBeVisible();

    // Switch to Source mode, open S01-02 video node in right split, jump again, and ensure typing does NOT reset cursor
    await page.getByRole("button", { name: "原文", exact: true }).click();
    const videoNodeTreeRow = page
      .locator(".fm-node-tree-row")
      .filter({ hasText: "S01-02" })
      .filter({ hasNotText: "剧本提示词" })
      .first();
    await videoNodeTreeRow.scrollIntoViewIfNeeded();
    await videoNodeTreeRow.hover();
    await videoNodeTreeRow
      .getByRole("button", { name: /向右分屏打开节点/ })
      .click();
    await page
      .getByRole("button", { name: /查看源剧本.*S01-02/ })
      .click();
    await expect(sourceEditor).toBeFocused();

    // Move cursor to end of textarea and type; selectionStart must stay at the end instead of resetting
    const lenBefore = (await sourceEditor.inputValue()).length;
    await sourceEditor.evaluate((el: HTMLTextAreaElement) => {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
    await page.keyboard.type("\n△补充结尾镜头。");
    const cursorAfter = await sourceEditor.evaluate(
      (el: HTMLTextAreaElement) => ({
        pos: el.selectionStart,
        len: el.value.length,
      }),
    );
    assert.ok(cursorAfter.len > lenBefore);
    assert.equal(
      cursorAfter.pos,
      cursorAfter.len,
      "typing after 查看源剧本 must not reset cursor position",
    );

    // Wait for auto-save of 01_EP01.md before testing 409 conflict + guarded leave
    await expect(page.getByText(/✓ 已保存/).first()).toBeVisible({
      timeout: 5000,
    });

    // 4. Advance server revision of 01_EP01.md to create a 409 conflict, test Cmd+S & guarded leave + draft restore
    const latestDocA = await (
      await context.request.get(`/api/workspace/scripts/${docA.id}`, { headers })
    ).json();
    const remoteUpdate = await context.request.put(`/api/workspace/scripts/${docA.id}`, {
      headers,
      data: {
        expected_revision: latestDocA.revision,
        body_md: latestDocA.body_md + "\n\n> 协作者远端备注",
      },
    });
    assert.equal(remoteUpdate.status(), 200);

    const conflictMarker = "△本地冲突草稿_跨页面保留验证";
    await sourceEditor.fill(`${latestDocA.body_md}\n${conflictMarker}`);
    await sourceEditor.press(
      process.platform === "darwin" ? "Meta+s" : "Control+s",
    );
    await expect(page.getByText("版本冲突（本地草稿已保留）").first()).toBeVisible();
    await expect(page.getByText("剧本文档已保存")).toHaveCount(0);

    // Attempting to leave canvas must open the guarded leave dialog due to conflicted script
    await page.getByRole("button", { name: "所有画布", exact: true }).click();
    const leaveDialog = page.getByRole("dialog", {
      name: "保存失败，仍要离开？",
    });
    await expect(leaveDialog).toBeVisible();
    await leaveDialog.getByRole("button", { name: "仍要离开", exact: true }).click();
    await expect(page).toHaveURL(`${origin}/canvas?workspace=${workspace}`);

    // Re-open the canvas and switch to Document Workspace: local conflict draft must still be preserved!
    await page.goto(editPath);
    await page.getByRole("tab", { name: "文档" }).click();
    await page.getByRole("button", { name: "原文", exact: true }).click();
    await expect(sourceEditor).toHaveValue(new RegExp(conflictMarker));
    await expect(page.getByText("版本冲突（本地草稿已保留）").first()).toBeVisible();

    console.log(
      "PASS script-workspace-fusion-browser: narrow layout, draft-safe search/replace, rich+source jump, conflict Cmd+S, and guarded leave retention verified",
    );
    await page.close();
  } finally {
    await context.close();
  }
} finally {
  await browser?.close();
  if (harness && exited) {
    harness.kill("SIGTERM");
    await exited;
  }
}
