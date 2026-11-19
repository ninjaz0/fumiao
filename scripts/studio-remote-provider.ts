import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";
import { Queue } from "bullmq";
import type { StudioState } from "../apps/web/studio/state.js";
import { one } from "../packages/platform/src/db.js";
import type { Platform } from "../packages/platform/src/platform.js";
import { redisConnection } from "../packages/platform/src/redis.js";
import type { Manifest, ModelSpec } from "../packages/plugin-sdk/src/index.js";
import {
  assertStudio,
  request,
  settings,
  setTab,
} from "./studio-settings-browser.js";
import { composerMedia } from "./verify-studio-composer.js";

function mediaModel(kind: "video" | "audio"): ModelSpec {
  const video = kind === "video";
  const tiers = video
    ? [
        [480, 5],
        [480, 10],
        [480, 15],
        [768, 5],
        [768, 10],
        [768, 15],
      ]
    : [[]];
  const label = video ? "本地示例视频" : "本地示例语音";
  const properties = video
    ? {
        ratio: { type: "string" },
        quality: { enum: [480, 768] },
        seconds: { enum: [5, 10, 15] },
        seed: { type: ["integer", "null"] },
      }
    : { instruction: { type: "string" }, seed: { type: ["integer", "null"] } };
  return {
    id: "local-demo-" + kind,
    kind,
    label,
    inputSchema: {
      type: "object",
      properties,
      additionalProperties: false,
      required: Object.keys(properties),
    },
    studio: {
      order: 1000,
      priceOrder: 1000,
      descriptor: { kind, label },
      prices: tiers.map(([quality, seconds]) => {
        const tier = video ? quality + "|" + seconds : "standard";
        return {
          tier,
          label: tier,
          amount: 3,
          match: video
            ? {
                type: "object",
                required: ["quality", "seconds"],
                properties: {
                  quality: { const: quality },
                  seconds: { const: seconds },
                },
              }
            : { type: "object" },
        };
      }),
    },
  };
}

