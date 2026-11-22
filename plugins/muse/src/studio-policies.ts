import type {
  OriginalSubmission,
  OriginalEstimate,
  OriginalState,
  TimingContext,
} from "@fumiao/plugin-sdk/index.js";
import {
  originalParent,
  OriginalSubmissionError,
} from "@fumiao/plugin-sdk/submission-errors.js";
import { roundDecimal } from "@fumiao/plugin-sdk/decimal.js";
import { publicKeys } from "@fumiao/plugin-sdk/public-keys.js";
export const studioRatios = {
  image: ["1:1", "16:9", "9:16", "4:3", "3:4"],
  video: ["16:9", "9:16"],
};
export const studioSeconds = [5, 6, 8, 10];
const fail = (message: string): never => {
  throw new OriginalSubmissionError(message);
};
export function submissionPolicy(
  strip: (value: string) => string,
): OriginalSubmission {
  return {
    namespace: (d) => "-muse-" + d.kind,
    validate(d, phase) {
      if (
        phase === "before-packs" &&
        d.h3?.mode === "frames" &&
        d.asset_packs.length
      )
        fail("首尾帧模式请在槽位中直接选择图片");
      if (phase !== "before-retry") return;
      if (d.h3) fail("当前模型不支持 H3 输入模式");
      if (d.kind === "video" && d.sampling_steps !== 20)
        fail("Muse 不支持采样步数设置");
      if (d.kind === "image" && !["1K", "2K"].includes(d.resolution))
        fail("该模型不支持这个分辨率");
      if (!strip(d.prompt)) fail("请检查 Muse 模型和提示词");
      const ratios =
        d.kind === "image" ? studioRatios.image : studioRatios.video;
      if (!ratios.includes(d.ratio)) fail("Muse 不支持这个画幅选项");
      if (d.kind === "video" && !studioSeconds.includes(d.seconds))
        fail("Muse 时长可选 5、6、8、10 秒");
    },
    plan: (d) => ({
      namespace: "-muse-" + d.kind,
      refs: d.refs,
      roles: ["ref"],
      missing: { status: 404, message: "内容不存在或无权访问" },
      parentKind: d.kind,
      referenceBytes: {
        max: 100 * 1024 * 1024,
        message: "Muse 参考图总大小不能超过 100 MB",
      },
      admission: {
        models: ["muse-image", "muse-video"],
        owner: 20,
        message: "Muse 排队任务较多，请等待或取消部分任务",
      },
    }),
    async prepare(d, r) {
      originalParent(d, r.parent, d.kind);
      await r.admit();
      await r.capacity();
      return {
        params: {
          ratio: d.ratio,
          ...(d.kind === "video" ? { seconds: d.seconds } : {}),
        },
        references: r.references.map((a) => a.id),
        view: {
          ratio: d.ratio,
          quality: 0,
          seconds: d.kind === "video" ? d.seconds : 0,
          sampling_steps: 20,
          seed: 0,
          width: 0,
          height: 0,
          image_quality: "native",
          audio_settings: {},
          h3_inputs: {},
        },
      };
    },
  };
}
export const estimatePolicy: OriginalEstimate = {
  async prepare(d, r) {
    if (d.model !== "muse-" + d.kind) fail("模型与生成类型不匹配");
    if (
      !["video", "image"].includes(d.kind) ||
      !["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"].includes(d.ratio)
    )
      fail("未知生成参数");
    if (d.sampling_steps !== 20) fail("Muse 不支持采样步数设置");
    if (
      !(
        d.kind === "image"
          ? ["1:1", "16:9", "9:16", "4:3", "3:4"]
          : ["16:9", "9:16"]
      ).includes(d.ratio) ||
      (d.kind === "video" && ![5, 6, 8, 10].includes(d.seconds))
    )
      fail("未知 Muse 参数");
    const refs = await r.references(d.refs);
    return {
      model: d.model,
      kind: d.kind as "image" | "video",
      references: refs.map((a) => a.id),
      params: { ratio: d.ratio, seconds: d.kind === "video" ? d.seconds : 0 },
    };
  },
};
export const statePolicy: OriginalState = {
  configured: (c) => Boolean(c.baseUrl && c.apiKey),
  configuration: (c) => ({
    muse: {
      configured: c.connection?.configured ?? false,
      ready: Boolean(
        c.connection?.health.ready &&
        c.stamp - (c.connection.health.checked || 0) < 90,
      ),
      image_ratios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
      video_ratios: ["16:9", "9:16"],
      durations: [5, 6, 8, 10],
    },
  }),
  project: (j) => {
    if (j.state === "completed")
      return {
        width: j.metadata.width,
        height: j.metadata.height,
        actual: {
          ...publicKeys(j.metadata, ["width", "height"]),
          ...(j.kind === "video"
            ? {
                duration: roundDecimal(j.metadata.duration, 3),
                fps: j.metadata.fps ?? null,
              }
            : {}),
        },
      };
    if (["queued", "failed", "cancelled"].includes(j.state)) return {};
    return {
      note:
        j.state === "finalizing"
          ? "正在保存 Muse 成品"
          : !j.remoteId
            ? "正在提交 Muse"
            : j.phase === "queued"
              ? "等待 Muse 空闲账号"
              : j.phase === "preparing"
                ? "正在准备 Muse"
                : "Muse 生成中",
    };
  },
};
export function timingFeatures({ model, kind, input }: TimingContext) {
  return {
    kind,
    model,
    executor: "muse-api",
    workflow: "muse2api-native-v1",
    width: 0,
    height: 0,
    native_ratio: String(input.params.ratio || "16:9"),
    seconds: kind === "video" ? (input.params.seconds ?? 5) : 0,
    steps: 0,
    video_mode:
      kind === "video" ? (input.references.length ? "i2v" : "t2v") : "image",
    quality: "native",
    refs: input.references.length,
    ref_pixels: input.references.reduce((n, r) => n + r.width * r.height, 0),
    hardware: "muse-api",
    profile: {},
    runtime_id: "",
    cold: null,
  };
}
