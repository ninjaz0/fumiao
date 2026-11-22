import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { databaseFixture } from "../helpers/database.js";
import { one } from "../../packages/platform/src/db.js";
import { PluginRegistry } from "../../packages/platform/src/plugins.js";
import { StudioCatalog } from "../../packages/platform/src/catalog.js";
import { GpuGateway } from "../../packages/platform/src/gpu.js";
import { gpuNative } from "../../plugins/gpu/src/native.js";
import { gpuReferences } from "../../plugins/gpu/src/references.js";
import {
  inputFingerprint,
  validateAudio,
  validateArtifact,
} from "../../plugins/gpu/src/artifacts.js";
import type { ProviderPlugin } from "../../packages/plugin-sdk/src/index.js";
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function fixture() {
  const f = await databaseFixture(),
    plugin: ProviderPlugin = { ...gpuNative };
  f.p.registry = new PluginRegistry([gpuReferences, plugin]);
  await f.p.registry.installBuiltins(f.db);
  const catalog = new StudioCatalog(f.db);
  await f.db.transaction((sql) => catalog.activate(sql, plugin.manifest));
  const prices = await catalog.prices();
  await f.db.transaction((sql) =>
    catalog.savePrices(
      sql,
      Object.fromEntries(prices.items.map((p) => [p.key, 1])),
      prices.revision,
    ),
  );
  const admin = await f.p.bootstrap({
    name: "native-admin",
    nickname: "原生测试",
    password: "native-fixture-password",
  });
  await f.p.adjustCredits(admin, admin.workspaceId, {
    amount: 1000,
    key: randomUUID(),
  });
  const connection = await f.p.createConnection(admin, {
    name: "native fixture",
    pluginId: "gpu",
    version: "1.5.0",
    config: {},
  });
  await f.p.updateConnection(admin, connection.id, {
    revision: 1,
    enabled: true,
    concurrency: 1,
  });
  const models = Object.fromEntries(
    (
      await f.db.query(
        "SELECT id,provider_model FROM models WHERE connection_id=$1",
        [connection.id],
      )
    ).rows.map((m) => [m.provider_model, m.id]),
  );
  const g = new GpuGateway(f.p),
    pair = await g.pair(admin, { connectionId: connection.id }),
    node = await g.enroll({
      code: pair.code,
      name: "native fixture",
      models: Object.keys(models),
    });
  const capabilities = {
    context: {
      workflow: "h3-v6-native-inputs-turbo4",
      runtime_id: "fixture-runtime",
    },
    queue: {
      stage: "ready" as const,
      ready_models: Object.keys(models),
      video_steps: [4, 16, 20, 32, 50],
      can_accept: true,
    },
  };
  const png = await sharp({
    create: { width: 96, height: 64, channels: 3, background: "#884455" },
  })
    .png()
    .toBuffer();
  async function asset(
    kind: "image" | "video" | "audio" = "image",
    options: {
      bytes?: Buffer;
      metadata?: Record<string, any>;
      reference?: Record<string, any> | null;
      owner?: typeof admin;
    } = {},
  ) {
    const owner = options.owner || admin,
      id = randomUUID(),
      bytes = options.bytes || png,
      metadata = options.metadata || {
        width: kind === "audio" ? 0 : 96,
        height: kind === "audio" ? 0 : 64,
      };
    await f.p.storage.put(
      id,
      bytes,
      kind === "image"
        ? "image/png"
        : kind === "video"
          ? "video/mp4"
          : "audio/wav",
    );
    await f.db.query(
      "INSERT INTO assets(id,workspace_id,owner_id,object_key,mime,size,state,metadata,original_kind) VALUES($1,$2,$3,$4,$5,$6,'ready',$7,$8)",
      [
        id,
        owner.workspaceId,
        owner.id,
        id,
        kind === "image"
          ? "image/png"
          : kind === "video"
            ? "video/mp4"
            : "audio/wav",
        bytes.length,
        JSON.stringify(metadata),
        kind === "image" ? "ref" : "ref_" + kind,
      ],
    );
    if (kind !== "image" && options.reference !== null) {
      const r = {
        seconds: 2,
        fps: kind === "video" ? 24 : 0,
        has_audio: true,
        name: "参考😀",
        ...options.reference,
      };
      await f.db.query(
        "INSERT INTO asset_reference_media(asset_id,plugin_id,plugin_version,seconds,fps,has_audio,name) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [id, "gpu", "1.4.0", r.seconds, r.fps, r.has_audio, r.name],
      );
    }
    return id;
  }
  const submit = (
    params: Record<string, any> = {},
    references: string[] = [],
    model = "MiniMax H3",
    key = randomUUID(),
  ) =>
    f.p.submit(admin, admin.workspaceId, {
      modelId: models[model],
      key,
      prompt: "Fixture prompt",
      params,
      references,
    });
  return {
    ...f,
    plugin,
    catalog,
    admin,
    models,
    g,
    node,
    capabilities,
    png,
    asset,
    submit,
    ready: () => g.heartbeat(node.token, capabilities),
  };
}
async function movie(directory: string, width = 864, height = 480) {
  const path = join(directory, "fixture-" + width + "x" + height + ".mp4");
  execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-nostdin",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=blue:size=${width}x${height}:rate=24`,
      "-f",
      "lavfi",
      "-i",
      "sine=sample_rate=32000:duration=6",
      "-frames:v",
      "124",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-threads",
      "2",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-ac",
      "2",
      "-ar",
      "32000",
      "-shortest",
      path,
    ],
    { stdio: "pipe" },
  );
  return readFile(path);
}
function receipt(job: any, bytes: Buffer) {
  return {
    sha256: digest(bytes),
    report: JSON.stringify({
      sampling_steps: job.params.sampling_steps,
      fast_mode: job.params.sampling_steps === 4,
      ...(job.params.h3_inputs
        ? { h3_input_fingerprint: inputFingerprint(job.params.h3_inputs) }
        : {}),
    }),
  };
}

