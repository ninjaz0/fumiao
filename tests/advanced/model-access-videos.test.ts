import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { chatsFixture } from "../helpers/chats.js";
import { OriginalModelAccess } from "@fumiao/original-api/model-access.js";
import { ModelAccessConnections } from "@fumiao/platform/model-access/connections.js";
import { Executor } from "@fumiao/platform/executor.js";
import { one } from "@fumiao/platform/db.js";
import { DiskStorage } from "@fumiao/platform/storage.js";
import { mediaCharge } from "@fumiao/platform/model-access/media-billing.js";
import type { HttpTransport } from "@fumiao/platform/plugin-host.js";

type Protocol = "new-api-videos" | "openrouter-videos";
const origin = "https://1.1.1.1/v1";
const remote = "video_demo-1";
const polling = origin + "/videos/" + remote;
const content = polling + "/content";
const signed = "https://1.0.0.1/output?s=fixture";
const json = (body: unknown, status = 200) => ({
  status,
  contentType: "application/json",
  body: Buffer.from(JSON.stringify(body)),
});

async function video(t: test.TestContext, seconds: number) {
  const dir = await mkdtemp(join(tmpdir(), "video-fixture-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "video.mp4");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=160x96:rate=25",
    "-t",
    String(seconds),
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-bf",
    "0",
    "-movflags",
    "+faststart",
    path,
  ]);
  const packets = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "packet=pos",
        "-of",
        "json",
        path,
      ],
      { encoding: "utf8" },
    ),
  ).packets;
  const bytes = await readFile(path);
  return { bytes, truncated: bytes.subarray(0, Number(packets[97].pos)) };
}

async function fixture(
  t: test.TestContext,
  protocol: Protocol,
  through?: string,
) {
  const f = await chatsFixture(through);
  t.after(f.cleanup);
  const api = new OriginalModelAccess(f.identity);
  const c = new ModelAccessConnections(f.db, f.p);
  const publish = async (model?: string) => {
    const conn = await c.create({
      base_url: model ? "https://8.8.8.8/v1" : origin,
      api_key: model ? "alternate-key" : "synthetic-video-key",
      default_video_protocol: protocol,
    });
    const id = randomUUID();
    await c.saveDraft(id, {
      expected_revision: 0,
      connection_id: conn.id,
      connection_revision: 1,
      upstream_id: model ? "alternate" : "movie",
      purpose: "video",
      price: model ? "5" : "3",
      overrides: {
        durations: model ? [4] : [8, 30],
        frame_images: ["first_frame"],
        sizes: ["160x96"],
        resolutions: ["720p"],
        aspect_ratios: ["16:9"],
      },
    });
    const pub = await api.publish(f.admin, {
      uid: randomUUID(),
      items: [
        {
          draft_id: id,
          draft_revision: 1,
          ...(model
            ? {
                action: "activate",
                catalog_id: model,
                expected_revision: 1,
                replace_price: true,
              }
            : { action: "create" }),
        },
      ],
    });
    return { conn, model: pub.items[0].catalog_id };
  };
  const { conn, model } = await publish();
  const request = (path: string, body?: unknown) =>
    f.request(body === undefined ? "GET" : "POST", path, body, 1);
  const admit = async (
    params: Record<string, unknown> = { seconds: 8 },
    refs: string[] = [],
  ) => {
    const body = {
      model,
      kind: "video",
      params,
      refs,
      uid: randomUUID(),
      prompt: "电影",
    };
    const quote = await request("/api/estimate", body);
    assert.equal(quote.status, 200, JSON.stringify(quote.body));
    assert.equal(quote.body.max_charge, "24");
    const ordered = { ...body, price_revision: quote.body.price_revision };
    const res = await request("/api/jobs", ordered);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return {
      job: await one(f.db, "SELECT * FROM jobs WHERE public_id=$1", [
        res.body.id,
      ]),
      ordered,
    };
  };
  const wake = async (id: string, http: HttpTransport<string | Uint8Array>) => {
    await f.db.query("UPDATE jobs SET request_retry_at=NULL WHERE id=$1", [id]);
    const worker = new Executor(f.p, http);
    await worker.recover();
    await Promise.all([worker.execute(id), worker.execute(id)]);
    return one(f.db, "SELECT * FROM jobs WHERE id=$1", [id]);
  };
  const revise = async (
    base: string,
    revision: number,
    publication: number,
  ) => {
    await c.edit(conn.id, {
      expected_revision: revision,
      base_url: base,
      api_key: "fixture-key-" + revision,
    });
    const draft = (
      await one(
        f.db,
        "SELECT id FROM model_access_drafts WHERE connection_id=$1 AND upstream_id='movie'",
        [conn.id],
      )
    ).id;
    await c.saveDraft(draft, {
      expected_revision: revision,
      connection_id: conn.id,
      connection_revision: revision + 1,
      upstream_id: "movie",
      purpose: "video",
      price: "3",
      overrides: { durations: [8] },
    });
    await new OriginalModelAccess(f.identity).publish(f.admin, {
      uid: randomUUID(),
      items: [
        {
          draft_id: draft,
          draft_revision: revision + 1,
          action: "activate",
          catalog_id: model,
          expected_revision: publication,
        },
      ],
    });
  };
  return {
    ...f,
    conn,
    c,
    model,
    request,
    publish,
    revise,
    admit,
    wake,
    requestAs: f.request,
  };
}

