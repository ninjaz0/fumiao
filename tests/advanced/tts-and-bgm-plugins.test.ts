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
