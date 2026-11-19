import assert from "node:assert/strict";
import { join } from "node:path";
import { expect, type Page, type Route } from "@playwright/test";
import sharp from "sharp";
import type {
  Asset,
  CanvasNode,
  Job,
  Project,
} from "../apps/web/canvas-editor/types.js";

type Shot = {
  title: string;
  prompt: string;
  narration: string;
  seconds: number;
};
type Site = { url: string; api: string; cookie: string; workspace: number };
type Options = {
  pages: Page[];
  project: string;
  sites: Site[];
  fixtures: string;
  api: (site: Site, path: string) => Promise<any>;
  compare: (pages: Page[], name: string, aliases: string[][]) => Promise<void>;
  flowRequests: unknown[][];
  proposal: Shot[];
  finishProposal: () => void;
};

export function normalizeEditorIds(value: unknown, ids: string[]) {
  // Each pair comes from corresponding successful writes in separate stores.
  // The pack chooser also displays the first six digits in an accessible label.
  return ids.reduce(
    (json, id, slot) =>
      json
        .replaceAll(id, `<server-id-${slot}>`)
        .replaceAll(
          `选择参考图 ${id.slice(0, 6)}"`,
          `选择参考图 <server-id-${slot}-prefix>"`,
        ),
    JSON.stringify(value),
  );
}

const button = (page: Page, name: string | RegExp) =>
  page.getByRole("button", { name, exact: typeof name === "string" });
const node = (page: Page, id: string) => page.getByTestId("rf__node-" + id);

async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