for (const protocol of ["new-api-videos", "openrouter-videos"] as const) {
  for (const firstFrame of [false, true]) {
    test(
      protocol +
        (firstFrame ? " 首帧" : " 文生视频") +
        " 换线改价及重启仅恢复原单，按实测时长交付",
      async (t) => {
        const f = await fixture(t, protocol);
        const router = protocol === "openrouter-videos";
        const png = await sharp({
          create: { width: 16, height: 16, channels: 3, background: "#0070bb" },
        })
          .png()
          .toBuffer();
        const a = await f.p.upload(
          f.member,
          f.memberSpace.id,
          png,
          "image/png",
        );
        const ref = (
          await one(f.db, "SELECT public_id FROM assets WHERE id=$1", [a.id])
        ).public_id;
        const refs = firstFrame ? [ref] : [];
        const { job, ordered } = await f.admit(
          {
            seconds: 8,
            ...(router
              ? { resolution: "720p", aspect_ratio: "16:9" }
              : { size: "160x96" }),
          },
          refs,
        );
        const bytes = (await video(t, firstFrame ? 7.8 : 8.04)).bytes;
        const calls: string[] = [];
        let polls = 0,
          downloads = 0;
        const http: HttpTransport<string | Uint8Array> = async (url, init) => {
          calls.push(init.method + " " + url.href);
          if (init.method === "POST") {
            assert.equal(url.href, origin + "/videos");
            assert.equal(
              init.headers.Authorization,
              "Bearer synthetic-video-key",
            );
            if (router) {
              assert.equal(init.headers["Content-Type"], "application/json");
              assert.deepEqual(JSON.parse(String(init.body)), {
                model: "movie",
                prompt: "电影",
                duration: 8,
                resolution: "720p",
                aspect_ratio: "16:9",
                ...(firstFrame
                  ? {
                      frame_images: [
                        {
                          frame_type: "first_frame",
                          type: "image_url",
                          image_url: {
                            url:
                              "data:image/png;base64," + png.toString("base64"),
                          },
                        },
                      ],
                    }
                  : {}),
              });
            } else {
              const form = await new Response(Buffer.from(init.body!), {
                headers: init.headers,
              }).formData();
              assert.equal(form.get("seconds"), "8");
              assert.equal(form.get("model"), "movie");
              assert.equal(form.get("size"), "160x96");
              assert.equal(form.has("duration"), false);
              if (firstFrame) {
                const file = form.get("input_reference") as File;
                assert.equal(file.type, "image/png");
                assert.deepEqual(Buffer.from(await file.arrayBuffer()), png);
              } else assert.equal(form.has("input_reference"), false);
            }
            return json(
              {
                id: remote,
                status: "queued",
                ...(router ? { polling_url: polling } : {}),
              },
              202,
            );
          }
          if (url.href === polling) {
            assert.equal(
              init.headers.Authorization,
              "Bearer synthetic-video-key",
            );
            polls++;
            if (polls === 1) return json({}, 503);
            if (polls === 2)
              return json({
                id: remote,
                status: router ? "in_progress" : "processing",
              });
            return json({
              id: remote,
              status: router ? "completed" : "succeeded",
              ...(router
                ? firstFrame
                  ? { urls: [signed] }
                  : { unsigned_urls: [content + "?index=2"] }
                : {}),
            });
          }
          downloads++;
          if (router && firstFrame) {
            assert.equal(url.href, signed);
            assert.deepEqual(init.headers, {});
          } else {
            assert.equal(url.href, content + (router ? "?index=2" : ""));
            assert.equal(
              init.headers.Authorization,
              "Bearer synthetic-video-key",
            );
          }
          return {
            status: downloads === 1 ? 503 : 200,
            contentType: "video/mp4",
            body: bytes,
          };
        };
        const accepted = await f.wake(job.id, http);
        assert.equal(accepted.remote_id, remote);
        assert.equal(accepted.state, "running");
        await f.publish(f.model);
        await f.c.edit(f.conn.id, { expected_revision: 1, enabled: false });
        assert.equal(
          (await f.request("/api/jobs", ordered)).body.id,
          Number(job.public_id),
        );
        assert.equal((await f.request("/api/estimate", ordered)).status, 400);
        const newQuote = await f.request("/api/estimate", {
          model: f.model,
          kind: "video",
          params: { seconds: 4 },
        });
        assert.equal(newQuote.body.max_charge, "20");
        let done = accepted;
        for (let i = 0; i < 6 && done.state !== "completed"; i++)
          done = await f.wake(job.id, http);
        assert.equal(
          done.state,
          "completed",
          JSON.stringify({ calls, state: done.state, error: done.error }),
        );
        assert.equal(calls.filter((call) => call.startsWith("POST")).length, 1);
        assert.equal(polls, 3);
        assert.equal(downloads, 2);
        const asset = await one(f.db, "SELECT * FROM assets WHERE id=$1", [
          done.result.assets[0],
        ]);
        assert.equal(asset.original_kind, "video");
        assert.equal(asset.metadata.duration, firstFrame ? 7.8 : 8.04);
        assert.deepEqual(await f.p.storage.read(asset.object_key), bytes);
        const debits = await f.db.query(
          "SELECT amount FROM ledger WHERE job_id=$1 AND action='spend'",
          [job.id],
        );
        assert.deepEqual(
          debits.rows.map((r) => Number(r.amount)),
          [firstFrame ? 23.4 : 24],
        );
        assert.equal(
          Number((await f.p.wallet(f.member, f.memberSpace.id)).held),
          0,
        );
        const credits = await f.request("/api/credits");
        assert.equal(credits.body.wallet.exact.reserved, "0");
        const spent = credits.body.history.filter(
          (line: { job: number; action: string }) =>
            line.job === Number(job.public_id) && line.action === "spend",
        );
        assert.equal(spent.length, 1);
        assert.deepEqual(spent[0].media_bill, {
          milliseconds: firstFrame ? 7800 : 8040,
          unit: "3",
          reserved: "24",
          charged: firstFrame ? "23.4" : "24",
          waived: firstFrame ? "0" : "0.12",
        });
        assert.deepEqual(
          mediaCharge("3", { milliseconds: firstFrame ? 7800 : 8040 }, "24"),
          {
            charged: firstFrame ? "23.4" : "24",
            waived: firstFrame ? "0" : "0.12",
          },
        );
      },
    );
  }
}

for (const refresh of ["fresh", "repeated"]) {
  test("重启后从原视频任务刷新签名地址并有界验收 " + refresh, async (t) => {
    const f = await fixture(t, "openrouter-videos");
    const { job } = await f.admit();
    const { bytes } = await video(t, 7.8);
    const fresh = "https://1.0.0.1/renewed";
    let polls = 0,
      posts = 0,
      downloads = 0;
    const http: HttpTransport<string | Uint8Array> = async (url, init) => {
      if (init.method === "POST") {
        posts++;
        assert.equal(url.href, origin + "/videos");
        return json({ id: remote, polling_url: polling });
      }
      if (url.href === polling) {
        assert.equal(init.headers.Authorization, "Bearer synthetic-video-key");
        polls++;
        return json({
          id: remote,
          status: "completed",
          urls: [polls > 1 && refresh === "fresh" ? fresh : signed],
        });
      }
      assert.deepEqual(init.headers, {});
      assert.ok([signed, fresh].includes(url.href));
      downloads++;
      if (downloads === 1) return json({}, 503);
      return url.href === signed
        ? json({}, 403)
        : { status: 200, contentType: "video/mp4", body: bytes };
    };
    await f.wake(job.id, http);
    const persisted = await f.wake(job.id, http);
    assert.equal(persisted.receipt.signed, signed);
    await f.publish(f.model);
    await f.c.edit(f.conn.id, { expected_revision: 1, enabled: false });
    let state = await f.wake(job.id, http);
    assert.equal(state.state, "finalizing");
    assert.equal(
      Number((await f.p.wallet(f.member, f.memberSpace.id)).held),
      24,
    );
    for (let i = 0; i < 10 && state.state === "finalizing"; i++)
      state = await f.wake(job.id, http);
    await f.wake(job.id, http);
    assert.equal(posts, 1);
    assert.ok(polls >= 2 && polls <= 4, "有限次重新查询原任务");
    assert.equal(state.state, refresh === "fresh" ? "completed" : "failed");
    assert.equal(
      Number((await f.p.wallet(f.member, f.memberSpace.id)).held),
      0,
    );
    const ledger = await f.db.query(
      "SELECT action,amount::float8 AS amount FROM ledger WHERE job_id=$1 AND action IN ('spend','refund')",
      [job.id],
    );
    assert.deepEqual(
      ledger.rows,
      refresh === "fresh"
        ? [{ action: "spend", amount: 23.4 }]
        : [{ action: "refund", amount: 24 }],
    );
    if (refresh === "fresh") {
      const asset = await one(
        f.db,
        "SELECT * FROM assets WHERE id=$1 AND workspace_id=$2",
        [state.result.assets[0], f.memberSpace.id],
      );
      assert.deepEqual(await f.p.storage.read(asset.object_key), bytes);
    }
  });
}

