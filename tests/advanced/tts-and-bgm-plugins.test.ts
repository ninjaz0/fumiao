import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import type { chatHttp } from "@fumiao/plugin-sdk/chat-transport.js";
import { evaluateFormConstraints } from "@fumiao/plugin-sdk/model-form.js";
import { manifestSchema } from "@fumiao/plugin-sdk/index.js";
import { inspectProviderOutput } from "@fumiao/platform/provider-output.js";
import { sandboxRequest } from "@fumiao/platform/sandbox-request.js";
import { StudioPackages, parsePackageFile } from "@fumiao/platform/studio-packages.js";
import {
  buildEdgeSsml,
  computeSecMsGec,
  type EdgeWebSocketFactory,
} from "@fumiao/platform/tts/edge-tts.js";
import { createEdgeTtsPlugin } from "@fumiao/platform/tts/edge-plugin.js";
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
