import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { chromium, expect, type Browser, type Locator } from "@playwright/test";
import sharp from "sharp";
import { directorBasis, directorShotIds } from "../../packages/web-compat/src/director.js";
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

    // Seed canvasA with a text node containing heroBefore so post-replace re-search can verify current-canvas node freshness
    const putA = await context.request.put(
      `/api/canvases/${canvasA.id}/document`,
      {
        headers,
        data: {
          title: canvasA.title,
          expected_revision: canvasA.revision,
          document: {
            schemaVersion: 1,
            nodes: [
              {
                ...newNode("text", 120, 80, 1),
                id: "main-shop-text-1",
                title: "钟表铺门口场记",
                text: `${heroBefore}站在钟表铺门口冒雨驻足`,
              },
            ],
            edges: [],
            shots: [],
          },
        },
      },
    );
    assert.equal(putA.status(), 200, await putA.text());

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

    // Create a directory + child script to verify open child session alignment on directory rename
    const folderOrigName = `第1季_${runTag}`;
    const folderRenamedName = `第一季精修_${runTag}`;
    const childFileName = `${runTag}_EP03_支线.md`;
    const dirRes = await context.request.post("/api/workspace/scripts", {
      headers,
      data: {
        path: folderOrigName,
        entry_type: "directory",
      },
    });
    assert.equal(dirRes.status(), 200, await dirRes.text());
    const childScriptRes = await context.request.post("/api/workspace/scripts", {
      headers,
      data: {
        path: `${folderOrigName}/${childFileName}`,
        entry_type: "file",
        doc_kind: "script",
        canvas_id: canvasA.id,
        body_md: `# EP03 支线\n\n### S01 档案室 夜 内\n\n△翻阅旧卷宗。`,
      },
    });
    assert.equal(childScriptRes.status(), 200, await childScriptRes.text());
    const childDoc = await childScriptRes.json();

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

    let releaseSlowSearch: (() => void) | null = null;
    await page.route("**/api/workspace/scripts/search", async (route) => {
      const postBody = route.request().postDataJSON?.() as
        | { query?: string }
        | undefined;
      if (postBody?.query === heroBefore && !releaseSlowSearch) {
        await new Promise<void>((resolve) => {
          releaseSlowSearch = resolve;
        });
      }
      await route.continue();
    });

    const editPath = `/canvas/${canvasA.id}?workspace=${workspace}`;
    await page.goto(editPath);

    // 1. Narrow viewport (<= 760px) layout check: switcher does not overlap header or document workspace
    await page.setViewportSize({ width: 720, height: 780 });
    await page.getByRole("tab", { name: "文档" }).click();
    await expect(page.getByText(fileAName).first()).toBeVisible();
    await page.getByRole("treeitem").filter({ hasText: fileAName }).dblclick();
    const headerBox = await page.locator(".canvas-header").boundingBox();
    const switcherBox = await page.locator(".fm-surface-switcher").boundingBox();
    const docWsBox = await page.locator(".fm-doc-workspace").boundingBox();
    assert.ok(headerBox && switcherBox && docWsBox);
    assert.ok(
      switcherBox.y >= headerBox.y + headerBox.height - 2,
      `switcher (${switcherBox.y}) must sit below header (${headerBox.y + headerBox.height}) at <=760px`,
    );
    assert.ok(
      docWsBox.y >= switcherBox.y + switcherBox.height - 2,
      `doc workspace (${docWsBox.y}) must sit below switcher (${switcherBox.y + switcherBox.height}) at <=760px`,
    );

    // 1a. Mobile 375x812 check: 2-row wrapped header vs switcher/doc, touch directory row buttons without hover, bottom .viewport-dock vs .fm-agent-orb, and docked/floating AI assistant bounds
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(120);
    const header375 = await page.locator(".canvas-header").boundingBox();
    const switcher375 = await page.locator(".fm-surface-switcher").boundingBox();
    const docWs375 = await page.locator(".fm-doc-workspace").boundingBox();
    assert.ok(header375 && switcher375 && docWs375);
    assert.ok(
      switcher375.y >= header375.y + header375.height - 2,
      `375px switcher (${switcher375.y}) must sit below wrapped header (${header375.y + header375.height})`,
    );
    assert.ok(
      docWs375.y >= switcher375.y + switcher375.height - 2,
      `375px doc workspace (${docWs375.y}) must sit below switcher (${switcher375.y + switcher375.height})`,
    );
    // Directory row action buttons must be visible at 375px without pointer hover
    const folderRowMobile = page
      .getByRole("treeitem")
      .filter({ hasText: folderOrigName })
      .first();
    await expect(
      folderRowMobile.getByRole("button", { name: `重命名 ${folderOrigName}` }),
    ).toBeVisible();

    // Switch to Canvas surface at 375x812 and check .fm-agent-orb does not overlap .viewport-dock
    await page.getByRole("tab", { name: "画布" }).click();
    const orbBox375 = await page.locator(".fm-agent-orb").boundingBox();
    const dockBox375 = await page.locator(".viewport-dock").boundingBox();
    assert.ok(orbBox375 && dockBox375);
    const orbIntersectsDock =
      orbBox375.x < dockBox375.x + dockBox375.width &&
      orbBox375.x + orbBox375.width > dockBox375.x &&
      orbBox375.y < dockBox375.y + dockBox375.height &&
      orbBox375.y + orbBox375.height > dockBox375.y;
    assert.equal(
      orbIntersectsDock,
      false,
      `375px .fm-agent-orb (${JSON.stringify(orbBox375)}) must not overlap .viewport-dock (${JSON.stringify(dockBox375)})`,
    );

    // Open AI assistant at 375x812: check docked bounds, then floating bounds, then restore docked & close
    await page.locator(".fm-agent-orb").click();
    const agentPanel = page.locator(".fm-floating-agent");
    await expect(agentPanel).toBeVisible();
    const dockedAgentBox = await agentPanel.boundingBox();
    assert.ok(dockedAgentBox);
    assert.ok(
      dockedAgentBox.x >= -1 && dockedAgentBox.x + dockedAgentBox.width <= 376,
      `375px docked AI assistant must fit viewport width: ${JSON.stringify(dockedAgentBox)}`,
    );
    assert.ok(
      dockedAgentBox.y >= header375.y + header375.height - 2,
      `375px docked AI assistant (${dockedAgentBox.y}) must sit below wrapped header (${header375.y + header375.height})`,
    );
    await agentPanel.getByRole("button", { name: "切换为悬浮" }).click();
    const floatAgentBox = await agentPanel.boundingBox();
    assert.ok(floatAgentBox);
    assert.ok(
      floatAgentBox.x >= 0 && floatAgentBox.x + floatAgentBox.width <= 376,
      `375px floating AI assistant must fit viewport width: ${JSON.stringify(floatAgentBox)}`,
    );
    assert.ok(
      floatAgentBox.y >= header375.y + header375.height - 4 &&
        floatAgentBox.y + floatAgentBox.height <= 813,
      `375px floating AI assistant must fit viewport height: ${JSON.stringify(floatAgentBox)}`,
    );
    await agentPanel.getByRole("button", { name: "停靠到右侧" }).click();
    await agentPanel.getByRole("button", { name: "关闭 Agent 提案箱" }).click();
    await page.getByRole("tab", { name: "文档" }).click();

    await page.setViewportSize({ width: 1360, height: 860 });

    // 1b. Two-user directory rename concurrency check:
    // User A opens clean child script at r1 -> Collaborator B saves r2 -> User A renames parent folder (child becomes r3).
    // User A's clean session MUST refresh to B's r2 body so A's next edit (r4) preserves B's r2 instead of overwriting it!
    await page.getByRole("treeitem").filter({ hasText: childFileName }).dblclick();
    await expect(
      page.getByRole("tab", { selected: true }).filter({ hasText: childFileName }),
    ).toBeVisible();
    await page.getByRole("button", { name: "原文", exact: true }).click();
    const sourceEditor = page.getByRole("textbox", {
      name: "剧本文档原文编辑器",
    });
    await expect(sourceEditor).toHaveValue(/△翻阅旧卷宗。/);

    // Collaborator B commits r2 on childDoc before User A renames the parent folder
    const collabPutR2 = await context.request.put(
      `/api/workspace/scripts/${childDoc.id}`,
      {
        headers,
        data: {
          expected_revision: childDoc.revision,
          body_md: `# EP03 支线\n\n### S01 档案室 夜 内\n\n△翻阅旧卷宗。\n△协作者B在目录改名前提交的r2正文。`,
        },
      },
    );
    assert.equal(collabPutR2.status(), 200, await collabPutR2.text());
    const childR2 = await collabPutR2.json();
    assert.equal(childR2.revision, 2);

    const folderRow = page
      .getByRole("treeitem")
      .filter({ hasText: folderOrigName })
      .first();
    await folderRow.hover();
    await folderRow
      .getByRole("button", { name: `重命名 ${folderOrigName}` })
      .click();
    const renameInput = page.locator(".fm-tree-rename-input");
    await expect(renameInput).toBeVisible();
    await renameInput.fill(folderRenamedName);
    await renameInput.press("Enter");
    await expect(
      page.getByRole("treeitem").filter({ hasText: folderRenamedName }).first(),
    ).toBeVisible();

    // Clean session in User A's browser must refresh to Collaborator B's r2 body at r3!
    await expect(sourceEditor).toHaveValue(/协作者B在目录改名前提交的r2正文/, {
      timeout: 5000,
    });
    const refreshedChildVal = await sourceEditor.inputValue();
    await sourceEditor.fill(
      `${refreshedChildVal}\n△用户A在目录改名后继续追加的r4正文。`,
    );
    await expect(page.getByText(/✓ 已保存/).first()).toBeVisible({
      timeout: 5000,
    });
    const childAfterDirRename = await (
      await context.request.get(`/api/workspace/scripts/${childDoc.id}`, {
        headers,
      })
    ).json();
    assert.equal(childAfterDirRename.revision, 4);
    assert.equal(
      childAfterDirRename.path,
      `${folderRenamedName}/${childFileName}`,
    );
    assert.match(childAfterDirRename.body_md, /协作者B在目录改名前提交的r2正文/);
    assert.match(childAfterDirRename.body_md, /用户A在目录改名后继续追加的r4正文/);

    // 2. Make an unsaved local draft in fileBName, then batch-replace heroBefore -> heroAfter across workspace
    failDocBSave = true;
    await page.getByRole("treeitem").filter({ hasText: fileBName }).dblclick();
    await expect(
      page.getByRole("tab", { selected: true }).filter({ hasText: fileBName }),
    ).toBeVisible();
    await page.getByRole("button", { name: "原文", exact: true }).click();
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
    await replaceInput.fill(heroAfter);

    // 2a. Slow in-flight search invalidation: start searching heroBefore (held in flight), switch query to "不存在的词_xyz", then release slow search
    await queryInput.fill(heroBefore);
    await searchDialog.getByRole("button", { name: "搜索", exact: true }).click();
    await expect
      .poll(() => Boolean(releaseSlowSearch), { timeout: 5000 })
      .toBe(true);
    await queryInput.fill(`不存在的词_${runTag}`);
    releaseSlowSearch!();
    await page.waitForTimeout(250);
    await expect(
      searchDialog.getByRole("button", { name: /预览替换/ }),
    ).toBeDisabled();
    await expect(searchDialog.getByText(fileAName)).toHaveCount(0);

    // Now run normal search for heroBefore
    await queryInput.fill(heroBefore);
    await searchDialog.getByRole("button", { name: "搜索", exact: true }).click();

    // Cross-canvas hit and script hit appear; dirty fileBName is protected
    await expect(searchDialog.getByText(fileAName)).toBeVisible();
    await expect(searchDialog.getByText(new RegExp(canvasBTitle))).toBeVisible();
    await expect(searchDialog.getByText(/有未保存草稿，已保护跳过/)).toBeVisible();

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
    await expect(searchDialog.getByText(/钟表铺门口场记/)).toBeVisible();
    await searchDialog.getByRole("button", { name: /预览替换/ }).click();
    await searchDialog.getByRole("button", { name: /确认替换已选/ }).click();
    await expect(searchDialog.getByText(/已完成替换/)).toBeVisible();
    // Current-canvas node (钟表铺门口场记), script fileAName, and cross-canvas node must NOT reappear with stale text or checked state!
    await expect(searchDialog.getByText(/钟表铺门口场记/)).toHaveCount(0);
    await expect(searchDialog.getByText(fileAName)).toHaveCount(0);
    await expect(searchDialog.getByText(new RegExp(canvasBTitle))).toHaveCount(0);
    await expect(
      searchDialog.getByRole("button", { name: /预览替换/ }),
    ).toBeDisabled();
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

    // 3. Sync 01_EP01.md to Canvas (including delayed/failed initial /runs protection!) & test "查看源剧本" in both Rich mode and Source mode
    await page.getByRole("button", { name: "富文本", exact: true }).click();
    await page.getByRole("button", { name: "同步分镜到画布" }).click();
    const syncDialog = page.getByRole("dialog", {
      name: "从剧本拆解并同步至画布",
    });
    await expect(syncDialog).toBeVisible();
    // First sync in grid_preview mode so grid_preview nodes exist on canvasA with media_id=null & active_job=null
    await syncDialog.getByLabel("生成链路").selectOption("grid_preview");
    await syncDialog.getByRole("button", { name: "一键落图并查看画布" }).click();
    await expect(syncDialog).toHaveCount(0);
    await expect(page.locator(".canvas-header")).toContainText("已保存", {
      timeout: 5000,
    });
    const canvasWithGrids: Project = await (
      await context.request.get(`/api/canvases/${canvasA.id}`, { headers })
    ).json();
    const firstGridNode = canvasWithGrids.document.nodes.find(
      (n) => n.extra_params?.script_role === "grid_preview",
    );
    assert.ok(firstGridNode, "expected grid_preview node after grid sync");

    // 3a-1. Pre-existing in-flight initial /runs held open until AFTER user triggers pending sync submit:
    // ensureFreshRuns must await and consume that in-flight /runs response directly without racing React 19 state commit!
    let runsInterceptMode: "hold_in_flight" | "fail_503" | "passthrough" =
      "hold_in_flight";
    let releaseHeldRuns: (() => void) | null = null;
    await page.route(`**/api/canvases/${canvasA.id}/runs`, async (route) => {
      if (runsInterceptMode === "hold_in_flight") {
        await new Promise<void>((resolve) => {
          releaseHeldRuns = resolve;
        });
        await route.fulfill({
          status: 200,
          json: {
            runs: [
              {
                id: 990001,
                canvas_node: firstGridNode.id,
                owner: 1,
                kind: "image",
                status: "done",
                result: "a".repeat(32),
                note: "",
                prompt: firstGridNode.prompt,
                refs: [],
                width: 1024,
                height: 1024,
                created: Math.floor(Date.now() / 1000),
                seconds: 0,
                quality: 0,
                ratio: "9:16",
                image_quality: "medium",
                model: "gpt-image-2.6-sunburst",
              },
            ],
          },
        });
        return;
      }
      if (runsInterceptMode === "fail_503") {
        await route.fulfill({
          status: 503,
          json: { detail: "模拟任务历史加载失败" },
        });
        return;
      }
      await route.continue();
    });

    await page.goto(editPath);
    await expect
      .poll(() => Boolean(releaseHeldRuns), { timeout: 5000 })
      .toBe(true);
    await page.getByRole("tab", { name: "文档" }).click();
    await page.getByRole("treeitem").filter({ hasText: fileAName }).click();
    await page.getByRole("button", { name: "同步分镜到画布" }).click();
    await expect(syncDialog).toBeVisible();
    await syncDialog.getByLabel("生成链路").selectOption("omni_ref");
    // Click submit WHILE initial /runs request is STILL held in flight (and setBusy(true) state update is pending)!
    const clickSubmitPromise = syncDialog
      .getByRole("button", { name: "一键落图并查看画布" })
      .click();
    await page.waitForTimeout(80);
    runsInterceptMode = "passthrough";
    releaseHeldRuns!();
    await clickSubmitPromise;
    await expect(syncDialog).toHaveCount(0);
    await expect(page.locator(".canvas-header")).toContainText("已保存", {
      timeout: 5000,
    });
    const afterDelayedRunsSync: Project = await (
      await context.request.get(`/api/canvases/${canvasA.id}`, { headers })
    ).json();
    assert.ok(
      afterDelayedRunsSync.document.nodes.some((n) => n.id === firstGridNode.id),
      "grid_preview node with completed job in pre-existing in-flight /runs must be preserved",
    );

    // 3a-2. Failed /runs (503): reopen canvas when /runs fails completely (runs=[], runsKnown=false);
    // syncing in omni_ref mode must conservatively preserve ALL remaining grid_preview nodes & their edges!
    const remainingGridNode = afterDelayedRunsSync.document.nodes.find(
      (n) =>
        n.extra_params?.script_role === "grid_preview" &&
        n.id !== firstGridNode.id,
    );
    // Re-sync in grid_preview first so S01-02 also has an empty grid_preview node with edges, then test 503 failure
    runsInterceptMode = "passthrough";
    await page.getByRole("tab", { name: "文档" }).click();
    await page.getByRole("button", { name: "同步分镜到画布" }).click();
    await syncDialog.getByLabel("生成链路").selectOption("grid_preview");
    await syncDialog.getByRole("button", { name: "一键落图并查看画布" }).click();
    await expect(syncDialog).toHaveCount(0);
    await expect(page.locator(".canvas-header")).toContainText("已保存", {
      timeout: 5000,
    });
    const beforeFail503: Project = await (
      await context.request.get(`/api/canvases/${canvasA.id}`, { headers })
    ).json();
    const s02Grid = beforeFail503.document.nodes.find(
      (n) =>
        n.extra_params?.script_role === "grid_preview" &&
        n.extra_params?.script_anchor === "S01-02",
    );
    assert.ok(s02Grid, "expected S01-02 grid node before 503 test");
    void remainingGridNode;

    runsInterceptMode = "fail_503";
    await page.goto(editPath);
    await page.getByRole("tab", { name: "文档" }).click();
    await page.getByRole("treeitem").filter({ hasText: fileAName }).click();
    await page.getByRole("button", { name: "同步分镜到画布" }).click();
    await expect(syncDialog).toBeVisible();
    await syncDialog.getByLabel("生成链路").selectOption("omni_ref");
    await syncDialog.getByRole("button", { name: "一键落图并查看画布" }).click();
    await expect(syncDialog).toHaveCount(0);
    await expect(page.locator(".canvas-header")).toContainText("已保存", {
      timeout: 5000,
    });
    const afterFail503Sync: Project = await (
      await context.request.get(`/api/canvases/${canvasA.id}`, { headers })
    ).json();
    assert.ok(
      afterFail503Sync.document.nodes.some((n) => n.id === s02Grid.id),
      "grid_preview node must be preserved when /runs fails with 503 (runsKnown=false)",
    );
    assert.ok(
      afterFail503Sync.document.edges.some(
        (e) => e.source === s02Grid.id || e.target === s02Grid.id,
      ),
      "grid_preview edges must be preserved when /runs fails with 503 (runsKnown=false)",
    );
    runsInterceptMode = "passthrough";

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

    await page.getByRole("button", { name: "用于本集制作" }).click();
    const directorSync = page.getByRole("dialog", { name: "确认本集分镜" });
    await expect(directorSync).toBeVisible();
    await directorSync.getByRole("button", { name: "保存并进入导演台" }).click();
    const directorTab = page.getByRole("tab", { name: "导演台" });
    await expect(directorTab).toHaveAttribute("aria-selected", "true");
    const director = page.getByRole("region", { name: "导演台" });
    await director.getByRole("button", { name: /^S01-02/ }).click();
    await expect(director.getByRole("heading", { name: "确认分镜" })).toBeVisible();
    await director.getByRole("button", { name: "保存并确认顺序" }).click();
    await expect(director.getByRole("button", { name: "顺序已确认" })).toBeDisabled();
    await director.getByRole("button", { name: "定位画布", exact: true }).click();
    await expect(secondShotNode).toHaveClass(/selected/);
    const savedProduction: Project = await (
      await context.request.get(`/api/canvases/${canvasA.id}`, { headers })
    ).json();
    const episode = savedProduction.document.director;
    assert.ok(episode);
    assert.equal(episode.script_id, docA.id);
    assert.equal(episode.order_basis, await directorBasis(directorShotIds(savedProduction.document.shots ?? [], episode)));
    const secondId = await secondShotNode.getAttribute("data-id");
    assert.ok(secondId && savedProduction.document.director?.shot_ids.includes(secondId));
    assert.ok(savedProduction.document.edges.some((edge) => edge.source === s02Grid.id && edge.target === secondId));
    const assetImage = page.locator(`.react-flow__node[data-id="${s02Grid.id}"]`);
    await assetImage.click();
    await expect(assetImage).toHaveClass(/selected/);
    await directorTab.click();
    await expect(director.getByRole("button", { name: /^S01-02/ })).toHaveAttribute("aria-pressed", "true");
    await expect(director.getByRole("heading", { name: "确认分镜" })).toBeVisible();
    if (await director.getByRole("button", { name: "关闭自动尾帧" }).isVisible()) {
      await expect(director.getByText(/自动尾帧来源：S01-01/)).toBeVisible();
      await director.getByRole("button", { name: "关闭自动尾帧" }).click();
    }
    await director.getByRole("button", { name: "确认分镜", exact: true }).click();
    await expect(director.getByRole("button", { name: "分镜已确认" })).toBeDisabled();
    const material = director.locator(".fm-director-materials li").filter({ hasText: s02Grid.title });
    await expect(material).toContainText("缺图");
    await material.getByRole("button", { name: "预检参考图" }).click();
    const quote = page.getByRole("dialog", { name: /参考图预检/ });
    await expect(quote).toBeVisible();
    await expect(quote.getByRole("group", { name: "选择执行阶段" })).toHaveCount(0);
    await quote.getByRole("button", { name: "关闭" }).click();

    const uploadReference = async (slot: Locator, button: string, background: string) => {
      await slot.getByRole("button", { name: button }).click();
      const library = page.getByRole("dialog", { name: "资产库" });
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        library.getByRole("button", { name: "上传图片", exact: true }).click(),
      ]);
      const buffer = await sharp({ create: { width: 320, height: 240, channels: 3, background } }).png().toBuffer();
      await chooser.setFiles({ name: "director-reference.png", mimeType: "image/png", buffer });
    };
    await uploadReference(material, "选择或上传图片", "#214566");
    await expect(material).toContainText("已固定");
    const missing = director.locator(".fm-director-materials li").filter({ hasText: "缺图" });
    const missingCount = await missing.count();
    assert.ok(missingCount > 0, "the shot has shared material slots in addition to the grid reference");
    await expect(director.getByRole("button", { name: "确认素材", exact: true })).toBeDisabled();
    for (let i = missingCount; i > 0; i--) {
      await uploadReference(missing.first(), "选择或上传图片", "#568956");
      await expect(missing).toHaveCount(i - 1);
    }
    await director.getByRole("button", { name: "确认素材", exact: true }).click();
    await expect(director.getByRole("button", { name: "素材已确认" })).toBeDisabled();
    const firstImage = await material.locator("img").getAttribute("src");
    await uploadReference(material, "替换图片", "#ae4a55");
    await expect(material.locator("img")).not.toHaveAttribute("src", firstImage!);
    await expect(director.getByRole("button", { name: "素材已变更，重新确认" })).toBeEnabled();
    await expect(director.getByRole("button", { name: "分镜已确认" })).toBeDisabled();
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(director.getByRole("heading", { name: "确认分镜" })).toBeVisible();
    await expect.poll(async () => {
      const switcher = await page.locator(".fm-surface-switcher").boundingBox();
      const desk = await director.boundingBox();
      return Boolean(switcher && desk && desk.y >= switcher.y + switcher.height - 2);
    }).toBe(true);
    await page.setViewportSize({ width: 1360, height: 860 });

    const freshEdit = await (await context.request.get(`/api/workspace/scripts/${docA.id}`, { headers })).json();
    const remoteShot = "远端补写尾声";
    const reloadPreview = await context.request.put(`/api/workspace/scripts/${docA.id}`, {
      headers,
      data: { expected_revision: freshEdit.revision, body_md: `${freshEdit.body_md}\n\n△${remoteShot}。` },
    });
    assert.equal(reloadPreview.status(), 200, await reloadPreview.text());
    await director.getByRole("button", { name: "更新本集分镜" }).click();
    const freshRow = directorSync.getByRole("article").filter({ hasText: remoteShot });
    await expect(freshRow).toBeVisible();
    await expect(freshRow.getByRole("checkbox", { name: "纳入本集" })).not.toBeChecked();
    const afterPreview = await reloadPreview.json();
    const raceEdit = await context.request.put(`/api/workspace/scripts/${docA.id}`, {
      headers,
      data: { expected_revision: afterPreview.revision, body_md: `${afterPreview.body_md}\n\n> 预览之后协作者又更新了剧本。` },
    });
    assert.equal(raceEdit.status(), 200, await raceEdit.text());
    await directorSync.getByRole("button", { name: "保存并进入导演台" }).click();
    await expect(directorSync.getByRole("alert")).toContainText(/剧本.*更新/);
    const freshCanvas: Project = await (await context.request.get(`/api/canvases/${canvasA.id}`, { headers })).json();
    assert.equal(freshCanvas.document.director?.script_revision, episode.script_revision);
    await directorSync.getByRole("button", { name: "关闭同步窗口" }).click();
    await directorTab.click();
    await director.getByRole("button", { name: "在文档中编辑" }).click();
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

    // Wait for auto-save of 01_EP01.md AND canvasA flush before testing delayed proposal approval + 409 conflict
    await expect(page.getByText(/✓ 已保存/).first()).toBeVisible({
      timeout: 5000,
    });
    await page.getByRole("tab", { name: "画布" }).click();
    await expect(page.locator(".canvas-header")).toContainText("已保存", {
      timeout: 5000,
    });

    // 3b. Proposal approval concurrency check:
    // While POST /proposals/:id/apply response is in flight, User A edits canvasA locally.
    // Pre-request snapshot must detect the concurrent edit, preserve local draft without doc.reload(), and restore draft across reopen!
    const latestCanvasBeforeProp: Project = await (
      await context.request.get(`/api/canvases/${canvasA.id}`, { headers })
    ).json();
    const createPropRes = await context.request.post(
      `/api/canvases/${canvasA.id}/proposals`,
      {
        headers,
        data: {
          title: `提案并发测试_${runTag}`,
          summary: "验证审批延迟响应期间画布编辑不被覆盖",
          base_revision: latestCanvasBeforeProp.revision,
          operations: [
            {
              op: "add_node",
              temp_id: "prop_tmp_1",
              type: "text",
              title: "提案新增场记节点",
              x: 680,
              y: 120,
              text: "由提案原子新增的内容",
            },
          ],
        },
      },
    );
    assert.equal(createPropRes.status(), 200, await createPropRes.text());

    let releaseProposalApply: (() => void) | null = null;
    await page.route(
      `**/api/canvases/${canvasA.id}/proposals/*/apply`,
      async (route) => {
        const upstream = await route.fetch();
        await new Promise<void>((resolve) => {
          releaseProposalApply = resolve;
        });
        await route.fulfill({ response: upstream });
      },
    );

    await page.getByRole("button", { name: "画布 Agent 提案箱" }).click();
    await expect(page.getByText(`提案并发测试_${runTag}`)).toBeVisible();
    await page.getByRole("button", { name: "批准落图" }).click();
    await expect
      .poll(() => Boolean(releaseProposalApply), { timeout: 5000 })
      .toBe(true);

    // Edit canvas title while proposal apply response is still held in flight!
    const concurrentCanvasTitle = `${canvasA.title}_审批中本地修改`;
    const canvasTitleInput = page.getByRole("textbox", { name: "画布名称" });
    await canvasTitleInput.fill(concurrentCanvasTitle);
    await canvasTitleInput.press("Enter");

    releaseProposalApply!();
    await expect(page.locator(".canvas-header")).toContainText("保存冲突", {
      timeout: 5000,
    });
    await expect(canvasTitleInput).toHaveValue(concurrentCanvasTitle);
    await expect(
      page.getByText(/批准提案期间画布发生了修改|已保留本地草稿并标记冲突/).first(),
    ).toBeVisible();

    // Reopen editPath: persisted localStorage draft must restore concurrentCanvasTitle in conflict state (not wiped by doc.reload()!)
    await page.goto(editPath);
    await expect(page.getByRole("textbox", { name: "画布名称" })).toHaveValue(
      concurrentCanvasTitle,
    );
    await expect(page.locator(".canvas-header")).toContainText("保存冲突");

    // Resolve canvas conflict cleanly via "重新载入" before running step 4 script conflict tests
    await page.getByRole("button", { name: "重新载入", exact: true }).click();
    await page
      .getByRole("dialog", { name: "重新载入画布？" })
      .getByRole("button", { name: "重新载入", exact: true })
      .click();
    await expect(page.getByRole("textbox", { name: "画布名称" })).toHaveValue(
      canvasA.title,
      { timeout: 10000 },
    );
    await page.getByRole("tab", { name: "文档" }).click();
    await page.getByRole("treeitem").filter({ hasText: fileAName }).dblclick();
    await page.getByRole("button", { name: "原文", exact: true }).click();

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

    // Attempting to create/duplicate/leave canvas must open the guarded leave dialog due to conflicted script
    const leaveDialog = page.getByRole("dialog", {
      name: "保存失败，仍要离开？",
    });

    // 4a. "新建画布" and "复制画布" must NOT bypass script draft protection, and "下载本地副本" must bundle unsaved_scripts!
    await page.getByRole("button", { name: "项目菜单", exact: true }).click();
    await page.getByRole("button", { name: "新建画布", exact: true }).click();
    await expect(leaveDialog).toBeVisible();
    await expect(
      leaveDialog.getByRole("button", { name: "重试保存", exact: true }),
    ).toBeDisabled();
    const [backupDownload] = await Promise.all([
      page.waitForEvent("download"),
      leaveDialog
        .getByRole("button", { name: "下载本地副本", exact: true })
        .click(),
    ]);
    const backupFilePath = await backupDownload.path();
    assert.ok(backupFilePath, "expected downloaded local backup path");
    const backupJson = JSON.parse(await readFile(backupFilePath, "utf8")) as {
      title: string;
      document: { nodes: unknown[] };
      unsaved_scripts?: Array<{
        id: string;
        path: string;
        status: string;
        saved_body_md: string;
        draft_body_md: string;
      }>;
    };
    assert.equal(backupJson.title, canvasA.title);
    assert.ok(Array.isArray(backupJson.document?.nodes));
    const exportedDocA = backupJson.unsaved_scripts?.find(
      (s) => s.id === String(docA.id),
    );
    assert.ok(exportedDocA, "unsaved_scripts must include conflicted docA");
    assert.equal(exportedDocA.path, fileAName);
    assert.equal(exportedDocA.status, "conflict");
    assert.match(exportedDocA.draft_body_md, new RegExp(conflictMarker));
    await leaveDialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(leaveDialog).toHaveCount(0);

    await page.getByRole("button", { name: "项目菜单", exact: true }).click();
    await page.getByRole("button", { name: "复制画布", exact: true }).click();
    await expect(leaveDialog).toBeVisible();
    await leaveDialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(leaveDialog).toHaveCount(0);

    await page.getByRole("button", { name: "所有画布", exact: true }).click();
    await expect(leaveDialog).toBeVisible();
    await leaveDialog.getByRole("button", { name: "仍要离开", exact: true }).click();
    await expect(page).toHaveURL(`${origin}/canvas?workspace=${workspace}`);

    // Re-open the canvas (1st reopen) and switch to Document Workspace: local conflict draft must be preserved!
    await page.goto(editPath);
    await page.getByRole("tab", { name: "文档" }).click();
    await page.getByRole("treeitem").filter({ hasText: fileAName }).click();
    await page.getByRole("button", { name: "原文", exact: true }).click();
    await expect(sourceEditor).toHaveValue(new RegExp(conflictMarker));
    await expect(page.getByText("版本冲突（本地草稿已保留）").first()).toBeVisible();

    // Close/leave and re-open a 2nd time: conflict status MUST remain "conflict" (never turning dirty or auto-saving over collaborator body!)
    await page.getByRole("button", { name: "所有画布", exact: true }).click();
    await expect(leaveDialog).toBeVisible();
    await leaveDialog.getByRole("button", { name: "仍要离开", exact: true }).click();
    await expect(page).toHaveURL(`${origin}/canvas?workspace=${workspace}`);

    await page.goto(editPath);
    await page.getByRole("tab", { name: "文档" }).click();
    await page.getByRole("treeitem").filter({ hasText: fileAName }).click();
    await page.getByRole("button", { name: "原文", exact: true }).click();
    await expect(sourceEditor).toHaveValue(new RegExp(conflictMarker));
    await expect(page.getByText("版本冲突（本地草稿已保留）").first()).toBeVisible();
    // Wait past the 700ms auto-save debounce and verify collaborator's body on server was NEVER overwritten
    await page.waitForTimeout(1100);
    await expect(page.getByText("版本冲突（本地草稿已保留）").first()).toBeVisible();
    const serverDocAfter2Reopens = await (
      await context.request.get(`/api/workspace/scripts/${docA.id}`, { headers })
    ).json();
    assert.match(serverDocAfter2Reopens.body_md, /> 协作者远端备注/);
    assert.doesNotMatch(serverDocAfter2Reopens.body_md, new RegExp(conflictMarker));

    // A second session advances the canvas revision before a new episode is synced.
    // The script must already be committed when the canvas PUT conflicts, and the local episode must stay recoverable.
    await page.getByRole("treeitem").filter({ hasText: fileBName }).dblclick();
    await expect(page.getByRole("tab", { selected: true }).filter({ hasText: fileBName })).toBeVisible();
    const cachedDocB = await (await context.request.get(`/api/workspace/scripts/${docB.id}`, { headers })).json();
    const documentPane = page.locator(".fm-md-editor");
    await documentPane.getByRole("button", { name: "原文", exact: true }).click();
    const unsavedDirectorNote = "这条本地导演草稿必须保留";
    failDocBSave = true;
    await sourceEditor.fill(`${cachedDocB.body_md}\n> ${unsavedDirectorNote}`);
    const updatedDocB = await context.request.put(`/api/workspace/scripts/${docB.id}`, {
      headers,
      data: {
        expected_revision: cachedDocB.revision,
        body_md: `${cachedDocB.body_md}\n\n### S02 雨巷 夜 外\n| 镜号 | 场次 | 运镜 | 时长 | 画面 | 台词 |\n| --- | --- | --- | --- | --- | --- |\n| 01 | S02 | 固定 | 5s | 路灯倒映在水洼中 | |\n\n### S03 天台 夜 外\n陌生人：雨终于停了。`,
      },
    });
    assert.equal(updatedDocB.status(), 200, await updatedDocB.text());
    await page.getByRole("button", { name: "用于本集制作" }).click();
    await expect(documentPane.getByRole("alert")).toContainText("服务器新版本冲突");
    await expect(sourceEditor).toHaveValue(new RegExp(unsavedDirectorNote));
    await expect(directorSync).toHaveCount(0);
    failDocBSave = false;
    await documentPane.getByRole("button", { name: "读取服务器最新版" }).click();
    await expect(sourceEditor).toHaveValue(/路灯倒映在水洼中/);
    await documentPane.getByRole("button", { name: "富文本", exact: true }).click();
    const beforeDirectorConflict: Project = await (
      await context.request.get(`/api/canvases/${canvasA.id}`, { headers })
    ).json();
    const competingSave = await context.request.put(`/api/canvases/${canvasA.id}/document`, {
      headers,
      data: { title: `${beforeDirectorConflict.title}·协作者`, document: beforeDirectorConflict.document, expected_revision: beforeDirectorConflict.revision },
    });
    assert.equal(competingSave.status(), 200, await competingSave.text());
    await page.getByRole("button", { name: "用于本集制作" }).click();
    await expect(directorSync).toBeVisible();
    const directorCanvasConflict = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().includes(`/api/canvases/${canvasA.id}/document`));
    await directorSync.getByRole("button", { name: "保存并进入导演台" }).click();
    assert.equal((await directorCanvasConflict).status(), 409);
    await expect(directorSync.getByRole("alert")).toContainText("剧本已保存，画布保存失败");
    await expect(page.getByRole("tab", { name: "文档", exact: true })).toHaveAttribute("aria-selected", "true");
    const stampedDocB = await (await context.request.get(`/api/workspace/scripts/${docB.id}`, { headers })).json();
    assert.match(stampedDocB.body_md, /<!-- fm-shot:sh_[a-f0-9]+ -->/);
    const recoveredEpisode = await page.evaluate(({ id }) => {
      const editor = sessionStorage.getItem("fm-canvas-editor");
      const key = Object.keys(localStorage).find((item) => item.startsWith("fm-canvas-") && item.endsWith(`-${id}-${editor}`));
      return key ? JSON.parse(localStorage.getItem(key) ?? "null")?.draft?.document?.director : null;
    }, { id: canvasA.id });
    assert.equal(recoveredEpisode?.script_id, docB.id);
    assert.equal(recoveredEpisode?.script_revision, stampedDocB.revision);
    await directorSync.getByRole("button", { name: "关闭同步窗口" }).click();
    await expect(documentPane.getByRole("button", { name: "在导演台查看 S02-01", exact: true })).toBeVisible();
    await documentPane.getByRole("button", { name: "在导演台查看 S03-01", exact: true }).click();
    await expect(director.getByRole("button", { name: /^S03-01/ })).toHaveAttribute("aria-pressed", "true");
    await directorTab.click();
    await director.getByRole("button", { name: "保存并确认顺序" }).click();
    await expect(director.getByRole("alert")).toContainText("保存冲突");
    await page.goto(editPath);
    await expect(page.locator(".canvas-header")).toContainText("保存冲突");
    await directorTab.click();
    await expect(director.getByRole("button", { name: "保存并确认顺序" })).toBeVisible();
    await expect(director.getByRole("button", { name: "顺序已确认" })).toHaveCount(0);

    const recoveryResponse = await context.request.post("/api/canvases", {
      headers,
      data: { title: `重试本集_${runTag}` },
    });
    assert.equal(recoveryResponse.status(), 200);
    const recoveryCanvas: Project = await recoveryResponse.json();
    const recoverySave = `/api/canvases/${recoveryCanvas.id}/document`;
    const scriptPath = `/api/workspace/scripts/${docB.id}`;
    let reviewedRevision: number | undefined;
    await page.route(`**${recoverySave}`, async (route) => {
      if (route.request().method() === "PUT" && reviewedRevision === undefined) {
        const previous = await (await context.request.get(scriptPath, { headers })).json();
        const changed = await context.request.put(scriptPath, {
          headers,
          data: { expected_revision: previous.revision, body_md: `${previous.body_md}\n> 保存期间更新的备注` },
        });
        assert.equal(changed.status(), 200, await changed.text());
        reviewedRevision = (await changed.json()).revision;
      }
      await route.continue();
    });
    await page.goto(`/canvas/${recoveryCanvas.id}?workspace=${workspace}`);
    await page.getByRole("tab", { name: "文档", exact: true }).click();
    await page.getByRole("treeitem").filter({ hasText: fileBName }).dblclick();
    await page.getByRole("button", { name: "用于本集制作" }).click();
    await directorSync.getByRole("button", { name: "保存并进入导演台" }).click();
    await expect(directorSync.getByRole("alert")).toContainText("主剧本已更新，请重新预览后同步");
    await directorSync.getByRole("button", { name: "关闭同步窗口" }).click();
    await page.getByRole("button", { name: "更新本集分镜" }).click();
    await directorSync.getByRole("button", { name: "保存并进入导演台" }).click();
    await expect(directorTab).toHaveAttribute("aria-selected", "true");
    const recovered: Project = await (
      await context.request.get(`/api/canvases/${recoveryCanvas.id}`, { headers })
    ).json();
    assert.equal(recovered.document.director?.script_revision, reviewedRevision);
    assert.equal(recovered.revision, recoveryCanvas.revision + 1);
    await page.unroute(`**${recoverySave}`);

    console.log(
      "PASS script-workspace-fusion-browser: mobile layout, directory rename, search and replace, rich and source jumps, director navigation and order, and script and director draft conflict recovery",
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