test("视频首段可完整解码但文件截断，零交付零实扣", async (t) => {
  const f = await fixture(t, "new-api-videos");
  const { job } = await f.admit();
  const { truncated } = await video(t, 7.8);
  const http: HttpTransport<string | Uint8Array> = async (url, init) =>
    init.method === "POST"
      ? json({ id: remote })
      : url.href === polling
        ? json({ id: remote, status: "completed" })
        : { status: 200, contentType: "video/mp4", body: truncated };
  let row = job;
  for (let i = 0; i < 4 && row.state !== "failed"; i++)
    row = await f.wake(job.id, http);
  assert.equal(row.state, "failed");
  assert.equal(
    (
      await f.db.query(
        "SELECT id FROM ledger WHERE job_id=$1 AND action='spend'",
        [job.id],
      )
    ).rows.length,
    0,
  );
  assert.equal(Number((await f.p.wallet(f.member, f.memberSpace.id)).held), 0);
});

test("视频 POST 回执丢失，核查只接受原线路上的上游编号", async (t) => {
  const f = await fixture(t, "openrouter-videos");
  const { job } = await f.admit();
  let creates = 0,
    polls = 0;
  const http: HttpTransport<string | Uint8Array> = async (url, init) => {
    if (init.method === "POST") {
      creates++;
      throw new Error("connection closed after request");
    }
    polls++;
    assert.equal(url.href, polling);
    assert.equal(init.headers.Authorization, "Bearer synthetic-video-key");
    return json({ id: remote, status: "expired" });
  };
  assert.equal((await f.wake(job.id, http)).state, "uncertain");
  assert.equal(Number((await f.p.wallet(f.member, f.memberSpace.id)).held), 24);
  await f.publish(f.model);
  await f.c.edit(f.conn.id, { expected_revision: 1, enabled: false });
  const { Operations } = await import("@fumiao/platform/operations.js");
  const ops = new Operations(f.p);
  const { OriginalObservability } =
    await import("@fumiao/original-api/admin-observability.js");
  const dashboard = new OriginalObservability(f.p);
  const pending = (await dashboard.uncertainJobs(f.admin)).jobs.find(
    (j) => j.id === job.id,
  );
  assert.equal(pending?.video_route?.connection_id, job.connection_id);
  const resume = (remoteId: string) =>
    ops.resolve(f.admin, job.id, {
      action: "resume",
      reason: "已查原线路记录",
      remoteId,
    });
  await assert.rejects(resume("../wrong"), { status: 400 });
  await resume(remote);
  assert.equal((await f.wake(job.id, http)).state, "failed");
  await assert.rejects(resume(remote), { status: 409 });
  assert.deepEqual([creates, polls], [1, 1]);
  assert.equal(Number((await f.p.wallet(f.member, f.memberSpace.id)).held), 0);
});

test("OpenRouter 错误查询位置、跨任务回执和非原站内容路径均不能取片", async (t) => {
  const f = await fixture(t, "openrouter-videos");
  for (const scenario of [
    "wrong-poll",
    "wrong-id",
    "foreign-content",
    "other-content",
    "reflected-key",
  ]) {
    const { job } = await f.admit();
    const id = "demo-" + scenario;
    const expected = origin + "/videos/" + id;
    const calls: string[] = [];
    const http: HttpTransport<string | Uint8Array> = async (url, init) => {
      calls.push(url.href);
      if (init.method === "POST")
        return json({
          id,
          polling_url:
            scenario === "wrong-poll"
              ? "https://1.0.0.1/videos/" + id
              : expected,
        });
      if (url.href === expected)
        return json({
          id: scenario === "wrong-id" ? "different" : id,
          status: "completed",
          ...(scenario === "reflected-key"
            ? { urls: ["https://1.0.0.1/?k=synthetic-video-key"] }
            : {
                unsigned_urls: [
                  scenario === "foreign-content"
                    ? "https://1.0.0.1/v1/videos/" + id + "/content"
                    : origin + "/videos/different/content?index=0",
                ],
              }),
        });
      throw new Error("unexpected download");
    };
    let state = job;
    for (let i = 0; i < 3; i++) state = await f.wake(job.id, http);
    assert.equal(
      state.state,
      scenario === "wrong-poll" ? "uncertain" : "failed",
    );
    assert.ok(
      calls.every((url) => url === expected || url === origin + "/videos"),
    );
    if (state.state === "uncertain") {
      const { Operations } = await import("@fumiao/platform/operations.js");
      await new Operations(f.p).resolve(f.admin, job.id, {
        action: "refund",
        reason: "人工核查无成片",
      });
    }
  }
});

