/** Compare the administrator settings with the pinned Studio over both real APIs. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, expect, type Page } from "@playwright/test";
import type {
  InviteCode,
  ManagedMember,
  Space,
  StudioState,
} from "../apps/web/studio/state.js";
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

const out = resolve(".runtime-advanced/studio-admin-settings-parity");
const tabs = { workspaces: "团队空间", team: "成员管理", invites: "邀请码" };
const password = "synthetic-admin-settings-pass";
const modal = (page: Page) => page.locator("#modal");
const heading = (page: Page) => page.locator("#modal-heading");
const form = (page: Page, id: string) => modal(page).locator("#" + id);
async function selectExpiry(page: Page, value: "custom" | "never") {
  const expiry = form(page, "invite-form").locator('select[name="expiry"]');
  if (await expiry.count()) await expiry.selectOption(value);
  else
    await form(page, "invite-form")
      .locator(`input[name="expiry"][value="${value}"]`)
      .check();
}
const submit = (page: Page) =>
  modal(page).locator('button[type="submit"]').click();
const row = (page: Page, selector: string, label: string) =>
  page
    .locator(selector)
    .filter({ has: page.getByText(label, { exact: true }) });
const control = (page: Page, name: string, id: number) =>
  page.locator(`[data-act="${name}"][data-id="${id}"]`);
const read = (backend: Backend, cookie: string, workspace?: number) =>
  fetchAs(backend.web, cookie, "/api/state", { workspace }).then(
    json<StudioState>,
  );

async function close(page: Page) {
  await page.keyboard.press("Escape");
  await expect(modal(page)).toBeHidden();
}

const fixture = await settingsFixture();
const results: Comparison[] = [];
const errors: string[] = [];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let step = "start browser";

try {
  await mkdir(out, { recursive: true });
  browser = await chromium.launch({ args: ["--disable-partial-raster"] });
  const time = new Date();
  // Same SQLite snapshot imported into PostgreSQL. Compare both React implementations
  // with the pinned page, then compare Python and Nest on the same rendering state.
  for (const width of [1440, 390])
    for (const theme of ["light", "dark"])
      for (const role of ["admin", "member"] as const) {
        const groups = await Promise.all(
          Object.entries(fixture.backends).map(async ([name, backend]) => ({
            name,
            backend,
            pairs: await pair(browser!, errors, backend, role, width, theme),
          })),
        );
        try {
          const every = <T>(run: (page: Page, react: boolean) => Promise<T>) =>
            Promise.all(groups.map(({ pairs }) => all(pairs, run)));
          async function check(name: string, title: string) {
            step = `${width}-${theme}-${role}-${name}`;
            for (const group of groups)
              results.push(
                await compare(
                  out,
                  `${group.name}-${step}`,
                  group.pairs.map(({ page }) => page),
                  title,
                ),
              );
            results.push(
              await compare(
                out,
                `cross-backend-${step}`,
                groups.map(({ pairs }) => pairs[1].page),
                title,
              ),
            );
          }
          const workspace =
            role === "admin"
              ? (await read(groups[0].backend, groups[0].backend.admin))
                  .workspace_id
              : fixture.team;
          await every(async (page, react) => {
            await page.clock.setFixedTime(time);
            await page.addInitScript(`
              Object.defineProperty(navigator, "clipboard", {
                value: { async writeText() { throw new Error("synthetic clipboard denial"); } },
              });
            `);
            await open(page, "/studio", react, workspace);
            await settings(page);
            await page.locator(".workspace-switch").click();
          });
          if (role === "member") {
            await every(async (page) => {
              await expect(page.locator("#popover .space-create")).toHaveCount(
                0,
              );
              await expect(
                page.getByRole("option", { name: /设置对照团队/ }),
              ).toBeVisible();
              for (const key of Object.keys(tabs))
                await expect(tab(page, key)).toHaveCount(0);
            });
            await check("member-sidebar", "个人资料");
            continue;
          }
          await check("admin-sidebar", "个人资料");
          await every((page) => page.locator("#popover .space-create").click());
          await check("sidebar-create", "创建团队空间");
          await every(async (page) => {
            await close(page);
            await expect(page.locator(".workspace-switch")).toBeFocused();
            await setTab(page, "workspaces");
          });
          await check("workspaces", tabs.workspaces);
          await every((page) =>
            control(page, "edit-workspace", fixture.team).click(),
          );
          await check("workspace-edit", "管理团队空间");
          await every(async (page) => {
            const find = page.getByRole("searchbox", { name: "搜索团队成员" });
            await find.fill("SETTINGS-MEMBER");
            await expect(
              page.locator(".workspace-member-choice:visible"),
            ).toHaveCount(1);
            await expect(page.locator("#workspace-member-count")).toHaveText(
              "已选 1 人",
            );
            await find.fill("不匹配的合成成员");
            await expect(page.locator("#workspace-no-match")).toBeVisible();
            // Capture after keyboard focus moves through the resized form.
            await form(page, "workspace-form").locator('[name="name"]').focus();
            await page.keyboard.press("Tab");
            await expect(find).toBeFocused();
          });
          await check("workspace-search-empty", "管理团队空间");
          await every(async (page) => {
            await form(page, "workspace-form")
              .getByRole("button", { name: "取消" })
              .click();
            await setTab(page, "team");
          });
          await check("members", tabs.team);
          await every((page) => action(page, "add-member").click());
          await check("member-create", "添加成员");
          await every(async (page) => {
            await close(page);
            await action(page, "member-password").click();
          });
          await check("member-password", "修改密码");
          await every(async (page) => {
            await close(page);
            await action(page, "delete-member").click();
          });
          await check("member-delete", "删除 设置对照成员？");
          await every(async (page) => {
            await page.locator("#back").click();
            await setTab(page, "invites");
          });
          await check("invites", tabs.invites);
          await every(async (page, react) => {
            if (!react) return;
            await expect(page.locator(".ledger-ticket")).toHaveCount(1);
            const filter = page.getByRole("radiogroup", { name: "按状态筛选" });
            await filter.getByRole("radio", { name: /^已停用/ }).check();
            await expect(page.getByText("没有符合条件的邀请码")).toBeVisible();
            await page.getByRole("button", { name: "清除筛选" }).click();
            const code = (
              await page.locator(".ledger-ticket code").innerText()
            ).replaceAll("-", "");
            await page
              .getByRole("searchbox", { name: "搜索名称或邀请码" })
              .fill(code);
            await expect(page.locator(".ledger-ticket")).toHaveCount(1);
            await page
              .getByRole("searchbox", { name: "搜索名称或邀请码" })
              .clear();
            await action(page, "invite").focus();
            await page.keyboard.press("/");
            const search = page.getByRole("searchbox", { name: "搜索设置" });
            // The mobile search first opens the settings categories.
            await expect(search).toBeFocused();
            await search.fill("邀请码");
            await search.press("Enter");
            await expect(tab(page, "invites")).toHaveAttribute(
              "aria-current",
              "page",
            );
            await expect(
              page.locator(".ledger-navigation-toggle"),
            ).toHaveAttribute("aria-expanded", "false");
            assert.ok(
              await page
                .locator(".ledger-settings")
                .evaluate(
                  (element) => element.scrollWidth <= element.clientWidth + 1,
                ),
              "settings must fit the viewport",
            );
          });
          await every((page) => action(page, "invite").click());
          await check("invite-create", "创建邀请码");
          await every(async (page) => {
            await selectExpiry(page, "custom");
            await page.getByRole("switch", { name: "赠送初始积分" }).check();
            await expect(
              form(page, "invite-form").locator('[name="expires"]'),
            ).toBeEnabled();
            await expect(
              form(page, "invite-form").locator('[name="amount"]'),
            ).toBeEnabled();
          });
          await check("invite-custom", "创建邀请码");
          await every(async (page) => {
            await page.locator("#cancel-invite").click();
            await action(page, "edit-invite").click();
          });
          await check("invite-edit", "编辑邀请码");
          await every(async (page) => {
            await close(page);
            await action(page, "toggle-invite").click();
          });
          await check("invite-pause", "停用这个邀请码？");
          await every(async (page) => {
            await close(page);
            await action(page, "copy-invite").click();
          });
          await check("invite-copy-fallback", "邀请码");
          await every(async (page) => {
            await page.locator("#copy").click();
            await expect(page.locator("#toast")).toHaveText(
              "请选中内容后手动复制",
            );
            await assertStudio(
              page,
              groups.some(({ pairs }) => pairs[1].page === page),
            );
          });
        } finally {
          await Promise.all(
            groups.flatMap(({ pairs }) =>
              pairs.map(({ context }) => context.close()),
            ),
          );
        }
      }

  for (const [backendName, backend] of Object.entries(fixture.backends)) {
    step = backendName + " write contracts";
    const workspace = (await read(backend, backend.admin)).workspace_id;
    const member = (await read(backend, backend.member)).me;
    const pairs = await pair(browser, errors, backend, "admin", 1440, "light");
    const observers = await pair(
      browser,
      errors,
      backend,
      "member",
      390,
      "dark",
    );
    try {
      for (const [{ page, react }, observer] of pairs.map(
        (pair, i) => [pair, observers[i]] as const,
      )) {
        const variant = react ? "react" : "legacy";
        const name = "合成团队 " + variant;
        const memberName = "admin-settings-" + variant;
        const capture = async (
          path: string,
          method: string,
          act: () => Promise<unknown>,
          body?: object,
          status = 200,
          selected = workspace,
        ) => {
          const response = await request(page, path, method, act);
          assert.equal(response.status(), status, path);
          assert.deepEqual(requestContract(response.request()), {
            path,
            method,
            origin: backend.web,
            workspace: String(selected),
            body,
          });
          assert.equal(
            response.headers()["x-settings-fixture"],
            backendName === "nest" ? "nest" : undefined,
          );
          return response;
        };
        const mutate = (
          cookie: string,
          path: string,
          method: string,
          body?: object,
          selected = workspace,
        ) =>
          fetchAs(backend.web, cookie, path, {
            method,
            body,
            workspace: selected,
          });
        const state = () => read(backend, backend.admin, workspace);

        step = `${backendName}-${variant} team form and workspace isolation`;
        await open(page, "/studio", react, workspace);
        await page.locator(".workspace-switch").click();
        await page.locator("#popover .space-create").click();
        const workspaceForm = form(page, "workspace-form");
        await workspaceForm.locator('[name="name"]').fill("  " + name + "  ");
        await workspaceForm
          .locator(`[name="member"][value="${member.id}"]`)
          .check();
        const members = [member.id];
        // Hold the response so a rapid repeat hits the disabled submit control.
        let writes = 0;
        await page.route("**/api/workspaces", async (route) => {
          if (route.request().method() !== "POST") return route.continue();
          writes++;
          const response = await route.fetch();
          await route.fulfill({ response });
        });
        const team: Space = await (
          await capture(
            "/api/workspaces",
            "POST",
            async () => {
              await workspaceForm
                .locator('button[type="submit"]')
                .evaluate((button: HTMLButtonElement) => {
                  button.click();
                  button.click();
                });
            },
            { name, members },
          )
        ).json();
        await expect(modal(page)).toBeHidden();
        assert.equal(writes, 1);
        await page.unroute("**/api/workspaces");
        await expect(page.locator("#toast")).toHaveText("团队已创建");
        await settings(page);
        await setTab(page, "workspaces");
        await expect(row(page, ".workspace-row", name)).toContainText(
          "1 位成员",
        );
        await action(page, "create-workspace").click();
        await workspaceForm.locator('[name="name"]').fill(name);
        await capture(
          "/api/workspaces",
          "POST",
          () => submit(page),
          { name, members: [] },
          409,
        );
        await expect(workspaceForm.locator(".form-message")).toHaveText(
          "团队名称已存在",
        );
        await expect(workspaceForm.locator('[name="name"]')).toHaveValue(name);
        await close(page);

        const teamPath = "/api/workspaces/" + team.id;
        await capture(
          teamPath + "/select",
          "POST",
          () =>
            row(page, ".workspace-row", name)
              .getByRole("button", { name: "进入" })
              .click(),
          {},
        );
        await expect(page).toHaveURL(new RegExp(`workspace=${team.id}`));
        await expect(page.locator(".workspace-switch")).toHaveAttribute(
          "title",
          name,
        );
        await expect(page.locator(".settings-page")).toHaveCount(0);
        await assertStudio(page, react);

        await json(
          await mutate(backend.member, teamPath + "/select", "POST", {}),
        );
        await open(observer.page, "/studio", react, team.id);
        await expect(
          observer.page.locator(".workspace-switch"),
        ).toHaveAttribute("title", name);
        const adminPersonal = (await state()).workspaces.find(
          ({ kind }) => kind === "personal",
        )!.id;
        assert.equal(
          (
            await mutate(
              backend.member,
              "/api/state",
              "GET",
              undefined,
              adminPersonal,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await mutate(
              backend.admin,
              "/api/state",
              "GET",
              undefined,
              fixture.personal,
            )
          ).status,
          403,
        );
        assert.equal(
          (await mutate(backend.member, "/api/invite-codes", "GET")).status,
          403,
        );
        assert.equal(
          (
            await mutate(backend.member, "/api/workspaces", "POST", {
              name,
              members,
            })
          ).status,
          403,
        );
        const hidden = await read(backend, backend.member, team.id);
        assert.equal(hidden.users, undefined);
        assert.equal(hidden.invite_codes, undefined);
        assert.equal(
          hidden.workspaces.find(({ id }) => id === team.id)?.members,
          undefined,
        );

        await settings(page);
        await setTab(page, "workspaces");
        await control(page, "edit-workspace", team.id).click();
        const renamed = name + " 已改名";
        await json(
          await mutate(backend.admin, teamPath, "PATCH", {
            name: renamed,
            members,
            expected_revision: team.revision,
          }),
        );
        await expect(
          observer.page.locator(".workspace-switch"),
        ).toHaveAttribute("title", renamed, { timeout: 12000 });
        await capture(
          teamPath,
          "PATCH",
          () => submit(page),
          { name, members, expected_revision: team.revision },
          409,
          team.id,
        );
        await expect(workspaceForm.locator(".form-message")).toHaveText(
          "团队信息已更新，请重新打开后修改",
        );
        await close(page);
        // Wait for the post-conflict list to reflect the newer server revision.
        await expect(row(page, ".workspace-row", renamed)).toBeVisible({
          timeout: 12000,
        });
        await control(page, "edit-workspace", team.id).click();
        await workspaceForm
          .locator(`[name="member"][value="${member.id}"]`)
          .uncheck();
        await capture(
          teamPath,
          "PATCH",
          () => submit(page),
          { name: renamed, members: [], expected_revision: team.revision + 1 },
          200,
          team.id,
        );
        await expect(modal(page)).toBeHidden();
        await expect(row(page, ".workspace-row", renamed)).toContainText(
          "0 位成员",
        );
        // The member's saved default was selected before access was removed.
        await expect(observer.page).toHaveURL(
          new RegExp(`workspace=${fixture.personal}(?:&|$)`),
          { timeout: 12000 },
        );
        await assertStudio(observer.page, react);
        await expect(
          observer.page.locator(".workspace-switch"),
        ).toHaveAttribute("title", "个人空间");
        await observer.page.locator(".workspace-switch").click();
        await expect(
          observer.page.locator(`.space-option[data-id="${team.id}"]`),
        ).toHaveCount(0);
        assert.equal(
          (await mutate(backend.member, teamPath + "/select", "POST", {}))
            .status,
          403,
        );

        step = `${backendName}-${variant} members`;
        await setTab(page, "team");
        await action(page, "add-member").click();
        const add = form(page, "add-member-form");
        const addBody = {
          name: memberName,
          nickname: "合成成员 " + variant,
          password,
        };
        const fillMember = async (username: string) => {
          await add.locator('[name="username"]').fill(username);
          await add.locator('[name="nickname"]').fill(addBody.nickname);
          await add.locator('[name="password"]').fill(password);
        };
        await fillMember(member.name);
        await capture(
          "/api/users",
          "POST",
          () => submit(page),
          { ...addBody, name: member.name },
          409,
          team.id,
        );
        await expect(page.locator("#toast")).toHaveText("用户名已被使用");
        await fillMember(memberName);
        const account: ManagedMember = await (
          await capture(
            "/api/users",
            "POST",
            () => submit(page),
            addBody,
            200,
            team.id,
          )
        ).json();
        await expect(modal(page)).toBeHidden();
        await expect(row(page, ".member-row", addBody.nickname)).toBeVisible();
        const login = async (password: string) =>
          fetchAs(backend.web, "", "/api/login", {
            body: { name: memberName, password },
          });
        const loggedIn = await login(password);
        const accountSession = loggedIn.headers
          .get("set-cookie")!
          .split(";")[0];
        assert.equal(loggedIn.status, 200);
        await control(page, "member-password", account.id).click();
        const reset = form(page, "password-form");
        const newPassword = password + "-reset";
        await reset.locator('[name="password"]').fill(newPassword);
        await reset.locator('[name="confirm"]').fill(password);
        await submit(page);
        await expect(page.locator("#toast")).toHaveText("两次输入的密码不一致");
        await reset.locator('[name="confirm"]').fill(newPassword);
        await capture(
          `/api/users/${account.id}/password`,
          "POST",
          () => submit(page),
          { password: newPassword },
          200,
          team.id,
        );
        await expect(page.locator("#toast")).toHaveText(
          "密码已修改，原登录会话已退出",
        );
        assert.equal(
          (await mutate(accountSession, "/api/state", "GET")).status,
          401,
        );
        assert.equal((await login(password)).status, 401);
        const afterReset = await login(newPassword);
        const resetSession = afterReset.headers
          .get("set-cookie")!
          .split(";")[0];
        assert.equal(afterReset.status, 200);
        await control(page, "delete-member", account.id).click();
        await capture(
          `/api/users/${account.id}`,
          "DELETE",
          () => page.locator("#confirm").click(),
          undefined,
          200,
          team.id,
        );
        await expect(row(page, ".member-row", addBody.nickname)).toHaveCount(0);
        assert.equal(
          (await mutate(resetSession, "/api/state", "GET")).status,
          401,
        );
        assert.equal((await login(newPassword)).status, 401);
        assert.deepEqual(
          await json(
            await mutate(backend.admin, `/api/users/${account.id}`, "DELETE"),
            404,
          ),
          { detail: "成员不存在" },
        );

        step = `${backendName}-${variant} invites`;
        await setTab(page, "invites");
        await action(page, "invite").click();
        const invitation = form(page, "invite-form");
        const inviteBody = {
          name: "合成邀请码 " + variant,
          expires: null,
          grant_credits: true,
          initial_credits: 37,
          team_id: team.id,
        };
        await invitation.locator('[name="label"]').fill(inviteBody.name);
        await selectExpiry(page, "custom");
        await invitation.locator('[name="expires"]').fill("2023-11-14T13:30");
        await page.getByRole("switch", { name: "赠送初始积分" }).check();
        await invitation.locator('[name="amount"]').fill("37");
        await invitation.locator('[name="team"]').selectOption(String(team.id));
        await capture(
          "/api/invite-codes",
          "POST",
          () => submit(page),
          {
            ...inviteBody,
            expires: Date.parse("2023-11-14T13:30:00+09:00") / 1000,
          },
          400,
          team.id,
        );
        await expect(invitation.locator(".form-message")).toHaveText(
          "到期时间需要晚于当前时间",
        );
        await selectExpiry(page, "never");
        const invite: InviteCode = await (
          await capture(
            "/api/invite-codes",
            "POST",
            () => submit(page),
            inviteBody,
            200,
            team.id,
          )
        ).json();
        const invitePath = "/api/invite-codes/" + invite.id;
        const inviteRow = row(page, ".invite-code-row", inviteBody.name);
        await expect(inviteRow).toContainText(renamed);
        await expect(inviteRow).toContainText("37 / 人");
        const registration = {
          name: "redeem-" + variant,
          nickname: "合成注册成员 " + variant,
          password,
          code: invite.code,
        };
        const register = () =>
          fetchAs(backend.web, "", "/api/register", { body: registration });
        const registrationResponse = await register();
        await json(registrationResponse);
        const registrationSession = registrationResponse.headers
          .get("set-cookie")!
          .split(";")[0];
        const registered = await read(backend, registrationSession);
        assert.equal(registered.workspace_id, team.id);
        assert.equal(registered.credits.available, 0);
        const registeredPersonal = registered.workspaces.find(
          ({ kind }) => kind === "personal",
        )!.id;
        assert.equal(
          (await read(backend, registrationSession, registeredPersonal)).credits
            .available,
          37,
        );
        assert.equal((await register()).status, 409);
        await expect(inviteRow).toContainText("1 人", { timeout: 12000 });
        await inviteRow.getByRole("button", { name: "停用" }).click();
        await capture(
          invitePath,
          "PATCH",
          () => page.locator("#confirm").click(),
          { enabled: false, expected_revision: invite.revision },
          200,
          team.id,
        );
        await expect(inviteRow.locator(".invite-status")).toHaveText("已停用");
        assert.equal(
          (await read(backend, registrationSession)).workspace_id,
          team.id,
        );
        const paused = await fetchAs(backend.web, "", "/api/register", {
          body: { ...registration, name: "paused-" + variant },
        });
        assert.deepEqual(await json(paused, 403), {
          detail: "邀请码无效、已过期或已停用，请向管理员获取有效邀请码",
        });

        await fixture.expireInvite(backend.web, invite.id);
        await inviteRow.getByRole("button", { name: "启用" }).click();
        await capture(
          invitePath,
          "PATCH",
          () => page.locator("#confirm").click(),
          { enabled: true, expected_revision: invite.revision + 1 },
          400,
          team.id,
        );
        await expect(page.locator("#toast")).toHaveText(
          "邀请码已过期，请先编辑有效期",
        );
        await expect(modal(page)).toBeVisible();
        await close(page);
        await inviteRow.getByRole("button", { name: "编辑" }).click();
        await selectExpiry(page, "never");
        const edited = {
          ...inviteBody,
          grant_credits: false,
          initial_credits: 0,
          team_id: null,
          expected_revision: invite.revision + 1,
        };
        await page.getByRole("switch", { name: "赠送初始积分" }).uncheck();
        await invitation.locator('[name="team"]').selectOption("");
        await capture(
          invitePath,
          "PATCH",
          () => submit(page),
          edited,
          200,
          team.id,
        );
        await expect(page.locator("#toast")).toHaveText("邀请码已保存");
        await expect(inviteRow).toContainText("不赠送");
        await expect(inviteRow).toContainText("仅个人空间");
        const stale = await mutate(backend.admin, invitePath, "PATCH", edited);
        assert.deepEqual(await json(stale, 409), {
          detail: "邀请码已被修改，请关闭后重新打开",
        });
        await inviteRow.getByRole("button", { name: "启用" }).click();
        await capture(
          invitePath,
          "PATCH",
          () => page.locator("#confirm").click(),
          { enabled: true, expected_revision: invite.revision + 2 },
          200,
          team.id,
        );
        await expect(inviteRow.locator(".invite-status")).toHaveText("有效");
        await page.evaluate(`
          Object.defineProperty(navigator, "clipboard", {
            value: { async writeText(text) { document.body.dataset.copied = text; } },
          });
        `);
        await control(page, "copy-invite", invite.id).click();
        await expect(page.locator("#toast")).toHaveText("邀请码已复制");
        assert.equal(
          await page.evaluate(() => document.body.dataset.copied),
          invite.code,
        );
      }

      step = backendName + " admin permission revocation";
      const candidate = pairs[1].page;
      const adminPersonal = (
        await read(backend, backend.admin)
      ).workspaces.find(({ kind }) => kind === "personal")!.id;
      await all(pairs, async (page, react) => {
        await open(page, "/studio", react, adminPersonal);
        await settings(page);
        await setTab(page, "invites");
        await action(page, "invite").click();
        await form(page, "invite-form")
          .locator('[name="label"]')
          .fill("不应写入");
      });
      await fixture.demoteAdmin(backend.web);
      // Keep the open forms on screen until the denied mutation reaches both backends.
      await all(pairs, async (page) => {
        const replied = await request(page, "/api/invite-codes", "POST", () =>
          submit(page),
        );
        assert.equal(replied.status(), 403);
        assert.deepEqual(await replied.json(), { detail: "需要管理员权限" });
      });
      await expect(modal(candidate)).toBeHidden();
      await expect(tab(candidate, "general")).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(tab(candidate, "invites")).toHaveCount(0);
      await expect(candidate.locator(".invite-code-value")).toHaveCount(0);
      await expect(candidate.locator("#invite-form")).toHaveCount(0);
      await candidate.locator(".workspace-switch").click();
      await expect(candidate.locator("#popover .space-create")).toHaveCount(0);
      assert.equal(
        (await read(backend, backend.admin, adminPersonal)).invite_codes,
        undefined,
      );
      console.log(
        backendName +
          " administrator settings writes, isolation and revocation passed",
      );
    } finally {
      await Promise.all(
        [...pairs, ...observers].map(({ context }) => context.close()),
      );
    }
  }
  assert.deepEqual(errors, [], "uncaught browser errors");
  await writeFile(join(out, "results.json"), JSON.stringify(results, null, 2));
  console.log(
    `PASS ${results.length} UI comparisons, including ${results.filter(({ redesigned }) => redesigned).length} settings redesign states`,
  );
} catch (error) {
  console.error("Administrator settings parity failed at", step);
  throw error;
} finally {
  await browser?.close();
  await fixture.cleanup();
}
