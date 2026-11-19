/** Browser differential for the React settings candidate against pinned Studio. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  chromium,
  expect,
  type Page,
  type Request,
} from "@playwright/test";
import sharp from "sharp";
import {
  fetchAs,
  json,
  settingsFixture,
} from "./studio-settings-fixture.js";
import {
  action,
  all,
  assertStudio,
  compare as compareUI,
  open,
  pair,
  request,
  requestContract,
  settings,
  setTab,
  tab,
  type Comparison,
} from "./studio-settings-browser.js";

const fixture = await settingsFixture();
const out = resolve(".runtime-advanced/studio-settings-parity");
const results: Comparison[] = [];
const errors: string[] = [];
let step = "launch browser";
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

async function compare(name: string, pages: Page[], heading?: string) {
  step = name;
  results.push(await compareUI(out, name, pages, heading));
}
const originalTabs = {
};

try {
  await mkdir(out, { recursive: true });
  browser = await chromium.launch({ args: ["--disable-partial-raster"] });
  for (const [backendName, backend] of Object.entries(fixture.backends)) {
    const state = async (cookie: string, workspace?: number) => {
      const response = await fetchAs(backend.web, cookie, "/api/state", {
        workspace,
      });
      assert.equal(
        response.headers.get("x-settings-fixture"),
        backendName === "nest" ? "nest" : null,
      );
      return json(response);
    };
    const adminWorkspace = (await state(backend.admin)).workspace_id;
    for (const width of [1440, 390])
      for (const theme of ["light", "dark"])
        for (const role of ["admin", "member"] as const) {
          const name = `${backendName}-${width}-${theme}-${role}`;
          const pairs = await pair(browser, errors, backend, role, width, theme);
          const pages = pairs.map(({ page }) => page);
          const workspace = role === "admin" ? adminWorkspace : fixture.team;
          await all(pairs, (page, react) =>
            open(page, "/studio", react, workspace),
          );
          await all(pairs, (page) =>
            expect(page.locator(".composer-estimate")).not.toBeEmpty(),
          );
          await compare(name + "-studio-home", pages);
          // Start from fresh controls after Playwright's screenshot caret handling.
          await all(pairs, (page, react) =>
            open(page, "/studio", react, workspace),
          );
          await all(pairs, async (page) => {
            await page.locator('nav [data-nav="library"]').click();
            await expect(page.locator(".assets-view")).toBeVisible();
            await expect(page.locator(".composer-estimate")).not.toBeEmpty();
          });
          await compare(name + "-studio-library", pages);
          await all(pairs, (page) =>
            page.locator('nav [data-nav="home"]').click(),
          );
          await all(pairs, (page) => settings(page));
          await all(pairs, async (page) => {
            const buttons = page.locator(".settings-navigation button");
            await expect(buttons).toHaveCount(role === "admin" ? 13 : 4);
            await expect(tab(page, "gpu")).toHaveText(
              role === "admin" ? "GPU 实例" : "GPU 接入",
            );
            await expect(tab(page, "profile")).toHaveAttribute(
              "aria-current",
              "page",
            );
          });
          await compare(name + "-profile", pages, "个人资料");
          if (role === "member") {
            await all(pairs, (page) => action(page, "avatar-picker").click());
            await compare(name + "-avatar", pages, "更改头像");
            await all(pairs, async (page) => {
              await page.keyboard.press("Escape");
              await expect(action(page, "avatar-picker")).toBeFocused();
              await action(page, "own-password").click();
            });
            await compare(name + "-password", pages, "更改密码");
            await all(pairs, (page) => page.locator("#close-modal").click());
          }
          await all(pairs, (page) => setTab(page, "general"));
          await compare(name + "-general", pages, "常规");
          await all(pairs, (page) => setTab(page, "credits"));
          await compare(name + "-credits", pages, "积分");
          if (role === "member") {
            await all(pairs, (page) => action(page, "recharge").click());
            await compare(name + "-recharge", pages, "充值积分");
            await all(pairs, async (page) => {
              await page.locator("[data-yuan='50']").click();
              await page
                .locator('input[name="method"][value="usdt_plasma"]')
                .check();
              await expect(page.locator("#recharge-total")).toHaveText("500");
              await expect(page.locator(".recharge-network")).toBeVisible();
            });
            await compare(name + "-plasma-preset", pages, "充值积分");
            await all(pairs, async (page) => {
              await page.locator("#close-modal").click();
              await action(page, "recharge-history").click();
            });
            await compare(name + "-history", pages, "充值记录");
            await all(pairs, (page) =>
              page.locator(".recharge-order-row").first().click(),
            );
            await compare(name + "-expired-order", pages, "充值订单");
          }
          await Promise.all(pairs.map(({ context }) => context.close()));
        }

    step = backendName + " browser writes";
    const pairs = await pair(browser, errors, backend, "member", 1440, "light");
    const [original, candidate] = pairs.map(({ page }) => page);
    await all(pairs, (page, react) =>
      open(page, "/studio", react, fixture.team),
    );
    await all(pairs, (page) => settings(page));
    const workspace = String(fixture.team);
    const contract = (path: string, method: string, body?: object) => ({
      path,
      method,
      workspace,
      origin: method === "GET" ? undefined : backend.web,
      body,
    });
    const capture = async (
      page: Page,
      path: string,
      method: string,
      act: () => Promise<unknown>,
      body?: object,
      status = 200,
    ) => {
      const response = await request(page, path, method, act);
      assert.equal(response.status(), status, path);
      assert.deepEqual(
        requestContract(response.request()),
        contract(path, method, body),
      );
      if (backendName === "nest")
        assert.equal(response.headers()["x-settings-fixture"], "nest");
      return response;
    };
    const nickname = "合成昵称 <&>";
    await candidate.locator("#nickname").fill("  " + nickname + "  ");
    await setTab(candidate, "general");
    const generalWrites: string[] = [];
    const watchWrites = (event: Request) => {
      if (!["GET", "HEAD"].includes(event.method()))
        generalWrites.push(event.url());
    };
    candidate.on("request", watchWrites);
    await candidate.getByRole("radio", { name: "深色" }).click();
    assert.equal(
      await candidate.evaluate(() => localStorage.getItem("fumiao-appearance")),
      "dark",
    );
    const themeSibling = await pairs[1].context.newPage();
    await open(themeSibling, "/studio", true, fixture.team);
    await settings(themeSibling);
    await setTab(themeSibling, "general");
    await expect(
      themeSibling.getByRole("radio", { name: "深色" }),
    ).toHaveAttribute("aria-checked", "true");
    await candidate.getByRole("radio", { name: "浅色" }).click();
    await expect(
      themeSibling.getByRole("radio", { name: "浅色" }),
    ).toHaveAttribute("aria-checked", "true");
    await themeSibling.close();
    candidate.off("request", watchWrites);
    assert.deepEqual(generalWrites, []);
    await setTab(candidate, "profile");
    await expect(candidate.locator("#nickname")).toHaveValue(
      "  " + nickname + "  ",
    );
    const referenceNickname = "原入口合成昵称";
    await original.locator("#nickname").fill("  " + referenceNickname + "  ");
    await capture(
      original,
      "/api/me",
      "PATCH",
      () => original.locator(".profile-save").click(),
      {
        nickname: referenceNickname,
      },
    );
    await expect(original.locator(".profile-save-status")).toHaveText("已保存");
    await capture(
      candidate,
      "/api/me",
      "PATCH",
      () => candidate.locator(".profile-save").click(),
      { nickname },
    );
    await expect(candidate.locator(".profile-save-status")).toHaveText(
      "已保存",
    );
    await expect(candidate.locator(".account")).toHaveAttribute(
      "title",
      nickname,
    );
    assert.equal(
      (await state(backend.member, fixture.personal)).me.nickname,
      nickname,
    );
    for (const page of [original, candidate]) {
      await action(page, "avatar-picker").click();
      const avatar = page
        .locator('.avatar-library button[aria-pressed="false"]')
        .first();
      const id = (await avatar.getAttribute("data-key"))!;
      await capture(page, "/api/me", "PATCH", () => avatar.click(), {
        avatar: id,
      });
      await expect(page.locator("#modal")).toBeHidden();
      assert.equal(
        (await state(backend.member, fixture.personal)).me.avatar,
        id,
      );
    }
    await action(candidate, "avatar-picker").click();
    const avatarBytes = await sharp({
      create: { width: 80, height: 60, channels: 3, background: "#396a93" },
    })
      .png()
      .toBuffer();
    const avatarPath = "/api/me/avatar";
    const added = await capture(candidate, avatarPath, "PUT", () =>
      candidate.locator("#avatar-file").setInputFiles({
        name: "头像 对照.png",
        mimeType: "image/png",
        buffer: avatarBytes,
      }),
    );
    assert.equal(
      added.request().headers()["x-file-name"],
      encodeURIComponent("头像 对照.png"),
    );
    assert.deepEqual(added.request().postDataBuffer(), avatarBytes);
    const avatarState = (await state(backend.member, fixture.personal)).me;
    await expect(
      candidate.locator(".profile-avatar-control img"),
    ).toHaveAttribute("src", avatarState.avatar_url);
    const avatarFile = await fetchAs(
      backend.web,
      backend.member,
      avatarState.avatar_url,
    );
    assert.equal(avatarFile.status, 200);
    assert.equal(
      (await sharp(Buffer.from(await avatarFile.arrayBuffer())).metadata())
        .format,
      "webp",
    );
    await action(candidate, "own-password").click();
    const nextPassword = "synthetic-settings-password-2";
    const passwordPath = "/api/me/password";
    const secondLogin = await fetchAs(backend.web, "", "/api/login", {
      body: { name: avatarState.name, password: backend.memberPassword },
    });
    assert.equal(secondLogin.status, 200);
    const secondSession = secondLogin.headers.get("set-cookie")!.split(";")[0];
    await secondLogin.body?.cancel();
    await candidate.locator('[name="current"]').fill("wrong-current-password");
    await candidate.locator('[name="password"]').fill(nextPassword);
    await candidate
      .locator('[name="confirm"]')
      .fill("mismatching-next-password");
    await candidate.locator("#password-form button").click();
    await expect(candidate.locator("#toast")).toHaveText(
      "两次输入的密码不一致",
    );
    await candidate.locator('[name="confirm"]').fill(nextPassword);
    await capture(
      candidate,
      passwordPath,
      "POST",
      () => candidate.locator("#password-form button").click(),
      { current_password: "wrong-current-password", password: nextPassword },
      400,
    );
    await expect(candidate.locator("#modal")).toBeVisible();
    await candidate.locator('[name="current"]').fill(backend.memberPassword);
    await capture(
      candidate,
      passwordPath,
      "POST",
      () => candidate.locator("#password-form button").click(),
      { current_password: backend.memberPassword, password: nextPassword },
    );
    await expect(candidate.locator("#modal")).toBeHidden();
    assert.equal(
      (await fetchAs(backend.web, secondSession, "/api/state")).status,
      401,
    );
    assert.equal(
      (
        await fetchAs(backend.web, "", "/api/login", {
          body: { name: avatarState.name, password: backend.memberPassword },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetchAs(backend.web, "", "/api/login", {
          body: { name: avatarState.name, password: nextPassword },
        })
      ).status,
      200,
    );
    assert.equal(
      (await state(backend.member, fixture.team)).me.avatar_url,
      avatarState.avatar_url,
    );
    assert.equal(
      (
        await fetchAs(backend.web, backend.member, "/api/me", {
          method: "PATCH",
          body: { nickname: "外站写入" },
          origin: "http://127.0.0.1:1",
        })
      ).status,
      403,
    );

    step = backendName + " pagination, visibility and workspace switch";
    await all(pairs, (page, react) =>
      open(page, "/studio", react, fixture.team),
    );
    await all(pairs, async (page) => {
      await settings(page);
      await setTab(page, "credits");
    });
    await all(pairs, async (page) => {
      await expect(page.locator(".credit-ledger-row")).toHaveCount(50);
      const before = await action(page, "credit-more").getAttribute(
        "data-before",
      );
      await capture(page, "/api/credits?before=" + before, "GET", () =>
        action(page, "credit-more").click(),
      );
      await expect(page.locator(".credit-ledger-row")).toHaveCount(55);
      await expect(action(page, "credit-more")).toHaveCount(0);
      await capture(page, "/api/recharge", "GET", () =>
        action(page, "recharge-history").click(),
      );
      await expect(page.locator(".recharge-order-row")).toHaveCount(30);
      const cursor = await page
        .locator(".recharge-order-row")
        .last()
        .getAttribute("data-order");
      await capture(page, "/api/recharge?before=" + cursor, "GET", () =>
        page.locator("#recharge-more").click(),
      );
      await expect(page.locator(".recharge-order-row")).toHaveCount(35);
      await expect(page.locator("#recharge-more")).toHaveCount(0);
      await expect(
        page.locator(
          `[data-order="${fixture.orderId(35)}"], [data-order="${fixture.orderId(36)}"]`,
        ),
      ).toHaveCount(0);
      await page.locator("#close-modal").click();
    });
    await compare(
      backendName + "-ledger-paginated",
      [original, candidate],
      "积分",
    );
    assert.equal(
      (
        await fetchAs(
          backend.web,
          backend.admin,
          "/api/recharge/orders/" + fixture.orderId(34),
          { workspace: fixture.team },
        )
      ).status,
      404,
    );
    await candidate.locator(".workspace-switch").click();
    await capture(
      candidate,
      `/api/workspaces/${fixture.personal}/select`,
      "POST",
      () =>
        candidate
          .locator(`.space-option[data-id="${fixture.personal}"]`)
          .click(),
      {},
    );
    await expect(candidate).toHaveURL(
      new RegExp(`/studio\\?workspace=${fixture.personal}$`),
    );
    await settings(candidate);
    await setTab(candidate, "credits");
    await action(candidate, "recharge-history").click();
    await expect(candidate.locator(".recharge-order-row")).toHaveCount(1);
    await expect(candidate.locator(".recharge-order-row")).toHaveAttribute(
      "data-order",
      fixture.orderId(35),
    );
    await expect(candidate.locator(".credit-ledger")).not.toContainText(
      "合成明细",
    );

    step = backendName + " payment creation, retry and settlement";
    await all(pairs, (page, react) =>
      open(page, "/studio", react, fixture.team),
    );
    await all(pairs, async (page) => {
      await settings(page);
      await setTab(page, "credits");
    });
    const personalBalance = (await state(backend.member, fixture.personal))
      .credits;
    const teamBalance = (await state(backend.member, fixture.team)).credits;
    await action(candidate, "recharge").click();
    await candidate.locator('input[name="yuan"]').fill("10001");
    await expect(candidate.locator("#recharge-total")).toHaveText("—");
    await candidate.locator("button[data-yuan='1']").click();
    await expect(candidate.locator("#recharge-total")).toHaveText("10");
    const orders = "/api/recharge/orders";
    const orderRoute = backend.web + orders;
    let firstId = "";
    let firstUid = "";
    // Lose the browser's first response after the real isolated server commits.
    await candidate.route(
      orderRoute,
      async (route) => {
        const committed = await route.fetch();
        assert.equal(committed.status(), 200);
        firstId = (await committed.json()).id;
        firstUid = route.request().postDataJSON().uid;
        await route.fulfill({
          status: 502,
          contentType: "application/json",
          body: JSON.stringify({ detail: "合成连接中断" }),
        });
      },
      { times: 1 },
    );
    const submit = () =>
      candidate.locator("#recharge-form button[type=submit]").click();
    await submit();
    await expect(candidate.locator("#recharge-form .form-message")).toHaveText(
      "合成连接中断",
    );
    assert.match(firstUid, /^[a-f0-9-]{36}$/);
    const retry = await capture(candidate, orders, "POST", submit, {
      workspace: fixture.team,
      yuan: 1,
      method: "alipay",
      uid: firstUid,
    });
    const order = await retry.json();
    assert.equal(order.id, firstId);
    const lookup = orders + "/" + firstId;
    await expect(candidate.locator(".recharge-status")).toHaveText("待支付");
    await expect(candidate.locator("#recharge-pay")).toHaveAttribute(
      "href",
      lookup + "/pay",
    );
    const checkout = await fetchAs(
      backend.web,
      backend.member,
      lookup + "/pay",
      { workspace: fixture.team },
    );
    assert.equal(checkout.status, 303);
    const target = new URL(checkout.headers.get("location")!);
    assert.equal(target.origin, fixture.gateway);
    assert.equal(target.searchParams.get("out_trade_no"), firstId);
    const returnPath = "/studio?recharge=" + firstId;
    const paymentReturn = await fetchAs(
      backend.web,
      backend.member,
      "/payments/return?order=" + firstId,
    );
    assert.equal(paymentReturn.headers.get("location"), returnPath);
    assert.equal(paymentReturn.status, 303);
    await json(
      await fetchAs(
        backend.web,
        backend.member,
        `/api/workspaces/${fixture.team}/select`,
        { body: {} },
      ),
    );
    await open(original, returnPath, false);
    await expect(original.locator(".recharge-status")).toHaveText("待支付");
    // Match the return entry on both sides, including the dialog's return focus.
    await open(candidate, "/payments/return?order=" + firstId, true);
    assert.equal(new URL(candidate.url()).pathname, "/studio");
    await compare(
      backendName + "-pending-order",
      [original, candidate],
      "充值订单",
    );
    const auto = await capture(candidate, lookup, "GET", async () => {});
    assert.equal((await auto.json()).state, "pending");
    await fixture.settle(backend.web, firstId, "alipay", "1.00");
    await capture(candidate, lookup, "GET", () =>
      candidate.locator("#recharge-check").click(),
    );
    await expect(candidate.locator(".recharge-status")).toHaveText("已到账");
    await expect(candidate.locator("#recharge-pay")).toBeHidden();
    await expect(candidate.locator("#toast")).toHaveText(
      "充值成功，积分已到账",
    );
    await candidate.locator("#close-modal").click();
    await expect(
      candidate.locator(".credit-summary strong").first(),
    ).toHaveText((teamBalance.available + 10).toLocaleString());
    await open(candidate, returnPath, true, fixture.personal);
    await expect(candidate.locator(".recharge-status")).toHaveText("已到账");
    await expect(candidate.locator(".settings-facts dd").first()).toHaveText(
      "设置对照团队",
    );
    assert.equal(new URL(candidate.url()).searchParams.has("recharge"), false);
    await candidate.locator("#close-modal").click();
    await expect(
      candidate.locator(".credit-summary strong").first(),
    ).toHaveText(personalBalance.available.toLocaleString());
    assert.deepEqual(
      (await state(backend.member, fixture.personal)).credits,
      personalBalance,
    );
    assert.equal(
      (await state(backend.member, fixture.team)).credits.available,
      teamBalance.available + 10,
    );
    await all(pairs, (page, react) =>
      open(page, returnPath, react, fixture.team),
    );
    await compare(
      backendName + "-paid-order",
      [original, candidate],
      "充值订单",
    );

    await open(candidate, "/studio", true, fixture.team);
    await settings(candidate);
    await setTab(candidate, "credits");
    await action(candidate, "recharge").click();
    await candidate.locator('[name="method"][value="usdt_plasma"]').check();
    let abandonedUid = "";
    await candidate.route(
      orderRoute,
      async (route) => {
        abandonedUid = route.request().postDataJSON().uid;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ detail: "合成错误" }),
        });
      },
      { times: 1 },
    );
    await submit();
    await expect(candidate.locator("#recharge-form .form-message")).toHaveText(
      "合成错误",
    );
    await candidate.locator("button[data-yuan='50']").click();
    const created = await request(candidate, orders, "POST", submit);
    const plasmaRequest = created.request().postDataJSON();
    assert.match(plasmaRequest.uid, /^[a-f0-9-]{36}$/);
    assert.notEqual(plasmaRequest.uid, abandonedUid);
    assert.deepEqual(
      requestContract(created.request()),
      contract(orders, "POST", {
        workspace: fixture.team,
        yuan: 50,
        method: "usdt_plasma",
        uid: plasmaRequest.uid,
      }),
    );
    assert.equal(created.status(), 200);
    const plasmaOrder = (await created.json()).id;
    await expect(candidate.locator(".recharge-status")).toHaveText("待支付");
    await fixture.settle(backend.web, plasmaOrder, "usdt_plasma", "50.00");
    await expect(candidate.locator(".recharge-status")).toHaveText("已到账", {
      timeout: 10000,
    });
    await candidate.locator("#close-modal").click();
    const credited = await state(backend.member, fixture.team);
    assert.equal(credited.credits.available, teamBalance.available + 510);
    assert.equal(
      credited.credit_history.filter((entry) => entry.note.includes(firstId))
        .length,
      1,
    );
    assert.equal(
      credited.credit_history.filter((entry) =>
        entry.note.includes(plasmaOrder),
      ).length,
      1,
    );
    await open(candidate, "/payments/return", true);
    await expect(candidate.locator("#modal h2")).toHaveText("充值记录");
    assert.equal(new URL(candidate.url()).pathname, "/studio");
    await open(candidate, "/?recharge=history", true);
    await expect(candidate.locator("#modal-heading")).toHaveText("充值记录");
    await expect(
      candidate.locator(`.recharge-order-row[data-order="${firstId}"]`),
    ).toHaveCount(1);
    await expect(
      candidate.locator(`.recharge-order-row[data-order="${plasmaOrder}"]`),
    ).toHaveCount(1);
    const foreign = await fetchAs(backend.web, backend.admin, lookup, {
      workspace: fixture.team,
    });
    assert.equal(foreign.status, 404);

    await open(candidate, "/studio", true, fixture.team);
    await settings(candidate);
    await setTab(candidate, "credits");
    await action(candidate, "recharge").click();
    await candidate.locator('input[name="yuan"]').fill("3");
    await candidate.locator('[name="method"][value="usdt_plasma"]').check();
    const interrupted = await request(candidate, orders, "POST", submit);
    const unconfirmed = await interrupted.json();
    assert.equal(unconfirmed.state, "unconfirmed");
    await expect(candidate.locator(".recharge-status")).toHaveText("待核对");
    await expect(candidate.locator("#recharge-pay")).toBeHidden();
    await all(pairs, (page, react) =>
      open(page, "/studio?recharge=" + unconfirmed.id, react, fixture.team),
    );
    await compare(
      backendName + "-unconfirmed-order",
      [original, candidate],
      "充值订单",
    );
    await fixture.disablePayments(backend.web);
    await all(pairs, (page, react) =>
      open(page, "/studio", react, fixture.team),
    );
    await all(pairs, async (page) => {
      await settings(page);
      await setTab(page, "credits");
      await action(page, "recharge").click();
      await expect(
        page.locator("#recharge-form button[type=submit]"),
      ).toBeDisabled();
    });
    await compare(
      backendName + "-no-payment-methods",
      [original, candidate],
      "充值积分",
    );

    step = backendName + " administrator navigation";
    const adminPair = await pair(
      browser, errors, backend, "admin", 1440, "light",
    );
    const adminPage = adminPair[1].page;
    await open(adminPage, "/studio", true, adminWorkspace);
    await settings(adminPage);
    const settingsDocument = await adminPage.evaluate(
      () => performance.timeOrigin,
    );
    const adminTabs = {
      models: "模型管理",
      prices: "生成定价",
      creditAdmin: "积分管理",
      openai: "OpenAI",
      chatService: "对话服务",
      workspaces: "团队空间",
      team: "成员管理",
      invites: "邀请码",
      storage: "存储空间",
    };
    for (const [key, heading] of Object.entries(adminTabs)) {
      await setTab(adminPage, key);
      await expect(tab(adminPage, key)).toHaveAttribute("aria-current", "page");
      await expect(adminPage.locator(".settings-content h2")).toHaveText(heading);
      assert.equal(
        await adminPage.evaluate(() => performance.timeOrigin),
        settingsDocument,
      );
    }
    await Promise.all(adminPair.map(({ context }) => context.close()));
    await open(candidate, "/studio", true, fixture.team);
    await settings(candidate);
    await setTab(candidate, "gpu");
    await expect(tab(candidate, "gpu")).toHaveAttribute("aria-current", "page");
    await expect(tab(candidate, "gpu")).toHaveText("GPU 接入");
    await expect(candidate.locator(".settings-content h2")).toHaveText(
      "GPU 实例",
    );
    await assertStudio(candidate, true);
    for (const path of ["/api/admin/credits", "/api/admin/chat"]) {
      assert.equal(
        (
          await fetchAs(backend.web, backend.member, path, {
            workspace: fixture.team,
          })
        ).status,
        403,
        path,
      );
    }
    await Promise.all(pairs.map(({ context }) => context.close()));
    console.log(
      backendName +
        " settings matrix, writeback, pagination, payment and tab navigation passed",
    );
  }

  assert.deepEqual(errors, [], "uncaught browser errors");
  fixture.verifyGateway();
  await writeFile(join(out, "results.json"), JSON.stringify(results, null, 2));
  console.log(`PASS ${results.length} UI comparisons, including ${results.filter(({ redesigned }) => redesigned).length} settings redesign states`);
} catch (error) {
  console.error("Settings parity failed at", step);
  throw error;
} finally {
  await browser?.close();
  await fixture.cleanup();
}