test("native frames resolve slots, freeze trusted metadata and geometry, and preserve idempotency and references", async () => {
  const f = await fixture();
  try {
    const first = await f.asset(),
      last = await f.asset(),
      key = randomUUID(),
      params = {
        h3: { mode: "frames", first_frame: first, last_frame: last },
        ratio: "21:9",
        quality: 768,
      };
    const accepted = await f.submit(params, [], "MiniMax H3", key),
      job = await one(f.db, "SELECT * FROM jobs WHERE id=$1", [accepted.id]);
    assert.deepEqual(job.input.references, [first, last]);
    assert.equal(job.input.params.ratio, "4:3");
    assert.equal(job.input.params.width, 1024);
    assert.equal(job.input.params.height, 768);
    assert.equal(job.input.params.h3, undefined);
    assert.equal(job.input.params.h3_inputs.first_frame, first);
    assert.equal(job.input.params.h3_inputs.files[0].w, 96);
    assert.ok(Number.isSafeInteger(job.input.params.seed));
    assert.equal(
      (
        await f.db.query("SELECT * FROM job_assets WHERE job_id=$1", [
          accepted.id,
        ])
      ).rows.length,
      2,
    );
    await f.db.query("UPDATE assets SET metadata='{}' WHERE id=$1", [first]);
    assert.deepEqual(await f.submit(params, [], "MiniMax H3", key), accepted);
    assert.equal(
      Number((await f.p.wallet(f.admin, f.admin.workspaceId)).held),
      1,
    );
    assert.deepEqual(
      (await one(f.db, "SELECT input FROM jobs WHERE id=$1", [accepted.id]))
        .input,
      job.input,
    );
    await assert.rejects(f.p.deleteAsset(f.admin, last), { status: 409 });
    assert.equal((await f.g.claim(f.node.token)).job, null);
    await f.g.heartbeat(f.node.token, {
      ...f.capabilities,
      context: { workflow: "h3-v4-rocm-qkv-safe-configurable" },
    });
    assert.equal((await f.g.claim(f.node.token)).job, null);
    await f.ready();
    const claim = (await f.g.claim(f.node.token)).job!;
    assert.deepEqual(claim.params, job.input.params);
    assert.equal(claim.pluginVersion, "1.5.0");
    assert.deepEqual(
      Buffer.from(
        (await f.g.input(f.node.token, claim.id, claim.lease, last)).bytes,
      ),
      f.png,
    );
  } finally {
    await f.cleanup();
  }
});

