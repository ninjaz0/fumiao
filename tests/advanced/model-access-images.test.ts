import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { chatsFixture } from "../helpers/chats.js";
import { ModelAccessConnections } from "@fumiao/platform/model-access/connections.js";
import { OriginalModelAccess } from "@fumiao/original-api/model-access.js";
import { Executor } from "@fumiao/platform/executor.js";
import { one } from "@fumiao/platform/db.js";

async function fixture(
  t: test.TestContext,
  router = false,
  throughMigration?: string,
) {
  const f = await chatsFixture(throughMigration);
  t.after(f.cleanup);
  await f.db.query(
    "INSERT INTO studio_plugin_profile(mode) VALUES('compatible') ON CONFLICT DO NOTHING",
  );
  const api = new OriginalModelAccess(f.identity);
  const c = new ModelAccessConnections(f.db, f.p, async () => ({
    status: 200,
    contentType: "application/json",
    body: Buffer.from(
      JSON.stringify({
        data: [
          {
            id: "upstream-image",
            architecture: { output_modalities: ["image"] },
            supported_parameters: {
              n: { type: "range", min: 1, max: 2 },
              size: { type: "enum", values: ["768x768"] },
              input_references: { type: "range", min: 0, max: 1 },
            },
          },
        ],
      }),
    ),
  }));
  // Seed the known OpenRouter revision so this protocol test does not rely
  // on external DNS. Catalog discovery and generation both use fixture bytes.
  const conn = router
    ? { id: randomUUID() }
    : await c.create({
        base_url: "https://1.1.1.1/v1",
        api_key: "synthetic-image-key",
      });
  if (router) {
    await f.db.query(
      "INSERT INTO connections(id,name,source_kind,config,enabled) VALUES($1,'fixture','builtin',$2,true)",
      [conn.id, f.p.vault.seal({})],
    );
    await f.db.query(
      `INSERT INTO model_access_connection_revisions(id,connection_id,revision,config,credential_scope)
      VALUES(gen_random_uuid(),$1,1,$2,$3)`,
      [
        conn.id,
        f.p.vault.seal({
          base_url: "https://openrouter.ai/api/v1",
          api_key: "synthetic-image-key",
          default_video_protocol: null,
        }),
        JSON.stringify({
          endpoints: ["models", "images/models", "videos/models", "images"],
          upstream_ids: null,
        }),
      ],
    );
  }
  await c.discover(conn.id, { expected_revision: 1 });
  const draft_id = randomUUID();
  await c.saveDraft(draft_id, {
    expected_revision: 0,
    connection_id: conn.id,
    connection_revision: 1,
    upstream_id: "upstream-image",
    purpose: "image",
    price: "0.25",
  });
  const pub = await api.publish(f.admin, {
    uid: randomUUID(),
    items: [{ draft_id, draft_revision: 1, action: "create" }],
  });
  const model = pub.items[0].catalog_id;
  const request = (path: string, body?: unknown) =>
    f.request(body ? "POST" : "GET", path, body, 1);
  return { ...f, c, conn, model, request };
}

test("会员报价、受理后停线、并发重投，大图片按实际交付一张收 0.25", async (t) => {
  const f = await fixture(t);
  const body = {
    model: f.model,
    kind: "image",
    params: { n: 2, size: "768x768" },
    uid: randomUUID(),
    prompt: "例图",
  };
  const quote = await f.request("/api/estimate", body);
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  assert.equal(quote.body.max_charge, "0.5");
  const submitted = await f.request("/api/image-jobs", {
    ...body,
    price_revision: quote.body.price_revision,
  });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  const job = await one(f.db, "SELECT * FROM jobs WHERE public_id=$1", [
    submitted.body.id,
  ]);
  const bytes = await sharp(randomBytes(768 * 768 * 4), {
    raw: { width: 768, height: 768, channels: 4 },
  })
    .png()
    .toBuffer();
  assert.ok(bytes.toString("base64").length > 2490000);
  let submissions = 0;
  const runner = new Executor(f.p, async (url, init) => {
    assert.equal(url.pathname, "/v1/images/generations");
    assert.deepEqual(JSON.parse(String(init.body)), {
      model: "upstream-image",
      prompt: "例图",
      n: 2,
      size: "768x768",
    });
    submissions++;
    return {
      status: 200,
      contentType: "application/json",
      body: Buffer.from(
        JSON.stringify({
          data: [{ b64_json: bytes.toString("base64") }, { b64_json: "YQ==" }],
        }),
      ),
    };
  });
  await f.c.edit(f.conn.id, { expected_revision: 1, enabled: false });
  const replay = { ...body, price_revision: quote.body.price_revision };
  assert.deepEqual(
    (await f.request("/api/image-jobs", replay)).body,
    submitted.body,
  );
  assert.equal(
    (await f.request("/api/image-jobs", { ...replay, uid: randomUUID() }))
      .status,
    409,
  );
  assert.equal(
    (await f.request("/api/image-jobs", { ...replay, prompt: "不同输入" }))
      .status,
    409,
  );
  assert.ok((await runner.queueReady()).some((r) => r.id === job.id));
  await Promise.all([runner.execute(job.id), runner.execute(job.id)]);
  await runner.execute(job.id);
  assert.equal(submissions, 1);
  const done = await one(f.db, "SELECT * FROM jobs WHERE id=$1", [job.id]);
  assert.equal(done.state, "completed", done.error);
  assert.equal(done.result.assets.length, 1);
  assert.equal(Number(done.price), 0.5);
  const credits = await f.request("/api/credits");
  const spent = credits.body.history.filter(
    (l: any) => l.job === submitted.body.id && l.action === "spend",
  );
  assert.equal(spent.length, 1);
  assert.equal(spent[0].exact.amount, "0.25");
  assert.equal(credits.body.wallet.exact.reserved, "0");
  const settlements = await f.db.query(
    "SELECT amount FROM ledger WHERE job_id=$1 AND action='spend'",
    [job.id],
  );
  assert.deepEqual(
    settlements.rows.map((r) => Number(r.amount)),
    [0.25],
  );
  assert.equal(Number((await f.p.wallet(f.member, f.memberSpace.id)).held), 0);
});

