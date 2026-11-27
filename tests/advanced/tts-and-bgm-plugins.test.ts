import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import type { chatHttp } from "@fumiao/plugin-sdk/chat-transport.js";
import { evaluateFormConstraints } from "@fumiao/plugin-sdk/model-form.js";
import { manifestSchema, ProviderError } from "@fumiao/plugin-sdk/index.js";
import { Executor } from "@fumiao/platform/executor.js";
import { PluginRegistry, validator } from "@fumiao/platform/plugins.js";
import { inspectProviderOutput } from "@fumiao/platform/provider-output.js";
import { sandboxRequest } from "@fumiao/platform/sandbox-request.js";
import { StudioPackages, parsePackageFile } from "@fumiao/platform/studio-packages.js";
import {
  buildEdgeSsml,
  computeSecMsGec,
  type EdgeWebSocketFactory,
} from "@fumiao/platform/tts/edge-tts.js";
import {
  createEdgeTtsPlugin,
  edgeTtsForm,
  edgeTtsPlugin,
} from "@fumiao/platform/tts/edge-plugin.js";
import { OriginalBudgets } from "@fumiao/original-api/budgets-api.js";
import { createOriginalApp } from "../../apps/api/src/original.js";
import { canvasRunsFixture } from "../helpers/canvas-runs.js";
import { canvasesFixture } from "../helpers/canvases.js";

const exec = promisify(execFile);

async function makeRealMp3Bytes(): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "fumiao-mp3-test-"));
  const out = join(dir, "sample.mp3");
  try {
    await exec("ffmpeg", [
      "-v", "error", "-y",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=0.4",
      "-c:a", "libmp3lame", "-b:a", "96k",
      out,
    ]);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("F029 built-in Edge TTS generates Sec-MS-GEC token, safe SSML and valid MP3 output", async () => {
  const t1 = computeSecMsGec(1_700_000_010_000);
  const t2 = computeSecMsGec(1_700_000_090_000);
  assert.match(t1, /^[0-9A-F]{64}$/);
  assert.equal(t1, t2, "Same 5-minute window produces identical Sec-MS-GEC");

  const ssml = buildEdgeSsml({
    text: "你好 <世界> & \"朋友\"",
    voice: "zh-CN-YunxiNeural",
    rate: "+15%",
    pitch: "-5Hz",
  });
  assert.match(ssml, /zh-CN-YunxiNeural/);
  assert.match(ssml, /rate='\+15%'/);
  assert.match(ssml, /pitch='-5Hz'/);
  assert.match(ssml, /&lt;世界&gt; &amp; &quot;朋友&quot;/);

  const mp3Bytes = await makeRealMp3Bytes();
  const sentFrames: string[] = [];
  const mockWsFactory: EdgeWebSocketFactory = () => {
    const listeners: Record<string, ((ev: any) => void)[]> = {};
    const emit = (type: string, ev: any) => {
      for (const fn of listeners[type] ?? []) fn(ev);
    };
    queueMicrotask(() => emit("open", {}));
    return {
      binaryType: "arraybuffer",
      addEventListener(type, listener) {
        (listeners[type] ??= []).push(listener);
      },
      send(data: string) {
        sentFrames.push(data);
        if (data.includes("Path:ssml")) {
          const header = Buffer.from("X-RequestId:1\r\nContent-Type:audio/mpeg\r\nPath:audio\r\n");
          const frame = Buffer.alloc(2 + header.length + mp3Bytes.length);
          frame.writeUInt16BE(header.length, 0);
          header.copy(frame, 2);
          mp3Bytes.copy(frame, 2 + header.length);
          queueMicrotask(() => {
            emit("message", { data: frame });
            emit("message", { data: "Path:turn.end\r\n\r\n" });
          });
        }
      },
      close() {},
    };
  };

  const plugin = createEdgeTtsPlugin(mockWsFactory);
  const receipt = await plugin.submit({
    jobId: "job-1",
    idempotencyKey: "idem-1",
    model: "edge-tts",
    kind: "audio",
    config: {},
    signal: AbortSignal.timeout(10_000),
    input: {
      prompt: "免费神经语音兜底测试",
      params: { voice: "zh-CN-XiaoxiaoNeural", rate: "+0%", pitch: "+0Hz" },
      references: [],
    },
  });
  assert.equal(receipt.state, "completed");
  assert.equal(sentFrames.length, 2);
  const dataUrl = receipt.artifacts[0].url;
  assert.ok(dataUrl.startsWith("data:audio/mpeg;base64,"));
  const decoded = Buffer.from(dataUrl.split(",")[1], "base64");
  const inspected = await inspectProviderOutput(
    {
      version: 3,
      errors: {
        imageFormat: "bad",
        imageDecode: "bad",
        video: "bad",
        audio: "bad-audio",
        failed: "fail",
      },
    },
    decoded,
    "audio",
    false,
    AbortSignal.timeout(15_000),
  );
  assert.equal(inspected.mime, "audio/mpeg");
  assert.ok(Number(inspected.duration) > 0.2);
});

test("Edge TTS plugin removes dead instruction field from form & inputSchema, marks canvas: true for CanvasWorkspace model availability, tolerates historic drafts in prepare(), and reports actionable failure message", async () => {
  assert.equal(edgeTtsForm.canvas, true);
  assert.equal("instruction" in edgeTtsForm.fields, false);
  assert.deepEqual(Object.keys(edgeTtsForm.fields), ["voice", "rate", "pitch"]);

  const inputSchema = edgeTtsPlugin.manifest.models[0].inputSchema as {
    properties: Record<string, unknown>;
  };
  assert.equal("instruction" in inputSchema.properties, false);
  assert.deepEqual(Object.keys(inputSchema.properties), [
    "voice",
    "rate",
    "pitch",
  ]);

  const prepared = await edgeTtsPlugin.originalSubmission!.prepare!(
    {
      uid: "historic-draft-1",
      kind: "audio",
      model: "edge-tts",
      prompt: "历史草稿兼容测试",
      instruction: "旧版遗留备注",
      params: {
        voice: "zh-CN-YunxiNeural",
        rate: "+15%",
        pitch: "-5Hz",
        instruction: "旧版参数备注",
      },
      refs: [],
      asset_packs: [],
      price_revision: 1,
    } as any,
    {
      references: [],
      owner: { id: 1, site: "http://localhost:3000" },
      admit: async () => {},
      capacity: async () => {},
    },
  );
  assert.deepEqual(prepared.params, {
    voice: "zh-CN-YunxiNeural",
    rate: "+15%",
    pitch: "-5Hz",
  });
  assert.equal(
    validator.validate(
      edgeTtsPlugin.manifest.models[0].inputSchema,
      prepared.params,
    ),
    true,
  );

  const failingPlugin = createEdgeTtsPlugin(() => {
    throw new Error("握手被拒绝");
  });
  await assert.rejects(
    () =>
      failingPlugin.submit({
        jobId: "edge-fail-1",
        idempotencyKey: "edge-fail-idem-1",
        model: "edge-tts",
        kind: "audio",
        config: {},
        signal: AbortSignal.timeout(5_000),
        input: {
          prompt: "失败提示校验",
          params: {
            voice: "zh-CN-XiaoxiaoNeural",
            rate: "+0%",
            pitch: "+0Hz",
          },
          references: [],
        },
      }),
    (err: unknown) => {
      assert.ok(err instanceof ProviderError);
      assert.equal(err.certainty, "rejected");
      assert.equal(
        err.message,
        "Edge TTS 连接失败（握手被拒绝）。请稍后重试，或切换其他可用语音模型（管理员可在「设置 → 插件」导入商业语音插件）",
      );
      assert.equal(err.message.includes("配置自定义 Edge 语音端点"), false);
      return true;
    },
  );
});

test("F029 tts-commercial package installs cleanly and handles binary /v1/audio/speech responses", async () => {
  const f = await canvasesFixture();
  try {
    const raw = JSON.parse(
      await readFile(
        "plugins/tts-commercial/tts-commercial.fmplugin.json",
        "utf8",
      ),
    );
    const parsed = parsePackageFile(raw);
    assert.equal(parsed.id, "tts-commercial");

    const packages = new StudioPackages(f.p);
    await packages.install(f.admin, raw);

    const mp3Bytes = await makeRealMp3Bytes();
    const calls: { url: URL; init: Parameters<typeof chatHttp>[1] }[] = [];
    const send: typeof chatHttp = async (url, init) => {
      calls.push({ url, init });
      return {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
        body: (async function* () {
          yield mp3Bytes;
        })(),
        close() {},
      };
    };

    const manifest = manifestSchema.parse(parsed.manifest);
    const plugin = await sandboxRequest(manifest, parsed.studioProgram!, send);
    const receipt = await plugin.submit({
      jobId: "tts-1",
      idempotencyKey: "tts-idem-1",
      model: "gpt-4o-mini-tts",
      kind: "audio",
      config: {
        baseUrl: "https://tts.example.com",
        apiKey: "synthetic-tts-key",
      },
      signal: AbortSignal.timeout(10_000),
      input: {
        prompt: "欢迎使用多引擎配音路由",
        params: {
          voice: "coral",
          speed: 1.1,
          response_format: "mp3",
          instruction: "温暖自然",
        },
        references: [],
      },
    });

    assert.equal(receipt.state, "completed");
    assert.equal(calls[0].url.href, "https://tts.example.com/v1/audio/speech");
    assert.deepEqual(calls[0].init.body, {
      model: "gpt-4o-mini-tts",
      input: "欢迎使用多引擎配音路由",
      voice: "coral",
      speed: 1.1,
      response_format: "mp3",
      instructions: "温暖自然",
    });
    assert.ok(receipt.artifacts[0].url.startsWith("data:audio/mpeg;base64,"));

    // Invalid audio payload rejected by inspectProviderOutput
    await assert.rejects(
      inspectProviderOutput(
        manifest.artifactValidation as any,
        Buffer.from("not-an-audio-file"),
        "audio",
        false,
        AbortSignal.timeout(10_000),
      ),
      /无法解码/,
    );
  } finally {
    await f.cleanup();
  }
});

test("F033 bgm-generator package installs cleanly, enforces dynamic instrumental/lyrics form and async polling", async () => {
  const f = await canvasesFixture();
  try {
    const raw = JSON.parse(
      await readFile("plugins/bgm-generator/bgm-generator.fmplugin.json", "utf8"),
    );
    const parsed = parsePackageFile(raw);
    assert.equal(parsed.id, "bgm-generator");

    const packages = new StudioPackages(f.p);
    await packages.install(f.admin, raw);

    const manifest = manifestSchema.parse(parsed.manifest);
    let step = 0;
    const send: typeof chatHttp = async (url) => {
      step++;
      const payload =
        step === 1
          ? JSON.stringify({ task_id: "bgm_task_001" })
          : JSON.stringify({
              status: "completed",
              audio_url: "https://music.example.com/files/track01.mp3",
            });
      assert.ok(url.href.startsWith("https://music.example.com/v1/audio/music"));
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: (async function* () {
          yield Buffer.from(payload);
        })(),
        close() {},
      };
    };

    const plugin = await sandboxRequest(manifest, parsed.studioProgram!, send);
    const form = plugin.modelForm!(manifest.models[0]);
    const hiddenEval = evaluateFormConstraints(form, { instrumental: true });
    assert.equal(hiddenEval.fields.lyrics.visible, false);
    const shownEval = evaluateFormConstraints(form, { instrumental: false });
    assert.equal(shownEval.fields.lyrics.visible, true);

    const config = {
      baseUrl: "https://music.example.com",
      apiKey: "synthetic-bgm-key",
    };
    const submitted = await plugin.submit({
      jobId: "bgm-1",
      idempotencyKey: "bgm-idem-1",
      model: "bgm-v1",
      kind: "audio",
      config,
      signal: AbortSignal.timeout(10_000),
      input: {
        prompt: "雨夜赛博朋克氛围配乐",
        params: { style: "electronic", duration: 30, bpm: 112, instrumental: true },
        references: [],
      },
    });
    assert.deepEqual(submitted, { state: "pending", remoteId: "bgm_task_001" });

    const polled = await plugin.inspect!(
      {
        jobId: "bgm-1",
        idempotencyKey: "bgm-idem-1",
        model: "bgm-v1",
        kind: "audio",
        config,
        signal: AbortSignal.timeout(10_000),
        input: { prompt: "雨夜赛博朋克氛围配乐", params: {}, references: [] },
      },
      "bgm_task_001",
    );
    assert.equal(polled.state, "completed");
    assert.equal(
      polled.artifacts[0].url,
      "https://music.example.com/files/track01.mp3",
    );
  } finally {
    await f.cleanup();
  }
});

