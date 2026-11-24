import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, type Browser, type BrowserContext } from "@playwright/test";
import sharp from "sharp";
import { newNode, type Project } from "../../apps/web/canvas-editor/types.js";
import { formatMediaSeconds } from "../../apps/web/studio/media-metadata.js";
import type { ManagedMember, Space, StudioState } from "../../apps/web/studio/state.js";

const apiTimeout = 30_000;

function buildMediaFixtures() {
  const videoWithAudio = execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x180:rate=24:duration=4",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=3.96:sample_rate=32000",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-threads",
    "2",
    "-c:a",
    "aac",
    "-movflags",
    "frag_keyframe+empty_moov",
    "-f",
    "mp4",
    "pipe:1",
  ]);
  const silentVideo = execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x180:rate=24:duration=3",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-threads",
    "2",
    "-movflags",
    "frag_keyframe+empty_moov",
    "-f",
    "mp4",
    "pipe:1",
  ]);
  const audioSample = execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=520:duration=4:sample_rate=32000",
    "-f",
    "wav",
    "pipe:1",
  ]);
  return { videoWithAudio, silentVideo, audioSample };
}

async function ensureGpuPluginEnabled(context: BrowserContext, origin: string) {
  const initial: StudioState = await (await context.request.get("/api/state")).json();
  if (initial.model_access?.["MiniMax H3"] || initial.model_policy?.enabled?.["MiniMax H3"])
    return;
  const headers = { Origin: origin, "X-Workspace-Id": String(initial.workspace_id) };
  const file = JSON.parse(await readFile("plugins/gpu/gpu.fmplugin.json", "utf8"));
  const imported = await context.request.post("/api/admin/plugins/import", {
    headers,
    data: { file },
  });
  assert.ok([200, 201].includes(imported.status()), await imported.text());
  const plugins: { id: string; revision: number; enabled: boolean }[] = await (
    await context.request.get("/api/admin/plugins", { headers })
  ).json();
  const gpu = plugins.find((item) => item.id === file.id);
  assert.ok(gpu);
  if (!gpu.enabled) {
    const enabled = await context.request.post(`/api/admin/plugins/${file.id}/state`, {
      headers,
      data: { revision: gpu.revision, action: "enable" },
    });
    assert.ok(enabled.ok(), await enabled.text());
  }
}