test("媒体结算使用精确单价、验收数量和预留上限", async () => {
  const { mediaCharge } =
    await import("@fumiao/platform/model-access/media-billing.js");
  assert.deepEqual(mediaCharge("0.25", { images: 1 }, "0.5"), {
    charged: "0.25",
    waived: "0",
  });
  assert.deepEqual(mediaCharge("0.25", { images: 0 }, "0.5"), {
    charged: "0",
    waived: "0",
  });
  assert.deepEqual(mediaCharge("0.25", { milliseconds: 7800 }, "1.8"), {
    charged: "1.8",
    waived: "0.15",
  });
});

for (const router of [false, true])
  test(
    router
      ? "OpenRouter 按 input_references 传入私有图片，重启后从回执恢复"
      : "OpenAI edits 使用真实 multipart 文件，交付多张图片",
    async (t) => {
      const f = await fixture(t, router);
      const png = await sharp({
        create: { width: 50, height: 70, channels: 3, background: "#905233" },
      })
        .png()
        .toBuffer();
      const asset = await f.p.upload(
        f.member,
        f.memberSpace.id,
        png,
        "image/png",
      );
      const pub = await one(f.db, "SELECT public_id FROM assets WHERE id=$1", [
        asset.id,
      ]);
      const price_revision = Number(
        (await one(f.db, "SELECT price_revision FROM studio_policy"))
          .price_revision,
      );
      const body = {
        model: f.model,
        prompt: "变体",
        refs: [pub.public_id],
        params: { n: 2 },
        uid: randomUUID(),
        price_revision,
      };
      assert.equal(
        (await f.request("/api/image-jobs", { ...body, params: { n: 3 } }))
          .status,
        400,
      );
      assert.equal(
        (
          await f.request("/api/image-jobs", {
            ...body,
            price_revision: price_revision + 1,
          })
        ).status,
        409,
      );
      const personal = await one(
        f.db,
        "SELECT id FROM workspaces WHERE kind='personal' AND owner_id=$1",
        [f.admin.id],
      );
      const other = await f.p.upload(f.admin, personal.id, png, "image/png");
      const foreign = await one(
        f.db,
        "SELECT public_id FROM assets WHERE id=$1",
        [other.id],
      );
      assert.equal(
        (
          await f.request("/api/image-jobs", {
            ...body,
            refs: [foreign.public_id],
          })
        ).status,
        404,
      );
      const posted = await f.request("/api/image-jobs", body);
      assert.equal(posted.status, 200, JSON.stringify(posted.body));
      const job = await one(f.db, "SELECT * FROM jobs WHERE public_id=$1", [
        posted.body.id,
      ]);
      let generates = 0,
        downloads = 0;
      const runner = new Executor(f.p, async (url, init) => {
        if (init.method === "GET") {
          assert.equal(url.href, "https://1.0.0.1/image");
          assert.deepEqual(init.headers, {});
          downloads++;
          return {
            status: downloads === 1 && router ? 503 : 200,
            contentType: "image/png",
            body: png,
          };
        }
        generates++;
        if (router) {
          assert.equal(url.pathname, "/api/v1/images");
          assert.deepEqual(JSON.parse(String(init.body)).input_references, [
            {
              type: "image_url",
              image_url: {
                url: "data:image/png;base64," + png.toString("base64"),
              },
            },
          ]);
        } else {
          assert.equal(url.pathname, "/v1/images/edits");
          const form = await new Response(Buffer.from(init.body!), {
            headers: init.headers,
          }).formData();
          assert.equal(form.get("model"), "upstream-image");
          const file = form.get("image") as File;
          assert.equal(file.type, "image/png");
          assert.ok(png.equals(Buffer.from(await file.arrayBuffer())));
        }
        return {
          status: 200,
          contentType: "application/json",
          body: Buffer.from(
            JSON.stringify({
              data: [
                { url: "https://1.0.0.1/image" },
                { b64_json: png.toString("base64") },
              ],
            }),
          ),
        };
      });
      await runner.execute(job.id);
      if (router) {
        const pending = await one(f.db, "SELECT * FROM jobs WHERE id=$1", [
          job.id,
        ]);
        assert.equal(pending.state, "finalizing");
        assert.equal(
          (
            await f.db.query(
              "SELECT * FROM job_assets WHERE job_id=$1 AND role='output'",
              [job.id],
            )
          ).rows.length,
          0,
        );
        assert.ok(
          await one(
            f.db,
            "SELECT 1 FROM model_access_staging WHERE job_id=$1 AND metadata IS NOT NULL",
            [job.id],
          ),
        );
        await f.db.query(
          "UPDATE jobs SET request_retry_at=NULL,lease_token=gen_random_uuid(),lease_until=now()-interval '1 second' WHERE id=$1",
          [job.id],
        );
        await runner.recover();
        await runner.execute(job.id);
      }
      assert.equal(generates, 1);
      const done = await one(f.db, "SELECT * FROM jobs WHERE id=$1", [job.id]);
      assert.equal(done.state, "completed", done.error);
      assert.equal(done.result.assets.length, 2);
      assert.equal(
        (
          await f.db.query(
            "SELECT * FROM model_access_staging WHERE job_id=$1",
            [job.id],
          )
        ).rows.length,
        0,
      );
      const state = await f.request("/api/state");
      assert.equal(state.status, 200, JSON.stringify(state.body.detail));
      const item = state.body.jobs.find((j: any) => j.id === posted.body.id);
      assert.equal(item.results.length, 2);
      assert.equal(item.result, item.results[0]);
      assert.equal(item.model, f.model);
    },
  );

