import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  imageImporter,
  ProviderImageError,
} from "../../../packages/image-import/src/index.js";
import { roundDecimal } from "../../../packages/plugin-sdk/src/decimal.js";
import { DomainError } from "../../../packages/platform/src/security.js";
import {
  ArtifactValidationError,
  type ProviderPlugin,
} from "../../../packages/plugin-sdk/src/index.js";
import { museDownload } from "./download.js";
const run = promisify(execFile);
export class ProviderMediaError extends Error {
  constructor(readonly kind: "image-format" | "image-decode" | "video") {
    super(kind);
  }
}
export async function inspectProviderMedia(
  bytes: Uint8Array,
  kind: string,
  signal: AbortSignal,
): Promise<Record<string, any> & { mime: string }> {
  const directory = await mkdtemp(join(tmpdir(), "fumiao-provider-artifact-"));
  try {
    const path = join(directory, "input");
    await writeFile(path, bytes, { mode: 0o600 });
    if (kind === "image") {
      try {
        return await imageImporter.inspect(path, signal);
      } catch (error) {
        if (error instanceof DomainError && error.status === 503)
          throw new ArtifactValidationError("媒体校验暂不可用", 503);
        throw new ProviderMediaError(
          error instanceof ProviderImageError && error.kind === "format"
            ? "image-format"
            : "image-decode",
        );
      }
    }
    try {
      const header = Buffer.from(
        bytes.buffer,
        bytes.byteOffset,
        Math.min(bytes.byteLength, 32),
      );
      const demuxer =
        header.toString("ascii", 4, 8) === "ftyp"
          ? "mov"
          : header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
            ? "matroska"
            : null;
      if (!demuxer) throw new Error("Unsupported container");
      const common = [
          "-v",
          "error",
          "-protocol_whitelist",
          "file,pipe",
          "-f",
          demuxer,
        ],
        options = {
          timeout: 30000,
          maxBuffer: 1024 * 1024,
          signal,
          killSignal: "SIGKILL" as const,
        },
        { stdout } = await run(
          "ffprobe",
          [...common, "-show_streams", "-show_format", "-of", "json", path],
          options,
        ),
        value = JSON.parse(stdout),
        video = value.streams.find((s: any) => s.codec_type === "video"),
        seconds = Number(value.format.duration);
      if (
        !(
          video.width > 0 &&
          video.width <= 8192 &&
          video.height > 0 &&
          video.height <= 8192 &&
          Number.isFinite(seconds) &&
          seconds > 0 &&
          seconds <= 120
        ) ||
        (video.side_data_list || []).some(
          (s: any) => Math.abs(Number(s.rotation || 0)) % 360 !== 0,
        ) ||
        Math.abs(Number(video.tags?.rotate || 0)) % 360 !== 0
      )
        throw new Error("Invalid video geometry or orientation");
      const format = value.format.format_name,
        mime =
          format.includes("mp4") || format.includes("mov")
            ? "video/mp4"
            : format.includes("webm")
              ? "video/webm"
              : null;
      if (!mime) throw new Error("Unsupported container");
      await run(
        "ffmpeg",
        [
          ...common,
          "-i",
          path,
          "-map",
          "0:v:0",
          "-frames:v",
          "1",
          "-f",
          "null",
          "-",
        ],
        options,
      );
      return {
        mime,
        width: video.width,
        height: video.height,
        duration: roundDecimal(seconds, 3),
        fps: video.avg_frame_rate ?? null,
      };
    } catch {
      throw new ProviderMediaError("video");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
export const museArtifacts: ProviderPlugin = {
  ...museDownload,
  manifest: {
    ...museDownload.manifest,
    version: "1.9.0",
    artifactValidation: { version: 2 },
    queue: {
      ...museDownload.manifest.queue!,
      timingVersions: [...museDownload.manifest.queue!.timingVersions, "1.9.0"],
    },
  },
  async validateArtifact(job, bytes, _receipt, signal) {
    try {
      return { metadata: await inspectProviderMedia(bytes, job.kind, signal) };
    } catch (error) {
      if (error instanceof ArtifactValidationError && error.status === 503)
        throw error;
      throw new ArtifactValidationError(
        error instanceof ProviderMediaError
          ? error.kind === "image-format"
            ? "Muse 返回的图片格式或尺寸无效"
            : error.kind === "video"
              ? "Muse 返回的视频无法验证或方向异常"
              : "Muse 成品保存失败，请检查后重新生成"
          : "Muse 成品保存失败，请检查后重新生成",
      );
    }
  },
};