export async function verifyEditorInteractions({
  pages,
  project,
  sites,
  fixtures,
  api,
  compare,
  flowRequests,
  proposal,
  finishProposal,
}: Options) {
  const documentURL = "/api/canvases/" + project;
  const candidatesURL = documentURL + "/nodes/video/candidates";
  const aliases: string[][] = [[], []];
  const each = <T>(action: (page: Page, side: number) => Promise<T>) =>
    Promise.all(pages.map(action));
  const click = (name: string | RegExp) =>
    each((page) => button(page, name).click());
  const visible = (name: string | RegExp, timeout?: number) =>
    each((page) => expect(button(page, name)).toBeVisible({ timeout }));
  const save = () => visible("已保存");
  const snapshot = (name: string) => compare(pages, name, aliases);
  const select = (id: string) =>
    each((page) =>
      node(page, id)
        .locator(".node-content")
        .click({ position: { x: 15, y: 15 } }),
    );
  const searchNode = async (name: string) => {
    await click("搜索节点");
    await each(async (page) => {
      const dialog = page.getByRole("dialog", { name: "搜索节点" });
      await dialog.getByRole("textbox").fill(name);
      await dialog.getByText(name, { exact: true }).click();
    });
  };
  const title = (page: Page) => page.getByRole("textbox", { name: "画布名称" });
  const rename = (name: string) =>
    each(async (page) => {
      await title(page).fill(name);
      await title(page).press("Enter");
    });
  const equivalent = (values: unknown[], label: string) =>
    assert.equal(
      normalizeEditorIds(values[1], aliases[1]),
      normalizeEditorIds(values[0], aliases[0]),
      label,
    );
  const addAliases = (ids: string[]) => {
    for (const [side, id] of ids.entries()) {
      assert.match(id, /^[a-f0-9]{32}$/);
      assert.ok(!aliases[side].includes(id));
      aliases[side].push(id);
    }
  };
  const read = (path: string) =>
    Promise.all(sites.map((site) => api(site, path)));
  const documents = async (): Promise<Project[]> => {
    const values = await read(documentURL);
    equivalent(values, "persisted canvas revision and document");
    return values;
  };
  const savedNode = (value: Project, id: string): CanvasNode => {
    const found = value.document.nodes.find((item) => item.id === id);
    assert.ok(found, id);
    return found;
  };
  const fixture = async (name: string, method = "GET") =>
    Promise.all(
      sites.map(async (site) => {
        const response = await fetch(site.api + "/__editor_fixture/" + name, {
          method,
          headers: { Origin: site.url },
        });
        assert.equal(response.status, 200, await response.clone().text());
        return response.json();
      }),
    );
  const mutation = (
    path: string,
    method: string,
    action: (page: Page, side: number) => Promise<unknown>,
  ) =>
    each(async (page, side) => {
      const response = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === path && r.request().method() === method,
      );
      await action(page, side);
      const result = await response;
      if (!result.ok()) {
        const detail = await result
          .text()
          .catch((error: Error) => error.message);
        assert.fail(`${method} ${path}: ${result.status()} ${detail}`);
      }
      assert.equal(await result.finished(), null);
      return result;
    });
  const uploadAsset = async (
    path: string,
    action: (page: Page) => Promise<unknown>,
  ): Promise<Asset[]> => {
    const before = (await read("/api/state")).map(
      ({ assets }) => new Set((assets as Asset[]).map(({ id }) => id)),
    );
    await mutation(path, "POST", action);
    return (await read("/api/state")).map(({ assets }, side) => {
      const created = (assets as Asset[]).filter(
        ({ id }) => !before[side].has(id),
      );
      assert.equal(created.length, 1, path);
      return created[0];
    });
  };
  const media = async (ids: string[]) => {
    const objects = await Promise.all(
      sites.map(async (site, side) => {
        const route = site.url + "/media/" + ids[side];
        assert.equal(
          (await fetch(route)).status,
          401,
          "private media denies guest reads",
        );
        const response = await fetch(route, {
          headers: { cookie: "fm_session=" + site.cookie },
        });
        assert.equal(response.status, 200);
        return {
          mime: response.headers.get("content-type"),
          bytes: Buffer.from(await response.arrayBuffer()),
        };
      }),
    );
    assert.deepEqual(
      objects[1],
      objects[0],
      "stored media MIME and exact bytes",
    );
    assert.ok(objects[0].bytes.length > 0);
    return objects[0];
  };
  const framePixels = async (ids: string[], channel: 0 | 2) => {
    const { mime, bytes } = await media(ids);
    assert.match(mime!, /^image\//);
    const { data, info } = await sharp(bytes)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.deepEqual([info.width, info.height, info.channels], [96, 54, 3]);
    assert.ok(
      data[channel] > 220 && data[2 - channel] < 30,
      "stored frame has the expected colour at the selected time",
    );
  };

  const viewKey = "fm-canvas-view-" + project;
  await each(async (page) => {
    await page.evaluate(
      (key) =>
        localStorage.setItem(key, JSON.stringify({ x: 200, y: 140, zoom: 1 })),
      viewKey,
    );
    await page.reload();
    await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  });
  const [original] = await documents();
  const originalText = savedNode(original, "text");
  await each(async (page) => {
    const content = await node(page, "text")
      .locator(".node-content")
      .boundingBox();
    assert.ok(content);
    const from = { x: content.x + 60, y: content.y + 40 };
    await drag(page, from, { x: from.x - 80, y: from.y + 50 });
  });
  await save();
  const [moved] = await documents();
  // The first pointer step crosses React Flow's drag threshold.
  assert.equal(savedNode(moved, "text").x, originalText.x - 72);
  assert.equal(savedNode(moved, "text").y, originalText.y + 45);
  await snapshot("dragged-node");
  await click("撤销 ⌘Z");
  await save();
  assert.deepEqual((await documents())[0].document, original.document);
  await click("重做 ⌘⇧Z");
  await save();
  assert.deepEqual((await documents())[0].document, moved.document);

  await each(async (page) => {
    const edge = page.getByTestId("rf__edge-text-to-video");
    await edge.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Delete");
  });
  await save();
  assert.deepEqual((await documents())[0].document.edges, []);
  await each(async (page) => {
    const source = await page
      .getByLabel("从 原始文案 连接", { exact: true })
      .boundingBox();
    const target = await page
      .getByLabel("连接到 封面镜头", { exact: true })
      .boundingBox();
    assert.ok(source && target);
    await drag(
      page,
      { x: source.x + source.width / 2, y: source.y + source.height / 2 },
      { x: target.x + target.width / 2, y: target.y + target.height / 2 },
    );
    await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  });
  await save();
  const [linked] = await documents();
  assert.deepEqual(
    linked.document.edges.map(({ source, target }) => ({ source, target })),
    [{ source: "text", target: "video" }],
  );
  assert.notEqual(linked.document.edges[0].id, original.document.edges[0].id);
  await snapshot("connected-handles");

  const viewport = () =>
    each((page) =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), viewKey),
    );
  const initialViewport = await viewport();
  await click("抓手 H");
  await each(async (page) => {
    const from = { x: 180, y: 680 };
    assert.ok(
      await page.evaluate(
        ({ x, y }) =>
          document
            .elementFromPoint(x, y)
            ?.classList.contains("react-flow__pane"),
        from,
      ),
    );
    await drag(page, from, { x: from.x + 70, y: from.y - 40 });
  });
  await expect
    .poll(viewport)
    .toEqual(
      initialViewport.map(({ x, y, zoom }) => ({ x: x + 70, y: y - 40, zoom })),
    );
  await click("选择 V");
  await click("缩放菜单");
  await click("50%");
  await each((page) =>
    expect
      .poll(() =>
        page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key)!).zoom,
          viewKey,
        ),
      )
      .toBe(0.5),
  );
  const panZoom = await viewport();
  assert.deepEqual(panZoom[0], panZoom[1]);
  assert.notDeepEqual(panZoom, initialViewport);
  await each(async (page) => {
    await page.reload();
    await expect(node(page, "text")).toBeVisible();
    await expect(button(page, "缩放菜单")).toHaveText("50%");
  });
  assert.deepEqual(await viewport(), panZoom);
  await each((page, side) =>
    expect(page.locator(".react-flow__viewport")).toHaveCSS(
      "transform",
      `matrix(${panZoom[side].zoom}, 0, 0, ${panZoom[side].zoom}, ${panZoom[side].x}, ${panZoom[side].y})`,
    ),
  );
  assert.equal((await documents())[0].revision, linked.revision);
  await snapshot("persisted-viewport");
  await click("缩放菜单");
  await click(/适配画布/);

  const saveURL = "**" + documentURL + "/document";
  const offline = (route: Route) => route.abort("failed");
  await each((page) => page.route(saveURL, offline));
  await rename("断线时保留的画布 😀");
  await visible("保存失败，重试");
  const drafts = await each((page) =>
    page.evaluate((id) => {
      const editor = sessionStorage.getItem("fm-canvas-editor");
      const key = Object.keys(localStorage).find((key) =>
        key.endsWith(`-${id}-${editor}`),
      );
      return key ? JSON.parse(localStorage.getItem(key)!) : null;
    }, project),
  );
  equivalent(drafts, "browser draft while save endpoint is disconnected");
  assert.equal(drafts[0].draft.title, "断线时保留的画布 😀");
  assert.equal(drafts[0].revision, linked.revision);
  assert.equal((await documents())[0].title, linked.title);
  await snapshot("save-disconnected");
  await each((page) => page.unroute(saveURL, offline));
  await click("保存失败，重试");
  await save();
  const [recovered] = await documents();
  assert.equal(recovered.title, drafts[0].draft.title);
  assert.equal(recovered.revision, linked.revision + 1);
  await snapshot("save-recovered");

  await select("video");
  await click("素材包 · 1");
  await click("打开素材包 对照素材包");
  await click("移除整包引用");
  await save();
  await click("选择模型");
  await snapshot("video-model-families");
  await each((page) =>
    page.getByRole("option", { name: "Muse", exact: true }).click(),
  );
  await click("视频时长");
  await click("8s");
  await save();
  const [muse] = await documents();
  assert.equal(savedNode(muse, "video").params.model, "muse-video");
  assert.equal(savedNode(muse, "video").params.seconds, 8);
  await snapshot("muse-duration");
  await click("选择模型");
  await each((page) =>
    page.getByRole("option", { name: "Omni 1.2 Flash", exact: true }).click(),
  );
  await click("选择生成方式和比例");
  await click("9:16");
  await click("视频时长");
  await click("9s");
  await save();
  const [omni] = await documents();
  assert.equal(
    savedNode(omni, "video").params.model,
    "flow:omni-1.2-flash-9s-portrait",
  );
  await snapshot("flow-omni-variant");
  await click("选择模型");
  await each((page) =>
    page.getByRole("option", { name: "Veo 3.1 Quality", exact: true }).click(),
  );
  await click("视频时长");
  await click("6s");
  await save();
  const [veo] = await documents();
  const flowVariant = "flow:veo-3.1-quality-6s-portrait";
  assert.equal(savedNode(veo, "video").params.model, flowVariant);
  await snapshot("flow-veo-variant");

  const jobs = async (status: string): Promise<Job[][]> => {
    const runs = (await read(documentURL + "/runs")).map((result) =>
      (result.runs as Job[]).filter((job) => job.model === flowVariant),
    );
    assert.ok(runs.every((list) => list[0]?.status === status));
    return runs;
  };
  await click("生成");
  await visible("取消任务");
  const first = (await jobs("queued"))[0][0];
  assert.equal(first.inputs?.params?.model, flowVariant);
  assert.equal(first.seconds, 6);
  assert.equal(first.ratio, "9:16");
  assert.deepEqual(await fixture("flow", "POST"), [
    { worked: true },
    { worked: true },
  ]);
  const rejection = "Flow 未通过内容审核，请调整提示词或参考图";
  await each((page) =>
    expect(page.getByText(rejection, { exact: true })).toBeVisible({
      timeout: 12000,
    }),
  );
  await jobs("failed");
  await snapshot("provider-failure");

  // Commit the actual request on both servers, then lose only the response.
  // Keep the last successful read while the browser's run feed is disconnected.
  const runURL = "**" + documentURL + "/runs";
  const previousRuns = await read(documentURL + "/runs");
  const candidatePattern = "**" + candidatesURL;
  const lostAcks = [0, 0];
  try {
    await each(async (page, side) => {
      await page.route(runURL, (route) =>
        route.fulfill({ json: previousRuns[side] }),
      );
      await page.route(
        candidatePattern,
        async (route) => {
          const response = await route.fetch();
          lostAcks[side] = response.status();
          await route.abort("failed");
        },
        { times: 1 },
      );
    });
    await click("生成");
    await each((page) =>
      expect(page.locator(".canvas-toast")).toHaveText("Failed to fetch"),
    );
    assert.deepEqual(lostAcks, [200, 200]);
    const accepted = await jobs("queued");
    assert.ok(accepted.every((list) => list.length === 2));
    await snapshot("generation-response-lost");
    const pending = await each((page) =>
      page.evaluate((project) => {
        const key = Object.keys(localStorage).find(
          (key) =>
            key.startsWith("fm-canvas-candidates-") &&
            key.endsWith(project + "-video"),
        );
        return key ? JSON.parse(localStorage.getItem(key)!) : null;
      }, project),
    );
    assert.deepEqual(pending[1], pending[0]);
    assert.match(pending[0].uid, /^f000/);
    const retried = await mutation(candidatesURL, "POST", (page) =>
      button(page, "生成").click(),
    );
    const receipts = await Promise.all(
      retried.map((response) => response.json()),
    );
    assert.deepEqual(
      receipts.map((receipt) => receipt.ids),
      accepted.map((list) => [list[0].id]),
    );
  } finally {
    await each((page) => page.unroute(runURL));
  }
  await visible("取消任务", 12000);
  assert.deepEqual(await fixture("flow", "POST"), [
    { worked: true },
    { worked: true },
  ]);
  const results = await jobs("done");
  const flowIds = results.map((list) => list[0].result!);
  addAliases(flowIds);
  await media(flowIds);
  assert.deepEqual(flowRequests[0], flowRequests[1]);
  assert.equal(flowRequests[0].length, 2);
  assert.deepEqual(flowRequests[0][0], flowRequests[0][1]);
  assert.equal(
    (flowRequests[0][0] as { model: string }).model,
    flowVariant.slice(5),
  );
  const writeback = await fixture("writes");
  equivalent(writeback, "charges and settlement ledger after provider retry");
  const flowJobIds = results[0].map((job) => job.id);
  assert.deepEqual(
    writeback[0].charges.filter((row: { job: number }) =>
      flowJobIds.includes(row.job),
    ),
    [
      { job: first.id, amount: 2, state: "refunded" },
      { job: flowJobIds[0], amount: 2, state: "spent" },
    ],
  );
  assert.deepEqual(
    writeback[0].job_ledger.filter((row: { job: number }) =>
      flowJobIds.includes(row.job),
    ),
    [
      { job: first.id, action: "reserve", amount: 2 },
      { job: first.id, action: "refund", amount: 2 },
      { job: flowJobIds[0], action: "reserve", amount: 2 },
      { job: flowJobIds[0], action: "spend", amount: 2 },
    ],
  );
  await each((page) =>
    expect(page.locator(".composer-message.error")).toHaveCount(0, {
      timeout: 12000,
    }),
  );
  await snapshot("provider-retry-settled");

  async function pausedFrame(seconds: number) {
    // The original adopted version is still selected after the new Flow run.
    await click("播放 封面镜头");
    await each((page) => page.mouse.move(12, 12));
    await each((page) =>
      page
        .getByRole("dialog")
        .locator("video")
        .evaluate(async (video: HTMLVideoElement, time) => {
          video.pause();
          if (video.readyState < 2)
            await new Promise<void>((resolve) =>
              video.addEventListener("loadeddata", () => resolve(), {
                once: true,
              }),
            );
          if (video.currentTime !== time) {
            await new Promise<void>((resolve) => {
              video.addEventListener("seeked", () => resolve(), { once: true });
              video.currentTime = time;
            });
          }
          if (
            !video.paused ||
            video.videoWidth !== 96 ||
            video.videoHeight !== 54
          )
            throw new Error("Invalid paused fixture video");
        }, seconds),
    );
  }
  await pausedFrame(0.5);
  await snapshot("paused-video-frame");
  const extracted = await uploadAsset("/api/assets", (page) =>
    button(page, "用作下一镜头首帧").click(),
  );
  const frameIds = extracted.map(({ id }) => id);
  addAliases(frameIds);
  await visible("更多设置");
  await save();
  const frameProjects = await documents();
  const frameNodes = frameProjects.map((value, side) => {
    const image = value.document.nodes.find(
      (item) => item.media_id === frameIds[side],
    );
    assert.ok(image);
    assert.match(image.title, /0\.50 秒取帧$/);
    const edge = value.document.edges.find(({ source }) => source === image.id);
    assert.ok(edge);
    const next = savedNode(value, edge.target);
    assert.equal(next.params.h3?.mode, "frames");
    assert.equal(next.params.h3?.first_frame, image.media_id);
    assert.ok(value.document.shots?.includes(next.id));
    return next.id;
  });
  assert.equal(frameNodes[1], frameNodes[0]);
  await framePixels(frameIds, 0);
  const provenance = (await fixture("writes")).map((entry) => entry.provenance);
  equivalent(provenance, "persisted video frame provenance");
  assert.deepEqual(
    provenance[0].map(
      ({
        media,
        source,
        frame_seconds,
      }: {
        media: string;
        source: string;
        frame_seconds: number;
      }) => ({ media, source, frame_seconds }),
    ),
    [{ media: frameIds[0], source: "b".repeat(32), frame_seconds: 0.5 }],
  );
  await snapshot("next-shot-frame-writeback");
  await click("更多设置");
  await each((page) =>
    page.getByRole("radio", { name: "20", exact: true }).press("ArrowRight"),
  );
  await each((page) =>
    expect(page.getByRole("radio", { name: "32", exact: true })).toBeChecked(),
  );
  await each((page) =>
    page.getByRole("spinbutton", { name: "随机种子" }).fill("123456"),
  );
  await click("更多设置");
  await save();
  const [advanced] = await documents();
  assert.equal(savedNode(advanced, frameNodes[0]).params.sampling_steps, 32);
  assert.equal(savedNode(advanced, frameNodes[0]).params.seed, 123456);
  await click("更多设置");
  await snapshot("h3-sampling-and-seed");
  await each((page) => page.getByRole("switch", { name: "快速模式" }).click());
  await snapshot("h3-fast-mode");
  await click("更多设置");
  await save();
  assert.equal(
    savedNode((await documents())[0], frameNodes[0]).params.fast_mode,
    true,
  );
  await click("交换首尾帧");
  await save();
  const frameOptions = savedNode((await documents())[0], frameNodes[0]).params
    .h3!;
  assert.equal(frameOptions.first_frame, null);
  assert.equal(frameOptions.last_frame, frameIds[0]);
  await snapshot("h3-tail-frame");
  await click("首尾帧");
  await each((page) =>
    page.getByRole("option", { name: "全能参考", exact: true }).click(),
  );
  await each(async (page) => {
    const invalid = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/h3/references",
    );
    await page
      .getByLabel("上传 H3 参考素材")
      .setInputFiles(join(fixtures, "shot.mp4"));
    assert.equal((await invalid).status(), 400);
    await expect(page.locator(".cv-h3-inputs").getByRole("alert")).toHaveText(
      "参考视频和音频的时长需为 2–15 秒",
    );
  });
  await snapshot("h3-invalid-video");
  const h3 = await uploadAsset("/api/h3/references", (page) =>
    page
      .getByLabel("上传 H3 参考素材")
      .setInputFiles(join(fixtures, "reference.mp4")),
  );
  const h3Ids = h3.map(({ id }) => id);
  addAliases(h3Ids);
  assert.ok(h3.every((asset) => asset.kind === "ref_video" && asset.has_audio));
  await each((page) => page.getByRole("checkbox", { name: "声音" }).check());
  await click("引用视频1");
  // H3Prompt is contenteditable, so verify the reference token in the saved document.
  await save();
  const [multimodal] = await documents();
  const h3Node = savedNode(multimodal, frameNodes[0]);
  assert.ok(h3Node.params.h3_refs?.includes(h3Ids[0]));
  assert.deepEqual(h3Node.params.h3?.video_audio, [h3Ids[0]]);
  assert.match(h3Node.prompt, /<Video 1>/);
  assert.match((await media(h3Ids)).mime!, /^video\/mp4/);
  await snapshot("h3-video-reference");

  const uploads = await uploadAsset("/api/assets", async (page) => {
    const file = page.waitForEvent("filechooser");
    await button(page, "上传图片").click();
    await (await file).setFiles(join(fixtures, "ref.png"));
  });
  const uploadIds = uploads.map(({ id }) => id);
  addAliases(uploadIds);
  await each((page, side) =>
    expect(page.getByAltText("ref.png", { exact: true })).toHaveAttribute(
      "src",
      "/media/" + uploadIds[side],
    ),
  );
  await save();
  await media(uploadIds);
  assert.ok(
    (await documents()).every((value, side) =>
      value.document.nodes.some(
        (item) =>
          item.title === "ref.png" &&
          item.media_id === uploadIds[side] &&
          item.active_job === null,
      ),
    ),
  );
  await snapshot("image-uploaded");

  await searchNode("下一镜头");
  await click("素材包");
  await click("新建素材包");
  await each(async (page, side) => {
    await page.getByLabel("名称", { exact: true }).fill("新建展台素材包");
    await page.getByLabel("说明", { exact: true }).fill("保留展台轮廓。");
    await button(page, "场景").click();
    await button(page, "选择参考图 " + uploadIds[side].slice(0, 6)).click();
  });
  await snapshot("asset-pack-create-draft");
  await mutation("/api/asset-packs", "POST", (page) =>
    button(page, "保存素材包").click(),
  );
  const packs = (await read("/api/asset-packs")).map(({ packs }) => {
    const created = packs.find(
      (pack: { name: string }) => pack.name === "新建展台素材包",
    );
    assert.ok(created);
    return created as { id: string; revision: number };
  });
  const packIds = packs.map(({ id }) => id);
  addAliases(packIds);
  assert.ok(packs.every(({ revision }) => revision === 1));
  await click("打开素材包 新建展台素材包");
  await click("导入整个素材包");
  await visible("素材包 · 1");
  await save();
  assert.deepEqual(
    savedNode((await documents())[0], frameNodes[0]).asset_packs,
    [{ id: packIds[0], revision: 1 }],
  );
  await click("素材包 · 1");
  await click("编辑 新建展台素材包");
  await each(async (page, side) => {
    const description = page.getByLabel(/^说明/);
    await expect(description).toHaveValue("保留展台轮廓。");
    await page.getByLabel("名称", { exact: true }).fill("更新后的展台素材包");
    await description.fill("保持背景灯光一致。");
    await button(page, "风格").click();
    await button(page, "选择参考图 " + frameIds[side].slice(0, 6)).click();
  });
  await snapshot("asset-pack-edit-draft");
  await click("保存素材包");
  await click("打开素材包 更新后的展台素材包");
  await snapshot("asset-pack-revision-available");
  await click("更新整包引用");
  await each((page) =>
    expect(page.getByRole("dialog", { name: "素材包" })).toHaveCount(0),
  );
  await save();
  assert.deepEqual(
    savedNode((await documents())[0], frameNodes[0]).asset_packs,
    [{ id: packIds[0], revision: 2 }],
  );
  const listings = await read("/api/asset-packs");
  equivalent(listings, "asset pack revision and ordered private media");
  const updatedPack = listings[0].packs.find(
    (item: { id: string }) => item.id === packIds[0],
  );
  assert.deepEqual(
    {
      ...updatedPack,
      workspace: undefined,
      owner: undefined,
      updated: undefined,
    },
    {
      id: packIds[0],
      revision: 2,
      name: "更新后的展台素材包",
      purpose: "style",
      description: "保持背景灯光一致。",
      media: [uploadIds[0], frameIds[0]],
      workspace: undefined,
      owner: undefined,
      updated: undefined,
    },
  );
  await snapshot("asset-pack-revision-applied");

  const [beforeStill] = await documents();
  await searchNode("封面镜头");
  await pausedFrame(0.25);
  const stills = await uploadAsset("/api/assets", (page) =>
    button(page, "提取当前帧").click(),
  );
  const stillIds = stills.map(({ id }) => id);
  addAliases(stillIds);
  await each((page) => expect(page.getByRole("dialog")).toHaveCount(0));
  await save();
  const stillProjects = await documents();
  assert.deepEqual(stillProjects[0].document.shots, beforeStill.document.shots);
  assert.ok(
    stillProjects.every((value, side) =>
      value.document.nodes.some(
        (item) =>
          item.type === "image" &&
          item.media_id === stillIds[side] &&
          item.title.endsWith("0.25 秒取帧"),
      ),
    ),
  );
  const mediaWrites = await fixture("writes");
  const allProvenance = mediaWrites.map((entry) => entry.provenance);
  equivalent(allProvenance, "standalone frame provenance");
  assert.equal(allProvenance[0][1].source, "b".repeat(32));
  assert.equal(allProvenance[0][1].frame_seconds, 0.25);
  assert.equal(allProvenance[0][1].media, stillIds[0]);
  const uploadsAtApi = mediaWrites.map(({ uploads }) => uploads);
  equivalent(
    uploadsAtApi,
    "raw upload checksums and forwarded headers at the pinned APIs",
  );
  assert.deepEqual(
    uploadsAtApi[0].map(
      ({ path, query }: { path: string; query: string }) =>
        path + (query ? "?" + query : ""),
    ),
    [
      "/api/assets",
      "/api/h3/references?kind=video",
      "/api/h3/references?kind=video",
      "/api/assets",
      "/api/assets",
    ],
  );
  await framePixels(stillIds, 2);
  await snapshot("standalone-frame");

  const [beforeStoryboard] = await documents();
  const beforeCredits = (await read("/api/state")).map(
    ({ credits }) => credits.available,
  );
  const beforeRuns = (await read(documentURL + "/runs")).map(
    ({ runs }) => runs.length,
  );
  const eventPattern = "**/api/chats/*/events?workspace=*";
  const cutStreams = [0, 0];
  await each((page, side) =>
    page.route(
      eventPattern,
      async (route) => {
        cutStreams[side]++;
        // EOF on a successful SSE connection makes the real EventSource reconnect.
        await route.fulfill({
          contentType: "text/event-stream",
          headers: { "x-editor-fixture-disconnect": "1" },
          body: "retry: 100\n\n",
        });
      },
      { times: 1 },
    ),
  );
  await click("AI 分镜");
  await each((page) =>
    page.getByLabel("创作需求").fill("为蓝色展台拟定两段镜头。"),
  );
  const reconnected = each((page) =>
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith("/events") &&
        response.headers()["content-type"]?.includes("text/event-stream") &&
        // The interrupted connection is one finite, fixture-controlled response.
        response.headers()["x-editor-fixture-disconnect"] === undefined,
    ),
  );
  await click("拟定分镜");
  await visible("停止");
  assert.ok((await reconnected).every((response) => response.ok()));
  // The canvas wallet tooltip follows /api/state on its own five-second poll.
  await each(async (page, side) => {
    await expect(page.locator(".canvas-credit")).toHaveAttribute(
      "title",
      `当前空间可用 ${beforeCredits[side] - 2} 积分`,
      { timeout: 12000 },
    );
    await expect(page.locator(".canvas-toast")).toHaveCount(0);
  });
  await snapshot("storyboard-generating");
  finishProposal();
  await visible("采用分镜，不生成视频");
  assert.deepEqual(cutStreams, [1, 1]);
  await each((page) =>
    expect(page.getByLabel("镜头 1", { exact: true })).toHaveValue(
      proposal[0].title,
    ),
  );
  await snapshot("storyboard-generated-after-sse-reconnect");
  await each(async (page) => {
    await page.getByLabel("镜头 1", { exact: true }).fill("展台开场（已编辑）");
    await page
      .getByRole("group", { name: "镜头 2 时长" })
      .getByRole("button", { name: "15s" })
      .click();
  });
  await snapshot("storyboard-edited");
  await click("采用分镜，不生成视频");
  await each((page) =>
    expect(page.getByRole("dialog", { name: "AI 分镜" })).toHaveCount(0),
  );
  await save();
  const [storyboard] = await documents();
  const newShots = storyboard.document.shots!.slice(
    beforeStoryboard.document.shots!.length,
  );
  assert.equal(newShots.length, proposal.length);
  assert.equal(
    storyboard.document.nodes.length - beforeStoryboard.document.nodes.length,
    4,
  );
  assert.equal(
    storyboard.document.edges.length - beforeStoryboard.document.edges.length,
    2,
  );
  for (const [index, shot] of proposal.entries()) {
    const item = savedNode(storyboard, newShots[index]);
    const edge = storyboard.document.edges.find(
      ({ target }) => target === item.id,
    );
    assert.ok(edge);
    assert.equal(item.title, index === 0 ? "展台开场（已编辑）" : shot.title);
    assert.equal(item.narration_text, shot.narration);
    assert.equal(item.params.seconds, index === 1 ? 15 : shot.seconds);
    assert.equal(item.params.model, "MiniMax H3");
    assert.equal(savedNode(storyboard, edge.source).text, shot.prompt);
  }
  assert.deepEqual(
    (await read(documentURL + "/runs")).map(({ runs }) => runs.length),
    beforeRuns,
  );
  assert.deepEqual(
    (await read("/api/state")).map(({ credits }) => credits.available),
    beforeCredits.map((amount) => amount - 2),
  );
  await snapshot("storyboard-applied");
  await each(async (page) => {
    await page.reload();
    await expect(node(page, newShots[1])).toBeVisible();
    await expect(title(page)).toHaveValue(storyboard.title);
  });
  assert.equal((await documents())[0].revision, storyboard.revision);
  await snapshot("storyboard-reloaded");
  return {
    aliases,
    evidence: {
      viewport: panZoom[0],
      savedRevisionAfterRetry: recovered.revision,
      flowVariant,
      flowJobs: writeback[0].charges.filter((row: { job: number }) =>
        flowJobIds.includes(row.job),
      ),
      frameTimes: allProvenance[0].map(
        (entry: { frame_seconds: number }) => entry.frame_seconds,
      ),
      uploads: uploadsAtApi[0].length,
      editedPackRevision: updatedPack.revision,
      adoptedStoryboardShots: newShots.length,
    },
  };
}
