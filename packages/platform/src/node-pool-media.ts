import { roundDecimal } from "@fumiao/plugin-sdk/decimal.js";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ArtifactRules } from "@fumiao/plugin-sdk/node-pools.js";
import sharp from "sharp";
import { DomainError, requireValue } from "./security.js";

const run = promisify(execFile);
let active = 0;
export async function verifyNodeArtifact(
  bytes: Buffer,
  kind: string,
  digest: string | undefined,
  rules: ArtifactRules,
) {
  requireValue(
    rules.mime.startsWith(kind + "/"),
    422,
    "成片规则与任务类型不符",
  );
  requireValue(
    bytes.length > 0 && bytes.length <= rules.maxBytes,
    422,
    "成片大小不符",
  );
  requireValue(
    createHash("sha256").update(bytes).digest("hex") === digest,
    422,
    "成片摘要不符",
  );
  requireValue(active < 2, 503, "成片验收繁忙");
  active++;
  try {
    if (kind === "image") {
      const image = sharp(bytes, {
        limitInputPixels: 64_000_000,
        failOn: "warning",
      }).timeout({ seconds: 15 });
      const info = await image.metadata();
      requireValue(
        "image/" + info.format === rules.mime &&
          (info.pages ?? 1) === 1 &&
          (!rules.width || info.width === rules.width) &&
          (!rules.height || info.height === rules.height),
        422,
        "图片格式或尺寸不符",
      );
      await image.stats();
      return { mime: rules.mime, width: info.width, height: info.height };
    }
    const directory = await mkdtemp(join(tmpdir(), "fumiao-node-result-"));
    try {
      const file = join(directory, "result");
      await writeFile(file, bytes, { mode: 0o600 });
      const input = [
        "-v",
        "error",
        "-protocol_whitelist",
        "file",
        "-f",
        kind === "video" ? "mov" : "wav",
      ];
      const options = {
        timeout: 15000,
        maxBuffer: 1024 * 1024,
        killSignal: "SIGKILL" as const,
      };
      const probe = await run(
        "ffprobe",
        [...input, "-show_streams", "-show_format", "-of", "json", file],
        options,
      );
      const { streams, format } = JSON.parse(probe.stdout);
      const video = streams.find(
        (s: { codec_type: string }) => s.codec_type === "video",
      );
      const audio = streams.find(
        (s: { codec_type: string }) => s.codec_type === "audio",
      );
      const seconds = Number(format.duration);
      if (rules.unrotated) {
        const rotations = [
          video?.tags?.rotate,
          ...(video?.side_data_list ?? []).map(
            (s: { rotation?: number }) => s.rotation,
          ),
        ].filter((v) => v !== undefined);
        requireValue(
          rotations.every((r) => Number(r) % 360 === 0),
          422,
          "视频旋转与成片规则不符",
        );
      }
      if (rules.minPeak) {
        requireValue(
          kind === "audio" && rules.audioCodec === "pcm_s16le",
          422,
          "音频峰值规则无效",
        );
        const pcm = await run(
          "ffmpeg",
          [
            "-nostdin",
            "-xerror",
            ...input,
            "-i",
            file,
            "-map",
            "0:a:0",
            "-f",
            "s16le",
            "pipe:1",
          ],
          {
            ...options,
            encoding: "buffer",
            maxBuffer: Math.min(bytes.length, 64 << 20),
          },
        );
        let peak = 0;
        for (let i = 0; i + 1 < pcm.stdout.length; i += 2)
          peak = Math.max(peak, Math.abs(pcm.stdout.readInt16LE(i)));
        requireValue(
          peak >= rules.minPeak &&
            pcm.stdout.length ===
              Number(audio?.channels) * Number(audio?.duration_ts) * 2,
          422,
          "音频静音或内容不完整",
        );
      }
      const [num, den] = String(video?.avg_frame_rate).split("/").map(Number);
      requireValue(
        (kind === "video" ? video : audio) &&
          Number.isFinite(seconds) &&
          seconds > 0 &&
          seconds >= (rules.minSeconds ?? 0) &&
          seconds <= (rules.maxSeconds ?? 7200) &&
          (!rules.width || rules.width === video?.width) &&
          (!rules.height || rules.height === video?.height) &&
          (!rules.frames || rules.frames === Number(video?.nb_frames)) &&
          (!rules.fps || rules.fps === num / den) &&
          (!rules.videoCodec || rules.videoCodec === video?.codec_name) &&
          (!rules.audioCodec || rules.audioCodec === audio?.codec_name) &&
          (!rules.channels || rules.channels === audio?.channels) &&
          (!rules.sampleRate ||
            rules.sampleRate === Number(audio?.sample_rate)),
        422,
        "成片音视频参数不符",
      );
      const decoded = await run(
        "ffmpeg",
        [
          "-nostdin",
          "-xerror",
          "-progress",
          "pipe:1",
          ...input,
          "-threads",
          "2",
          "-i",
          file,
          "-map",
          "0:v?",
          "-map",
          "0:a?",
          "-fps_mode",
          "passthrough",
          "-f",
          "null",
          "-",
        ],
        { ...options, timeout: 90000 },
      );
      if (video) {
        // A truncated fast-start MP4 may reach EOF with a successful decoder
        // exit. Compare emitted frames with the frozen rule and sample table.
        const frames = Number(
          [...decoded.stdout.matchAll(/^frame=(\d+)$/gm)].at(-1)?.[1],
        );
        requireValue(
          frames > 0 &&
            (!rules.frames || frames === rules.frames) &&
            (!Number(video.nb_frames) || frames === Number(video.nb_frames)),
          422,
          "成片解码帧数不符",
        );
      }
      return {
        mime: rules.mime,
        duration: kind === "audio" ? roundDecimal(seconds, 3) : seconds,
        ...(kind === "audio"
          ? {
              sample_rate: Number(audio.sample_rate),
              channels: audio.channels,
              format: "wav",
            }
          : {}),
        width: video?.width ?? 0,
        height: video?.height ?? 0,
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError(422, "成片未通过完整解码");
  } finally {
    active--;
  }
}
