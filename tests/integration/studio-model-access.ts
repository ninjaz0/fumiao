import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { chromium, expect, type Browser, type Page } from "@playwright/test";
import { creditUnits } from "@fumiao/platform/credit-amount.js";
import { one } from "@fumiao/platform/db.js";
import type { Platform } from "@fumiao/platform/platform.js";
import { studio, type StudioClient } from "./studio-nest-restore.js";
import { until } from "./studio-nest-restore-media.js";
import { settings, setTab, request } from "./studio-settings-browser.js";
import type { ModelProvider } from "./studio-model-access-provider.js";

const access = "/api/admin/model-access";
const host = "https://model-access.invalid";
const labels = { chat: "验收对话", image: "验收图片", video: "验收视频" };
type Kind = keyof typeof labels;
type Publication = {
  catalog_id: string;
  label: string;
  revision: number;
  route_revision_id: string;
  price_revision_id: string;
};
type ModelMap = Record<Kind, Publication>;

async function sessionPage(
  browser: Browser,
  origin: string,
  session: StudioClient,
) {
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width: 1440, height: 960 },
  });
  await context.addCookies([
    {
      name: "fm_session",
      value: session.cookie.slice("fm_session=".length),
      url: origin,
    },
  ]);
  const page = await context.newPage();
  await page.goto("/studio");
  return page;
}

async function publishModels(
  page: Page,
  admin: StudioClient,
  provider: ModelProvider,
) {
  await settings(page);
  await setTab(page, "modelAccess");
  const form = page.locator(".model-access");
  await form.getByRole("button", { name: "接入服务", exact: true }).click();
  await form.getByRole("button", { name: "添加连接" }).click();
  await form
    .getByLabel("API 根地址", { exact: true })
    .fill(host + "/primary/v1/");
  await form
    .getByLabel("API 密钥", { exact: true })
    .fill(provider.keys.primary);
  await form.getByRole("button", { name: /^保存(连接|并读取模型)/ }).click();
  await expect(
    form.getByRole("status").filter({ hasText: "目录已读取" }).first(),
  ).toBeVisible();
  await form.getByRole("checkbox", { name: /全选搜索结果/ }).check();
  const row = (kind: Kind) =>
    form.getByRole("region", { name: "suite-" + kind + " 设置", exact: true });
  for (const kind of ["chat", "image", "video"] as const)
    await row(kind).getByLabel("公开名称").fill(labels[kind]);
  await row("chat")
    .getByLabel(/^普通输入价/)
    .fill("100");
  await row("chat")
    .getByLabel(/^输出价/)
    .fill("400");
  await row("chat")
    .locator("summary")
    .filter({ hasText: "缓存价格与试算" })
    .click();
  await row("chat").getByLabel("缓存命中价", { exact: true }).fill("20");
  await expect(
    row("chat").getByLabel("缓存写入价", { exact: true }),
  ).toHaveValue("");
  await row("image")
    .getByLabel(/^每张图片售价/)
    .fill("0.25");
  await row("video")
    .getByLabel(/^每秒视频售价/)
    .fill("3");
  await form
    .getByRole("combobox", { name: /^连接默认视频格式/ })
    .selectOption("new-api-videos");
  const response = await request(page, access + "/publications", "POST", () =>
    form.getByRole("button", { name: "确认上架所选模型", exact: true }).click(),
  );
  assert.equal(response.status(), 200, await response.text());
  const { publications } = await admin.read(access);
  const models = {} as ModelMap;
  for (const kind of ["chat", "image", "video"] as const) {
    models[kind] = publications.find(
      (p: Publication) => p.label === labels[kind],
    );
    assert.ok(models[kind]);
  }
  assert.deepEqual(provider.wire, ["primary GET models"]);
  return models;
}

