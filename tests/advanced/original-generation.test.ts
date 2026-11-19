import { GpuGateway } from "../../packages/platform/src/gpu.js";
import { Executor } from "../../packages/platform/src/executor.js";
import { pythonStrip } from "../../packages/plugin-sdk/src/python-text.js";
import { gpuText } from "../../plugins/gpu/src/text.js";
import { museText } from "../../plugins/muse/src/text.js";
import { imagesText } from "../../plugins/images/src/text.js";
import { flowText } from "../../plugins/flow/src/text.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import { createServer } from "node:http";
import { databaseFixture } from "../helpers/database.js";
import { one, migrate } from "../../packages/platform/src/db.js";
import { OriginalIdentity } from "../../packages/original-api/src/identity.js";
import { OriginalGeneration } from "../../packages/original-api/src/generation.js";
import { OriginalJobs } from "../../packages/original-api/src/jobs.js";
import { OriginalPacks } from "../../packages/original-api/src/packs.js";
import { StudioCatalog } from "../../packages/platform/src/catalog.js";
import { PluginRegistry } from "../../packages/platform/src/plugins.js";
import { gpuOriginal } from "../../plugins/gpu/src/original.js";
import { museOriginal } from "../../plugins/muse/src/original.js";
import { imagesOriginal } from "../../plugins/images/src/original.js";
import { images } from "../../plugins/images/src/index.js";
import { flowOriginal } from "../../plugins/flow/src/original.js";
import { flow } from "../../plugins/flow/src/index.js";
import type {
  OriginalDraft,
  ProviderPlugin,
} from "../../packages/plugin-sdk/src/index.js";

async function fixture(through?: string, lossless = false) {
  const f = await databaseFixture(through),
    identity = new OriginalIdentity(f.p);
  const password = "original-generation-test-password";
  await identity.bootstrap({ name: "admin", nickname: "管理员", password });
  const actor = await identity.actor(
    await identity.login({ name: "admin", password }, "fixture"),
  );
  const plugins = (
    lossless
      ? [gpuText, museText, imagesText, flowText]
      : [gpuOriginal, museOriginal, imagesOriginal, flowOriginal]
  ).map((p) => ({ ...p, originalSubmission: { ...p.originalSubmission! } }));
  f.p.registry = new PluginRegistry(plugins);
  await f.p.registry.installBuiltins(f.db);
  const catalog = new StudioCatalog(f.db),
    connections: Record<string, string> = {};
  for (const plugin of plugins) {
    const c = await f.p.createConnection(actor, {
      name: plugin.manifest.id,
      pluginId: plugin.manifest.id,
      version: plugin.manifest.version,
      config:
        plugin.manifest.mode === "pull"
          ? {}
          : { baseUrl: "http://127.0.0.1:9", apiKey: "fixture-unused" },
    });
    connections[plugin.manifest.id] = c.id;
    await f.p.updateConnection(actor, c.id, {
      revision: 1,
      enabled: true,
      concurrency: 1,
    });
  }
  const prices = await catalog.prices();
  await f.db.transaction((sql) =>
    catalog.savePrices(
      sql,
      Object.fromEntries(prices.items.map((p) => [p.key, 2])),
      prices.revision,
    ),
  );
  const team = await one(f.db, "SELECT * FROM workspaces WHERE kind='team'");
  await f.db.transaction((sql) =>
    f.p.credit(sql, team.id, 1000, randomUUID(), "adjust"),
  );
  const generation = new OriginalGeneration(f.p),
    jobs = new OriginalJobs(f.p);
  async function submit(
    kind: OriginalDraft["kind"],
    body: Record<string, any> = {},
    workspace = String(team.public_id),
  ) {
    return generation.submit(
      actor,
      await generation.parse(kind, {
        uid: randomUUID(),
        prompt: "fixture",
        ...body,
      }),
      workspace,
    );
  }
  async function asset() {
    const png = await sharp({
      create: { width: 40, height: 60, channels: 3, background: "#3456ab" },
    })
      .png()
      .toBuffer();
    const saved = await f.p.upload(actor, team.id, png, "image/png");
    return one(f.db, "SELECT * FROM assets WHERE id=$1", [saved.id]);
  }
  return {
    ...f,
    actor,
    plugins,
    catalog,
    team,
    connections,
    generation,
    jobs,
    submit,
    asset,
  };
}

