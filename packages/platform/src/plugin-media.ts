import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { z } from "zod";
import { capacity } from "./capacity.js";
import { one, type Sql } from "./db.js";
import { mediaCommand } from "@fumiao/media-runtime/references.js";
import { DomainError, requireValue } from "./security.js";
import type { Storage } from "./storage.js";

const assetId = z.string().regex(/^[a-f0-9]{32}$/);
const format = z.enum(["mp4", "wav"]);
const parameters = {
  "media.probe": z.tuple([assetId]),
  "media.transcode": z.tuple([assetId, z.object({ format }).strict()]),
  "media.extractFrame": z.tuple([
    assetId,
    z.object({ seconds: z.number().finite().min(0).max(120) }).strict(),
  ]),
  "media.concat": z.tuple([
    z.array(assetId).min(2).max(8),
    z.object({ format }).strict(),
  ]),
};
export type MediaFunction = keyof typeof parameters;
const maxBytes = 64 << 20;
const inputFlags = [
  "-protocol_whitelist",
  "file",
  "-format_whitelist",
  "mov,matroska,webm,wav,mp3,flac,ogg,aac,png_pipe,jpeg_pipe,webp_pipe",
];
const videoScale =
  "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1";
let active = 0;

async function probe(path: string, signal: AbortSignal) {
  const raw = await mediaCommand(
    "ffprobe",
    [
      "-v",
      "error",
      ...inputFlags,
      "-show_entries",
      "format=duration:stream=codec_type,codec_name,width,height,channels,sample_rate",
      "-of",
      "json",
      path,
    ],
    10000,
    signal,
  );
  const meta = JSON.parse(raw);
  const video = meta.streams?.find(
    (s: { codec_type: string }) => s.codec_type === "video",
  );
  const audio = meta.streams?.find(
    (s: { codec_type: string }) => s.codec_type === "audio",
  );
  const seconds = Number(meta.format?.duration ?? 0);
  requireValue(
    (video || audio) &&
      Number.isFinite(seconds) &&
      seconds >= 0 &&
      seconds <= 120 &&
      (!video ||
        (video.width > 0 &&
          video.height > 0 &&
          video.width * video.height <= 16_777_216)),
    413,
    "媒体时长或尺寸超过上限",
  );
  return {
    seconds,
    width: Number(video?.width ?? 0),
    height: Number(video?.height ?? 0),
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    channels: Number(audio?.channels ?? 0),
    sampleRate: Number(audio?.sample_rate ?? 0),
  };
}

