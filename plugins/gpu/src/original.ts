import { gpuNative } from "./native.js";
import { prepareInput, referenceIds, ratios } from "./inputs.js";
import {
  OriginalSubmissionError,
  originalParent,
  type ProviderPlugin,
  type OriginalDraft,
} from "../../../packages/plugin-sdk/src/index.js";
const fail = (message: string): never => {
  throw new OriginalSubmissionError(message);
};
const params = (d: OriginalDraft) =>
  d.kind === "audio"
    ? {
        instruction: d.instruction,
        ...(d.seed === null ? {} : { seed: d.seed }),
      }
    : {
        ratio: d.ratio,
        quality: d.quality,
        seconds: d.seconds,
        sampling_steps: d.sampling_steps,
        ...(d.seed === null ? {} : { seed: d.seed }),
        h3: d.h3,
      };
export function createGpuOriginal(
  strip: (value: string) => string = (value) => value.trim(),
): ProviderPlugin {
  const request = (d: OriginalDraft) => ({
    model: d.model,
    kind: d.kind,
    prompt: strip(d.prompt),
    params: params(d),
    references: d.refs,
    hasReferencePacks: d.asset_packs.length > 0,
  });
  return {
    ...gpuNative,
    manifest: {
      ...gpuNative.manifest,
      version: "1.6.0",
      originalSubmission: { version: 1 },
      queue: {
        ...gpuNative.manifest.queue!,
        timingVersions: [...gpuNative.manifest.queue!.timingVersions, "1.6.0"],
      },
    },
    originalSubmission: {
      namespace: (d) => (d.kind === "audio" ? "-audio" : ""),
      validate(d, phase) {
        if (
          phase === "before-packs" &&
          d.h3?.mode === "frames" &&
          d.asset_packs.length
        )
          fail("首尾帧模式请在槽位中直接选择图片");
        if (phase === "before-retry" && d.kind === "video") {
          if (
            !strip(d.prompt) ||
            ![480, 768].includes(d.quality) ||
            ![5, 10, 15].includes(d.seconds)
          )
            fail("请检查提示词、清晰度和时长");
          if (d.ratio !== "auto" && !Object.hasOwn(ratios, d.ratio))
            fail("未知画幅");
        }
        if (phase === "prepare" && d.kind === "audio" && !strip(d.prompt))
          fail("请输入要朗读的文字");
      },
      plan(d) {
        const native = !!d.h3;
        const refs = d.kind === "audio" ? [] : referenceIds(request(d));
        if (!native && refs.length > 9) fail("最多选择 9 张参考图片");
        return {
          namespace: d.kind === "audio" ? "-audio" : "",
          refs,
          roles: native ? ["ref", "ref_video", "ref_audio"] : ["ref"],
          missing: {
            status: 400,
            message: native ? "参考素材不存在或格式不受支持" : "参考图已不存在",
          },
          parentKind: d.kind === "audio" ? "audio" : "any",
        };
      },
      async prepare(d, r) {
        const ids = new Map(r.references.map((a) => [a.publicId, a.id]));
        const h3 = d.h3
          ? {
              ...d.h3,
              first_frame: d.h3.first_frame ? ids.get(d.h3.first_frame) : null,
              last_frame: d.h3.last_frame ? ids.get(d.h3.last_frame) : null,
              video_audio: d.h3.video_audio.map(
                (id: string) => ids.get(id) || id,
              ),
            }
          : null;
        const prepared = prepareInput(
          request({ ...d, refs: d.refs.map((id) => ids.get(id) || id), h3 }),
          r.references,
          strip,
        );
        if (d.kind === "audio") originalParent(d, r.parent, "audio");
        await r.capacity();
        if (d.kind === "video") {
          originalParent(d, r.parent, "any");
          if (
            !d.provided.includes("sampling_steps") &&
            r.parent?.model === d.model &&
            [4, 16, 20, 32, 50].includes(r.parent.view.sampling_steps)
          )
            prepared.params.sampling_steps = r.parent.view.sampling_steps;
        }
        const p: Record<string, any> = prepared.params,
          publicIds = new Map(r.references.map((a) => [a.id, a.publicId]));
        const native = p.h3_inputs
          ? {
              ...p.h3_inputs,
              first_frame: publicIds.get(p.h3_inputs.first_frame) || null,
              last_frame: publicIds.get(p.h3_inputs.last_frame) || null,
              video_audio: p.h3_inputs.video_audio.map((id: string) =>
                publicIds.get(id),
              ),
              files: p.h3_inputs.files.map((file: any) => ({
                ...file,
                id: publicIds.get(file.id),
              })),
            }
          : {};
        return {
          ...prepared,
          view:
            d.kind === "audio"
              ? {
                  ratio: "audio",
                  quality: 0,
                  seconds: 0,
                  sampling_steps: 20,
                  seed: p.seed,
                  width: 0,
                  height: 0,
                  image_quality: "standard",
                  audio_settings: { instruction: p.instruction },
                  h3_inputs: {},
                }
              : {
                  ratio: p.ratio,
                  quality: p.quality,
                  seconds: p.seconds,
                  sampling_steps: p.sampling_steps,
                  seed: p.seed,
                  width: p.width,
                  height: p.height,
                  image_quality: "medium",
                  audio_settings: {},
                  h3_inputs: native,
                },
        };
      },
    },
  };
}
export const gpuOriginal = createGpuOriginal();
