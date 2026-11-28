import { spawn } from "node:child_process";
import { stat, rm } from "node:fs/promises";
import {
  ReferenceImportError,
  ReferenceImportBusyError,
  type ReferenceKind,
  type ReferenceResult,
} from "@fumiao/plugin-sdk/references.js";
import { roundDecimal } from "@fumiao/plugin-sdk/decimal.js";

const formats = "mov,matroska,webm,wav,mp3,flac,ogg,aac";
type Command = (
  command: string,
  args: string[],
  timeout: number,
  signal: AbortSignal,
  failOnStderr?: boolean,
) => Promise<string>;
/** A killed process is reaped before its slot and staging files are released. */
export const mediaCommand: Command = (
  command,
  args,
  timeout,
  signal,
  failOnStderr,
) =>
  new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const output: Buffer[] = [];
    let size = 0,
      error: Error | undefined;
    const stop = (reason: Error) => {
      error ??= reason;
      child.kill("SIGKILL");
    };
    const abort = () =>
      stop(
        signal.reason instanceof Error
          ? signal.reason
          : new Error("Media conversion aborted"),
      );
    const timer = setTimeout(
      () => stop(new Error("Media conversion timed out")),
      timeout,
    );
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1 << 20) stop(new Error("Media probe output exceeds limit"));
      else output.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      if (failOnStderr) stop(new Error("Media decoder reported an error"));
      size += chunk.length;
      if (size > 1 << 20) stop(new Error("Media process output exceeds limit"));
    });
    child.once("error", (e) => {
      error ??= e;
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error || code !== 0)
        reject(error ?? new Error("Media process failed"));
      else resolve(Buffer.concat(output).toString("utf8"));
    });
  });
const numeric = (v: unknown) => {
  const value = Number(v);
  return Number.isFinite(value) ? value : 0;
};
async function probe(path: string, signal: AbortSignal, command: Command) {
  try {
    const value = JSON.parse(
      await command(
        "ffprobe",
        [
          "-v",
          "error",
          "-protocol_whitelist",
          "file,pipe",
          "-format_whitelist",
          formats,
          "-show_entries",
          "format=duration:stream=codec_type,width,height,duration,avg_frame_rate:stream_disposition=attached_pic",
          "-of",
          "json",
          path,
        ],
        20000,
        signal,
      ),
    );
    const streams: any[] = value.streams || [];
    return {
      seconds: Math.max(
        numeric(value.format?.duration),
        ...streams.map((s) => numeric(s.duration)),
      ),
      video: streams.find(
        (s) => s.codec_type === "video" && !s.disposition?.attached_pic,
      ),
      audio: streams.find((s) => s.codec_type === "audio"),
    };
  } catch (e) {
    signal.throwIfAborted();
    throw new ReferenceImportError("无法读取这个视频或音频文件");
  }
}
export async function normalizeReference(
  input: string,
  output: string,
  kind: ReferenceKind,
  signal: AbortSignal,
  command: Command = mediaCommand,
): Promise<ReferenceResult> {
  const meta = await probe(input, signal, command);
  if (meta.seconds < 1.99 || meta.seconds > 15.05)
    throw new ReferenceImportError("参考视频和音频的时长需为 2–15 秒");
  if (kind === "video" && !meta.video)
    throw new ReferenceImportError("请选择包含画面的视频文件");
  if (kind === "audio" && !meta.audio)
    throw new ReferenceImportError("请选择包含声音的音频文件");
  if (
    meta.video &&
    numeric(meta.video.width) * numeric(meta.video.height) > 33177600
  )
    throw new ReferenceImportError("参考视频画面过大，请先缩小后上传");
  const args = [
    "-v",
    "error",
    "-nostdin",
    "-y",
    "-protocol_whitelist",
    "file,pipe",
    "-format_whitelist",
    formats,
    "-i",
    input,
    "-t",
    "15.5",
    "-map_metadata",
    "-1",
    "-map_chapters",
    "-1",
  ];
  if (kind === "video")
    args.push(
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-vf",
      "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=24,setsar=1",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "22",
      "-pix_fmt",
      "yuv420p",
      "-threads",
      "2",
      "-c:a",
      "aac",
      "-ar",
      "32000",
      "-ac",
      "2",
      "-movflags",
      "+faststart",
    );
  else
    args.push(
      "-map",
      "0:a:0",
      "-vn",
      "-c:a",
      "pcm_s16le",
      "-ar",
      "32000",
      "-ac",
      "2",
    );
  try {
    try {
      await command("ffmpeg", [...args, output], 90000, signal);
    } catch (e) {
      signal.throwIfAborted();
      throw new ReferenceImportError("素材转换失败，请更换文件后重试");
    }
    const result = await probe(output, signal, command),
      size = (await stat(output)).size;
    if (result.seconds < 1.99 || result.seconds > 15.05 || size > 64 << 20)
      throw new ReferenceImportError(
        "参考素材超过时长或大小限制，请先裁短后上传",
      );
    return {
      seconds: roundDecimal(result.seconds, 4),
      fps: kind === "video" ? 24 : 0,
      has_audio: !!result.audio,
      w: result.video?.width || 0,
      h: result.video?.height || 0,
      mime: kind === "video" ? "video/mp4" : "audio/wav",
      size,
    };
  } catch (e) {
    await rm(output, { force: true });
    signal.throwIfAborted();
    if (e instanceof ReferenceImportError) throw e;
    throw new ReferenceImportError("素材转换失败，请更换文件后重试");
  }
}

type Waiting = {
  run: () => Promise<ReferenceResult>;
  signal: AbortSignal;
  resolve: (value: ReferenceResult) => void;
  reject: (reason: unknown) => void;
  abort: () => void;
};
export class ReferenceImporter {
  private active = 0;
  private queue: Waiting[] = [];
  constructor(
    readonly concurrency = 2,
    readonly maxQueued = 32,
    readonly convert = normalizeReference,
  ) {
    if (
      !Number.isInteger(concurrency) ||
      concurrency < 1 ||
      concurrency > 8 ||
      !Number.isInteger(maxQueued) ||
      maxQueued < 0
    )
      throw Error("Invalid reference conversion limits");
  }
  async import(
    input: string,
    output: string,
    kind: ReferenceKind,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    if (this.active >= this.concurrency && this.queue.length >= this.maxQueued)
      throw new ReferenceImportBusyError("Reference conversion queue is full");
    return new Promise<ReferenceResult>((resolve, reject) => {
      const job: Waiting = {
        run: () => this.convert(input, output, kind, signal),
        signal,
        resolve,
        reject,
        abort: () => {
          const i = this.queue.indexOf(job);
          if (i >= 0) {
            this.queue.splice(i, 1);
            reject(signal.reason);
          }
        },
      };
      signal.addEventListener("abort", job.abort, { once: true });
      this.queue.push(job);
      this.drain();
    });
  }
  private drain() {
    while (this.active < this.concurrency && this.queue.length) {
      const job = this.queue.shift()!;
      job.signal.removeEventListener("abort", job.abort);
      if (job.signal.aborted) {
        job.reject(job.signal.reason);
        continue;
      }
      this.active++;
      void Promise.resolve()
        .then(job.run)
        .finally(() => {
          this.active--;
          this.drain();
        })
        .then(job.resolve, job.reject);
    }
  }
}
export const referenceImporter = new ReferenceImporter();
