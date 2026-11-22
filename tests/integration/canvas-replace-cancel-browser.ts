import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { after, before, test } from "node:test";
import { join } from "node:path";
import { chromium, expect, type Browser } from "@playwright/test";
import sharp from "sharp";
import { newNode } from "../../apps/web/canvas-editor/types.js";

let baseURL: string;
let username: string;
let password: string;
let harness: ChildProcess;
let browser: Browser;
before(
  async () => {
    harness = spawn(
      process.execPath,
      ["--import", "tsx", "tests/integration/smoke-studio-nest.ts", "--serve"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    await new Promise<void>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(
        () => failed(new Error("Studio harness startup timed out")),
        180_000,
      );
      const cleanup = () => {
        clearTimeout(timer);
        harness.stdout!.off("data", read);
        harness.stderr!.off("data", read);
        harness.off("error", failed);
        harness.off("exit", exited);
      };
      const failed = (error: Error) => {
        cleanup();
        reject(error);
      };
      const exited = (code: number | null) =>
        failed(
          new Error(
            `Studio harness exited with ${code}: ${output.replace(/^Synthetic login .*$/gm, "Synthetic login [redacted]")}`,
          ),
        );
      const read = (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-16000);
        const origin = output.match(
          /Isolated Studio (http:\/\/[^\s]+)\/studio/,
        );
        const login = output.match(/Synthetic login (\S+) \/ (\S+)\r?\n/);
        if (!origin || !login) return;
        [baseURL, username, password] = [origin[1], login[1], login[2]];
        cleanup();
        resolve();
      };
      harness.stdout!.on("data", read);
      harness.stderr!.on("data", read);
      harness.once("error", failed);
      harness.once("exit", exited);
    });
    console.log("Started isolated Studio harness");
    browser = await chromium.launch({
      headless: !process.env.STUDIO_NATIVE_PICKER,
    });
  },
  { timeout: 190_000 },
);
after(
  async () => {
    try {
      await browser?.close();
    } finally {
      if (
        harness?.pid &&
        harness.exitCode === null &&
        harness.signalCode === null
      ) {
        const closed = once(harness, "exit");
        const timer = setTimeout(() => harness.kill("SIGKILL"), 30_000);
        harness.kill("SIGTERM");
        try {
          await closed;
        } finally {
          clearTimeout(timer);
        }
        console.log("Stopped isolated Studio harness");
      }
    }
  },
  { timeout: 40_000 },
);

test(
  "cancelled image replacement does not capture a canvas drop",
  { timeout: 30000 },
  async () => {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 1440, height: 1000 },
    });
    try {
      const login = await context.request.post("/api/login", {
        data: { name: username, password },
      });
      assert.equal(login.status(), 200);
      const { workspace_id: workspace } = await (
        await context.request.get("/api/state")
      ).json();
      const headers = { Origin: baseURL, "X-Workspace-Id": String(workspace) };
      const originalBytes = await sharp({
        create: { width: 240, height: 160, channels: 3, background: "#537ec5" },
      })
        .png()
        .toBuffer();
      const droppedBytes = await sharp({
        create: { width: 240, height: 160, channels: 3, background: "#e7a34c" },
      })
        .png()
        .toBuffer();
      const uploaded = await context.request.post("/api/assets", {
        headers: { ...headers, "Content-Type": "image/png" },
        data: originalBytes,
      });
      assert.equal(uploaded.status(), 200, await uploaded.text());
      const originalMedia = (await uploaded.json()).id;
      const created = await context.request.post("/api/canvases", {
        headers,
        data: { title: "Replace cancel regression" },
      });
      assert.equal(created.status(), 200, await created.text());
      const { id } = await created.json();
      const path = "/api/canvases/" + id;
      const project = await (
        await context.request.get(path, { headers })
      ).json();
      const original = {
        ...newNode("image", 40, 80, 1),
        title: "Original image",
        width: 360,
        height: 240,
        media_id: originalMedia,
      };
      const seeded = await context.request.put(path + "/document", {
        headers,
        data: {
          title: project.title,
          expected_revision: project.revision,
          document: { ...project.document, nodes: [original] },
        },
      });
      assert.equal(seeded.status(), 200, await seeded.text());
      const page = await context.newPage();
      await page.goto(`/canvas/${id}?workspace=${workspace}`);
      const node = page
        .locator(".react-flow__node")
        .filter({ has: page.getByAltText("Original image", { exact: true }) });
      await expect(
        page.getByAltText("Original image", { exact: true }),
      ).toHaveJSProperty("naturalWidth", 240);
      await node.click();
      await page.getByRole("button", { name: "替换内容", exact: true }).click();
      const input = page.locator('input[type="file"]').first();
      await input.evaluate((input) => {
        input.addEventListener(
          "cancel",
          () => input.setAttribute("data-cancelled", "true"),
          { once: true },
        );
      });
      if (process.env.STUDIO_NATIVE_PICKER) {
        await page
          .locator(".picker-filter")
          .getByRole("button", { name: "上传图片" })
          .click();
        const window = execFileSync(
          "xdotool",
          ["search", "--sync", "--onlyvisible", "--name", "Open File"],
          { timeout: 10000 },
        )
          .toString()
          .trim()
          .split("\n")
          .at(-1)!;
        execFileSync("xdotool", ["windowactivate", "--sync", window]);
        execFileSync("xdotool", ["key", "Escape"]);
      } else {
        const chooserPromise = page.waitForEvent("filechooser");
        await page
          .locator(".picker-filter")
          .getByRole("button", { name: "上传图片" })
          .click();
        await chooserPromise;
        await input.dispatchEvent("cancel");
      }
      await expect(input).toHaveAttribute("data-cancelled", "true");
      console.log("Replacement picker cancelled (input cancel event observed)");
      const transfer = await page.evaluateHandle(
        ({ bytes }) => {
          const dt = new DataTransfer();
          dt.items.add(
            new File([new Uint8Array(bytes)], "dropped.png", {
              type: "image/png",
            }),
          );
          return dt;
        },
        { bytes: [...droppedBytes] },
      );
      await page.locator(".react-flow__pane").dispatchEvent("drop", {
        dataTransfer: transfer,
        clientX: 1000,
        clientY: 650,
      });
      await expect
        .poll(async () => {
          const saved = await (
            await context.request.get(path, { headers })
          ).json();
          return saved.revision;
        })
        .toBeGreaterThan(project.revision + 1);
      const saved = await (await context.request.get(path, { headers })).json();
      const unchanged =
        saved.document.nodes.find((n: { id: string }) => n.id === original.id)
          ?.media_id === originalMedia;
      console.log(
        `After drop: nodes=${saved.document.nodes.length}, original image unchanged=${unchanged}`,
      );
      await page.mouse.move(1400, 950);
      await page
        .locator("input")
        .first()
        .evaluate((el) => (el as HTMLElement).blur());
      if (process.env.STUDIO_EVIDENCE)
        await page.screenshot({
          path: join(
            process.env.STUDIO_EVIDENCE,
            process.env.STUDIO_BEFORE
              ? "canvas-replace-before.png"
              : "canvas-replace-after.png",
          ),
          fullPage: true,
        });
      assert.equal(
        saved.document.nodes.length,
        2,
        "drop after cancellation must add a second node",
      );
      assert.equal(unchanged, true, "original image must not be replaced");
      await expect(page.locator(".react-flow__node")).toHaveCount(2);
    } finally {
      await context.close();
    }
  },
);