test("F033 bgm-generator & tts-commercial 1.1.0 upgrade cleanly from 1.0.0 and keep immutable releases & in-flight snapshots", async () => {
  const f = await canvasRunsFixture();
  try {
    const bgmRawText = await readFile(
      "plugins/bgm-generator/bgm-generator.fmplugin.json",
      "utf8",
    );
    const bgmUpdate = JSON.parse(
      await readFile("plugins/bgm-generator/update.json", "utf8"),
    );
    assert.equal(bgmUpdate.version, "1.1.0");
    assert.equal(
      bgmUpdate.sha256,
      createHash("sha256").update(bgmRawText).digest("hex"),
    );

    const ttsRawText = await readFile(
      "plugins/tts-commercial/tts-commercial.fmplugin.json",
      "utf8",
    );
    const ttsUpdate = JSON.parse(
      await readFile("plugins/tts-commercial/update.json", "utf8"),
    );
    assert.equal(ttsUpdate.version, "1.1.0");
    assert.equal(
      ttsUpdate.sha256,
      createHash("sha256").update(ttsRawText).digest("hex"),
    );

    const probeSend: typeof chatHttp = async (url) => ({
      status: url.pathname === "/v1/models" ? 200 : 404,
      headers: { "content-type": "application/json" },
      body: (async function* () {
        yield Buffer.from(JSON.stringify({ data: [{ id: "bgm-v1" }] }));
      })(),
      close() {},
    });
    f.p.registry = new PluginRegistry(undefined, [], probeSend);

    const nextPkg = JSON.parse(bgmRawText);
    assert.equal(nextPkg.version, "1.1.0");
    assert.equal(nextPkg.adapterVersion, "1.1.0");

    // Simulate previously installed 1.0.0 package + connection + in-flight job snapshot.
    const legacyPkg = structuredClone(nextPkg);
    legacyPkg.version = "1.0.0";
    legacyPkg.adapterVersion = "1.0.0";
    legacyPkg.manifest.version = "1.0.0";

    const pkgs = new StudioPackages(f.p);
    await pkgs.install(f.admin, legacyPkg);
    const connId = randomUUID();
    await f.db.query(
      "INSERT INTO connections(id,name,plugin_id,plugin_version,config,enabled) VALUES ($1,'BGM Legacy','bgm-generator','1.0.0',$2,true)",
      [
        connId,
        f.p.vault.seal({
          baseUrl: "https://music.example.com",
          apiKey: "synthetic-key",
        }),
      ],
    );
    const modelId = randomUUID();
    await f.db.query(
      "INSERT INTO models(id,connection_id,catalog_id,provider_model,label,kind,schema,enabled) VALUES ($1,$2,'bgm-v1','bgm-v1','BGM v1','audio',$3,true)",
      [modelId, connId, { type: "object", additionalProperties: true }],
    );
    const inFlightJobId = randomUUID();
    await f.db.query(
      `INSERT INTO jobs(id,workspace_id,owner_id,model_id,connection_id,plugin_id,plugin_version,package_version,config_snapshot,provider_model,kind,input,idempotency_key,request_hash,price,catalog_id,state)
       VALUES($1,$2,$3,$4,$5,'bgm-generator','1.0.0','1.0.0',$6,'bgm-v1','audio','{"prompt":"legacy"}'::jsonb,$7,'h',10,'bgm-v1','running')`,
      [
        inFlightJobId,
        f.workspace.id,
        f.admin.id,
        modelId,
        connId,
        f.p.vault.seal({
          baseUrl: "https://music.example.com",
          apiKey: "synthetic-key",
        }),
        randomUUID(),
      ],
    );

    // Mutating the already-published 1.0.0 version must be rejected with 409.
    const mutatedLegacy = structuredClone(legacyPkg);
    mutatedLegacy.label = "Tampered 1.0.0";
    await assert.rejects(
      () => pkgs.install(f.admin, mutatedLegacy),
      (err: any) => err?.status === 409,
    );

    // Upgrading to immutable 1.1.0 succeeds and preserves both releases + in-flight 1.0.0 job.
    const beforeUpgrade = (
      await f.db.query("SELECT revision FROM studio_packages WHERE id='bgm-generator'")
    ).rows[0];
    await pkgs.install(f.admin, nextPkg, Number(beforeUpgrade.revision));

    const releases = (
      await f.db.query(
        "SELECT version FROM studio_package_releases WHERE id='bgm-generator' ORDER BY version",
      )
    ).rows.map((r) => r.version);
    assert.deepEqual(releases, ["1.0.0", "1.1.0"]);

    const connAfter = (
      await f.db.query("SELECT plugin_version FROM connections WHERE id=$1", [connId])
    ).rows[0];
    assert.equal(connAfter.plugin_version, "1.1.0");

    const jobAfter = (
      await f.db.query(
        "SELECT plugin_version, package_version FROM jobs WHERE id=$1",
        [inFlightJobId],
      )
    ).rows[0];
    assert.equal(jobAfter.plugin_version, "1.0.0");
    assert.equal(jobAfter.package_version, "1.0.0");
  } finally {
    await f.cleanup();
  }
});