for (const legacyChild of [false, true])
  test(
    "画布原生父镜头唤醒" +
      (legacyChild ? "插件子镜头" : "已冻结首帧依赖的原生子镜头"),
    async (t) => {
      const f = await fixture(t, "openrouter-videos");
      const { OriginalCanvases } =
        await import("@fumiao/original-api/canvases.js");
      const canvases = new OriginalCanvases(f.p);
      let childModel: string;
      if (legacyChild) {
        const { activateCanvasRunPlugins } =
          await import("../helpers/canvas-runs.js");
        await activateCanvasRunPlugins(f);
        await f.db.query("UPDATE studio_prices SET amount=2");
        childModel = "MiniMax H3";
      } else {
        const id = randomUUID();
        await f.c.saveDraft(id, {
          expected_revision: 0,
          connection_id: f.conn.id,
          connection_revision: 1,
          upstream_id: "image-to-video",
          purpose: "video",
          price: "3",
          overrides: {
            durations: [8],
            frame_images: ["first_frame"],
            requires_first_frame: true,
          },
        });
        childModel = (
          await new OriginalModelAccess(f.identity).publish(f.admin, {
            uid: randomUUID(),
            items: [{ draft_id: id, draft_revision: 1, action: "create" }],
          })
        ).items[0].catalog_id;
      }
      const canvas = await canvases.create(f.member, { title: "尾帧" });
      const node = (id: string, model: string, inherited: boolean) => ({
        id,
        type: "video",
        x: inherited ? 360 : 0,
        y: 0,
        title: id,
        prompt: id,
        tail_inherited: inherited,
        params: { model, seconds: legacyChild && inherited ? 5 : 8 },
      });
      await canvases.save(f.member, canvas.id, {
        title: "尾帧",
        expected_revision: 1,
        document: {
          nodes: [
            node("parent", f.model, false),
            node("child", childModel, true),
          ],
          shots: ["parent", "child"],
          edges: [],
        },
      });
      const price_revision = (
        await one(f.db, "SELECT price_revision FROM studio_policy")
      ).price_revision;
      const order = async (id: string) => {
        const res = await f.request(
          `/api/canvases/${canvas.id}/nodes/${id}/runs`,
          { uid: randomUUID(), expected_revision: 2, price_revision },
        );
        assert.equal(res.status, 200, JSON.stringify(res.body));
        return one(f.db, "SELECT * FROM jobs WHERE public_id=$1", [
          res.body.id,
        ]);
      };
      const { OriginalBatchPrecheck } =
        await import("@fumiao/original-api/batch-precheck.js");
      const pre = await new OriginalBatchPrecheck(f.p).precheckCanvas(
        f.member,
        canvas.id,
        {
          node_ids: ["parent", "child"],
          stages: ["video"],
          expected_revision: 2,
        },
      );
      assert.ok(
        pre.items.every((item) => item.status !== "blocked"),
        JSON.stringify(pre.items),
      );
      if (!legacyChild) {
        const proposal = await f.request(
          "/api/canvases/" + canvas.id + "/proposals",
          {
            base_revision: 2,
            title: "父子镜头",
            operations: ["child", "parent"].map((id) => ({
              op: "update_node",
              id,
              patch: { prompt: "更新镜头" },
            })),
          },
        );
        assert.equal(proposal.status, 200, JSON.stringify(proposal.body));
        assert.equal(proposal.body.estimated_credits, 48);
        assert.equal(
          proposal.body.exact_estimated_credits,
          pre.summary.exact_total_credits,
        );
      }
      const singleQuote = async (refs: string[], count = 1) => (await f.request("/api/quotes/batch", {
        items: [{ kind: "video", model: childModel, params: { seconds: 8 }, count, refs, canvas_tail: { project: canvas.id, parent: "parent" } }],
      })).body.items[0];
      if (!legacyChild) assert.equal((await singleQuote([])).allowed, false, "尚无父任务");
      const parent = await order("parent");
      if (!legacyChild) {
        assert.equal((await singleQuote([])).allowed, true, "排队中父任务将提供一帧");
        assert.equal((await singleQuote(["a".repeat(32)])).allowed, false, "显式图片和未产生的尾帧是两个输入");
      }
      const child = await order("child");
      assert.ok(
        await one(
          f.db,
          "SELECT 1 FROM job_tail_chains WHERE parent_job_id=$1 AND child_job_id=$2",
          [parent.id, child.id],
        ),
      );
      const { bytes } = await video(t, 7.8);
      let childSubmissions = 0;
      const http: HttpTransport<string | Uint8Array> = async (url, init) => {
        if (init.method === "POST") {
          const body = JSON.parse(String(init.body));
          if (body.model === "image-to-video") {
            childSubmissions++;
            assert.deepEqual(Object.keys(body).sort(), [
              "duration",
              "frame_images",
              "model",
              "prompt",
            ]);
            assert.match(
              body.frame_images[0].image_url.url,
              /^data:image\/jpeg;base64,/,
            );
            return json({ id: "child", polling_url: origin + "/videos/child" });
          }
          return json({ id: remote, polling_url: polling });
        }
        if (url.href === polling)
          return json({
            id: remote,
            status: "completed",
            unsigned_urls: [content],
          });
        return { status: 200, contentType: "video/mp4", body: bytes };
      };
      await f.wake(parent.id, http);
      assert.equal((await f.wake(parent.id, http)).state, "completed");
      await new Executor(f.p, http).recover();
      const ready = await one(f.db, "SELECT * FROM jobs WHERE id=$1", [
        child.id,
      ]);
      assert.equal(ready.input.references.length, 1);
      assert.ok(
        await one(
          f.db,
          "SELECT 1 FROM job_assets WHERE asset_id=$1 AND job_id=$2 AND role='input'",
          [ready.input.references[0], child.id],
        ),
      );
      if (legacyChild) assert.ok(ready.input.params.tail_inherited_from);
      else {
        assert.equal(ready.input.tailParentJobId, parent.id);
        assert.equal((await f.wake(child.id, http)).state, "running");
        assert.equal(childSubmissions, 1);
        const asset = await one(f.db, "SELECT public_id FROM assets WHERE id=$1", [ready.input.references[0]]);
        const ref = String(asset.public_id);
        assert.equal((await singleQuote([ref], 2)).exact_credits, "48", "两组候选分别使用同一帧");
        assert.equal((await singleQuote(["a".repeat(32)])).allowed, false, "不同图片仍额外占一个输入");
        const next = node("next", childModel, true);
        const picture = {id:"picture", type:"image", x:100, y:0, media_id:ref, use_media:true};
        const extended = await canvases.save(f.member, canvas.id, {
          title: "续接首帧", expected_revision: 2,
          document: {nodes:[node("parent", f.model, false), next, picture], edges:[{id:"ref",source:"picture",target:"next"}]},
        });
        assert.ok(!extended.document.shots?.length);
        const checked = await new OriginalBatchPrecheck(f.p).precheckCanvas(f.member, canvas.id, {node_ids:["next"],stages:["video"]});
        assert.equal(checked.items[0].status, "ready", JSON.stringify(checked.items));
        const regenerateBoth = await new OriginalBatchPrecheck(f.p).precheckCanvas(f.member, canvas.id, {node_ids:["next","parent"],stages:["video"]});
        assert.equal(regenerateBoth.items.find(i => i.node_id === "next")?.status, "blocked", "父镜头重新生成时，新的待提取首帧与现有首帧不同");
        const nextOrder = await f.request(`/api/canvases/${canvas.id}/nodes/next/candidates`, {uid: randomUUID(), expected_revision:extended.revision, price_revision:checked.price_revision, route_revision:checked.items[0].route_revision, price_revision_id:checked.items[0].price_revision_id,max_charge:"24",count:1});
        assert.equal(nextOrder.status, 200, JSON.stringify(nextOrder.body));
        const orderInput = await one(f.db, "SELECT input FROM jobs WHERE public_id=$1", [nextOrder.body.ids[0]]);
        assert.deepEqual(orderInput.input.references, [ready.input.references[0]]);

      }
    },
  );