test("全损坏不产生 spend，旧回执、已终结任务不重复扣款", async (t) => {
  const f = await fixture(t);
  const body = {
    model: f.model,
    prompt: "坏图",
    params: { n: 2 },
    uid: randomUUID(),
    price_revision: (
      await one(f.db, "SELECT price_revision FROM studio_policy")
    ).price_revision,
  };
  const posted = await f.request("/api/image-jobs", body);
  const job = await one(f.db, "SELECT * FROM jobs WHERE public_id=$1", [
    posted.body.id,
  ]);
  const runner = new Executor(f.p, async () => ({
    status: 200,
    contentType: "application/json",
    body: Buffer.from(
      '{"data":[{"b64_json":"YQ=="},{"url":"file:///invalid"}]}',
    ),
  }));
  await runner.execute(job.id);
  await runner.execute(job.id);
  assert.equal(
    (await one(f.db, "SELECT state FROM jobs WHERE id=$1", [job.id])).state,
    "failed",
  );
  assert.deepEqual(
    (
      await f.db.query(
        "SELECT action FROM ledger WHERE job_id=$1 ORDER BY action",
        [job.id],
      )
    ).rows.map((r) => r.action),
    ["hold", "refund"],
  );
  assert.equal(Number((await f.p.wallet(f.member, f.memberSpace.id)).held), 0);
});

for (const bound of ["workspace", "project"])
  test(`真实画布图片与对话同时占用同一 ${bound} 额度`, async (t) => {
    const f = await fixture(t);
    const { OriginalCanvases } =
      await import("@fumiao/original-api/canvases.js");
    const canvases = new OriginalCanvases(f.p);
    const canvas = await canvases.create(f.member, { title: "会员项目" });
    await canvases.save(f.member, canvas.id, {
      title: canvas.title,
      expected_revision: 1,
      document: {
        nodes: [
          {
            id: "img",
            type: "image",
            title: "镜头",
            x: 0,
            y: 0,
            prompt: "天空",
            params: { model: f.model },
            extra_params: { n: 2 },
          },
        ],
        edges: [],
      },
    });
    const chatDraft = randomUUID();
    await f.c.saveDraft(chatDraft, {
      expected_revision: 0,
      connection_id: f.conn.id,
      connection_revision: 1,
      upstream_id: "upstream-chat",
      purpose: "chat",
      chat_prices: { input: "0", output: "250" },
    });
    const publishing = await new OriginalModelAccess(f.identity).publish(
      f.admin,
      {
        uid: randomUUID(),
        items: [{ draft_id: chatDraft, draft_revision: 1, action: "create" }],
      },
    );
    const model = publishing.items[0].catalog_id;
    const context = { project: canvas.id, expected_revision: 2 };
    const chat = await f.chats.create(f.member, { model, context });
    if (bound === "workspace")
      await f.db.query("UPDATE wallets SET balance=1 WHERE workspace_id=$1", [
        f.memberSpace.id,
      ]);
    const spec = { model, text: "图文并发", context };
    const quote = await f.chats.quote(f.member, {
      ...spec,
      cid: chat.conversation.id,
    });
    const chatBody = {
      ...spec,
      ...quote,
      uid: randomUUID(),
      expected_revision: chat.conversation.revision,
    };
    const price_revision = (
      await one(f.db, "SELECT price_revision FROM studio_policy")
    ).price_revision;
    if (bound === "project")
      await f.db.query(
        "INSERT INTO budget_policies(scope_type,scope_id,period,mode,cap_limit) VALUES('project',$1,'total','cap',$2)",
        [canvas.id, quote.max_charge],
      );
    // Two real HTTP requests use independent PG connections. Force the canvas
    // transaction to own its document when the chat asks for its context.
    let markCanvasLocked!: () => void, markChatReading!: () => void;
    const canvasLocked = new Promise<void>((resolve) => {
      markCanvasLocked = resolve;
    });
    const chatReading = new Promise<void>((resolve) => {
      markChatReading = resolve;
    });
    if (process.env.TEST_DATABASE_URL) {
      const transaction = f.db.transaction.bind(f.db);
      f.db.transaction = (fn) =>
        transaction((sql) =>
          fn({
            query: async <T extends Record<string, any>>(
              query: string,
              args?: any[],
            ) => {
              if (
                query.includes(
                  "FROM documents WHERE public_id=$1 AND kind='canvas' AND NOT deleted FOR SHARE",
                )
              ) {
                await canvasLocked;
                markChatReading();
              }
              const result = await sql.query<T>(query, args);
              if (
                query.includes(
                  "FROM documents WHERE public_id=$1 AND kind='canvas' AND NOT deleted FOR UPDATE",
                )
              ) {
                markCanvasLocked();
                await chatReading;
              }
              return result;
            },
          }),
        );
    }
    const [image, chatSend] = await Promise.all([
      f.request("/api/canvases/" + canvas.id + "/nodes/img/runs", {
        uid: randomUUID(),
        price_revision,
        expected_revision: 2,
      }),
      f.request("/api/chats/" + chat.conversation.id + "/messages", chatBody),
    ]);
    assert.equal(
      [image, chatSend].filter((r) => r.status === 200).length,
      1,
      JSON.stringify([image, chatSend]),
    );
    const denied = image.status === 200 ? chatSend : image;
    assert.ok([402, 409].includes(denied.status), JSON.stringify(denied));
    assert.match(denied.body.detail, /积分不足|余额不足|预算上限|报价已更新/);
    const { computeScopeSpend } = await import("@fumiao/platform/budgets.js");
    assert.equal(
      (await computeScopeSpend(f.db, "project", canvas.id, "total")).exact.held,
      image.status === 200 ? "0.5" : quote.max_charge,
    );
  });