// One action owns the new objects until its database transaction commits.
export class PluginMedia {
  private readonly staged = new Set<string>();
  constructor(private readonly storage: Storage) {}
  async rollback() {
    await Promise.all([...this.staged].map((key) => this.storage.remove(key)));
  }
  async call(
    sql: Sql,
    workspace: string,
    actor: string,
    fn: MediaFunction,
    argv: unknown[],
    signal: AbortSignal,
  ) {
    const parsed = parameters[fn].safeParse(argv);
    requireValue(parsed.success, 400, "媒体操作参数无效");
    requireValue(active < 2, 429, "媒体处理繁忙");
    active++;
    let dir: string | undefined;
    try {
      dir = await mkdtemp(join(tmpdir(), "fumiao-plugin-media-"));
      const [source, options] = parsed.data;
      const ids = Array.isArray(source) ? source : [source];
      const inputs: string[] = [];
      const metadata = [];
      let bytes = 0;
      for (const [i, id] of ids.entries()) {
        signal.throwIfAborted();
        const row = await one(
          sql,
          "SELECT object_key,size,mime FROM assets WHERE public_id=$1 AND workspace_id=$2 AND state='ready' FOR KEY SHARE",
          [id, workspace],
        );
        requireValue(row, 404, "无法访问这个素材");
        requireValue(
          bytes + Number(row.size) <= maxBytes,
          413,
          "输入素材超过 64 MB",
        );
        const path = join(dir, String(i));
        const meter = new Transform({
          transform(chunk, _encoding, done) {
            bytes += chunk.length;
            done(
              bytes > maxBytes
                ? new DomainError(413, "输入素材超过 64 MB")
                : null,
              chunk,
            );
          },
        });
        await pipeline(
          await this.storage.stream(
            row.object_key,
            undefined,
            undefined,
            signal,
          ),
          meter,
          createWriteStream(path, { mode: 0o600 }),
          { signal },
        );
        const info = await probe(path, signal);
        if (fn === "media.probe") return { id, mime: row.mime, ...info };
        inputs.push(path);
        metadata.push(info);
      }
      requireValue(
        metadata.reduce((sum, m) => sum + m.seconds, 0) <= 120,
        413,
        "素材总时长超过 120 秒",
      );
      const ext = options && "format" in options ? options.format : "png";
      const out = join(dir, "output." + ext);
      const args = [
        "-v",
        "error",
        "-xerror",
        "-nostdin",
        "-filter_complex_threads",
        "1",
      ];
      for (const input of inputs)
        args.push(...inputFlags, "-threads", "2", "-i", input);
      if (ext === "png") {
        const seconds = options && "seconds" in options ? options.seconds : 0;
        requireValue(
          metadata[0].width && (seconds === 0 || seconds < metadata[0].seconds),
          400,
          "抽帧位置无效",
        );
        args.push(
          "-ss",
          String(seconds),
          "-map",
          "0:v:0",
          "-vf",
          videoScale,
          "-frames:v",
          "1",
          "-an",
        );
      } else {
        const video = ext === "mp4",
          audio = metadata.every((m) => m.audioCodec);
        requireValue(
          video ? metadata.every((m) => m.videoCodec) : audio,
          400,
          "素材缺少所需轨道",
        );
        requireValue(
          !video || audio || metadata.every((m) => !m.audioCodec),
          400,
          "拼接视频的音轨数量不一致",
        );
        const filters: string[] = [];
        let labels = "";
        for (let i = 0; i < inputs.length; i++) {
          if (video) {
            filters.push(
              `[${i}:v:0]${videoScale}${inputs.length > 1 ? ",pad=1280:720:(ow-iw)/2:(oh-ih)/2" : ""},fps=24,format=yuv420p,setpts=PTS-STARTPTS[v${i}]`,
            );
            labels += `[v${i}]`;
          }
          if (audio) {
            filters.push(
              `[${i}:a:0]aresample=32000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}]`,
            );
            labels += `[a${i}]`;
          }
        }
        filters.push(
          labels +
            `concat=n=${inputs.length}:v=${Number(video)}:a=${Number(audio)}` +
            (video ? "[v]" : "") +
            (audio ? "[a]" : ""),
        );
        args.push("-filter_complex", filters.join(";"));
        if (video)
          args.push(
            "-map",
            "[v]",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
          );
        if (audio)
          args.push("-map", "[a]", "-c:a", video ? "aac" : "pcm_s16le");
      }
      args.push(
        "-map_metadata",
        "-1",
        "-map_chapters",
        "-1",
        "-threads",
        "2",
        "-t",
        "121",
        "-fs",
        String(maxBytes),
        out,
      );
      await mediaCommand("ffmpeg", args, 90000, signal);
      const size = (await stat(out)).size;
      requireValue(size > 0 && size < maxBytes, 413, "输出素材大小无效");
      const info = await probe(out, signal);
      const expectedSeconds = metadata.reduce(
        (sum, item) => sum + item.seconds,
        0,
      );
      requireValue(
        ext === "png"
          ? info.videoCodec === "png"
          : (ext === "wav"
              ? info.audioCodec === "pcm_s16le"
              : info.videoCodec === "h264") &&
              info.seconds > 0 &&
              info.seconds >=
                expectedSeconds - Math.max(0.1, inputs.length / 24),
        422,
        "输出素材不完整",
      );
      const mime = { png: "image/png", mp4: "video/mp4", wav: "audio/wav" }[
        ext
      ];
      const id = randomUUID();
      await capacity(sql, this.storage, size);
      signal.throwIfAborted();
      this.staged.add(id);
      try {
        if (this.storage.putFile)
          await this.storage.putFile(id, out, mime, signal);
        else await this.storage.put(id, await readFile(out), mime);
        signal.throwIfAborted();
        const asset = await one(
          sql,
          `INSERT INTO assets(id,workspace_id,owner_id,object_key,mime,size,state,metadata,original_kind)
          VALUES($1::uuid,$2,$3,$1::uuid::text,$4,$5,'ready',$6,$7) RETURNING public_id`,
          [
            id,
            workspace,
            actor,
            mime,
            size,
            JSON.stringify({ ...info, duration: info.seconds }),
            mime.split("/")[0],
          ],
        );
        return { id: asset.public_id, mime, ...info };
      } catch (error) {
        await this.storage.remove(id);
        this.staged.delete(id);
        throw error;
      }
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(422, "媒体处理失败");
    } finally {
      try {
        if (dir) await rm(dir, { recursive: true, force: true });
      } finally {
        active--;
      }
    }
  }
}
