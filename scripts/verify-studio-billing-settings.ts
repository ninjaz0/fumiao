/** Differential Studio admin settings with real pinned Python and Nest APIs. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, expect, type Locator, type Page } from "@playwright/test";
import type { CreditAccount, StudioState } from "../apps/web/studio/state.js";
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

assert.ok(
  process.env.TEST_DATABASE_URL && process.env.TEST_REDIS_URL,
  "Set TEST_DATABASE_URL and TEST_REDIS_URL to isolated test services",
);

const out = resolve(".runtime-advanced/studio-billing-settings-parity");
const headings = {
  models: "模型管理",
  prices: "生成定价",
  creditAdmin: "积分管理",
};
const modelPath = "/api/settings/models";
const pricePath = "/api/settings/prices";
const creditsPath = "/api/admin/credits";
const adjustPath = creditsPath + "/adjust";
const h3 = "MiniMax H3";
const audio = "breeze-tts-2";
const h3Price = h3 + "|480|5";
const musePrice = "muse-video|5";
const search = (page: Page) => page.locator("#model-policy-search");
const scope = (page: Page) => page.locator("#model-policy-scope");
const toggle = (page: Page, model: string) =>
  page.locator(`[data-model="${model}"]`);
const input = (page: Page, key: string) =>
  page.locator(`[data-price="${key}"]`);
const priceSave = (page: Page) => page.locator("#price-form button");
const modal = (page: Page) => page.locator("#modal");
const creditButton = (page: Page, act: string, id: number) =>
  action(page, act).and(page.locator(`[data-id="${id}"]`));
const accounts = (page: Page) => page.locator(".credit-account-row");
const account = (state: StudioState, workspace: number) =>
  state.credit_accounts!.find((row) => row.workspace === workspace)!;
const values = (state: StudioState) =>
  Object.fromEntries(
    state.pricing.items.map(({ key, amount }) => [key, amount]),
  );
const errors: string[] = [];
const comparisons: Comparison[] = [];
const completed: string[] = [];
type Fixture = Awaited<ReturnType<typeof settingsFixture>>;
type Receipt = Omit<ReturnType<typeof requestContract>, "origin">;

async function closeModal(page: Page) {
  await page.keyboard.press("Escape");
  await expect(modal(page)).toBeHidden();
}

function read(backend: Backend, role: "admin" | "member", workspace?: number) {
  return fetchAs(backend.web, backend[role], "/api/state", { workspace }).then(
    json<StudioState>,
  );
}

function send(
  backend: Backend,
  role: "admin" | "member",
  path: string,
  method: string,
  body?: object,
  workspace?: number,
) {
  return fetchAs(backend.web, backend[role], path, { method, body, workspace });
}

async function choose(page: Page, name: keyof typeof headings, react: boolean) {
  await setTab(page, name);
  await expect(tab(page, name)).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".settings-content h2")).toHaveText(headings[name]);
  await assertStudio(page, react);
}

async function visuals(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  fixture: Fixture,
  name: string,
  backend: Backend,
) {
  const team = fixture.team;
  for (const width of [1440, 390]) {
    for (const theme of ["light", "dark"]) {
      const pairs = await pair(browser, errors, backend, "admin", width, theme);
      const pages = pairs.map(({ page }) => page);
      const verify = async (label: string, heading: string) =>
        comparisons.push(
          await compare(
            out,
            `${name}-${width}-${theme}-${label}`,
            pages,
            heading,
          ),
        );
      try {
        await all(pairs, async (page, react) => {
          await open(page, "/studio", react, team);
          await settings(page);
          await choose(page, "models", react);
          await expect(
            page.getByText("部分开放", { exact: true }),
          ).toBeVisible();
          await expect(page.getByText("未配置", { exact: true })).toBeVisible();
        });
        await verify("global-models", headings.models);
        await all(pairs, async (page) => {
          await scope(page).selectOption(String(team));
          await expect(page.getByText("全站部分开放")).toBeVisible();
          await search(page).fill("  mInImAx  ");
          await expect(
            page.locator(".model-settings .setting-row:visible"),
          ).toHaveCount(1);
        });
        await verify("team-filter", headings.models);
        await all(pairs, async (page, react) => {
          await choose(page, "prices", react);
          await expect(input(page, h3Price)).toHaveValue("");
          const state = await read(backend, "admin", team);
          const expected = state.pricing.items.filter(
            ({ model }) => !state.model_catalog[model].hidden,
          );
          assert.deepEqual(
            (
              await page
                .locator("[data-price]")
                .evaluateAll((rows) =>
                  rows.map((row) => row.getAttribute("data-price")),
                )
            ).sort(),
            expected.map(({ key }) => key).sort(),
          );
        });
        await verify("prices", headings.prices);
        await all(pairs, (page, react) => choose(page, "creditAdmin", react));
        await verify("accounts", headings.creditAdmin);
        await all(pairs, async (page) => {
          const response = await request(
            page,
            creditsPath + "?workspace=" + team,
            "GET",
            () => creditButton(page, "credit-history", team).click(),
          );
          assert.equal(response.status(), 200);
          assert.equal(
            requestContract(response.request()).workspace,
            String(team),
          );
          await expect(modal(page).locator(".credit-ledger-row")).toHaveCount(
            50,
          );
        });
        await verify("ledger", "设置对照团队 · 积分明细");
        await all(pairs, async (page) => {
          const more = modal(page).locator('[data-act="credit-more"]');
          const before = await more.getAttribute("data-before");
          const response = await request(
            page,
            creditsPath + "?workspace=" + team + "&before=" + before,
            "GET",
            () => more.click(),
          );
          assert.equal(response.status(), 200);
          await expect(modal(page).locator(".credit-ledger-row")).toHaveCount(
            55,
          );
          await expect(more).toHaveCount(0);
        });
        await verify("paginated-ledger", "设置对照团队 · 积分明细");
        await all(pairs, async (page) => {
          await closeModal(page);
          await creditButton(page, "credit-adjust", team).click();
        });
        await verify("adjustment", "调整积分");
        await all(pairs, async (page, react) => {
          await closeModal(page);
          await choose(page, "models", react);
          await expect(scope(page)).toHaveValue(String(team));
          await expect(search(page)).toHaveValue("  mInImAx  ");
          await search(page).fill("无匹配模型");
          await expect(page.locator(".model-group:visible")).toHaveCount(0);
        });
        await verify("empty-filter", headings.models);
      } finally {
        await Promise.all(pairs.map(({ context }) => context.close()));
      }
    }
  }
}

async function workflow(
  fixture: Fixture,
  backend: Backend,
  page: Page,
  react: boolean,
) {
  const { team, personal, otherTeam } = fixture;
  assert.ok(otherTeam);
  const receipts: Receipt[] = [];
  const wallet = () =>
    read(backend, "member", team).then(({ credits }) => credits);
  const adminState = () => read(backend, "admin", team);
  const initial = await adminState();
  const [family, group] = Object.entries(initial.model_groups).find(
    ([, group]) => group.models.length > 1,
  )!;

  async function browserRequest<T = unknown>(
    path: string,
    method: string,
    act: () => Promise<unknown>,
    status = 200,
  ): Promise<T> {
    const response = await request(page, path, method, act);
    const { origin, ...contract } = requestContract(response.request());
    assert.equal(origin, method === "GET" ? undefined : backend.web);
    assert.equal(contract.workspace, String(team));
    const body = contract.body && { ...contract.body };
    if (body?.uid) {
      assert.match(
        body.uid,
        /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/,
      );
      body.uid = "<uuid>";
    }
    receipts.push({ ...contract, body });
    const bodyText = await response.text();
    assert.equal(response.status(), status, bodyText.slice(0, 300));
    return JSON.parse(bodyText);
  }

  const saveModel = (
    model: string,
    enabled: boolean,
    expected_revision: number,
    workspace: number | null,
    group = true,
  ) =>
    send(
      backend,
      "admin",
      modelPath,
      "PATCH",
      { model, enabled, expected_revision, workspace, group },
      team,
    );
  const savePrices = (
    state: StudioState,
    changes: Record<string, number | null>,
  ) =>
    send(
      backend,
      "admin",
      pricePath,
      "PUT",
      {
        values: { ...values(state), ...changes },
        expected_revision: state.pricing.revision,
      },
      team,
    );
  const twice = (button: Locator) =>
    button.evaluate((element: HTMLButtonElement) => {
      element.click();
      element.click();
    });

  await open(page, "/studio", react, team);
  await settings(page);
  await choose(page, "models", react);
  await scope(page).selectOption(String(team));
  await browserRequest(modelPath, "PATCH", () =>
    toggle(page, family).uncheck(),
  );
  assert.deepEqual(receipts.at(-1)?.body, {
    model: family,
    enabled: false,
    group: true,
    expected_revision: 0,
    workspace: team,
  });
  await expect(toggle(page, family)).toBeFocused();
  await expect(toggle(page, family)).not.toBeChecked();
  const afterGroup = await adminState();
  for (const id of group.models) {
    assert.equal(afterGroup.team_model_policies![team].enabled[id], false);
    assert.equal(afterGroup.team_model_policies![otherTeam].enabled[id], true);
    assert.equal(afterGroup.model_access?.[id], false);
    assert.equal(
      (await read(backend, "member", personal)).model_access?.[id],
      initial.model_policy.enabled[id],
    );
  }
  const modelRoute = "**/api/settings/models";
  await page.route(
    modelRoute,
    async (route) => {
      await json(
        await saveModel(
          family,
          false,
          afterGroup.team_model_policies![team].revision,
          team,
        ),
      );
      await route.continue();
    },
    { times: 1 },
  );
  const conflict = await browserRequest<{ detail: string }>(
    modelPath,
    "PATCH",
    () => toggle(page, family).click(),
    409,
  );
  assert.equal(conflict.detail, "团队模型设置已更新，请刷新后重试");
  await expect(page.locator("#toast")).toHaveText(conflict.detail);
  await expect(toggle(page, family)).not.toBeChecked();
  await expect(toggle(page, family)).toBeFocused();
  await scope(page).selectOption("global");
  await browserRequest(modelPath, "PATCH", () => toggle(page, audio).uncheck());
  await expect(toggle(page, audio)).not.toBeChecked();
  const globalOff = await adminState();
  assert.equal(
    (await read(backend, "member", personal)).model_access?.[audio],
    false,
  );
  await json(
    await saveModel(audio, true, globalOff.model_policy.revision, null),
  );
  await json(
    await saveModel(audio, false, globalOff.model_policy.revision, null),
    409,
  );
  const invalidTeam = await json<{ detail: string }>(
    await saveModel(h3, false, 0, personal),
    404,
  );
  assert.equal(invalidTeam.detail, "团队不存在");
  const hidden = initial.pricing.items.find(
    ({ model }) => initial.model_catalog[model].hidden,
  )!;
  assert.equal(
    (
      await json<{ detail: string }>(
        await saveModel(
          hidden.model,
          true,
          globalOff.model_policy.revision + 1,
          null,
          false,
        ),
        400,
      )
    ).detail,
    "该模型已隐藏",
  );
  await choose(page, "prices", react);
  assert.equal(
    (
      await json<{ detail: string }>(
        await send(
          backend,
          "admin",
          pricePath,
          "PUT",
          {
            values: { [h3Price]: 1 },
            expected_revision: initial.pricing.revision,
          },
          team,
        ),
        400,
      )
    ).detail,
    "定价档位不完整",
  );
  assert.equal(
    (
      await json<{ detail: string }>(
        await savePrices(initial, { [h3Price]: 0 }),
        400,
      )
    ).detail,
    "价格需为正整数，留空表示尚未定价",
  );
  await input(page, h3Price).fill("1.5");
  assert.equal(
    await input(page, h3Price).evaluate(
      (field: HTMLInputElement) => field.validity.stepMismatch,
    ),
    true,
  );
  await input(page, h3Price).fill("27");
  await json(await savePrices(initial, { [hidden.key]: 71 }));
  await browserRequest(pricePath, "PUT", () => priceSave(page).click(), 409);
  await expect(page.locator("#price-form .form-message")).toHaveText(
    "价格已更新，请刷新后重试",
  );
  await expect(input(page, h3Price)).toHaveValue("27");
  await choose(page, "creditAdmin", react);
  await open(page, "/studio", react, team);
  await settings(page);
  await choose(page, "prices", react);
  await input(page, h3Price).fill("27");
  await input(page, musePrice).fill("41");
  const otherTier = h3 + "|768|15";
  await input(page, otherTier).fill("");
  await browserRequest(pricePath, "PUT", () => twice(priceSave(page)));
  await expect(page.locator("#toast")).toHaveText("价格已保存");
  const priced = await adminState();
  assert.equal(priced.pricing.revision, initial.pricing.revision + 2);
  assert.deepEqual(values(priced), {
    ...values(initial),
    [hidden.key]: 71,
    [h3Price]: 27,
    [musePrice]: 41,
    [otherTier]: null,
  });
  assert.deepEqual(receipts.at(-1)?.body, {
    values: values(priced),
    expected_revision: priced.pricing.revision - 1,
  });

  const [estimated] = await Promise.all([
    page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/estimate",
    ),
    open(page, "/studio", react, team),
  ]);
  await expect(page.locator(".composer-credit")).toHaveAttribute(
    "aria-label",
    "27 积分",
  );
  assert.equal(estimated.status(), 200);
  const { origin: estimateOrigin, ...estimateContract } = requestContract(
    estimated.request(),
  );
  assert.equal(estimateOrigin, backend.web);
  assert.equal(estimateContract.workspace, String(team));
  assert.equal(estimateContract.body.model, h3);
  receipts.push(estimateContract);
  await expect(page.locator(".composer-estimate")).not.toBeEmpty();
  await page.locator("#prompt").fill("隔离计费任务");
  const accepted = await browserRequest<{ id: number }>(
    "/api/jobs",
    "POST",
    () => page.locator(".generate-button").click(),
  );
  assert.equal(receipts.at(-1)?.body.price_revision, priced.pricing.revision);
  assert.deepEqual(await wallet(), {
    workspace: team,
    balance: 1234,
    reserved: 27,
    available: 1207,
  });
  const oldJob = {
    uid: randomUUID(),
    model: "muse-video",
    prompt: "模拟提供方计费",
    price_revision: priced.pricing.revision,
  };
  const muse = await json<{ id: number }>(
    await send(backend, "member", "/api/jobs", "POST", oldJob, team),
  );
  assert.deepEqual(await wallet(), {
    workspace: team,
    balance: 1234,
    reserved: 68,
    available: 1166,
  });
  await json(await savePrices(priced, { [h3Price]: 53, [musePrice]: 63 }));
  const repriced = await adminState();
  const duplicate = await send(
    backend,
    "member",
    "/api/jobs",
    "POST",
    oldJob,
    team,
  );
  assert.deepEqual(await json(duplicate), muse);
  const stale = await send(
    backend,
    "member",
    "/api/jobs",
    "POST",
    { ...oldJob, uid: randomUUID() },
    team,
  );
  assert.equal(
    (await json<{ detail: string }>(stale, 409)).detail,
    "积分价格已更新，请确认新价格后重新提交",
  );
  const crossSpace = await send(
    backend,
    "member",
    "/api/jobs",
    "POST",
    oldJob,
    personal,
  );
  await json(crossSpace, 404);
  assert.equal((await wallet()).reserved, 68);

  // Accept a distinct UID at the new revision while both older holds exist.
  const fresh = await json<{ id: number }>(
    await send(
      backend,
      "admin",
      "/api/jobs",
      "POST",
      {
        uid: randomUUID(),
        model: h3,
        prompt: "新定价计费任务",
        quality: 480,
        seconds: 5,
        price_revision: repriced.pricing.revision,
      },
      team,
    ),
  );
  assert.notEqual(fresh.id, accepted.id);
  assert.equal((await wallet()).reserved, 68 + 53);
  await json(
    await send(
      backend,
      "admin",
      `/api/jobs/${fresh.id}/cancel`,
      "POST",
      {},
      team,
    ),
  );
  const freshRows = (await adminState()).credit_history.filter(
    (row) => row.job === fresh.id,
  );
  assert.deepEqual(
    freshRows.map(({ action, amount }) => [action, amount]),
    [
      ["refund", 53],
      ["reserve", 53],
    ],
  );
  assert.equal((await wallet()).reserved, 68);
  const provider = await fixture.dispatchBilling(backend.web);
  const afterDispatch = await read(backend, "member", team);
  assert.equal(
    afterDispatch.jobs.find(({ id }) => id === muse.id)?.status,
    "failed",
  );
  const originalCharge = afterDispatch.credit_history.filter(
    (row) => row.job === muse.id,
  );
  assert.deepEqual(
    originalCharge.map(({ action, amount }) => [action, amount]),
    [
      ["refund", 41],
      ["reserve", 41],
    ],
  );
  assert.equal(afterDispatch.credits.reserved, 27);
  await json(
    await send(
      backend,
      "admin",
      `/api/jobs/${accepted.id}/cancel`,
      "POST",
      {},
      team,
    ),
  );
  assert.equal((await wallet()).reserved, 0);
  const originalH3 = (await adminState()).credit_history.filter(
    (row) => row.job === accepted.id,
  );
  assert.deepEqual(
    originalH3.map(({ action, amount }) => [action, amount]),
    [
      ["refund", 27],
      ["reserve", 27],
    ],
  );

  await settings(page);
  await choose(page, "creditAdmin", react);
  await creditButton(page, "credit-adjust", team).click();
  const adjustment = page.locator("#credit-adjust-form");
  const adjustmentSave = adjustment.getByRole("button", { name: "确认调整" });
  await adjustment.locator('[name="direction"]').selectOption("-1");
  await adjustment.locator('[name="amount"]').fill("1235");
  await adjustment.locator('[name="note"]').fill("  对照扣减  ");
  const uidPromise = page.waitForRequest(
    (r) => new URL(r.url()).pathname === adjustPath,
  );
  await browserRequest(adjustPath, "POST", () => adjustmentSave.click(), 409);
  const { uid } = (await uidPromise).postDataJSON();
  await expect(adjustment.locator('[role="alert"]')).toHaveText(
    "不能扣减已冻结的积分或使可用积分小于零",
  );
  await adjustment.locator('[name="amount"]').fill("12");
  const retryPromise = page.waitForRequest(
    (r) => new URL(r.url()).pathname === adjustPath,
  );
  await browserRequest(adjustPath, "POST", () => twice(adjustmentSave));
  const adjusted = (await retryPromise).postDataJSON();
  assert.deepEqual(adjusted, {
    workspace: team,
    amount: -12,
    note: "对照扣减",
    uid,
  });
  await expect(modal(page)).toBeHidden();
  await expect(
    accounts(page).filter({ hasText: "设置对照团队" }),
  ).toContainText("1,222");
  const repeats = await Promise.all([
    send(backend, "admin", adjustPath, "POST", adjusted, team).then(
      json<CreditAccount>,
    ),
    send(backend, "admin", adjustPath, "POST", adjusted, team).then(
      json<CreditAccount>,
    ),
  ]);
  assert.equal(repeats[0].available, 1222);
  assert.deepEqual(repeats[0], repeats[1]);
  await json(
    await send(
      backend,
      "admin",
      adjustPath,
      "POST",
      { ...adjusted, workspace: personal },
      team,
    ),
    409,
  );
  await creditButton(page, "credit-adjust", personal).click();
  await adjustment.locator('[name="amount"]').fill("35");
  await adjustment.locator('[name="note"]').fill("个人测试发放");
  await browserRequest(adjustPath, "POST", () => adjustmentSave.click());
  await expect(modal(page)).toBeHidden();
  const final = await adminState();
  assert.equal(account(final, personal).available, 35);
  assert.equal(account(final, otherTeam).available, 0);
  assert.equal(
    final.credit_history.filter((row) => row.note === adjusted.note).length,
    1,
  );
  const personalWallet = await read(backend, "member", personal);
  assert.equal(personalWallet.credits.available, 35);
  assert.ok(
    personalWallet.credit_history.every((row) => row.note !== adjusted.note),
  );

  const restricted = [
    [
      modelPath,
      "PATCH",
      {
        model: h3,
        enabled: false,
        group: true,
        expected_revision: final.model_policy.revision,
      },
    ],
    [
      pricePath,
      "PUT",
      { values: values(final), expected_revision: final.pricing.revision },
    ],
    [creditsPath + "?workspace=" + personal, "GET", undefined],
    [adjustPath, "POST", { ...adjusted, uid: randomUUID() }],
  ] as const;
  for (const [path, method, body] of restricted) {
    await json(await send(backend, "member", path, method, body, team), 403);
    await json(
      await fetchAs(backend.web, "", path, { method, body, workspace: team }),
      401,
    );
  }
  await json(
    await send(backend, "member", "/api/state", "GET", undefined, otherTeam),
    403,
  );
  await json(
    await fetchAs(backend.web, backend.admin, adjustPath, {
      body: adjusted,
      origin: "https://invalid.example",
    }),
    403,
  );

  await choose(page, "models", react);
  await expect(scope(page)).toHaveValue("global");
  await browserRequest(modelPath, "PATCH", () => toggle(page, h3).uncheck());
  await expect(toggle(page, h3)).toBeFocused();
  await assertStudio(page, react);
  await page.locator('nav [data-nav="home"]').click();
  await expect(
    page.locator('.composer [data-menu="image-model"]'),
  ).not.toHaveText(h3);
  await expect(page.locator(".composer-credit")).toHaveAttribute(
    "aria-label",
    "1 积分",
  );
  await assertStudio(page, react);
  const paused = await adminState();
  await json(await saveModel(h3, true, paused.model_policy.revision, null));
  // Start the revocation interaction back inside the chosen implementation.
  await page.evaluate(() => sessionStorage.clear());
  await open(page, "/studio", react, team);
  await settings(page);
  await choose(page, "creditAdmin", react);
  await creditButton(page, "credit-adjust", team).click();
  await adjustment.locator('[name="amount"]').fill("1");
  await adjustment.locator('[name="note"]').fill("失权后拒绝");
  await fixture.demoteAdmin(backend.web);
  await browserRequest(adjustPath, "POST", () => adjustmentSave.click(), 403);
  if (react) {
    await expect(modal(page)).toBeHidden();
    await expect(tab(page, "general")).toHaveAttribute("aria-current", "page");
    await expect(page.locator("#dialog-body")).toBeEmpty();
  } else {
    await expect(adjustment.locator('[role="alert"]')).toHaveText(
      "需要管理员权限",
    );
    await closeModal(page);
  }
  const former = await read(backend, "admin");
  assert.equal(former.me.role, "member");
  assert.equal(former.credit_accounts, undefined);
  assert.equal(former.team_model_policies, undefined);
  for (const [path, method, body] of restricted)
    await json(await send(backend, "admin", path, method, body, team), 403);
  await open(page, "/studio", react, former.workspace_id);
  await settings(page);
  for (const key of Object.keys(headings))
    await expect(tab(page, key)).toHaveCount(0);
  assert.equal((await wallet()).available, 1222);
  return { receipts, provider };
}

