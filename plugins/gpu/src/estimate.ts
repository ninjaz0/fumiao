import { gpuOriginal } from "./original.js";
import { ratios, referenceIds, prepareNative } from "./inputs.js";
import { canRunQueueJob } from "./queue.js";
import {
  OriginalSubmissionError,
  type ProviderPlugin,
} from "@fumiao/plugin-sdk/index.js";
const fail = (message: string): never => {
  throw new OriginalSubmissionError(message);
};
export const gpuEstimate: ProviderPlugin = {
  ...gpuOriginal,
  manifest: {
    ...gpuOriginal.manifest,
    version: "1.7.0",
    originalEstimate: { version: 1 },
    queue: {
      ...gpuOriginal.manifest.queue!,
      timingVersions: [...gpuOriginal.manifest.queue!.timingVersions, "1.7.0"],
    },
  },
  originalEstimate: {
    eligible: (node, job, stamp) =>
      node.control === "active" &&
      ["ready", "busy"].includes(node.stage) &&
      stamp - node.lastseen <= 75 &&
      canRunQueueJob(node, job),
    async prepare(d, r) {
      let ratio = d.ratio,
        native: ReturnType<typeof prepareNative> = null,
        refs;
      if (d.h3) {
        if (d.kind !== "video" || !["", "MiniMax H3"].includes(d.model))
          fail("当前模型不支持 H3 输入模式");
        await r.authorize();
        const request = {
          model: "MiniMax H3",
          kind: "video" as const,
          prompt: "",
          params: { seconds: d.seconds, h3: d.h3 },
          references: d.refs,
          hasReferencePacks: false,
        };
        const ids = referenceIds(request, false);
        refs = await r.references(ids, ["ref", "ref_video", "ref_audio"], {
          status: 400,
          message: "参考素材不存在或格式不受支持",
        });
        // Native validation uses original public identifiers; execution IDs are resolved below.
        native = prepareNative(
          request,
          refs.map((a) => ({ ...a, id: a.publicId })),
          false,
        );
        if (native?.mode === "frames" && native.files.length) {
          const image = native.files[0],
            aspect = image.w / image.h;
          ratio = Object.keys(ratios).reduce((best, key) => {
            const distance = (v: string) => {
              const [w, h] = v.split(":").map(Number);
              return Math.abs(Math.log(aspect / (w / h)));
            };
            return distance(key) < distance(best) ? key : best;
          });
        }
      }
      if (d.kind === "audio") {
        if (d.model !== "breeze-tts-2" || !["zh", "en"].includes(d.language))
          fail("未知语音参数");
        return {
          model: d.model,
          kind: "audio",
          references: [],
          params: {
            text_chars: d.text_chars,
            language: d.language,
            instruction:
              d.audio_instruction.trim() ||
              (d.language === "zh"
                ? "声音清晰自然、语速适中，使用普通话朗读。"
                : "A clear, natural narrator speaking at a moderate pace."),
          },
        };
      }
      if (!["video", "image"].includes(d.kind) || !Object.hasOwn(ratios, ratio))
        fail("未知生成参数");
      if (d.kind !== "video" || !["", "MiniMax H3"].includes(d.model))
        fail("未知生成模型");
      if (![480, 768].includes(d.quality) || ![5, 10, 15].includes(d.seconds))
        fail("未知生成参数");
      refs ??= await r.references(d.refs);
      const ids = new Map(refs.map((a) => [a.publicId, a.id]));
      if (native)
        native = {
          ...native,
          first_frame: ids.get(native.first_frame) ?? null,
          last_frame: ids.get(native.last_frame) ?? null,
          video_audio: native.video_audio.map((id: string) => ids.get(id)!),
          files: native.files.map((f) => ({ ...f, id: ids.get(f.id)! })),
        };
      const offset = d.quality === 480 ? 0 : 2,
        [width, height] = ratios[ratio].slice(offset, offset + 2);
      return {
        model: "MiniMax H3",
        kind: "video",
        references: refs.map((a) => a.id),
        params: {
          ratio,
          quality: d.quality,
          seconds: d.seconds,
          sampling_steps: d.sampling_steps,
          width,
          height,
          ...(native ? { h3_inputs: native } : {}),
        },
      };
    },
  },
};