test("批量预检按发布图片的同一冻结参数计价", async (t) => {
  const f = await fixture(t);
  const q = await f.request("/api/quotes/batch", {
    items: [{ kind: "image", model: f.model, count: 3, params: { n: 2 } }],
  });
  assert.equal(q.status, 200, JSON.stringify(q.body));
  assert.equal(q.body.total_credits, 1.5);
  assert.equal(q.body.items[0].unit_credits, 0.5);
});

test("私有存储已写入后进程中断，终止任务的未发布对象由恢复过程清理", async (t) => {
  const f = await fixture(t);
  const body = {
    model: f.model,
    prompt: "写后中断",
    params: {},
    uid: randomUUID(),
    price_revision: (
      await one(f.db, "SELECT price_revision FROM studio_policy")
    ).price_revision,
  };
  const posted = await f.request("/api/image-jobs", body);
  const job = await one(f.db, "SELECT * FROM jobs WHERE public_id=$1", [
    posted.body.id,
  ]);
  const png = await sharp({
    create: { width: 40, height: 44, channels: 3, background: "#115566" },
  })
    .png()
    .toBuffer();
  const runner = new Executor(f.p, async () => ({
    status: 200,
    contentType: "application/json",
    body: Buffer.from(
      JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }),
    ),
  }));
  const put = f.p.storage.put.bind(f.p.storage);
  f.p.storage.put = async (key, bytes, mime) => {
    await put(key, bytes, mime);
    throw new Error("synthetic lost storage response");
  };
  await runner.execute(job.id);
  const staged = await one(
    f.db,
    "SELECT * FROM model_access_staging WHERE job_id=$1",
    [job.id],
  );
  assert.ok(staged && !staged.metadata);
  assert.equal((await f.p.storage.stat(staged.object_key)).size, png.length);
  await f.db.transaction(async (sql) => {
    const locked = await one(sql, "SELECT * FROM jobs WHERE id=$1 FOR UPDATE", [
      job.id,
    ]);
    await f.p.settle(sql, locked, "failed", undefined, "已终止");
  });
  await runner.recover();
  assert.equal(
    await one(f.db, "SELECT * FROM model_access_staging WHERE job_id=$1", [
      job.id,
    ]),
    undefined,
  );
  await assert.rejects(f.p.storage.stat(staged.object_key));
  assert.deepEqual(
    (
      await f.db.query(
        "SELECT * FROM job_assets WHERE job_id=$1 AND role='output'",
        [job.id],
      )
    ).rows,
    [],
  );
});

