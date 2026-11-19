import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import { ImageImporter } from "../../packages/image-import/src/index.js";

test("image workers enforce queue bounds, cancel queued/active work and recover the slot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fumiao-worker-test-"));
  try {
    const input = join(directory, "source"),
      first = join(directory, "first"),
      queued = join(directory, "queued"),
      output = join(directory, "out");
    const bytes = await sharp({
      create: { width: 17, height: 19, channels: 3, background: "#235678" },
    })
      .png()
      .toBuffer();
    await writeFile(input, bytes);
    const importer = new ImageImporter(1, 1),
      active = new AbortController(),
      waiting = new AbortController();
    const a = importer.convert(input, first, "reference", active.signal);
    const b = importer.convert(input, queued, "reference", waiting.signal);
    const aError = assert.rejects(a, /active stopped/),
      bError = assert.rejects(b, /queued stopped/);
    await assert.rejects(importer.convert(input, output, "reference"), {
      status: 503,
    });
    waiting.abort(new Error("queued stopped"));
    active.abort(new Error("active stopped"));
    await Promise.all([aError, bError]);
    await assert.rejects(access(queued));
    const result = await importer.convert(input, output, "reference");
    assert.equal(result.converted, false);
    assert.deepEqual(await readFile(output), bytes);
    await writeFile(input, Buffer.from("broken image"));
    await assert.rejects(importer.convert(input, output, "reference"), {
      status: 400,
      message: "无法读取图片，文件可能已损坏或格式不受支持",
    });
    const stopped = AbortSignal.abort(new Error("already cancelled"));
    await assert.rejects(
      importer.convert(input, output, "avatar", stopped),
      /already cancelled/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("image worker timeout terminates decoding and resolves every waiting request", async () => {
  const importer = new ImageImporter(1, 2, 1);
  const jobs = [
    importer.convert("missing", "unused", "avatar"),
    importer.convert("missing", "unused", "avatar"),
  ];
  const results = await Promise.allSettled(jobs);
  for (const result of results) {
    assert.equal(result.status, "rejected");
    if (result.status === "rejected") assert.equal(result.reason.status, 503);
  }
});

test("cancellation waits for an external decoder to exit before releasing its staging files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fumiao-child-test-")),
    previousPath = process.env.PATH;
  try {
    const input = join(directory, "source.bmp"),
      output = join(directory, "result"),
      started = join(directory, "started"),
      finished = join(directory, "finished");
    const bmp = Buffer.alloc(54 + 16 * 16 * 3);
    bmp.write("BM");
    bmp.writeUInt32LE(bmp.length, 2);
    bmp.writeUInt32LE(54, 10);
    bmp.writeUInt32LE(40, 14);
    bmp.writeInt32LE(16, 18);
    bmp.writeInt32LE(16, 22);
    bmp.writeUInt16LE(1, 26);
    bmp.writeUInt16LE(24, 28);
    await writeFile(input, bmp);
    await writeFile(
      join(directory, "ffmpeg"),
      `#!${process.execPath}\nconst fs=require('node:fs');fs.writeFileSync(${JSON.stringify(started)},'started');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,400);fs.writeFileSync(${JSON.stringify(finished)},'exited');process.stdout.write(Buffer.alloc(16*16*3));\n`,
      { mode: 0o700 },
    );
    process.env.PATH = directory + ":" + previousPath;
    const controller = new AbortController(),
      importer = new ImageImporter(),
      job = importer.convert(input, output, "avatar", controller.signal);
    const rejected = assert.rejects(job, /cancel decoder/);
    for (let i = 0; ; i++) {
      try {
        await access(started);
        break;
      } catch {
        if (i > 500) throw new Error("Decoder did not start");
        await delay(10);
      }
    }
    controller.abort(new Error("cancel decoder"));
    await rejected;
    assert.equal(await readFile(finished, "utf8"), "exited");
    await assert.rejects(access(output));
  } finally {
    process.env.PATH = previousPath;
    await rm(directory, { recursive: true, force: true });
  }
});