test("nine plain images and twelve mixed references are supported without allowing forged metadata or invalid audio roles", async () => {
  const f = await fixture();
  try {
    const images = [];
    for (let i = 0; i < 9; i++) images.push(await f.asset());
    const video = await f.asset("video"),
      audio = await f.asset("audio"),
      video2 = await f.asset("video");
    const plain = await f.submit({}, images);
    assert.equal(
      (await one(f.db, "SELECT input FROM jobs WHERE id=$1", [plain.id])).input
        .references.length,
      9,
    );
    const duplicate = await f.submit({}, Array(9).fill(images[0]));
    assert.equal(
      (
        await f.db.query("SELECT * FROM job_assets WHERE job_id=$1", [
          duplicate.id,
        ])
      ).rows.length,
      1,
    );
    const mixed = await f.submit(
      { h3: { mode: "reference", video_audio: [video, video] } },
      [...images, video, audio, video2],
    );
    const data = (
      await one(f.db, "SELECT input FROM jobs WHERE id=$1", [mixed.id])
    ).input;
    assert.deepEqual(data.params.h3_inputs.video_audio, [video]);
    assert.equal(data.params.h3_inputs.files.length, 12);
    assert.deepEqual(
      data.params.h3_inputs.files.slice(-3).map((r: any) => r.kind),
      ["video", "audio", "video"],
    );
    await f.db.query(
      "UPDATE asset_reference_media SET seconds=15 WHERE asset_id=$1",
      [video],
    );
    assert.equal(
      (await one(f.db, "SELECT input FROM jobs WHERE id=$1", [mixed.id])).input
        .params.h3_inputs.files[9].seconds,
      2,
    );
    const upper = await f.submit(
      {
        h3: {
          mode: "frames",
          first_frame: images[0].toUpperCase(),
          last_frame: images[0],
        },
      },
      [images[0]],
    );
    const upperInput = (
      await one(f.db, "SELECT input FROM jobs WHERE id=$1", [upper.id])
    ).input;
    assert.deepEqual(upperInput.references, [images[0]]);
    assert.equal(upperInput.params.h3_inputs.first_frame, images[0]);
    const initial = await f.p.wallet(f.admin, f.admin.workspaceId),
      count = (await f.db.query("SELECT * FROM jobs")).rows.length;
    for (const [params, refs] of [
      [{}, [...images, images[0]]],
      [{ h3: { mode: "reference" } }, [images[0], images[0]]],
      [{ h3: { mode: "frames", first_frame: video } }, []],
      [{ h3: { mode: "reference", video_audio: [audio] } }, [audio]],
      [{ h3: { mode: "reference" } }, [video]],
      [{ h3_inputs: { version: 1, files: [] } }, []],
      [{ width: 1, height: 1 }, []],
      [{ h3: { mode: "reference", files: [] } }, []],
    ] as [Record<string, any>, string[]][])
      await assert.rejects(f.submit(params, refs), { status: 400 });
    const noInfo = await f.asset("video", { reference: null });
    await assert.rejects(f.submit({ h3: { mode: "reference" } }, [noInfo]), {
      status: 400,
      message: "参考素材信息缺失，请重新上传",
    });
    assert.deepEqual(await f.p.wallet(f.admin, f.admin.workspaceId), initial);
    assert.equal((await f.db.query("SELECT * FROM jobs")).rows.length, count);
  } finally {
    await f.cleanup();
  }
});

test("plugin preparation cannot bypass workspace authorization or inject an unvalidated frozen input", async () => {
  const f = await fixture();
  try {
    const member = await f.db.transaction((sql) =>
      f.p.createUser(
        sql,
        "native-member",
        "Member",
        "native-fixture-password",
        "member",
      ),
    );
    const other = await f.asset("image", { owner: member });
    await assert.rejects(
      f.submit({ h3: { mode: "frames", first_frame: other } }, []),
      { status: 404 },
    );
    const own = await f.asset(),
      prepare = f.plugin.prepareInput!;
    f.plugin.prepareInput = (request, assets) => ({
      ...prepare(request, assets),
      references: [other],
    });
    await assert.rejects(f.submit({}, [own]), {
      status: 500,
      message: "插件返回未授权的参考素材",
    });
    f.plugin.prepareInput = (request, assets) => ({
      ...prepare(request, assets),
      params: { width: -1 },
    });
    await assert.rejects(f.submit({}, [own]), {
      status: 500,
      message: "插件输入冻结结果无效",
    });
    f.plugin.prepareInput = (request, assets) => ({
      ...prepare(request, assets),
      references: ["not-an-asset-id"],
    });
    await assert.rejects(f.submit({}, [own]), {
      status: 500,
      message: "插件输入冻结结果无效",
    });
    f.plugin.referenceIds = () => ["not-an-asset-id"];
    await assert.rejects(f.submit({}, [own]), {
      status: 500,
      message: "插件参考素材选择结果无效",
    });
    assert.equal(
      Number((await f.p.wallet(f.admin, f.admin.workspaceId)).held),
      0,
    );
    assert.equal((await f.db.query("SELECT * FROM jobs")).rows.length, 0);
    const unknown = structuredClone(gpuNative.manifest);
    unknown.id = "uninstalled-native";
    await assert.rejects(f.p.registry.install(f.db, unknown), { status: 400 });
    await assert.rejects(
      f.p.registry.install(f.db, unknown, "https://fixture.invalid"),
      { status: 400 },
    );
  } finally {
    await f.cleanup();
  }
});