async function chatTurn(page: Page, session: StudioClient, model: Publication) {
  const { conversation } = await session.write("/api/chats", {
    model: model.catalog_id,
  });
  const path = "/api/chats/" + conversation.id;
  await page.locator('nav [data-nav="chat"]').click();
  await page
    .locator(
      '[data-conversation="' +
        conversation.id +
        '"] .fm-chat-conversation-open',
    )
    .click();
  const trigger = page.locator(".fm-chat-model-trigger");
  if (
    (await trigger.getAttribute("aria-label")) !==
    "对话模型：" + model.label
  ) {
    await trigger.click();
    await page.getByRole("option", { name: model.label, exact: true }).click();
  }
  const composer = page.locator(".fm-chat-composer");
  await composer
    .getByRole("textbox", { name: "发送消息" })
    .fill("写一句镜头说明。");
  await expect(composer.locator(".fm-chat-cost")).toContainText(/最高 ?[\d.]+/);
  const sent = await request(page, path + "/messages", "POST", () =>
    composer.getByRole("button", { name: "发送", exact: true }).click(),
  );
  assert.equal(sent.status(), 200, await sent.text());
  const receipt = page
    .locator("details.fm-chat-bill")
    .filter({ hasText: "实扣 0.64 积分" });
  await expect(receipt).toBeVisible({ timeout: 25000 });
  await receipt.locator("summary").click();
  await expect(receipt.getByText(/缓存写入 1000 Token/)).toBeVisible();
  const bills = (await session.read(path + "/bills")).bills;
  assert.equal(bills.length, 1);
  assert.equal(bills[0].charged, "0.64");
  assert.deepEqual(
    bills[0].lines.map((line: { subtotal: string }) => line.subtotal),
    ["0.2", "0.14", "0.1", "0.2"],
  );
  assert.equal(bills[0].lines[2].inherited_from, "input");
  return { path, bills, body: sent.request().postDataJSON() };
}

async function submitMedia(
  page: Page,
  model: Publication,
  kind: "image" | "video",
) {
  await page.goto("/studio");
  const composer = page.locator(".composer");
  await composer.locator('[data-menu="creation"]').click();
  await page
    .locator('#popover [data-act="creation"][data-value="' + kind + '"]')
    .click();
  await composer.locator('[data-menu="image-model"]').click();
  const quantity = kind === "image" ? 1 : 8;
  const [quote] = await Promise.all([
    page.waitForResponse(async (res) => {
      if (new URL(res.url()).pathname !== "/api/estimate" || !res.ok())
        return false;
      return (
        res.request().postDataJSON().model === model.catalog_id &&
        (await res.json()).max_charge === (kind === "image" ? "0.25" : "24")
      );
    }),
    (async () => {
      await page
        .locator(
          '#popover [data-act="image-model"][data-value="' +
            model.catalog_id +
            '"]',
        )
        .click();
      const field = composer
        .locator(".model-parameter input,.model-parameter select")
        .and(
          composer.getByLabel(
            kind === "image"
              ? /张数|图片数量|生成数量|^n$/i
              : /视频时长|时长|秒数|duration|seconds/i,
          ),
        )
        .first();
      await expect(field).toBeVisible();
      if ((await field.evaluate((el) => el.tagName)) === "SELECT")
        await field.selectOption(String(quantity));
      else await field.fill(String(quantity));
      await composer.locator("#prompt").fill(model.label + "，正常生成。");
    })(),
  ]);
  const expected = await quote.json();
  const path = kind === "image" ? "/api/image-jobs" : "/api/jobs";
  await expect(composer.locator(".generate-button")).toBeEnabled();
  const result = await request(page, path, "POST", () =>
    composer.locator(".generate-button").click(),
  );
  assert.equal(result.status(), 200, await result.text());
  const body = result.request().postDataJSON();
  assert.ok(body.uid);
  assert.equal(body.params[kind === "image" ? "n" : "seconds"], quantity);
  assert.equal(body.max_charge, expected.max_charge);
  assert.equal(body.price_revision, expected.price_revision);
  assert.equal(body.price_revision_id, model.price_revision_id);
  assert.equal(body.route_revision, model.route_revision_id);
  const { id } = await result.json();
  assert.ok(Number.isSafeInteger(id));
  return { path, body, id: id as number };
}

