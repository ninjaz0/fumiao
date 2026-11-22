import { createHash, timingSafeEqual } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ArtifactValidationError,
  type ArtifactJob,
  type ArtifactReceipt,
  type ArtifactProgress,
} from "@fumiao/plugin-sdk/preparation.js";
import { roundDecimal } from "@fumiao/plugin-sdk/decimal.js";
import { mediaCommand } from "./reference-media.js";
const fail = (message: string): never => {
  throw new ArtifactValidationError(message);
};
/** All frozen H3 numeric fields are integers or decimal durations in [1.99, 15.05]. */
export function inputFingerprint(value: Record<string, any> | undefined) {
  if (!value || !Object.keys(value).length) return "";
  const sorted = (v: any): string =>
    Array.isArray(v)
      ? "[" + v.map(sorted).join(",") + "]"
      : v && typeof v === "object"
        ? "{" +
          Object.keys(v)
            .sort()
            .map((k) => JSON.stringify(k) + ":" + sorted(v[k]))
            .join(",") +
          "}"
        : JSON.stringify(v);
  return createHash("sha256")
    .update(
      sorted(value).replace(
        /[\u007f-\uffff]/g,
        (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
      ),
    )
    .digest("hex");
}
const trimNumber = (value: string) =>
  value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
function integer(value: unknown) {
  if (typeof value === "boolean") return Number(value);
  if (typeof value === "string") {
    const trimmed = trimNumber(value);
    if (!/^[+-]?\d(?:_?\d)*(?:\.0+)?$/.test(trimmed)) throw Error();
    value = Number(trimmed.replaceAll("_", ""));
  }
  if (typeof value !== "number" || !Number.isInteger(value)) throw Error();
  return value;
}
function boolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.toLowerCase();
    if (["1", "t", "true", "y", "yes", "on"].includes(v)) return true;
    if (["0", "f", "false", "n", "no", "off"].includes(v)) return false;
  }
  if (value === 0 || value === 1) return !!value;
  throw Error();
}
/** The old endpoint discards the entire timing header when any known field is invalid. */
export function receiptReport(text: string | undefined): Record<string, any> {
  try {
    const value = JSON.parse(text || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const result: Record<string, any> = {};
    for (const [key, v] of Object.entries(value)) {
      if (v === null && key !== "recovered") continue;
      if (key === "h3_input_fingerprint") {
        if (typeof v !== "string" || !/^[a-f0-9]{64}$/.test(v)) throw Error();
        result[key] = v;
      } else if (
        [
          "sampling_steps",
          "peak_vram_bytes",
          "peak_allocated_vram_bytes",
        ].includes(key)
      ) {
        const n = integer(v);
        if (
          n < (key === "sampling_steps" ? 1 : 0) ||
          n > (key === "sampling_steps" ? 100 : 2 ** 50)
        )
          throw Error();
        result[key] = n;
      } else if (["fast_mode", "cold", "recovered"].includes(key))
        result[key] = boolean(v);
      else if (["prepare_s", "generate_s", "finalize_s"].includes(key)) {
        if (
          typeof v !== "boolean" &&
          typeof v !== "number" &&
          typeof v !== "string"
        )
          throw Error();
        let number: unknown = v;
        if (typeof v === "string") {
          const trimmed = trimNumber(v);
          if (
            trimmed.startsWith("_") ||
            trimmed.endsWith("_") ||
            trimmed.includes("__")
          )
            throw Error();
          number = trimmed.replaceAll("_", "");
          if (
            !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(
              number as string,
            )
          )
            throw Error();
        }
        const n = Number(number);
        if (!Number.isFinite(n) || n < 0 || n > 172800) throw Error();
        result[key] = n;
      }
    }
    return result;
  } catch {
    return {};
  }
}
export function validateReport(job: ArtifactJob, receipt: ArtifactReceipt) {
  const report = receiptReport(receipt.report),
    params = job.params;
  if (job.model === "MiniMax H3") {
    const expected = inputFingerprint(params.h3_inputs),
      steps = params.sampling_steps ?? 20;
    if (expected && report.h3_input_fingerprint !== expected)
      fail("成片参考模式与任务不一致，请更新实例后重试");
    const observed = report.sampling_steps;
    if (
      (observed === undefined && steps !== 20) ||
      (observed !== undefined && observed !== steps)
    )
      fail("成片采样步数与任务不一致，请更新实例后重新生成");
    const fast = report.fast_mode;
    if (
      (steps === 4 && fast !== true) ||
      (fast !== undefined && fast !== (steps === 4))
    )
      fail("成片快速模式与任务不一致，请更新实例后重新生成");
  }
  return report;
}
export function validateDigest(bytes: Uint8Array, receipt: ArtifactReceipt) {
  const digest = createHash("sha256").update(bytes).digest("hex"),
    provided = receipt.sha256 || "";
  if (
    !/^[a-f0-9]{64}$/.test(provided) ||
    !timingSafeEqual(Buffer.from(provided), Buffer.from(digest))
  )
    fail("成片摘要不符");
}
export function validateAudio(bytes: Uint8Array) {
  try {
    const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (
      b.toString("ascii", 0, 4) !== "RIFF" ||
      b.toString("ascii", 8, 12) !== "WAVE"
    )
      throw Error();
    const end = Math.min(b.length, b.readUInt32LE(4) + 8);
    let format: { channels: number; width: number; rate: number } | undefined;
    for (let pos = 12; pos + 8 <= end;) {
      const tag = b.toString("ascii", pos, pos + 4),
        size = b.readUInt32LE(pos + 4),
        start = pos + 8;
      if (tag === "fmt ") {
        if (size < 16 || start + size > end) throw Error();
        const type = b.readUInt16LE(start),
          channels = b.readUInt16LE(start + 2),
          rate = b.readUInt32LE(start + 4),
          width = Math.ceil(b.readUInt16LE(start + 14) / 8);
        if (
          type !== 1 &&
          (type !== 65534 ||
            size < 40 ||
            !b
              .subarray(start + 24, start + 40)
              .equals(Buffer.from("0100000000001000800000aa00389b71", "hex")))
        )
          throw Error();
        if (!channels || !width) throw Error();
        format = { channels, width, rate };
      } else if (tag === "data") {
        if (
          !format ||
          format.channels !== 1 ||
          format.width !== 2 ||
          format.rate !== 24000
        )
          throw Error();
        const frames = Math.floor(size / 2),
          duration = frames / 24000;
        if (duration < 0.1 || duration >= 119.5 || start + frames * 2 > end)
          throw Error();
        let peak = 0;
        for (let i = start; i < start + frames * 2; i += 2)
          peak = Math.max(peak, Math.abs(b.readInt16LE(i)));
        if (peak < 32) throw Error();
        return {
          mime: "audio/wav",
          width: 0,
          height: 0,
          duration: roundDecimal(duration, 3),
          sample_rate: 24000,
          channels: 1,
          format: "wav",
        };
      }
      pos = start + size + (size % 2);
    }
    throw Error();
  } catch {
    return fail("语音未通过完整性或时长校验；如达到时长上限，请缩短文字后重试");
  }
}
export async function validateVideo(
  path: string,
  job: ArtifactJob,
  signal: AbortSignal,
) {
  const opts = ["-v", "error", "-protocol_whitelist", "file,pipe", "-f", "mov"];
  try {
    const meta = JSON.parse(
        await mediaCommand(
          "ffprobe",
          [...opts, "-show_streams", "-show_format", "-of", "json", path],
          15000,
          signal,
        ),
      ),
      v = meta.streams.find((s: any) => s.codec_type === "video"),
      a = meta.streams.find((s: any) => s.codec_type === "audio");
    const rotations = [
      v.tags?.rotate || 0,
      ...(v.side_data_list || [])
        .filter((s: any) => "rotation" in s)
        .map((s: any) => s.rotation),
    ];
    const frames = ({ 5: 124, 10: 243, 15: 362 } as Record<number, number>)[
        job.params.seconds
      ],
      rate = String(v.avg_frame_rate).split("/").map(Number);
    if (
      rotations.some(
        (angle) => !Number.isFinite(Number(angle)) || Number(angle) % 360 !== 0,
      ) ||
      !frames ||
      v.width !== job.params.width ||
      v.height !== job.params.height ||
      v.codec_name !== "h264" ||
      rate.length !== 2 ||
      rate[1] === 0 ||
      rate[0] / rate[1] !== 24 ||
      Number(v.nb_frames) !== frames ||
      a.codec_name !== "aac" ||
      a.channels !== 2 ||
      Number(a.sample_rate) !== 32000 ||
      Math.abs(Number(meta.format.duration) - frames / 24) > 0.16 ||
      !Number.isFinite(Number(meta.format.duration))
    )
      throw Error();
    await mediaCommand(
      "ffmpeg",
      [
        "-nostdin",
        "-xerror",
        ...opts,
        "-threads",
        "2",
        "-i",
        path,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0",
        "-f",
        "null",
        "-",
      ],
      90000,
      signal,
    );
  } catch {
    signal.throwIfAborted();
    fail("成片未通过分辨率、音视频或完整解码校验");
  }
}
let activeValidations = 0;
export async function validateArtifact(
  job: ArtifactJob,
  bytes: Uint8Array,
  receipt: ArtifactReceipt,
  signal: AbortSignal,
  progress?: ArtifactProgress,
) {
  signal.throwIfAborted();
  const report = validateReport(job, receipt);
  const timing = Object.fromEntries(
    Object.entries(report).filter(([key]) =>
      [
        "prepare_s",
        "generate_s",
        "finalize_s",
        "peak_vram_bytes",
        "peak_allocated_vram_bytes",
        "cold",
        "recovered",
      ].includes(key),
    ),
  );
  if (activeValidations >= 2)
    throw new ArtifactValidationError("请求处理失败", 503);
  activeValidations++;
  try {
    await progress?.("uploading");
    signal.throwIfAborted();
    if (!bytes.length) throw new ArtifactValidationError("文件为空", 400);
    if (bytes.length > 64 << 20)
      throw new ArtifactValidationError("文件过大", 413);
    validateDigest(bytes, receipt);
    await progress?.("validating");
    if (job.kind === "audio") return { metadata: validateAudio(bytes), timing };
    const directory = await mkdtemp(join(tmpdir(), "fumiao-gpu-result-"));
    try {
      const path = join(directory, "output");
      await writeFile(path, bytes, { mode: 0o600 });
      await validateVideo(path, job, signal);
      return {
        timing,
        metadata: {
          mime: "video/mp4",
          width: job.params.width,
          height: job.params.height,
          sampling_steps: job.params.sampling_steps ?? 20,
          fast_mode: job.params.sampling_steps === 4,
          ...(report.h3_input_fingerprint
            ? { h3_input_fingerprint: report.h3_input_fingerprint }
            : {}),
        },
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  } finally {
    activeValidations--;
  }
}
