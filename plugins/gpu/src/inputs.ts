import { referenceLimits } from "./reference-limits.js";
import { randomBytes } from "node:crypto";
import {
  InputPreparationError,
  type PreparationAsset,
  type PreparationRequest,
  type PreparedInput,
} from "@fumiao/plugin-sdk/preparation.js";
const fail = (message: string): never => {
  throw new InputPreparationError(message);
};
const unique = (ids: string[]) => [...new Set(ids)];
function canonicalInput(input: PreparationRequest): PreparationRequest {
  const h3 = input.params.h3;
  return {
    ...input,
    references: input.references.map((id) => id.toLowerCase()),
    params: {
      ...input.params,
      ...(h3
        ? {
            h3: {
              ...h3,
              first_frame: h3.first_frame?.toLowerCase() ?? null,
              last_frame: h3.last_frame?.toLowerCase() ?? null,
              video_audio: h3.video_audio.map((id: string) => id.toLowerCase()),
            },
          }
        : {}),
    },
  };
}
export const ratios: Record<string, number[]> = {
  "16:9": [864, 480, 1344, 768],
  "9:16": [480, 864, 768, 1344],
  "1:1": [480, 480, 768, 768],
  "4:3": [640, 480, 1024, 768],
  "3:4": [480, 640, 768, 1024],
  "21:9": [1120, 480, 1568, 672],
};
export function referenceIds(
  input: PreparationRequest,
  canonical = true,
): string[] {
  if (canonical) input = canonicalInput(input);
  const options = input.params.h3;
  if (!options) return input.references;
  if (input.model !== "MiniMax H3") fail("当前模型不支持 H3 输入模式");
  if (options.mode === "frames") {
    if (input.hasReferencePacks) fail("首尾帧模式请在槽位中直接选择图片");
    if (options.video_audio.length) fail("首尾帧模式只接收图片");
    const ids = unique(
      [options.first_frame, options.last_frame].filter(Boolean),
    );
    if (input.references.some((id) => !ids.includes(id)))
      fail("首尾帧模式请在对应槽位选择图片");
    return ids;
  }
  if (options.first_frame || options.last_frame)
    fail("请在首尾帧模式指定首帧和尾帧");
  if (unique(input.references).length !== input.references.length)
    fail("参考素材不能重复");
  return input.references;
}
export function prepareNative(
  input: PreparationRequest,
  assets: PreparationAsset[],
  canonical = true,
) {
  if (canonical) input = canonicalInput(input);
  const options = input.params.h3;
  if (!options) return null;
  const ids = referenceIds(input, false);
  const files = ids.map((id) => {
    const row = assets.find((a) => a.id === id);
    if (!row || !["ref", "ref_video", "ref_audio"].includes(row.role))
      return fail("参考素材不存在或格式不受支持");
    const kind = (
      { ref: "image", ref_video: "video", ref_audio: "audio" } as Record<
        string,
        "image" | "video" | "audio"
      >
    )[row.role];
    if (options.mode === "frames" && kind !== "image")
      fail("首尾帧模式只接收图片");
    const item: Record<string, any> = {
      id,
      kind,
      mime: row.mime,
      w: row.width,
      h: row.height,
      suffix: { image: "png", video: "mp4", audio: "wav" }[kind],
    };
    if (kind !== "image") {
      if (!row.reference) fail("参考素材信息缺失，请重新上传");
      Object.assign(item, row.reference);
    }
    return item;
  });
  for (const kind of ["image", "video", "audio"] as const) {
    const limit = referenceLimits.counts[kind];
    const selected = files.filter((f) => f.kind === kind);
    if (selected.length > limit)
      fail(
        {
          image: "最多选择 9 张图片",
          video: "最多选择 3 段视频",
          audio: "最多选择 3 段音频",
        }[kind],
      );
    if (
      kind !== "image" &&
      (selected.some(
        (f) =>
          !(
            f.seconds >= referenceLimits.minSeconds - 0.01 &&
            f.seconds <= referenceLimits.maxSeconds + 0.05
          ),
      ) ||
        selected.reduce((sum, f) => sum + f.seconds, 0) >
          referenceLimits.maxSeconds + 0.05)
    )
      fail("同类参考视频或音频的总时长不能超过 15 秒");
    if (
      kind === "video" &&
      selected.some(
        (f) => f.seconds > input.params.seconds + 0.05 || f.fps !== 24,
      )
    )
      fail("生成时长不能短于参考视频，请调整时长或裁短参考视频");
  }
  if (files.length > referenceLimits.max) fail("最多选择 12 个参考素材");
  if (
    options.video_audio.some(
      (id: string) =>
        !files.some((f) => f.id === id && f.kind === "video" && f.has_audio),
    )
  )
    fail("所选视频没有可引用的声音");
  if (options.mode === "frames" && files.length === 2) {
    const [a, b] = files;
    if (
      !a.w ||
      !a.h ||
      !b.w ||
      !b.h ||
      Math.abs(Math.log(a.w / a.h / (b.w / b.h))) > 0.035
    )
      fail("请使用比例相同的首尾帧图片");
  }
  return {
    version: 1,
    mode: options.mode,
    first_frame: options.first_frame ?? null,
    last_frame: options.last_frame ?? null,
    video_audio: unique(options.video_audio),
    files,
  };
}
export function prepareInput(
  input: PreparationRequest,
  assets: PreparationAsset[],
  strip: (value: string) => string = (value) => value.trim(),
): PreparedInput {
  input = canonicalInput(input);
  if (input.params.h3 && input.model !== "MiniMax H3")
    fail("当前模型不支持 H3 输入模式");
  if (input.model === "breeze-tts-2") {
    if ([...input.prompt].length > 300) fail("模型参数无效");
    return {
      references: input.references,
      params: {
        ...input.params,
        instruction:
          strip(input.params.instruction || "") ||
          (/[\u4e00-\u9fff]/.test(input.prompt)
            ? "声音清晰自然、语速适中，使用普通话朗读。"
            : "A clear, natural narrator speaking at a moderate pace."),
        seed: input.params.seed ?? randomBytes(4).readUInt32BE() & 0x7fffffff,
      },
    };
  }
  if (input.model !== "MiniMax H3")
    return { params: input.params, references: input.references };
  const native = prepareNative(input, assets),
    ids = native ? native.files.map((f) => f.id) : input.references;
  if (!native && ids.length > 9) fail("最多选择 9 张参考图片");
  const selected = ids.map((id) => {
    const row = assets.find((a) => a.id === id);
    if (!row || (!native && row.role !== "ref")) return fail("参考图已不存在");
    return row;
  });
  let ratio =
    native?.mode === "frames" && selected.length ? "auto" : input.params.ratio;
  if (ratio === "auto") {
    const visual = selected.find((a) => a.width && a.height),
      target = visual ? visual.width / visual.height : 16 / 9;
    ratio = Object.keys(ratios).reduce((best, key) => {
      const difference = (r: string) => {
        const [w, h] = r.split(":").map(Number);
        return Math.abs(Math.log(target / (w / h)));
      };
      return difference(key) < difference(best) ? key : best;
    });
  }
  const offset = input.params.quality === 480 ? 0 : 2,
    [width, height] = ratios[ratio].slice(offset, offset + 2),
    { h3, ...params } = input.params;
  return {
    references: ids,
    params: {
      ...params,
      ratio,
      width,
      height,
      seed:
        params.seed ??
        Number(randomBytes(8).readBigUInt64BE() & ((1n << 53n) - 1n)),
      ...(native ? { h3_inputs: native } : {}),
    },
  };
}
