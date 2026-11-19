import sharp from "sharp";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { requireValue } from "./security.js";
const run = promisify(execFile);
export async function inspectMedia(
  bytes: Buffer,
  kind: string,
  detailed = false,
): Promise<Record<string, any> & { mime: string }> {
  if (kind === "image") {
    const image = sharp(bytes, { limitInputPixels: 64000000 });
    const info = await image.metadata();
    const mime: Record<string, string> = {
      png: "image/png",
      jpeg: "image/jpeg",
      webp: "image/webp",
      gif: "image/gif",
      avif: "image/avif",
      heif: "image/avif",
    };
    requireValue(info.format && mime[info.format], 400, "图片格式无效");
    await image.stats();
    return { mime: mime[info.format], width: info.width, height: info.height };
  }
  const directory = await mkdtemp(join(tmpdir(), "fumiao-media-"));
  try {
    const path = join(directory, "input");
    await writeFile(path, bytes);
    const { stdout } = await run(
      "ffprobe",
      [
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        path,
      ],
      { timeout: 30000, maxBuffer: 1024 * 1024 },
    );
    const value = JSON.parse(stdout);
    const stream = value.streams?.find(
      (s: any) => s.codec_type === (kind === "video" ? "video" : "audio"),
    );
    requireValue(
      stream && Number(value.format.duration) > 0,
      400,
      "媒体内容无效",
    );
    const format = String(value.format.format_name);
    requireValue(
      kind === "video"
        ? format.includes("mp4")
        : format.includes("wav") || format.includes("mp3"),
      400,
      "媒体封装格式不支持",
    );
    return {
      mime:
        kind === "video"
          ? "video/mp4"
          : format.includes("wav")
            ? "audio/wav"
            : "audio/mpeg",
      duration: Number(value.format.duration),
      width: stream.width,
      height: stream.height,
      ...(detailed && kind === "video"
        ? { fps: stream.avg_frame_rate ?? null }
        : {}),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
