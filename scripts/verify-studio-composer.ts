/** Chromium composer comparison on independent pinned and Next/Nest data. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  expect,
  type Browser,
  type Page,
  type Request,
} from "@playwright/test";
import { Queue, Worker, type ConnectionOptions } from "bullmq";
import sharp from "sharp";
import type { ProviderPlugin } from "../packages/plugin-sdk/src/index.js";
import { Executor } from "../packages/platform/src/executor.js";
import { one } from "../packages/platform/src/db.js";
import { PluginRegistry } from "../packages/platform/src/plugins.js";
import { gpuText } from "../plugins/gpu/src/text.js";
import { imagesText } from "../plugins/images/src/text.js";
import { surfaceTree } from "./verify-homepage.js";
import { assertStudio, settings, setTab, tab } from "./studio-settings-browser.js";
import type { databaseFixture } from "../tests/helpers/database.js";

type Fixture = Awaited<ReturnType<typeof databaseFixture>>;
type Kind = "video" | "image" | "audio";
type Target = {
  name: "pinned" | "compat" | "nest";
  origin: string;
  canvas: string;
  complete: (id: number) => Promise<void>;
  reply: () => Promise<void>;
  demote: () => Promise<void>;
};
const files = {
  video: ["video.mp4", "video/mp4"],
  image: ["image.png", "image/png"],
  audio: ["audio.wav", "audio/wav"],
} as const;
const timeout = 20_000;

export async function composerMedia(directory: string) {
  const path = join(directory, "composer-media");
  await mkdir(path);
  for (const [input, args, filename] of [
    [
      "color=blue:s=96x54:r=24:d=1",
      ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart"],
      files.video[0],
    ],
    ["sine=frequency=440:sample_rate=24000:duration=1", [], files.audio[0]],
  ] as const)
    execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        input,
        ...args,
        join(path, filename),
      ],
      { timeout },
    );
  await sharp({
    create: { width: 96, height: 54, channels: 3, background: "#5289b3" },
  })
    .png()
    .toFile(join(path, files.image[0]));
  return path;
}

export async function composerProviders(f: Fixture, path: string) {
  const version = "1.99.0";
  const builtins = await Promise.all(
    (
      await f.db.query<{ id: string; version: string }>(
        "SELECT id,version FROM plugin_versions WHERE endpoint IS NULL AND id<>'legacy-archive'",
      )
    ).rows.map(({ id, version }) => f.p.registry.resolve(f.db, id, version)),
  );
  const outputs = {
    video: await readFile(join(path, files.video[0])),
    image: await readFile(join(path, files.image[0])),
    audio: await readFile(join(path, files.audio[0])),
  };
  const calls: Array<{
    kind: Kind;
    model: string;
    prompt: string;
    references: number;
  }> = [];
  const mocks = [gpuText, imagesText].map((provider): ProviderPlugin => {
    const {
      artifactValidation,
      inputPreparation,
      requestLifecycle,
      originalState,
      ...manifest
    } = provider.manifest;
    return {
      ...provider,
      requestCapacity: undefined,
      manifest: {
        ...manifest,
        version,
        mode: "request",
        originalState: { ...originalState!, recovery: undefined },
        queue: {
          ...manifest.queue!,
          timingVersions: [...manifest.queue!.timingVersions, version],
        },
      },
      async submit({ kind, model, input }) {
        assert.ok(kind === "video" || kind === "image" || kind === "audio");
        calls.push({
          kind,
          model,
          prompt: input.prompt,
          references: input.references.length,
        });
        return {
          state: "completed",
          artifacts: [
            {
              url: `data:${files[kind][1]};base64,${outputs[kind].toString("base64")}`,
            },
          ],
        };
      },
    };
  });
  // Submission, quoting and state projections still use the original plugin
  // adapters. The fixtures replace only dispatch, provider I/O and output validation.
  f.p.registry = new PluginRegistry([...builtins, ...mocks]);
  for (const mock of mocks) await f.p.registry.install(f.db, mock.manifest);
  return { mocks, calls };
}

export async function composerQueue(f: Fixture, connection: ConnectionOptions) {
  const name = "test-studio-composer-" + randomUUID();
  const executor = new Executor(f.p);
  const queue = new Queue(name, { connection });
  const worker = new Worker(name, (job) => executor.execute(job.data.id), {
    connection,
  });
  const errors: string[] = [];
  queue.on("error", (error) => errors.push(error.message));
  worker.on("error", (error) => errors.push(error.message));
  worker.on("failed", (_job, error) => errors.push(error.message));
  return {
    async complete(publicId: number) {
      const row = await one(
        f.db,
        "SELECT id,state,error FROM jobs WHERE public_id=$1",
        [publicId],
      );
      assert.equal(row?.state, "queued");
      assert.ok(
        (await executor.queueReady()).some(({ id }) => id === row!.id),
        "job was admitted to the generation queue",
      );
      await queue.add("execute", { id: row!.id }, { jobId: row!.id });
      await expect
        .poll(
          async () => {
            const job = await one(
              f.db,
              "SELECT state,error FROM jobs WHERE id=$1",
              [row!.id],
            );
            assert.ok(!job?.error, job?.error);
            return job?.state;
          },
          { timeout },
        )
        .toBe("completed");
      assert.deepEqual(errors, []);
    },
    async close() {
      await worker.close();
      await queue.obliterate();
      await queue.close();
    },
  };
}

function digest(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function verifyStudioComposer(
  browser: Browser,
  targets: [Target, Target, Target],
  password: string,
  path: string,
  out: string,
) {
  const comparisons: string[] = [];
  const outputs = {
    video: digest(await readFile(join(path, files.video[0]))),
    image: digest(await readFile(join(path, files.image[0]))),
    audio: digest(await readFile(join(path, files.audio[0]))),
  };
  const [pinned, ...candidates] = targets;
  const expected = await exercise(
    browser,
    pinned,
    password,
    outputs,
    out,
    comparisons,
  );
  for (const candidate of candidates)
    assert.deepEqual(
      await exercise(browser, candidate, password, outputs, out, comparisons),
      expected,
      candidate.name + " Studio browser contracts and credits",
    );
  return { comparisons, checks: expected };
}

async function exercise(
  browser: Browser,
  target: Target,
  password: string,
  outputs: Record<Kind, string>,
  out: string,
  comparisons: string[],
) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
  });
  try {
    await context.addInitScript(() =>
      localStorage.setItem("fumiao-appearance", "light"),
    );
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === target.origin
        ? route.continue()
        : route.abort(),
    );
    const login = await context.request.post(target.origin + "/api/login", {
      headers: { Origin: target.origin },
      data: { name: "admin", password },
    });
    assert.equal(login.status(), 200, await login.text());
    const session = (await context.cookies()).find(
      ({ name }) => name === "fm_session",
    );
    assert.ok(session);
    async function get(path: string, workspace?: number) {
      const response = await context.request.get(target.origin + path, {
        headers: {
          Connection: "close",
          ...(workspace ? { "X-Workspace-Id": String(workspace) } : {}),
        },
      });
      assert.equal(response.status(), 200, await response.text());
      return response.json();
    }

    const initial = await get("/api/state");
    const workspace: number = initial.workspace_id;
    const team: number = initial.workspaces.find(
      ({ kind }: { kind: string }) => kind === "team",
    ).id;
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const studio = target.origin + "/studio";
    const react = target.name !== "pinned";
    const navigation = await page.goto(
      studio + "?workspace=" + workspace,
    );
    assert.ok(navigation && navigation.ok());
    if (react) {
      assert.equal(navigation.headers()["x-fumiao-web"], "next");
      assert.doesNotMatch(
        await navigation.text(),
        /src="\/static\/(studio|chat)\.js/,
      );
    } else assert.match(await navigation.text(), /src="\/static\/studio\.js/);

    const home = page.locator('nav [data-nav="home"]');
    const library = page.locator('nav [data-nav="library"]');
    const chat = page.locator('nav [data-nav="chat"]');
    const chatDraft = page.getByRole("textbox", { name: "发送消息" });
    const prompt = page.locator("#prompt");
    const generate = page.locator(".generate-button");
    const creation = page.locator('[data-menu="creation"]');
    const click = (selector: string) => page.locator(selector).click();
    const menu = (name: string) => click(`.composer [data-menu="${name}"]`);
    const option = (action: string, value?: string) =>
      click(
        `#popover [data-act="${action}"]${value === undefined ? "" : `[data-value="${value}"]`}`,
      );
    const switchForm = async (kind: Kind) => {
      await menu("creation");
      await option("creation", kind);
      await expect(page.locator("#popover")).toBeHidden();
    };
    const aliases = new Map<string, string>();
    const stable = (value: string) =>
      [...aliases].reduce(
        (text, [id, alias]) => text.replaceAll(id, alias),
        value,
      );
    async function picture(name: string, selector?: string) {
      await page.mouse.move(1, 1);
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        );
        await Promise.allSettled(
          document
            .getAnimations()
            .filter((animation) =>
              Number.isFinite(animation.effect?.getComputedTiming().endTime),
            )
            .map((animation) => animation.finished),
        );
      });
      const file = join(out, name + "-" + target.name);
      const dom = JSON.stringify(
        await surfaceTree(page, selector),
        (key, value) => {
          // A moved contenteditable can retain an empty style attribute.
          if (key === "style" && value === "") return undefined;
          return typeof value === "string" ? stable(value) : value;
        },
      );
      await writeFile(file + ".json", dom);
      const surface = selector ? page.locator(selector) : page;
      const png = await surface.screenshot({
        path: file + ".png",
        animations: "disabled",
      });
      if (target.name === "pinned") return;
      const reference = join(out, name + "-pinned");
      assert.deepEqual(
        JSON.parse(dom),
        JSON.parse(await readFile(reference + ".json", "utf8")),
        name + " DOM",
      );
      const [expected, actual] = await Promise.all(
        [reference + ".png", png].map((image) =>
          sharp(image)
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true }),
        ),
      );
      assert.deepEqual(actual.info, expected.info, name + " dimensions");
      assert.ok(actual.data.equals(expected.data), name + " pixels");
      comparisons.push(target.name + "-" + name);
    }

    const requests: unknown[] = [];
    const ledger: unknown[] = [];
    const jobs: unknown[] = [];
    let balance = 100;
    const start = await page.evaluate(() => performance.timeOrigin);
    const sameDocument = async () =>
      assert.equal(await page.evaluate(() => performance.timeOrigin), start);
    async function capture(request: Request, path: string) {
      assert.equal(request.method(), "POST");
      assert.equal(new URL(request.url()).pathname, path);
      assert.equal(request.headers().origin, target.origin);
      assert.equal(request.headers()["x-workspace-id"], String(workspace));
      return request.postDataJSON();
    }
    async function credit(id: number, actions: string[]) {
      const { wallet, history } = await get("/api/credits", workspace);
      const rows = history.filter((row: { job: number }) => row.job === id);
      assert.deepEqual(
        rows.map(({ action }: { action: string }) => action).reverse(),
        actions,
      );
      if (actions.at(-1) === "spend") balance--;
      assert.equal(wallet.balance, balance);
      assert.equal(wallet.available, wallet.balance - wallet.reserved);
      assert.equal(wallet.reserved, actions.length === 1 ? 1 : 0);
      assert.ok(rows.every(({ amount }: { amount: number }) => amount === 1));
      ledger.push({
        job: id,
        wallet,
        rows: rows.map(
          ({ action, amount, balance, reserved, actor_name }: any) => ({
            action,
            amount,
            balance,
            reserved,
            actor_name,
          }),
        ),
      });
    }
    async function submit(
      kind: Kind,
      expected: Record<string, unknown>,
      loseResponse = false,
    ) {
      const path = kind === "video" ? "/api/jobs" : `/api/${kind}-jobs`;
      const tab = { video: "videos", image: "images", audio: "audio" }[kind];
      const matches = (request: Request) =>
        request.method() === "POST" && new URL(request.url()).pathname === path;
      await expect(generate).toBeEnabled();
      let lost: { id: number; body: unknown } | undefined;
      if (loseResponse) {
        await page.route(
          "**" + path,
          async (route) => {
            if (!matches(route.request())) return route.fallback();
            const response = await route.fetch();
            assert.equal(response.status(), 200, await response.text());
            lost = {
              id: (await response.json()).id,
              body: await capture(route.request(), path),
            };
            await route.abort("connectionreset");
          },
          { times: 1 },
        );
        const failure = page.waitForEvent("requestfailed", {
          predicate: matches,
        });
        await generate.click();
        await failure;
        await expect(page.locator("#toast.visible")).not.toBeEmpty();
        assert.ok(lost);
        await credit(lost.id, ["reserve"]);
      }
      const [response] = await Promise.all([
        page.waitForResponse((r) => matches(r.request()), { timeout }),
        generate.click(),
      ]);
      assert.equal(response.status(), 200, await response.text());
      if (target.name !== "pinned")
        assert.equal(response.headers()["x-fumiao-web"], "next");
      const body = await capture(response.request(), path);
      const { id } = await response.json();
      if (lost) {
        assert.equal(id, lost.id);
        assert.deepEqual(body, lost.body);
      }
      const { uid, ...fields } = body;
      assert.match(uid, /^[a-f0-9-]{36}$/);
      assert.equal(fields.price_revision, initial.pricing.revision);
      for (const [key, value] of Object.entries(expected))
        assert.deepEqual(fields[key], value, path + " " + key);
      requests.push({
        path,
        body: JSON.parse(stable(JSON.stringify(fields))),
        replayed: Boolean(lost),
      });
      await expect(page.locator(`[data-tab="${tab}"]`)).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(page.locator(`#job-${id}.new-result`)).toBeVisible();
      const accepted = await get("/api/state", workspace);
      const matching = accepted.jobs.filter(
        (job: { prompt: string }) => job.prompt === fields.prompt,
      );
      assert.equal(
        matching.length,
        1,
        "one accepted job for the browser draft",
      );
      assert.equal(matching[0].id, id);
      assert.equal(matching[0].status, "queued");
      await credit(id, ["reserve"]);

      await target.complete(id);
      await expect
        .poll(
          async () =>
            (await get("/api/state", workspace)).jobs.find(
              (job: { id: number }) => job.id === id,
            )?.status,
          { timeout },
        )
        .toBe("done");
      const { jobs: completed } = await get("/api/state", workspace);
      const {
        result,
        kind: resultKind,
        model,
        prompt: submittedPrompt,
        parent,
        refs,
        seed,
        sampling_steps,
        image_quality,
        audio_settings,
        h3_inputs,
      } = completed.find((job: { id: number }) => job.id === id);
      assert.match(result, /^[a-f0-9]{32}$/);
      assert.equal(resultKind, kind);
      const media = await context.request.get(
        target.origin + "/media/" + result,
      );
      assert.equal(media.status(), 200);
      assert.equal(media.headers()["content-type"], files[kind][1]);
      assert.equal(digest(await media.body()), outputs[kind]);
      jobs.push({
        id,
        kind,
        model,
        prompt: submittedPrompt,
        parent,
        refs: refs.map(stable),
        seed: fields.seed == null ? null : seed,
        sampling_steps,
        image_quality,
        audio_settings,
        h3_inputs: JSON.parse(stable(JSON.stringify(h3_inputs))),
      });
      aliases.set(result, `$result-${id}`);
      await credit(id, ["reserve", "spend"]);
      return { id, result };
    }

    async function openResult(id: number, kind: Kind, result: string) {
      const preview = page.locator(`#job-${id} .asset-preview`);
      if (kind !== "audio")
        await expect(
          preview.locator(kind === "image" ? "img" : "video"),
        ).toBeAttached({ timeout });
      await preview.click();
      const player = page.locator(".detail-" + kind);
      await expect(player).toHaveAttribute("src", "/media/" + result, {
        timeout,
      });
      await expect
        .poll(
          () =>
            player.evaluate((media: HTMLImageElement | HTMLMediaElement) =>
              media instanceof HTMLImageElement
                ? media.naturalWidth
                : media.readyState,
            ),
          { timeout },
        )
        .toBeGreaterThan(0);
    }

    await expect(page.locator(".composer-estimate")).not.toBeEmpty();
    await menu("creation");
    await picture("creation");
    await option("creation", "video");
    await menu("image-model");
    await picture("video-models");
    assert.equal(initial.flow.configured, true);
    assert.equal(initial.model_access["flow:veo-3.1-fast"], false);
    await expect(
      page.locator('#popover [data-value^="flow:veo-3.1-fast"]'),
    ).toHaveCount(0);
    await click('#popover [title="Veo 3.1 Quality"]');
    await prompt.fill("测试续写来源");
    await menu("format");
    await option("flow-mode", "extend");
    await expect(page.locator(".composer-status")).toHaveText("请选择来源视频");
    await expect(generate).toBeDisabled();
    await picture("flow-extend");
    await page.keyboard.press("Escape");
    await prompt.clear();
    await menu("image-model");
    await option("image-model", "muse-video");
    await expect(page.locator('[data-menu="image-model"]')).toHaveText("Muse");
    await menu("duration");
    await picture("muse-duration");
    await page.keyboard.press("Escape");
    await expect(page.locator("#popover")).toBeHidden();
    await menu("image-model");
    await option("image-model", "MiniMax H3");
    await menu("h3-mode");
    await option("h3-mode", "frames");
    await picture("h3-frame-form", ".composer");
    await menu("h3-mode");
    await option("h3-mode", "reference");
    await menu("advanced");
    await picture("video-advanced");
    await option("sampling-steps", "32");
    await page.locator("#seed").fill("1987");
    await option("save-seed");
    await prompt.fill("合成视频浏览器重试");
    const video = await submit(
      "video",
      { model: "MiniMax H3", seed: 1987, sampling_steps: 32 },
      true,
    );
    await openResult(video.id, "video", video.result);
    await editResult(page);
    await expect(prompt).toHaveText("合成视频浏览器重试");
    await picture("video-edit", ".composer");
    await menu("advanced");
    await expect(
      page.locator('[data-act="sampling-steps"][data-value="32"]'),
    ).toHaveAttribute("aria-checked", "true");
    await page.locator("#reuse-seed").check();
    await expect(page.locator("#seed")).toHaveValue("1987");
    await page.keyboard.press("Escape");
    await click('[data-act="locate"]');
    await expect(page.locator(`#job-${video.id}.new-result`)).toBeVisible();

    await home.click();
    await switchForm("image");
    await menu("image-model");
    await picture("image-models", "#popover");
    await page.keyboard.press("Escape");
    await menu("format");
    await picture("image-format", "#popover");
    await option("resolution", "2K");
    await page.keyboard.press("Escape");
    await menu("duration");
    await option("image-quality", "high");
    await prompt.fill("合成图片浏览器提交");
    const image = await submit("image", {
      model: "gpt-image-2.6-sunburst",
      resolution: "2K",
      image_quality: "high",
    });
    await openResult(image.id, "image", image.result);
    await editResult(page);
    await expect(prompt).toHaveText("合成图片浏览器提交");
    await expect(page.locator("[data-menu=duration]")).toHaveText("高清");
    // The workbench refreshes an unchanged estimate on its normal 15–18 s cycle.
    await expect(page.locator(".composer-estimate")).toHaveText("约 5 秒", {
      timeout: 25_000,
    });
    await picture("image-edit", ".composer");
    await click('[data-act="locate"]');
    await expect(page.locator('[data-tab="images"]')).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator(`#job-${image.id}.new-result`)).toBeVisible();
    await openResult(image.id, "image", image.result);
    await click('[data-act="image-to-video"]');
    await expect(creation).toHaveText("视频生成");
    await expect(prompt).toBeEmpty();
    await expect(page.locator(".reference-deck-count")).toHaveText("1");
    await picture("image-to-video", ".composer");
    await prompt.fill("资产图片转为视频");
    const derived = await submit("video", {
      refs: [image.result],
      seconds: 5,
      quality: 480,
    });
    await openResult(derived.id, "video", derived.result);

    await home.click();
    await switchForm("audio");
    await menu("duration");
    await picture("audio-voice", "#popover");
    await page.locator("#voice-description").fill(" 自然地朗读 ");
    await option("save-voice");
    await prompt.fill("字".repeat(301));
    await expect(generate).toBeDisabled();
    await expect(page.locator(".composer-status")).toHaveText("301 / 300 字");
    await prompt.fill("合成语音浏览器提交");
    const audio = await submit("audio", {
      model: "breeze-tts-2",
      instruction: "自然地朗读",
    });
    await openResult(audio.id, "audio", audio.result);
    await editResult(page);
    await expect(prompt).toHaveText("合成语音浏览器提交");
    await picture("audio-edit", ".composer");
    await menu("duration");
    await expect(page.locator("#voice-description")).toHaveValue("自然地朗读");
    await page.keyboard.press("Escape");
    await home.click();
    await prompt.fill("个人创作草稿");
    await library.click();
    await expect(page.locator("#asset-composer #prompt")).toHaveText(
      "个人创作草稿",
    );
    await chat.click();
    await expect(chatDraft).toBeEnabled();
    await chatDraft.fill("将回复添加到现有画布");
    const chatSent = page.waitForResponse(
      (response) =>
        /\/api\/chats\/[^/]+\/messages$/.test(
          new URL(response.url()).pathname,
        ) && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "发送", exact: true }).click();
    const chatResponse = await chatSent;
    assert.equal(chatResponse.status(), 200, await chatResponse.text());
    const chatBody = await capture(
      chatResponse.request(),
      new URL(chatResponse.url()).pathname,
    );
    assert.equal(chatBody.text, "将回复添加到现有画布");
    const { uid: chatUid, ...chatFields } = chatBody;
    assert.match(chatUid, /^[a-f0-9-]{36}$/);
    requests.push({
      path: "/api/chats/$conversation/messages",
      body: chatFields,
    });
    const chatPrice = (
      await get("/api/chat/config", workspace)
    ).pricing.items.find(
      ({ key }: { key: string }) => key === chatBody.model + "|reply",
    ).amount;
    assert.ok(chatPrice > 0);
    const wallet = async () => (await get("/api/credits", workspace)).wallet;
    assert.deepEqual(await wallet(), {
      workspace,
      balance,
      reserved: chatPrice,
      available: balance - chatPrice,
    });
    await target.reply();
    balance -= chatPrice;
    await expect.poll(wallet, { timeout }).toEqual({
      workspace,
      balance,
      reserved: 0,
      available: balance,
    });
    await chatDraft.fill("个人对话草稿");
    const assistant = page.locator(".fm-chat-message.assistant").last();
    await expect(assistant.locator(".fm-chat-prose")).toHaveText(
      "工作台集成模拟回复",
    );
    await assistant.getByRole("button", { name: "放入画布" }).click();
    const picker = page.getByRole("region", { name: "放入画布" });
    await picker.getByLabel("选择画布").selectOption(target.canvas);
    await picker.getByRole("button", { name: "添加文本节点" }).click();
    const canvas = await get("/api/canvases/" + target.canvas, workspace);
    await expect
      .poll(async () => {
        const result = await get("/api/canvases/" + target.canvas, workspace);
        return result.document.nodes.map(({ text }: { text: string }) => text);
      })
      .toEqual(["原文😀", "工作台集成模拟回复"]);
    await sameDocument();

    const canvasURL = target.origin + "/canvas";
    const query = "?workspace=" + workspace;
    await assistant.getByRole("link", { name: "打开画布" }).click();
    await expect(page).toHaveURL(canvasURL + "/" + target.canvas + query);
    await expect(page.getByRole("textbox", { name: "画布名称" })).toHaveValue(
      "对话画布",
    );
    assert.equal(canvas.title, "对话画布");
    await page.getByRole("link", { name: "返回工作台" }).click();
    await expect(page).toHaveURL(studio + query);
    await expect(prompt).toHaveText("个人创作草稿");
    if (react) await assertStudio(page, true);

    const returned = await page.evaluate(() => performance.timeOrigin);
    await settings(page);
    await expect(tab(page, "profile")).toHaveAttribute("aria-current", "page");
    await picture("settings-profile", ".settings-content");
    await setTab(page, "credits");
    await expect(page.locator(".credit-summary strong")).toHaveText([
      String(balance),
      "0",
    ]);
    await setTab(page, "team");
    await expect(tab(page, "team")).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".settings-content h2")).toHaveText("成员管理");
    await setTab(page, "gpu");
    await expect(tab(page, "gpu")).toHaveText("GPU 实例");
    await expect(tab(page, "gpu")).toHaveAttribute("aria-current", "page");
    await picture("settings-gpu", ".settings-content");
    await home.click();
    await expect(creation).toHaveText("语音生成");
    await expect(prompt).toHaveText("个人创作草稿");
    await menu("duration");
    await expect(page.locator("#voice-description")).toHaveValue("自然地朗读");
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => performance.timeOrigin), returned);

    async function selectWorkspace(from: number, to: number) {
      await click('[data-menu="workspaces"]');
      const path = `/api/workspaces/${to}/select`;
      const [response] = await Promise.all([
        page.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === path &&
            r.request().method() === "POST",
        ),
        click(`#popover [data-id="${to}"]`),
      ]);
      assert.equal(response.status(), 200);
      const request = response.request();
      assert.equal(request.headers()["x-workspace-id"], String(from));
      assert.equal(request.headers().origin, target.origin);
      requests.push({ path, body: request.postDataJSON(), workspace: from });
      await page.waitForURL(
        (url) => url.searchParams.get("workspace") === String(to),
      );
      await expect(home).toHaveAttribute("aria-current", "page");
    }
    await selectWorkspace(workspace, team);
    await expect(creation).toHaveText("视频生成");
    await expect(prompt).toBeEmpty();
    assert.deepEqual((await get("/api/state", team)).jobs, []);
    assert.deepEqual((await get("/api/credits", team)).wallet, {
      workspace: team,
      balance: 100,
      reserved: 0,
      available: 100,
    });
    await chat.click();
    await expect(chatDraft).toBeEmpty();
    await chatDraft.fill("团队对话草稿");
    await selectWorkspace(team, workspace);
    await expect(prompt).toHaveText("个人创作草稿");
    await chat.click();
    await expect(chatDraft).toHaveValue("个人对话草稿");
    await selectWorkspace(workspace, team);
    await chat.click();
    await expect(chatDraft).toHaveValue("团队对话草稿");
    await selectWorkspace(team, workspace);
    await home.click();
    await expect(prompt).toHaveText("个人创作草稿");
    if (react)
      await assertStudio(page, true);
    await settings(page);
    await setTab(page, "gpu");
    await target.demote();
    const forbidden = await context.request.get(
      target.origin + "/api/admin/credits",
      {
        headers: { "X-Workspace-Id": String(workspace) },
      },
    );
    assert.equal(forbidden.status(), 403);
    if (!react) {
      // The pinned settings view refreshes its tabs when re-entered.
      await page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/state" && response.ok(),
      );
      await home.click();
      await settings(page);
    }
    await expect(tab(page, "gpu")).toHaveText("GPU 接入", { timeout });
    await expect(tab(page, "team")).toHaveCount(0);
    await home.click();
    await expect(prompt).toHaveText("个人创作草稿");
    await chat.click();
    await expect(chatDraft).toHaveValue("个人对话草稿");
    await home.click();
    assert.deepEqual(
      (await context.cookies()).find(({ name }) => name === "fm_session"),
      session,
    );
    const finalWallet = await wallet();
    assert.deepEqual(finalWallet, {
      workspace,
      balance,
      reserved: 0,
      available: balance,
    });
    assert.deepEqual(errors, []);
    const { model_access, images, flow, muse } = initial;
    return {
      requests,
      ledger,
      jobs,
      chat: {
        price: chatPrice,
        finalWallet,
        canvasText: "工作台集成模拟回复",
      },
      availability: {
        model_access,
        imageConfigured: images.configured,
        imageEnabled: images.enabled,
        flowConfigured: flow.configured,
        museConfigured: muse.configured,
      },
    };
  } finally {
    await context.close();
  }
}

async function editResult(page: Page) {
  await page.locator('.edit-actions [data-act="edit"]').click();
  await expect(page.locator(".detail-view.editing #prompt")).toBeFocused();
}
