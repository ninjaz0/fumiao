/** Compare the pinned canvas page and the Next list using one real session and API. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  chromium,
  expect,
  type BrowserContext,
  type Page,
  type Route,
} from "@playwright/test";
import sharp from "sharp";
import { tree } from "./verify-homepage.js";

export async function verifyCanvasList(
  original: string,
  web: string,
  adminCookie: string,
  runtime: string,
) {
  async function request(
    path: string,
    {
      cookie = adminCookie,
      method = "GET",
      workspace,
      body,
      status = 200,
    }: {
      cookie?: string;
      method?: string;
      workspace?: number;
      body?: unknown;
      status?: number;
    } = {},
  ) {
    const response = await fetch(web + path, {
      method,
      headers: {
        cookie,
        Origin: web,
        ...(workspace ? { "X-Workspace-Id": String(workspace) } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert.equal(response.status, status, `${method} ${path}`);
    return response;
  }

  const admin = await (await request("/api/state")).json();
  const team = await (
    await request("/api/workspaces", {
      method: "POST",
      body: { name: "画布对照团队", members: [] },
    })
  ).json();
  const workspace: number = team.id;
  const name = "canvas-member";
  const password = randomBytes(18).toString("hex");
  const invitation = await (
    await request("/api/invite-codes", {
      method: "POST",
      body: { name: "画布对照成员", team_id: workspace },
    })
  ).json();
  const registered = await request("/api/register", {
    cookie: "",
    method: "POST",
    body: {
      name,
      nickname: "画布对照成员",
      password,
      code: invitation.code,
    },
  });
  const cookie = registered.headers.get("set-cookie")!.split(";")[0];
  const member = await (await request("/api/state", { cookie })).json();
  const installSession = (context: BrowserContext, session: string) =>
    context.addCookies([
      {
        name: "fm_session",
        value: session.slice("fm_session=".length),
        url: web,
        httpOnly: true,
        sameSite: "Strict",
      },
    ]);

  const create = async (body: object, id = workspace) =>
    (
      await request("/api/canvases", { method: "POST", body, workspace: id })
    ).json();
  const remove = (id: string) =>
    request("/api/canvases/" + id, { method: "DELETE", workspace });
  const list = async () =>
    (await request("/api/canvases", { workspace, cookie })).json();
  const plainTitle = "Alpha 空白画布";
  const coverTitle = "Beta 素材封面";
  const templateTitle = "产品展示";
  const emptyWorkspace = admin.workspace_id;
  const path =
    "/canvas?label=%E7%94%BB%E5%B8%83&label=again&workspace=00" +
    workspace +
    "#list";
  const url = web + path.replace("workspace=00", "workspace=");
  const out = resolve(".runtime-advanced/canvas-list-parity");
  await mkdir(out, { recursive: true });

  // Render whole tiles when an interaction invalidates only part of a rounded
  // edge. This keeps Chromium's rasterization independent of paint timing.
  const browser = await chromium.launch({ args: ["--disable-partial-raster"] });
  const report: { name: string; differentPixels: number }[] = [];
  const errors: string[] = [];
  let passed = false;
  try {
    async function openPair(
      viewport: { width: number; height: number },
      dark: boolean,
      session = cookie,
    ) {
      const pages = await Promise.all(
        [true, false].map(async (reference) => {
          const context = await browser.newContext({
            viewport,
            deviceScaleFactor: 1,
            timezoneId: "Asia/Shanghai",
            locale: "zh-CN",
            reducedMotion: "reduce",
            colorScheme: "light",
          });
          await installSession(context, session);
          await context.addInitScript(
            (theme) => {
              if (localStorage.getItem("fumiao-appearance") === null)
                localStorage.setItem("fumiao-appearance", theme);
            },
            dark ? "dark" : "light",
          );
          await context.route("**/*", async (route) => {
            const incoming = new URL(route.request().url());
            if (incoming.origin !== web) return route.abort();
            // Use the actual pinned Python HTML for the reference navigation.
            // Both contexts keep one browser origin, so API writes pass real CSRF
            // checks and both see the same session, private media and database.
            if (
              reference &&
              route.request().isNavigationRequest() &&
              (incoming.pathname === "/canvas" ||
                incoming.pathname.startsWith("/canvas/"))
            ) {
              const response = await route.fetch({
                url: original + incoming.pathname + incoming.search,
                maxRedirects: 0,
              });
              return route.fulfill({ response });
            }
            return route.continue();
          });
          const page = await context.newPage();
          page.on("pageerror", (error) => errors.push(error.message));
          page.on("console", (message) => {
            if (
              message.type() === "error" &&
              !message
                .text()
                .startsWith(
                  "Failed to load resource: the server responded with a status of",
                )
            )
              errors.push(message.text());
          });
          return page;
        }),
      );
      return pages;
    }

    async function compare(pages: Page[], name: string, dark: boolean) {
      for (const page of pages) {
        await expect(page).toHaveTitle("画布 · 弗淼 AIGC");
        await expect(page.locator("html")).toHaveAttribute(
          "data-theme",
          dark ? "dark" : "light",
        );
        await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
          "content",
          dark ? "#171918" : "#f8f9fa",
        );
      }
      await Promise.all(
        pages.map((page) =>
          page.evaluate(async () => {
            await document.fonts.ready;
            await Promise.all(
              document
                .getAnimations()
                .map((animation) => animation.finished.catch(() => {})),
            );
            await new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            );
            // Chromium can briefly retain compositing layers after layout or a
            // transition. Sample the settled pages at the same point.
            await new Promise((resolve) => setTimeout(resolve, 500));
          }),
        ),
      );
      const [reference, migrated] = await Promise.all(pages.map(tree));
      await writeFile(
        join(out, name + "-dom.json"),
        JSON.stringify({ reference, migrated }, null, 2),
      );
      assert.deepEqual(migrated, reference, name + " DOM");
      const images = await Promise.all(
        pages.map(async (page, index) => {
          const png = await page.screenshot({
            path: join(out, name + (index ? "-react.png" : "-original.png")),
            fullPage: true,
            animations: "disabled",
          });
          return sharp(png)
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
        }),
      );
      const [left, right] = images;
      assert.deepEqual(right.info, left.info, name + " screenshot dimensions");
      let differentPixels = 0;
      for (let i = 0; i < left.data.length; i += 4)
        if (left.data.readUInt32LE(i) !== right.data.readUInt32LE(i))
          differentPixels++;
      report.push({ name, differentPixels });
      assert.equal(differentPixels, 0, name + " pixels");
      console.log("PASS canvas list " + name + " DOM and pixels");
    }

    const viewports = [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ];
    // Model a slow script download. The original sets theme-color in the head
    // before the canvas bundle runs, so the loading screen must already match.
    const coldPages = await openPair(viewports[1], true);
    let releaseScripts!: () => void;
    const scriptsReady = new Promise<void>((resolve) => {
      releaseScripts = resolve;
    });
    try {
      await Promise.all(
        coldPages.map(async (page, index) => {
          await page.route(
            index === 0 ? "**/static/canvas.js?*" : "**/_next/static/**/*.js",
            async (route) => {
              await scriptsReady;
              await route.continue();
            },
          );
          await page.goto(web + "/canvas", { waitUntil: "commit" });
          await expect(page.locator(".canvas-loading img")).toHaveAttribute(
            "width",
            "48",
          );
        }),
      );
      await compare(coldPages, "390-dark-before-hydration", true);
      await Promise.all(
        coldPages.map(async (page) => {
          const peer = await page.context().newPage();
          await peer.goto(web + "/health");
          await peer.evaluate(() =>
            localStorage.setItem("fumiao-appearance", "light"),
          );
          await peer.close();
        }),
      );
      await compare(coldPages, "390-light-before-hydration", false);
    } finally {
      releaseScripts();
      await Promise.all(coldPages.map((page) => page.context().close()));
    }
    for (const viewport of viewports) {
      for (const dark of [false, true]) {
        const pages = await openPair(viewport, dark);
        const name = viewport.width + (dark ? "-dark" : "-light");
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        try {
          await Promise.all(
            pages.map(async (page) => {
              await page.route(
                "**/api/canvases",
                async (route) => {
                  await gate;
                  await route.continue();
                },
                { times: 1 },
              );
              await page.goto(web + "/canvas");
              await expect(page.getByText("正在加载画布")).toBeVisible();
              await expect(page).toHaveURL(
                web + "/canvas?workspace=" + workspace,
              );
            }),
          );
          await compare(pages, name + "-loading", dark);
          release();
          for (const page of pages)
            await expect(
              page.getByRole("heading", { name: "从一张画布开始" }),
            ).toBeVisible();
          await compare(pages, name + "-empty", dark);
        } finally {
          release();
          await Promise.all(pages.map((page) => page.context().close()));
        }
      }
    }

    const plain = await create({ title: plainTitle });
    const template = await create({ template: "product", ratio: "9:16" });
    assert.equal(template.title, templateTitle);
    assert.equal(template.document.shots.length, 6);
    const cover = await create({ title: coverTitle });
    const privateCanvas = await create(
      { title: "私有空间画布" },
      emptyWorkspace,
    );
    const png = await sharp({
      create: { width: 32, height: 24, channels: 3, background: "#dd6044" },
    })
      .png()
      .toBuffer();
    const upload = await fetch(web + "/api/assets", {
      method: "POST",
      headers: {
        cookie: adminCookie,
        Origin: web,
        "X-Workspace-Id": String(workspace),
        "Content-Type": "image/png",
      },
      body: new Uint8Array(png),
    });
    assert.equal(upload.status, 200);
    const image: string = (await upload.json()).id;

    // Seed a video result in the isolated store without invoking generation.
    const video = randomBytes(16).toString("hex");
    const videoPath = join(runtime, "data", "objects", video);
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=32x24:r=24:d=0.5",
      "-an",
      "-c:v",
      "libvpx-vp9",
      "-f",
      "webm",
      videoPath,
    ]);
    const db = new DatabaseSync(join(runtime, "data", "studio.sqlite"));
    try {
      db.prepare(
        `INSERT INTO media(id,kind,size,mime,w,h,owner,workspace)
                  VALUES (?,'video',?,'video/webm',32,24,?,?)`,
      ).run(video, (await stat(videoPath)).size, admin.me.id, workspace);
    } finally {
      db.close();
    }
    await request(`/api/canvases/${cover.id}/document`, {
      method: "PUT",
      workspace,
      body: {
        expected_revision: cover.revision,
        title: coverTitle,
        document: {
          schemaVersion: 1,
          nodes: [
            { id: "cover-image", type: "image", x: 0, y: 0, media_id: image },
            { id: "cover-video", type: "video", x: 400, y: 0, media_id: video },
          ],
          edges: [],
        },
      },
    });
    const listing = await list();
    assert.ok(
      listing.templates.some(
        (value: { id: string; shots: number }) =>
          value.id === "product" && value.shots === 6,
      ),
    );
    assert.deepEqual(
      listing.projects.find((value: { id: string }) => value.id === cover.id)
        .covers,
      [
        { id: image, type: "image" },
        { id: video, type: "video" },
      ],
    );

    const card = (page: Page, title: string) =>
      page.locator(".project-card").filter({ hasText: title });
    async function populated(page: Page) {
      await expect(page.locator(".project-card")).toHaveCount(3);
      await expect(card(page, templateTitle)).toContainText("13 个节点");
      await expect(page.getByText("私有空间画布")).toHaveCount(0);
      await expect
        .poll(() =>
          page.locator(".cover-grid").evaluate((grid) => {
            const img = grid.querySelector("img")!;
            const video = grid.querySelector("video")!;
            return (
              img.naturalWidth > 0 &&
              video.readyState >= 2 &&
              video.currentTime >= 0.05
            );
          }),
        )
        .toBe(true);
    }

    for (const viewport of viewports) {
      for (const dark of [false, true]) {
        const name = viewport.width + (dark ? "-dark" : "-light");
        const pages = await openPair(viewport, dark, adminCookie);
        try {
          await Promise.all(
            pages.map(async (page) => {
              const state = page.waitForRequest("**/api/state");
              const listing = page.waitForRequest("**/api/canvases");
              const document = await page.goto(web + path);
              assert.ok(document?.ok());
              assert.equal(
                (await state).headers()["x-workspace-id"],
                "00" + workspace,
              );
              assert.equal(
                (await listing).headers()["x-workspace-id"],
                String(workspace),
              );
              await expect(page).toHaveURL(url);
              await expect(
                page.getByRole("link", { name: "返回工作台" }),
              ).toHaveAttribute("href", "/studio?workspace=" + workspace);
              await populated(page);
            }),
          );
          await compare(pages, name + "-populated", dark);
          for (const page of pages) {
            const search = page.getByRole("textbox", { name: "搜索画布" });
            await search.fill("aLpHa");
            await expect(page.locator(".project-card")).toHaveCount(1);
            await expect(card(page, plainTitle)).toBeVisible();
          }
          await compare(pages, name + "-search", dark);
          for (const page of pages) {
            const search = page.getByRole("textbox", { name: "搜索画布" });
            await search.fill("missing");
            await expect(page.locator(".project-grid")).toBeEmpty();
            await search.fill("");
            await populated(page);
            const project = card(page, plainTitle);
            const button = project.getByRole("button", {
              name: "删除画布 " + plainTitle,
            });
            await button.focus();
            await expect(project.locator(".project-actions")).toHaveCSS(
              "opacity",
              "1",
            );
            await page.keyboard.press("Enter");
            await expect(page.getByRole("dialog")).toBeVisible();
          }
          await compare(pages, name + "-delete-dialog", dark);
          for (const page of pages) {
            const dialog = page.getByRole("dialog");
            const button = card(page, plainTitle).getByRole("button", {
              name: "删除画布 " + plainTitle,
            });
            await page.keyboard.press("Escape");
            await expect(dialog).toHaveCount(0);
            await button.click();
            await page.mouse.click(2, 2);
            await expect(dialog).toHaveCount(0);
            await button.click();
            await dialog.getByRole("button", { name: "取消" }).click();
            await expect(dialog).toHaveCount(0);
            await expect(card(page, plainTitle)).toBeVisible();
          }
        } finally {
          await Promise.all(pages.map((page) => page.context().close()));
        }
      }
    }

    const pages = await openPair(viewports[0], false);
    try {
      async function mutation(
        page: Page,
        path: string,
        method: string,
        click: () => Promise<void>,
        status = 200,
      ) {
        const response = page.waitForResponse(
          (res) =>
            new URL(res.url()).pathname === path &&
            res.request().method() === method,
        );
        await click();
        const res = await response;
        const sent = res.request();
        assert.equal(sent.headers()["x-workspace-id"], String(workspace));
        assert.deepEqual(sent.postDataJSON(), method === "POST" ? {} : null);
        assert.equal(
          sent.headers()["content-type"],
          method === "POST" ? "application/json" : undefined,
        );
        assert.equal((await sent.allHeaders()).origin, web);
        assert.equal(res.status(), status);
      }

      async function openedProject(page: Page) {
        await page.waitForURL(
          (url) =>
            /^\/canvas\/[a-f0-9]{32}$/.test(url.pathname) &&
            url.search === "?workspace=" + workspace,
        );
        const id = new URL(page.url()).pathname.split("/").at(-1);
        return (
          await request("/api/canvases/" + id, { cookie, workspace })
        ).json();
      }

      for (const page of pages) {
        await page.goto(url);
        await populated(page);
        await expect(
          page.getByRole("button", { name: "删除画布 " + plainTitle }),
        ).toHaveCount(0);
        const canvas = card(page, templateTitle);
        await canvas
          .getByRole("link", { name: "打开画布 " + templateTitle })
          .click();
        await expect(page).toHaveURL(
          web + `/canvas/${template.id}?workspace=${workspace}`,
        );
        await expect(
          page.getByRole("textbox", { name: "画布名称" }),
        ).toHaveValue(templateTitle);
        await page.getByRole("button", { name: "项目菜单" }).click();
        await expect(
          page.getByRole("button", { name: "下载画布文档" }),
        ).toBeVisible();
        await page
          .locator(".project-menu")
          .getByRole("button", { name: "所有画布" })
          .click();
        await expect(page).toHaveURL(web + "/canvas?workspace=" + workspace);
        await populated(page);

        await mutation(page, "/api/canvases", "POST", () =>
          page.getByRole("button", { name: "新建画布" }).click(),
        );
        const blank = await openedProject(page);
        assert.equal(blank.title, "未命名画布");
        assert.deepEqual(blank.document.nodes, []);

        await page.goto(url);
        await mutation(
          page,
          `/api/canvases/${template.id}/duplicate`,
          "POST",
          () =>
            page
              .getByRole("button", { name: "复制画布 " + templateTitle })
              .click(),
        );
        const duplicate = await openedProject(page);
        assert.equal(duplicate.title, templateTitle + " 副本");
        assert.deepEqual(duplicate.document, {
          ...template.document,
          nodes: template.document.nodes.map((node: { type: string }) =>
            node.type === "image" || node.type === "video"
              ? { ...node, use_media: true }
              : node,
          ),
        });

        await page.goto(url);
        await page
          .getByRole("button", { name: "删除画布 " + duplicate.title })
          .click();
        await mutation(page, `/api/canvases/${duplicate.id}`, "DELETE", () =>
          page
            .getByRole("dialog")
            .getByRole("button", { name: "删除画布" })
            .click(),
        );
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(card(page, duplicate.title)).toHaveCount(0);
        assert.ok(
          !(await list()).projects.some(
            (project: { id: string }) => project.id === duplicate.id,
          ),
        );
        await remove(blank.id);

        await page.reload();
        await populated(page);
        await page.getByRole("link", { name: "工作台", exact: true }).click();
        await expect(page).toHaveURL(web + "/studio?workspace=" + workspace);
        await page.locator('nav button[data-nav="canvas"]').click();
        await expect(page).toHaveURL(web + "/canvas?workspace=" + workspace);
        await populated(page);
      }

      for (const page of pages) {
        await page.goto(web + "/canvas?workspace=invalid");
        await expect(
          page.getByRole("heading", { name: "画布暂时无法打开" }),
        ).toBeVisible();
        await expect(
          page.getByRole("link", { name: "返回画布列表" }),
        ).toHaveAttribute("href", "/canvas?workspace=invalid");
        await expect(page.locator(".canvas-error p")).toHaveText(
          "工作区标识无效",
        );
      }
      await compare(pages, "1440-light-state-error", false);

      for (const page of pages) {
        const fail = (route: Route) =>
          route.fulfill({
            status: 503,
            json: { detail: "测试：画布请求失败" },
          });
        await page.route("**/api/canvases", fail, { times: 1 });
        await page.goto(url);
        await expect(page.locator("#canvas-root [role=alert]")).toHaveText(
          "测试：画布请求失败",
        );
      }
      await compare(pages, "1440-light-list-error", false);
      for (const page of pages) {
        await page.reload();
        await populated(page);
        for (const [endpoint, label] of [
          ["/api/canvases", "新建画布"],
          [
            `/api/canvases/${template.id}/duplicate`,
            "复制画布 " + templateTitle,
          ],
        ]) {
          await page.route(
            "**" + endpoint,
            (route) =>
              route.fulfill({
                status: 409,
                json: { detail: "测试：" + label + "失败" },
              }),
            { times: 1 },
          );
          const button = page.getByRole("button", { name: label });
          await button.click();
          await expect(page.locator("#canvas-root [role=alert]")).toHaveText(
            "测试：" + label + "失败",
          );
          await expect(button).toBeEnabled();
          await expect(page).toHaveURL(url);
        }
      }
      assert.deepEqual(
        await tree(pages[1]),
        await tree(pages[0]),
        "mutation failure DOM",
      );

      const own = await (
        await request("/api/canvases", {
          cookie,
          workspace,
          method: "POST",
          body: { title: "成员自己的画布" },
        })
      ).json();
      for (const page of pages) {
        await page.reload();
        const label = "删除画布 " + own.title;
        await page.getByRole("button", { name: label }).click();
        await page.route(
          `**/api/canvases/${own.id}`,
          (route) =>
            route.fulfill({
              status: 409,
              json: { detail: "测试：删除画布失败" },
            }),
          { times: 1 },
        );
        const dialog = page.getByRole("dialog");
        await dialog.getByRole("button", { name: "删除画布" }).click();
        await expect(page.locator("#canvas-root [role=alert]")).toHaveText(
          "测试：删除画布失败",
        );
        await expect(dialog).toBeVisible();
        await dialog.getByRole("button", { name: "关闭" }).click();
        await expect(card(page, own.title)).toBeVisible();
      }

      for (const page of pages) {
        // Revoke the real session between document selection and either client
        // request. State 401 redirects, while list 401 leaves the original alert.
        for (const endpoint of ["/api/state", "/api/canvases"]) {
          const login = await request("/api/login", {
            cookie: "",
            method: "POST",
            body: { name, password },
          });
          const revoked = login.headers.get("set-cookie")!.split(";")[0];
          await installSession(page.context(), revoked);
          await page.route(
            "**" + endpoint,
            async (route) => {
              await request("/api/logout", { cookie: revoked, method: "POST" });
              await route.continue();
            },
            { times: 1 },
          );
          const rejected = page.waitForResponse(
            (res) => new URL(res.url()).pathname === endpoint,
          );
          const document = await page.goto(web + "/canvas", {
            waitUntil: "commit",
          });
          assert.equal(document?.status(), 200);
          assert.equal((await rejected).status(), 401);
          if (endpoint === "/api/state") {
            await expect(page).toHaveURL(web + "/studio");
          } else {
            await expect(page).toHaveURL(
              web + "/canvas?workspace=" + workspace,
            );
            await expect(page.locator(".project-list [role=alert]")).toHaveText(
              "请先登录",
            );
            await expect(page.locator(".project-card")).toHaveCount(0);
          }
          const fallback = await request("/canvas", { cookie: revoked });
          assert.equal(
            await fallback.text(),
            await (await fetch(original + "/canvas")).text(),
          );
        }

        await installSession(page.context(), cookie);
        await page.goto(web + "/canvas?workspace=" + emptyWorkspace);
        await expect(page.locator(".canvas-error p")).toHaveText(
          "无法访问这个工作区",
        );
        await expect(page.locator(".project-card")).toHaveCount(0);
        await page.goto(url);
        await expect(card(page, own.title)).toBeVisible();
      }

      await request("/api/canvases", {
        cookie,
        workspace: emptyWorkspace,
        status: 403,
      });
      await request("/api/canvases/" + privateCanvas.id, {
        cookie,
        status: 404,
      });
      await request("/api/canvases/" + privateCanvas.id + "/duplicate", {
        cookie,
        method: "POST",
        body: {},
        status: 404,
      });
      await request("/api/canvases/" + plain.id, {
        cookie,
        workspace,
        method: "DELETE",
        status: 403,
      });
      const beforeRevoke = await (
        await request("/api/canvases", { workspace })
      ).json();
      await request("/api/workspaces/" + workspace, {
        method: "PATCH",
        body: {
          name: team.name,
          members: [],
          expected_revision: team.revision,
        },
      });
      await request("/media/" + image, { cookie, status: 404 });

      for (const page of pages) {
        const alert = page.locator(".project-list [role=alert]");
        await mutation(
          page,
          "/api/canvases",
          "POST",
          () => page.getByRole("button", { name: "新建画布" }).click(),
          403,
        );
        await expect(alert).toHaveText("无法访问这个工作区");
        await mutation(
          page,
          `/api/canvases/${plain.id}/duplicate`,
          "POST",
          () =>
            page
              .getByRole("button", { name: "复制画布 " + plainTitle })
              .click(),
          404,
        );
        await expect(alert).toHaveText("内容不存在或无权访问");
        await page
          .getByRole("button", { name: "删除画布 " + own.title })
          .click();
        const dialog = page.getByRole("dialog");
        await mutation(
          page,
          `/api/canvases/${own.id}`,
          "DELETE",
          () => dialog.getByRole("button", { name: "删除画布" }).click(),
          404,
        );
        await expect(dialog).toBeVisible();
        await dialog.getByRole("button", { name: "关闭" }).click();
        await expect(card(page, own.title)).toBeVisible();
        await page.reload();
        await expect(page.locator(".canvas-error p")).toHaveText(
          "无法访问这个工作区",
        );
      }
      await compare(pages, "1440-light-workspace-revoked", false);
      assert.deepEqual(
        (
          await (await request("/api/canvases", { workspace })).json()
        ).projects.map(({ id }: { id: string }) => id),
        beforeRevoke.projects.map(({ id }: { id: string }) => id),
        "rejected actions must leave the team list intact",
      );
      for (const page of pages) {
        await page.goto(web + "/canvas");
        await expect(page).toHaveURL(
          web +
            "/canvas?workspace=" +
            member.workspaces.find(
              ({ kind }: { kind: string }) => kind === "personal",
            ).id,
        );
        await expect(
          page.getByRole("heading", { name: "从一张画布开始" }),
        ).toBeVisible();
      }
    } finally {
      await Promise.all(pages.map((page) => page.context().close()));
    }
    assert.deepEqual(errors, [], "browser and CSP errors");
    passed = true;
    console.log(
      "PASS canvas list API contracts, Studio and editor navigation, create/copy/delete, workspace revocation and real session logout",
    );
  } finally {
    await browser.close();
    await writeFile(
      join(out, "report.json"),
      JSON.stringify({ passed, report }, null, 2),
    );
  }
}
