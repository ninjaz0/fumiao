import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { chromium, expect, type Browser, type Page } from "@playwright/test";
import { newNode } from "../../apps/web/canvas-editor/types.js";

const evidence = process.env.CHAT_LIMIT_EVIDENCE;
const label = process.env.CHAT_LIMIT_EVIDENCE_LABEL ?? "after";
const viewport = { width: 1280, height: 800 };
const harness = spawn(
  process.execPath,
  ["--import", "tsx", "tests/integration/smoke-studio-nest.ts", "--serve"],
  { stdio: ["ignore", "pipe", "pipe"] },
);
const exited = once(harness, "exit");
let browser: Browser | undefined;

async function paste(page: Page, text: string) {
  await page.evaluate((value) => navigator.clipboard.writeText(value), text);
  await page.keyboard.press("ControlOrMeta+V");
}

async function capture(page: Page, name: string) {
  if (!evidence) return;
  await page.mouse.move(5, 5);
  await page.screenshot({ path: join(evidence, `${name}-${label}.png`) });
}

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
          /Isolated Studio (http:\/\/[^\s]+)\/studio\r?\nSynthetic login (\S+) \/ (\S+)\r?\n/,
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
  browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: origin,
    viewport,
    colorScheme: "light",
    permissions: ["clipboard-read", "clipboard-write"],
  });
  try {
    const login = await context.request.post("/api/login", {
      data: { name, password },
    });
    assert.equal(login.status(), 200);
    const page = await context.newPage();
    await page.goto("/studio");
    await expect(page.locator(".shell")).toBeVisible();
    await page.locator('nav [data-nav="chat"]').click();
    const composer = page.getByRole("textbox", { name: "发送消息" });
    await expect(
      page.getByRole("button", { name: "对话模型：DeepSeek Flash" }),
    ).toBeEnabled();
    const limit = page.locator(".fm-chat-limit");

    await composer.fill("短草稿");
    await expect(limit).toBeHidden();

    await composer.fill("");
    await paste(page, "a".repeat(12_340) + "末尾标记!");
    await expect(composer).toHaveJSProperty("value", "a".repeat(12_000));
    await capture(page, "chat-new");
    await expect(limit.getByRole("alert")).toContainText(
      "粘贴内容末尾 345 字未保留",
    );
    await expect(limit).toContainText("12000/12000 字");
    console.log("New chat: paste past the limit shows the dropped count");

    await composer.press("Backspace");
    await expect(limit).toHaveText("11999/12000 字");

    await page
      .locator(".fm-chat-history-items .fm-chat-conversation-row")
      .first()
      .click();
    await expect(page.locator(".fm-chat-message").first()).toBeVisible();
    await composer.fill("b".repeat(11_900));
    await expect(limit).toHaveText("11900/12000 字");
    await composer.evaluate((field: HTMLTextAreaElement) =>
      field.setSelectionRange(0, 100),
    );
    await paste(page, "c".repeat(300));
    await expect(composer).toHaveJSProperty(
      "value",
      "c".repeat(200) + "b".repeat(11_800),
    );
    await expect(limit.getByRole("alert")).toContainText(
      "粘贴内容末尾 100 字未保留",
    );
    console.log("Existing chat: paste over a selection reports what was cut");

    await composer.fill("");
    await paste(page, "d".repeat(500));
    await expect(limit).toBeHidden();

    const { workspace_id: workspace } = await (
      await context.request.get("/api/state")
    ).json();
    const headers = { Origin: origin, "X-Workspace-Id": String(workspace) };
    const created = await context.request.post("/api/canvases", {
      headers,
      data: { title: "长文本粘贴" },
    });
    assert.equal(created.status(), 200, await created.text());
    const project = await created.json();
    const text = { ...newNode("text", 200, 160, 1), title: "文案" };
    const saved = await context.request.put(
      `/api/canvases/${project.id}/document`,
      {
        headers,
        data: {
          title: project.title,
          expected_revision: project.revision,
          document: { ...project.document, nodes: [text], edges: [] },
        },
      },
    );
    assert.equal(saved.status(), 200, await saved.text());
    await page.goto(`/canvas/${project.id}?workspace=${workspace}`);
    await page.locator(`.react-flow__node[data-id="${text.id}"]`).click();
    const inline = page.getByRole("textbox", { name: "文本生成要求" });
    await expect(inline).toBeVisible();
    await inline.click();
    await paste(page, "e".repeat(12_001));
    await expect(inline).toHaveJSProperty("value", "e".repeat(12_000));
    await capture(page, "canvas-text");
    await expect(
      page.locator(".fm-chat-node .fm-chat-limit").getByRole("alert"),
    ).toContainText("粘贴内容末尾 1 字未保留");
    console.log("Canvas text node: paste past the limit shows the dropped count");
  } finally {
    await context.close();
  }
} finally {
  await browser?.close();
  harness.kill("SIGTERM");
  await exited;
}