export async function verifyRemoteProvider(
  p: Platform,
  web: string,
  user: { name: string; password: string },
  directory: string,
  redisUrl: string,
) {
  const manifest: Manifest = JSON.parse(
    await readFile("plugins/example-studio/manifest.json", "utf8"),
  );
  const example = manifest.models[0];
  const files = await composerMedia(directory);
  const artifacts = {
    image: {
      mime: "image/png",
      bytes: await readFile(join(files, "image.png")),
    },
    video: {
      mime: "video/mp4",
      bytes: await readFile(join(files, "video.mp4")),
    },
    audio: {
      mime: "audio/wav",
      bytes: await readFile(join(files, "audio.wav")),
    },
  };
  type Kind = keyof typeof artifacts;
  const calls: { path: string; key: string; body: any }[] = [];
  const errors: unknown[] = [];
  const provider = createServer(async (req, res) => {
    try {
      if (req.url === "/first/health") {
        assert.equal(req.headers.authorization, "Bearer original-key");
        res.writeHead(204).end();
        return;
      }
      assert.equal(req.method, "POST");
      assert.ok(req.url === "/first/submit" || req.url === "/second/submit");
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      assert.equal(req.headers["idempotency-key"], body.jobId);
      assert.equal(body.idempotencyKey, body.jobId);
      const key = req.url.startsWith("/first") ? "original-key" : "new-key";
      assert.deepEqual(body.config, { apiKey: key });
      assert.equal(req.headers.authorization, "Bearer " + key);
      calls.push({ path: req.url, key, body });
      const { mime, bytes } = artifacts[body.kind as Kind];
      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          state: "completed",
          artifacts: [
            { url: `data:${mime};base64,${bytes.toString("base64")}` },
          ],
        }),
      );
    } catch (error) {
      errors.push(error);
      res.writeHead(500).end();
    }
  }).listen(0, "127.0.0.1");
  const queue = new Queue("fumiao-jobs", {
    connection: redisConnection(redisUrl),
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await once(provider, "listening");
    const endpoint =
      "http://127.0.0.1:" + (provider.address() as AddressInfo).port;
    browser = await chromium.launch();
    const context = await browser.newContext({ baseURL: web });
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === web
        ? route.continue()
        : route.abort(),
    );
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error));
    await page.goto("/studio");
    await page.locator('[name="user"]').fill(user.name);
    await page.locator('[name="pw"]').fill(user.password);
    const login = await request(page, "/api/login", "POST", () =>
      page.locator('.auth-form [type="submit"]').click(),
    );
    assert.equal(login.status(), 200);
    await expect(page.locator(".shell")).toBeVisible();
    await assertStudio(page, true);
    assert.equal(page.url(), web + "/studio");

    const call = async (
      path: string,
      {
        data,
        method = data === undefined ? "GET" : "POST",
        status = 200,
        workspace,
        origin = web,
        client = context.request,
      }: {
        data?: unknown;
        method?: string;
        status?: number;
        workspace?: number;
        origin?: string;
        client?: typeof context.request;
      } = {},
    ) => {
      const res = await client.fetch(path, {
        method,
        data,
        headers: {
          Origin: origin,
          ...(workspace ? { "X-Workspace-Id": String(workspace) } : {}),
        },
      });
      assert.equal(res.status(), status, path + " " + (await res.text()));
      return res.json();
    };
    const state = (workspace?: number): Promise<StudioState> =>
      call("/api/state", { workspace });
    const before = await state();
    const workspace = before.workspace_id;
    assert.deepEqual(before.model_catalog, {});
    assert.deepEqual(before.model_groups, {});
    assert.equal(
      (await context.request.get("/connect/install.sh")).status(),
      404,
    );
    await call("/api/pairs", { data: {}, status: 404 });
    assert.deepEqual(
      (await call("/api/chat/config", { method: "GET" })).models,
      {},
    );
    await expect(page.locator(".generate-button")).toBeDisabled();
    await call("/api/canvases", { data: { title: "零插件画布" } });
    await page.getByRole("button", { name: "前往安装插件" }).click();
    await expect(page.locator(".settings-section h2")).toHaveText("插件");
    await expect(
      page.locator('.settings-navigation [data-value="gpu"]'),
    ).toHaveCount(0);
    const other = await call("/api/workspaces", {
      data: { name: "隔离提供方测试空间" },
    });
    const invite = await call("/api/invite-codes", {
      data: { name: "隔离提供方测试用户" },
    });
    const member = await browser.newContext({ baseURL: web });
    await call("/api/register", {
      client: member.request,
      data: {
        name: "provider-member",
        nickname: "测试成员",
        password: randomUUID(),
        code: invite.code,
      },
    });
    const install = (
      spec: unknown,
      path = "/first",
      status = 201,
      options: { origin?: string; client?: typeof context.request } = {},
    ) =>
      call("/api/admin/plugins", {
        data: { manifest: spec, endpoint: endpoint + path },
        status,
        ...options,
      });
    await install(manifest, "/first", 403, { origin: "http://invalid.local" });
    await install(manifest, "/first", 403, { client: member.request });
    await install(
      { ...manifest, originalSubmission: { version: 1 } },
      "/first",
      400,
    );
    await install({ ...manifest, id: "flow" }, "/first", 400);
    await install(
      {
        ...manifest,
        originalState: { version: 1, fields: ["images"], queueLane: "kind" },
      },
      "/first",
      400,
    );
    const badPrice = structuredClone(manifest);
    badPrice.models[0].studio!.prices[0].match = { type: "object" };
    await install(badPrice, "/first", 400);
    await call("/api/admin/plugins", {
      method: "GET",
      status: 403,
      client: member.request,
    });

    await page.getByText("安装远程插件", { exact: true }).click();
    await page.getByLabel("插件服务地址").fill(endpoint + "/first");
    await page.getByLabel("插件清单 JSON").fill(JSON.stringify(manifest));
    const installed = await request(page, "/api/admin/plugins", "POST", () =>
      page.getByRole("button", { name: "安装插件", exact: true }).click(),
    );
    assert.equal(installed.status(), 201, await installed.text());
    await expect(page.getByLabel("模型提供方")).toHaveValue(
      manifest.id + "@" + manifest.version,
    );
    await install(manifest, "/second", 409);
    const connection = {
      name: "Loopback Studio provider",
      pluginId: manifest.id,
      version: manifest.version,
      config: { apiKey: "original-key" },
    };
    await call("/api/admin/connections", {
      data: { ...connection, config: {} },
      status: 400,
    });
    await page.getByRole("button", { name: "添加连接" }).click();
    await page.getByLabel("连接名称").fill(connection.name);
    await page.getByLabel("API 密钥").fill("original-key");
    const created = await request(page, "/api/admin/connections", "POST", () =>
      page.getByRole("button", { name: "创建连接" }).click(),
    );
    assert.equal(created.status(), 201, await created.text());
    const { id } = await created.json();
    const connectionPath = "/api/admin/connections/" + id;
    const update = (revision: number, apiKey?: string) =>
      call(connectionPath, {
        method: "PUT",
        data: {
          revision,
          enabled: true,
          concurrency: 1,
          ...(apiKey ? { config: { apiKey } } : {}),
        },
      });
    await page.getByLabel("启用连接").check();
    const enabled = await request(page, connectionPath, "PUT", () =>
      page.getByRole("button", { name: "保存连接" }).click(),
    );
    assert.equal(enabled.status(), 200, await enabled.text());
    await page.getByRole("button", { name: "测试连接" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "连接可用" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "管理模型权限" }).click();
    await expect(page.getByRole("heading", { name: "模型管理" })).toBeVisible();
    const policy = page.locator(`[data-model="${example.id}"]`);
    await request(page, "/api/settings/models", "PATCH", () =>
      policy.uncheck(),
    );
    await expect
      .poll(async () => (await state()).model_policy.enabled[example.id])
      .toBe(false);
    await request(page, "/api/settings/models", "PATCH", () => policy.check());
    await setTab(page, "prices");
    const priceKey = example.id + "|1K|low";
    await page.locator(`[data-price="${priceKey}"]`).fill("11");
    await request(page, "/api/settings/prices", "PUT", () =>
      page.getByRole("button", { name: "保存价格" }).click(),
    );
    assert.equal(
      (await state()).pricing.items.find((row) => row.key === priceKey)?.amount,
      11,
    );
    await page.goto("/studio");
    assert.deepEqual(
      await call(connectionPath + "/health", { method: "POST", status: 201 }),
      { ready: true },
    );
    assert.doesNotMatch(
      JSON.stringify(await call("/api/admin/connections")),
      /original-key/,
    );

    const fund = async (space: number) =>
      call("/api/admin/credits/adjust", {
        data: {
          workspace: space,
          amount: 100,
          note: "隔离测试",
          uid: randomUUID(),
        },
      });
    await fund(workspace);
    await fund(other.id);
    const balance = (await state()).credits.available;
    const upload = async (space: number) => {
      const res = await context.request.post("/api/assets", {
        headers: {
          Origin: web,
          "X-Workspace-Id": String(space),
          "X-File-Name": "fixture.png",
        },
        data: artifacts.image.bytes,
      });
      assert.equal(res.status(), 200, await res.text());
      return (await res.json()).id as string;
    };
    const [ref, foreignRef] = await Promise.all([
      upload(workspace),
      upload(other.id),
    ]);
    await page.reload();
    await expect(page.locator(".shell")).toBeVisible();
    const menu = (name: string) =>
      page.locator(`.composer [data-menu="${name}"]`).click();
    const option = (name: string, value: string) =>
      page
        .locator(`#popover [data-act="${name}"][data-value="${value}"]`)
        .click();
    const select = async (kind: Kind) => {
      await menu("creation");
      await option("creation", kind);
      await menu("image-model");
      await option("image-model", "local-demo-" + kind);
    };
    const submit = async (path: string, prompt: string, amount: number) => {
      await page.locator("#prompt").fill(prompt);
      await expect(page.locator(".composer-credit")).toHaveAttribute(
        "aria-label",
        amount + " 积分",
      );
      const submitted = await request(page, path, "POST", () =>
        page.locator(".generate-button").click(),
      );
      assert.equal(submitted.status(), 200, await submitted.text());
      return {
        id: (await submitted.json()).id as number,
        body: submitted.request().postDataJSON(),
      };
    };
    await select("image");
    await menu("format");
    await option("ratio", "1:1");
    await option("resolution", "2K");
    await page.keyboard.press("Escape");
    await menu("duration");
    await option("image-quality", "high");
    await page.locator("#files").setInputFiles(join(files, "image.png"));
    await expect(
      page.locator(".composer-references .reference-layer"),
    ).toHaveCount(1);
    await queue.pause();
    const imagePath = "/api/image-jobs";
    const image = await submit(imagePath, "隔离图片", 14);
    assert.equal(image.body.model, example.id);
    assert.equal(image.body.refs.length, 1);
    assert.deepEqual(
      [image.body.ratio, image.body.resolution, image.body.image_quality],
      ["1:1", "2K", "high"],
    );
    const retry = (data = image.body, status = 200, space = workspace) =>
      call(imagePath, { data, status, workspace: space });
    assert.deepEqual(await Promise.all([retry(), retry()]), [
      { id: image.id },
      { id: image.id },
    ]);
    await retry(image.body, 404, other.id);
    const fresh = { ...image.body, uid: randomUUID() };
    await retry({ ...fresh, refs: [foreignRef] }, 404);
    await retry({ ...fresh, refs: [ref, ref] }, 400);
    await retry({ ...fresh, resolution: "4K" }, 400);
    await retry(
      { ...fresh, price_revision: image.body.price_revision - 1 },
      409,
    );
    await call("/api/settings/models", {
      method: "PATCH",
      data: {
        model: example.id,
        enabled: false,
        group: false,
        workspace: other.id,
        expected_revision: (await state()).team_model_policies![other.id]
          .revision,
      },
    });
    await retry(fresh, 403, other.id);
    assert.ok(!(await state(other.id)).jobs.some((j) => j.id === image.id));
    assert.equal(calls.length, 0);
    assert.equal((await state()).credits.reserved, 14);
    const accepted = await one(p.db, "SELECT * FROM jobs WHERE public_id=$1", [
      image.id,
    ]);
    assert.equal(accepted.state, "queued");
    assert.equal(accepted.plugin_version, manifest.version);
    assert.equal(
      (await one(p.db, "SELECT count(*)::int AS total FROM jobs")).total,
      1,
    );

    // Change both the connection config and the active version before the worker runs.
    await update(2, "intermediate-key");
    const upgraded = {
      ...manifest,
      version: "2.0.0",
      models: [example, mediaModel("video"), mediaModel("audio")],
    };
    await install(upgraded, "/second");
    await settings(page);
    await setTab(page, "plugins");
    await page
      .getByLabel("模型提供方")
      .selectOption(upgraded.id + "@" + upgraded.version);
    await page.getByLabel("API 密钥").fill("new-key");
    const switched = await request(
      page,
      connectionPath + "/upgrade",
      "POST",
      () => page.getByRole("button", { name: "切换连接及目录版本" }).click(),
    );
    assert.equal(switched.status(), 201, await switched.text());
    await page.goto("/studio");
    await update(4);
    assert.deepEqual(await retry(), { id: image.id });
    await queue.resume();

    const result = async (jobId: number, kind: Kind) => {
      const job = () => state().then((s) => s.jobs.find((j) => j.id === jobId));
      await expect
        .poll(async () => (await job())?.status, { timeout: 25_000 })
        .toBe("done");
      const key = (await job())?.result;
      assert.ok(key);
      const res = await context.request.get("/media/" + key);
      assert.equal(res.status(), 200);
      assert.equal(res.headers()["content-type"], artifacts[kind].mime);
      assert.deepEqual(await res.body(), artifacts[kind].bytes);
      assert.equal((await member.request.get("/media/" + key)).status(), 404);
      return key;
    };
    const imageKey = await result(image.id, "image");
    assert.deepEqual(
      calls.map(({ path, key }) => ({ path, key })),
      [{ path: "/first/submit", key: "original-key" }],
    );
    const frozen = calls[0].body;
    assert.equal(frozen.jobId, accepted.id);
    assert.deepEqual(frozen.input.params, {
      ratio: "1:1",
      resolution: "2K",
      image_quality: "high",
    });
    assert.equal(frozen.input.references.length, 1);
    assert.equal(
      frozen.input.references[0].url,
      "data:image/png;base64," + artifacts.image.bytes.toString("base64"),
    );
    await expect(page.locator(`#job-${image.id} .asset-preview img`)).toHaveAttribute(
      "src", "/media/" + imageKey, { timeout: 15_000 },
    );
    await page
      .locator(`#job-${image.id} .asset-preview`)
      .click({ timeout: 15_000 });
    const preview = page.locator(".detail-image");
    await expect(preview).toHaveAttribute("src", "/media/" + imageKey);
    await expect(preview).toHaveJSProperty("naturalWidth", 96);
    await page.locator('[data-nav="home"]').first().click();
    await page.reload();
    await expect(page.locator(".shell")).toBeVisible();

    await select("video");
    await menu("duration");
    await option("seconds", "10");
    const video = await submit("/api/jobs", "隔离视频", 3);
    await result(video.id, "video");
    assert.equal(calls[1].path, "/second/submit");
    assert.equal(calls[1].body.input.params.seconds, 10);

    await select("audio");
    await menu("duration");
    await page.locator("#voice-description").fill("平静清晰");
    await page.locator('#popover [data-act="save-voice"]').click();
    const audio = await submit("/api/audio-jobs", "隔离语音", 3);
    await result(audio.id, "audio");
    assert.equal(calls[2].path, "/second/submit");
    assert.equal(calls[2].body.input.params.instruction, "平静清晰");
    assert.deepEqual(await retry(), { id: image.id });

    const settled = await state();
    await page.reload();
    await settings(page);
    await setTab(page, "credits");
    for (const [jobId, amount] of [
      [image.id, 14],
      [video.id, 3],
      [audio.id, 3],
    ]) {
      assert.deepEqual(
        settled.credit_history
          .filter((entry) => entry.job === jobId)
          .map(({ action, amount }) => [action, amount]),
        [
          ["spend", amount],
          ["reserve", amount],
        ],
      );
      const ledger = page.locator(".credit-ledger-row").filter({
        hasText: new RegExp(`#${jobId}\\b`),
      });
      await expect(ledger.locator(".credit-amount")).toHaveText([
        "−" + amount,
        String(amount),
      ]);
    }
    assert.equal(settled.credits.available, balance - 20);
    assert.equal(settled.credits.reserved, 0);
    assert.equal((await state(other.id)).credits.available, 100);
    assert.equal((await queue.getJobCounts("completed", "failed")).failed, 0);
    assert.equal(calls.length, 3);
    await setTab(page, "plugins");
    await page
      .getByLabel("模型提供方")
      .selectOption({
        label:
          "本地实例接入 · " +
          (await call("/api/admin/plugins", { method: "GET" })).find(
            (p: { id: string }) => p.id === "gpu",
          ).version,
      });
    await page.getByRole("button", { name: "安装此插件" }).click();
    await expect(
      page.locator('.settings-navigation [data-value="gpu"]'),
    ).toHaveText("实例接入");
    await call("/api/admin/plugins/builtin", {
      data: {
        id: "gpu",
        version: (await call("/api/admin/plugins", { method: "GET" })).find(
          (p: { id: string }) => p.id === "gpu",
        ).version,
      },
      client: member.request,
      status: 403,
    });
    const gpu = (await state()).gpu_models || {};
    assert.ok(Object.keys(gpu).length);
    const pair = await call("/api/pairs", {
      data: { models: [Object.keys(gpu)[0]] },
    });
    assert.ok(pair.code || pair.command);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await queue.close();
    provider.closeAllConnections();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
  }
  console.log(
    "Default Chromium Studio selected and generated remote image, video and audio through BullMQ; verified isolation, immutable versions/config and ledger.",
  );
}