test("original submissions atomically preserve owner-global identities, billing, parent inheritance and deletion reuse", async () => {
  const f = await fixture();
  try {
    const uid = randomUUID();
    const accepted = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        f.submit("video", { uid, prompt: "revision " + i, sampling_steps: 4 }),
      ),
    );
    assert.equal(new Set(accepted.map((r) => r.id)).size, 1);
    let row = await one(f.db, "SELECT * FROM jobs WHERE public_id=$1", [
      accepted[0].id,
    ]);
    assert.equal(Number((await f.p.wallet(f.actor, f.team.id)).held), 2);
    assert.equal((await f.db.query("SELECT * FROM outbox")).rows.length, 1);
    assert.equal(
      (
        await f.db.query(
          "SELECT * FROM ledger WHERE job_id=$1 AND action='hold'",
          [row.id],
        )
      ).rows.length,
      1,
    );
    const personal = await one(
      f.db,
      "SELECT public_id FROM workspaces WHERE owner_id=$1 AND kind='personal'",
      [f.actor.id],
    );
    await assert.rejects(
      f.submit("video", { uid }, String(personal.public_id)),
      { status: 404 },
    );
    const audio = await f.submit("audio", { uid });
    assert.notEqual(audio.id, accepted[0].id);
    const child = await f.submit("video", { parent: accepted[0].id });
    assert.equal(
      (await one(f.db, "SELECT input FROM jobs WHERE public_id=$1", [child.id]))
        .input.params.sampling_steps,
      4,
    );
    await assert.rejects(f.submit("audio", { parent: accepted[0].id }), {
      status: 404,
    });
    await f.jobs.cancel(f.actor, accepted[0].id, String(f.team.public_id));
    await f.jobs.remove(f.actor, accepted[0].id, String(f.team.public_id));
    const reused = await f.submit("video", { uid });
    assert.notEqual(reused.id, accepted[0].id);
    assert.equal(
      (
        await f.db.query("SELECT * FROM jobs WHERE original_uid=$1", [
          row.original_uid,
        ])
      ).rows.length,
      2,
    );
    assert.equal(
      (
        await f.db.query(
          "SELECT * FROM ledger WHERE job_id=$1 AND action='refund'",
          [row.id],
        )
      ).rows.length,
      1,
    );
    assert.deepEqual(
      (
        await one(
          f.db,
          "SELECT submission_forecast FROM jobs WHERE public_id=$1",
          [reused.id],
        )
      ).submission_forecast,
      {
        source: "none",
        samples: 0,
        confidence: "none",
        version: 4,
        reason: "no_instance",
      },
    );
  } finally {
    await f.cleanup();
  }
});

test("original native inputs and pack snapshots use authorized assets, reject forged results and roll back failed billing", async () => {
  const f = await fixture();
  try {
    const a = await f.asset();
    const pack = await new OriginalPacks(f.p).save(
      f.actor,
      {
        name: "主角",
        purpose: "subject",
        description: "衣着",
        media: [a.public_id],
      },
      String(f.team.public_id),
    );
    const accepted = await f.submit("video", {
      asset_packs: [{ id: pack.id, revision: pack.revision }],
    });
    const row = await one(f.db, "SELECT * FROM jobs WHERE public_id=$1", [
      accepted.id,
    ]);
    assert.deepEqual(row.input.references, [a.id]);
    assert.deepEqual(row.original_view.refs, [a.public_id]);
    assert.deepEqual(row.reference_packs[0].media, [a.public_id]);
    assert.match(row.input.prompt, /<Picture 1>/);
    const native = await f.submit("video", {
      h3: { mode: "frames", first_frame: a.public_id },
      ratio: "16:9",
    });
    const frozen = await one(f.db, "SELECT * FROM jobs WHERE public_id=$1", [
      native.id,
    ]);
    assert.equal(frozen.input.params.h3_inputs.first_frame, a.id);
    assert.equal(frozen.original_view.h3_inputs.first_frame, a.public_id);
    assert.equal(frozen.input.params.ratio, "3:4");
    const before = await f.p.wallet(f.actor, f.team.id);
    const count = Number((await one(f.db, "SELECT count(*) AS n FROM jobs")).n);
    for (const body of [
      {
        h3: { mode: "frames", first_frame: a.public_id },
        asset_packs: [{ id: pack.id, revision: pack.revision }],
      },
      { h3: { mode: "reference" }, refs: [a.public_id, a.public_id] },
      { refs: [a.public_id], price_revision: 99999 },
      { parent: 99999 },
    ])
      await assert.rejects(f.submit("video", body));
    const gpu = f.plugins.find((p) => p.manifest.id === "gpu")!,
      prepare = gpu.originalSubmission!.prepare;
    gpu.originalSubmission!.prepare = async (d, r) => ({
      ...(await prepare(d, r)),
      references: [randomUUID()],
    });
    await assert.rejects(f.submit("video", { refs: [a.public_id] }), {
      status: 500,
      message: "插件原提交冻结结果无效",
    });
    assert.deepEqual(await f.p.wallet(f.actor, f.team.id), before);
    assert.equal(
      Number((await one(f.db, "SELECT count(*) AS n FROM jobs")).n),
      count,
    );
  } finally {
    await f.cleanup();
  }
});

