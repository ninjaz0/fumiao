/** Compare the public November 18 editor with the default Next editor over Nest. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, type Browser, type Page } from "@playwright/test";
import sharp from "sharp";
import type {
  CanvasNode,
  Doc,
  Draft,
  Params,
  Project,
  Studio,
} from "../apps/web/canvas-editor/types.js";
import { normalizeEditorIds } from "./verify-canvas-interactions.js";
import { tree } from "./verify-homepage.js";

const pinnedScript = "legacy/pure/static/canvas.js";
const output = resolve(".runtime-advanced/canvas-portable-references");
const sha256 = (data: Buffer) =>
  createHash("sha256").update(data).digest("hex");
const h3Model = "MiniMax H3";
const portableModel = "muse-video";
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const title = "H3 参考素材迁移";

async function publicScript() {
  const delta: {
    captured: string;
    pinnedSha256: string;
    publicSha256: string;
    publicSize: number;
    anchor: string;
    transform: string;
    effect: string;
  } = JSON.parse(
    await readFile(
      new URL(
        "./fixtures/canvas-portable-references-2026-11-18.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const fixed = await readFile(pinnedScript);
  assert.equal(sha256(fixed), delta.pinnedSha256);
  const anchor = fixed.indexOf(delta.anchor);
  assert.ok(anchor >= 0 && fixed.lastIndexOf(delta.anchor) === anchor);
  const rebuilt = Buffer.concat([
    Buffer.from(delta.transform),
    fixed.subarray(0, anchor),
    Buffer.from(delta.effect),
    fixed.subarray(anchor),
  ]);
  assert.equal(rebuilt.length, delta.publicSize);
  assert.equal(sha256(rebuilt), delta.publicSha256);
  const localPath = process.env.CANVAS_PUBLIC_JS;
  const bytes = localPath ? await readFile(localPath) : rebuilt;
  assert.equal(sha256(bytes), delta.publicSha256, "public oracle SHA-256");
  return {
    bytes,
    sha: delta.publicSha256,
    captured: delta.captured,
    source: localPath ? "local capture" : "reconstructed capture",
  };
}

type FixtureOptions = {
  browser: Browser;
  origin: string;
  workspace: string;
  provenance: Record<string, string>;
  request: (
    path: string,
    options?: {
      method?: string;
      data?: unknown;
      headers?: Record<string, string>;
    },
  ) => Promise<{ json(): Promise<any> }>;
  image: string;
  referenceVideo: Buffer;
  storageState: Awaited<
    ReturnType<import("@playwright/test").BrowserContext["storageState"]>
  >;
};

type Plan = {
  name: string;
  model: string;
  refs: string[];
  h3?: Params["h3"];
  type?: "text";
  reusable?: CanvasNode[];
  existing?: Doc["edges"];
  added?: string[];
  kept?: string[];
  connect?: string[];
  clearedFrames?: NonNullable<Params["h3"]>;
  switchModel?: boolean;
  defaultToH3?: boolean;
};

type Save = Draft & { expected_revision: number };

function node(id: string, fields: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id,
    type: "video",
    title: "参考目标",
    x: 180,
    y: -40,
    width: 254,
    height: 196,
    text: "保留节点内容",
    prompt: "保留提示词 <Picture 1>",
    color: "mint",
    media_id: null,
    active_job: null,
    use_media: true,
    narration_text: "保留旁白",
    narration_instruction: "平静叙述",
    params: {
      model: portableModel,
      ratio: "16:9",
      quality: 768,
      seconds: 5,
      seed: 123,
      sampling_steps: 32,
      fast_mode: true,
      resolution: "2K",
      image_quality: "high",
      h3: null,
      h3_refs: [],
    },
    ...fields,
  };
}

const idFor = (media: string) => "existing-" + media;
function existingImage(media: string, y: number) {
  const source = node(idFor(media), {
    type: "image",
    title: "已有参考图片",
    x: -415,
    y,
    media_id: media,
    narration_text: "",
    narration_instruction: "",
  });
  source.params.model = "muse-image";
  return source;
}

function expectedConversion(before: Doc, plan: Plan): Doc {
  const [target, ...rest] = before.nodes;
  const params = plan.switchModel
    ? { ...target.params, model: portableModel, seconds: 6 }
    : target.params;
  const added = (plan.added ?? []).map((media, index): CanvasNode => ({
    ...target,
    id: "new-node-" + index,
    type: "image",
    title: "参考图片",
    prompt: "",
    media_id: media,
    active_job: null,
    asset_packs: [],
    params: { ...params, model: "muse-image", h3: null, h3_refs: [] },
    x: target.x - 300,
    y: target.y + 80 * (plan.connect ?? []).indexOf(media),
  }));
  const edges = (plan.connect ?? [])
    .flatMap((media) => {
      const source =
        added.find((candidate) => candidate.media_id === media)?.id ??
        idFor(media);
      return before.edges.some(
        (edge) => edge.source === source && edge.target === target.id,
      )
        ? []
        : [{ source, target: target.id }];
    })
    .map((edge, index) => ({ ...edge, id: "new-edge-" + index }));
  return {
    ...before,
    nodes: [
      {
        ...target,
        params: {
          ...params,
          h3_refs: plan.kept ?? [],
          h3: plan.clearedFrames ?? params.h3,
        },
      },
      ...rest,
      ...added,
    ],
    edges: [...before.edges, ...edges],
  };
}

type Side = {
  page: Page;
  start: Project;
  path: string;
  editorPath: string;
  calls: { method: string; path: string; workspace: string; body: Save }[];
  bundleLoads: string[];
  errors: string[];
  read: () => Promise<Project>;
  releaseRefresh: () => void;
};

// Assign IDs by document order and check the same IDs in requests, UI and reads.
// A changed order, a reference to the wrong node, or a duplicate survives normalization.
function normalizeDocument(document: Doc, original: Doc) {
  const ids = new Map<string, string>();
  for (const kind of ["nodes", "edges"] as const) {
    const known = new Set(original[kind].map(({ id }) => id));
    const added = document[kind].filter(({ id }) => !known.has(id));
    added.forEach(({ id }, index) => {
      assert.match(id, uuid);
      assert.ok(!ids.has(id), `Duplicate UUID ${id}`);
      ids.set(id, `new-${kind === "nodes" ? "node" : "edge"}-${index}`);
    });
  }
  return {
    ids: [...ids.keys()],
    document: {
      ...document,
      nodes: document.nodes.map((item) => ({
        ...item,
        id: ids.get(item.id) ?? item.id,
      })),
      edges: document.edges.map((item) => ({
        ...item,
        id: ids.get(item.id) ?? item.id,
        source: ids.get(item.source) ?? item.source,
        target: ids.get(item.target) ?? item.target,
      })),
    },
  };
}

const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const target = (page: Page) => page.getByTestId("rf__node-target");
const saved = (page: Page) => expect(button(page, "已保存")).toBeVisible();

async function compare(sides: Side[], label: string, docs: Doc[]) {
  const samples = await Promise.all(
    sides.map(async ({ page, start }, i) => {
      await page.mouse.move(0, 0);
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(
          [...document.images]
            .filter((img) => img.getBoundingClientRect().width)
            .map((img) => img.decode().catch(() => {})),
        );
      });
      let previous = "";
      let dom: unknown;
      await expect
        .poll(
          async () => {
            dom = await tree(page);
            const current = JSON.stringify(dom);
            const stable = current === previous;
            previous = current;
            return stable;
          },
          { intervals: [150] },
        )
        .toBe(true);
      const png = await page.screenshot({
        animations: "disabled",
        caret: "hide",
      });
      const pixels = await sharp(png).ensureAlpha().raw().toBuffer();
      const ids = normalizeDocument(docs[i], start.document).ids;
      return { dom: normalizeEditorIds(dom, [start.id, ...ids]), png, pixels };
    }),
  );
  const [reference, react] = samples;
  if (react.dom !== reference.dom || !react.pixels.equals(reference.pixels)) {
    await Promise.all(
      samples.flatMap(({ png, dom }, i) => [
        writeFile(join(output, `${label}-${i}.png`), png),
        writeFile(
          join(output, `${label}-${i}.json`),
          JSON.stringify(JSON.parse(dom), null, 2),
        ),
      ]),
    );
    assert.fail(`${label}: DOM or pixels differ, artifacts in ${output}`);
  }
  console.log(`PASS ${label}: exact UI DOM, 0 changed pixels`);
}

async function autosave(
  sides: Side[],
  change: (page: Page, side: Side) => Promise<void>,
  expected: Doc,
) {
  return Promise.all(
    sides.map(async (side) => {
      const before = await side.read();
      const count = side.calls.length;
      const [response] = await Promise.all([
        side.page.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === side.path + "/document" &&
            r.request().method() === "PUT",
        ),
        change(side.page, side),
      ]);
      assert.equal(response.status(), 200, await response.text());
      await saved(side.page);
      const after = await side.read();
      assert.equal(after.revision, before.revision + 1);
      const call = side.calls[count];
      assert.equal(side.calls.length, count + 1);
      const { document } = normalizeDocument(
        call.body.document,
        side.start.document,
      );
      assert.deepEqual(
        { ...call.body, document },
        {
          title,
          expected_revision: before.revision,
          document: expected,
        },
      );
      assert.deepEqual(after.document, call.body.document);
      assert.deepEqual(
        normalizeDocument(after.document, side.start.document).document,
        expected,
      );
      return after.document;
    }),
  );
}

async function quiet(
  sides: Side[],
  expected: Doc[],
  change: (page: Page) => Promise<unknown> = async () => {},
) {
  await Promise.all(
    sides.map(async (side, i) => {
      const before = await side.read();
      const count = side.calls.length;
      const noSave = side.page
        .waitForRequest(
          (request) =>
            new URL(request.url()).pathname === side.path + "/document" &&
            request.method() !== "GET",
          { timeout: 1100 },
        )
        .then(
          () => assert.fail("Unexpected autosave"),
          (error: Error) => {
            assert.equal(error.name, "TimeoutError");
          },
        );
      await change(side.page);
      await saved(side.page);
      await noSave;
      const after = await side.read();
      assert.equal(after.revision, before.revision);
      assert.deepEqual(after.document, expected[i]);
      assert.equal(side.calls.length, count);
    }),
  );
}

export async function verifyPortableReferences({
  browser,
  origin,
  workspace,
  provenance,
  request,
  image,
  referenceVideo,
  storageState,
}: FixtureOptions) {
  await mkdir(output, { recursive: true });
  await rm(join(output, "report.json"), { force: true });
  const oracle = await publicScript();
  const post = async (
    path: string,
    data: unknown,
    headers?: Record<string, string>,
  ) => (await request(path, { method: "POST", data, headers })).json();
  const uploadImage = async (color: string) =>
    (
      await post(
        "/api/assets",
        await sharp({
          create: { width: 96, height: 54, channels: 3, background: color },
        })
          .png()
          .toBuffer(),
        { "content-type": "image/png" },
      )
    ).id as string;
  const [second, third] = [
    await uploadImage("#bf6a53"),
    await uploadImage("#237ae8"),
  ];
  const video: string = (
    await post("/api/h3/references?kind=video", referenceVideo, {
      "content-type": "video/mp4",
      "x-file-name": "portable.mp4",
    })
  ).id;
  const pack = await post("/api/asset-packs", {
    name: "保留在目标上的素材包",
    purpose: "subject",
    description: "",
    media: [image],
  });
  const studio: Studio = await (await request("/api/state")).json();
  for (const [id, kind] of [
    [image, "ref"],
    [second, "ref"],
    [third, "ref"],
    [video, "ref_video"],
  ])
    assert.equal(studio.assets.find((asset) => asset.id === id)?.kind, kind);
  for (const model of [h3Model, portableModel])
    assert.equal(studio.model_access[model], true, model);

  const reference = {
    mode: "reference",
    first_frame: null,
    last_frame: null,
    video_audio: [video],
  } as const;
  const h3: Params["h3"] = { ...reference, video_audio: [video] };
  const cases: Plan[] = [
    { name: "empty-model", type: "text", model: "", refs: [image], h3 },
    {
      name: "empty-video-defaults-to-h3",
      model: "",
      refs: [image, video],
      h3,
      defaultToH3: true,
    },
    { name: "h3-stays", model: h3Model, refs: [image, video], h3 },
    { name: "video-only", model: portableModel, refs: [video], h3 },
    {
      name: "one-image",
      model: portableModel,
      refs: [image],
      added: [image],
      connect: [image],
    },
    {
      name: "ordered-images-and-reuse",
      model: portableModel,
      refs: [second, image, second, third, video, video],
      h3,
      reusable: [existingImage(image, 220)],
      added: [second, third],
      kept: [video, video],
      connect: [second, image, third],
    },
    {
      name: "frames-and-existing-edge",
      model: portableModel,
      refs: [image, video, second, image],
      h3: {
        mode: "frames",
        first_frame: second,
        last_frame: third,
        video_audio: [video],
      },
      reusable: [existingImage(second, 130), existingImage(third, -230)],
      existing: [
        { id: "existing-edge", source: idFor(second), target: "target" },
      ],
      added: [image],
      kept: [video],
      connect: [image, second, third],
      clearedFrames: {
        mode: "frames",
        first_frame: null,
        last_frame: null,
        video_audio: [video],
      },
    },
    {
      name: "switch-model",
      model: h3Model,
      refs: [image, video],
      h3,
      switchModel: true,
      added: [image],
      kept: [video],
      connect: [image],
    },
  ];
  const states: string[] = [];
  const evidence: { name: string; saves: number }[] = [];
  for (const plan of cases) {
    const item = node("target", {
      ...(plan.type ? { type: plan.type } : {}),
      ...(plan.name === "one-image"
        ? { asset_packs: [{ id: pack.id, revision: pack.revision }] }
        : {}),
    });
    item.params = {
      ...item.params,
      model: plan.model,
      h3: plan.h3 ?? null,
      h3_refs: plan.refs,
    };
    const text = node("text", {
      type: "text",
      title: "连接的文字",
      x: -380,
      y: -270,
    });
    text.params.model = "";
    const seed: Doc = {
      schemaVersion: 1,
      nodes: [item, text, ...(plan.reusable ?? [])],
      edges: [
        ...(plan.type
          ? []
          : [{ id: "text-edge", source: "text", target: "target" }]),
        ...(plan.existing ?? []),
      ],
      shots: plan.type ? [] : ["target"],
    };
    const sides: Side[] = [];
    for (const [i, kind] of ["public", "react"].entries()) {
      const created: Project = await post("/api/canvases", { title });
      const path = "/api/canvases/" + created.id;
      const editorPath = "/canvas/" + created.id;
      await request(path + "/document", {
        method: "PUT",
        data: { title, expected_revision: created.revision, document: seed },
      });
      const read = async (): Promise<Project> => (await request(path)).json();
      const start = await read();
      const context = await browser.newContext({
        baseURL: origin,
        viewport: { width: 1440, height: 900 },
        reducedMotion: "reduce",
        storageState,
      });
      await context.addInitScript(() =>
        localStorage.setItem("fumiao-appearance", "light"),
      );
      const page = await context.newPage();
      page.setDefaultTimeout(15_000);
      const calls: Side["calls"] = [];
      const bundleLoads: string[] = [];
      const errors: string[] = [];
      let releaseRefresh!: () => void;
      const pendingRefresh = new Promise<void>((release) => {
        releaseRefresh = release;
      });
      let stateReads = 0;
      const side = {
        page,
        path,
        editorPath,
        start,
        calls,
        bundleLoads,
        errors,
        read,
        releaseRefresh,
      };
      sides.push(side);
      // Resolve the public HTML via the pinned fallback, on the same plain URL.
      // API/state/media are actual Next requests to Nest on both sides.
      await page.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) {
          errors.push("Unexpected browser origin: " + url.origin);
          return route.abort();
        }
        if (
          url.pathname === editorPath &&
          route.request().isNavigationRequest() &&
          !i
        ) {
          url.searchParams.set("canvas_ui", "legacy");
          const html = await route.fetch({ url: url.href });
          return route.fulfill({ response: html });
        }
        if (url.pathname === "/static/canvas.js" && !i) {
          bundleLoads.push(sha256(oracle.bytes));
          return route.fulfill({
            contentType: "application/javascript",
            body: oracle.bytes,
          });
        }
        if (
          i &&
          /^\/static\/(canvas|chat|flowpicker)\.js$/.test(url.pathname)
        ) {
          errors.push(
            "Legacy script requested by the default editor: " + url.pathname,
          );
          return route.abort();
        }
        // Keep periodic asset refreshes in the same phase on both browsers.
        // Release the real requests below to compare their effect on undo.
        if (
          plan.switchModel &&
          url.pathname === "/api/state" &&
          ++stateReads > 2
        )
          await pendingRefresh;
        return route.continue();
      });
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (wire) => {
        const url = new URL(wire.url());
        if (!url.pathname.startsWith("/api/") || wire.method() === "GET")
          return;
        calls.push({
          method: wire.method(),
          path: url.pathname,
          workspace: wire.headers()["x-workspace-id"],
          body: wire.postDataJSON(),
        });
      });
      page.on("response", (wire) => {
        const { pathname } = new URL(wire.url());
        if (/^\/(?:api|media)\//.test(pathname)) {
          for (const [key, value] of Object.entries(provenance))
            if (wire.headers()[key] !== value)
              errors.push(`Missing ${key}: ${pathname}`);
          if (wire.status() >= 400) errors.push(`${wire.status()} ${pathname}`);
        }
      });
      const response = await page.goto(editorPath);
      assert.ok(response && response.ok(), kind);
      const html = await response.text();
      if (i) assert.match(html, /<script[^>]+src="\/_next\/static\//);
      else assert.match(html, /<script[^>]+src="\/static\/canvas\.js/);
      await expect(target(page)).toBeVisible();
      if (!i) assert.deepEqual(bundleLoads, [oracle.sha]);
    }
    try {
      const initial = sides.map(({ start }) => start.document);
      assert.deepEqual(initial[0], initial[1]);
      const snapshot = async (label: string, docs: Doc[]) => {
        const name = plan.name + "-" + label;
        await compare(sides, name, docs);
        states.push(name);
      };
      await quiet(sides, initial);
      await snapshot("opened", initial);
      const select = async (page: Page) => {
        await target(page).locator(".node-content").click();
        await expect(
          target(page).locator(".content-node.selected"),
        ).toBeVisible();
      };
      const expected = expectedConversion(initial[0], plan);
      let converted = initial;
      if (plan.switchModel) {
        await quiet(sides, initial, select);
        await snapshot("h3-selected", initial);
        converted = await autosave(
          sides,
          async (page) => {
            await button(page, "选择模型").click();
            await page
              .getByRole("option", {
                name: studio.model_catalog[portableModel].label,
                exact: true,
              })
              .click();
          },
          expected,
        );
      } else if (plan.connect) {
        converted = await autosave(sides, select, expected);
      } else if (plan.defaultToH3) {
        const defaulted = structuredClone(initial[0]);
        defaulted.nodes[0].params.model = h3Model;
        converted = await autosave(sides, select, defaulted);
      } else {
        await quiet(sides, initial, select);
      }
      await snapshot("selected", converted);
      if (plan.switchModel) {
        const staged = structuredClone(initial[0]);
        Object.assign(staged.nodes[0].params, {
          model: portableModel,
          seconds: 6,
        });
        const undo = (page: Page) => button(page, "撤销 ⌘Z").click();
        const restored = await autosave(sides, undo, staged);
        await snapshot("undo-conversion", restored);
        const original = await autosave(sides, undo, initial[0]);
        await snapshot("undo-model", original);
        converted = await autosave(
          sides,
          (page) => button(page, "重做 ⌘⇧Z").click(),
          expected,
        );
        await snapshot("redo-model", converted);
        await autosave(sides, undo, staged);
        converted = await autosave(
          sides,
          async (_page, side) => side.releaseRefresh(),
          expected,
        );
        await Promise.all(
          sides.map(({ page }) =>
            expect(button(page, "重做 ⌘⇧Z")).toBeDisabled(),
          ),
        );
        await snapshot("refresh-after-undo", converted);
      }
      for (const side of sides) {
        // A fresh direct document navigation after dropping this tab's draft/history.
        await side.page.evaluate(() => {
          localStorage.clear();
          sessionStorage.clear();
        });
        const opened = await side.page.goto(side.editorPath);
        assert.equal(opened?.status(), 200, side.editorPath);
        await expect(target(side.page)).toBeVisible();
      }
      await snapshot("reopened", converted);
      await quiet(sides, converted, select);
      await snapshot("reselected", converted);
      const wires = sides.map((side) =>
        side.calls.map(({ body, ...wire }) => {
          assert.deepEqual(wire, {
            method: "PUT",
            path: side.path + "/document",
            workspace,
          });
          return {
            ...body,
            document: normalizeDocument(body.document, side.start.document)
              .document,
          };
        }),
      );
      assert.deepEqual(wires[0], wires[1]);
      assert.equal(
        wires[0].length,
        plan.switchModel ? 6 : plan.connect || plan.defaultToH3 ? 1 : 0,
      );
      assert.deepEqual(
        sides.map(({ errors }) => errors),
        [[], []],
      );
      evidence.push({ name: plan.name, saves: wires[0].length });
    } finally {
      for (const side of sides) side.releaseRefresh();
      await Promise.all(sides.map(({ page }) => page.context().close()));
    }
  }
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(
      {
        oracle: oracle.source,
        captured: oracle.captured,
        sha256: oracle.sha,
        states,
        cases: evidence,
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS ${states.length} public canvas UI states and exact autosave/reopen through Nest`,
  );
}
