import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { chromium, expect } from "@playwright/test";
import { build } from "esbuild";
import sharp from "sharp";
import { OriginalModelAccess } from "@fumiao/original-api/model-access.js";
import { one } from "@fumiao/platform/db.js";
import { Executor } from "@fumiao/platform/executor.js";
import { ModelAccessConnections } from "@fumiao/platform/model-access/connections.js";
import { chatsFixture } from "../helpers/chats.js";

test("成员从已交付的 MIME 格式图片重新编辑、确认再次生成与查看原回执", async (t) => {
  const f = await chatsFixture();
  t.after(f.cleanup);
  await f.db.query(
    "INSERT INTO studio_plugin_profile(mode) VALUES('compatible') ON CONFLICT DO NOTHING",
  );
  let formats = ["webp", "image/jpeg"];
  const service = new ModelAccessConnections(f.db, f.p, async () => ({
    status: 200,
    contentType: "application/json",
    body: Buffer.from(
      JSON.stringify({
        data: [
          {
            id: "photo",
            output_modalities: ["image"],
            supported_parameters: {
              output_format: { type: "enum", values: formats, default: "webp" },
            },
          },
        ],
      }),
    ),
  }));
  const conn = await service.create({
    base_url: "https://1.1.1.1/v1",
    api_key: "synthetic-photo",
  });
  const draft = randomUUID();
  const publish = async (revision: number, model?: string) => {
    await service.discover(conn.id, { expected_revision: 1 });
    await service.saveDraft(draft, {
      expected_revision: revision,
      connection_id: conn.id,
      connection_revision: 1,
      upstream_id: "photo",
      purpose: "image",
      price: "0.25",
    });
    return new OriginalModelAccess(f.identity).publish(f.admin, {
      uid: randomUUID(),
      items: [
        {
          draft_id: draft,
          draft_revision: revision + 1,
          ...(model
            ? { action: "activate", catalog_id: model, expected_revision: 1 }
            : { action: "create" }),
        },
      ],
    });
  };
  const model = (await publish(0)).items[0].catalog_id;
  const member = (path: string, body?: unknown) =>
    f.request(body ? "POST" : "GET", path, body, 1);
  const input = {
    model,
    kind: "image",
    prompt: "旧照片",
    params: { output_format: "jpeg" },
  };
  const quote = (await member("/api/estimate", input)).body;
  assert.equal(quote.max_charge, "0.25");
  const order = {
    ...input,
    uid: randomUUID(),
    price_revision: quote.price_revision,
    route_revision: quote.route_revision,
    price_revision_id: quote.price_revision_id,
    max_charge: quote.max_charge,
  };
  const accepted = await member("/api/image-jobs", order);
  assert.equal(accepted.status, 200);
  const originalId = accepted.body.id;
  const job = (id: number) =>
    one(
      f.db,
      "SELECT id,input,original_view,native_snapshot,price,request_hash,result FROM jobs WHERE public_id=$1",
      [id],
    );
  const jpeg = await sharp({
    create: { width: 48, height: 48, channels: 3, background: "#887755" },
  })
    .jpeg()
    .toBuffer();
  const wire: string[] = [];
  const worker = new Executor(f.p, async (_url, init) => {
    wire.push(JSON.parse(String(init.body)).output_format);
    return {
      status: wire.at(-1) === "image/jpeg" ? 200 : 400,
      contentType: "application/json",
      body: Buffer.from(
        JSON.stringify({ data: [{ b64_json: jpeg.toString("base64") }] }),
      ),
    };
  });
  await worker.execute((await job(originalId)).id);
  const original = await job(originalId);
  assert.equal(original.input.params.output_format, "image/jpeg");
  assert.equal(original.original_view.params.output_format, "image/jpeg");
  const state = (await member("/api/state")).body;
  const history = state.jobs.find((j: { id: number }) => j.id === originalId);
  assert.equal(history.params.output_format, "image/jpeg");
  assert.equal(history.result_mime, "image/jpeg");
  const credits = async () => (await member("/api/credits")).body;
  const opening = await credits();
  const receipts = (credits: typeof opening, id: number) =>
    credits.history.filter(
      (r: { job: number; action: string }) =>
        r.job === id && r.action === "spend",
    );
  assert.equal(receipts(opening, originalId)[0].exact.amount, "0.25");

  const bundle = await build({
    stdin: {
      loader: "tsx",
      resolveDir: join(process.cwd(), "apps/web"),
      contents: `
      import { createRoot } from "react-dom/client";
      import Studio from "./studio/Studio";
      createRoot(document.getElementById("root")).render(<Studio loadingLogo="" />);`,
    },
    bundle: true,
    write: false,
    jsx: "automatic",
    outdir: "browser",
    external: ["/static/*"],
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const css = await readFile("baseline/production/static/studio.css", "utf8");
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  });
  await page
    .context()
    .addCookies([{ name: "fm_session", value: f.tokens[1], url: f.url }]);
  await page.route("**/studio", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<meta charset="utf-8"><style>${css}${bundle.outputFiles.find((o) => o.path.endsWith(".css"))!.text}</style><div id="root"></div><script src="/history-test.js"></script>`,
    }),
  );
  await page.route("**/history-test.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: bundle.outputFiles.find((o) => o.path.endsWith(".js"))!.text,
    }),
  );
  // The member uses the fixture's browser origin while Nest listens on an ephemeral port.
  await page.route("**/api/**", async (route) => {
    const response = await route.fetch({
      headers: {
        ...route.request().headers(),
        origin: "http://localhost:3000",
      },
    });
    await route.fulfill({ response });
  });
  const detail = async (id: number) => {
    await page.goto(f.url + "/studio");
    await page.locator(`[data-act="detail"][data-id="${id}"]`).click();
  };
  const kind = async (value: "image" | "audio") => {
    await page.locator('.composer [data-menu="creation"]').click();
    await page
      .locator(`#popover [data-act="creation"][data-value="${value}"]`)
      .click();
  };
  const imageQuote = () =>
    page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/estimate") &&
        r.request().postDataJSON().model === model,
    );
  const draftKey = `fm-draft-${state.me.id}-workspace-${state.workspace_id}`;
  const storedDraft = () =>
    page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)!), draftKey);
  await detail(originalId);
  await page.getByRole("button", { name: "重新编辑" }).click();
  const format = page.getByRole("combobox", { name: "输出格式" });
  await expect(format).toHaveValue(JSON.stringify("jpeg"));
  await expect(format.locator("option:checked")).toHaveText("jpeg");
  const edited = await storedDraft();
  await kind("audio");
  const audio = await storedDraft();
  assert.equal(audio.suspendedMediaDraft.submitId, edited.submitId);
  // Persist the format stored by a pre-upgrade Studio, taken from the member's actual job.
  await page.evaluate(
    ({ key, raw }) => {
      const saved = JSON.parse(sessionStorage.getItem(key)!);
      saved.suspendedMediaDraft.draft.params.output_format = raw;
      sessionStorage.setItem(key, JSON.stringify(saved));
    },
    { key: draftKey, raw: history.params.output_format },
  );
  await page.reload();
  const [resumed] = await Promise.all([imageQuote(), kind("image")]);
  assert.equal(resumed.request().postDataJSON().params.output_format, "jpeg");
  assert.equal((await resumed.json()).max_charge, "0.25");
  await expect(format).toHaveValue(JSON.stringify("jpeg"));
  const restored = await storedDraft();
  assert.equal(restored.parent, originalId);
  assert.equal(restored.submitId, edited.submitId);
  assert.deepEqual(restored.refs, edited.refs);
  assert.equal(restored.draft.prompt, input.prompt);
  await detail(originalId);
  const again = page.getByRole("button", { name: "再次生成" });
  const confirm = async (accept: boolean) => {
    const dialog = page.waitForEvent("dialog", { timeout: 5000 });
    const click = again.click();
    const box = await dialog.catch(async (error) => {
      throw new Error(
        "未弹出积分确认：" + (await page.locator("#toast").textContent()),
        { cause: error },
      );
    });
    assert.match(box.message(), /最高使用 0\.25 积分/);
    if (accept) await box.accept();
    else await box.dismiss();
    await click;
  };
  await confirm(false);
  assert.deepEqual(await credits(), opening);
  assert.equal((await f.db.query("SELECT id FROM jobs")).rows.length, 1);
  const repeat = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/image-jobs") && r.request().method() === "POST",
  );
  await confirm(true);
  const response = await repeat;
  assert.equal(response.status(), 200, await response.text());
  const repeatId = (await response.json()).id;
  const request = response.request().postDataJSON();
  assert.notEqual(repeatId, originalId);
  assert.notEqual(request.uid, order.uid);
  assert.equal(request.parent, originalId);
  assert.deepEqual(request.params, { output_format: "jpeg" });
  for (const key of [
    "max_charge",
    "price_revision",
    "price_revision_id",
    "route_revision",
  ])
    assert.equal(request[key], quote[key]);
  const repeated = await job(repeatId);
  // Resume the same image request after its HTTP receipt was lost in a prior session.
  await page.evaluate(
    ({ key, audio, uid }) => {
      audio.suspendedMediaDraft.submitId = uid;
      sessionStorage.setItem(key, JSON.stringify(audio));
    },
    { key: draftKey, audio, uid: request.uid },
  );
  await page.reload();
  await Promise.all([imageQuote(), kind("image")]);
  const replay = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/image-jobs") && r.request().method() === "POST",
  );
  await page.locator('.composer [data-act="submit"]').click();
  const replayed = await replay;
  assert.equal(replayed.request().postDataJSON().uid, request.uid);
  assert.deepEqual(await replayed.json(), { id: repeatId });
  assert.equal((await f.db.query("SELECT id FROM jobs")).rows.length, 2);
  await detail(repeatId);
  await page.getByRole("button", { name: "重新编辑" }).click();
  await expect(format).toHaveValue(JSON.stringify("jpeg"));
  await kind("audio");
  formats = ["webp"];
  await publish(1, model);
  await page.reload();
  const [narrowed] = await Promise.all([imageQuote(), kind("image")]);
  assert.equal(narrowed.request().postDataJSON().params.output_format, "jpeg");
  assert.equal(narrowed.status(), 400);
  await expect(format.locator("option:checked")).toHaveText("jpeg（旧参数）");
  await expect(page.locator('.composer [data-act="submit"]')).toBeDisabled();
  const [corrected] = await Promise.all([
    imageQuote(),
    format.selectOption(JSON.stringify("webp")),
  ]);
  assert.equal(corrected.status(), 200);
  assert.deepEqual(corrected.request().postDataJSON().params, {
    output_format: "webp",
  });
  await expect(page.locator('.composer [data-act="submit"]')).toBeEnabled();
  await worker.execute(repeated.id);
  await worker.execute(repeated.id);
  assert.deepEqual(wire, ["image/jpeg", "image/jpeg"]);
  const paid = await credits();
  assert.deepEqual(receipts(paid, originalId), receipts(opening, originalId));
  assert.deepEqual(
    receipts(paid, repeatId).map(
      (r: { exact: { amount: string } }) => r.exact.amount,
    ),
    ["0.25"],
  );
  assert.equal(paid.wallet.exact.reserved, "0");
  assert.deepEqual(await job(originalId), original);
  await detail(originalId);
  await again.click();
  await expect(page.locator("#toast")).toHaveText("输出格式的值无效");
  await page.getByRole("button", { name: "重新编辑" }).click();
  await expect(format.locator("option:checked")).toHaveText(
    "image/jpeg（旧参数）",
  );
  await expect(page.locator('.composer [data-act="submit"]')).toBeDisabled();
  const revision = (await member("/api/state")).body.pricing.revision;
  for (const output_format of ["gif", "svg", "jpeg"]) {
    const invalid = { ...input, params: { output_format } };
    assert.equal((await member("/api/estimate", invalid)).status, 400);
    assert.equal(
      (
        await member("/api/image-jobs", {
          ...invalid,
          uid: randomUUID(),
          price_revision: revision,
        })
      ).status,
      400,
    );
  }
  const media = await page.request.get(f.url + "/media/" + history.result);
  assert.equal(media.status(), 200);
  assert.equal(media.headers()["content-type"], "image/jpeg");
  assert.deepEqual(await media.body(), jpeg);
  assert.deepEqual(
    (await member("/api/image-jobs", order)).body,
    accepted.body,
  );
  assert.deepEqual((await member("/api/image-jobs", request)).body, {
    id: repeatId,
  });
  assert.deepEqual(await credits(), paid);
});
