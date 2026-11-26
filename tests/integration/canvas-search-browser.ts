import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { join } from "node:path";
import { after, before, test } from "node:test";
import {
  chromium,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

const evidence = process.env.CANVAS_SEARCH_EVIDENCE;
const viewport = { width: 1280, height: 800 };
const title = "镜头规划 Canvas";
const harness = spawn(
  process.execPath,
  ["--import", "tsx", "tests/integration/smoke-studio-nest.ts", "--serve"],
  { stdio: ["ignore", "pipe", "pipe"] },
);
const exited = once(harness, "exit");
let browser: Browser | undefined;
let context: BrowserContext | undefined;
let page: Page;
let initialCount: number;
let studioLogin: { origin: string; name: string; password: string };
let workspaceHeaders: { Origin: string; "X-Workspace-Id": string };

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
          `Studio harness exited with ${code}: ${output.replace(/^Synthetic login .*$/gm, "Synthetic login [redacted]")}`,
        );
      }),
    ]);
    studioLogin = { origin, name, password };
    browser = await chromium.launch({ slowMo: evidence ? 600 : 0 });
    context = await browser.newContext({
      baseURL: origin,
      viewport,
      ...(evidence ? { recordVideo: { dir: evidence, size: viewport } } : {}),
    });
    const login = await context.request.post("/api/login", {
      data: { name, password },
    });
    assert.equal(login.status(), 200);
    const state = await context.request.get("/api/state");
    assert.equal(state.status(), 200);
    const { workspace_id: workspace } = await state.json();
    workspaceHeaders = { Origin: origin, "X-Workspace-Id": String(workspace) };
    const created = await context.request.post("/api/canvases", {
      headers: workspaceHeaders,
      data: { title },
    });
    assert.equal(created.status(), 200, await created.text());
    const fixture = await created.json();
    const saved = await context.request.put(
      `/api/canvases/${fixture.id}/document`,
      {
        headers: workspaceHeaders,
        data: {
          expected_revision: fixture.revision,
          title,
          document: {
            nodes: [{ id: "archive-review", type: "text", x: 80, y: 80 }],
          },
        },
      },
    );
    assert.equal(saved.status(), 200, await saved.text());
    page = await context.newPage();
    await page.goto("/studio");
    await page.getByRole("button", { name: "画布", exact: true }).click();
    await expect(
      page.getByRole("link", { name: "打开画布 " + title, exact: true }),
    ).toBeVisible();
    initialCount = await page.locator(".project-card").count();
    assert.ok(initialCount > 1);
  },
  { timeout: 190_000 },
);

after(
  async () => {
    try {
      await context?.close();
      await browser?.close();
    } finally {
      harness.kill("SIGTERM");
      await exited;
    }
  },
  { timeout: 40_000 },
);

async function screenshot(name: string) {
  if (!evidence) return;
  await page.mouse.move(10, 10);
  await page.screenshot({ path: join(evidence, `${name}.png`) });
}

test("canvas search explains no matches and clears the query", async () => {
  const search = page.getByRole("textbox", { name: "搜索画布" });
  const cards = page.locator(".project-card");
  await search.fill("没有这张画布");
  await expect(cards).toHaveCount(0);
  await screenshot("no-match");
  await expect(
    page.getByRole("heading", { name: "没有找到匹配的画布" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "清除搜索" }).click();
  await expect(search).toHaveValue("");
  await expect(cards).toHaveCount(initialCount);
});

test("canvas search ignores surrounding whitespace and letter case", async () => {
  const search = page.getByRole("textbox", { name: "搜索画布" });
  const cards = page.locator(".project-card");
  await search.fill(`  ${title.toLowerCase()}  `);
  await screenshot("padded-title");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText(title);
  await search.fill("   ");
  await expect(cards).toHaveCount(initialCount);
});

test("canvas list can recover from a failed request", async () => {
  let fail = true;
  await page.route("**/api/canvases", (route) =>
    fail
      ? route.fulfill({ status: 503, json: { detail: "暂时无法读取画布" } })
      : route.continue(),
  );
  try {
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "画布列表暂时无法加载" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "暂无画布" })).toBeHidden();
    fail = false;
    await page.getByRole("button", { name: "重试" }).click();
    await expect(
      page.getByRole("link", { name: "打开画布 " + title, exact: true }),
    ).toBeVisible();
  } finally {
    await page.unroute("**/api/canvases");
  }
});