test("original per-provider admission remains atomic across competing submissions", async () => {
  const f = await fixture();
  try {
    const outcomes = await Promise.allSettled(
      Array.from({ length: 5 }, () => f.submit("image")),
    );
    assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 3);
    for (const r of outcomes.filter(
      (r) => r.status === "rejected",
    ) as PromiseRejectedResult[]) {
      assert.equal(r.reason.status, 429);
      assert.equal(r.reason.message, "待生成图片较多，请等待当前任务完成");
    }
    assert.equal(Number((await f.p.wallet(f.actor, f.team.id)).held), 6);
    assert.equal((await f.db.query("SELECT * FROM outbox")).rows.length, 3);
    // A queued task stays held; withdrawing it opens exactly one slot.
    const first = (
      outcomes.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<{
        id: number;
      }>
    ).value;
    await f.jobs.cancel(f.actor, first.id, String(f.team.public_id));
    await f.submit("image");
    await assert.rejects(f.submit("image"), { status: 429 });
  } finally {
    await f.cleanup();
  }
});

test("original generation rejects ambiguous connections, private inputs and insufficient credits without partial acceptance", async () => {
  const f = await fixture();
  try {
    const snapshot = async () => ({
      wallet: await f.p.wallet(f.actor, f.team.id),
      jobs: (await f.db.query("SELECT * FROM jobs ORDER BY id")).rows,
      ledger: (await f.db.query("SELECT * FROM ledger ORDER BY id")).rows,
      outbox: (await f.db.query("SELECT * FROM outbox ORDER BY job_id")).rows,
      holds: (await f.db.query("SELECT * FROM storage_holds ORDER BY key"))
        .rows,
    });
    const duplicate = await f.p.createConnection(f.actor, {
      name: "second GPU",
      pluginId: "gpu",
      version: "1.6.0",
      config: {},
    });
    await f.p.updateConnection(f.actor, duplicate.id, {
      revision: 1,
      enabled: true,
      concurrency: 1,
    });
    const before = await snapshot();
    await assert.rejects(f.submit("video"), {
      status: 503,
      message: "该模型配置了多个执行连接，请指定唯一原站连接",
    });
    assert.deepEqual(await snapshot(), before);
    await f.p.updateConnection(f.actor, duplicate.id, {
      revision: 2,
      enabled: false,
      concurrency: 1,
    });
    const privateAsset = await f.asset();
    const other = await f.db.transaction((sql) =>
      f.p.createUser(sql, "other", "other", "fixture-other-password", "member"),
    );
    await f.db.query(
      "UPDATE assets SET workspace_id=$2,owner_id=$3 WHERE id=$1",
      [privateAsset.id, other.workspaceId, other.id],
    );
    await assert.rejects(
      f.submit("video", { refs: [privateAsset.public_id] }),
      { status: 404 },
    );
    assert.deepEqual(await snapshot(), before);
    await f.db.query("UPDATE wallets SET balance=1 WHERE workspace_id=$1", [
      f.team.id,
    ]);
    const poor = await snapshot();
    await assert.rejects(f.submit("video"), {
      status: 409,
      message: "当前空间积分不足，需要 2 积分",
    });
    assert.deepEqual(await snapshot(), poor);
  } finally {
    await f.cleanup();
  }
});

