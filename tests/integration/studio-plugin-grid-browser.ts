import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { chromium, expect, type Browser, type Page } from "@playwright/test";
import { settings, setTab } from "./studio-settings-browser.js";

const harness = spawn(
  process.execPath,
  ["--import", "tsx", "tests/integration/smoke-studio-nest.ts", "--serve"],
  { stdio: ["ignore", "pipe", "pipe"] },
);
const exited = once(harness, "exit");
const cards = ".plugin-connections > .plugin-connection";
let browser: Browser | undefined;
let page: Page;

before(
  async () => {
    let output = "";
    const ready = new Promise<RegExpMatchArray>((resolve) => {
      const collect = (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-16000);
        const match = output.match(
          /Isolated Studio (http:\/\/[^\s]+)\/studio\r?\nSynthetic login (\S+) \/ (\S+)\r?\n/,
        );
        if (match) resolve(match);
      };
      harness.stdout.on("data", collect);
      harness.stderr.on("data", collect);
    });
    const [, origin, name, password] = await Promise.race([
      ready,
      exited.then(([code]) => {
        throw new Error(
          `Studio exited with ${code}: ${output.replace(/^Synthetic login .*$/gm, "[redacted]")}`,
        );
      }),
    ]);
    browser = await chromium.launch();
    const context = await browser.newContext({
      baseURL: origin,
      viewport: { width: 1280, height: 900 },
      colorScheme: "light",
    });
    const login = await context.request.post("/api/login", {
      data: { name, password },
    });
    assert.equal(login.status(), 200);
    for (const id of ["flow", "gpu", "muse"]) {
      const file = JSON.parse(
        await readFile(`plugins/${id}/${id}.fmplugin.json`, "utf8"),
      );
      const install = await context.request.post("/api/admin/plugins/import", {
        headers: { Origin: origin },
        data: { file },
      });
      assert.equal(install.status(), 201, await install.text());
    }
    page = await context.newPage();
    await page.goto("/studio");
    await settings(page);
    await setTab(page, "plugins");
    await expect(page.locator(cards)).toHaveCount(3);
  },
  { timeout: 190_000 },
);

after(
  async () => {
    try {
      await browser?.close();
    } finally {
      harness.kill("SIGTERM");
      await exited;
    }
  },
  { timeout: 40_000 },
);

async function gridGeometry() {
  return page.locator(cards).evaluateAll((elements) => {
    const box = elements.map((element) => element.getBoundingClientRect());
    const [first, second, third] = box;
    const columns = new Set(box.map(({ x }) => x)).size;
    return {
      columns,
      topOffset: columns === 2 ? second.top - first.top : null,
      rowGaps:
        columns === 2
          ? [third.top - Math.max(first.bottom, second.bottom)]
          : [second.top - first.bottom, third.top - second.bottom],
      footerInsets: elements.map((element, i) => {
        const { left, right, bottom } = box[i];
        const footer = element
          .querySelector(".plugin-card-foot")!
          .getBoundingClientRect();
        const style = getComputedStyle(element);
        return [
          footer.left - left - parseFloat(style.borderLeftWidth),
          right - footer.right - parseFloat(style.borderRightWidth),
          bottom - footer.bottom - parseFloat(style.borderBottomWidth),
        ];
      }),
    };
  });
}

test("plugin grid owns spacing and footers in both themes and on narrow screens", async () => {
  const footerInsets = Array.from({ length: 3 }, () => [0, 0, 0]);
  const desktop = { columns: 2, topOffset: 0, rowGaps: [14], footerInsets };
  expect(await gridGeometry()).toEqual(desktop);
  await expect(page.locator(".plugin-heading p")).toHaveCSS(
    "margin-bottom",
    "0px",
  );
  const theme = page.getByRole("button", { name: "切换外观主题" });
  await theme.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await gridGeometry()).toEqual(desktop);
  await page.setViewportSize({ width: 480, height: 960 });
  expect(await gridGeometry()).toEqual({
    columns: 1,
    topOffset: null,
    rowGaps: [14, 14],
    footerInsets,
  });
});

test("plugin drawer and contributed settings page keep their own heading styles", async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const gpu = page.locator(cards).filter({
    has: page.getByRole("switch", { name: "GPU 节点开关" }),
  });
  await gpu.getByRole("button", { name: "设置", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: /GPU 节点/ });
  const title = drawer.getByRole("heading", { level: 3 });
  await expect(title).toHaveCSS("font-size", "16px");
  await expect(title).toHaveCSS("font-weight", "650");
  await drawer.getByRole("button", { name: "关闭插件设置" }).click();
  await setTab(page, "plugin:gpu:nodes");
  const heading = page.locator(".plugin-page > .page-heading");
  await expect(heading).toHaveText(/GPU 实例/);
  await expect(heading).toHaveCSS("margin-bottom", "0px");
});
