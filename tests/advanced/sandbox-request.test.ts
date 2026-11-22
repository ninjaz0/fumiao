import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  RequestLifecycleError,
  ArtifactDownloadError,
  type Execution,
  manifestSchema,
} from "@fumiao/plugin-sdk/index.js";
import type { chatHttp } from "@fumiao/plugin-sdk/chat-transport.js";
import { sandboxRequest } from "@fumiao/platform/sandbox-request.js";

test("Muse uses bounded JSON policies for signed submissions, large frozen references, retry decisions, clocks and download recovery", async () => {
  const release = JSON.parse(
    await readFile("plugins/muse/muse.fmplugin.json", "utf8"),
  );
  let status = 200,
    bytes = Buffer.from("{}"),
    calls = 0;
  const requests: { url: URL; options: Parameters<typeof chatHttp>[1] }[] = [];
  const probe: typeof chatHttp = async (url, options) => {
    assert.ok(options.lookup);
    requests.push({ url, options });
    calls++;
    return {
      status,
      headers: {},
      body: (async function* () {
        yield bytes;
      })(),
      close() {},
    };
  };
  const adapter = await sandboxRequest(
    manifestSchema.parse(release.manifest),
    release.studioProgram,
    probe,
  );
  const config = { baseUrl: "https://1.1.1.1/tenant", apiKey: "scoped-key" };
  const signal = new AbortController().signal;
  const data = "data:image/png;base64," + "A".repeat(3 * 1024 * 1024);
  const observations: unknown[] = [];
  const e: Execution = {
    kind: "video",
    model: "muse-video",
    config,
    signal,
    jobId: randomUUID(),
    idempotencyKey: randomUUID(),
    input: {
      prompt: "<Picture １２>",
      params: { ratio: "9:16", seconds: 6 },
      references: [{ id: "fixture", mime: "image/png", url: data }],
    },
    reportProviderNote: async (n) => {
      observations.push(n);
    },
    reportProviderClock: async (c) => {
      observations.push(c);
    },
    reportTiming: async (t) => {
      observations.push(t);
    },
  };
  const id = "task_" + "f".repeat(32);
  bytes = Buffer.from(JSON.stringify({ id, status: "queued", created_at: 12 }));
  assert.deepEqual(await adapter.submit(e), { state: "pending", remoteId: id });
  const { options, url } = requests[0];
  assert.equal(url.href, config.baseUrl + "/v1/videos");
  assert.equal(options.key, config.apiKey);
  assert.equal(options.idempotencyKey, e.idempotencyKey.replaceAll("-", ""));
  assert.deepEqual(options.body, {
    model: e.model,
    prompt: "[图１２]",
    aspect_ratio: "9:16",
    images: [data],
    timeout: 600,
    duration: 6,
  });
  assert.deepEqual(observations.splice(0), [
    "等待 Muse 空闲账号",
    { state: "queued", created_at: 12 },
  ]);
  async function rejects(
    run: () => Promise<unknown>,
    action: string,
    note?: string,
  ) {
    await assert.rejects(
      run,
      (error) =>
        error instanceof RequestLifecycleError &&
        error.disposition.action === action &&
        (!note ||
          ("note" in error.disposition && error.disposition.note === note)),
    );
  }
  status = 429;
  await assert.rejects(
    adapter.submit(e),
    (error) =>
      error instanceof RequestLifecycleError &&
      error.disposition.action === "retry" &&
      error.disposition.delaySeconds === 60,
  );
  status = 400;
  await rejects(() => adapter.submit(e), "fail", "Muse 拒绝了生成参数或参考图");
  status = 200;
  bytes = Buffer.from('{"id":"invalid"}');
  await rejects(
    () => adapter.submit(e),
    "fail",
    "Muse 提交结果待确认，请联系管理员核对后再重试",
  );
  status = 404;
  await rejects(
    () => adapter.inspect!(e, id),
    "fail",
    "Muse 中的任务记录已不存在，结果未确认；请检查后再重新生成",
  );
  status = 200;
  bytes = Buffer.from("[1]");
  await rejects(() => adapter.inspect!(e, id), "poll");
  bytes = Buffer.from(
    '{"status":"processing","started_at":"unknown"}',
    "utf16le",
  );
  assert.deepEqual(await adapter.inspect!(e, id), {
    state: "pending",
    remoteId: id,
  });
  assert.deepEqual(observations.splice(0), [
    { state: "running", started_at_reported: true },
    { job_phase: "generating" },
    "Muse 生成中",
  ]);
  bytes = Buffer.from('{"status":"done","data":[]}');
  await rejects(
    () => adapter.inspect!(e, id),
    "fail",
    "Muse 未返回可下载的成品",
  );
  const download = (url: string) =>
    adapter.downloadArtifact!({ config, url, recovering: false }, signal);
  const before = calls;
  await assert.rejects(
    download("https://elsewhere.example/v1/media/image.png"),
    (error) =>
      error instanceof ArtifactDownloadError && error.disposition === "failed",
  );
  assert.equal(calls, before);
  status = 503;
  await assert.rejects(
    download("https://muse.nvmes.com/v1/media/image.png"),
    (error) =>
      error instanceof ArtifactDownloadError && error.disposition === "retry",
  );
  assert.equal(
    requests.at(-1)!.url.href,
    config.baseUrl + "/v1/media/image.png",
  );
  const count = calls;
  for (const baseUrl of ["http://127.0.0.1", "https://127.0.0.1"]) {
    assert.equal(await adapter.health({ ...config, baseUrl }, signal), false);
  }
  assert.equal(calls, count);
});