export async function checkUploadedMediaPreview(
  browser: Browser,
  origin: string,
  adminUser: { name: string; password: string },
  screenshotDir?: string,
) {
  const { videoWithAudio, silentVideo, audioSample } = buildMediaFixtures();
  const imageBytes = await sharp({
    create: { width: 320, height: 180, channels: 3, background: "#4a78a8" },
  })
    .png()
    .toBuffer();

  if (screenshotDir) await mkdir(screenshotDir, { recursive: true });

  const adminContext = await browser.newContext({
    baseURL: origin,
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });
  let memberContext: BrowserContext | undefined;

  try {
    const login = await adminContext.request.post("/api/login", {
      headers: { Origin: origin },
      data: adminUser,
    });
    assert.equal(login.status(), 200, await login.text());
    await ensureGpuPluginEnabled(adminContext, origin);

    const memberPassword = "member-" + randomBytes(12).toString("base64url");
    const memberName = "media_member_" + randomBytes(4).toString("hex");
    const createMember = await adminContext.request.post("/api/users", {
      headers: { Origin: origin },
      data: { name: memberName, nickname: "协作成员", password: memberPassword },
    });
    assert.equal(createMember.status(), 200, await createMember.text());
    const rootState: StudioState = await (
      await adminContext.request.get("/api/state")
    ).json();
    const createdMember = rootState.users?.find(
      (item: ManagedMember) => item.name === memberName,
    );
    assert.ok(createdMember, "Created synthetic member must exist in state.users");

    const createTeam = await adminContext.request.post("/api/workspaces", {
      headers: { Origin: origin },
      data: {
        name: "上传音视频验收-" + randomBytes(3).toString("hex"),
        members: [createdMember.id],
      },
    });
    assert.equal(createTeam.status(), 200, await createTeam.text());
    const team: Space = await createTeam.json();
    const headers = { Origin: origin, "X-Workspace-Id": String(team.id) };

    // Also upload the 3s silent video directly via API so both audio-track states are present.
    const silentUpload = await adminContext.request.post(
      "/api/h3/references?kind=video",
      {
        headers: {
          ...headers,
          "Content-Type": "video/mp4",
          "X-File-Name": encodeURIComponent("silent-3s.mp4"),
        },
        data: silentVideo,
      },
    );
    assert.equal(silentUpload.status(), 200, await silentUpload.text());
    const silentAsset: { id: string } = await silentUpload.json();

    const page = await adminContext.newPage();
    await page.goto(`/studio?workspace=${team.id}`);
    await expect(page.locator(".shell")).toBeVisible();

    const creation = page.locator('.composer [data-menu="creation"]');
    if ((await creation.textContent())?.trim() !== "视频生成") {
      await creation.click();
      await page.getByRole("option", { name: "视频生成" }).click();
    }
    const modelButton = page.locator('.composer [data-menu="image-model"]');
    if (!(await modelButton.textContent())?.includes("MiniMax H3")) {
      await modelButton.click();
      await page.getByRole("option", { name: /MiniMax H3/ }).click();
    }

    await page.getByRole("button", { name: "添加参考内容" }).click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "上传素材" }).click();
    await (
      await chooser
    ).setFiles([
      { name: "ref-image.png", mimeType: "image/png", buffer: imageBytes },
      { name: "with-audio-4s.mp4", mimeType: "video/mp4", buffer: videoWithAudio },
      { name: "voice-4s.wav", mimeType: "audio/wav", buffer: audioSample },
    ]);
    await expect(page.locator(".reference-deck-count")).toHaveText("3", {
      timeout: apiTimeout,
    });

    const teamState: StudioState = await (
      await adminContext.request.get("/api/state", { headers })
    ).json();
    const videoWithAudioAsset = teamState.assets.find(
      (item) => item.kind === "ref_video" && item.id !== silentAsset.id,
    );
    const audioAsset = teamState.assets.find((item) => item.kind === "ref_audio");
    assert.ok(videoWithAudioAsset && audioAsset);

    const cdp = await adminContext.newCDPSession(page);
    const dialog = page.locator("#modal");
    async function dialogAccessibleName() {
      const { root } = await cdp.send("DOM.getDocument");
      const { nodeId } = await cdp.send("DOM.querySelector", {
        nodeId: root.nodeId,
        selector: "#modal",
      });
      const { nodes } = await cdp.send("Accessibility.getPartialAXTree", {
        nodeId,
        fetchRelatives: false,
      });
      assert.equal(nodes[0]?.role?.value, "dialog");
      return String(nodes[0]?.name?.value ?? "");
    }

    // 1. Verify Composer lightweight preview compatibility & accessible names.
    for (const [selector, expectedName] of [
      ["img", "图片预览"],
      ["video", "视频预览"],
      ["audio", "音频预览"],
    ] as const) {
      await page.locator('.composer [data-act="reference"]').click();
      const row = page
        .locator('#popover button[data-act="h3-preview"]')
        .filter({
          has: page.locator(
            selector === "audio" ? ".h3-audio-thumb" : selector,
          ),
        });
      await row.click();
      await expect(dialog).toBeVisible();
      assert.equal(await dialogAccessibleName(), expectedName);
      await expect(dialog.locator('[data-act="delete-asset"]')).toHaveCount(0);
      await expect(dialog.locator('[data-act="use"]')).toHaveCount(0);
      await expect(dialog.getByRole("button", { name: "关闭", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }

    // 2. Verify Library -> 视频 cards, metadata, favorite, cancel-delete, Escape focus.
    await page.locator('nav [data-nav="library"]').click();
    await expect(page.getByRole("tab", { name: "视频", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    const soundVideoCard = page.locator(
      `article[data-asset-key="asset:${videoWithAudioAsset.id}"]`,
    );
    const silentVideoCard = page.locator(
      `article[data-asset-key="asset:${silentAsset.id}"]`,
    );
    await expect(soundVideoCard.locator(".asset-duration")).toHaveText("00:04");
    await expect(silentVideoCard.locator(".asset-duration")).toHaveText("00:03");
    await expect(soundVideoCard.locator('[data-act="delete-asset"]')).toHaveCount(1);

    const soundOpener = soundVideoCard.locator('.asset-preview[data-act="h3-preview"]');
    await soundOpener.focus();
    await page.keyboard.press("Enter");
    await expect(dialog.locator("video[controls]")).toBeVisible();
    assert.equal(await dialogAccessibleName(), "视频预览");
    assert.ok(
      (videoWithAudioAsset.seconds ?? 0) >= 3.9 &&
        (videoWithAudioAsset.seconds ?? 0) <= 4.2,
    );
    assert.deepEqual(
      await dialog.locator(".preview-dialog-meta span").allTextContents(),
      [
        "320 × 180",
        formatMediaSeconds(videoWithAudioAsset.seconds),
        "含音轨",
      ],
    );
    await expect(dialog.locator('[data-act="use"]')).toHaveText("用作参考");
    await expect(dialog.locator('[data-act="favorite"]')).toContainText("收藏");
    await expect(dialog.locator("a.download-action[download]")).toContainText("下载");
    await expect(dialog.locator('[data-act="delete-asset"]')).toHaveText("删除");
    await expect(dialog.getByRole("button", { name: "关闭", exact: true })).toBeVisible();

    if (screenshotDir) {
      await page.mouse.move(8, 8);
      await page.screenshot({ path: join(screenshotDir, "library-video-preview.png") });
    }

    await dialog.locator('[data-act="favorite"]').click();
    await expect(dialog.locator('[data-act="favorite"]')).toContainText("已收藏");

    // Click delete inside preview, then cancel -> returns to preview with focus on delete button.
    await dialog.locator('[data-act="delete-asset"]').click();
    await expect(dialog.locator("#modal-heading")).toHaveText("删除该视频？");
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(dialog.locator("video[controls]")).toBeVisible();
    await expect(dialog.locator('[data-act="delete-asset"]')).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(soundOpener).toBeFocused();

    // Verify silent video shows "无音轨".
    await silentVideoCard.locator('.asset-preview[data-act="h3-preview"]').click();
    await expect(dialog.locator("video[controls]")).toBeVisible();
    assert.deepEqual(
      await dialog.locator(".preview-dialog-meta span").allTextContents(),
      ["320 × 180", "3s", "无音轨"],
    );
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(dialog).toBeHidden();

    // 3. Verify Library -> 语音 card contrast, metadata and actions.
    await page.getByRole("tab", { name: "语音", exact: true }).click();
    const audioCard = page.locator(
      `article[data-asset-key="asset:${audioAsset.id}"]`,
    );
    await expect(audioCard.locator(".asset-duration")).toHaveText("00:04");
    const durationColor = await audioCard
      .locator(".asset-duration")
      .evaluate((node) => getComputedStyle(node).color);
    assert.notEqual(
      durationColor,
      "rgb(255, 255, 255)",
      "Audio card duration must stay readable against light card surface",
    );
    await audioCard.locator('.asset-preview[data-act="h3-preview"]').click();
    await expect(dialog.locator("audio[controls]")).toBeVisible();
    assert.equal(await dialogAccessibleName(), "音频预览");
    assert.deepEqual(
      await dialog.locator(".preview-dialog-meta span").allTextContents(),
      ["4s"],
    );
    await expect(dialog.locator('[data-act="delete-asset"]')).toHaveText("删除");

    if (screenshotDir) {
      await page.mouse.move(8, 8);
      await page.screenshot({ path: join(screenshotDir, "library-audio-preview.png") });
    }
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(dialog).toBeHidden();

    // 4. Verify non-owner team member cannot see single-item delete on admin's assets, but CAN on own upload.
    memberContext = await browser.newContext({
      baseURL: origin,
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
    });
    const memberLogin = await memberContext.request.post("/api/login", {
      headers: { Origin: origin },
      data: { name: memberName, password: memberPassword },
    });
    assert.equal(memberLogin.status(), 200, await memberLogin.text());
    const memberOwnAudioResp = await memberContext.request.post(
      "/api/h3/references?kind=audio",
      {
        headers: { ...headers, "Content-Type": "audio/wav" },
        data: audioSample,
      },
    );
    assert.equal(memberOwnAudioResp.status(), 200, await memberOwnAudioResp.text());
    const memberOwnAudio: { id: string } = await memberOwnAudioResp.json();

    const memberPage = await memberContext.newPage();
    await memberPage.goto(`/studio?workspace=${team.id}`);
    await memberPage.locator('nav [data-nav="library"]').click();
    const memberViewOfAdminVideo = memberPage.locator(
      `article[data-asset-key="asset:${videoWithAudioAsset.id}"]`,
    );
    await expect(memberViewOfAdminVideo).toBeVisible();
    await expect(memberViewOfAdminVideo.locator('[data-act="delete-asset"]')).toHaveCount(0);
    await memberViewOfAdminVideo.locator('.asset-preview[data-act="h3-preview"]').click();
    const memberDialog = memberPage.locator("#modal");
    await expect(memberDialog.locator("video[controls]")).toBeVisible();
    await expect(memberDialog.locator('[data-act="delete-asset"]')).toHaveCount(0);
    await memberDialog.getByRole("button", { name: "关闭", exact: true }).click();

    await memberPage.getByRole("tab", { name: "语音", exact: true }).click();
    const memberViewOfAdminAudio = memberPage.locator(
      `article[data-asset-key="asset:${audioAsset.id}"]`,
    );
    const memberViewOfOwnAudio = memberPage.locator(
      `article[data-asset-key="asset:${memberOwnAudio.id}"]`,
    );
    await expect(memberViewOfAdminAudio.locator('[data-act="delete-asset"]')).toHaveCount(0);
    await expect(memberViewOfOwnAudio.locator('[data-act="delete-asset"]')).toHaveCount(1);
    await memberViewOfOwnAudio.locator('.asset-preview[data-act="h3-preview"]').click();
    await memberDialog.locator('[data-act="delete-asset"]').click();
    await memberDialog.locator("#confirm").click();
    await expect(memberDialog).toBeHidden();
    await expect(memberViewOfOwnAudio).toHaveCount(0);

    // 5. Verify "用作参考" mode error alert and successful handoff to Home Composer.
    await page.locator('nav [data-nav="home"]').click();
    await page.locator('.composer [data-act="reference"]').click();
    while ((await page.locator('#popover [data-act="unref"]').count()) > 0) {
      await page.locator('#popover [data-act="unref"]').first().click();
    }
    await page.keyboard.press("Escape");
    await creation.click();
    await page.getByRole("option", { name: "语音生成" }).click();

    await page.locator('nav [data-nav="library"]').click();
    await page.getByRole("tab", { name: "视频", exact: true }).click();
    await soundOpener.click();
    await dialog.locator('[data-act="use"]').click();
    const modeAlert = dialog.getByRole("alert");
    await expect(modeAlert).toHaveText("请先选择 MiniMax H3 全能参考模式");
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();

    await page.locator('nav [data-nav="home"]').click();
    await creation.click();
    await page.getByRole("option", { name: "视频生成" }).click();
    await page.locator('nav [data-nav="library"]').click();
    await page.getByRole("tab", { name: "语音", exact: true }).click();
    await audioCard.locator('.asset-preview[data-act="h3-preview"]').click();
    await dialog.locator('[data-act="use"]').click();
    await expect(dialog).toBeHidden();
    await expect(page.locator("#home-composer .reference-deck-count")).toHaveText("1");
    await expect(page.locator("#home-composer #prompt")).toBeFocused();

    // 6. Verify 409 reference-in-use error when deleting an asset referenced by a canvas, then clean single-item deletes.
    const canvasResp = await adminContext.request.post("/api/canvases", {
      headers,
      data: { title: "引用占用校验画布" },
    });
    assert.equal(canvasResp.status(), 200, await canvasResp.text());
    const canvas: Project = await canvasResp.json();
    const shotNode = newNode("video", 100, 100, 1);
    shotNode.params.h3_refs = [videoWithAudioAsset.id];
    const saveCanvas = await adminContext.request.put(
      `/api/canvases/${canvas.id}/document`,
      {
        headers,
        data: {
          title: canvas.title,
          expected_revision: canvas.revision,
          document: {
            ...canvas.document,
            nodes: [shotNode],
          },
        },
      },
    );
    assert.equal(saveCanvas.status(), 200, await saveCanvas.text());

    await page.locator('nav [data-nav="library"]').click();
    await page.getByRole("tab", { name: "视频", exact: true }).click();
    await soundOpener.click();
    await dialog.locator('[data-act="delete-asset"]').click();
    await dialog.locator("#confirm").click();
    await expect(dialog.getByRole("alert")).toHaveText(
      "素材正在画布中使用，请先从相关画布移除",
    );
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(dialog.locator("video[controls]")).toBeVisible();
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();

    const delCanvas = await adminContext.request.delete(
      `/api/canvases/${canvas.id}`,
      { headers },
    );
    assert.equal(delCanvas.status(), 200, await delCanvas.text());

    // Delete silent video from inside preview dialog.
    await silentVideoCard.locator('.asset-preview[data-act="h3-preview"]').click();
    await dialog.locator('[data-act="delete-asset"]').click();
    await expect(dialog.locator("#modal-heading")).toHaveText("删除该视频？");
    await dialog.locator("#confirm").click();
    await expect(dialog).toBeHidden();
    await expect(silentVideoCard).toHaveCount(0);

    // Delete video-with-audio directly from card quick-action button.
    await soundVideoCard.locator('[data-act="delete-asset"]').click();
    await expect(dialog.locator("#modal-heading")).toHaveText("删除该视频？");
    await dialog.locator("#confirm").click();
    await expect(dialog).toBeHidden();
    await expect(soundVideoCard).toHaveCount(0);

    // Mobile viewport check (375x667): preview audio & delete single item cleanly, pruning Composer draft.
    await page.setViewportSize({ width: 375, height: 667 });
    await page.getByRole("tab", { name: "语音", exact: true }).click();
    await audioCard.locator('.asset-preview[data-act="h3-preview"]').click();
    await expect(dialog.locator("audio[controls]")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "关闭", exact: true })).toBeInViewport();
    if (screenshotDir) {
      await page.screenshot({ path: join(screenshotDir, "mobile-audio-preview.png") });
    }
    await dialog.locator('[data-act="delete-asset"]').click();
    await expect(dialog.locator("#modal-heading")).toHaveText("删除该音频？");
    await dialog.locator("#confirm").click();
    await expect(dialog).toBeHidden();
    await expect(audioCard).toHaveCount(0);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.locator('nav [data-nav="home"]').click();
    await expect(page.locator("#home-composer .reference-deck-count")).toHaveCount(0);

    console.log(
      "Verified uploaded video/audio metadata, accessible preview dialog, library actions, member ownership rules, reference-in-use alert, and single-item deletion",
    );
  } finally {
    await memberContext?.close();
    await adminContext.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const origin = process.env.STUDIO_VERIFY_URL;
  const name = process.env.STUDIO_VERIFY_USER ?? "admin";
  const passwordFile = process.env.STUDIO_VERIFY_PASSWORD_FILE;
  assert.ok(origin && passwordFile, "Set STUDIO_VERIFY_URL and STUDIO_VERIFY_PASSWORD_FILE");
  const password = (await readFile(passwordFile, "utf8")).trim();
  const browser = await chromium.launch();
  try {
    await checkUploadedMediaPreview(
      browser,
      origin,
      { name, password },
      process.env.STUDIO_VERIFY_SCREENSHOT_DIR,
    );
  } finally {
    await browser.close();
  }
}