test("删除已交付作品时存储短断，重启后清除每一个待删对象", async (t) => {
  const f = await fixture(t);
  const body = {
    model: f.model,
    prompt: "删除两张",
    params: { n: 2 },
    uid: randomUUID(),
    price_revision: (
      await one(f.db, "SELECT price_revision FROM studio_policy")
    ).price_revision,
  };
  const accepted = await f.request("/api/image-jobs", body);
  const job = await one(f.db, "SELECT id FROM jobs WHERE public_id=$1", [
    accepted.body.id,
  ]);
  const png = await sharp({
    create: { width: 44, height: 44, channels: 3, background: "#112255" },
  })
    .png()
    .toBuffer();
  const runner = new Executor(f.p, async () => ({
    status: 200,
    contentType: "application/json",
    body: Buffer.from(
      JSON.stringify({
        data: [
          { b64_json: png.toString("base64") },
          { b64_json: png.toString("base64") },
        ],
      }),
    ),
  }));
  await runner.execute(job.id);
  const out = (
    await f.db.query(
      "SELECT object_key FROM assets a JOIN job_assets r ON a.id=r.asset_id WHERE r.job_id=$1 AND r.role='output'",
      [job.id],
    )
  ).rows;
  assert.equal(out.length, 2);
  const remove = f.p.storage.remove.bind(f.p.storage);
  f.p.storage.remove = async () => {
    throw new Error("synthetic unavailable");
  };
  const { OriginalJobs } = await import("@fumiao/original-api/jobs.js");
  assert.deepEqual(
    await new OriginalJobs(f.p).remove(f.member, accepted.body.id),
    { ok: true },
  );
  const replay = await f.request("/api/image-jobs", body);
  assert.equal(replay.status, 409, JSON.stringify(replay.body));
  assert.equal(
    (
      await f.db.query("SELECT id FROM jobs WHERE studio_client_uid=$1", [
        body.uid,
      ])
    ).rows.length,
    1,
  );
  f.p.storage.remove = remove;
  await runner.recover();
  for (const a of out) await assert.rejects(f.p.storage.stat(a.object_key));
});