test("native completion verifies receipt and actual codecs before publishing, and concurrent retries spend once", async () => {
  const f = await fixture();
  try {
    await f.submit({ h3: { mode: "reference" }, sampling_steps: 4 });
    await f.ready();
    const job = (await f.g.claim(f.node.token)).job!;
    const bytes = await movie(f.directory),
      proof = receipt(job, bytes),
      before = await f.p.wallet(f.admin, f.admin.workspaceId);
    for (const report of [
      {},
      { h3_input_fingerprint: "0".repeat(64) },
      {
        h3_input_fingerprint: inputFingerprint(job.params.h3_inputs),
        sampling_steps: 20,
      },
      {
        h3_input_fingerprint: inputFingerprint(job.params.h3_inputs),
        sampling_steps: 4,
        fast_mode: false,
      },
    ])
      await assert.rejects(
        f.g.complete(f.node.token, job.id, job.lease, bytes, {
          sha256: proof.sha256,
          report: JSON.stringify(report),
        }),
        { status: 422 },
      );
    assert.equal(
      (await one(f.db, "SELECT phase FROM job_runs WHERE job=$1", [job.id]))
        .phase,
      "preparing",
    );
    await assert.rejects(
      f.g.complete(f.node.token, job.id, job.lease, bytes, {
        ...proof,
        sha256: "0".repeat(64),
      }),
      { status: 422, message: "成片摘要不符" },
    );
    const wrong = await movie(f.directory, 32, 32);
    await assert.rejects(
      f.g.complete(f.node.token, job.id, job.lease, wrong, receipt(job, wrong)),
      { status: 422, message: "成片未通过分辨率、音视频或完整解码校验" },
    );
    assert.equal((await f.db.query("SELECT * FROM assets")).rows.length, 0);
    assert.deepEqual(await f.p.wallet(f.admin, f.admin.workspaceId), before);
    proof.report = JSON.stringify({
      ...JSON.parse(proof.report),
      prepare_s: 1,
      generate_s: 2,
      finalize_s: 0.5,
      peak_vram_bytes: 2048,
      cold: false,
      recovered: true,
    });
    const results = await Promise.all([
      f.g.complete(f.node.token, job.id, job.lease, bytes, proof),
      f.g.complete(f.node.token, job.id, job.lease, bytes, proof),
    ]);
    assert.deepEqual(results[0], results[1]);
    assert.deepEqual(
      await f.g.complete(
        f.node.token,
        job.id,
        job.lease,
        Buffer.from("retry without media"),
      ),
      results[0],
    );
    assert.equal(
      (
        await f.db.query(
          "SELECT * FROM ledger WHERE job_id=$1 AND action='spend'",
          [job.id],
        )
      ).rows.length,
      1,
    );
    const asset = await one(f.db, "SELECT * FROM assets WHERE id=$1", [
      results[0].assets[0],
    ]);
    assert.equal(
      asset.metadata.h3_input_fingerprint,
      inputFingerprint(job.params.h3_inputs),
    );
    const run = await one(f.db, "SELECT * FROM job_runs WHERE job=$1", [
      job.id,
    ]);
    assert.equal(run.details.generate_s, 2);
    assert.equal(run.details.peak_vram_bytes, 2048);
    assert.equal(run.details.source, "worker");
    assert.equal(run.features.cold, false);
    assert.equal(run.valid, false);
    assert.equal(asset.metadata.sampling_steps, 4);
    assert.equal(asset.metadata.fast_mode, true);
    assert.deepEqual(
      Buffer.from(await f.p.storage.read(asset.object_key)),
      bytes,
    );
    assert.equal(
      Number((await f.p.wallet(f.admin, f.admin.workspaceId)).held),
      0,
    );
    assert.equal(
      Number((await f.p.wallet(f.admin, f.admin.workspaceId)).balance),
      999,
    );
  } finally {
    await f.cleanup();
  }
});