test("canvas archive can be undone and restored after opening the original link", async () => {
  const cover = page.getByRole("link", {
    name: `打开画布 ${title}`,
    exact: true,
  });
  const more = page.getByRole("button", {
    name: `更多操作 ${title}`,
    exact: true,
  });
  const archive = page.getByRole("menuitem", { name: "归档", exact: true });
  const archivedTab = page.getByRole("tab", { name: "已归档", exact: true });
  const currentTab = page.getByRole("tab", { name: "当前", exact: true });
  const originalLink = (await cover.getAttribute("href"))!;
  const card = page.locator(".project-card").filter({ has: cover });
  const assertCardTitleWidth = async () => {
    const title = await card.locator(".project-card-info > a").boundingBox();
    const bounds = await card.boundingBox();
    assert.ok(title && bounds && title.width >= bounds.width - 1);
  };
  await more.focus();
  await more.press("Enter");
  await expect(archive).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(more).toBeFocused();
  const archiveEndpoint = `**/api/canvases/${originalLink.split("/").at(-1)!.split("?")[0]}/archive`;
  await page.route(archiveEndpoint, (route) =>
    route.fulfill({ status: 503, json: { detail: "暂时无法归档画布" } }),
  );
  try {
    await more.click();
    await archive.click();
    await expect(
      page.getByRole("alert").filter({ hasText: "暂时无法归档画布" }),
    ).toBeVisible();
    await expect(cover).toBeVisible();
    await expect(more).toBeFocused();
  } finally {
    await page.unroute(archiveEndpoint);
  }
  await more.click();
  await archive.click();
  await expect(cover).toHaveCount(0);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(cover).toBeVisible();
  await expect(
    page.getByRole("button", { name: "撤销", exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 860 });
  await assertCardTitleWidth();

  await more.click();
  await archive.click();
  await expect(cover).toHaveCount(0);
  await currentTab.focus();
  await currentTab.press("ArrowRight");
  await expect(archivedTab).toHaveAttribute("aria-selected", "true");
  await expect(cover).toBeVisible();
  await assertCardTitleWidth();
  await page.setViewportSize(viewport);
  await page.reload();
  await expect(archivedTab).toHaveAttribute("aria-selected", "true");
  await expect(cover).toBeVisible();

  await page.goto(originalLink);
  const badge = page.locator(".canvas-archived-pill");
  await expect(badge).toHaveText("已归档");
  const input = page.getByRole("textbox", { name: "画布名称" });
  await expect(input).toBeEditable();
  const node = page.locator('.react-flow__node[data-id="archive-review"]');
  await node.click();
  await expect(node).toHaveClass(/selected/);
  const projectMenu = page.getByRole("button", { name: "项目菜单" });
  const restore = page.getByRole("button", { name: "恢复画布", exact: true });
  await page.route(archiveEndpoint, (route) =>
    route.fulfill({ status: 503, json: { detail: "暂时无法恢复画布" } }),
  );
  try {
    await projectMenu.click();
    await restore.press("Enter");
    await expect(
      page.getByText("暂时无法恢复画布", { exact: true }),
    ).toBeVisible();
    await expect(restore).toBeFocused();
    await page.keyboard.press("Delete");
    await expect(node).toHaveClass(/selected/);
  } finally {
    await page.unroute(archiveEndpoint);
  }
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested = page.waitForRequest(
    (request) =>
      request.url().endsWith("/archive") && request.method() === "DELETE",
  );
  await page.route(archiveEndpoint, async (route) => {
    await held;
    await route.continue();
  });
  try {
    await restore.click();
    await requested;
    await input.click();
    await expect(input).toBeFocused();
  } finally {
    release();
  }
  await expect(badge).toHaveCount(0);
  await expect(input).toBeFocused();
  await page.unrouteAll({ behavior: "wait" });
  await page.getByRole("button", { name: "所有画布", exact: true }).click();
  await expect(currentTab).toHaveAttribute("aria-selected", "true");
  await expect(cover).toBeVisible();
});

test("archive refresh errors preserve other cards and stale undo is rejected", async () => {
  const cover = page.getByRole("link", {
    name: `打开画布 ${title}`,
    exact: true,
  });
  const other = page.locator(".project-card").filter({ hasNot: cover }).first();
  const more = page.getByRole("button", {
    name: `更多操作 ${title}`,
    exact: true,
  });
  const archive = page.getByRole("menuitem", { name: "归档", exact: true });
  const path = new URL((await cover.getAttribute("href"))!, studioLogin.origin)
    .pathname;
  const endpoint = `/api/canvases/${path.split("/").at(-1)}/archive`;
  await page.route("**/api/canvases", (route) =>
    route.fulfill({ status: 503, json: { detail: "暂时无法刷新" } }),
  );
  try {
    await more.click();
    await archive.click();
    await expect(page.getByRole("button", { name: "重试刷新" })).toBeVisible();
    await expect(other).toBeVisible();
  } finally {
    await page.unroute("**/api/canvases");
  }
  await page.getByRole("button", { name: "重试刷新" }).click();
  await expect(page.getByRole("button", { name: "重试刷新" })).toHaveCount(0);
  assert.equal(
    (
      await context!.request.delete(endpoint, { headers: workspaceHeaders })
    ).status(),
    200,
  );
  assert.equal(
    (
      await context!.request.put(endpoint, { headers: workspaceHeaders })
    ).status(),
    200,
  );
  const undo = page.getByRole("button", { name: "撤销", exact: true });
  await undo.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "归档状态已发生变化" }),
  ).toBeVisible();
  await expect(undo).toHaveCount(0);
  await page.getByRole("tab", { name: "已归档" }).click();
  await expect(cover).toBeVisible();
  assert.equal(
    (
      await context!.request.delete(endpoint, { headers: workspaceHeaders })
    ).status(),
    200,
  );
});