test("成员和画布视频表单标出尺寸与分辨率画幅的互斥关系，并保留已保存的冲突供修改", async (t) => {
  const f = await fixture(t, "openrouter-videos");
  await f.db.query(
    "INSERT INTO studio_plugin_profile(mode) VALUES('compatible') ON CONFLICT DO NOTHING",
  );
  const { evaluateFormConstraints, formError } =
    await import("@fumiao/plugin-sdk/model-form.js");
  const state = (await f.request("/api/state")).body;
  const form = state.model_forms[f.model];
  const dims = { seconds: 8, size: "160x96" };
  const ratio = { seconds: 8, resolution: "720p", aspect_ratio: "16:9" };
  const both = { ...ratio, ...dims };
  assert.equal(formError(form, dims), "");
  assert.equal(formError(form, ratio), "");
  assert.match(formError(form, both), /尺寸/);
  const withSize = evaluateFormConstraints(form, dims);
  assert.ok(
    withSize.fields.resolution.disabled &&
      withSize.fields.aspect_ratio.disabled,
  );
  const saved = evaluateFormConstraints(form, both);
  assert.ok(
    !saved.fields.size.disabled && !saved.fields.resolution.disabled,
    "旧值可逐个手动改回默认",
  );
  const narrowed = evaluateFormConstraints(form, {
    seconds: 8,
    size: "1920x1080",
  });
  assert.ok(narrowed.fields.resolution.disabled);
  for (const [params, status] of [
    [dims, 200],
    [ratio, 200],
    [both, 400],
  ] as const) {
    assert.equal(
      (
        await f.request("/api/estimate", {
          kind: "video",
          model: f.model,
          params,
        })
      ).status,
      status,
    );
  }
});

test("画布保留三十秒与换线前的八秒草稿，重新生成提示节点和可用时长", async (t) => {
  const f = await fixture(t, "new-api-videos");
  const { OriginalCanvases } = await import("@fumiao/original-api/canvases.js");
  const canvases = new OriginalCanvases(f.p);
  const project = await canvases.create(f.member, { title: "历史镜头" });
  const path = "/api/canvases/" + project.id;
  const nodes = [8, 30].map(seconds => ({ id: "take" + seconds, title: "镜头" + seconds, type: "video", prompt: "街景", x: 0, y: 0, params: { model: f.model, seconds } }));
  const document = { nodes, shots: nodes.map(n => n.id), edges: [] };
  await canvases.save(f.member, project.id, { title: "历史镜头", expected_revision: 1, document });
  const batch = await f.request("/api/quotes/batch", { items: [{ kind: "video", model: f.model, seconds: 30 }] });
  assert.equal(batch.body.exact_total_credits, "90", JSON.stringify(batch.body));
  assert.ok(batch.body.items[0].route_revision && batch.body.items[0].price_revision_id);
  await f.publish(f.model);
  const renewed = await canvases.save(f.member, project.id, { title: "保留时长", expected_revision: 2, document });
  assert.equal(renewed.document.nodes[0].params.seconds, 8);
  const check = await f.request(path + "/batch-precheck", { node_ids: ["take8"], stages: ["video"] });
  assert.equal(check.body.items[0].status, "blocked");
  assert.match(check.body.items[0].issues.join(" "), /镜头8.*4/);
  const run = await f.request(path + "/nodes/take8/runs", { expected_revision: 3, uid: randomUUID(), price_revision: check.body.price_revision });
  assert.equal(run.status, 400, JSON.stringify(run.body));
  assert.match(JSON.stringify(run.body), /镜头8.*4/);
  assert.equal((await one(f.db, "SELECT count(*)::int AS n FROM jobs WHERE catalog_id=$1", [f.model])).n, 0);
  nodes[0].params.seconds = 4;
  await canvases.save(f.member, project.id, { title: "改为四秒", expected_revision: 3, document });
  const selections = { node_ids: ["take8"], stages: ["video"], expected_revision: 4 };
  const fresh = (await f.request(path + "/batch-precheck", selections)).body;
  assert.equal(fresh.summary.exact_total_credits, "20");
  const approved = { ...selections, uid: randomUUID(), precheck_token: fresh.precheck_token, expected_total_credits: "20", price_revision: fresh.price_revision };
  assert.equal((await f.request(path + "/batch-runs", { ...approved, price_revision: fresh.price_revision + 1 })).status, 409);
  const admitted = await f.request(path + "/batch-runs", approved);
  assert.equal(admitted.status, 200, JSON.stringify(admitted.body));
  assert.equal(admitted.body.exact_total_credits, "20");
  assert.deepEqual((await f.request(path + "/batch-runs", approved)).body, admitted.body);

});

test("视频估价和受理使用受支持的时长与参数，默认时长重放保留请求身份", async (t) => {
  const f = await fixture(t, "new-api-videos");
  const base = {
    model: f.model,
    kind: "video",
    uid: randomUUID(),
    prompt: "原样重试",
  };
  const quote = await f.request("/api/estimate", base);
  assert.equal(quote.body.max_charge, "24");
  assert.equal(
    (await f.request("/api/estimate", { ...base, params: { seconds: 30 } }))
      .body.max_charge,
    "90",
  );
  for (const params of [
    { seconds: 121 },
    { seconds: 5 },
    { seconds: -1 },
    { seconds: null },
    { resolution: "720p" },
    { frame_images: [] },
  ]) {
    assert.equal(
      (await f.request("/api/estimate", { ...base, params })).status,
      400,
    );
    assert.equal(
      (
        await f.request("/api/jobs", {
          ...base,
          price_revision: quote.body.price_revision,
          params,
        })
      ).status,
      400,
    );
  }
  const order = { ...base, price_revision: quote.body.price_revision };
  const placed = await f.request("/api/jobs", order);
  assert.equal(placed.status, 200);
  assert.equal(
    (await f.request("/api/jobs", { ...order, seconds: 5 })).status,
    409,
  );
  assert.equal((await f.request("/api/jobs", order)).body.id, placed.body.id);
});

test("视频目录按协议裁剪分辨率、首帧及120秒实际验收边界，自动时长必须有上限", async () => {
  const { videoCapabilities, prepareVideoParameters } =
    await import("@fumiao/platform/model-access/video-parameters.js");
  const advertised = {
    durations: [4, 30, 180],
    automatic_duration: true,
    aspect_ratios: ["16:9"],
    resolutions: ["720p"],
    sizes: ["1280x720", "9999x9999"],
    frame_images: ["last_frame", "first_frame"],
  };
  const caps = videoCapabilities("new-api-videos", advertised);
  assert.deepEqual(caps.durations, [4, 30]);
  assert.deepEqual(caps.frame_images, ["first_frame"]);
  assert.deepEqual(caps.sizes, ["1280x720"]);
  assert.equal(caps.resolutions, undefined);
  assert.equal(caps.aspect_ratios, undefined);
  assert.equal(caps.automatic_duration, false);
  const route = {
    protocol: "openrouter-videos",
    capabilities: { ...advertised, duration_range: { min: 3, max: 180 } },
  };
  assert.equal(prepareVideoParameters(route, { seconds: -1 }, 1).count, 120);
  assert.throws(() => prepareVideoParameters(route, { seconds: 121 }, 0), {
    status: 400,
  });
  assert.throws(() => prepareVideoParameters(route, { seconds: 8 }, 2), {
    status: 400,
  });
  assert.throws(
    () =>
      prepareVideoParameters(
        {
          protocol: route.protocol,
          capabilities: { automatic_duration: true },
        },
        { seconds: -1 },
        0,
      ),
    { status: 409 },
  );
});