test("a lost GPU lease after validation cannot publish or settle a native artifact", async () => {
  const f = await fixture(),
    entered = deferred(),
    release = deferred();
  try {
    await f.submit();
    await f.ready();
    const job = (await f.g.claim(f.node.token)).job!,
      bytes = await movie(f.directory),
      validate = f.plugin.validateArtifact!;
    f.plugin.validateArtifact = async (...args) => {
      const result = await validate(...args);
      entered.resolve();
      await release.promise;
      return result;
    };
    const before = (await readdir(f.directory)).sort(),
      result = f.g.complete(
        f.node.token,
        job.id,
        job.lease,
        bytes,
        receipt(job, bytes),
      ),
      rejected = assert.rejects(result, { status: 409 });
    await entered.promise;
    await f.db.query(
      "UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
      [job.id],
    );
    release.resolve();
    await rejected;
    assert.deepEqual((await readdir(f.directory)).sort(), before);
    assert.equal((await f.db.query("SELECT * FROM assets")).rows.length, 0);
    assert.equal(
      Number((await f.p.wallet(f.admin, f.admin.workspaceId)).held),
      1,
    );
  } finally {
    release.resolve();
    await f.cleanup();
  }
});

test("Breeze artifacts enforce mono 24 kHz PCM, duration and amplitude before completion", async () => {
  const f = await fixture();
  try {
    const bytes = Buffer.alloc(44 + 4800);
    bytes.write("RIFF");
    bytes.writeUInt32LE(bytes.length - 8, 4);
    bytes.write("WAVEfmt ", 8);
    bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20);
    bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(24000, 24);
    bytes.writeUInt32LE(48000, 28);
    bytes.writeUInt16LE(2, 32);
    bytes.writeUInt16LE(16, 34);
    bytes.write("data", 36);
    bytes.writeUInt32LE(4800, 40);
    for (let i = 44; i < bytes.length; i += 2) bytes.writeInt16LE(32, i);
    assert.equal(validateAudio(bytes).duration, 0.1);
    const silent = Buffer.from(bytes);
    silent.fill(0, 44);
    assert.throws(() => validateAudio(silent), /完整性/);
    const accepted = await f.submit({}, [], "breeze-tts-2");
    const frozen = (
      await one(f.db, "SELECT input FROM jobs WHERE id=$1", [accepted.id])
    ).input.params;
    assert.equal(
      frozen.instruction,
      "A clear, natural narrator speaking at a moderate pace.",
    );
    assert.ok(frozen.seed >= 0 && frozen.seed <= 2147483647);
    await f.ready();
    const job = (await f.g.claim(f.node.token)).job!;
    await assert.rejects(
      f.g.complete(f.node.token, job.id, job.lease, silent, {
        sha256: digest(silent),
      }),
      { status: 422 },
    );
    const result = await f.g.complete(f.node.token, job.id, job.lease, bytes, {
      sha256: digest(bytes),
    });
    const a = await one(f.db, "SELECT * FROM assets WHERE id=$1", [
      result.assets[0],
    ]);
    assert.equal(a.metadata.sample_rate, 24000);
    assert.equal(a.metadata.channels, 1);
    assert.equal(a.mime, "audio/wav");
  } finally {
    await f.cleanup();
  }
});


test("artifact verification rejects excess parallel decodes and releases slots after errors", async () => {
  const release = deferred(),
    entered = [deferred(), deferred()],
    job = { model: "breeze-tts-2", kind: "audio", params: {}, references: [] },
    bytes = Buffer.from("invalid audio");
  const checks = entered.map((gate) =>
    assert.rejects(
      validateArtifact(
        job,
        bytes,
        { sha256: digest(bytes) },
        new AbortController().signal,
        async (phase) => {
          if (phase === "uploading") {
            gate.resolve();
            await release.promise;
          }
        },
      ),
      { status: 422 },
    ),
  );
  await Promise.all(entered.map((g) => g.promise));
  try {
    await assert.rejects(
      validateArtifact(
        job,
        bytes,
        { sha256: digest(bytes) },
        new AbortController().signal,
      ),
      { status: 503 },
    );
  } finally {
    release.resolve();
  }
  await Promise.all(checks);
  await assert.rejects(
    validateArtifact(
      job,
      bytes,
      { sha256: digest(bytes) },
      new AbortController().signal,
    ),
    { status: 422 },
  );
});