test("migration restores original job identity and parent fields without changing accepted Advanced input", async () => {
  const f = await fixture("015_reference_media.sql");
  try {
    const model = await one(
      f.db,
      "SELECT id FROM models WHERE connection_id=$1 AND provider_model='MiniMax H3'",
      [f.connections.gpu],
    );
    const job = await f.p.submit(f.actor, f.team.id, {
      modelId: model.id,
      key: randomUUID(),
      prompt: "history",
      params: { sampling_steps: 4 },
    });
    const saved = await one(f.db, "SELECT * FROM jobs WHERE id=$1", [job.id]);
    const uid = "1-" + randomUUID(),
      payload = {
        uid,
        parent: 17,
        ratio: "16:9",
        quality: 480,
        seconds: 5,
        seed: 42,
        width: 864,
        height: 480,
        sampling_steps: 4,
        image_quality: "medium",
        audio_settings: "{}",
        h3_inputs: "{}",
        output_metadata: '{"flow_media_id":"fixture-id"}',
        timing_forecast: '{"source":"none","samples":0}',
      };
    await f.db.query("UPDATE jobs SET plugin_id='legacy-archive' WHERE id=$1", [
      job.id,
    ]);
    await f.db.query(
      "INSERT INTO legacy_records(source,collection,legacy_id,payload) VALUES('fixture','jobs',$1,$2)",
      [String(saved.public_id), JSON.stringify(payload)],
    );
    await migrate(f.db);
    const current = await one(f.db, "SELECT * FROM jobs WHERE id=$1", [job.id]);
    assert.equal(current.original_uid, uid);
    assert.equal(Number(current.original_parent), 17);
    assert.equal(current.original_view.sampling_steps, 4);
    assert.equal(current.original_view.actual.flow_media_id, "fixture-id");
    assert.deepEqual(current.input, saved.input);
    assert.deepEqual(current.submission_forecast, {
      source: "none",
      samples: 0,
    });
  } finally {
    await f.cleanup();
  }
});