test("F033 POST /api/canvases/:key/bgm enforces music-only models, atomic project budget, playable MP3 download, and keeps /api/audio-jobs non-project", async () => {
  const f = await canvasRunsFixture();
  const mp3 = await makeRealMp3Bytes();
  const outputUrl = "https://music.example.invalid/files/bgm-track.mp3";
  const upstreamCalls: { path: string; method?: string }[] = [];
  const transport: typeof chatHttp = async (url, init) => {
    upstreamCalls.push({ path: url.pathname, method: init.method });
    if (url.pathname === "/files/bgm-track.mp3") {
      return {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
        body: (async function* () {
          yield mp3;
        })(),
        close() {},
      };
    }
    if (url.pathname === "/v1/audio/music") {
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: (async function* () {
          yield Buffer.from(
            JSON.stringify({ status: "completed", audio_url: outputUrl }),
          );
        })(),
        close() {},
      };
    }
    if (url.pathname === "/v1/audio/speech") {
      return {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
        body: (async function* () {
          yield mp3;
        })(),
        close() {},
      };
    }
    return {
      status: 200,
      headers: { "content-type": "application/json" },
      body: (async function* () {
        yield Buffer.from(JSON.stringify({ data: [] }));
      })(),
      close() {},
    };
  };

  let app: Awaited<ReturnType<typeof createOriginalApp>> | undefined;
  try {
    f.p.registry = new PluginRegistry(undefined, [], transport);
    const pkgs = new StudioPackages(f.p);

    // Install and configure both bgm-generator@1.1.0 and tts-commercial@1.1.0
    const bgmPkg = JSON.parse(
      await readFile("plugins/bgm-generator/bgm-generator.fmplugin.json", "utf8"),
    );
    await pkgs.install(f.admin, bgmPkg);
    const bgmConn = randomUUID();
    await f.db.query(
      "INSERT INTO connections(id,name,plugin_id,plugin_version,config,enabled) VALUES ($1,'Synthetic BGM','bgm-generator',$2,$3,true)",
      [
        bgmConn,
        bgmPkg.adapterVersion,
        f.p.vault.seal({
          baseUrl: "https://music.example.invalid",
          apiKey: "synthetic-bgm-key",
        }),
      ],
    );
    await f.db.query(
      "INSERT INTO models(id,connection_id,catalog_id,provider_model,label,kind,schema,enabled) VALUES ($1,$2,'bgm-v1','bgm-v1','AI 配乐 BGM v1','audio',$3,true)",
      [randomUUID(), bgmConn, { type: "object", additionalProperties: true }],
    );
    await f.db.query(
      "UPDATE studio_policy SET flags=flags || '{\"bgm-v1\":true}'::jsonb WHERE singleton",
    );
    const bgmInstalled = (
      await f.db.query("SELECT revision FROM studio_packages WHERE id='bgm-generator'")
    ).rows[0];
    await pkgs.change(f.admin, "bgm-generator", Number(bgmInstalled.revision), "enable");

    const ttsPkg = JSON.parse(
      await readFile("plugins/tts-commercial/tts-commercial.fmplugin.json", "utf8"),
    );
    await pkgs.install(f.admin, ttsPkg);
    const ttsConn = randomUUID();
    await f.db.query(
      "INSERT INTO connections(id,name,plugin_id,plugin_version,config,enabled) VALUES ($1,'Synthetic TTS','tts-commercial',$2,$3,true)",
      [
        ttsConn,
        ttsPkg.adapterVersion,
        f.p.vault.seal({
          baseUrl: "https://tts.example.invalid",
          apiKey: "synthetic-tts-key",
        }),
      ],
    );
    await f.db.query(
      "INSERT INTO models(id,connection_id,catalog_id,provider_model,label,kind,schema,enabled) VALUES ($1,$2,'tts-1','tts-1','OpenAI TTS-1','audio',$3,true)",
      [randomUUID(), ttsConn, { type: "object", additionalProperties: true }],
    );
    await f.db.query(
      "UPDATE studio_policy SET flags=flags || '{\"tts-1\":true}'::jsonb WHERE singleton",
    );
    const ttsInstalled = (
      await f.db.query("SELECT revision FROM studio_packages WHERE id='tts-commercial'")
    ).rows[0];
    await pkgs.change(f.admin, "tts-commercial", Number(ttsInstalled.revision), "enable");

    const canvasId = await f.project();
    const workspace = String(f.workspace.public_id);
    const budgets = new OriginalBudgets(f.p);
    await budgets.upsertPolicy(
      f.admin,
      {
        scope_type: "project",
        scope_id: canvasId,
        period: "monthly",
        warn_limit: 0,
        cap_limit: 1,
        mode: "cap",
        enabled: true,
      },
      workspace,
    );

    app = await createOriginalApp(f.p);
    await app.listen(0, "127.0.0.1");
    const url = await app.getUrl();
    const login = await fetch(url + "/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "admin", password: "canvas-storage-fixture" }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers
      .getSetCookie()
      .map((x) => x.split(";")[0])
      .join("; ");
    const headers = {
      "content-type": "application/json",
      cookie,
      "x-workspace-id": workspace,
    };

    const stateRes = await fetch(url + "/api/state", { headers });
    assert.equal(stateRes.status, 200);
    const state = (await stateRes.json()) as any;
    const priceRevision = Number(state.pricing.revision);
    assert.equal(state.model_catalog["bgm-v1"]?.kind, "audio");

    const wallet = async () =>
      (
        await f.db.query("SELECT balance, held FROM wallets WHERE workspace_id=$1", [
          f.workspace.id,
        ])
      ).rows[0];

    // 1. Speech-only model rejected on canvas BGM endpoint (400)
    const speechOnBgm = await fetch(url + `/api/canvases/${canvasId}/bgm`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        uid: randomUUID(),
        model: "tts-1",
        prompt: "电影感器乐背景配乐",
        instruction: "background music soundtrack",
        price_revision: priceRevision,
      }),
    });
    assert.equal(speechOnBgm.status, 400);

    // 2. Low project budget (cap=1, quote=10) blocks canvas BGM with 402 & zero side effects
    const beforeBlocked = await wallet();
    const blockedRes = await fetch(url + `/api/canvases/${canvasId}/bgm`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        uid: randomUUID(),
        model: "bgm-v1",
        prompt: "海浪轻拍礁石，温暖电影感器乐配乐",
        instruction: "background music soundtrack",
        price_revision: priceRevision,
      }),
    });
    assert.equal(blockedRes.status, 402);
    assert.deepEqual(await wallet(), beforeBlocked);
    assert.equal(
      (await f.db.query("SELECT count(*)::int AS n FROM jobs")).rows[0].n,
      0,
    );
    assert.equal(
      (await f.db.query("SELECT count(*)::int AS n FROM canvas_job_links")).rows[0].n,
      0,
    );
    assert.equal(
      (await f.db.query("SELECT count(*)::int AS n FROM job_projects")).rows[0].n,
      0,
    );
    assert.equal(
      (await budgets.list(f.admin, workspace)).policies[0].total_committed,
      0,
    );

    // 3. Generic workbench /api/audio-jobs remains non-project (not blocked by canvas cap=1!)
    const genericTtsRes = await fetch(url + "/api/audio-jobs", {
      method: "POST",
      headers,
      body: JSON.stringify({
        uid: randomUUID(),
        model: "tts-1",
        prompt: "通用工作台配音测试，不归属画布项目",
        instruction: "温暖自然",
        price_revision: priceRevision,
      }),
    });
    assert.equal(genericTtsRes.status, 200);
    const genericTts = (await genericTtsRes.json()) as { id: number };
    assert.ok(genericTts.id > 0);
    const genericProjLinks = (
      await f.db.query(
        "SELECT count(*)::int AS n FROM job_projects jp JOIN jobs j ON j.id=jp.job_id WHERE j.public_id=$1",
        [genericTts.id],
      )
    ).rows[0].n;
    assert.equal(genericProjLinks, 0);
    assert.equal(
      (await budgets.list(f.admin, workspace)).policies[0].total_committed,
      0,
    );

    // 4. Raise canvas project cap to 30 -> canvas BGM succeeds, holds 10, links bgm:project, enforces idempotency & concurrency
    await budgets.upsertPolicy(
      f.admin,
      {
        scope_type: "project",
        scope_id: canvasId,
        period: "monthly",
        warn_limit: 0,
        cap_limit: 30,
        mode: "cap",
        enabled: true,
      },
      workspace,
    );
    const beforeAllowed = await wallet();
    const bgmUid = randomUUID();
    const allowedRes = await fetch(url + `/api/canvases/${canvasId}/bgm`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        uid: bgmUid,
        model: "bgm-v1",
        prompt: "海浪轻拍礁石，温暖电影感器乐配乐",
        instruction: "background music soundtrack",
        price_revision: priceRevision,
      }),
    });
    assert.equal(allowedRes.status, 200);
    const created = (await allowedRes.json()) as { id: number };
    assert.ok(created.id > 0);

    // Idempotent replay with same UID returns same job ID without extra charge
    const replayRes = await fetch(url + `/api/canvases/${canvasId}/bgm`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        uid: bgmUid,
        model: "bgm-v1",
        prompt: "海浪轻拍礁石，温暖电影感器乐配乐",
        instruction: "background music soundtrack",
        price_revision: priceRevision,
      }),
    });
    assert.equal(replayRes.status, 200);
    assert.deepEqual(await replayRes.json(), { id: created.id });

    // Concurrent second submission with different UID while in-flight returns 409
    const busyRes = await fetch(url + `/api/canvases/${canvasId}/bgm`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        uid: randomUUID(),
        model: "bgm-v1",
        prompt: "另一段配乐",
        instruction: "background music soundtrack",
        price_revision: priceRevision,
      }),
    });
    assert.equal(busyRes.status, 409);

    const afterAccept = await wallet();
    assert.equal(Number(afterAccept.held) - Number(beforeAllowed.held), 10);
    assert.equal(
      (await budgets.list(f.admin, workspace)).policies[0].total_committed,
      10,
    );

    // 5. Execute via Executor -> calls /v1/audio/music & QuickJS artifact download /files/bgm-track.mp3
    const bgmJobRow = (
      await f.db.query("SELECT id FROM jobs WHERE public_id=$1", [created.id])
    ).rows[0];
    await new Executor(f.p).execute(bgmJobRow.id);
    assert.ok(upstreamCalls.some((c) => c.path === "/v1/audio/music"));
    assert.ok(upstreamCalls.some((c) => c.path === "/files/bgm-track.mp3"));

    // Runs endpoint returns completed bgm:project run with playable asset ID
    const runsRes = await fetch(url + `/api/canvases/${canvasId}/runs`, {
      headers,
    });
    assert.equal(runsRes.status, 200);
    const { runs } = (await runsRes.json()) as { runs: any[] };
    const bgmRun = runs.find(
      (r) => r.id === created.id && r.canvas_node === "bgm:project",
    );
    assert.ok(bgmRun);
    assert.equal(bgmRun.status, "done");
    assert.match(bgmRun.result, /^[a-f0-9]{32}$/);

    // Playable MP3 served from private /media/:id
    const mediaRes = await fetch(url + `/media/${bgmRun.result}`, {
      headers: { cookie, "x-workspace-id": workspace },
    });
    assert.equal(mediaRes.status, 200);
    assert.deepEqual(Buffer.from(await mediaRes.arrayBuffer()), mp3);

    // Persist mounted BGM + bgm_applied_job on canvas and confirm visible after reload
    const canvasBefore = (await (
      await fetch(url + `/api/canvases/${canvasId}`, { headers })
    ).json()) as any;
    const saveRes = await fetch(url + `/api/canvases/${canvasId}/document`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        expected_revision: canvasBefore.revision,
        title: canvasBefore.title,
        document: {
          ...canvasBefore.document,
          bgm_applied_job: created.id,
          bgm: {
            asset_id: bgmRun.result,
            volume: 0.35,
            ducking: true,
            loop: true,
          },
        },
      }),
    });
    assert.equal(saveRes.status, 200);
    const reloaded = (await (
      await fetch(url + `/api/canvases/${canvasId}`, { headers })
    ).json()) as any;
    assert.equal(reloaded.document.bgm?.asset_id, bgmRun.result);
    assert.equal(reloaded.document.bgm_applied_job, created.id);

    // Final settlement: 10 credits spent (single settlement), project budget remains 10
    const afterSettle = await wallet();
    assert.equal(Number(beforeAllowed.balance) - Number(afterSettle.balance), 10);
    assert.equal(Number(afterSettle.held), Number(beforeAllowed.held));
    assert.equal(
      (await budgets.list(f.admin, workspace)).policies[0].total_committed,
      10,
    );
  } finally {
    await app?.close();
    await f.cleanup();
  }
});