async function imageJob(f: Awaited<ReturnType<typeof fixture>>, count = 1) {
  const response = await f.request("/api/image-jobs", {
    model: f.model,
    prompt: "生成",
    uid: randomUUID(),
    params: { n: count },
    price_revision: (
      await one(f.db, "SELECT price_revision FROM studio_policy")
    ).price_revision,
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return one(f.db, "SELECT * FROM jobs WHERE public_id=$1", [response.body.id]);
}

for (const restart of [false, true])
  test(`上游接单后${restart ? "进程重启" : "响应中断"}保留人工核查与唯一预留`, async (t) => {
    const f = await fixture(t);
    const job = await imageJob(f);
    let posts = 0;
    const runner = new Executor(f.p, async () => {
      posts++;
      if (restart) {
        await f.db.query(
          "UPDATE jobs SET lease_until=now()-interval '1 hour' WHERE id=$1",
          [job.id],
        );
        await runner.recover();
        throw new Error("process lost");
      }
      return {
        status: 200,
        contentType: "application/json",
        body: new ReadableStream({
          pull(controller) {
            controller.error(new Error("connection reset"));
          },
        }),
      };
    });
    await runner.execute(job.id);
    await runner.execute(job.id);
    const row = await one(
      f.db,
      "SELECT state,request_uncertain FROM jobs WHERE id=$1",
      [job.id],
    );
    assert.deepEqual(row, { state: "uncertain", request_uncertain: true });
    assert.equal(
      Number((await f.p.wallet(f.member, f.memberSpace.id)).held),
      0.25,
    );
    const { OriginalObservability } =
      await import("@fumiao/original-api/admin-observability.js");
    const ops = new OriginalObservability(f.p);
    const listed = (await ops.uncertainJobs(f.admin)).jobs.find(
      (row) => row.id === job.id,
    );
    assert.ok(listed);
    assert.equal(listed.plugin_id, "");
    assert.equal(listed.price, 0.25);
    await assert.rejects(
      ops.reconcileJob(f.admin, job.id, {
        action: "resume",
        reason: "synthetic verify",
        remoteId: "unused",
      }),
      { status: 400 },
    );
    await ops.reconcileJob(f.admin, job.id, {
      action: "refund",
      reason: "synthetic verified refund",
    });
    await assert.rejects(
      ops.reconcileJob(f.admin, job.id, {
        action: "refund",
        reason: "repeated reason",
      }),
      { status: 409 },
    );
    assert.equal(posts, 1);
    assert.equal(
      Number((await f.p.wallet(f.member, f.memberSpace.id)).held),
      0,
    );
  });

async function samplePng() {
  return sharp({
    create: { width: 48, height: 48, channels: 3, background: "#776633" },
  })
    .png()
    .toBuffer();
}
function imageResponse(png: Buffer) {
  const item = { b64_json: png.toString("base64") };
  return {
    status: 200,
    contentType: "application/json",
    body: Buffer.from(JSON.stringify({ data: [item, item] })),
  };
}

test("累计暂存字节受工作区配额限制，公布可交付子集并结算一次", async (t) => {
  const f = await fixture(t);
  const job = await imageJob(f, 2),
    png = await samplePng();
  await f.db.query(
    "UPDATE workspaces SET storage_limit=storage_used+$2 WHERE id=$1",
    [job.workspace_id, png.length],
  );
  const runner = new Executor(f.p, async () => imageResponse(png));
  await runner.execute(job.id);
  await runner.execute(job.id);
  assert.deepEqual(
    await one(
      f.db,
      "SELECT state,json_array_length(result->'assets') n FROM jobs WHERE id=$1",
      [job.id],
    ),
    { state: "completed", n: 1 },
  );
  assert.equal(
    Number(
      (
        await one(
          f.db,
          "SELECT amount FROM ledger WHERE job_id=$1 AND action='spend'",
          [job.id],
        )
      ).amount,
    ),
    0.25,
  );
  await runner.recover();
  assert.equal(
    await one(f.db, "SELECT 1 FROM model_access_staging WHERE job_id=$1", [
      job.id,
    ]),
    undefined,
  );
});

test("工作台、画布与素材库按已交付顺序选择第一张", async (t) => {
  const f = await fixture(t);
  const job = await imageJob(f, 2),
    png = await samplePng();
  const runner = new Executor(f.p, async () => imageResponse(png));
  await runner.execute(job.id);
  const ids = (await one(f.db, "SELECT result FROM jobs WHERE id=$1", [job.id]))
    .result.assets;
  const first = "f".repeat(32),
    second = "0".repeat(32);
  await f.db.query(
    "UPDATE assets SET public_id=CASE WHEN id=$1 THEN $3 ELSE $4 END WHERE id IN ($1,$2)",
    [...ids, first, second],
  );
  const { OriginalCanvases } = await import("@fumiao/original-api/canvases.js");
  const canvases = new OriginalCanvases(f.p);
  const canvas = await canvases.create(f.member, { title: "交付顺序" });
  const project = await one(
    f.db,
    "SELECT id FROM documents WHERE public_id=$1",
    [canvas.id],
  );
  await f.db.query(
    "INSERT INTO canvas_job_links(project_id,node,job_id,owner_id,uid,inputs,created) VALUES($1,'img',$2,$3,gen_random_uuid(),'{}',0)",
    [project.id, job.id, job.owner_id],
  );
  const node = {
    id: "img",
    use_media: false,
    active_job: null,
    media_id: null,
  } as Parameters<typeof canvases.mediaForNode>[2];
  assert.equal(await canvases.mediaForNode(f.db, project.id, node), first);
  const { OriginalLibrary } = await import("@fumiao/original-api/library.js");
  assert.equal(
    (await new OriginalLibrary(f.p).result(f.db, job)).public_id,
    first,
  );
  const state = await f.request("/api/state");
  assert.deepEqual(
    state.body.jobs.find((j: any) => j.id === Number(job.public_id)).results,
    [first, second],
  );
});

for (const quota of ["both", "stage", "commit"])
  test(
    `分块回执内两张 34 MiB 图片，全局配额 ${quota}`,
    { skip: !process.env.TEST_DATABASE_URL },
    async (t) => {
      const f = await fixture(t);
      const job = await imageJob(f, 2);
      const png = await sharp(randomBytes(3500 * 2560 * 4), {
        raw: { width: 3500, height: 2560, channels: 4 },
      })
        .png({ compressionLevel: 0 })
        .toBuffer();
      assert.ok(png.length > 34 * 1024 * 1024);
      const encoded = png.toString("base64");
      function* body() {
        yield '{"data":[';
        for (let i = 0; i < 2; i++) {
          yield (i ? "," : "") + '{"b64_json":"';
          for (let j = 0; j < encoded.length; j += 65536)
            yield encoded.slice(j, j + 65536);
          yield '"}';
        }
        yield "]}";
      }
      // Simulate a quota change from another connection after the assets and
      // wallet were updated, immediately before PG checks its deferred trigger.
      let deferredConflicts = 0,
        reduced = false;
      const restrict = () =>
        f.db.query(
          "UPDATE storage_capacity SET quota=used+reserved WHERE singleton",
        );
      if (quota === "stage") await restrict();
      if (quota === "commit") {
        const transaction = f.db.transaction.bind(f.db);
        f.db.transaction = async (fn) => {
          try {
            return await transaction(async (sql) => {
              const result = await fn(sql);
              if (
                !reduced &&
                (await one(sql, "SELECT state FROM jobs WHERE id=$1", [job.id]))
                  .state === "completed"
              ) {
                reduced = true;
                await restrict();
              }
              return result;
            });
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "P1002")
              deferredConflicts++;
            throw error;
          }
        };
      }
      let writes = 0,
        receiptBytes = 0;
      const put = f.p.storage.put.bind(f.p.storage);
      f.p.storage.put = async (key, bytes, mime) => {
        if (!writes)
          receiptBytes = (
            await one(
              f.db,
              "SELECT pg_column_size(receipt) bytes FROM jobs WHERE id=$1",
              [job.id],
            )
          ).bytes;
        writes++;
        await put(key, bytes, mime);
      };
      const parts = body();
      let posts = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          const part = parts.next();
          if (part.done) controller.close();
          else controller.enqueue(Buffer.from(part.value));
        },
      });
      const runner = new Executor(f.p, async () => {
        posts++;
        return {
          status: 200,
          contentType: "application/json",
          body: stream,
        };
      });
      await runner.execute(job.id);
      const done = await one(
        f.db,
        "SELECT state,result,pg_column_size(receipt) bytes FROM jobs WHERE id=$1",
        [job.id],
      );
      assert.equal(done.state, "completed", JSON.stringify(done));
      const delivered = quota === "both" ? 2 : 1;
      assert.equal(done.result.assets.length, delivered);
      assert.equal(deferredConflicts, quota === "commit" ? 1 : 0);
      assert.equal(writes, quota === "stage" ? 1 : 2);
      assert.equal(posts, 1);
      assert.equal(
        Number(
          (
            await one(
              f.db,
              "SELECT amount FROM ledger WHERE job_id=$1 AND action='spend'",
              [job.id],
            )
          ).amount,
        ),
        0.25 * delivered,
      );
      assert.equal(
        Number((await f.p.wallet(f.member, job.workspace_id)).held),
        0,
      );
      const leftovers = (
        await f.db.query(
          "SELECT object_key FROM model_access_staging WHERE job_id=$1 AND metadata IS NOT NULL",
          [job.id],
        )
      ).rows;
      assert.equal(leftovers.length, quota === "commit" ? 1 : 0);
      await runner.recover();
      for (const obj of leftovers)
        await assert.rejects(f.p.storage.stat(obj.object_key));
      assert.equal(
        await one(
          f.db,
          "SELECT 1 FROM model_access_image_parts WHERE job_id=$1",
          [job.id],
        ),
        undefined,
      );
      assert.ok(receiptBytes > 0 && receiptBytes < 4096);
      assert.equal(done.bytes, null);
    },
  );