test("Flow extension transport and media provenance are versioned and only use frozen authorized input", async () => {
  const requests: any[] = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    requests.push(JSON.parse(Buffer.concat(chunks).toString()));
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(
      "data: " +
        JSON.stringify({
          choices: [
            {
              delta: {
                content:
                  '<video src="https://fixture.invalid/out.mp4" data-media-id="new-id"></video>',
              },
            },
          ],
        }) +
        "\n\ndata: [DONE]\n\n",
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const model = flowOriginal.manifest.models.find(
      (m) => (m.studio!.descriptor as any).mode === "extend",
    )!;
    const draft = {
      kind: "video",
      model: model.id,
      uid: randomUUID(),
      prompt: "continue",
      refs: [],
      asset_packs: [],
      parent: null,
      price_revision: null,
      provided: [],
      flow_source_job: 7,
    } as OriginalDraft;
    const prepared = await flowOriginal.originalSubmission!.prepare(draft, {
      references: [],
      owner: { id: 1, site: "http://fixture.invalid" },
      source: {
        id: 7,
        model: model.id,
        kind: "video",
        state: "completed",
        params: {},
        view: { ratio: model.studio!.descriptor.ratio },
        metadata: { flow_media_id: "original-id" },
      },
      admit: async () => {},
      capacity: async () => {},
    });
    assert.equal(prepared.params.source_media_id, "original-id");
    const execution: any = {
      jobId: randomUUID(),
      idempotencyKey: randomUUID(),
      model: model.id,
      kind: "video",
      input: { prompt: "continue", params: prepared.params, references: [] },
      config: {
        baseUrl: `http://127.0.0.1:${(server.address() as any).port}`,
        apiKey: "fixture",
      },
      signal: AbortSignal.timeout(5000),
    };
    const receipt = await flowOriginal.submit(execution);
    assert.equal(receipt.state, "completed");
    assert.equal((receipt as any).usage.flow_media_id, "new-id");
    assert.deepEqual(requests[0].messages[0].content[1], {
      type: "image_url",
      image_url: { url: "extend://original-id" },
    });
    const old = await flow.submit(execution);
    assert.equal((old as any).usage, undefined);
    assert.equal(requests[1].messages[0].content.length, 1);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("original image plugin preserves reference wording and a stable hashed safety identity without changing old revisions", async () => {
  const requests: any[] = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString()));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const draft = {
      kind: "image",
      model: "gpt-image-2.6-sunburst",
      prompt: "<Picture 1> 的构图",
      uid: randomUUID(),
      refs: [],
      asset_packs: [],
      parent: null,
      price_revision: null,
      provided: [],
      ratio: "16:9",
      resolution: "1K",
      image_quality: "high",
    } as OriginalDraft;
    const prepared = await imagesOriginal.originalSubmission!.prepare(draft, {
      references: [],
      owner: { id: 7, site: "https://fixture.invalid" },
      admit: async () => {},
      capacity: async () => {},
    });
    const execution: any = {
      jobId: randomUUID(),
      idempotencyKey: randomUUID(),
      model: draft.model,
      kind: "image",
      input: { prompt: draft.prompt, params: prepared.params, references: [] },
      config: {
        baseUrl: `http://127.0.0.1:${(server.address() as any).port}`,
        apiKey: "fixture",
      },
      signal: AbortSignal.timeout(5000),
    };
    await imagesOriginal.submit(execution);
    await images.submit(execution);
    assert.equal(requests[0].prompt, "参考图片1 的构图");
    assert.equal(
      requests[0].safety_identifier,
      createHash("sha256").update("https://fixture.invalid:7").digest("hex"),
    );
    assert.equal(requests[0].size, "1536x864");
    assert.equal(requests[0].quality, "high");
    assert.equal(requests[1].prompt, draft.prompt);
    assert.equal(requests[1].safety_identifier, undefined);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("lossless task JSON survives freezing, worker request construction, replay and transactional failure", async () => {
  const f = await fixture(undefined, true);
  try {
    const versions = (
      await f.db.query(
        "SELECT id,version,manifest FROM plugin_versions ORDER BY id,version",
      )
    ).rows;
    const prompt =
      "\u001c\ufeff /media/original\0中文😀 \\u0000 \\x00\ufeff\u0085";
    const uid = randomUUID();
    const accepted = await f.submit("video", { uid, prompt });
    const row = await one(f.db, "SELECT * FROM jobs WHERE public_id=$1", [
      accepted.id,
    ]);
    assert.equal(row.input.prompt, pythonStrip(prompt));
    assert.equal(row.plugin_version, gpuText.manifest.version);
    const execution = await new Executor(f.p).execution(
      row,
      new AbortController().signal,
    );
    assert.equal(execution.input.prompt, pythonStrip(prompt));
    assert.equal((await f.submit("video", { uid, prompt })).id, accepted.id);
    const gateway = new GpuGateway(f.p);
    const pair = await gateway.pair(f.actor, {
      connectionId: f.connections[gpuText.manifest.id],
    });
    const node = await gateway.enroll({
      code: pair.code,
      name: "isolated text worker",
      models: ["MiniMax H3"],
    });
    await gateway.heartbeat(node.token, {
      context: {
        workflow: "h3-v6-native-inputs-turbo4",
        runtime_id: "text-fixture",
        hardware: "text-fixture",
      },
      queue: {
        stage: "ready",
        ready_models: ["MiniMax H3"],
        video_steps: [4, 20, 32, 50],
        can_accept: true,
      },
    });
    const claimed = (await gateway.claim(node.token)).job!;
    assert.equal(claimed.prompt, pythonStrip(prompt));
    assert.equal(claimed.pluginVersion, gpuText.manifest.version);

    const before = (
      await f.db.query("SELECT balance,held FROM wallets ORDER BY workspace_id")
    ).rows;
    const jobs = (await f.db.query("SELECT id FROM jobs")).rows;
    const failedDraft = await f.generation.parse("video", {
      uid: randomUUID(),
      prompt,
    });
    await assert.rejects(
      f.db.transaction(async (sql) => {
        await f.generation.submitOn(
          sql,
          f.actor,
          failedDraft,
          String(f.team.public_id),
        );
        throw new Error("injected after full acceptance");
      }),
      /injected/,
    );
    assert.deepEqual(
      (
        await f.db.query(
          "SELECT balance,held FROM wallets ORDER BY workspace_id",
        )
      ).rows,
      before,
    );
    assert.deepEqual((await f.db.query("SELECT id FROM jobs")).rows, jobs);
    assert.deepEqual(
      (
        await f.db.query(
          "SELECT id,version,manifest FROM plugin_versions ORDER BY id,version",
        )
      ).rows,
      versions,
    );
  } finally {
    await f.cleanup();
  }
});

test("023 leaves accepted jobs and immutable plugin manifests unchanged", async () => {
  const f = await fixture("022_original_canvas_import.sql");
  try {
    await f.submit("video", { prompt: "normal \\u0000 中文😀" });
    const jobs = (await f.db.query("SELECT * FROM jobs ORDER BY id")).rows;
    const plugins = (
      await f.db.query("SELECT * FROM plugin_versions ORDER BY id,version")
    ).rows;
    await migrate(f.db);
    assert.deepEqual(
      (await f.db.query("SELECT * FROM jobs ORDER BY id")).rows,
      jobs.map((job) => ({
        ...job,
        original_gpu_ticket: null,
        package_version: null,
        studio_client_uid: null,
      })),
    );
    assert.deepEqual(
      (await f.db.query("SELECT * FROM plugin_versions ORDER BY id,version"))
        .rows,
      plugins,
    );
  } finally {
    await f.cleanup();
  }
});