async function switchVideo(
  admin: StudioClient,
  prior: Publication,
  provider: ModelProvider,
) {
  const list = await admin.read(access);
  const a = list.connections.find(
    (c: { base_url: string }) => c.base_url === host + "/primary/v1",
  );
  const b = await admin.write(access + "/connections", {
    name: "四秒备用",
    base_url: host + "/secondary/v1",
    api_key: provider.keys.secondary,
    default_video_protocol: "openrouter-videos",
  });
  const directory = await admin.write(
    access + "/connections/" + b.id + "/discover",
    { expected_revision: b.revision },
  );
  assert.deepEqual(directory.candidates[0].parameters.durations, [4]);
  const { draft } = await admin.write(
    access + "/drafts/" + randomUUID(),
    {
      expected_revision: 0,
      connection_id: b.id,
      connection_revision: b.revision,
      upstream_id: "suite-video",
      purpose: "video",
      price: "4",
      overrides: { durations: [4], frame_images: ["first_frame"] },
    },
    "PUT",
  );
  let current = prior;
  for (const action of ["standby", "activate"]) {
    await admin.write(access + "/publications", {
      uid: randomUUID(),
      items: [
        {
          action,
          catalog_id: prior.catalog_id,
          expected_revision: current.revision,
          draft_id: draft.id,
          draft_revision: draft.revision,
          replace_price: action === "activate",
        },
      ],
    });
    current = (await admin.read(access)).publications.find(
      (p: Publication) => p.catalog_id === prior.catalog_id,
    );
    if (action === "standby")
      assert.equal(current.route_revision_id, prior.route_revision_id);
  }
  assert.notEqual(current.price_revision_id, prior.price_revision_id);
  assert.notEqual(current.route_revision_id, prior.route_revision_id);
  await admin.write(
    access + "/connections/" + a.id,
    { expected_revision: a.revision, enabled: false },
    "PATCH",
  );
  return current;
}

async function delivered(session: StudioClient, id: number) {
  return until(
    "Private result for " + id,
    async () => {
      const job = (await session.read("/api/state")).jobs.find(
        (j: { id: number }) => j.id === id,
      );
      if (job?.status === "failed")
        assert.fail("Model generation failed: " + job.note);
      return job?.status === "done" ? job : undefined;
    },
    90000,
  );
}

async function privateOutput(
  session: StudioClient,
  outsider: StudioClient,
  origin: string,
  asset: string,
  expected: Buffer,
) {
  assert.match(asset, /^[\da-f]{32}$/);
  const path = "/media/" + asset;
  for (const [actor, status] of [
    [outsider, 404],
    [studio(origin), 401],
  ] as const) {
    const denied = await actor.request(path, "GET", undefined, {
      range: "bytes=8-31",
    });
    assert.equal(denied.status, status);
    assert.equal(denied.headers.get("location"), null);
    await denied.body?.cancel();
  }
  const headers = { range: "bytes=8-31" };
  let result = await session.request(path, "GET", undefined, headers);
  if (result.status === 307) {
    const target = result.headers.get("location")!;
    await result.body?.cancel();
    result = await fetch(target, { headers, redirect: "error" });
  }
  assert.equal(result.status, 206);
  assert.equal(
    result.headers.get("content-range"),
    "bytes 8-31/" + expected.length,
  );
  assert.deepEqual(Buffer.from(await result.bytes()), expected.subarray(8, 32));
}