test("PR #223 Round 2 Item 6: disabling saved tts-1 via policy, connection, plugin, or workspace permission falls back consistently to edge-tts across state, precheck, narrate, and dialogue while filtering BGM and preserving explicit disabled-model rejection & zero-engine block", async (t) => {
  const f = await canvasRunsFixture();
  t.after(() => f.cleanup());

  const { ensureBuiltinEdgeTts } = await import("@fumiao/platform/tts/edge-plugin.js");
  const { OriginalBatchPrecheck } = await import("@fumiao/original-api/batch-precheck.js");
  const { OriginalState } = await import("@fumiao/original-api/state.js");
  const { OriginalGeneration } = await import("@fumiao/original-api/generation.js");
  const { OriginalSettings } = await import("@fumiao/original-api/settings.js");

  // Disable built-in gpu audio connection (breeze-tts-2) so speech engines under test are tts-commercial + edge-tts (+ bgm-generator)
  await f.p.db.query(
    `UPDATE connections SET enabled = FALSE
      WHERE id IN (SELECT connection_id FROM models WHERE kind = 'audio')`,
  );

  // Enable built-in Edge TTS (0 credits)
  await ensureBuiltinEdgeTts(f.p, { endpoint: "ws://127.0.0.1:1/mock-edge" });

  // Install & configure both tts-commercial (tts-1 @ 2 credits) AND bgm-generator (bgm-v1 @ 10 credits)
  const pkgs = new StudioPackages(f.p);
  const ttsPkg = JSON.parse(
    await readFile("plugins/tts-commercial/tts-commercial.fmplugin.json", "utf8"),
  );
  const bgmPkg = JSON.parse(
    await readFile("plugins/bgm-generator/bgm-generator.fmplugin.json", "utf8"),
  );
  await pkgs.install(f.admin, ttsPkg);
  const ttsConn = randomUUID();
  await f.p.db.query(
    "INSERT INTO connections(id,name,plugin_id,plugin_version,config,enabled) VALUES ($1,'Synthetic TTS','tts-commercial',$2,$3,true)",
    [
      ttsConn,
      ttsPkg.adapterVersion,
      f.p.vault.seal({
        baseUrl: "https://tts.example.invalid",
        apiKey: "sk-test-tts",
      }),
    ],
  );
  await f.p.db.query(
    "INSERT INTO models(id,connection_id,catalog_id,provider_model,label,kind,schema,enabled) VALUES ($1,$2,'tts-1','tts-1','OpenAI TTS-1','audio',$3,true)",
    [randomUUID(), ttsConn, { type: "object", additionalProperties: true }],
  );
  await f.p.db.query(
    `UPDATE studio_policy SET flags = flags || '{"tts-1":true}'::jsonb WHERE singleton`,
  );
  const ttsInstalled = (
    await f.p.db.query("SELECT revision FROM studio_packages WHERE id='tts-commercial'")
  ).rows[0];
  await pkgs.change(f.admin, "tts-commercial", Number(ttsInstalled.revision), "enable");

  await pkgs.install(f.admin, bgmPkg);
  const bgmConn = randomUUID();
  await f.p.db.query(
    "INSERT INTO connections(id,name,plugin_id,plugin_version,config,enabled) VALUES ($1,'Synthetic BGM','bgm-generator',$2,$3,true)",
    [
      bgmConn,
      bgmPkg.adapterVersion,
      f.p.vault.seal({
        baseUrl: "https://bgm.example.invalid",
        apiKey: "sk-test-bgm",
      }),
    ],
  );
  await f.p.db.query(
    "INSERT INTO models(id,connection_id,catalog_id,provider_model,label,kind,schema,enabled) VALUES ($1,$2,'bgm-v1','bgm-v1','AI 配乐 BGM v1','audio',$3,true)",
    [randomUUID(), bgmConn, { type: "object", additionalProperties: true }],
  );
  await f.p.db.query(
    `UPDATE studio_policy SET flags = flags || '{"bgm-v1":true}'::jsonb WHERE singleton`,
  );
  const bgmInstalled = (
    await f.p.db.query("SELECT revision FROM studio_packages WHERE id='bgm-generator'")
  ).rows[0];
  await pkgs.change(f.admin, "bgm-generator", Number(bgmInstalled.revision), "enable");

  const wsPublicId = String(f.workspace.public_id);
  await f.p.db.query("UPDATE wallets SET balance = 200, held = 0 WHERE workspace_id = $1", [
    f.workspace.id,
  ]);

  const canvasId = await f.project(
    [
      {
        id: "shot1",
        type: "video",
        title: "镜头 1",
        x: 0,
        y: 0,
        width: 300,
        height: 220,
        prompt: "rainy alley",
        narration_text: "旧模型停用后应与前端一致回退到免费 Edge TTS",
        narration_instruction: "深沉",
        narration_model: "tts-1",
        dialogue_lines: [
          {
            id: "line1",
            speaker: "侦探",
            text: "对白同样在旧模型不可用时回退到 Edge TTS",
            model: "tts-1",
          },
        ],
        params: {},
      },
    ],
    [],
    wsPublicId,
    f.admin,
  );

  const precheck = new OriginalBatchPrecheck(f.p);
  const stateSvc = new OriginalState(f.p);
  const settings = new OriginalSettings(f.p);
  const generation = new OriginalGeneration(f.p);

  // Baseline while tts-1 IS enabled: canvas_speech_models contains tts-1 & edge-tts, NEVER bgm-v1!
  const stateBefore = (await stateSvc.read(f.admin, wsPublicId)) as any;
  assert.ok(Array.isArray(stateBefore.canvas_speech_models));
  assert.equal(stateBefore.canvas_speech_models.includes("tts-1"), true);
  assert.equal(stateBefore.canvas_speech_models.includes("edge-tts"), true);
  assert.equal(stateBefore.canvas_speech_models.includes("bgm-v1"), false);
  // Global audio_models contract remains intact
  assert.equal("bgm-v1" in stateBefore.audio_models, true);

  // 1) Disable tts-1 via model policy (PATCH /api/settings/models):
  await settings.models(f.admin, {
    model: "tts-1",
    enabled: false,
    expected_revision: stateBefore.model_policy.revision,
  });

  // Direct/explicit submission to OriginalGeneration with disabled "tts-1" MUST STILL REJECT (no validation bypass!)
  await assert.rejects(
    generation.submit(
      f.admin,
      await generation.parse("audio", {
        uid: randomUUID(),
        model: "tts-1",
        prompt: "明确选择禁用模型必须被拦截",
      }),
      wsPublicId,
    ),
    (err: any) => err?.status === 403,
  );

  // Meanwhile, canvas state, precheck (narration + dialogue), narrate, and narrateDialogue ALL fall back consistently to edge-tts @ 0 credits!
  const stateAfterPolicy = (await stateSvc.read(f.admin, wsPublicId)) as any;
  assert.equal(stateAfterPolicy.canvas_speech_models.includes("tts-1"), false);
  assert.equal(stateAfterPolicy.canvas_speech_models.includes("edge-tts"), true);

  const preAfterPolicy = await precheck.precheckCanvas(f.admin, canvasId, {
    expected_revision: 2,
    node_ids: ["shot1"],
    stages: ["narration", "dialogue"],
  });
  const preNarr = preAfterPolicy.items.find((i) => i.stage === "narration")!;
  const preDlg = preAfterPolicy.items.find((i) => i.stage === "dialogue")!;
  assert.equal(preNarr.model, "edge-tts");
  assert.equal(preNarr.credits, 0);
  assert.notEqual(preNarr.status, "blocked");
  assert.equal(preDlg.model, "edge-tts");
  assert.equal(preDlg.credits, 0);
  assert.notEqual(preDlg.status, "blocked");

  const narrRes = await f.runs.narrate(f.admin, canvasId, "shot1", {
    expected_revision: 2,
    uid: randomUUID(),
  });
  const narrJob = (
    await f.p.db.query("SELECT provider_model, price FROM jobs WHERE public_id = $1", [
      narrRes.id,
    ])
  ).rows[0];
  assert.equal(narrJob.provider_model, "edge-tts");
  assert.equal(Number(narrJob.price), 0);

  const dlgRes = await f.runs.narrateDialogue(f.admin, canvasId, "shot1", {
    expected_revision: 2,
    uid: randomUUID(),
  });
  assert.equal(dlgRes.items[0].model, "edge-tts");

  // Cancel queued test jobs so shot1 isn't busy for next checks
  await f.p.db.query("UPDATE jobs SET state = 'cancelled' WHERE workspace_id = $1", [
    f.workspace.id,
  ]);

  // 2) Re-enable tts-1 policy, then disable via workspace model_permissions -> ALSO falls back to edge-tts!
  const polRev2 = ((await stateSvc.read(f.admin, wsPublicId)) as any).model_policy.revision;
  await settings.models(f.admin, {
    model: "tts-1",
    enabled: true,
    expected_revision: polRev2,
  });
  const ttsModelRow = (
    await f.p.db.query("SELECT id FROM models WHERE catalog_id = 'tts-1' LIMIT 1")
  ).rows[0];
  await f.p.db.query(
    `INSERT INTO model_permissions(model_id, workspace_id, enabled)
     VALUES ($1, $2, FALSE)
     ON CONFLICT (model_id, workspace_id) DO UPDATE SET enabled = FALSE`,
    [ttsModelRow.id, f.workspace.id],
  );
  const stateAfterPerm = (await stateSvc.read(f.admin, wsPublicId)) as any;
  assert.equal(stateAfterPerm.canvas_speech_models.includes("tts-1"), false);
  const preAfterPerm = await precheck.precheckCanvas(f.admin, canvasId, {
    expected_revision: 2,
    node_ids: ["shot1"],
    stages: ["narration"],
  });
  assert.equal(preAfterPerm.items[0].model, "edge-tts");
  assert.equal(preAfterPerm.items[0].credits, 0);

  // 3) Disable ALL speech engines (including edge-tts & gpt-4o-mini-tts & local-tts-compat) while bgm-v1 STAYS enabled -> MUST BLOCK (never pick bgm-v1)!
  await f.p.db.query(
    `UPDATE connections SET enabled = FALSE WHERE plugin_id IN ('tts-commercial', 'edge-tts')`,
  );
  const stateNoSpeech = (await stateSvc.read(f.admin, wsPublicId)) as any;
  assert.deepEqual(stateNoSpeech.canvas_speech_models, []);
  const preBlocked = await precheck.precheckCanvas(f.admin, canvasId, {
    expected_revision: 2,
    node_ids: ["shot1"],
    stages: ["narration"],
  });
  assert.equal(preBlocked.items[0].status, "blocked");
  assert.notEqual(preBlocked.items[0].model, "bgm-v1");
  await assert.rejects(
    f.runs.narrate(f.admin, canvasId, "shot1", {
      expected_revision: 2,
      uid: randomUUID(),
    }),
    (err: any) => [403, 503].includes(err?.status),
  );
});