test("发送前中断、明确拒绝和完整无效回执均释放预留", async (t) => {
  const f = await fixture(t);
  for (const scenario of ["before-send", "rejected", "invalid"]) {
    const job = await imageJob(f);
    let posts = 0;
    const runner = new Executor(f.p, async () => {
      posts++;
      return {
        status: scenario === "rejected" ? 400 : 200,
        contentType: "application/json",
        body: Buffer.from('{"data":oops}'),
      };
    });
    if (scenario === "before-send") {
      assert.ok(await runner.claim(job.id));
      await f.db.query(
        "UPDATE jobs SET lease_until=now()-interval '1 hour' WHERE id=$1",
        [job.id],
      );
      await runner.recover();
    } else await runner.execute(job.id);
    const row = await one(
      f.db,
      "SELECT state,request_uncertain FROM jobs WHERE id=$1",
      [job.id],
    );
    assert.deepEqual(row, { state: "failed", request_uncertain: false });
    assert.equal(posts, scenario === "before-send" ? 0 : 1);
    assert.equal(
      Number((await f.p.wallet(f.member, job.workspace_id)).held),
      0,
    );
  }
});

test("060 在途图片升级后保留旧回执、发送不明的预留及永久 UID", async (t) => {
  const f = await fixture(t, false, "060_model_access_jobs.sql");
  const { resolvePublishedRoute } =
    await import("@fumiao/platform/model-access/publication.js");
  const { acceptTask } = await import("@fumiao/platform/accept.js");
  const { migrate } = await import("@fumiao/platform/db.js");
  const route = await resolvePublishedRoute(f.db, f.model);
  assert.ok(route);
  const png = await samplePng();
  const seed = async (hasReceipt: boolean) =>
    f.db.transaction(async (sql) => {
      const accepted = await acceptTask(
        f.p,
        sql,
        f.member,
        f.memberSpace.id,
        {
          id: route.modelId,
          connection_id: route.connectionId,
          catalog_id: route.catalogId,
          provider_model: route.upstreamId,
          kind: "image",
        },
        { key: randomUUID(), prompt: "旧单", params: { n: 1 }, references: [] },
        "old-request",
        { amount: "0.25", key: null, revision: 1 },
        [],
        {},
        route,
      );
      const uid = randomUUID();
      await sql.query(
        `UPDATE jobs SET original_uid=$2,state=$3,lease_until=now()-interval '1 second',
      lease_token=gen_random_uuid(),receipt=$4 WHERE id=$1`,
        [
          accepted.id,
          uid,
          hasReceipt ? "finalizing" : "dispatching",
          hasReceipt
            ? JSON.stringify({ outputs: [{ b64: png.toString("base64") }] })
            : null,
        ],
      );
      return { id: accepted.id, uid };
    });
  const saved = await seed(true),
    uncertain = await seed(false);
  await migrate(f.db);
  assert.equal(
    (
      await one(f.db, "SELECT job_id FROM model_access_job_uids WHERE uid=$1", [
        saved.uid,
      ])
    ).job_id,
    saved.id,
  );
  let posts = 0;
  const runner = new Executor(f.p, async () => {
    posts++;
    throw new Error("no generation required");
  });
  await runner.recover();
  await runner.execute(saved.id);
  assert.equal(posts, 0);
  assert.equal(
    (await one(f.db, "SELECT state FROM jobs WHERE id=$1", [uncertain.id]))
      .state,
    "uncertain",
  );
  assert.equal(
    (await one(f.db, "SELECT state FROM jobs WHERE id=$1", [saved.id])).state,
    "completed",
  );
  assert.equal(
    Number((await f.p.wallet(f.member, f.memberSpace.id)).held),
    0.25,
  );
});

