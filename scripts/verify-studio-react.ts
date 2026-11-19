/** Pinned HTML and the default React page use one temporary API and real browser origin. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { chromium, expect, type Page, type Request } from "@playwright/test";
import sharp from "sharp";
import { assertStudio } from "./studio-settings-browser.js";
import { tree } from "./verify-homepage.js";

const studio = "/studio";

function contract(request: Request) {
  return {
    path: new URL(request.url()).pathname,
    method: request.method(),
    workspace: request.headers()["x-workspace-id"],
    origin: request.headers().origin,
    json: request.postDataJSON(),
  };
}

function mutation(page: Page, path: string) {
  return page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === path &&
      response.request().method() !== "GET",
  );
}

export async function verifyStudioReact(
  original: string,
  web: string,
  adminCookie: string,
  directory: string,
) {
  async function call(
    path: string,
    body?: object,
    options: {
      cookie?: string;
      workspace?: number;
      method?: string;
      status?: number;
    } = {},
  ) {
    const response = await fetch(web + path, {
      method: options.method ?? (body ? "POST" : "GET"),
      headers: {
        cookie: options.cookie ?? adminCookie,
        Origin: web,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(options.workspace
          ? { "X-Workspace-Id": String(options.workspace) }
          : {}),
      },
      body: body && JSON.stringify(body),
    });
    assert.equal(
      response.status,
      options.status ?? 200,
      `${path}: ${await response.clone().text()}`,
    );
    return response;
  }
  // Enable the catalog and pause all generation dispatch in the temporary runtime.
  // The original has no live provider credentials.
  await writeFile(
    join(directory, "data", ".dispatch-paused"),
    "composer parity",
  );
  await writeFile(
    join(directory, "data", "flow.env"),
    "FUMIAO_FLOW_URL=http://127.0.0.1:1\nFUMIAO_FLOW_KEY=composer-fixture\n",
  );
  await writeFile(
    join(directory, "data", "openai.env"),
    "OPENAI_API_KEY=sk-composer-fixture\n",
  );
  const admin = await (await call("/api/state")).json();
  const team = await (
    await call("/api/workspaces", { name: "工作台对照团队", members: [] })
  ).json();
  const code = await (
    await call("/api/invite-codes", {
      name: "工作台对照成员",
      team_id: team.id,
    })
  ).json();
  const memberCredentials = {
    name: "studio-member",
    password: randomBytes(18).toString("hex"),
  };
  const memberCookie = (
    await call(
      "/api/register",
      { ...memberCredentials, nickname: "工作台对照成员", code: code.code },
      { cookie: "" },
    )
  ).headers
    .get("set-cookie")!
    .split(";")[0];
  await call("/api/admin/credits/adjust", {
    workspace: team.id,
    amount: 5000,
    note: "工作台对照",
    uid: randomUUID(),
  });
  await call(
    "/api/settings/prices",
    {
      expected_revision: admin.pricing.revision,
      values: Object.fromEntries(
        admin.pricing.items.map(
          ({ key, amount }: { key: string; amount: number | null }) => [
            key,
            amount ?? 10,
          ],
        ),
      ),
    },
    { method: "PUT" },
  );
  const png = await sharp({
    create: { width: 96, height: 96, channels: 3, background: "#5289b3" },
  })
    .png()
    .toBuffer();
  async function uploadFixture(path: string, filename: string, bytes: Buffer) {
    const response = await fetch(web + path, {
      method: "POST",
      body: new Uint8Array(bytes),
      headers: {
        cookie: adminCookie,
        Origin: web,
        "X-Workspace-Id": String(team.id),
        "X-File-Name": filename,
      },
    });
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()) as { id: string };
  }
  const image = await uploadFixture("/api/assets", "studio-fixture.png", png);
  const uploadedImage = await uploadFixture(
    "/api/assets",
    "library-fixture.png",
    png,
  );
  const disposableImage = await uploadFixture(
    "/api/assets",
    "disposable.png",
    png,
  );
  const videoPath = join(directory, "library-video.mp4");
  const audioPath = join(directory, "library-audio.wav");
  execFileSync("ffmpeg", [
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x527a61:s=640x360:r=24:d=3",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    videoPath,
  ]);
  execFileSync("ffmpeg", [
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=24000:duration=3",
    audioPath,
  ]);
  const video = await readFile(videoPath);
  const audio = await readFile(audioPath);
  const uploadVideo = (filename: string) =>
    uploadFixture("/api/h3/references?kind=video", filename, video);
  const uploadAudio = (filename: string) =>
    uploadFixture("/api/h3/references?kind=audio", filename, audio);
  const videoResult = await uploadVideo("video-result.mp4");
  const audioResult = await uploadAudio("audio-result.wav");
  const uploadedVideo = await uploadVideo("video-upload.mp4");
  const uploadedAudio = await uploadAudio("audio-upload.wav");
  const db = new DatabaseSync(join(directory, "data", "studio.sqlite"));
  const insert = db.prepare(
    "INSERT INTO jobs(uid,owner,kind,model,status,prompt,refs,ratio,quality,seconds,width,height,result,workspace,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  );
  const timestamp = Math.floor(Date.now() / 1000);
  const job = (
    status: string,
    prompt: string,
    kind = "video",
    media: string | null = null,
    workspace = team.id,
    refs: string[] = [],
    created = timestamp,
  ) =>
    Number(
      insert.run(
        randomUUID(),
        admin.me.id,
        kind,
        kind === "audio"
          ? "breeze-tts-2"
          : kind === "image"
            ? "muse-image"
            : "MiniMax H3",
        status,
        prompt,
        JSON.stringify(refs),
        "16:9",
        480,
        5,
        848,
        480,
        media,
        workspace,
        created,
        timestamp,
      ).lastInsertRowid,
    );
  const queued = job("queued", "队列权限样本");
  const completed = job("done", "图片记录 <样本>", "image", image.id);
  const generatedVideo = job(
    "done",
    "视频 <Picture 1> & <Picture 2>",
    "video",
    videoResult.id,
    team.id,
    [uploadedImage.id],
    timestamp - 86_400,
  );
  db.prepare("UPDATE jobs SET sampling_steps=32, seed=1987 WHERE id=?").run(
    generatedVideo,
  );
  const failed = job("failed", "失败样本", "video");
  const generatedAudio = job(
    "done",
    "朗读内容 <原文>",
    "audio",
    audioResult.id,
  );
  db.prepare("UPDATE jobs SET audio_settings=? WHERE id=?").run(
    JSON.stringify({ instruction: "自然朗读" }),
    generatedAudio,
  );
  const remoteJob = job(
    "queued",
    "个人空间私有任务",
    "video",
    null,
    admin.workspace_id,
  );
  // First-view empty fixtures use a separate workspace from the private job.
  const emptyTeam = await (
    await call("/api/workspaces", { name: "空工作区", members: [] })
  ).json();
  const out = resolve(".runtime-advanced/studio-react-parity");
  await mkdir(out, { recursive: true });
  const browser = await chromium.launch({ args: ["--disable-partial-raster"] });
  const tested: { name: string; differentPixels: number }[] = [];
  const errors: string[] = [];
  const parityFailures: string[] = [];
  let passed = false;

  async function pair({
    width = 1440,
    height = 900,
    dark = false,
    cookie = adminCookie,
  } = {}) {
    return Promise.all(
      [true, false].map(async (reference) => {
        const context = await browser.newContext({
          viewport: { width, height },
          deviceScaleFactor: 1,
          reducedMotion: "reduce",
          colorScheme: "light",
          locale: "zh-CN",
          timezoneId: "Asia/Shanghai",
        });
        if (cookie)
          await context.addCookies([
            {
              name: "fm_session",
              value: cookie.split("=")[1],
              url: web,
              httpOnly: true,
              sameSite: "Strict",
            },
          ]);
        await context.addInitScript(
          (theme) => {
            if (!localStorage.getItem("fumiao-appearance"))
              localStorage.setItem("fumiao-appearance", theme);
          },
          dark ? "dark" : "light",
        );
        await context.route("**/*", async (route) => {
          const incoming = new URL(route.request().url());
          if (incoming.origin !== web) return route.abort();
          if (
            reference &&
            incoming.pathname === "/studio" &&
            route.request().isNavigationRequest()
          ) {
            const response = await route.fetch({
              url: original + incoming.pathname + incoming.search,
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
  }
  async function close(pages: Page[]) {
    await Promise.all(pages.map((page) => page.context().close()));
  }
  async function open(pages: Page[], workspace: number) {
    await Promise.all(
      pages.map((page) => page.goto(web + studio + "?workspace=" + workspace)),
    );
    await Promise.all(
      pages.map((page) => expect(page.locator(".home-view")).toBeVisible()),
    );
  }
  async function click(pages: Page[], selector: string) {
    await Promise.all(pages.map((page) => page.locator(selector).click()));
  }
  async function compare(pages: Page[], name: string, dark = false) {
    await Promise.all(
      pages.map(async (page) => {
        await expect(page.locator("html")).toHaveAttribute(
          "data-theme",
          dark ? "dark" : "light",
        );
        await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
          "content",
          dark ? "#171918" : "#f8f9fa",
        );
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise((resolve) => setTimeout(resolve, 350));
        });
      }),
    );
    const [reference, migrated] = await Promise.all(pages.map(tree));
    await writeFile(
      join(out, name + "-dom.json"),
      JSON.stringify({ reference, migrated }, null, 2),
    );
    try {
      assert.deepEqual(migrated, reference);
    } catch {
      parityFailures.push(name + " DOM");
      console.error("FAIL studio " + name + " DOM");
    }
    const overlays = await pages[0]
      .locator("#modal[open], #popover.open:not([hidden])")
      .count();
    const captures = [];
    for (const [index, page] of pages.entries()) {
      const screenshot = await page.screenshot({
        path: join(out, `${name}-${index ? "react" : "original"}.png`),
        // A full-page capture resizes Chromium and can reposition a fixed menu.
        fullPage: overlays === 0,
        animations: "disabled",
        caret: "initial",
      });
      captures.push(
        await sharp(screenshot)
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true }),
      );
    }
    const [before, after] = captures;
    if (JSON.stringify(after.info) !== JSON.stringify(before.info)) {
      parityFailures.push(name + " dimensions");
      return;
    }
    let differentPixels = 0;
    for (let offset = 0; offset < before.data.length; offset += 4)
      if (before.data.readUInt32LE(offset) !== after.data.readUInt32LE(offset))
        differentPixels++;
    tested.push({ name, differentPixels });
    if (differentPixels) {
      parityFailures.push(name + " pixels (" + differentPixels + ")");
      console.error("FAIL studio " + name + " pixels: " + differentPixels);
    } else if (!parityFailures.includes(name + " DOM")) {
      console.log("PASS studio " + name + " DOM and pixels");
    }
  }

  try {
    const landing = await fetch(web + studio, {
      headers: { cookie: adminCookie },
    });
    assert.match(landing.headers.get("content-security-policy")!, /'nonce-/);
    assert.doesNotMatch(
      await landing.text(),
      /src="\/static\/(studio|theme|flowpicker)\.js/,
    );
    assert.equal(
      (
        await fetch(web + "/compat-studio", {
          headers: { cookie: adminCookie, "x-fumiao-studio": "1" },
        })
      ).status,
      404,
    );
    async function inspectComposer(
      pages: Page[],
      label: string,
      dark: boolean,
    ) {
      const check = (name: string) =>
        compare(pages, label + "-composer-" + name, dark);
      const menu = (kind: string) =>
        Promise.all(
          pages.map(async (page) => {
            const trigger = page.locator(`.composer [data-menu="${kind}"]`);
            await trigger.scrollIntoViewIfNeeded();
            await page.evaluate(
              () =>
                new Promise<void>((resolve) =>
                  requestAnimationFrame(() =>
                    requestAnimationFrame(() => resolve()),
                  ),
                ),
            );
            await trigger.click();
            await expect(page.locator("#popover")).toBeVisible();
          }),
        );
      const item = (action: string, value?: string) =>
        click(
          pages,
          `#popover [data-act="${action}"]${value ? `[data-value="${value}"]` : ""}`,
        );
      const dismiss = async () => {
        await Promise.all(pages.map((page) => page.keyboard.press("Escape")));
        await Promise.all(
          pages.map((page) => expect(page.locator("#popover")).toBeHidden()),
        );
      };
      await open(pages, team.id);
      await menu("creation");
      await check("creation");
      await item("creation", "image");
      await menu("format");
      await check("image-format");
      await dismiss();
      await menu("duration");
      await check("image-quality");
      await item("image-quality", "high");
      await menu("creation");
      await item("creation", "audio");
      await Promise.all(
        pages.map((page) => expect(page.locator("#popover")).toBeHidden()),
      );
      await menu("duration");
      await check("audio-voice");
      await item("save-voice");
      await menu("creation");
      await item("creation", "video");
      await menu("image-model");
      await check("model-menu");
      await item("image-model", "flow:veo-3.1-quality-4s-landscape");
      await menu("format");
      await check("flow-format");
      await item("flow-mode", "i2v");
      await check("flow-i2v-validation");
      await dismiss();
      await menu("image-model");
      await item("image-model", "MiniMax H3");
      await menu("h3-mode");
      await check("h3-mode");
      await item("h3-mode", "frames");
      await check("h3-frames");
      await menu("advanced");
      await check("advanced");
      await click(pages, "#fast-mode");
      await item("save-seed");
      await menu("h3-mode");
      await item("h3-mode", "reference");
      await click(pages, ".reference-deck");
      await check("references");
      await item("choose-assets");
      await check("asset-picker");
      await click(
        pages,
        `[data-asset-key="asset:${uploadedImage.id}"] .asset-preview`,
      );
      await check("asset-picker-selected");
      await click(pages, '[data-act="finish-reference-picking"]');
      await menu("mention");
      await check("mention");
      await item("mention");
      await check("prompt-token");
    }

    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ]) {
      for (const dark of [false, true]) {
        const label = `${width}-${dark ? "dark" : "light"}`;
        const pages = await pair({ width, height, dark });
        const estimates = pages.map((page) => mutation(page, "/api/estimate"));
        await open(pages, emptyTeam.id);
        const [previous, current] = await Promise.all(estimates);
        assert.equal(current.status(), 200);
        assert.deepEqual(
          contract(current.request()),
          contract(previous.request()),
        );
        for (const page of pages)
          await expect(page.locator(".composer-estimate")).not.toBeEmpty();
        await compare(pages, label + "-empty", dark);
        await click(pages, 'nav [data-nav="library"]');
        await compare(pages, label + "-library-empty", dark);
        await click(pages, '[data-value="favorites"]');
        await compare(pages, label + "-library-favorites-empty", dark);
        await open(pages, team.id);
        for (const page of pages)
          await expect(page.locator(".composer-estimate")).not.toBeEmpty();
        await compare(pages, label + "-populated", dark);
        await click(pages, '.section-head [data-nav="library"]');
        await compare(pages, label + "-library-videos", dark);
        await click(pages, '[data-tab="images"]');
        await compare(pages, label + "-library-images", dark);
        await click(pages, `#job-${completed} .asset-preview`);
        await compare(pages, label + "-library-image-result", dark);
        await click(pages, '[data-act="locate"]');
        await compare(pages, label + "-library-located", dark);
        await click(pages, '[data-tab="audio"]');
        await compare(pages, label + "-library-audio", dark);
        await click(pages, 'nav [data-nav="queue"]');
        await compare(pages, label + "-queue", dark);
        if (width === 390) await click(pages, ".expand-button");
        await click(pages, ".workspace-switch");
        await compare(pages, label + "-spaces", dark);
        await Promise.all(
          pages.map(async (page) => {
            await page.keyboard.press("End");
            await expect(
              page.locator("#popover [role=option]").last(),
            ).toBeFocused();
            await page.keyboard.press("Escape");
            await expect(page.locator(".workspace-switch")).toBeFocused();
            await expect(page.locator("#popover")).toBeHidden();
          }),
        );
        await click(pages, ".account");
        await compare(pages, label + "-account", dark);
        await inspectComposer(pages, label, dark);
        await close(pages);
      }
    }

    const pages = await pair();
    await open(pages, team.id);
    const [, react] = pages;
    const favorite = `#job-${completed} [data-act=favorite]`;
    async function matchingWrite(path: string, selector: string, status = 200) {
      const results = [];
      for (const page of pages) {
        const response = mutation(page, path);
        await page.locator(selector).click();
        const received = await response;
        assert.equal(received.status(), status, path);
        results.push(contract(received.request()));
      }
      assert.deepEqual(results[1], results[0]);
      return results[0];
    }
    async function pauseLoadedMedia(
      selector: string,
      time: number,
      players = pages,
    ) {
      await Promise.all(
        players.map((page) =>
          page
            .locator(selector)
            .evaluate(async (media: HTMLMediaElement, time) => {
              // A paused, decoded frame gives native controls a stable state.
              await media.play();
              media.pause();
              if (media.currentTime === time && !media.seeking) return;
              const seeked = new Promise<void>((resolve) =>
                media.addEventListener("seeked", () => resolve(), {
                  once: true,
                }),
              );
              media.currentTime = time;
              await seeked;
            }, time),
        ),
      );
    }
    async function verifyAssetInteractions() {
      const previewUpload = (id: string) =>
        `[data-asset-key="asset:${id}"] .asset-preview`;
      const queuedCard = `#job-${queued}`;
      const videoCard = `#job-${generatedVideo}`;
      const audioCard = `#job-${generatedAudio}`;
      const batchDownload = "/api/assets/batch-download";
      const batchDelete = "/api/assets/batch-delete";
      const favoritesAPI = "/api/favorites";
      const escapeBoth = () =>
        Promise.all(pages.map((page) => page.keyboard.press("Escape")));

      await click(pages, 'nav [data-nav="library"]');
      await click(pages, previewUpload(uploadedVideo.id));
      await pauseLoadedMedia("#modal video", 0.1);
      await compare(pages, "library-uploaded-video-preview");
      await escapeBoth();
      for (const page of pages)
        await expect(
          page.locator(previewUpload(uploadedVideo.id)),
        ).toBeFocused();
      await click(pages, videoCard + " .asset-preview");
      await Promise.all(
        pages.map((page) =>
          expect(page.locator(".player-time")).toHaveText("00:00 / 00:03"),
        ),
      );
      await compare(pages, "library-video-player");
      await click(pages, ".player-mute");
      await click(pages, ".player-toggle");
      for (const page of pages) {
        await expect(page.locator(".player-toggle")).toHaveAttribute(
          "aria-label",
          "暂停",
        );
        await expect(page.locator(".detail-video")).toHaveJSProperty(
          "muted",
          true,
        );
      }
      await click(pages, ".player-toggle");
      for (const page of pages)
        await expect(page.locator(".player-toggle")).toHaveAttribute(
          "aria-label",
          "播放",
        );
      await Promise.all(
        pages.map(async (page) => {
          await page
            .locator(".seek-slider")
            .evaluate((slider: HTMLInputElement) => {
              slider.value = "1";
              slider.dispatchEvent(new Event("input", { bubbles: true }));
            });
          await expect(page.locator(".player-time")).toHaveText(
            "00:01 / 00:03",
          );
        }),
      );
      await click(pages, ".detail-copy summary");
      await click(pages, ".detail-references button");
      await compare(pages, "library-video-reference-preview");
      await click(pages, "#close-modal");
      await click(pages, '[data-act="next"]');
      await expect(react.locator(".detail-image")).toBeVisible();
      await click(pages, '[data-act="previous"]');
      await click(pages, '[data-act="previous"]');
      await compare(pages, "library-failed-detail");
      await click(pages, '[data-menu="detail-more"]');
      await compare(pages, "library-detail-menu");
      await click(pages, '#popover [data-act="delete"]');
      await compare(pages, "library-delete-job-confirm");
      await click(pages, "#back");
      await escapeBoth();
      await click(pages, '[data-tab="audio"]');
      await click(pages, previewUpload(uploadedAudio.id));
      await pauseLoadedMedia("#modal audio", 0);
      await compare(pages, "library-uploaded-audio-preview");
      await click(pages, '[data-act="close"]');
      await click(pages, audioCard + " .asset-preview");
      await pauseLoadedMedia(".detail-audio", 0);
      await compare(pages, "library-audio-detail");
      await escapeBoth();
      await Promise.all(
        pages.map((page) =>
          expect(page.locator(previewUpload(uploadedAudio.id))).toBeVisible(),
        ),
      );
      db.prepare("UPDATE jobs SET note=? WHERE id=?").run(
        "隔离状态刷新",
        failed,
      );
      await Promise.all(
        pages.map((page) =>
          expect(page.locator(previewUpload(uploadedAudio.id))).toHaveCount(0, {
            timeout: 10_000,
          }),
        ),
      );
      await compare(pages, "library-audio-grid-refresh");
      await click(pages, '[data-tab="audio"]');
      await Promise.all(
        pages.map((page) =>
          expect(page.locator(previewUpload(uploadedAudio.id))).toBeVisible(),
        ),
      );
      await assertStudio(react, true);

      await click(pages, '[data-tab="images"]');
      await click(pages, previewUpload(uploadedImage.id));
      await compare(pages, "library-uploaded-image-detail");
      const directFiles = [];
      for (const page of pages) {
        const download = page.waitForEvent("download");
        await page.locator(".detail-actions .download-action").click();
        const file = await download;
        assert.equal(
          new URL(file.url()).pathname + new URL(file.url()).search,
          `/media/${uploadedImage.id}?download=true`,
        );
        assert.match(file.suggestedFilename(), /\.png$/);
        directFiles.push(await readFile((await file.path())!));
      }
      assert.deepEqual(directFiles[0], directFiles[1]);
      const imageFavorite = ".image-detail .detail-favorite";
      assert.deepEqual(
        (await matchingWrite(favoritesAPI, imageFavorite)).json,
        { keys: ["asset:" + uploadedImage.id], favorite: true },
      );
      await compare(pages, "library-detail-favorited");
      assert.deepEqual(
        (await matchingWrite(favoritesAPI, imageFavorite)).json,
        { keys: ["asset:" + uploadedImage.id], favorite: false },
      );
      await click(pages, '[data-act="delete-image"]');
      await compare(pages, "library-delete-image-confirm");
      const imageDelete = "/api/assets/" + uploadedImage.id;
      assert.deepEqual(
        (await matchingWrite(imageDelete, "#confirm", 409)).json,
        null,
      );
      for (const page of pages) {
        await expect(page.locator("#modal")).toBeVisible();
        await expect(page.locator("#confirm")).toBeEnabled();
      }
      await compare(pages, "library-delete-referenced-image-error");
      await click(pages, "#back");
      await escapeBoth();
      await assertStudio(react, true);

      await click(pages, '[data-act="start-select"]');
      await compare(pages, "library-selection-empty");
      await click(pages, `#job-${completed} .asset-preview`);
      await compare(pages, "library-selection-mixed");
      await click(pages, '[data-act="select-all"]');
      await compare(pages, "library-selection-all");
      const bulk = [
        "job:" + completed,
        "asset:" + disposableImage.id,
        "asset:" + uploadedImage.id,
      ];
      assert.deepEqual(
        (await matchingWrite(favoritesAPI, '[data-act="batch-favorite"]')).json,
        { keys: bulk, favorite: true },
      );
      await click(pages, '[data-value="favorites"]');
      await compare(pages, "library-favorites-populated");
      const downloads = [];
      const archiveBodies = [];
      for (const page of pages) {
        await page.locator('[data-act="start-select"]').click();
        await page.locator('[data-act="select-all"]').click();
        const requested = mutation(page, batchDownload);
        const download = page.waitForEvent("download");
        await page.locator('[data-act="batch-download"]').click();
        const response = await requested;
        assert.equal(response.status(), 200);
        downloads.push(contract(response.request()));
        const ticket = await response.json();
        const zip = await download;
        assert.match(ticket.url, /^\/api\/downloads\//);
        assert.equal(zip.url(), web + ticket.url);
        assert.equal(zip.suggestedFilename(), ticket.filename);
        assert.match(zip.suggestedFilename(), /\.zip$/);
        const file = await readFile((await zip.path())!);
        assert.equal(file.subarray(0, 2).toString(), "PK");
        archiveBodies.push(file);
      }
      assert.deepEqual(downloads[0], downloads[1]);
      assert.deepEqual(downloads[0].json, { keys: bulk });
      assert.deepEqual(archiveBodies[0], archiveBodies[1]);
      assert.deepEqual(
        (await matchingWrite(favoritesAPI, '[data-act="batch-favorite"]')).json,
        { keys: bulk, favorite: false },
      );
      for (const page of pages)
        await expect(page.locator("#library-grid")).toHaveText("暂无收藏");
      await compare(pages, "library-favorites-removed");
      await click(pages, '[data-value="history"]');
      await click(pages, '[data-act="start-select"]');
      await click(pages, previewUpload(disposableImage.id));
      await click(pages, previewUpload(uploadedImage.id));
      await click(pages, '[data-act="batch-delete"]');
      await compare(pages, "library-delete-batch-confirm");
      const rejected = await matchingWrite(batchDelete, "#confirm", 409);
      assert.deepEqual(rejected.json, {
        keys: ["asset:" + disposableImage.id, "asset:" + uploadedImage.id],
      });
      for (const page of pages)
        await expect(page.locator("#confirm")).toBeEnabled();
      await compare(pages, "library-delete-batch-atomic-error");
      await click(pages, "#back");
      await click(pages, previewUpload(uploadedImage.id));
      await click(pages, '[data-act="batch-delete"]');

      // Run successful deletes on both pages against the same keys, restoring
      // only the isolated fixture rows/files between requests.
      const archive = db
        .prepare("SELECT * FROM media WHERE id=?")
        .get(disposableImage.id)!;
      const mediaFile = join(directory, "data", "objects", disposableImage.id);
      const originalMedia = await readFile(mediaFile);
      for (const [i, page] of pages.entries()) {
        if (i) {
          db.prepare(
            "INSERT INTO media(id,kind,size,mime,w,h,owner,workspace) VALUES(?,?,?,?,?,?,?,?)",
          ).run(
            archive.id,
            archive.kind,
            archive.size,
            archive.mime,
            archive.w,
            archive.h,
            archive.owner,
            archive.workspace,
          );
          await writeFile(mediaFile, originalMedia);
        }
        const response = mutation(page, batchDelete);
        await page.locator("#confirm").click();
        const deleted = await response;
        assert.equal(deleted.status(), 200);
        assert.deepEqual(contract(deleted.request()).json, {
          keys: ["asset:" + disposableImage.id],
        });
        await expect(
          page.locator(previewUpload(disposableImage.id)),
        ).toHaveCount(0);
        assert.equal(
          db.prepare("SELECT id FROM media WHERE id=?").get(disposableImage.id),
          undefined,
        );
      }
      await compare(pages, "library-delete-batch-written");
      const savedJob = db.prepare("SELECT * FROM jobs WHERE id=?").get(failed)!;
      const restoreJob = db.prepare(
        `INSERT INTO jobs (${Object.keys(savedJob).join(",")}) VALUES (${Object.keys(
          savedJob,
        )
          .map(() => "?")
          .join(",")})`,
      );
      await click(pages, '[data-tab="videos"]');
      await click(pages, `#job-${failed} .asset-preview`);
      await click(pages, '[data-menu="detail-more"]');
      await click(pages, '#popover [data-act="delete"]');
      const singleDeletes = [];
      for (const [i, page] of pages.entries()) {
        if (i) restoreJob.run(...Object.values(savedJob));
        const response = mutation(page, "/api/jobs/" + failed);
        const refreshed = page.waitForResponse(
          (response) => new URL(response.url()).pathname === "/api/state",
        );
        await page.locator("#confirm").click();
        const deleted = await response;
        assert.equal(deleted.status(), 200);
        singleDeletes.push(contract(deleted.request()));
        assert.equal((await refreshed).status(), 200);
        await expect(page.locator(".assets-view")).toBeVisible();
        await expect(page.locator("#modal")).toBeHidden();
        await expect(page.locator(`#job-${failed}`)).toHaveCount(0);
        assert.equal(
          db.prepare("SELECT id FROM jobs WHERE id=?").get(failed),
          undefined,
        );
      }
      assert.deepEqual(singleDeletes[0], singleDeletes[1]);
      for (const page of pages) {
        await expect(page.locator(".assets-view")).toBeVisible();
        await expect(page.locator(`#job-${failed}`)).toHaveCount(0, {
          timeout: 10_000,
        });
      }
      await compare(pages, "library-delete-job-written");

      const imageToDelete = await uploadFixture(
        "/api/assets",
        "delete-image.png",
        png,
      );
      await open(pages, team.id);
      await click(pages, 'nav [data-nav="library"]');
      await click(pages, '[data-tab="images"]');
      await click(pages, previewUpload(imageToDelete.id));
      await click(pages, '[data-act="delete-image"]');
      const record = db
        .prepare("SELECT * FROM media WHERE id=?")
        .get(imageToDelete.id)!;
      const object = join(directory, "data", "objects", imageToDelete.id);
      const bytes = await readFile(object);
      const directDeletes = [];
      for (const [i, page] of pages.entries()) {
        if (i) {
          db.prepare(
            "INSERT INTO media(id,kind,size,mime,w,h,owner,workspace) VALUES(?,?,?,?,?,?,?,?)",
          ).run(
            record.id,
            record.kind,
            record.size,
            record.mime,
            record.w,
            record.h,
            record.owner,
            record.workspace,
          );
          await writeFile(object, bytes);
        }
        const response = mutation(page, "/api/assets/" + imageToDelete.id);
        await page.locator("#confirm").click();
        const deleted = await response;
        assert.equal(deleted.status(), 200);
        directDeletes.push(contract(deleted.request()));
        await expect(page.locator(".assets-view")).toBeVisible();
        await expect(page.locator(previewUpload(imageToDelete.id))).toHaveCount(
          0,
        );
      }
      assert.deepEqual(directDeletes[0], directDeletes[1]);
      assert.equal(
        db.prepare("SELECT id FROM media WHERE id=?").get(imageToDelete.id),
        undefined,
      );
      await click(pages, '[data-tab="videos"]');
      await click(pages, queuedCard + " .asset-preview");
      for (const page of pages)
        await expect(page.locator(".result-pending")).toBeVisible();
      await click(pages, '[data-act="close-detail"]');
      await click(pages, 'nav [data-nav="home"]');
      await click(pages, videoCard + " .asset-preview");
      await click(pages, '[data-act="close-detail"]');
      for (const page of pages)
        await expect(page.locator(".home-view")).toBeVisible();
      await assertStudio(react, true);
    }
    await matchingWrite("/api/favorites", favorite);
    assert.deepEqual(
      (
        await (
          await call("/api/state", undefined, { workspace: team.id })
        ).json()
      ).favorites,
      ["job:" + completed],
    );
    await open(pages, team.id);
    await matchingWrite("/api/favorites", favorite);
    assert.deepEqual(
      (
        await (
          await call("/api/state", undefined, { workspace: team.id })
        ).json()
      ).favorites,
      [],
    );
    await click(pages, ".workspace-switch");
    await matchingWrite(
      `/api/workspaces/${emptyTeam.id}/select`,
      `#popover [data-id="${emptyTeam.id}"]`,
    );
    for (const page of pages) {
      await expect(page.locator(".workspace-switch")).toHaveAttribute(
        "title",
        "空工作区",
      );
      assert.equal(
        new URL(page.url()).searchParams.get("workspace"),
        String(emptyTeam.id),
      );
    }
    await call(`/api/workspaces/${admin.workspace_id}/select`, {});
    await open(pages, team.id);
    await click(pages, 'nav [data-nav="queue"]');
    const queueCancel = `[data-act=cancel][data-id="${queued}"]`;
    // Restore the synthetic queue fixture between runs. Each write still enters
    // the real original cancellation handler and uses the same numeric ID.
    const cancelContracts = [];
    for (const page of pages) {
      db.prepare("UPDATE jobs SET status='queued' WHERE id=?").run(queued);
      const result = mutation(page, `/api/jobs/${queued}/cancel`);
      await page.locator(queueCancel).click();
      const response = await result;
      assert.equal(response.status(), 200);
      cancelContracts.push(contract(response.request()));
      await expect(page.locator(queueCancel)).toHaveCount(0);
      assert.equal(
        db.prepare("SELECT status FROM jobs WHERE id=?").get(queued)?.status,
        "cancelled",
      );
    }
    assert.deepEqual(cancelContracts[1], cancelContracts[0]);

    await open(pages, team.id);
    await verifyAssetInteractions();
    await open(pages, team.id);
    const submissions = [];
    for (const page of pages) {
      await page.locator("#prompt").fill("隔离队列 <原样> & 文本");
      await expect(
        page.locator(".generate-button"),
        await page.locator(".composer").innerText(),
      ).toBeEnabled();
      const response = mutation(page, "/api/jobs");
      await page.locator(".generate-button").click();
      const posted = await response;
      assert.equal(posted.status(), 200, "browser generation");
      const submitted = contract(posted.request());
      const { uid, ...json } = submitted.json;
      assert.match(uid, /^[0-9a-f-]{36}$/);
      submissions.push({ ...submitted, json });
      const id = db
        .prepare("SELECT id FROM jobs WHERE uid=?")
        .get(`${admin.me.id}-${uid}`)?.id;
      assert.ok(id);
      await expect(page.locator(`#job-${id}.new-result`)).toBeVisible();
      if (page === react)
        await assertStudio(page, true);
      db.prepare(
        "UPDATE jobs SET status='done',result=?,output_metadata=? WHERE id=?",
      ).run(videoResult.id, JSON.stringify({ duration: 3 }), id);
      await expect(page.locator(`#job-${id} .asset-duration`)).toHaveText(
        "00:03",
        { timeout: 10_000 },
      );
      await page.locator(`#job-${id} .asset-preview`).click();
      await expect(page.locator(".detail-video")).toHaveAttribute(
        "src",
        "/media/" + videoResult.id,
      );
      await page.locator('[data-act="locate"]').click();
      await expect(page.locator(`#job-${id}.new-result`)).toBeVisible();
      db.prepare(
        "UPDATE jobs SET status='queued',result=NULL,output_metadata='{}' WHERE id=?",
      ).run(id);
      assert.equal(
        db.prepare("SELECT status FROM jobs WHERE id=?").get(id)?.status,
        "queued",
      );
    }
    assert.deepEqual(submissions[1], submissions[0]);

    await react.goto(web + studio + "?workspace=" + team.id);
    await react.locator("#prompt").fill("响应丢失后重试");
    await react.route(
      "**/api/jobs",
      async (route) => {
        const accepted = await route.fetch();
        assert.equal(accepted.status(), 200);
        await route.fulfill({ status: 502, json: { detail: "本机响应中断" } });
      },
      { times: 1 },
    );
    await expect(
      react.locator(".generate-button"),
      await react.locator(".composer").innerText(),
    ).toBeEnabled();
    const lost = mutation(react, "/api/jobs");
    await react.locator(".generate-button").click();
    const lostRequest = (await lost).request();
    await expect(react.locator("#toast")).toHaveText("本机响应中断");
    const replayed = mutation(react, "/api/jobs");
    await react.locator(".generate-button").click();
    const retry = await replayed;
    assert.equal(retry.status(), 200);
    assert.deepEqual(contract(retry.request()), contract(lostRequest));
    const retryUid = contract(retry.request()).json.uid;
    const saved = db
      .prepare("SELECT id FROM jobs WHERE uid=?")
      .all(`${admin.me.id}-${retryUid}`);
    assert.equal(saved.length, 1);
    await expect(react.locator(`#job-${saved[0].id}.new-result`)).toBeVisible();
    assert.equal(
      db
        .prepare("SELECT count(*) AS count FROM credit_charges WHERE job=?")
        .get(saved[0].id)?.count,
      1,
    );

    const pack = await (
      await call(
        "/api/asset-packs",
        {
          name: "工作台对照素材包",
          purpose: "style",
          description: "仅使用本地合成图",
          media: [uploadedImage.id],
        },
        { workspace: team.id },
      )
    ).json();
    async function matchingGeneration(
      path: string,
      tab: string,
      configure: (pair: Page[]) => Promise<void>,
      action = ".generate-button",
    ) {
      const duo = await pair();
      try {
        await open(duo, team.id);
        await configure(duo);
        const requests = [];
        for (const page of duo) {
          const button = page.locator(action);
          await expect(
            button,
            `${path} ${await page
              .locator(".composer")
              .first()
              .innerText({ timeout: 500 })
              .catch(() => "")}`,
          ).toBeEnabled();
          const posted = mutation(page, path);
          await button.click();
          const response = await posted;
          assert.equal(response.status(), 200, await response.text());
          const { uid, ...body } = contract(response.request()).json;
          assert.match(uid, /^[0-9a-f-]{36}$/);
          const result = await response.json();
          await expect(page.locator(`[data-tab="${tab}"]`)).toHaveAttribute(
            "aria-selected",
            "true",
          );
          await expect(
            page.locator(`#job-${result.id}.new-result`),
          ).toBeVisible();
          assert.equal(
            db
              .prepare(
                "SELECT count(*) AS count FROM credit_charges WHERE job=?",
              )
              .get(result.id)?.count,
            1,
          );
          requests.push({ ...contract(response.request()), json: body });
        }
        assert.deepEqual(requests[1], requests[0]);
        await assertStudio(duo[1], true);
        return requests[1].json;
      } finally {
        await close(duo);
      }
    }
    const promptBoth = (pages: Page[], text: string) =>
      Promise.all(pages.map((page) => page.locator("#prompt").fill(text)));
    async function creationBoth(pages: Page[], kind: string) {
      await click(pages, '[data-menu="creation"]');
      await click(pages, `#popover [data-act=creation][data-value="${kind}"]`);
    }
    const imageRequest = await matchingGeneration(
      "/api/image-jobs",
      "images",
      async (duo) => {
        await creationBoth(duo, "image");
        await click(duo, '[data-menu="format"]');
        await click(duo, '[data-act="resolution"][data-value="2K"]');
        await Promise.all(duo.map((page) => page.keyboard.press("Escape")));
        await click(duo, '[data-menu="duration"]');
        await click(duo, '[data-act="image-quality"][data-value="high"]');
        await click(duo, ".reference-deck");
        await click(duo, '[data-act="asset-packs"]');
        await compare(duo, "composer-pack-list");
        await click(duo, '[aria-label="打开素材包 工作台对照素材包"]');
        await compare(duo, "composer-pack-detail");
        await Promise.all(
          duo.map((page) =>
            page.getByRole("button", { name: "导入整个素材包" }).click(),
          ),
        );
        for (const page of duo)
          await expect(page.locator(".reference-deck-count")).toHaveText("1");
        await promptBoth(duo, "合成图片 & 保持文本");
      },
    );
    assert.equal(imageRequest.resolution, "2K");
    assert.equal(imageRequest.image_quality, "high");
    assert.deepEqual(imageRequest.asset_packs, [
      { id: pack.id, revision: pack.revision },
    ]);

    const audioRequest = await matchingGeneration(
      "/api/audio-jobs",
      "audio",
      async (duo) => {
        await creationBoth(duo, "audio");
        await click(duo, '[data-menu="duration"]');
        for (const page of duo)
          await page.locator("#voice-description").fill(" 自然地朗读 ");
        await click(duo, '[data-act="save-voice"]');
        await promptBoth(duo, "字".repeat(301));
        for (const page of duo) {
          await expect(page.locator(".generate-button")).toBeDisabled();
          await expect(page.locator(".composer-status")).toHaveText(
            "301 / 300 字",
          );
        }
        await promptBoth(duo, "短语音测试");
      },
    );
    assert.equal(audioRequest.model, "breeze-tts-2");
    assert.equal(audioRequest.instruction, "自然地朗读");

    const source = job("done", "续写来源", "video", videoResult.id);
    db.prepare("UPDATE jobs SET model=?, output_metadata=? WHERE id=?").run(
      "flow:veo-3.1-quality-8s-landscape",
      JSON.stringify({ flow_media_id: "fixture-local-result", duration: 8 }),
      source,
    );
    const flowRequest = await matchingGeneration(
      "/api/jobs",
      "videos",
      async (duo) => {
        await click(duo, '[data-menu="image-model"]');
        await click(duo, '[title="Veo 3.1 Quality"]');
        await click(duo, '[data-menu="format"]');
        await click(duo, '[data-act=flow-mode][data-value="extend"]');
        await Promise.all(duo.map((page) => page.keyboard.press("Escape")));
        await promptBoth(duo, "续写下一幕");
        for (const page of duo) {
          await expect(page.locator(".composer-status")).toHaveText(
            "请选择来源视频",
          );
          await expect(page.locator(".generate-button")).toBeDisabled();
          await page.getByLabel("续写来源视频").selectOption(String(source));
        }
      },
    );
    assert.equal(flowRequest.model, "flow:veo-3.1-quality-extend-8s-landscape");
    assert.equal(flowRequest.flow_source_job, source);

    const museRequest = await matchingGeneration(
      "/api/jobs",
      "videos",
      async (duo) => {
        await click(duo, '[data-menu="image-model"]');
        await click(duo, '#popover [data-value="muse-video"]');
        const previews = ".recent-section video";
        const count = await duo[0].locator(previews).count();
        await expect(duo[1].locator(previews)).toHaveCount(count);
        for (let index = 0; index < count; index++)
          await pauseLoadedMedia(`${previews} >> nth=${index}`, 0.05, duo);
        await click(duo, '[data-menu="duration"]');
        await Promise.all(duo.map((page) => page.mouse.move(1, 1)));
        await compare(duo, "composer-muse-duration");
        await click(duo, '[data-act="seconds"][data-value="8"]');
        await promptBoth(duo, "Muse 对照");
      },
    );
    assert.equal(museRequest.model, "muse-video");
    assert.equal(museRequest.seconds, 8);

    const native = await matchingGeneration(
      "/api/jobs",
      "videos",
      async (duo) => {
        for (const [tab, id] of [
          ["videos", uploadedVideo.id],
          ["audio", uploadedAudio.id],
          ["images", uploadedImage.id],
        ]) {
          await click(duo, 'nav [data-nav="library"]');
          await click(duo, `[data-tab="${tab}"]`);
          await click(duo, `[data-act="use"][data-key="${id}"]`);
        }
        for (const page of duo)
          await expect(page.locator(".reference-deck-count")).toHaveText("3");
        await click(duo, '[data-menu="advanced"]');
        await click(duo, "#fast-mode");
        await click(duo, '[data-act="save-seed"]');
        await promptBoth(duo, "参考本地视频和音频");
        await click(duo, '[data-menu="mention"]');
        await click(
          duo,
          `#popover [data-act="mention"][data-key="${uploadedVideo.id}"]`,
        );
      },
    );
    assert.deepEqual(native.refs, [
      uploadedVideo.id,
      uploadedAudio.id,
      uploadedImage.id,
    ]);
    assert.equal(native.sampling_steps, 4);
    assert.equal(native.prompt, "参考本地视频和音频<Video 1> ");

    const repeated = await matchingGeneration(
      "/api/jobs",
      "videos",
      async (duo) => {
        await click(duo, 'nav [data-nav="library"]');
        await click(duo, `#job-${generatedVideo} .asset-preview`);
      },
      '[data-act="again"]',
    );
    assert.equal(repeated.parent, generatedVideo);
    assert.equal(repeated.sampling_steps, 32);
    assert.equal(repeated.seed, null);

    const backfill = await pair();
    try {
      await open(backfill, team.id);
      await click(backfill, 'nav [data-nav="library"]');
      await click(backfill, '[data-tab="audio"]');
      await click(backfill, `#job-${generatedAudio} .asset-preview`);
      await click(backfill, '.edit-actions [data-act="edit"]');
      for (const page of backfill) {
        await expect(page.locator(".detail-view.editing #prompt")).toHaveText(
          "朗读内容 <原文>",
        );
        await expect(page.locator("#prompt")).toBeFocused();
      }
      await pauseLoadedMedia(".detail-audio", 0, backfill);
      await compare(backfill, "composer-audio-edit");
      await click(backfill, '[data-menu="duration"]');
      for (const page of backfill)
        await expect(page.locator("#voice-description")).toHaveValue(
          "自然朗读",
        );
      await click(backfill, '[data-act="save-voice"]');
      await click(backfill, '[data-act="close-detail"]');
      await click(backfill, '[data-tab="images"]');
      await click(backfill, `#job-${completed} .asset-preview`);
      await click(backfill, '[data-act="image-to-video"]');
      for (const page of backfill) {
        await expect(page.locator(".home-view .creation-type")).toHaveText(
          "视频生成",
        );
        await expect(page.locator(".reference-deck-count")).toHaveText("1");
        const prompt = page.locator("#prompt");
        await expect(prompt).toBeEmpty();
        await expect(prompt).toBeFocused();
        await prompt.blur();
      }
      await Promise.all(backfill.map((page) => page.mouse.move(1, 1)));
      await compare(backfill, "composer-image-to-video");
      await assertStudio(backfill[1], true);
    } finally {
      await close(backfill);
    }

    await open(pages, team.id);
    const uploads = [];
    for (const page of pages) {
      const pending = mutation(page, "/api/assets");
      await page.locator("#files").setInputFiles({
        name: "参考素材.png",
        mimeType: "image/png",
        buffer: png,
      });
      const response = await pending;
      assert.equal(response.status(), 200);
      const sent = response.request();
      uploads.push({
        method: sent.method(),
        workspace: sent.headers()["x-workspace-id"],
        origin: sent.headers().origin,
        name: sent.headers()["x-file-name"],
        bytes: sent.postDataBuffer(),
      });
      await expect(page.locator(".reference-deck-count")).toHaveText("1");
      await page.evaluate(
        (key) => sessionStorage.removeItem(key),
        `fm-draft-${admin.me.id}-workspace-${team.id}`,
      );
    }
    assert.deepEqual(uploads[1], uploads[0]);

    await open(pages, team.id);
    await react.locator("#prompt").fill("跨入口保留草稿");
    await react.locator('nav [data-nav="library"]').click();
    await expect(react.locator("#asset-composer #prompt")).toHaveText(
      "跨入口保留草稿",
    );
    await react.locator('[data-tab="images"]').click();
    await react.locator(`#job-${completed} .asset-preview`).click();
    await react.locator('[data-act="locate"]').click();
    await expect(react.locator(`#job-${completed}.new-result`)).toBeVisible();
    await react.locator('nav [data-nav="home"]').click();
    await expect(react.locator("#prompt")).toHaveText("跨入口保留草稿");
    const creation = react.locator('[data-menu="creation"]');
    await creation.click();
    await react.locator('#popover [data-value="audio"]').click();
    await expect(creation).toHaveText("语音生成");
    await react.reload();
    await expect(creation).toHaveText("语音生成");
    await assertStudio(react, true);
    await react.locator(".workspace-switch").click();
    await react.locator(`#popover [data-id="${emptyTeam.id}"]`).click();
    await expect(creation).toHaveText("视频生成");
    await expect(react.locator("#prompt")).toBeEmpty();
    await react.locator("#prompt").fill("另一空间的独立草稿");
    await react.locator(".workspace-switch").click();
    await react.locator(`#popover [data-id="${team.id}"]`).click();
    await expect(creation).toHaveText("语音生成");
    await expect(react.locator("#prompt")).toHaveText("跨入口保留草稿");
    await creation.click();
    await react.locator('#popover [data-value="video"]').click();
    await react.locator('nav [data-nav="library"]').click();
    await react.locator('[data-tab="images"]').click();
    await react
      .locator(`[data-asset-key="asset:${uploadedImage.id}"] .asset-preview`)
      .click();
    await react.locator('.image-detail [data-act="use"]').click();
    await expect(react.locator(".reference-deck-count")).toHaveText("1");
    await assertStudio(react, true);
    await react.locator('nav [data-nav="library"]').click();
    await react.locator('[data-tab="videos"]').click();
    await react.locator(`#job-${generatedVideo} .asset-preview`).click();
    await react.locator('.edit-actions [data-act="edit"]').click();
    await expect(react.locator(".detail-view.editing #prompt")).toContainText(
      "视频",
    );
    await expect(
      react.locator(".detail-view.editing .h3-mode-control"),
    ).toHaveText("首尾帧");
    await expect(react.locator('nav [data-nav="library"]')).toHaveAttribute(
      "aria-current",
      "page",
    );
    await react.locator('[data-menu="advanced"]').click();
    await expect(
      react.locator('[data-act="sampling-steps"][data-value="32"]'),
    ).toHaveAttribute("aria-checked", "true");
    await react.locator("#reuse-seed").check();
    await expect(react.locator("#seed")).toHaveValue("1987");
    await react.locator("#seed").fill("-1");
    await react.locator('[data-act="save-seed"]').click();
    await expect(react.locator("#toast")).toHaveText("请输入有效的非负整数");
    await react.locator("#seed").fill("1987");
    await react.locator('[data-act="save-seed"]').click();
    const edited = mutation(react, "/api/jobs");
    await react.locator(".generate-button").click();
    const editedResponse = await edited;
    assert.equal(editedResponse.status(), 200, await editedResponse.text());
    const { parent, sampling_steps, seed, h3 } = contract(
      editedResponse.request(),
    ).json;
    assert.deepEqual(
      { parent, sampling_steps, seed, h3 },
      {
        parent: generatedVideo,
        sampling_steps: 32,
        seed: 1987,
        h3: {
          mode: "frames",
          first_frame: uploadedImage.id,
          last_frame: null,
          video_audio: [],
        },
      },
    );
    await assertStudio(react, true);
    const documentStarted = await react.evaluate(() => performance.timeOrigin);
    await react.locator("nav [data-nav=chat]").click();
    await expect(react.locator("#chat-root")).toBeVisible();
    await assertStudio(react, true);
    assert.equal(
      await react.evaluate(() => performance.timeOrigin),
      documentStarted,
    );
    await react.goto(web + studio + "?workspace=" + team.id);
    const title = "工作台与画布入口对照";
    const project = await (
      await call("/api/canvases", { title }, { workspace: team.id })
    ).json();
    const fallback = await react.goto(
      web + "/studio?workspace=" + team.id + "&studio_ui=legacy",
    );
    assert.match(await fallback!.text(), /src="\/static\/studio\.js/);
    await expect(react.locator(".home-view")).toBeVisible();
    await react.locator("nav [data-nav=canvas]").click();
    await expect(react).toHaveURL(web + "/canvas?workspace=" + team.id);
    await expect(
      react.getByRole("link", { name: "打开画布 " + title }),
    ).toBeVisible();

    const reactStudio = await react.goto(
      web + studio + "?workspace=" + team.id,
    );
    assert.match(await reactStudio!.text(), /src="\/_next\/static\//);
    assert.doesNotMatch(await reactStudio!.text(), /src="\/static\/studio\.js/);
    const canvasDraft = "从画布返回保留的草稿";
    await react.locator("#prompt").fill(canvasDraft);
    await react.locator("nav [data-nav=canvas]").click();
    await expect(react).toHaveURL(web + "/canvas?workspace=" + team.id);
    await react.getByRole("link", { name: "打开画布 " + title }).click();
    const editor = web + "/canvas/" + project.id + "?workspace=" + team.id;
    await expect(react).toHaveURL(editor);
    await expect(react.getByRole("textbox", { name: "画布名称" })).toHaveValue(
      title,
    );
    await react.getByRole("link", { name: "返回工作台" }).click();
    await expect(react).toHaveURL(web + "/studio?workspace=" + team.id);
    await expect(react.locator("#prompt")).toHaveText(canvasDraft);
    await assertStudio(react, true);

    const legacyEditor = await react.goto(editor + "&canvas_ui=legacy");
    const originalEditor = await fetch(original + "/canvas/" + project.id);
    assert.equal(await legacyEditor!.text(), await originalEditor.text());
    assert.equal(
      legacyEditor!.headers()["content-security-policy"],
      originalEditor.headers.get("content-security-policy"),
    );
    await expect(react.getByRole("textbox", { name: "画布名称" })).toHaveValue(
      title,
    );
    await react.getByRole("link", { name: "返回工作台" }).click();
    await expect(react).toHaveURL(web + "/studio?workspace=" + team.id);
    await expect(react.locator("#prompt")).toHaveText(canvasDraft);
    await assertStudio(react, true);
    await close(pages);

    const members = await pair({ cookie: memberCookie });
    await open(members, team.id);
    await click(members, ".workspace-switch");
    await compare(members, "member-spaces");
    for (const page of members) {
      await expect(page.locator("[data-act=create-workspace]")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(page.locator(`#job-${remoteJob}`)).toHaveCount(0);
    }
    await click(members, 'nav [data-nav="queue"]');
    await Promise.all(
      members.map((page) =>
        expect(page.locator("[data-act=cancel]")).toHaveCount(0),
      ),
    );
    await call(
      "/api/jobs/" + queued + "/cancel",
      {},
      { cookie: memberCookie, workspace: team.id, status: 403 },
    );
    await click(members, 'nav [data-nav="library"]');
    await click(members, '[data-tab="images"]');
    await click(members, `#job-${completed} .asset-preview`);
    await click(members, '[data-menu="detail-more"]');
    await compare(members, "library-member-detail-permissions");
    for (const page of members) {
      await expect(page.locator("#popover")).toContainText("暂无更多操作");
      await expect(page.locator('#popover [data-act="delete"]')).toHaveCount(0);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.locator('[data-act="start-select"]').click();
      await page.locator(`#job-${completed} .asset-preview`).click();
      await expect(page.locator('[data-act="batch-delete"]')).toBeDisabled();
    }
    await compare(members, "library-member-bulk-permissions");
    await call(
      "/api/workspaces/" + team.id,
      { name: team.name, members: [], expected_revision: team.revision },
      { method: "PATCH" },
    );
    await Promise.all(
      members.map((page) =>
        expect(page.locator(".home-view")).toBeVisible({ timeout: 12_000 }),
      ),
    );
    const member = await (
      await call("/api/state", undefined, { cookie: memberCookie })
    ).json();
    for (const page of members) {
      assert.equal(
        new URL(page.url()).searchParams.get("workspace"),
        String(member.workspace_id),
      );
      await expect(page.locator(`#job-${completed}`)).toHaveCount(0);
    }
    await compare(members, "revoked-workspace");
    await click(members, 'nav [data-nav="library"]');
    await call("/api/logout", {}, { cookie: memberCookie });
    await Promise.all(
      members.map((page) =>
        expect(page.locator(".auth-form")).toBeVisible({ timeout: 12_000 }),
      ),
    );
    await compare(members, "expired-in-place");
    await close(members);

    const expired = await pair({ cookie: "fm_session=expired" });
    await Promise.all(
      expired.map((page) =>
        page.goto(web + studio + "#register"),
      ),
    );
    await Promise.all(
      expired.map((page) =>
        expect(page.locator(".auth-register")).toBeVisible(),
      ),
    );
    await compare(expired, "expired-on-entry");
    await close(expired);

    const logout = await pair({ cookie: "" });
    const logoutContracts = [];
    for (const page of logout) {
      const signedIn = await page.context().request.post(web + "/api/login", {
        headers: { Origin: web },
        data: memberCredentials,
      });
      assert.equal(signedIn.status(), 200, await signedIn.text());
      const session = signedIn.headers()["set-cookie"].split(";")[0];
      const stateResponse = await page
        .context()
        .request.get(web + "/api/state");
      assert.equal(stateResponse.status(), 200, await stateResponse.text());
      await page.goto(web + studio);
      await page.locator(".account").click();
      const pending = mutation(page, "/api/logout");
      await page.locator('[data-act="logout"]').click();
      const response = await pending;
      assert.equal(response.status(), 200);
      logoutContracts.push(contract(response.request()));
      await expect(page.locator(".auth-form")).toBeVisible();
      await call("/api/state", undefined, { cookie: session, status: 401 });
    }
    assert.deepEqual(logoutContracts[1], logoutContracts[0]);
    await close(logout);

    const down = await pair();
    for (const page of down)
      await page.route("**/api/state", (route) =>
        route.fulfill({ status: 502, json: { detail: "本机服务不可用" } }),
      );
    await Promise.all(
      down.map((page) =>
        page.goto(web + studio),
      ),
    );
    for (const page of down) {
      await expect(page.locator(".loading-screen")).toBeVisible();
      await expect(page.locator("#toast")).toHaveText("本机服务不可用");
    }
    await compare(down, "state-outage");
    await close(down);
    assert.deepEqual(errors, []);
    assert.deepEqual(parityFailures, []);
    passed = true;
  } finally {
    db.close();
    await browser.close();
    await writeFile(
      join(out, "report.json"),
      JSON.stringify({ passed, tested, errors, parityFailures }, null, 2) +
        "\n",
    );
  }
}