test("PR #223 Round 3 Item 1 & Item 2: accepted dialogue retries survive disabled speech engines & preserve snapshot model/voice, and UI/precheck/submit share requireConfigured + portable v3 speech + defaultModelIds", async (t) => {
  const f = await canvasRunsFixture();
  t.after(() => f.cleanup());

  const { ensureBuiltinEdgeTts } = await import("@fumiao/platform/tts/edge-plugin.js");
  const { OriginalBatchPrecheck } = await import("@fumiao/original-api/batch-precheck.js");
  const { OriginalState } = await import("@fumiao/original-api/state.js");
  const { ReferencePacks } = await import("@fumiao/platform/packs.js");
  const typesMod = (await import("../../apps/web/canvas-editor/types.js")) as Record<
    string,
    any
  >;

  // Disable built-in gpu audio connection (breeze-tts-2) so speech engines are controlled explicitly
  await f.p.db.query(
    `UPDATE connections SET enabled = FALSE
      WHERE id IN (SELECT connection_id FROM models WHERE kind = 'audio')`,
  );
  await ensureBuiltinEdgeTts(f.p, { endpoint: "ws://127.0.0.1:1/mock-edge" });

  const pkgs = new StudioPackages(f.p);
  const ttsPkg = JSON.parse(
    await readFile("plugins/tts-commercial/tts-commercial.fmplugin.json", "utf8"),
  );
  const bgmPkg = JSON.parse(
    await readFile("plugins/bgm-generator/bgm-generator.fmplugin.json", "utf8"),
  );

  await pkgs.install(f.admin, ttsPkg);
  const ttsConn = randomUUID();
  await f.p.db.query(
    "INSERT INTO connections(id,name,plugin_id,plugin_version,config,enabled) VALUES ($1,'Synthetic TTS','tts-commercial',$2,$3,true)",
    [
      ttsConn,
      ttsPkg.adapterVersion,
      f.p.vault.seal({
        baseUrl: "https://tts.example.invalid",
        apiKey: "sk-test-tts",
      }),
    ],
  );
  await f.p.db.query(
    "INSERT INTO models(id,connection_id,catalog_id,provider_model,label,kind,schema,enabled) VALUES ($1,$2,'tts-1','tts-1','OpenAI TTS-1','audio',$3,true),($4,$2,'gpt-4o-mini-tts','gpt-4o-mini-tts','GPT-4o Mini TTS','audio',$3,true)",
    [randomUUID(), ttsConn, { type: "object", additionalProperties: true }, randomUUID()],
  );
  await f.p.db.query(
    `UPDATE studio_policy SET flags = flags || '{"tts-1":true,"gpt-4o-mini-tts":true}'::jsonb WHERE singleton`,
  );
  const ttsInstalled = (
    await f.p.db.query("SELECT revision FROM studio_packages WHERE id='tts-commercial'")
  ).rows[0];
  await pkgs.change(f.admin, "tts-commercial", Number(ttsInstalled.revision), "enable");

  await pkgs.install(f.admin, bgmPkg);
  const bgmConn = randomUUID();
  await f.p.db.query(
    "INSERT INTO connections(id,name,plugin_id,plugin_version,config,enabled) VALUES ($1,'Synthetic BGM','bgm-generator',$2,$3,true)",
    [
      bgmConn,
      bgmPkg.adapterVersion,
      f.p.vault.seal({
        baseUrl: "https://bgm.example.invalid",
        apiKey: "sk-test-bgm",
      }),
    ],
  );
  await f.p.db.query(
    "INSERT INTO models(id,connection_id,catalog_id,provider_model,label,kind,schema,enabled) VALUES ($1,$2,'bgm-v1','bgm-v1','AI 配乐 BGM v1','audio',$3,true)",
    [randomUUID(), bgmConn, { type: "object", additionalProperties: true }],
  );
  await f.p.db.query(
    `UPDATE studio_policy SET flags = flags || '{"bgm-v1":true}'::jsonb WHERE singleton`,
  );
  const bgmInstalled = (
    await f.p.db.query("SELECT revision FROM studio_packages WHERE id='bgm-generator'")
  ).rows[0];
  await pkgs.change(f.admin, "bgm-generator", Number(bgmInstalled.revision), "enable");

  const wsPublicId = String(f.workspace.public_id);
  await f.p.db.query("UPDATE wallets SET balance = 200, held = 0 WHERE workspace_id = $1", [
    f.workspace.id,
  ]);

  // Create a character pack with voice_profile { model: 'tts-1', voice_id: 'alloy' }
  const packsSvc = new ReferencePacks(f.p.db);
  const packAssetId = randomUUID().replaceAll("-", "");
  await f.asset(packAssetId);
  const createdPack = await f.p.db.transaction((sql) =>
    packsSvc.save(sql, f.admin, f.workspace.id, {
      name: "林墨",
      purpose: "subject",
      description: "冷峻侦探",
      media: [packAssetId],
      expected_revision: null,
      voice_profile: {
        model: "tts-1",
        voice_id: "alloy",
        instruction: "冷静克制",
      },
    }),
  );

  const canvasId = await f.project(
    [
      {
        id: "shot1",
        type: "video",
        title: "镜头 1",
        x: 0,
        y: 0,
        width: 300,
        height: 220,
        prompt: "rainy street",
        narration_text: "旁白测试",
        dialogue_lines: [
          {
            id: "line1",
            speaker: "林墨",
            pack_id: createdPack.public_id,
            text: "第一句已接单对白重试不应依赖当前语音引擎开关",
          },
          {
            id: "line2",
            speaker: "路人",
            text: "第二句历史回执无 model 字段兼容测试",
            model: "tts-1",
            voice_id: "echo",
          },
        ],
        params: {},
      },
    ],
    [],
    wsPublicId,
    f.admin,
  );

  // --- Item 1: Accepted dialogue retry (both fallback-available & zero-speech-engines + legacy receipt) ---
  const acceptedDialogueUid = randomUUID();
  const initialDlg = await f.runs.narrateDialogue(f.admin, canvasId, "shot1", {
    expected_revision: 2,
    uid: acceptedDialogueUid,
  });
  assert.equal(initialDlg.items.length, 2);
  assert.deepEqual(initialDlg.items[0], {
    line_id: "line1",
    id: initialDlg.items[0].id,
    speaker: "林墨",
    model: "tts-1",
    voice_id: "alloy",
  });
  assert.deepEqual(initialDlg.items[1], {
    line_id: "line2",
    id: initialDlg.items[1].id,
    speaker: "路人",
    model: "tts-1",
    voice_id: "echo",
  });

  // Simulate a legacy pre-Round-3 receipt on line2 by stripping `model` from `canvas_job_links.inputs`
  await f.p.db.query(
    `UPDATE canvas_job_links
        SET inputs = convert_to((convert_from(inputs, 'utf8')::jsonb - 'model')::text, 'utf8')
      WHERE node = 'dialogue:shot1:line2'`,
  );

  const walletAfterAccept = (
    await f.p.db.query("SELECT balance, held FROM wallets WHERE workspace_id = $1", [
      f.workspace.id,
    ])
  ).rows[0];
  const jobCountAfterAccept = Number(
    (
      await f.p.db.query("SELECT count(*)::int AS c FROM jobs WHERE workspace_id = $1", [
        f.workspace.id,
      ])
    ).rows[0].c,
  );

  // Mutate character pack voice_profile AND disable tts-commercial while edge-tts stays enabled (Case B: fallback available)
  await f.p.db.transaction((sql) =>
    packsSvc.save(
      sql,
      f.admin,
      f.workspace.id,
      {
        name: "林墨",
        purpose: "subject",
        description: "冷峻侦探",
        media: [packAssetId],
        expected_revision: createdPack.revision,
        voice_profile: {
          model: "edge-tts",
          voice_id: "zh-CN-YunxiNeural",
        },
      },
      createdPack.public_id,
    ),
  );
  await f.p.db.query("UPDATE connections SET enabled = FALSE WHERE plugin_id = 'tts-commercial'");

  const retryWithFallback = await f.runs.narrateDialogue(f.admin, canvasId, "shot1", {
    expected_revision: 2,
    uid: acceptedDialogueUid,
  });
  assert.deepEqual(retryWithFallback, initialDlg);

  // Now ALSO disable edge-tts while bgm-v1 stays enabled (Case A: zero speech engines!)
  await f.p.db.query("UPDATE connections SET enabled = FALSE WHERE plugin_id = 'edge-tts'");

  const retryWithZeroSpeech = await f.runs.narrateDialogue(f.admin, canvasId, "shot1", {
    expected_revision: 2,
    uid: acceptedDialogueUid,
  });
  assert.deepEqual(retryWithZeroSpeech, initialDlg);

  const walletAfterRetries = (
    await f.p.db.query("SELECT balance, held FROM wallets WHERE workspace_id = $1", [
      f.workspace.id,
    ])
  ).rows[0];
  const jobCountAfterRetries = Number(
    (
      await f.p.db.query("SELECT count(*)::int AS c FROM jobs WHERE workspace_id = $1", [
        f.workspace.id,
      ])
    ).rows[0].c,
  );
  assert.deepEqual(walletAfterRetries, walletAfterAccept);
  assert.equal(jobCountAfterRetries, jobCountAfterAccept);

  // First-time submission with a NEW uid while zero speech engines are enabled MUST still reject with 503!
  await assert.rejects(
    f.runs.narrateDialogue(f.admin, canvasId, "shot1", {
      expected_revision: 2,
      uid: randomUUID(),
    }),
    (err: any) => err?.status === 503,
  );

  // Cancel queued dialogue jobs before Item 2 checks
  await f.p.db.query("UPDATE jobs SET state = 'cancelled' WHERE workspace_id = $1", [
    f.workspace.id,
  ]);

  // --- Item 2a: tts-commercial enabled with EMPTY apiKey ("") + executable edge-tts ---
  await f.p.db.query("UPDATE connections SET enabled = TRUE WHERE plugin_id = 'edge-tts'");
  await f.p.db.query(
    "UPDATE connections SET enabled = TRUE, config = $2 WHERE id = $1",
    [
      ttsConn,
      f.p.vault.seal({
        baseUrl: "https://tts.example.invalid",
        apiKey: "",
      }),
    ],
  );

  const stateSvc = new OriginalState(f.p);
  const precheck = new OriginalBatchPrecheck(f.p);

  const stateEmptyKey = (await stateSvc.read(f.admin, wsPublicId)) as any;
  assert.equal(
    stateEmptyKey.canvas_speech_models.includes("tts-1"),
    false,
    "tts-1 with empty apiKey must NOT appear in canvas_speech_models",
  );
  assert.deepEqual(stateEmptyKey.canvas_speech_models, ["edge-tts"]);

  const uiModelsEmptyKey = typesMod.resolveCanvasSpeechModels(stateEmptyKey);
  assert.deepEqual(
    uiModelsEmptyKey.map((m: { id: string }) => m.id),
    ["edge-tts"],
  );

  const preEmptyKey = await precheck.precheckCanvas(f.admin, canvasId, {
    expected_revision: 2,
    node_ids: ["shot1"],
    stages: ["narration", "dialogue"],
  });
  for (const item of preEmptyKey.items) {
    assert.equal(item.model, "edge-tts");
    assert.equal(item.credits, 0);
    assert.notEqual(item.status, "blocked");
  }
  const preItemsEmptyKey = await precheck.quoteBatch(
    f.admin,
    {
      items: [
        { kind: "audio", model: "" },
        { kind: "audio", model: "tts-1" },
      ],
    },
    wsPublicId,
  );
  assert.equal(preItemsEmptyKey.items[0].model, "edge-tts");
  assert.equal(preItemsEmptyKey.items[0].credits, 0);
  assert.equal(preItemsEmptyKey.items[0].allowed, true);
  assert.equal(preItemsEmptyKey.items[1].allowed, false);

  const narrEmptyKey = await f.runs.narrate(f.admin, canvasId, "shot1", {
    expected_revision: 2,
    uid: randomUUID(),
  });
  const narrEmptyKeyRow = (
    await f.p.db.query("SELECT catalog_id, price FROM jobs WHERE public_id = $1", [
      narrEmptyKey.id,
    ])
  ).rows[0];
  assert.equal(narrEmptyKeyRow.catalog_id, "edge-tts");
  assert.equal(Number(narrEmptyKeyRow.price), 0);
  await f.p.db.query("UPDATE jobs SET state = 'cancelled' WHERE workspace_id = $1", [
    f.workspace.id,
  ]);

  // --- Item 2b: Portable v3 speech plugin WITHOUT canvasSubmission (model_forms[id].canvas === false) ---
  const portableSpeechPkg = {
    format: 1,
    id: "portable-speech-v3",
    label: "Portable Speech v3",
    version: "1.0.0",
    adapterVersion: "1.0.0",
    contributes: { version: 1, hostCapabilities: ["media"] },
    manifest: {
      id: "portable-speech-v3",
      label: "Portable Speech v3",
      version: "1.0.0",
      contractVersion: 1,
      mode: "request",
      originalSubmission: { version: 3 },
      artifactValidation: {
        version: 3,
        errors: {
          imageFormat: "图片格式不受支持",
          imageDecode: "无法解码图片",
          video: "视频无效",
          audio: "音频无效",
          failed: "未保存成品",
        },
      },
      configSchema: {
        type: "object",
        properties: {
          baseUrl: { type: "string" },
          apiKey: { type: "string", writeOnly: true },
        },
        required: ["baseUrl", "apiKey"],
      },
      models: [
        {
          id: "portable-tts-pro",
          label: "Portable TTS Pro",
          kind: "audio",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          studio: {
            order: 65,
            priceOrder: 650,
            descriptor: { kind: "audio", label: "Portable TTS Pro" },
            prices: [
              {
                tier: "standard",
                amount: 4,
                label: "便携语音合成",
                match: { type: "object" },
              },
            ],
          },
        },
      ],
    },
    program:
      "({request(){return {path:'/speech',body:{}}},result({raw}){return {state:'completed',artifacts:[{url:raw.url,mime:'audio/mpeg'}]}}})",
  };
  await pkgs.install(f.admin, portableSpeechPkg);
  await f.p.createConnection(
    f.admin,
    {
      pluginId: "portable-speech-v3",
      version: "1.0.0",
      name: "Portable Speech Conn",
      config: { baseUrl: "https://portable-tts.example.invalid", apiKey: "sk-portable" },
    },
    true,
  );
  await pkgs.change(f.admin, "portable-speech-v3", 1, "enable");
  await f.p.db.query(
    `UPDATE studio_policy SET flags = flags || '{"portable-tts-pro":true}'::jsonb WHERE singleton`,
  );

  const stateWithPortable = (await stateSvc.read(f.admin, wsPublicId)) as any;
  assert.equal(stateWithPortable.model_forms["portable-tts-pro"]?.canvas, false);
  assert.equal(stateWithPortable.canvas_speech_models.includes("portable-tts-pro"), true);
  assert.equal(Array.isArray(stateWithPortable.canvas_speech_default_models), true);

  // Frontend helper must keep portable-tts-pro even though model_forms['portable-tts-pro'].canvas === false!
  const uiSpeechWithPortable = typesMod.resolveCanvasSpeechModels(stateWithPortable);
  assert.equal(
    uiSpeechWithPortable.some((m: { id: string }) => m.id === "portable-tts-pro"),
    true,
  );

  // Auto-route prefers non-Edge speech model ("portable-tts-pro" @ 4 credits) identically on UI, precheck, and submit!
  const uiPlanPortable = typesMod.quoteCanvasSpeechPlan({
    studio: stateWithPortable,
    node: {
      id: "shot1",
      type: "video",
      narration_text: "旁白测试",
      dialogue_lines: [],
    },
    packs: [],
  });
  assert.equal(uiPlanPortable.narration.activeModel, "portable-tts-pro");
  assert.equal(uiPlanPortable.narration.cost, 4);

  const preWithPortable = await precheck.precheckCanvas(f.admin, canvasId, {
    expected_revision: 2,
    node_ids: ["shot1"],
    stages: ["narration"],
  });
  assert.equal(preWithPortable.items[0].model, "portable-tts-pro");
  assert.equal(preWithPortable.items[0].credits, 4);
});

