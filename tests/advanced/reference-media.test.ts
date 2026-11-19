import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  readdir,
  stat,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { Readable } from "node:stream";
import { databaseFixture } from "../helpers/database.js";
import { OriginalIdentity } from "../../packages/original-api/src/identity.js";
import { createOriginalApp } from "../../apps/api/src/original.js";
import { StudioCatalog } from "../../packages/platform/src/catalog.js";
import { PluginRegistry } from "../../packages/platform/src/plugins.js";
import { importLegacy } from "../../packages/platform/src/importer.js";
import { S3Storage } from "../../packages/platform/src/storage.js";
import { gpuReferences } from "../../plugins/gpu/src/references.js";
import {
  normalizeReference,
  ReferenceImporter,
  mediaCommand,
} from "../../plugins/gpu/src/reference-media.js";
import {
  ReferenceImportBusyError,
  type ReferenceResult,
  type ProviderPlugin,
} from "../../packages/plugin-sdk/src/index.js";
const info: ReferenceResult = {
  seconds: 2,
  fps: 24,
  has_audio: false,
  w: 96,
  h: 64,
  mime: "video/mp4",
  size: 3,
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const signal = () => new AbortController().signal;

test("real H3 conversion normalizes streams without metadata and rejects wrong or short media", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fumiao-reference-test-"));
  try {
    const input = join(directory, "av.mkv"),
      video = join(directory, "video.mp4"),
      audio = join(directory, "audio.wav");
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
        "testsrc2=size=96x64:rate=25:duration=2",
        "-f",
        "lavfi",
        "-i",
        "sine=duration=2:sample_rate=44100",
        "-c:v",
        "libx264",
        "-threads",
        "2",
        "-c:a",
        "pcm_s16le",
        "-metadata",
        "title=private fixture",
        input,
      ],
      { stdio: "pipe" },
    );
    const v = await normalizeReference(input, video, "video", signal());
    assert.equal(v.fps, 24);
    assert.equal(v.has_audio, true);
    assert.equal(v.w, 96);
    assert.equal(v.h, 64);
    assert.equal(v.size, (await stat(video)).size);
    assert.equal(v.mime, "video/mp4");
    const metadata = JSON.parse(
      execFileSync(
        "ffprobe",
        ["-v", "error", "-show_streams", "-show_format", "-of", "json", video],
        { encoding: "utf8" },
      ),
    );
    assert.equal(metadata.format.tags.title, undefined);
    assert.equal(metadata.streams[0].avg_frame_rate, "24/1");
    assert.equal(metadata.streams[0].codec_name, "h264");
    assert.equal(metadata.streams[1].sample_rate, "32000");
    assert.equal(metadata.streams[1].channels, 2);
    const a = await normalizeReference(input, audio, "audio", signal());
    assert.equal(a.fps, 0);
    assert.equal(a.has_audio, true);
    assert.equal(a.w, 0);
    assert.equal(a.h, 0);
    assert.equal(a.mime, "audio/wav");
    await assert.rejects(
      normalizeReference(
        audio,
        join(directory, "wrong.mp4"),
        "video",
        signal(),
      ),
      { message: "请选择包含画面的视频文件" },
    );
    await writeFile(join(directory, "bad"), "invalid");
    await assert.rejects(
      normalizeReference(
        join(directory, "bad"),
        join(directory, "bad.wav"),
        "audio",
        signal(),
      ),
      { message: "无法读取这个视频或音频文件" },
    );
    execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=32000:cl=stereo:d=1.98",
        join(directory, "short.wav"),
      ],
      { stdio: "pipe" },
    );
    await assert.rejects(
      normalizeReference(
        join(directory, "short.wav"),
        join(directory, "short-out.wav"),
        "audio",
        signal(),
      ),
      { message: "参考视频和音频的时长需为 2–15 秒" },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reference slots bound concurrency, cancel queued work and wait for active cancellation cleanup", async () => {
  const entered = deferred(),
    release = deferred(),
    started: string[] = [];
  const pool = new ReferenceImporter(1, 1, async (input, _output, _kind, s) => {
    started.push(input);
    if (input === "first") {
      entered.resolve();
      await release.promise;
      s.throwIfAborted();
    }
    return info;
  });
  const first = new AbortController(),
    queued = new AbortController();
  const pending = pool.import("first", "out", "video", first.signal);
  const failed = assert.rejects(pending, { message: "disconnect" });
  await entered.promise;
  const second = pool.import("second", "out", "video", queued.signal),
    cancelled = assert.rejects(second, { message: "queued disconnect" });
  await assert.rejects(
    pool.import("overflow", "out", "video", signal()),
    ReferenceImportBusyError,
  );
  queued.abort(new Error("queued disconnect"));
  await cancelled;
  const third = pool.import("third", "out", "video", signal());
  first.abort(new Error("disconnect"));
  await Promise.resolve();
  assert.deepEqual(started, ["first"]);
  await assert.rejects(
    pool.import("still full", "out", "video", signal()),
    ReferenceImportBusyError,
  );
  release.resolve();
  await failed;
  assert.deepEqual(await third, info);
  assert.deepEqual(started, ["first", "third"]);
  const aborted = AbortSignal.abort(new Error("pre-aborted"));
  await assert.rejects(pool.import("never", "out", "video", aborted), {
    message: "pre-aborted",
  });
  const syncFailure = new ReferenceImporter(1, 1, () => {
    throw Error("synchronous failure");
  });
  await assert.rejects(
    syncFailure.import("x", "out", "video", signal()),
    /synchronous failure/,
  );
  await assert.rejects(
    syncFailure.import("again", "out", "video", signal()),
    /synchronous failure/,
  );
});