test("已部署 060 的在途单升级后，同一连接的两个上游各自使用编号 1，原站重复核对受阻", async (t) => {
  const f = await fixture(t, "new-api-videos", "060_model_access_video.sql");
  const { migrate } = await import("@fumiao/platform/db.js");
  const { Operations } = await import("@fumiao/platform/operations.js");
  const alternate = "https://8.8.8.8/v2";
  await f.db.query("UPDATE connections SET concurrency=4 WHERE id=$1", [
    f.conn.id,
  ]);
  await f.db.query("UPDATE wallets SET balance=200 WHERE workspace_id=$1", [
    f.memberSpace.id,
  ]);
  const first = (await f.admit()).job;
  const bytes = (await video(t, 7.8)).bytes;
  const calls: string[] = [];
  const http: HttpTransport<string | Uint8Array> = async (url, init) => {
    calls.push(init.method + " " + url.href);
    if (init.method === "POST") return json({ id: "1" });
    if (url.href.endsWith("/content"))
      return { status: 200, contentType: "video/mp4", body: bytes };
    return json({ id: "1", status: "completed" });
  };
  assert.equal((await f.wake(first.id, http)).state, "running");
  const finalizing = (await f.admit()).job,
    completed = (await f.admit()).job;
  let delayContent = true;
  const older =
    (id: string): HttpTransport<string | Uint8Array> =>
    async (url, init) => {
      if (init.method === "POST") return json({ id });
      if (url.pathname.endsWith("/content"))
        return {
          status: id === "2" && delayContent ? 503 : 200,
          contentType: "video/mp4",
          body: bytes,
        };
      return json({ id, status: "completed" });
    };
  for (const [row, id] of [
    [finalizing, "2"],
    [completed, "3"],
  ] as const) {
    await f.wake(row.id, older(id));
    await f.wake(row.id, older(id));
  }
  const snapshot = async () =>
    (
      await f.db.query(
        "SELECT id,state,remote_id,native_polling_url,receipt,result FROM jobs ORDER BY id",
      )
    ).rows;
  const before = await snapshot();
  assert.equal(
    before.find((row) => row.id === finalizing.id)?.state,
    "finalizing",
  );
  assert.equal(
    before.find((row) => row.id === completed.id)?.state,
    "completed",
  );
  await migrate(f.db);
  assert.deepEqual(await snapshot(), before);
  delayContent = false;
  assert.equal((await f.wake(finalizing.id, older("2"))).state, "completed");

  await f.revise(alternate, 1, 1);
  const second = (await f.admit()).job;
  assert.equal((await f.wake(second.id, http)).state, "running");
  assert.deepEqual(
    await Promise.all(
      [first, second].map(async (job) => (await f.wake(job.id, http)).state),
    ),
    ["completed", "completed"],
  );
  for (const base of [origin, alternate]) {
    assert.equal(
      calls.filter((c) => c === "POST " + base + "/videos").length,
      1,
    );
    assert.equal(
      calls.filter((c) => c === "GET " + base + "/videos/1/content").length,
      1,
    );
  }
  const spent = await f.db.query(
    "SELECT amount FROM ledger WHERE action='spend' AND job_id=ANY($1::uuid[])",
    [[first.id, second.id]],
  );
  assert.deepEqual(
    spent.rows.map((r) => Number(r.amount)),
    [23.4, 23.4],
  );
  await f.revise(alternate, 2, 2);
  const duplicate = (await f.admit()).job;
  assert.equal((await f.wake(duplicate.id, http)).state, "uncertain");
  const ops = new Operations(f.p);
  await assert.rejects(
    ops.resolve(f.admin, duplicate.id, {
      action: "resume",
      reason: "在相同来源核对",
      remoteId: "1",
    }),
    { status: 409 },
  );
  await ops.resolve(f.admin, duplicate.id, {
    action: "refund",
    reason: "重复来源没有可交付的新作品",
  });
  assert.equal(Number((await f.p.wallet(f.member, f.memberSpace.id)).held), 0);
});

test("旧 OpenRouter 核查单缺少轮询地址时仍拥有原站编号，轮换密钥和并发核对均保留该归属", async (t) => {
  const f = await fixture(t, "openrouter-videos", "060_model_access_video.sql");
  const { migrate } = await import("@fumiao/platform/db.js");
  const { Operations } = await import("@fumiao/platform/operations.js");
  const ops = new Operations(f.p);
  await f.db.query("UPDATE connections SET concurrency=6 WHERE id=$1", [
    f.conn.id,
  ]);
  await f.db.query("UPDATE wallets SET balance=200 WHERE workspace_id=$1", [
    f.memberSpace.id,
  ]);
  const id = "vendor:1",
    resource = "/videos/vendor%3A1",
    other = "https://8.8.8.8/v2";
  const { bytes } = await video(t, 7.8);
  const legacy = (await f.admit()).job;
  const calls: string[] = [];
  const http: HttpTransport<string | Uint8Array> = async (url, init) => {
    calls.push(init.method + " " + url.href);
    const base = url.origin === "https://8.8.8.8" ? other : origin;
    if (init.method === "POST") {
      const invalid = calls.length === 1;
      return json({
        id,
        polling_url: invalid ? other + resource : base + resource,
      });
    }
    assert.equal(
      init.headers.Authorization,
      base === other ? "Bearer fixture-key-2" : "Bearer synthetic-video-key",
    );
    if (url.href === base + resource)
      return json({
        id,
        status: "completed",
        unsigned_urls: [base + resource + "/content"],
      });
    assert.equal(url.href, base + resource + "/content");
    return { status: 200, contentType: "video/mp4", body: bytes };
  };
  const first = await f.wake(legacy.id, http);
  assert.equal(first.state, "uncertain");
  assert.equal(first.remote_id, id);
  // The original 060 worker retained the ID and discarded the rejected polling URL.
  await f.db.query("UPDATE jobs SET native_polling_url=NULL WHERE id=$1", [
    legacy.id,
  ]);
  await migrate(f.db);
  assert.equal(Number((await f.p.wallet(f.member, f.memberSpace.id)).held), 24);
  await f.revise(origin, 1, 1);
  const duplicate = (await f.admit()).job;
  assert.equal((await f.wake(duplicate.id, http)).state, "uncertain");
  assert.equal(Number((await f.p.wallet(f.member, f.memberSpace.id)).held), 48);
  assert.deepEqual(
    await one(f.db, "SELECT state,remote_id,receipt FROM jobs WHERE id=$1", [
      legacy.id,
    ]),
    { state: "uncertain", remote_id: id, receipt: null },
  );
  const resume = (jobId: string) =>
    ops.resolve(f.admin, jobId, {
      action: "resume",
      reason: "核对冻结线路",
      remoteId: id,
    });
  await assert.rejects(resume(duplicate.id), { status: 409 });
  await f.revise(other, 2, 2);
  const independent = (await f.admit()).job;
  assert.equal((await f.wake(independent.id, http)).state, "running");
  assert.equal((await f.wake(independent.id, http)).state, "completed");
  await f.revise(origin, 3, 3);
  const racing = (await f.admit()).job;
  const [contender] = await Promise.all([
    f.wake(racing.id, http),
    resume(legacy.id),
  ]);
  assert.equal(contender.state, "uncertain");
  await assert.rejects(resume(racing.id), { status: 409 });
  assert.equal((await f.wake(legacy.id, http)).state, "completed");
  for (const job of [racing, duplicate])
    await ops.resolve(f.admin, job.id, {
      action: "refund",
      reason: "无独立成片",
    });
  assert.equal(Number((await f.p.wallet(f.member, f.memberSpace.id)).held), 0);
  assert.deepEqual(
    (
      await f.db.query(
        "SELECT job_id,amount::float8 AS amount FROM ledger WHERE action='spend' ORDER BY job_id",
      )
    ).rows,
    [legacy, independent]
      .map((job) => ({ job_id: job.id, amount: 23.4 }))
      .sort((a, b) => a.job_id.localeCompare(b.job_id)),
  );
  assert.equal(calls.filter((c) => c.startsWith("POST ")).length, 4);
  for (const base of [origin, other])
    assert.equal(
      calls.filter((c) => c === "GET " + base + resource + "/content").length,
      1,
    );
});