test("PR #223 Round 4 Items 1, 2 & 4: dialogue old UID + bumped revision rejects 409, unexecutable default speech blocks precheckCanvas, and multi-tier speech pricing matches server tiers without misusing first tier", async (t) => {
  const f = await canvasRunsFixture();
  t.after(() => f.cleanup());

  const { OriginalBatchPrecheck } = await import("@fumiao/original-api/batch-precheck.js");
  const { OriginalState } = await import("@fumiao/original-api/state.js");
  const typesMod = (await import("../../apps/web/canvas-editor/types.js")) as Record<
    string,
    any
  >;

  // Disable built-in gpu audio connection (breeze-tts-2) so speech models are controlled explicitly
  await f.p.db.query(
    `UPDATE connections SET enabled = FALSE
      WHERE id IN (SELECT connection_id FROM models WHERE kind = 'audio')`,
  );

  // Install tts-commercial with tts-1 declared as defaultForKind: true (sole policy-allowed speech default!)
  const pkgs = new StudioPackages(f.p);
  const ttsPkg = JSON.parse(
    await readFile("plugins/tts-commercial/tts-commercial.fmplugin.json", "utf8"),
  );
  ttsPkg.manifest.canvasSubmission.models[0].defaultForKind = true;
  await pkgs.install(f.admin, ttsPkg);

  const ttsConn = randomUUID();
  await f.p.db.query(
    "INSERT INTO connections(id,name,plugin_id,plugin_version,config,enabled) VALUES ($1,'Default TTS','tts-commercial',$2,$3,true)",
    [
      ttsConn,
      ttsPkg.adapterVersion,
      f.p.vault.seal({
        baseUrl: "https://tts.example.invalid",
        apiKey: "", // Empty apiKey -> schema passes, requireConfigured fails!
      }),
    ],
  );
  await f.p.db.query(
    "INSERT INTO models(id,connection_id,catalog_id,provider_model,label,kind,schema,enabled) VALUES ($1,$2,'tts-1','tts-1','OpenAI TTS-1','audio',$3,true)",
    [randomUUID(), ttsConn, { type: "object", additionalProperties: true }],
  );
  await f.p.db.query(
    `UPDATE studio_policy SET flags = (flags || '{"breeze-tts-2":false,"tts-1":true}'::jsonb) WHERE singleton`,
  );
  const ttsInstalled = (
    await f.p.db.query("SELECT revision FROM studio_packages WHERE id='tts-commercial'")
  ).rows[0];
  await pkgs.change(f.admin, "tts-commercial", Number(ttsInstalled.revision), "enable");

  const wsPublicId = String(f.workspace.public_id);
  await f.p.db.query("UPDATE wallets SET balance = 10, held = 0 WHERE workspace_id = $1", [
    f.workspace.id,
  ]);

  const canvasId = await f.project(
    [
      {
        id: "shot1",
        type: "video",
        title: "镜头 1",
        x: 0,
        y: 0,
        width: 300,
        height: 220,
        prompt: "alley",
        narration_text: "默认语音未配置密钥时预检应阻断",
        dialogue_lines: [
          {
            id: "line1",
            speaker: "侦探",
            text: "第一版对白台词",
          },
        ],
        params: {},
      },
    ],
    [],
    wsPublicId,
    f.admin,
  );

  const stateSvc = new OriginalState(f.p);
  const precheck = new OriginalBatchPrecheck(f.p);

  // --- Item 2: tts-1 is sole policy-allowed default, connection enabled with apiKey="", no Edge TTS ---
  const stateUnconfigured = (await stateSvc.read(f.admin, wsPublicId)) as any;
  assert.deepEqual(stateUnconfigured.canvas_speech_models, []);

  // Direct submit keeps legacy 503 behavior
  await assert.rejects(
    f.runs.narrate(f.admin, canvasId, "shot1", {
      expected_revision: 2,
      uid: randomUUID(),
    }),
    (err: any) => err?.status === 503,
  );
  await assert.rejects(
    f.runs.narrateDialogue(f.admin, canvasId, "shot1", {
      expected_revision: 2,
      uid: randomUUID(),
    }),
    (err: any) => err?.status === 503,
  );

  // precheckCanvas MUST block both narration and dialogue with 0 credits!
  const preUnconfigured = await precheck.precheckCanvas(f.admin, canvasId, {
    expected_revision: 2,
    node_ids: ["shot1"],
    stages: ["narration", "dialogue"],
  });
  for (const stage of ["narration", "dialogue"] as const) {
    const item = preUnconfigured.items.find((i) => i.stage === stage)!;
    assert.equal(item.status, "blocked", `${stage} must be blocked when default speech has empty apiKey`);
    assert.equal(item.credits, 0);
  }

  // --- Item 4: Configure valid apiKey on tts-1, add earlier conditional 50-credit wav tier & 15-credit vip voice tier ---
  await f.p.db.query(
    "UPDATE connections SET config = $2 WHERE id = $1",
    [
      ttsConn,
      f.p.vault.seal({
        baseUrl: "https://tts.example.invalid",
        apiKey: "sk-valid-tts",
      }),
    ],
  );
  // Existing tts-1|standard is position=0, amount=2; place wav (50) and vip-clone (15) ahead of standard (2)
  await f.p.db.query(
    `UPDATE studio_prices
        SET position = 10,
            amount = 2,
            matcher = $1::jsonb
      WHERE key = 'tts-1|standard'`,
    [
      JSON.stringify({
        type: "object",
        not: {
          anyOf: [
            { required: ["response_format"], properties: { response_format: { const: "wav" } } },
            { required: ["voice"], properties: { voice: { const: "vip-clone" } } },
          ],
        },
      }),
    ],
  );
  await f.p.db.query(
    `INSERT INTO studio_prices(key, model_id, tier, label, position, matcher, amount)
     VALUES
       ('tts-1|wav', 'tts-1', 'wav', 'WAV 高清档', -2, $1::jsonb, 50),
       ('tts-1|vip', 'tts-1', 'vip', 'VIP 声线档', -1, $2::jsonb, 15)`,
    [
      JSON.stringify({
        type: "object",
        required: ["response_format"],
        properties: { response_format: { const: "wav" } },
      }),
      JSON.stringify({
        type: "object",
        required: ["voice"],
        properties: { voice: { const: "vip-clone" } },
      }),
    ],
  );

  // Wallet balance is 10: multi-tier tts-1 must NOT guess the first 50-credit wav tier or falsely block UI;
  // real server submission quotes 2 credits for ordinary narration/dialogue (accepted!) and 15 credits (> 10 -> 402!) for vip-clone!
  const stateMultiTier = (await stateSvc.read(f.admin, wsPublicId)) as any;
  assert.equal("canvas_speech_price_tiers" in stateMultiTier, false);
  const ordinaryPlan = typesMod.quoteCanvasSpeechPlan({
    studio: stateMultiTier,
    node: {
      narration_model: undefined,
      dialogue_lines: [{ id: "line1", speaker: "侦探", text: "普通对白 2 积分" }],
    },
    packs: [],
  });
  assert.equal(ordinaryPlan.narration.cost, null);
  assert.equal(ordinaryPlan.narration.costIndeterminate, true);
  assert.equal(ordinaryPlan.narration.unavailableReason, "");
  assert.equal(ordinaryPlan.dialogue.lineCosts.line1, null);
  assert.equal(ordinaryPlan.dialogue.lineReasons.line1, "");
  assert.equal(ordinaryPlan.dialogue.batchCost, null);
  assert.equal(ordinaryPlan.dialogue.costIndeterminate, true);
  assert.equal(ordinaryPlan.dialogue.unavailableReason, "");

  // Real server narration submit quotes 2-credit standard tier (wallet 10 -> held 2, NOT blocked at 50!)
  const narrRes = await f.runs.narrate(f.admin, canvasId, "shot1", {
    expected_revision: 2,
    uid: randomUUID(),
  });
  assert.ok(narrRes.id > 0);
  const heldAfterNarr = Number(
    (
      await f.p.db.query("SELECT held FROM wallets WHERE workspace_id = $1", [
        f.workspace.id,
      ])
    ).rows[0].held,
  );
  assert.equal(heldAfterNarr, 2);
  await f.p.db.query(
    "UPDATE jobs SET state = 'cancelled' WHERE workspace_id = $1",
    [f.workspace.id],
  );
  await f.p.db.query(
    "UPDATE wallets SET balance = 10, held = 0 WHERE workspace_id = $1",
    [f.workspace.id],
  );

  // --- Item 1: Accept dialogue at revision=2 with uidRev2 (also verifies real server 2-credit dialogue quote), edit same line to revision=3, retry with old uidRev2 + expected_revision=3 -> MUST reject 409! ---
  const uidRev2 = randomUUID();
  const acceptedRev2 = await f.runs.narrateDialogue(f.admin, canvasId, "shot1", {
    expected_revision: 2,
    uid: uidRev2,
  });
  assert.equal(acceptedRev2.items.length, 1);
  assert.equal(acceptedRev2.items[0].model, "tts-1");

  // Cancel queued job so node isn't busy, then edit line1 text -> canvas becomes revision=3
  await f.p.db.query("UPDATE jobs SET state = 'cancelled' WHERE workspace_id = $1", [
    f.workspace.id,
  ]);
  const loadedCanvas = await f.canvases.get(f.admin, canvasId);
  await f.canvases.save(f.admin, canvasId, {
    title: loadedCanvas.title,
    expected_revision: 2,
    document: {
      ...loadedCanvas.document,
      nodes: loadedCanvas.document.nodes.map((n: any) =>
        n.id === "shot1"
          ? {
              ...n,
              dialogue_lines: [
                {
                  id: "line1",
                  speaker: "侦探",
                  text: "修改到 revision=3 的全新对白台词",
                },
              ],
            }
          : n,
      ),
    },
  });

  const walletBeforeStaleUid = (
    await f.p.db.query("SELECT balance, held FROM wallets WHERE workspace_id = $1", [
      f.workspace.id,
    ])
  ).rows[0];
  const jobsBeforeStaleUid = Number(
    (
      await f.p.db.query("SELECT count(*)::int AS c FROM jobs WHERE workspace_id = $1", [
        f.workspace.id,
      ])
    ).rows[0].c,
  );

  // Re-submitting old uidRev2 with expected_revision=3 MUST reject 409 instead of returning revision=2's job!
  await assert.rejects(
    f.runs.narrateDialogue(f.admin, canvasId, "shot1", {
      expected_revision: 3,
      uid: uidRev2,
    }),
    (err: any) => err?.status === 409,
  );

  const walletAfterStaleUid = (
    await f.p.db.query("SELECT balance, held FROM wallets WHERE workspace_id = $1", [
      f.workspace.id,
    ])
  ).rows[0];
  const jobsAfterStaleUid = Number(
    (
      await f.p.db.query("SELECT count(*)::int AS c FROM jobs WHERE workspace_id = $1", [
        f.workspace.id,
      ])
    ).rows[0].c,
  );
  assert.deepEqual(walletAfterStaleUid, walletBeforeStaleUid);
  assert.equal(jobsAfterStaleUid, jobsBeforeStaleUid);

  // Same UID + same revision=3 (both with persisted inputs.revision=3 AND legacy receipt without inputs.revision) still replays cleanly even when all speech engines are disabled!
  const uidRev3 = randomUUID();
  const acceptedRev3 = await f.runs.narrateDialogue(f.admin, canvasId, "shot1", {
    expected_revision: 3,
    uid: uidRev3,
  });
  await f.p.db.query("UPDATE connections SET enabled = FALSE WHERE id = $1", [ttsConn]);
  assert.deepEqual(
    await f.runs.narrateDialogue(f.admin, canvasId, "shot1", {
      expected_revision: 3,
      uid: uidRev3,
    }),
    acceptedRev3,
  );

  // Strip `revision` from inputs to verify legacy receipt without inputs.revision still replays idempotently
  await f.p.db.query(
    `UPDATE canvas_job_links
        SET inputs = convert_to((convert_from(inputs, 'utf8')::jsonb - 'revision')::text, 'utf8')
      WHERE uid = $1`,
    [
      (
        await f.p.db.query(
          "SELECT uid FROM canvas_job_links ORDER BY id DESC LIMIT 1",
        )
      ).rows[0].uid,
    ],
  );
  assert.deepEqual(
    await f.runs.narrateDialogue(f.admin, canvasId, "shot1", {
      expected_revision: 3,
      uid: uidRev3,
    }),
    acceptedRev3,
  );

  // Re-enable connection, cancel job, and verify conditional high-price tier (voice_id="vip-clone" -> 15 credits > 10 balance) is rejected by real server submit!
  await f.p.db.query("UPDATE connections SET enabled = TRUE WHERE id = $1", [ttsConn]);
  await f.p.db.query("UPDATE jobs SET state = 'cancelled' WHERE workspace_id = $1", [
    f.workspace.id,
  ]);
  await f.p.db.query("UPDATE wallets SET balance = 10, held = 0 WHERE workspace_id = $1", [
    f.workspace.id,
  ]);
  const loadedRev3 = await f.canvases.get(f.admin, canvasId);
  await f.canvases.save(f.admin, canvasId, {
    title: loadedRev3.title,
    expected_revision: 3,
    document: {
      ...loadedRev3.document,
      nodes: loadedRev3.document.nodes.map((n: any) =>
        n.id === "shot1"
          ? {
              ...n,
              dialogue_lines: [
                {
                  id: "line1",
                  speaker: "VIP",
                  voice_id: "vip-clone",
                  text: "命中 15 积分 VIP 声线档位",
                },
              ],
            }
          : n,
      ),
    },
  });
  await assert.rejects(
    f.runs.narrateDialogue(f.admin, canvasId, "shot1", {
      expected_revision: 4,
      uid: randomUUID(),
    }),
    (err: any) => err?.status === 402 || /积分不足/.test(String(err?.message)),
  );
});