test("Flow's installed sandbox streams split and large results, scopes service credentials and preserves recovery decisions", async () => {
  const release = JSON.parse(
    await readFile("plugins/flow/flow.fmplugin.json", "utf8"),
  );
  const config = {
    baseUrl: "https://1.1.1.1/tenant",
    publicUrl: "https://flow.example/proxy",
    apiKey: "fixture-key",
  };
  let chunks: Buffer[] = [],
    status = 200,
    disconnect = false;
  const sent: { url: string; options: Parameters<typeof chatHttp>[1] }[] = [];
  const send: typeof chatHttp = async (url, options) => {
    assert.ok(options.lookup);
    sent.push({ url: url.href, options });
    return {
      status,
      headers: {},
      body: (async function* () {
        for (const chunk of chunks) yield chunk;
        if (disconnect) throw new Error("socket closed");
      })(),
      close() {},
    };
  };
  const adapter = await sandboxRequest(
    manifestSchema.parse(release.manifest),
    release.studioProgram,
    send,
  );
  const notes: string[] = [];
  const e: Execution = {
    kind: "video",
    model: "flow:veo-3.1-quality-4s-landscape",
    config,
    jobId: randomUUID(),
    idempotencyKey: randomUUID(),
    signal: new AbortController().signal,
    input: {
      prompt: "画面",
      params: { source_media_id: "original" },
      references: [
        { id: "ref", mime: "image/png", url: "data:image/png;base64,AAAA" },
      ],
    },
    reportProviderNote: async (note) => {
      notes.push(note);
    },
  };
  const event = (content: string) =>
    Buffer.from(
      "data: " + JSON.stringify({ choices: [{ delta: { content } }] }) + "\n",
    );
  const resultUrl = "https://storage.googleapis.com/test?x=1&y=2";
  const wire = event(
    '<video data-media-id="asset/7" src="https://storage.googleapis.com/test?x=1&amp;y=2">',
  );
  const expected = {
    state: "completed",
    artifacts: [{ url: resultUrl }],
    usage: { flow_media_id: "asset/7" },
  };
  chunks = [
    wire.subarray(0, 9),
    wire.subarray(9, 15),
    wire.subarray(15),
    Buffer.from("data: [DONE]\ndata: bad\n"),
  ];
  assert.deepEqual(await adapter.submit(e), expected);
  assert.deepEqual(notes, ["Flow 正在生成"]);
  assert.equal(sent[0].url, config.baseUrl + "/v1/chat/completions");
  assert.equal(sent[0].options.key, config.apiKey);
  assert.equal(sent[0].options.readMs, 600000);
  assert.deepEqual(sent[0].options.forwarded, {
    host: "flow.example",
    scheme: "https",
  });
  assert.deepEqual((sent[0].options.body as any).messages[0].content, [
    { type: "text", text: "画面" },
    { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
    { type: "image_url", image_url: { url: "extend://original" } },
  ]);
  // One near-limit record, with non-ASCII content forcing a wide guest string.
  chunks = [event("界" + ".".repeat(7 * 1024 ** 2)), wire];
  assert.deepEqual(await adapter.submit(e), expected);
  const rejects = (message: string) =>
    assert.rejects(
      adapter.submit(e),
      (err) =>
        err instanceof RequestLifecycleError &&
        err.disposition.action === "fail" &&
        err.disposition.note === message,
    );
  chunks = [Buffer.alloc(8 * 1024 ** 2 + 1, 65)];
  await rejects("Flow 返回内容过大，未保存结果");
  chunks = [
    wire,
    Buffer.concat([
      Buffer.from("data: [DONE]\n"),
      Buffer.alloc(8 * 1024 ** 2 + 1),
    ]),
  ];
  assert.deepEqual(await adapter.submit(e), expected);
  chunks = [
    Buffer.from("data: "),
    Buffer.from(JSON.stringify({ error: { message: "captcha" } }), "utf16le"),
    Buffer.from("\n"),
  ];
  await rejects("Flow 验证码服务未通过，请管理员检查 YesCaptcha 配置与余额");
  chunks = [Buffer.from('data: {"choices":false}\n')];
  await rejects("Flow 生成或保存失败，请从后台检查结果后重试");
  chunks = [Buffer.from("private provider diagnostic: quota")];
  status = 429;
  await rejects("Flow 账号额度不足或当前模型不可用，请管理员检查账号");
  chunks = [];
  status = 200;
  disconnect = true;
  await rejects(
    "与 Flow 的连接中断，生成结果未确认；请核对后台记录后再重新生成",
  );
  disconnect = false;
  chunks = [Buffer.from("media")];
  const download = (url: string, recovering = false) =>
    adapter.downloadArtifact!({ config, url, recovering }, e.signal);
  for (const url of [resultUrl, "https://image.googleusercontent.com/x"]) {
    assert.equal(Buffer.from(await download(url)).toString(), "media");
    assert.equal(sent.at(-1)?.url, url);
    assert.equal(sent.at(-1)?.options.key, undefined);
    assert.equal(sent.at(-1)?.options.forwarded, undefined);
  }
  await download(config.publicUrl + "/tmp/cached.mp4");
  assert.equal(sent.at(-1)?.url, config.baseUrl + "/tmp/cached.mp4");
  assert.equal(sent.at(-1)?.options.key, config.apiKey);
  assert.equal(sent.at(-1)?.options.forwarded, undefined);
  const before = sent.length;
  for (const url of [
    "https://googleusercontent.com/x",
    "https://image.googleusercontent.com.example/x",
    "https://flow-content.google:8443/x",
    "http://127.0.0.1/x",
  ]) {
    await assert.rejects(download(url), /媒体地址不受支持/);
    await assert.rejects(download(url, true), /从后台检查生成结果/);
  }
  assert.equal(sent.length, before);
});