test("查询正文中断可恢复，完整无效 JSON 释放预留，创建响应无效仍需人工核查", async (t) => {
  const f = await fixture(t, "new-api-videos");
  let creates = 0,
    polls = 0;
  const job = (await f.admit()).job;
  const http: HttpTransport<string | Uint8Array> = async (_url, init) => {
    if (init.method === "POST") {
      creates++;
      return json({ id: "job1" });
    }
    polls++;
    const body =
      polls === 1
        ? new ReadableStream<Uint8Array>({
            start(c) {
              c.error(new Error("transfer interrupted"));
            },
          })
        : Buffer.from("<html>maintenance</html>");
    return { status: 200, contentType: "text/html", body };
  };
  assert.equal((await f.wake(job.id, http)).state, "running");
  assert.equal((await f.wake(job.id, http)).state, "running");
  assert.equal((await f.wake(job.id, http)).state, "failed");
  assert.equal((await f.wake(job.id, http)).state, "failed");
  assert.deepEqual([creates, polls], [1, 2]);
  assert.equal(Number((await f.p.wallet(f.member, f.memberSpace.id)).held), 0);
  const lost = (await f.admit()).job;
  const bad: HttpTransport<string | Uint8Array> = async () => {
    creates++;
    return {
      status: 200,
      contentType: "text/html",
      body: Buffer.from("lost receipt"),
    };
  };
  assert.equal((await f.wake(lost.id, bad)).state, "uncertain");
  assert.equal((await f.wake(lost.id, bad)).state, "uncertain");
  assert.equal(creates, 2);
  assert.equal(Number((await f.p.wallet(f.member, f.memberSpace.id)).held), 24);
});

test("显式媒体目录离线时其他接单和写入不能建空卷，恢复后尾帧子单只结算一次", async (t) => {
  const f = await fixture(t, "new-api-videos");
  const { job: parent } = await f.admit();
  const { bytes } = await video(t, 7.8);
  let posts = 0;
  const http: HttpTransport<string | Uint8Array> = async (url, init) => {
    if (init.method === "POST") return json({ id: "movie-" + ++posts });
    if (!url.pathname.endsWith("/content"))
      return json({ id: url.pathname.split("/").pop(), status: "completed" });
    return { status: 200, contentType: "video/mp4", body: bytes };
  };
  await f.wake(parent.id, http);
  assert.equal((await f.wake(parent.id, http)).state, "completed");
  const { job: child, ordered } = await f.admit();
  await f.db.query(
    "INSERT INTO job_tail_chains(parent_job_id,child_job_id) VALUES($1,$2)",
    [parent.id, child.id],
  );
  const writer = new DiskStorage(f.directory);
  const offline = f.directory + "-offline";
  const source = await one(
    f.db,
    `SELECT a.object_key FROM job_assets r JOIN assets a ON a.id=r.asset_id
    WHERE r.job_id=$1 AND r.role='output'`,
    [parent.id],
  );
  await rename(f.directory, offline);
  try {
    const coworker = await f.requestAs(
      "POST",
      "/api/jobs",
      { ...ordered, uid: randomUUID() },
      0,
    );
    assert.equal(coworker.status, 503, "离线卷上不能受理其他工作区的新订单");
    await assert.rejects(writer.availableBytes(), { status: 503 });
    await assert.rejects(writer.put("other", Buffer.from("other")));
    await assert.rejects(
      new DiskStorage(f.directory).putFile(
        "other-file",
        join(offline, source.object_key),
        "video/mp4",
      ),
    );
    await assert.rejects(stat(f.directory), { code: "ENOENT" });
    await new Executor(f.p).recover();
    const waiting = await one(
      f.db,
      "SELECT state,request_retry_at FROM jobs WHERE id=$1",
      [child.id],
    );
    assert.equal(waiting.state, "queued");
    assert.ok(waiting.request_retry_at);
    assert.equal(
      Number((await f.p.wallet(f.member, f.memberSpace.id)).held),
      24,
    );
    assert.equal(Number((await f.p.wallet(f.admin, f.workspace.id)).held), 0);
    assert.equal((await f.db.query("SELECT id FROM jobs")).rows.length, 2);
    assert.deepEqual(
      (
        await f.db.query("SELECT action FROM ledger WHERE job_id=$1", [
          child.id,
        ])
      ).rows,
      [{ action: "hold" }],
    );
  } finally {
    // On the broken implementation an unrelated admission creates this fixture path.
    await rm(f.directory, { recursive: true, force: true });
    await rename(offline, f.directory);
  }
  assert.deepEqual(await writer.read(source.object_key), bytes);
  await f.db.query("UPDATE jobs SET request_retry_at=NULL WHERE id=$1", [
    child.id,
  ]);
  await new Executor(f.p).recover();
  assert.equal(
    (await one(f.db, "SELECT input FROM jobs WHERE id=$1", [child.id])).input
      .references.length,
    1,
  );
  assert.equal(
    (
      await f.db.query("SELECT 1 FROM job_tail_chains WHERE child_job_id=$1", [
        child.id,
      ])
    ).rows.length,
    0,
  );
  assert.equal((await f.wake(child.id, http)).state, "running");
  assert.equal((await f.wake(child.id, http)).state, "completed");
  assert.equal((await f.wake(child.id, http)).state, "completed");
  assert.equal(posts, 2);
  assert.deepEqual(
    (
      await f.db.query(
        "SELECT action,amount::float8 AS amount FROM ledger WHERE job_id=$1 ORDER BY action",
        [child.id],
      )
    ).rows,
    [
      { action: "hold", amount: 24 },
      { action: "spend", amount: 23.4 },
    ],
  );
  assert.equal(Number((await f.p.wallet(f.member, f.memberSpace.id)).held), 0);
});