let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let step = "launch";
await mkdir(out, { recursive: true });
try {
  browser = await chromium.launch({ args: ["--disable-partial-raster"] });
  const runs = [];
  for (const react of [false, true]) {
    const fixture = await settingsFixture({ gpu: true, billing: true });
    try {
      step = "imported settings and wallet parity";
      const states = await Promise.all(
        Object.values(fixture.backends).map(async (backend) => {
          const state = await read(backend, "admin", fixture.team);
          return {
            modelGroups: Object.entries(state.model_groups),
            policies: [
              state.model_policy,
              state.team_model_policies,
              state.model_access,
            ],
            prices: state.pricing,
            accounts: state.credit_accounts,
            history: state.credit_history,
          };
        }),
      );
      assert.deepEqual(states[1], states[0]);
      for (const [name, backend] of Object.entries(fixture.backends)) {
        if (!react) {
          step = name + " visual matrix";
          await visuals(browser, fixture, name, backend);
        }
        step = name + (react ? " React" : " pinned") + " workflows";
        const pairs = await pair(
          browser,
          errors,
          backend,
          "admin",
          1440,
          "light",
        );
        try {
          runs.push(
            await workflow(fixture, backend, pairs[Number(react)].page, react),
          );
          completed.push(step);
        } finally {
          await Promise.all(pairs.map(({ context }) => context.close()));
        }
      }
    } finally {
      await fixture.cleanup();
    }
  }
  step = "cross-runtime request comparison";
  for (const run of runs.slice(1)) assert.deepEqual(run, runs[0]);
  assert.deepEqual(errors, []);
  await writeFile(
    join(out, "results.json"),
    JSON.stringify(
      {
        passed: true,
        comparisons,
        completed,
        matchedRequests: runs[0].receipts.length,
      },
      null,
      2,
    ),
  );
  console.log(
    `Billing settings: ${comparisons.length} UI comparisons, ${runs[0].receipts.length} matched browser requests across ${completed.length} workflows`,
  );
} catch (error) {
  await writeFile(
    join(out, "results.json"),
    JSON.stringify({ passed: false, step, comparisons, completed }, null, 2),
  );
  console.error("Billing settings differential failed at " + step);
  throw error;
} finally {
  await browser?.close();
}