test("sign-in returns to the archived canvas view", async () => {
  const guest = await browser!.newContext({ baseURL: studioLogin.origin });
  try {
    const guestPage = await guest.newPage();
    await guestPage.goto("/canvas?view=archived");
    await guestPage.locator('[name="user"]').fill(studioLogin.name);
    await guestPage.locator('[name="pw"]').fill(studioLogin.password);
    await guestPage.locator('.auth-form [type="submit"]').click();
    await expect(
      guestPage.getByRole("tab", { name: "已归档" }),
    ).toHaveAttribute("aria-selected", "true");
  } finally {
    await guest.close();
  }
});

test("team members can open archived canvases but cannot change their archive state", async () => {
  const suffix = randomUUID().slice(0, 8);
  const team = await context!.request.post("/api/workspaces", {
    headers: { Origin: studioLogin.origin },
    data: { name: `归档权限 ${suffix}`, members: [] },
  });
  assert.equal(team.status(), 200);
  const { id: teamId } = await team.json();
  const headers = {
    Origin: studioLogin.origin,
    "X-Workspace-Id": String(teamId),
  };
  const invite = await context!.request.post("/api/invite-codes", {
    headers,
    data: {
      name: "归档权限验证",
      expires: null,
      grant_credits: false,
      initial_credits: 0,
      team_id: teamId,
    },
  });
  assert.equal(invite.status(), 200);
  const { code } = await invite.json();
  const sharedTitle = `归档权限画布 ${suffix}`;
  const created = await context!.request.post("/api/canvases", {
    headers,
    data: { title: sharedTitle },
  });
  assert.equal(created.status(), 200);
  const { id } = await created.json();
  const archivePath = `/api/canvases/${id}/archive`;
  const member = await browser!.newContext({ baseURL: studioLogin.origin });
  try {
    assert.equal(
      (
        await member.request.post("/api/register", {
          headers: { Origin: studioLogin.origin },
          data: {
            name: `archive-member-${suffix}`,
            nickname: "归档测试成员",
            password: randomUUID(),
            code,
          },
        })
      ).status(),
      200,
    );
    const page = await member.newPage();
    await page.goto(`/canvas?workspace=${teamId}`);
    const cover = page.getByRole("link", {
      name: `打开画布 ${sharedTitle}`,
      exact: true,
    });
    await expect(cover).toBeVisible();
    await expect(
      page.getByRole("button", { name: `更多操作 ${sharedTitle}` }),
    ).toHaveCount(0);
    assert.equal(
      (await member.request.put(archivePath, { headers })).status(),
      403,
    );
    assert.equal(
      (await context!.request.put(archivePath, { headers })).status(),
      200,
    );
    await page.getByRole("tab", { name: "已归档" }).click();
    await expect(cover).toBeVisible();
    await expect(
      page.getByRole("button", { name: `恢复画布 ${sharedTitle}` }),
    ).toHaveCount(0);
    assert.equal(
      (await member.request.delete(archivePath, { headers })).status(),
      403,
    );
    await cover.click();
    await expect(page.locator(".canvas-archived-pill")).toBeVisible();
    await page.getByRole("button", { name: "项目菜单" }).click();
    await expect(
      page.getByRole("button", { name: "恢复画布", exact: true }),
    ).toHaveCount(0);
  } finally {
    await member.close();
  }
});