test("media subprocesses are reaped on disconnect, timeout and excessive output without exposing diagnostics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fumiao-reference-process-"));
  try {
    const pidFile = join(directory, "pid"),
      controller = new AbortController();
    const pending = mediaCommand(
      process.execPath,
      [
        "-e",
        "require('fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)",
        pidFile,
      ],
      10000,
      controller.signal,
    );
    const failed = assert.rejects(pending, { message: "disconnected" });
    let pid = 0;
    for (let i = 0; i < 100; i++) {
      try {
        pid = Number(await readFile(pidFile, "utf8"));
        if (pid) break;
      } catch {}
      await delay(20);
    }
    assert.ok(pid);
    controller.abort(new Error("disconnected"));
    await failed;
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    await assert.rejects(
      mediaCommand(
        process.execPath,
        ["-e", "setInterval(()=>{},1000)"],
        100,
        signal(),
      ),
      /timed out/,
    );
    for (const stream of ["stdout", "stderr"])
      await assert.rejects(
        mediaCommand(
          process.execPath,
          [
            "-e",
            `process.${stream}.write('x'.repeat(2<<20));setInterval(()=>{},1000)`,
          ],
          3000,
          signal(),
        ),
        /output exceeds limit/,
      );
    await assert.rejects(
      mediaCommand(
        process.execPath,
        [
          "-e",
          "process.stderr.write('private provider secret');process.exit(2)",
        ],
        3000,
        signal(),
      ),
      { message: "Media process failed" },
    );
    assert.equal(
      await mediaCommand(
        process.execPath,
        ["-e", "process.stdout.write('recovered')"],
        3000,
        signal(),
      ),
      "recovered",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reference converter removes partial output when conversion or post-conversion validation fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fumiao-reference-failed-")),
    out = join(directory, "out.mp4");
  try {
    for (const failure of ["command", "size", "probe"]) {
      let probes = 0;
      await assert.rejects(
        normalizeReference("in", out, "video", signal(), async (command) => {
          if (command === "ffmpeg") {
            await writeFile(out, "partial");
            if (failure === "command") throw Error("secret");
            return "";
          }
          probes++;
          if (probes === 2 && failure === "probe") throw Error("bad output");
          return JSON.stringify({
            format: { duration: probes === 2 && failure === "size" ? 16 : 2 },
            streams: [{ codec_type: "video", width: 96, height: 64 }],
          });
        }),
        {
          message:
            failure === "command"
              ? "素材转换失败，请更换文件后重试"
              : failure === "probe"
                ? "无法读取这个视频或音频文件"
                : "参考素材超过时长或大小限制，请先裁短后上传",
        },
      );
      await assert.rejects(stat(out), { code: "ENOENT" });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function httpFixture() {
  const f = await databaseFixture(),
    identity = new OriginalIdentity(f.p),
    password = "reference-test-password";
  await f.p.registry.installBuiltins(f.db);
  await identity.bootstrap({ name: "admin", nickname: "管理员", password });
  const token = await identity.login({ name: "admin", password }, "fixture");
  const stages: string[] = [];
  const plugin: ProviderPlugin = {
    ...gpuReferences,
    importReference: async (input, output) => {
      stages.push(dirname(input));
      await writeFile(output, "abc");
      return info;
    },
  };
  f.p.registry = new PluginRegistry([plugin]);
  const app = await createOriginalApp(f.p);
  await app.listen(0, "127.0.0.1");
  const url = await app.getUrl();
  return {
    ...f,
    app,
    url,
    token,
    plugin,
    stages,
    async activate() {
      await f.db.transaction((sql) =>
        new StudioCatalog(f.db).activate(sql, gpuReferences.manifest),
      );
    },
    async send() {
      const r = await fetch(url + "/api/h3/references?kind=video", {
        method: "POST",
        headers: {
          Cookie: "fm_session=" + token,
          "X-Workspace-Id": "1",
          "Content-Type": "application/octet-stream",
        },
        body: "input",
      });
      return { status: r.status, body: (await r.json()) as any };
    },
    async finish() {
      await app.close();
      await f.cleanup();
    },
  };
}

test("reference conversion is opt-in and versioned; only installed local capabilities can register", async () => {
  const f = await httpFixture();
  try {
    assert.equal((await f.send()).status, 503);
    assert.deepEqual(f.stages, []);
    const remote = structuredClone(gpuReferences.manifest);
    remote.id = "remote-reference";
    remote.mode = "request";
    await assert.rejects(
      f.p.registry.install(f.db, remote, "https://fixture.invalid"),
      { status: 400, message: "参考素材转换需要已安装的本地适配器" },
    );
    await assert.rejects(f.p.registry.install(f.db, remote), {
      status: 400,
      message: "参考素材转换需要已安装的本地适配器",
    });
    await f.activate();
    assert.equal((await f.send()).status, 200);
    const row = (await f.db.query("SELECT * FROM asset_reference_media"))
      .rows[0];
    assert.equal(row.plugin_id, gpuReferences.manifest.id);
    assert.equal(row.plugin_version, "1.4.0");
    const storageStat = await stat(join(f.directory, row.asset_id));
    assert.equal(storageStat.mode & 0o777, 0o600);
    for (const path of f.stages)
      await assert.rejects(stat(path), { code: "ENOENT" });
    const prior = await new PluginRegistry().resolve(
      f.db,
      gpuReferences.manifest.id,
      "1.3.0",
    );
    assert.equal(prior.importReference, undefined);
  } finally {
    await f.finish();
  }
});

test("reference uploads roll back private objects and metadata on partial writes, quota races, or invalid plugin output", async () => {
  const f = await httpFixture();
  try {
    await f.activate();
    const putFile = f.p.storage.putFile!.bind(f.p.storage),
      convert = f.plugin.importReference!;
    f.p.storage.putFile = async (...args) => {
      await putFile(...args);
      throw Error("synthetic partial write");
    };
    assert.equal((await f.send()).status, 500);
    assert.deepEqual(await readdir(f.directory), []);
    f.p.storage.putFile = async (...args) => {
      await putFile(...args);
      await f.db.query("UPDATE storage_capacity SET quota=0");
    };
    assert.deepEqual(await f.send(), {
      status: 507,
      body: { detail: "空间不足，请先清理素材或作品" },
    });
    assert.deepEqual(await readdir(f.directory), []);
    for (const table of ["assets", "asset_reference_media"])
      assert.equal((await f.db.query("SELECT * FROM " + table)).rows.length, 0);
    await f.db.query("UPDATE storage_capacity SET quota=1000000");
    f.p.storage.putFile = putFile;
    f.plugin.importReference = async (...args) => ({
      ...(await convert(...args)),
      mime: "audio/wav",
    });
    assert.equal((await f.send()).status, 500);
    assert.deepEqual(await readdir(f.directory), []);
    f.plugin.importReference = async () => {
      throw new ReferenceImportBusyError("saturated");
    };
    assert.deepEqual(await f.send(), {
      status: 503,
      body: { detail: "请求处理失败" },
    });
    for (const path of f.stages)
      await assert.rejects(stat(path), { code: "ENOENT" });
  } finally {
    await f.finish();
  }
});

test("S3 file upload streams with length and abort signal and closes the source on errors", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fumiao-reference-s3-")),
    path = join(directory, "input"),
    storage = new S3Storage("private-fixture");
  try {
    await writeFile(path, "private bytes");
    const controller = new AbortController();
    let body: Readable | undefined;
    storage.client.send = (async (command: any, options: any) => {
      body = command.input.Body;
      assert.ok(body instanceof Readable);
      assert.equal(command.input.ContentLength, 13);
      assert.equal(command.input.ContentType, "audio/wav");
      assert.equal(command.input.Bucket, "private-fixture");
      assert.equal(options.abortSignal, controller.signal);
      const chunks = [];
      for await (const chunk of body!) chunks.push(chunk);
      assert.equal(Buffer.concat(chunks).toString(), "private bytes");
      throw Error("upload failed");
    }) as any;
    await assert.rejects(
      storage.putFile("object", path, "audio/wav", controller.signal),
      /upload failed/,
    );
    assert.equal(body!.destroyed, true);
    controller.abort(new Error("cancelled"));
    await assert.rejects(
      storage.putFile("object", path, "audio/wav", controller.signal),
      /cancelled/,
    );
  } finally {
    storage.client.destroy();
    await rm(directory, { recursive: true, force: true });
  }
});

test("legacy reference metadata is validated before writing private files", async () => {
  const f = await databaseFixture();
  try {
    const source = {
      version: 1 as const,
      source: "reference-invalid",
      tables: {
        users: [{ id: 1, role: "admin" }],
        media: [{ id: "a".repeat(32), kind: "ref_video" }],
        h3_reference_media: [
          {
            media: "a".repeat(32),
            seconds: 2,
            fps: 24,
            has_audio: 1,
            name: "视频",
          },
        ],
      },
    };
    for (const change of [
      { seconds: NaN },
      { fps: Infinity },
      { name: "😀".repeat(121) },
      { has_audio: 2 },
      { media: "b".repeat(32) },
    ]) {
      const draft = structuredClone(source);
      Object.assign(draft.tables.h3_reference_media[0], change);
      await assert.rejects(importLegacy(f.p, draft, "does-not-exist"), {
        status: 400,
        message: "旧参考素材信息无效",
      });
    }
    source.tables.h3_reference_media.push({
      ...source.tables.h3_reference_media[0],
    });
    await assert.rejects(importLegacy(f.p, source, "does-not-exist"), {
      status: 400,
      message: "旧参考素材信息无效",
    });
    assert.deepEqual(await readdir(f.directory), []);
    assert.equal((await f.db.query("SELECT * FROM assets")).rows.length, 0);
  } finally {
    await f.cleanup();
  }
});

test("disconnected reference HTTP clients cancel conversion before any durable writes", async () => {
  const f = await httpFixture(),
    entered = deferred(),
    aborted = deferred(),
    release = deferred();
  let stage = "";
  try {
    await f.activate();
    f.plugin.importReference = async (input, output, _kind, s) => {
      stage = dirname(input);
      await writeFile(output, "partial");
      s.addEventListener("abort", aborted.resolve, { once: true });
      entered.resolve();
      await release.promise;
      s.throwIfAborted();
      return info;
    };
    const controller = new AbortController();
    const pending = fetch(f.url + "/api/h3/references?kind=video", {
      method: "POST",
      headers: {
        Cookie: "fm_session=" + f.token,
        "Content-Type": "application/octet-stream",
        "X-Workspace-Id": "1",
      },
      body: "input",
      signal: controller.signal,
    });
    const rejected = assert.rejects(pending, { name: "AbortError" });
    await entered.promise;
    controller.abort();
    await rejected;
    await Promise.race([
      aborted.promise,
      delay(1000).then(() => {
        throw Error("conversion was not cancelled");
      }),
    ]);
    assert.ok(
      (await readdir(stage)).includes("reference.mp4"),
      "staging files must remain until converter exits",
    );
    release.resolve();
    let gone = false;
    for (let i = 0; i < 100; i++) {
      try {
        await stat(stage);
      } catch {
        gone = true;
        break;
      }
      await delay(10);
    }
    assert.equal(gone, true);
    assert.deepEqual(await readdir(f.directory), []);
    assert.equal((await f.db.query("SELECT * FROM assets")).rows.length, 0);
  } finally {
    release.resolve();
    await f.finish();
  }
});
