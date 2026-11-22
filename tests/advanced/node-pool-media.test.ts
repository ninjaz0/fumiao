import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ArtifactRules } from "@fumiao/plugin-sdk/node-pools.js";
import { verifyNodeArtifact } from "@fumiao/platform/node-pool-media.js";
import { wavFixture } from "../helpers/timing.js";

const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

test("pool WAV rules check the actual sample rate and channels before delivery", async () => {
  const bytes = wavFixture();
  const rules: ArtifactRules = {
    mime: "audio/wav",
    maxBytes: bytes.length,
    channels: 1,
    sampleRate: 24000,
    audioCodec: "pcm_s16le",
  };
  const info = await verifyNodeArtifact(bytes, "audio", digest(bytes), rules);
  assert.equal(info.mime, rules.mime);
  await assert.rejects(
    verifyNodeArtifact(bytes, "audio", digest(bytes), {
      ...rules,
      sampleRate: 44100,
    }),
    { status: 422 },
  );
});

test("pool video rules check dimensions, frame count, rate, codec, duration and full decode", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "fumiao-pool-rule-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "out.mp4");
  execFileSync("ffmpeg", [
    "-nostdin",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=size=32x24:rate=24",
    "-frames:v",
    "12",
    "-c:v",
    "libx264",
    "-movflags",
    "+faststart",
    file,
  ]);
  const bytes = await readFile(file);
  const rules: ArtifactRules = {
    mime: "video/mp4",
    maxBytes: bytes.length,
    width: 32,
    height: 24,
    frames: 12,
    fps: 24,
    videoCodec: "h264",
    minSeconds: 0.49,
    maxSeconds: 0.51,
  };
  assert.equal(
    (await verifyNodeArtifact(bytes, "video", digest(bytes), rules)).width,
    32,
  );
  await assert.rejects(
    verifyNodeArtifact(bytes, "video", digest(bytes), { ...rules, frames: 13 }),
    { status: 422 },
  );
  const broken = bytes.subarray(0, bytes.length - 100);
  await assert.rejects(
    verifyNodeArtifact(broken, "video", digest(broken), rules),
    { status: 422 },
  );
});
