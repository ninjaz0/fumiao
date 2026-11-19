/** Pinned Studio GPU settings over the real Python and Nest compatibility APIs. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, expect, type Page } from "@playwright/test";
import type { StudioState } from "../apps/web/studio/state.js";
import {
  action,
  assertStudio,
  all,
  compare,
  open,
  pair,
  request,
  requestContract,
  settings,
  setTab,
  tab,
  type Comparison,
} from "./studio-settings-browser.js";
import {
  fetchAs,
  json,
  settingsFixture,
  type Backend,
} from "./studio-settings-fixture.js";

const out = resolve(".runtime-advanced/studio-gpu-settings-parity");
const models = ["MiniMax H3", "breeze-tts-2"];
const modelSlugs = "minimax-h3,breeze-tts-2";
const commandField = "#modal textarea.mono";
const modal = (page: Page) => page.locator("#modal");
const form = (page: Page) => modal(page).locator("#pair");
const submit = (page: Page) => form(page).locator("button");
const model = (page: Page, value: string) =>
  form(page).locator(`[name="models"][value="${value}"]`);
const control = (page: Page, id: number, op: string) =>
  page.locator(`[data-act="node"][data-id="${id}"][data-op="${op}"]`);
const state = (backend: Backend, cookie: string, workspace?: number) =>
  fetchAs(backend.web, cookie, "/api/state", { workspace }).then(
    json<StudioState>,
  );
const close = async (page: Page) => {
  await page.keyboard.press("Escape");
  await expect(modal(page)).toBeHidden();
};
const closePairing = async (page: Page) => {
  await close(page);
  return page.evaluate(async () => {
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    );
    const active = document.activeElement;
    return [
      active?.tagName,
      active?.getAttribute("data-act"),
      active?.className,
    ];
  });
};
const replicaLabel = "回环成员 <测试>";
const failureLabel = "回环准备失败";
const offlineLabel = "回环离线";
type Pairing = {
  name: string;
  command: string;
  models: string[];
  expires: number;
};
type Binding = { id: number; token: string; code: string };
type Role = "admin" | "member";

function codeFrom(pairing: Pairing, site: string, slugs: string) {
  const prefix = `curl -fsSL ${site}/connect/install.sh -o /tmp/fumiao-install.sh && FUMIAO_SITE=${site} bash /tmp/fumiao-install.sh --models=${slugs} `;
  assert.ok(pairing.command.startsWith(prefix), "loopback command prefix");
  const code = pairing.command.slice(prefix.length);
  assert.ok(/^[A-Za-z0-9_-]{43}$/.test(code), "one-time pairing code format");
  return code;
}

function agent(backend: Backend, path: string, body?: object, token?: string) {
  return fetch(backend.web + "/agent/" + path, {
    method: body ? "POST" : "GET",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
}

async function bind(backend: Backend, code: string): Promise<Binding> {
  const token = randomBytes(32).toString("base64url");
  await json(await agent(backend, "enroll", { code, secret: token }));
  const { id } = await json<{ id: number }>(
    await agent(backend, "registration", undefined, token),
  );
  return { id, token, code };
}

async function seed(
  backend: Backend,
  role: Role,
  name: string,
  selected = models,
) {
  const pairing = await json<Pairing>(
    await fetchAs(backend.web, backend[role], "/api/pairs", {
      body: { name, models: selected },
    }),
  );
  return bind(
    backend,
    codeFrom(
      pairing,
      backend.web,
      selected.length === 1 ? "minimax-h3" : modelSlugs,
    ),
  );
}

async function beat(
  backend: Backend,
  binding: Binding,
  stage: string,
  fields: object = {},
) {
  return json<{ control: string }>(
    await agent(backend, "heartbeat", { stage, ...fields }, binding.token),
  );
}

async function openGpu(
  page: Page,
  react: boolean,
  workspace: number,
  role: Role,
) {
  await open(page, "/studio", react, workspace);
  await enterGpu(page, react, role);
}

async function enterGpu(page: Page, react: boolean, role: Role) {
  await settings(page);
  await setTab(page, "gpu");
  await expect(tab(page, "gpu")).toHaveText(
    role === "admin" ? "GPU 实例" : "GPU 接入",
  );
  await expect(tab(page, "gpu")).toHaveAttribute("aria-current", "page");
  await assertStudio(page, react);
}

const fixture = await settingsFixture({ gpu: true });
const savedSite = process.env.PUBLIC_URL;
const comparisons: Comparison[] = [];
const workflows: string[] = [];
const errors: string[] = [];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let step = "launch";

try {
  await mkdir(out, { recursive: true });
  browser = await chromium.launch({ args: ["--disable-partial-raster"] });
  const backends = Object.entries(fixture.backends);
  const adminSpace = (
    await state(fixture.backends.python, fixture.backends.python.admin)
  ).workspace_id;
  const seeded = new Map<string, Binding>();
  for (const [name, backend] of backends) {
    process.env.PUBLIC_URL = backend.web;
    step = name + "-empty";
    const empty = await pair(browser, errors, backend, "member", 1440, "light");
    try {
      await all(empty, async (page, react) => {
        await openGpu(page, react, fixture.team, "member");
        await expect(page.locator(".list-surface .empty-state")).toHaveText(
          "暂无接入实例",
        );
      });
      comparisons.push(
        await compare(
          out,
          step,
          empty.map(({ page }) => page),
          "GPU 实例",
        ),
      );
    } finally {
      await Promise.all(empty.map(({ context }) => context.close()));
    }
    const own = await seed(backend, "member", replicaLabel);
    seeded.set(name, own);
    await beat(backend, own, "ready", {
      ready_models: models,
      detail: "仅隐藏就绪详情",
      profile: {
        gpu_name: "回环 GPU <24>",
        backend: "cuda",
        vram_gib: 24.5,
        available_gpus: 1,
        used_gpus: 1,
      },
    });
    await beat(backend, await seed(backend, "admin", failureLabel), "error", {
      detail: "合成准备错误 < >",
    });
    const offline = await seed(backend, "admin", offlineLabel);
    await json(
      await fetchAs(
        backend.web,
        backend.admin,
        `/api/nodes/${offline.id}/stop`,
        { body: {} },
      ),
    );
    await beat(backend, offline, "preparing", { detail: "完整模式已就绪" });
    await fixture.ageNode(backend.web, offline.id);
  }

  for (const width of [1440, 390])
    for (const theme of ["light", "dark"])
      for (const role of ["admin", "member"] as const) {
        const groups = await Promise.all(
          backends.map(async ([name, backend]) => ({
            name,
            pairs: await pair(browser!, errors, backend, role, width, theme),
          })),
        );
        const workspace = role === "member" ? fixture.team : adminSpace;
        const every = <T>(run: (page: Page, react: boolean) => Promise<T>) =>
          Promise.all(groups.map(({ pairs }) => all(pairs, run)));
        async function check(label: string, heading: string) {
          step = `${width}-${theme}-${role}-${label}`;
          for (const group of groups)
            comparisons.push(
              await compare(
                out,
                group.name + "-" + step,
                group.pairs.map(({ page }) => page),
                heading,
              ),
            );
          comparisons.push(
            await compare(
              out,
              "cross-backend-" + step,
              groups.map(({ pairs }) => pairs[1].page),
              heading,
            ),
          );
        }
        try {
          await every(async (page, react) => {
            await openGpu(page, react, workspace, role);
            const rows = page.locator(".node-row");
            await expect(rows.locator("h2")).toHaveText(
              role === "member"
                ? [replicaLabel]
                : [offlineLabel, failureLabel, replicaLabel],
            );
            await expect(rows.locator(".node-state")).toHaveText(
              role === "member" ? ["就绪"] : ["离线", "准备失败", "就绪"],
            );
            await expect(rows.locator(".install-detail")).toHaveText(
              role === "member" ? [] : ["合成准备错误 < >"],
            );
            await expect(rows.locator(".metadata").last()).toContainText(
              "回环 GPU <24> · 24.5 GiB",
            );
            await expect(action(page, "node")).toHaveCount(
              role === "member" ? 0 : 8,
            );
          });
          await check("rows", "GPU 实例");
          if (role === "admin") {
            await every(async (page) => {
              await page
                .locator(".node-row")
                .filter({
                  has: page.getByText(offlineLabel, { exact: true }),
                })
                .locator('[data-op="remove"]')
                .click();
              await expect(modal(page).locator("p")).toHaveText(
                "此实例的接入凭据将失效。",
              );
            });
            await check("confirmation", "移除？");
            await every(close);
          }
          await every(async (page) => {
            await action(page, "pair").click();
            await expect(form(page).locator('[name="node"]')).toHaveValue(
              "弗淼001",
            );
            await expect(model(page, models[0])).toBeChecked();
            await expect(model(page, models[1])).not.toBeChecked();
          });
          await check("registration", "接入GPU实例");
          for (const [original, react] of await every(closePairing))
            assert.deepEqual(react, original, "pairing dialog return focus");
        } finally {
          await Promise.all(
            groups.flatMap(({ pairs }) =>
              pairs.map(({ context }) => context.close()),
            ),
          );
        }
      }

  const projections: unknown[] = [];
  for (const [name, backend] of backends) {
    process.env.PUBLIC_URL = backend.web;
    const own = seeded.get(name)!;
    const mine = (await state(backend, backend.member, fixture.personal)).nodes;
    const team = (await state(backend, backend.member, fixture.team)).nodes;
    assert.deepEqual(
      mine,
      team,
      "member nodes follow the account into team space",
    );
    assert.deepEqual(
      mine.map(({ id }) => id),
      [own.id],
    );
    const foreign = await fetchAs(backend.web, backend.member, "/api/state", {
      workspace: adminSpace,
    });
    assert.equal(foreign.status, 403);
    const adminTeam = (await state(backend, backend.admin, fixture.team)).nodes;
    assert.deepEqual(
      adminTeam,
      (await state(backend, backend.admin, adminSpace)).nodes,
    );
    projections.push(
      adminTeam.map(
        ({
          id,
          name,
          stage,
          control,
          models,
          detail,
          profile,
          contributor,
        }) => ({
          id,
          name,
          stage,
          control,
          models,
          detail,
          profile,
          contributor,
        }),
      ),
    );
    assert.deepEqual(
      await json(
        await fetchAs(
          backend.web,
          backend.member,
          `/api/nodes/${own.id}/stop`,
          { body: {}, workspace: fixture.team },
        ),
        403,
      ),
      { detail: "需要管理员权限" },
    );
    assert.equal(
      (
        await fetchAs(backend.web, backend.admin, `/api/nodes/${own.id}/stop`, {
          body: {},
          workspace: fixture.team,
          origin: "https://wrong-origin.invalid",
        })
      ).status,
      403,
    );
  }
  assert.deepEqual(projections[0], projections[1]);

  for (const [name, backend] of backends) {
    process.env.PUBLIC_URL = backend.web;
    step = name + "-pairing";
    const members = await pair(
      browser,
      errors,
      backend,
      "member",
      1440,
      "light",
    );
    const admins = await pair(browser, errors, backend, "admin", 1440, "light");
    try {
      const registrationContracts: unknown[] = [];
      const controlContracts: unknown[][] = [];
      const bindings = await all(members, async (page, react) => {
        await page.addInitScript(() => {
          Object.defineProperty(navigator, "clipboard", {
            value: {
              async writeText(text: string) {
                if (Reflect.get(window, "denyGpuClipboard"))
                  throw new Error("synthetic clipboard denial");
                Object.assign(window, { copiedGpuCommand: text });
              },
            },
          });
        });
        await openGpu(page, react, fixture.team, "member");
        await page.route(
          "**/api/pairs/default-name",
          async (route) => {
            await route.fulfill({
              status: 503,
              json: { detail: "合成命名错误" },
            });
          },
          { times: 1 },
        );
        await action(page, "pair").click();
        await expect(page.locator("#toast")).toHaveText("合成命名错误");
        await expect(modal(page)).toBeHidden();
        await expect(action(page, "pair")).toBeEnabled();
        const suggested = await request(
          page,
          "/api/pairs/default-name",
          "GET",
          () => action(page, "pair").click(),
        );
        const preview = await suggested.json();
        await expect(form(page).locator('[name="node"]')).toHaveValue(
          preview.name,
        );
        await model(page, models[0]).uncheck();
        const failure = await request(page, "/api/pairs", "POST", () =>
          submit(page).click(),
        );
        assert.equal(failure.status(), 400);
        await expect(page.locator("#toast")).toHaveText(
          "请选择至少一个支持的模型",
        );
        await expect(submit(page)).toBeEnabled();
        await model(page, models[0]).check();
        await model(page, models[1]).check();
        await form(page).locator('[name="node"]').fill("  回环浏览器节点  ");
        const start = Math.floor(Date.now() / 1000);
        const created = await request(page, "/api/pairs", "POST", () =>
          submit(page).click(),
        );
        assert.equal(created.status(), 200);
        assert.match(created.headers()["cache-control"], /private, no-store/);
        const result: Pairing = await created.json();
        assert.equal(result.name, "回环浏览器节点");
        assert.deepEqual(result.models, models);
        assert.ok(
          result.expires >= start + 1800 &&
            result.expires <= Math.floor(Date.now() / 1000) + 1800,
        );
        const code = codeFrom(result, backend.web, modelSlugs);
        await expect(page.locator(commandField)).toHaveValue(result.command);
        await expect(page.locator(commandField)).toHaveAttribute(
          "readonly",
          "",
        );
        await page.locator("#copy").click();
        await expect(page.locator("#toast")).toHaveText("已复制");
        assert.ok(
          await page.evaluate(
            (expected) => Reflect.get(window, "copiedGpuCommand") === expected,
            result.command,
          ),
        );
        await page.evaluate(() => {
          Reflect.deleteProperty(window, "copiedGpuCommand");
          Reflect.set(window, "denyGpuClipboard", true);
        });
        await page.locator("#copy").click();
        await expect(page.locator("#toast")).toHaveText("请选中内容后手动复制");
        const contract = (response: typeof created) => ({
          ...requestContract(response.request()),
          status: response.status(),
        });
        registrationContracts[Number(react)] = [
          suggested,
          failure,
          created,
        ].map(contract);
        // Compare the rendered command after validating its complete live value.
        // Do not write random one-time credentials into comparison artifacts.
        await page.locator(commandField).evaluate(
          (element, sample) => {
            const textarea = element as HTMLTextAreaElement;
            textarea.textContent = sample;
            textarea.value = sample;
            const toast = document.querySelector("#toast")!;
            toast.textContent = "";
            toast.removeAttribute("class");
          },
          result.command.slice(0, -code.length) + "synthetic-pairing-code",
        );
        return { code, react };
      });
      assert.deepEqual(registrationContracts[0], registrationContracts[1]);
      for (const contract of registrationContracts[1] as ReturnType<
        typeof requestContract
      >[]) {
        assert.equal(contract.workspace, String(fixture.team));
        if (contract.method === "POST")
          assert.equal(contract.origin, backend.web);
      }
      assert.deepEqual(
        (registrationContracts[1] as ReturnType<typeof requestContract>[]).map(
          ({ body }) => body,
        ),
        [
          undefined,
          { name: "", models: [] },
          { name: "回环浏览器节点", models },
        ],
      );
      comparisons.push(
        await compare(
          out,
          name + "-pairing-command",
          members.map(({ page }) => page),
          "接入命令 · 回环浏览器节点",
        ),
      );
      const [originalFocus, reactFocus] = await all(members, closePairing);
      assert.deepEqual(
        reactFocus,
        originalFocus,
        "command dialog return focus",
      );
      await expect(members[1].page.locator(commandField)).toHaveCount(0);

      const observed = seeded.get(name)!;
      await beat(backend, observed, "error", { detail: "回环状态更新" });
      await all(members, async (page) => {
        await expect(page.locator(".node-state")).toHaveText("准备失败", {
          timeout: 9000,
        });
        await expect(page.locator(".install-detail")).toHaveText(
          "回环状态更新",
        );
      });
      await beat(backend, observed, "ready", { ready_models: models });

      for (const { code, react } of bindings) {
        step = `${name}-controls-${react ? "react" : "original"}`;
        const binding = await bind(backend, code);
        await json(
          await agent(backend, "enroll", { code, secret: binding.token }),
        );
        assert.deepEqual(
          await json(
            await agent(backend, "enroll", {
              code,
              secret: randomBytes(32).toString("base64url"),
            }),
            403,
          ),
          { detail: "配对码已使用" },
        );
        const { page } = admins[Number(react)];
        const row = page
          .locator(".node-row")
          .filter({ has: control(page, binding.id, "remove") });
        await openGpu(page, react, adminSpace, "admin");
        await expect(row.locator(".node-state")).toHaveText("准备模型");
        await beat(backend, binding, "ready", { ready_models: models });
        const job = await json<{ id: number }>(
          await fetchAs(backend.web, backend.admin, "/api/audio-jobs", {
            workspace: fixture.team,
            body: { uid: randomUUID(), prompt: "回环工作区测试", seed: 42 },
          }),
        );
        async function claim() {
          const result = await json<{ job: { id: number } }>(
            await agent(backend, "claim", {}, binding.token),
          );
          assert.equal(result.job.id, job.id);
        }
        await claim();
        await beat(backend, binding, "busy");
        const checkOp = async (op: string, summary: string) => {
          await control(page, binding.id, op).click();
          await expect(modal(page).locator("p")).toHaveText(summary);
        };
        const running = `正在生成 #${job.id}。`;
        await openGpu(page, react, adminSpace, "admin");
        await expect(row.locator(".node-state")).toHaveText("生成中");
        await checkOp("drain", "当前任务回传后停止接单。");
        await page.locator("#back").click();
        await expect(control(page, binding.id, "drain")).toBeFocused();
        await page.locator(".workspace-switch").click();
        await page
          .locator(
            `#popover [data-act="switch-workspace"][data-id="${fixture.team}"]`,
          )
          .click();
        await expect
          .poll(() => new URL(page.url()).searchParams.get("workspace"))
          .toBe(String(fixture.team));
        await enterGpu(page, react, "admin");
        const path = (op: string) => `/api/nodes/${binding.id}/${op}`;
        const registration = async () =>
          json<{ control: string }>(
            await agent(backend, "registration", undefined, binding.token),
          );
        const contracts: unknown[] = [];
        controlContracts[Number(react)] = contracts;
        async function commit(
          op: string,
          summary: string | null,
          next: string,
        ) {
          if (summary) await checkOp(op, summary);
          const confirm = page.locator("#confirm");
          const result = await request(page, path(op), "POST", () =>
            confirm.click(),
          );
          assert.equal(result.status(), 200);
          assert.deepEqual(await result.json(), { ok: true });
          const contract = requestContract(result.request());
          assert.equal(contract.workspace, String(fixture.team));
          assert.equal(contract.origin, backend.web);
          contracts.push({ ...contract, path: `/api/nodes/{id}/${op}` });
          await expect(modal(page)).toBeHidden();
          if (next !== "removed") {
            assert.equal((await registration()).control, next);
            const button = control(
              page,
              binding.id,
              next === "active" ? "stop" : "resume",
            );
            await expect(button).toBeVisible();
            if (next !== "active")
              await expect(row.locator(".node-state")).toHaveText(
                next === "paused" ? "已暂停" : "完成后下线",
              );
          } else {
            await expect(control(page, binding.id, "remove")).toHaveCount(0);
            assert.deepEqual(
              await json(
                await agent(backend, "registration", undefined, binding.token),
                403,
              ),
              { detail: "实例凭据已撤销" },
            );
          }
        }

        await commit("drain", running + "当前任务回传后停止接单。", "draining");
        await commit("resume", running + "实例在线后将继续接单。", "active");
        await checkOp("stop", running + "当前任务可能需要重新生成。");
        await page.route(
          "**" + path("stop"),
          async (route) => {
            await route.fulfill({
              status: 503,
              json: { detail: "合成控制错误" },
            });
          },
          { times: 1 },
        );
        await page.locator("#confirm").click();
        await expect(page.locator("#toast")).toHaveText("合成控制错误");
        await expect(page.locator("#confirm")).toBeEnabled();
        assert.equal((await registration()).control, "active");
        await commit("stop", null, "paused");
        const readJob = async () =>
          (await state(backend, backend.admin, fixture.team)).jobs.find(
            ({ id }) => id === job.id,
          )!;
        assert.equal((await readJob()).status, "queued");
        assert.equal((await readJob()).node, null);
        assert.ok(
          !(await state(backend, backend.admin, adminSpace)).jobs.some(
            ({ id }) => id === job.id,
          ),
        );
        await commit("resume", "实例在线后将继续接单。", "active");
        await beat(backend, binding, "ready", { ready_models: models });
        await claim();
        // Reopen on both shells to read the current running-task snapshot.
        await openGpu(page, react, fixture.team, "admin");
        await commit("remove", running + "此实例的接入凭据将失效。", "removed");
        assert.equal((await readJob()).status, "failed");
        assert.deepEqual(
          await json(
            await agent(backend, "enroll", { code, secret: binding.token }),
            403,
          ),
          { detail: "实例接入已撤销，请获取新的接入命令" },
        );
        assert.deepEqual(
          await json(
            await agent(
              backend,
              "heartbeat",
              { stage: "ready" },
              binding.token,
            ),
            403,
          ),
          { detail: "实例凭据已撤销" },
        );
        workflows.push(step);
      }
      assert.deepEqual(controlContracts[0], controlContracts[1]);

      step = name + "-revocation";
      const own = seeded.get(name)!;
      const other = (
        await state(backend, backend.admin, fixture.team)
      ).nodes.find(({ name }) => name === failureLabel)!;
      await all(admins, async (page, react) => {
        await openGpu(page, react, fixture.team, "admin");
        await control(page, own.id, "stop").click();
        await expect(page.locator("#confirm")).toBeVisible();
      });
      await fixture.demoteAdmin(backend.web);
      await all(admins, async (page, react) => {
        const rejected = await request(
          page,
          `/api/nodes/${own.id}/stop`,
          "POST",
          () => page.locator("#confirm").click(),
        );
        assert.equal(rejected.status(), 403);
        await expect(page.locator("#toast")).toHaveText("需要管理员权限");
        if (react) await expect(modal(page)).toBeHidden();
        else await close(page);
        await openGpu(page, react, adminSpace, "member");
        await expect(action(page, "node")).toHaveCount(0);
        await expect(page.getByText(replicaLabel, { exact: true })).toHaveCount(
          0,
        );
      });
      const unchanged = await state(backend, backend.member, fixture.team);
      assert.equal(
        unchanged.nodes.find(({ id }) => id === own.id)?.control,
        "active",
      );
      assert.equal(
        (await state(backend, backend.admin, adminSpace)).nodes.some(
          ({ id }) => id === other.id,
        ),
        true,
      );
      workflows.push(step);
    } finally {
      await Promise.all(
        [...members, ...admins].map(({ context }) => context.close()),
      );
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(
    join(out, "results.json"),
    JSON.stringify(
      {
        passed: true,
        comparisons,
        workflows,
        database: process.env.TEST_DATABASE_URL ? "PostgreSQL" : "PGlite",
      },
      null,
      2,
    ),
  );
  console.log(
    `GPU settings: ${comparisons.length} UI comparisons and ${workflows.length} browser/HTTP workflows`,
  );
} catch (error) {
  await writeFile(
    join(out, "results.json"),
    JSON.stringify({ passed: false, step, comparisons, workflows }, null, 2),
  );
  console.error("GPU settings differential failed at " + step);
  throw error;
} finally {
  if (savedSite === undefined) delete process.env.PUBLIC_URL;
  else process.env.PUBLIC_URL = savedSite;
  await browser?.close();
  await fixture.cleanup();
}
