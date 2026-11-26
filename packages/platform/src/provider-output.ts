import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  imageImporter,
  ProviderImageError,
} from "@fumiao/image-import/index.js";
import { mediaCommand } from "@fumiao/media-runtime/references.js";
import { roundDecimal } from "@fumiao/plugin-sdk/decimal.js";
import {
  ArtifactValidationError,
  type ProviderMediaPolicy,
} from "@fumiao/plugin-sdk/preparation.js";
import { DomainError } from "./security.js";

// This validator runs before persistence and settlement. The package selects
// user-facing errors; input paths, accepted containers and commands stay local.
export async function inspectProviderOutput(
  policy: ProviderMediaPolicy,
  bytes: Uint8Array,
  kind: string,
  recovering: boolean,
  signal: AbortSignal,
): Promise<Record<string, unknown> & { mime: string }> {
  signal.throwIfAborted();
  const errors = policy.errors;
  const failure = (message: string) =>
    new ArtifactValidationError((recovering && errors.recovering) || message);
  if (bytes.byteLength > 64 * 1024 * 1024)
    throw new ArtifactValidationError("成品超过 64 MB，未保存", 413);
  if (kind !== "image" && kind !== "video" && kind !== "audio")
    throw failure(errors.failed);
  const directory = await mkdtemp(join(tmpdir(), "fumiao-provider-output-"));
  try {
    const path = join(directory, "input");
    await writeFile(path, bytes, { mode: 0o600, signal });
    if (kind === "image") {
      try {
        return await imageImporter.inspect(path, signal);
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof DomainError && error.status === 503)
          throw new ArtifactValidationError("媒体校验暂不可用", 503);
        throw failure(
          error instanceof ProviderImageError && error.kind === "format"
            ? errors.imageFormat
            : errors.imageDecode,
        );
      }
    }
    if (kind === "audio") {
      const audioError = errors.audio ?? errors.failed;
      const info = JSON.parse(
        await mediaCommand(
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
          30000,
          signal,
        ),
      );
      const audio = (info.streams ?? []).find(
        (s: { codec_type: string }) => s.codec_type === "audio",
      );
      const duration = Number(audio?.duration || info.format?.duration || 0);
      if (!audio || !(duration > 0.05 && duration <= 600))
        throw failure(audioError);
      const format = String(info.format?.format_name || "");
      const mime = format.includes("wav")
        ? "audio/wav"
        : format.includes("mp3")
          ? "audio/mpeg"
          : format.includes("flac")
            ? "audio/flac"
            : format.includes("ogg")
              ? "audio/ogg"
              : format.includes("mp4") || format.includes("m4a")
                ? "audio/mp4"
                : undefined;
      if (!mime) throw failure(audioError);
      await mediaCommand(
        "ffmpeg",
        [
          "-v",
          "error",
          "-protocol_whitelist",
          "file,pipe",
          "-i",
          path,
          "-map",
          "0:a:0",
          "-t",
          "0.2",
          "-f",
          "null",
          "-",
        ],
        30000,
        signal,
      );
      return {
        mime,
        duration: roundDecimal(duration, 3),
        sampleRate: Number(audio.sample_rate || 0) || null,
        channels: Number(audio.channels || 0) || null,
      };
    }
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
          : undefined;
    if (!demuxer) throw failure(errors.video);
    const flags = [
      "-v",
      "error",
      "-protocol_whitelist",
      "file,pipe",
      "-f",
      demuxer,
    ];
    const info = JSON.parse(
      await mediaCommand(
        "ffprobe",
        [...flags, "-show_streams", "-show_format", "-of", "json", path],
        30000,
        signal,
      ),
    );
    const video = info.streams.find(
      (s: { codec_type: string }) => s.codec_type === "video",
    );
    const duration = Number(info.format.duration);
    if (
      !video ||
      !(
        video.width > 0 &&
        video.width <= 8192 &&
        video.height > 0 &&
        video.height <= 8192 &&
        duration > 0 &&
        duration <= 120
      ) ||
      [
        video.tags?.rotate,
        ...(video.side_data_list ?? []).map(
          (s: { rotation?: number }) => s.rotation,
        ),
      ].some((angle) => Number(angle || 0) % 360 !== 0)
    )
      throw failure(errors.video);
    const format: string = info.format.format_name;
    const mime =
      format.includes("mp4") || format.includes("mov")
        ? "video/mp4"
        : format.includes("webm")
          ? "video/webm"
          : undefined;
    if (!mime) throw failure(errors.video);
    await mediaCommand(
      "ffmpeg",
      [
        ...flags,
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
      30000,
      signal,
    );
    return {
      mime,
      width: video.width,
      height: video.height,
      duration: roundDecimal(duration, 3),
      fps: video.avg_frame_rate ?? null,
    };
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof ArtifactValidationError) throw error;
    throw failure(
      kind === "video"
        ? errors.video
        : kind === "audio"
          ? (errors.audio ?? errors.failed)
          : errors.failed,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
