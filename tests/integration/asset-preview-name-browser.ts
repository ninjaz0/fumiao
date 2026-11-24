import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { chromium, expect } from "@playwright/test";
import sharp from "sharp";

const harness = spawn(
  process.execPath,
  ["--import", "tsx", "tests/integration/smoke-studio-nest.ts", "--serve"],
  { stdio: ["ignore", "pipe", "pipe"] },
);
const exited = once(harness, "exit");
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  const [, origin, user, password] = await new Promise<RegExpMatchArray>(
    (resolve, reject) => {
      let output = "";
      const timer = setTimeout(
        () => reject(new Error(`Studio harness startup timed out: ${output}`)),
        180_000,
      );
      const collect = (chunk: Buffer) => {
        output += chunk.toString();
        const login = output.match(
          /Isolated Studio (http:\/\/[^\s]+)\/studio\nSynthetic login ([^\s]+) \/ ([^\s]+)/,
        );
        if (login) {
          clearTimeout(timer);
          resolve(login);
        }
      };
      harness.stdout.on("data", collect);
      harness.stderr.on("data", collect);
      harness.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Studio harness exited: ${code}\n${output}`));
      });
    },
  );
  const audio = execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=duration=2",
    "-f",
    "wav",
    "pipe:1",
  ]);
  const video = execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x240:duration=2",
    "-c:v",
    "libx264",
    "-threads",
    "2",
    "-movflags",
    "frag_keyframe+empty_moov",
    "-f",
    "mp4",
    "pipe:1",
  ]);
  const image = await sharp({
    create: { width: 240, height: 160, channels: 3, background: "#537ec5" },
  })
    .png()
    .toBuffer();

  browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  const chooser = page.waitForEvent("filechooser");
  const evidence = process.env.ASSET_PREVIEW_EVIDENCE;
  await page.goto("/studio");
  await page.locator('[name="user"]').fill(user);
  await page.locator('[name="pw"]').fill(password);
  await page.locator('.auth-form [type="submit"]').click();
  await page.getByRole("button", { name: "添加参考内容" }).click();
  await page.getByRole("button", { name: "上传素材" }).click();
  await (
    await chooser
  ).setFiles([
    { name: "preview.wav", mimeType: "audio/wav", buffer: audio },
    { name: "preview.mp4", mimeType: "video/mp4", buffer: video },
    { name: "preview.png", mimeType: "image/png", buffer: image },
  ]);
  await expect(page.locator(".reference-deck-count")).toHaveText("3", {
    timeout: 30_000,
  });

  const cdp = await context.newCDPSession(page);
  const dialog = page.getByRole("dialog");
  async function accessibleName(media: string) {
    const { root } = await cdp.send("DOM.getDocument");
    const { nodeId } = await cdp.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: "#modal",
    });
    const { nodes } = await cdp.send("Accessibility.getPartialAXTree", {
      nodeId,
      fetchRelatives: false,
    });
    assert.equal(nodes[0].role?.value, "dialog");
    const name = String(nodes[0].name?.value ?? "");
    if (evidence) {
      await page.mouse.move(10, 10);
      await page.screenshot({ path: `${evidence}/${media}.png` });
      console.log(
        `Chromium AX (${media}): role=dialog name=${JSON.stringify(name)}`,
      );
    }
    return name;
  }

  const names = [];
  await page.locator('nav [data-nav="library"]').click();
  for (const [tab, media] of [
    ["语音", "audio"],
    ["视频", "video"],
  ]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    const opener = page.locator(
      '#library-grid .asset-preview[data-act="h3-preview"]',
    );
    await expect(opener).toHaveCount(1);
    await opener.press("Enter");
    await expect(dialog.locator(`${media}[controls]`)).toBeVisible();
    names.push(await accessibleName(media));
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  }

  await page.locator('nav [data-nav="home"]').click();
  await page.locator(".reference-deck-count").click();
  await page
    .locator('#popover button[data-act="h3-preview"]')
    .filter({ has: page.locator("img") })
    .click();
  await expect(dialog.locator("img")).toBeVisible();
  names.push(await accessibleName("image"));

  assert.deepEqual(names, ["音频预览", "视频预览", "图片预览"]);
  console.log(
    `Chromium dialog names: ${names.join("、")}; Escape restores the asset opener.`,
  );
} finally {
  await browser?.close();
  harness.kill("SIGTERM");
  await exited;
}