export async function prepareModelAccess(
  source: Platform,
  origin: string,
  user: { name: string; password: string },
  provider: ModelProvider,
) {
  const admin = studio(origin);
  await admin.signIn("/api/login", user);
  const member = studio(origin);
  const invite = await admin.write("/api/invite-codes", {
    name: "普通创作者",
    expires: null,
    grant_credits: false,
    initial_credits: 0,
    team_id: null,
  });
  await member.signIn("/api/register", {
    name: "native-model-member",
    nickname: "模型验收成员",
    password: randomBytes(18).toString("hex"),
    code: invite.code,
  });
  const { workspace_id: workspace, me } = await member.read("/api/state");
  assert.notEqual(me.role, "admin");
  await member.json(await member.request(access), 403);
  await admin.write("/api/admin/credits/adjust", {
    workspace,
    amount: 100,
    note: "模型接入验收",
    uid: randomUUID(),
  });
  const opening = (await member.read("/api/credits")).wallet.exact.balance;
  const browser = await chromium.launch();
  try {
    const adminPage = await sessionPage(browser, origin, admin);
    const models = await publishModels(adminPage, admin, provider);
    const page = await sessionPage(browser, origin, member);
    const turn = await chatTurn(page, member, models.chat);
    await admin.json(await admin.request(turn.path + "/bills"), 404);
    const image = await submitMedia(page, models.image, "image");
    const picture = await delivered(member, image.id);
    assert.equal(picture.results.length, 1);
    await privateOutput(member, admin, origin, picture.result, provider.image);
    const imageWallet = (await member.read("/api/credits")).wallet.exact;
    for (const changed of [
      { max_charge: "0.000000000001" },
      { params: { n: 2 } },
      { route_revision: randomUUID() },
      { price_revision_id: randomUUID() },
    ]) {
      const rejected = await member.request(image.path, "POST", {
        ...image.body,
        ...changed,
        uid: randomUUID(),
      });
      assert.equal(rejected.status, 409, await rejected.text());
    }
    assert.deepEqual(
      (await member.read("/api/credits")).wallet.exact,
      imageWallet,
    );
    assert.deepEqual(
      (await member.read("/api/state")).jobs.map((j: { id: number }) => j.id),
      [image.id],
    );
    const node = "eight-second-shot";
    const saved = await member.write("/api/canvases", {
      title: "换线前的八秒节点",
    });
    const canvas = "/api/canvases/" + saved.id;
    await member.write(
      canvas + "/document",
      {
        title: saved.title,
        expected_revision: saved.revision,
        document: {
          nodes: [
            {
              id: node,
              type: "video",
              title: "八秒历史镜头",
              x: 40,
              y: 80,
              prompt: "湖面与清晨天空",
              params: { model: models.video.catalog_id, seconds: 8 },
            },
          ],
          edges: [],
        },
      },
      "PUT",
    );
    const original = await member.read(canvas);
    const video = await submitMedia(page, models.video, "video");
    await until(
      "Durable upstream task ID before route switch",
      async () => {
        const job = await one(
          source.db,
          "SELECT remote_id,state FROM jobs WHERE public_id=$1",
          [video.id],
        );
        return job?.state === "running" &&
          job.remote_id === "primary-video-receipt"
          ? true
          : undefined;
      },
      20000,
    );
    const b = await switchVideo(admin, models.video, provider);
    assert.deepEqual(await member.write(video.path, video.body), {
      id: video.id,
    });
    const next = await member.write("/api/estimate", {
      model: b.catalog_id,
      params: { seconds: 4 },
      refs: [picture.result],
      kind: "video",
    });
    assert.equal(next.max_charge, "16");
    assert.equal(next.route_revision, b.route_revision_id);
    assert.equal(next.price_revision_id, b.price_revision_id);
    await page.goto("/canvas/" + saved.id + "?workspace=" + workspace);
    await page.locator('.react-flow__node[data-id="' + node + '"]').click();
    const panel = page.locator(".node-composer:visible").first();
    await expect(panel.getByRole("button", { name: "选择模型" })).toContainText(
      models.video.label,
    );
    await expect(panel).toContainText(/4\s*秒/);
    const view = await member.read(canvas);
    assert.equal(view.document.nodes[0].params.seconds, 8);
    assert.equal(view.document.nodes[0].params.model, b.catalog_id);
    assert.equal(view.revision, original.revision);
    const before = await member.read("/api/credits");
    const beforeJobs = (await member.read("/api/state")).jobs.map(
      (j: { id: number }) => j.id,
    );
    const beforeRuns = await member.read(canvas + "/runs");
    const pre = await member.write(canvas + "/batch-precheck", {
      expected_revision: view.revision,
      node_ids: [node],
      stages: ["video"],
    });
    assert.equal(pre.summary.blocked, 1);
    assert.deepEqual(pre.executable_keys, []);
    assert.ok(JSON.stringify(pre).includes(node));
    assert.match(JSON.stringify(pre), /4\s*秒/);
    const refused = await member.request(
      canvas + "/nodes/" + node + "/runs",
      "POST",
      {
        uid: randomUUID(),
        expected_revision: view.revision,
        price_revision: next.price_revision,
      },
    );
    assert.ok([400, 409].includes(refused.status));
    assert.match(await refused.text(), /4\s*秒/);
    assert.deepEqual(await member.read(canvas + "/runs"), beforeRuns);
    assert.deepEqual(
      (await member.read("/api/state")).jobs.map((j: { id: number }) => j.id),
      beforeJobs,
    );
    assert.deepEqual(await member.read("/api/credits"), before);
    // A new order must use B's JSON protocol, credentials, 4-second cap and
    // first frame. Keep this order separate from the rejected historical node.
    const bBody = {
      model: b.catalog_id,
      params: { seconds: 4 },
      refs: [picture.result],
      prompt: "四秒首帧镜头",
      uid: randomUUID(),
      price_revision: next.price_revision,
      price_revision_id: next.price_revision_id,
      route_revision: next.route_revision,
      max_charge: next.max_charge,
    };
    const bOrder = {
      path: video.path,
      body: bBody,
      id: (await member.write(video.path, bBody)).id,
    };
    return async (p: Platform, targetOrigin: string) => {
      const client = studio(targetOrigin, member.cookie);
      const outsider = studio(targetOrigin, admin.cookie);
      const [result, secondaryResult] = await Promise.all([
        delivered(client, video.id),
        delivered(client, bOrder.id),
      ]);
      await privateOutput(
        client,
        outsider,
        targetOrigin,
        secondaryResult.result,
        provider.video,
      );
      await privateOutput(
        client,
        outsider,
        targetOrigin,
        result.result,
        provider.video,
      );
      await privateOutput(
        client,
        outsider,
        targetOrigin,
        picture.result,
        provider.image,
      );
      await client.write(turn.path + "/messages", turn.body);
      assert.deepEqual(
        (await client.read(turn.path + "/bills")).bills,
        turn.bills,
      );
      await outsider.json(await outsider.request(turn.path + "/bills"), 404);
      for (const job of [image, video, bOrder])
        assert.deepEqual(await client.write(job.path, job.body), {
          id: job.id,
        });
      const { wallet, history } = await client.read("/api/credits");
      assert.equal(wallet.exact.reserved, "0");
      assert.equal(
        creditUnits(opening) - creditUnits(wallet.exact.balance),
        creditUnits("40.29"),
      );
      for (const [job, cap, charge] of [
        [image, "0.25", "0.25"],
        [video, "24", "23.4"],
        [bOrder, "16", "16"],
      ] as const) {
        const entries = history.filter(
          (r: { job: number }) => r.job === job.id,
        );
        assert.deepEqual(
          entries.map((r: { action: string; exact: { amount: string } }) => [
            r.action,
            r.exact.amount,
          ]),
          [
            ["spend", charge],
            ["reserve", cap],
          ],
        );
        if (job === video || job === bOrder)
          assert.deepEqual(entries[0].media_bill, {
            milliseconds: 7800,
            unit: job === video ? "3" : "4",
            reserved: cap,
            charged: charge,
            waived: job === video ? "0" : "15.2",
          });
      }
      assert.deepEqual(provider.errors, []);
      assert.equal(
        provider.wire.filter((s) => s === "primary POST videos").length,
        1,
      );
      assert.equal(
        provider.wire.filter(
          (s) => s === "primary GET videos/primary-video-receipt/content",
        ).length,
        1,
      );
      assert.equal(
        provider.wire.filter((s) => s === "primary POST images/generations")
          .length,
        1,
      );
      assert.equal(
        provider.wire.filter((s) => s === "secondary POST videos").length,
        1,
      );
      assert.equal(
        provider.wire.filter(
          (s) => s === "secondary GET videos/secondary-video-receipt/content",
        ).length,
        1,
      );
      assert.equal(
        (await client.read(canvas)).document.nodes[0].params.seconds,
        8,
      );
      console.log(
        "Verified native Studio publication and ordinary member delivery, 0.64 + 0.25 + 23.4 credits, private ranged output, and exactly one settlement for the frozen 8-second order after switching to a 4-second route.",
      );
      return (
        await p.db.query<{ object_key: string }>(
          "SELECT object_key FROM assets WHERE public_id=ANY($1::text[])",
          [[picture.result, result.result, secondaryResult.result]],
        )
      ).rows.map((r) => r.object_key);
    };
  } finally {
    await browser.close();
  }
}
