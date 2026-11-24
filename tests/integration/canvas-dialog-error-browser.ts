import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { chromium, expect, type Browser } from "@playwright/test";
import sharp from "sharp";
import { newNode } from "../../apps/web/canvas-editor/types.js";

const evidence = process.env.CANVAS_DIALOG_EVIDENCE;
const label = process.env.CANVAS_DIALOG_EVIDENCE_LABEL ?? "after";
const viewport = { width: 1440, height: 1000 };
const harness = spawn(
  process.execPath,
  ["--import", "tsx", "tests/integration/smoke-studio-nest.ts", "--serve"],
  { stdio: ["ignore", "pipe", "pipe"] },
);
const exited = once(harness, "exit");
let browser: Browser | undefined;

try {
  const [, origin, name, password] = await new Promise<RegExpMatchArray>(
    (resolve, reject) => {
      let output = "";
      const cleanup = () => {
        clearTimeout(timer);
        harness.stdout.off("data", read);
        harness.stderr.off("data", read);
        harness.off("error", failed);
        harness.off("exit", earlyExit);
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
          /Isolated Studio (http:\/\/[^\s]+)\/studio\nSynthetic login (\S+) \/ (\S+)\r?\n/,
        );
        if (!ready) return;
        cleanup();
        resolve(ready);
      };
      harness.stdout.on("data", read);
      harness.stderr.on("data", read);
      harness.once("error", failed);
      harness.once("exit", earlyExit);
    },
  );
  browser = await chromium.launch({ slowMo: evidence ? 300 : 0 });
  const context = await browser.newContext({
    baseURL: origin,
    viewport,
    colorScheme: "light",
    ...(evidence && label === "after"
      ? { recordVideo: { dir: evidence, size: viewport } }
      : {}),
  });
  try {
    const login = await context.request.post("/api/login", {
      data: { name, password },
    });
    assert.equal(login.status(), 200);
    const { workspace_id: workspace } = await (
      await context.request.get("/api/state")
    ).json();
    const headers = { Origin: origin, "X-Workspace-Id": String(workspace) };
    const bytes = await sharp({
      create: { width: 240, height: 160, channels: 3, background: "#537ec5" },
    })
      .png()
      .toBuffer();
    const upload = await context.request.post("/api/assets", {
      headers: { ...headers, "Content-Type": "image/png" },
      data: bytes,
    });
    assert.equal(upload.status(), 200, await upload.text());
    const created = await context.request.post("/api/canvases", {
      headers,
      data: { title: "画布参考图校验" },
    });
    assert.equal(created.status(), 200, await created.text());
    const project = await created.json();
    const reference = {
      ...newNode("image", 80, 100, 1),
      title: "参考图片",
      media_id: (await upload.json()).id,
    };
    const shot = { ...newNode("video", 500, 100, 1), title: "镜头 1" };
    const existing = Array.from({ length: 9 }, (_, i) =>
      newNode("image", 80, 440 + i * 280, i + 2),
    );
    const saved = await context.request.put(
      `/api/canvases/${project.id}/document`,
      {
        headers,
        data: {
          title: project.title,
          expected_revision: project.revision,
          document: {
            ...project.document,
            nodes: [reference, shot, ...existing],
            edges: existing.map(({ id }) => ({
              id: crypto.randomUUID(),
              source: id,
              target: shot.id,
            })),
            shots: [shot.id],
          },
        },
      },
    );
    assert.equal(saved.status(), 200, await saved.text());

    const page = await context.newPage();
    await page.goto(`/canvas/${project.id}?workspace=${workspace}`);
    await page.getByAltText(reference.title, { exact: true }).click();
    await page
      .getByRole("button", { name: "应用参考图到镜头", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "应用参考图到镜头" });
    await dialog.getByRole("checkbox", { name: /镜头 1/ }).check();
    await dialog.getByRole("button", { name: "应用到所选镜头" }).click();
    const alert = dialog.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toHaveText("最多连接 9 张参考图片");
    const color = await alert.evaluate((node) => getComputedStyle(node).color);
    console.log(`Reference dialog limit error color: ${color}`);
    if (evidence) {
      await page.mouse.move(10, 10);
      await page.screenshot({
        path: join(evidence, `canvas-dialog-${label}.png`),
      });
      await dialog.screenshot({
        path: join(evidence, `canvas-dialog-detail-${label}.png`),
      });
    }
    assert.equal(
      color,
      "rgb(162, 61, 54)",
      "dialog error should use the light canvas danger color",
    );
    await expect(
      dialog.getByText("勾选需要共用这张图的镜头。修改连线会影响后续生成。"),
    ).toHaveCSS("color", "rgb(112, 112, 112)");
    console.log("Canvas dialog error is red while help text remains muted");
    const video = page.video();
    if (video && evidence) {
      await context.close();
      await video.saveAs(join(evidence, "canvas-dialog-after.webm"));
    }
  } finally {
    await context.close();
  }
} finally {
  await browser?.close();
  harness.kill("SIGTERM");
  await exited;
}
