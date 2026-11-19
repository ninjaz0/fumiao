import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";
import type { Platform } from "../packages/platform/src/platform.js";
import { originalUI } from "../packages/web-compat/src/ui.js";
import { assertStudio } from "./studio-settings-browser.js";

export async function verifyUpgrade(
  platform: () => Platform,
  web: string,
  directory: string,
  password: string,
  mediaOrigin?: string,
) {
  const expected = JSON.parse(
    await readFile(join(directory, "expected.json"), "utf8"),
  );
  const image = await readFile(
    join(directory, "backup/objects", expected.media),
  );
  const avatar = await readFile(
    join(directory, "backup/avatars", expected.avatar.split("/").at(-1)),
  );
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: web });
    await context.route("**/*", (route) => {
      const { origin } = new URL(route.request().url());
      return origin === web || origin === mediaOrigin
        ? route.continue()
        : route.abort();
    });
    const page = await context.newPage();
    const request = context.request;
    const statePath = "/api/state";
    const mediaPath = "/media/" + expected.media;
    const canvasPath = "/api/canvases/" + expected.canvas;
    const chatPath = "/api/chats/" + expected.chat;
    const draft = "切换前保留的浏览器草稿";
    const draftKey = `fm-draft-${expected.admin_id}-workspace-${expected.private_id}`;
    await context.addCookies([
      {
        name: "fm_session",
        value: expected.legacy_cookie.slice("fm_session=".length),
        url: web,
      },
    ]);
    assert.equal((await request.get(statePath)).status(), 401);
    assert.equal((await request.get(mediaPath)).status(), 401);
    await page.goto("/studio");
    await page.evaluate(
      ([key, prompt]) => {
        sessionStorage.setItem(
          key,
          JSON.stringify({ draft: { prompt }, refs: [] }),
        );
      },
      [draftKey, draft],
    );
    await page.locator('[name="user"]').fill("upgrade-admin");
    await page.locator('[name="pw"]').fill(password);
    const login = page.waitForResponse(
      (r) => r.url() === web + "/api/login" && r.request().method() === "POST",
    );
    await page.locator('.auth-form [type="submit"]').click();
    assert.equal((await login).status(), 200);
    await expect(page.locator(".shell")).toBeVisible();
    await expect(page.locator("#prompt")).toHaveText(draft);
    assert.equal(page.url(), web + "/studio");
    await assertStudio(page, true);
    const session = (await context.cookies()).find(
      ({ name }) => name === "fm_session",
    );
    assert.ok(session?.httpOnly);
    assert.notEqual(`fm_session=${session.value}`, expected.legacy_cookie);

    const member = await browser.newContext({ baseURL: web });
    assert.equal(
      (
        await member.request.post("/api/login", {
          headers: { origin: web },
          data: { name: "upgrade-member", password },
        })
      ).status(),
      200,
    );
    const memberRequest = member.request;

    async function readHistory() {
      const state = await request.get(statePath);
      assert.equal(state.status(), 200);
      const data = await state.json();
      assert.equal(data.me.id, expected.admin_id);
      assert.equal(data.me.avatar_url, expected.avatar);
      assert.equal(data.workspace_id, expected.private_id);
      assert.deepEqual(data.pricing, expected.pricing);
      assert.deepEqual(data.model_policy, expected.model_policy);
      const job = data.jobs.find(
        (row: { id: number }) => row.id === expected.job,
      );
      assert.equal(job.status, "done");
      assert.equal(job.result, expected.media);
      assert.deepEqual(job.refs, [expected.media]);
      const creditViews = await Promise.all(
        [expected.private_id, expected.team_id, expected.member_workspace].map(
          async (workspace, i) => {
            const credits = await (i === 2 ? memberRequest : request).get(
              "/api/credits",
              {
                headers: { "X-Workspace-Id": String(workspace) },
              },
            );
            assert.equal(credits.status(), 200);
            return credits.json();
          },
        ),
      );
      assert.deepEqual(creditViews, expected.credits);
      const project = await (await request.get(canvasPath)).json();
      assert.equal(project.title, "历史分镜画布");
      assert.equal(project.document.nodes[0].media_id, expected.media);
      assert.equal(project.revision, 2);
      const conversation = await (await request.get(chatPath)).json();
      assert.equal(conversation.messages.at(-1).content, "历史分镜回复");
      const originalImage = await request.get(mediaPath);
      assert.equal(originalImage.status(), 200);
      assert.deepEqual(await originalImage.body(), image);
      const avatarImage = await request.get(expected.avatar);
      assert.equal(avatarImage.status(), 200);
      assert.deepEqual(await avatarImage.body(), avatar);
      const range = await request.get(mediaPath, {
        headers: { Range: "bytes=0-7" },
        maxRedirects: mediaOrigin ? 0 : undefined,
      });
      if (mediaOrigin) {
        assert.equal(range.status(), 307);
        const signed = new URL(range.headers().location);
        assert.equal(signed.origin, mediaOrigin);
        assert.ok(signed.searchParams.has("X-Amz-Signature"));
        const anonymous = await fetch(signed.origin + signed.pathname);
        assert.equal(anonymous.status, 403);
        await anonymous.body?.cancel();
        const partial = await fetch(signed, {
          headers: { Range: "bytes=0-7" },
        });
        assert.equal(partial.status, 206);
        assert.deepEqual(
          Buffer.from(await partial.arrayBuffer()),
          image.subarray(0, 8),
        );
      } else {
        assert.equal(range.status(), 206);
        assert.deepEqual(await range.body(), image.subarray(0, 8));
      }
      for (const path of [mediaPath, canvasPath, chatPath])
        assert.equal((await memberRequest.get(path)).status(), 404);
      const team = await memberRequest.get("/api/canvases", {
        headers: { "X-Workspace-Id": String(expected.team_id) },
      });
      assert.equal(team.status(), 200);
      assert.match(await team.text(), /旧团队协作画布/);
    }

    const pinned = await request.get("/studio?studio_ui=legacy");
    assert.equal(await pinned.text(), await originalUI().html("index.html"));
    await page.goto("/studio?studio_ui=legacy");
    await expect(page.locator("#prompt")).toHaveText(draft);
    await assertStudio(page, false, "legacy");
    await page.goto("/studio");
    await expect(page.locator("#prompt")).toHaveText(draft);
    await assertStudio(page, true);
    await readHistory();
    const passwords = await platform().db.query(
      "SELECT password FROM users ORDER BY name",
    );
    assert.equal(passwords.rows.length, 2);
    assert.ok(
      passwords.rows.every(({ password }) => password.startsWith("scrypt:")),
    );
    const plugins = async () =>
      (
        await platform().db.query(
          "SELECT DISTINCT plugin_id,plugin_version FROM studio_catalog ORDER BY plugin_id,plugin_version",
        )
      ).rows;
    const versions = await plugins();
    assert.ok(versions.length >= 4);
    assert.deepEqual(
      (
        await platform().db.query(
          "SELECT plugin_id,plugin_version,enabled FROM connections",
        )
      ).rows,
      [
        {
          plugin_id: "legacy-archive",
          plugin_version: "1.0.0",
          enabled: false,
        },
      ],
    );
    const replay = await request.post("/api/image-jobs", {
      headers: { origin: web },
      data: expected.job_draft,
    });
    assert.equal(replay.status(), 200);
    assert.deepEqual(await replay.json(), { id: expected.job });
    await readHistory();
    console.log(
      "Verified original login and replacement session, both Studio views, old browser draft, all wallets and ledger rows, canvas/chat history, private media and historical task replay",
    );
    return {
      close: () => browser.close(),
      async restart() {
        await page.reload();
        await expect(page.locator("#prompt")).toHaveText(draft);
        await assertStudio(page, true);
        assert.deepEqual(
          (await context.cookies()).find(({ name }) => name === "fm_session"),
          session,
        );
        assert.deepEqual(await plugins(), versions);
        await readHistory();
        assert.equal(
          (
            await request.get(statePath, {
              headers: { cookie: expected.legacy_cookie },
            })
          ).status(),
          401,
        );
        console.log(
          "Verified production preview after PostgreSQL and Redis restart with the imported session, browser draft, canvas, files, task history, balances and plugin versions",
        );
      },
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