test("受理后全局配额低于原 64 MiB 预留时只交付剩余空间可放下的一张", async (t) => {
  const f = await fixture(t),
    job = await imageJob(f, 2),
    png = await samplePng();
  await f.db.query(
    "UPDATE storage_capacity SET quota=used+$1 WHERE singleton",
    [png.length],
  );
  const runner = new Executor(f.p, async () => imageResponse(png));
  await runner.execute(job.id);
  const done = await one(f.db, "SELECT state,result FROM jobs WHERE id=$1", [
    job.id,
  ]);
  assert.equal(done.state, "completed");
  assert.equal(done.result.assets.length, 1);
});

test(
  "工作区在发布中降低配额后，跳过过大的首图并交付较小的第二张",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const f = await fixture(t),
      job = await imageJob(f, 2),
      small = await samplePng();
    const large = await sharp(randomBytes(128 * 128 * 3), {
      raw: { width: 128, height: 128, channels: 3 },
    })
      .png()
      .toBuffer();
    assert.ok(large.length > small.length);
    let shrunk = false;
    const transaction = f.db.transaction.bind(f.db);
    f.db.transaction = (fn) =>
      transaction((sql) => {
        let publishing = false;
        return fn({
          query: async <T extends Record<string, any>>(
            query: string,
            params?: any[],
          ) => {
            const result = await sql.query<T>(query, params);
            if (
              query.includes("FROM model_access_staging") &&
              query.includes("ORDER BY output_index")
            )
              publishing = true;
            if (
              publishing &&
              !shrunk &&
              query.includes("w.storage_limit-w.storage_used")
            ) {
              shrunk = true;
              await f.db.query(
                "UPDATE workspaces SET storage_limit=storage_used+$2 WHERE id=$1",
                [job.workspace_id, small.length],
              );
            }
            return result;
          },
        });
      });
    const runner = new Executor(f.p, async () => ({
      status: 200,
      contentType: "application/json",
      body: Buffer.from(
        JSON.stringify({
          data: [large, small].map((bytes) => ({
            b64_json: bytes.toString("base64"),
          })),
        }),
      ),
    }));
    await runner.execute(job.id);
    assert.ok(shrunk);
    const done = await one(f.db, "SELECT state,result FROM jobs WHERE id=$1", [
      job.id,
    ]);
    assert.equal(done.state, "completed");
    assert.equal(done.result.assets.length, 1);
    assert.equal(
      (
        await one(f.db, "SELECT metadata FROM assets WHERE id=$1", [
          done.result.assets[0],
        ])
      ).metadata.outputIndex,
      1,
    );
  },
);

for (const scenario of [
  "202 empty",
  "202 pending",
  "200 premature FIN",
  "202 terminal image",
  "200 corrupt image",
  "200 malformed JSON",
]) {
  test(`同步图片接单回执 ${scenario}`, async (t) => {
    const f = await fixture(t),
      job = await imageJob(f);
    const png = await samplePng();
    const valid = { b64_json: png.toString("base64") };
    const bodies: Record<string, string> = {
      "202 empty": "",
      "202 pending": JSON.stringify({
        status: "pending",
        id: "pending-opaque-id",
      }),
      "200 premature FIN":
        '{"data":[' + JSON.stringify(valid) + ',{"b64_json":"YQ',
      "202 terminal image": JSON.stringify({ data: [valid] }),
      "200 corrupt image": JSON.stringify({ data: [{ b64_json: "YQ==" }] }),
      "200 malformed JSON": '{"data":oops}',
    };
    let posts = 0;
    const { createServer } = await import("node:net");
    // HTTP/1.0 without Content-Length or Transfer-Encoding: FIN delimits the
    // body successfully at the HTTP layer, even for a truncated JSON string.
    const server = createServer((socket) =>
      socket.once("data", () => {
        posts++;
        socket.end(
          "HTTP/1.0 " +
            scenario.slice(0, 3) +
            " result\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n" +
            bodies[scenario],
        );
      }),
    );
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    t.after(
      () =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    );
    const { port } = server.address() as import("node:net").AddressInfo;
    const runner = new Executor(f.p, async () => {
      const res = await fetch(`http://127.0.0.1:${port}/synthetic`, {
        method: "POST",
      });
      return {
        status: res.status,
        body: res.body!,
        contentType: "application/json",
      };
    });
    await runner.execute(job.id);
    await runner.recover();
    await runner.execute(job.id);
    const expected = ["202 empty", "202 pending", "200 premature FIN"].includes(
      scenario,
    )
      ? "uncertain"
      : scenario === "202 terminal image"
        ? "completed"
        : "failed";
    const row = await one(
      f.db,
      "SELECT state,request_uncertain FROM jobs WHERE id=$1",
      [job.id],
    );
    assert.deepEqual(row, {
      state: expected,
      request_uncertain: expected === "uncertain",
    });
    assert.equal(posts, 1);
    assert.equal(
      Number((await f.p.wallet(f.member, job.workspace_id)).held),
      expected === "uncertain" ? 0.25 : 0,
    );
    const actions = (
      await f.db.query(
        "SELECT action FROM ledger WHERE job_id=$1 ORDER BY action",
        [job.id],
      )
    ).rows.map((r) => r.action);
    assert.deepEqual(
      actions,
      expected === "uncertain"
        ? ["hold"]
        : expected === "completed"
          ? ["hold", "spend"]
          : ["hold", "refund"],
    );
  });
}
