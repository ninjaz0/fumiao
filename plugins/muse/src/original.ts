import { museClock } from "./clock.js";
import {
  OriginalSubmissionError,
  originalParent,
  type ProviderPlugin,
} from "../../../packages/plugin-sdk/src/index.js";
const fail = (message: string): never => {
  throw new OriginalSubmissionError(message);
};
export function createMuseOriginal(
  strip: (value: string) => string = (value) => value.trim(),
): ProviderPlugin {
  return {
    ...museClock,
    manifest: {
      ...museClock.manifest,
      version: "1.5.0",
      originalSubmission: { version: 1 },
      queue: {
        ...museClock.manifest.queue!,
        timingVersions: [...museClock.manifest.queue!.timingVersions, "1.5.0"],
      },
    },
    originalSubmission: {
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
          d.kind === "image"
            ? ["1:1", "16:9", "9:16", "4:3", "3:4"]
            : ["16:9", "9:16"];
        if (!ratios.includes(d.ratio)) fail("Muse 不支持这个画幅选项");
        if (d.kind === "video" && ![5, 6, 8, 10].includes(d.seconds))
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
    },
  };
}
export const museOriginal = createMuseOriginal();