test("尾帧永久缺失释放子单，超过一轮上限的暂时故障让出健康工作区", async (t) => {
  const f = await fixture(t, "new-api-videos");
  await f.db.query("UPDATE wallets SET balance=2000");
  const { bytes } = await video(t, 7.8);
  const asset = async (available: boolean, admin = false) => {
    const id = randomUUID();
    await f.db.query(
      "INSERT INTO assets(id,workspace_id,owner_id,object_key,mime,size,state,original_kind,metadata) VALUES($1::uuid,$2,$3,$4,'video/mp4',$5,'ready','video','{}')",
      [
        id,
        admin ? f.workspace.id : f.memberSpace.id,
        admin ? f.admin.id : f.member.id,
        id,
        bytes.length,
      ],
    );
    if (available) await f.p.storage.put(id, bytes, "video/mp4");
    return id;
  };
  const badStorage = await asset(true),
    goodStorage = await asset(true, true),
    missingStorage = await asset(false),
    missingKey = await asset(false);
  const createChild = async (admin: boolean) => {
    if (!admin) return (await f.admit()).job;
    const body = {
      model: f.model,
      params: { seconds: 8 },
      prompt: "另一个工作区",
      uid: randomUUID(),
      price_revision: (
        await one(f.db, "SELECT price_revision FROM studio_policy")
      ).price_revision,
    };
    const res = await f.requestAs("POST", "/api/jobs", body, 0);
    assert.equal(res.status, 200);
    return one(f.db, "SELECT * FROM jobs WHERE public_id=$1", [res.body.id]);
  };
  const children: Record<string, any>[] = [];
  for (let index = 0; index < 20; index++) {
    const child = await createChild(index === 19);
    const parentId =
      "c0000000-0000-4000-8000-" + String(index).padStart(12, "0");
    const assetId =
      index < 16
        ? badStorage
        : ([null, missingStorage, missingKey, goodStorage][index - 16] ??
          randomUUID());
    await f.db.query(
      `INSERT INTO jobs(id,workspace_id,owner_id,model_id,connection_id,provider_model,kind,
      input,idempotency_key,request_hash,price,catalog_id,price_revision,state,source_kind,route_revision_id,price_revision_id,native_snapshot,meter,result)
      SELECT $2,workspace_id,owner_id,model_id,connection_id,provider_model,kind,input,$3,request_hash,price,catalog_id,
        price_revision,'completed',source_kind,route_revision_id,price_revision_id,native_snapshot,meter,$4 FROM jobs WHERE id=$1`,
      [child.id, parentId, randomUUID(), JSON.stringify({ assets: [assetId] })],
    );
    if (index !== 16)
      await f.db.query(
        "INSERT INTO job_assets(job_id,asset_id,role) VALUES($1,$2,'output')",
        [parentId, assetId],
      );
    await f.db.query(
      "INSERT INTO job_tail_chains(parent_job_id,child_job_id) VALUES($1,$2)",
      [parentId, child.id],
    );
    children.push(child);
  }
  const read = f.p.storage.stream.bind(f.p.storage);
  let temporary = 0,
    restored = false;
  f.p.storage.stream = async (key, ...args) => {
    if (key === missingKey)
      throw Object.assign(new Error("missing object"), {
        name: "NoSuchKey",
        $metadata: { httpStatusCode: 404 },
      });
    if (key === badStorage && !restored) {
      temporary++;
      if (temporary % 3 === 0)
        throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
      throw Object.assign(new Error("storage unavailable"), {
        name: temporary % 2 === 0 ? "NoSuchBucket" : "NotFound",
        $metadata: { httpStatusCode: 404 },
      });
    }
    return read(key, ...args);
  };
  const worker = new Executor(f.p);
  await worker.recover();
  await worker.recover();
  assert.equal(temporary, 16);
  const childState = async (index: number) =>
    one(f.db, "SELECT * FROM jobs WHERE id=$1", [children[index].id]);
  for (const idx of [16, 17, 18]) {
    assert.equal((await childState(idx)).state, "failed");
    assert.equal(
      (
        await f.db.query(
          "SELECT 1 FROM ledger WHERE job_id=$1 AND action='refund'",
          [children[idx].id],
        )
      ).rows.length,
      1,
    );
  }
  assert.equal(
    Number((await f.p.wallet(f.member, f.memberSpace.id)).held),
    16 * 24,
  );
  const healthy = await childState(19);
  assert.equal(healthy.state, "queued");
  assert.equal(healthy.input.references.length, 1);
  assert.equal(
    (await f.db.query("SELECT * FROM job_tail_chains")).rows.length,
    16,
  );
  const delayed = await childState(0);
  assert.equal(delayed.state, "queued");
  assert.ok(delayed.request_retry_at);
  restored = true;
  let created = 0;
  const recovered: HttpTransport<string | Uint8Array> = async (url, init) => {
    if (init.method === "POST") {
      created++;
      return json({ id: remote });
    }
    if (url.href === polling) return json({ id: remote, status: "completed" });
    assert.equal(url.href, content);
    return { status: 200, contentType: "video/mp4", body: bytes };
  };
  assert.equal((await f.wake(delayed.id, recovered)).state, "running");
  assert.equal((await f.wake(delayed.id, recovered)).state, "completed");
  assert.equal((await f.wake(delayed.id, recovered)).state, "completed");
  assert.equal(created, 1);
  assert.deepEqual(
    (
      await f.db.query(
        "SELECT amount::float8 AS amount FROM ledger WHERE job_id=$1 AND action='spend'",
        [delayed.id],
      )
    ).rows,
    [{ amount: 23.4 }],
  );
  assert.equal(
    Number((await f.p.wallet(f.member, f.memberSpace.id)).held),
    15 * 24,
  );
});

test("共享媒体交付模块可作为独立 ESM 入口启动", () => {
  execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      'await import("@fumiao/platform/model-access/media-delivery.js")',
    ],
    { stdio: "pipe" },
  );
});
