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
