import { readFileSync } from "node:fs";
import { flowQueue } from "./queue.js";
import { submitFlow } from "./index.js";
import {
  OriginalSubmissionError,
  originalParent,
  type ProviderPlugin,
} from "@fumiao/plugin-sdk/index.js";
const models: Record<string, any> = JSON.parse(
  readFileSync(new URL("../models.json", import.meta.url), "utf8"),
);
const fail = (message: string): never => {
  throw new OriginalSubmissionError(message);
};
export function createFlowOriginal(
  strip: (value: string) => string = (value) => value.trim(),
): ProviderPlugin {
  return {
    ...flowQueue,
    manifest: {
      ...flowQueue.manifest,
      version: "1.4.0",
      originalSubmission: { version: 1 },
      models: flowQueue.manifest.models.map((m) => ({
        ...m,
        preparedSchema: {
          ...m.inputSchema,
          ...(models[m.id].mode === "extend"
            ? {
                required: ["source_media_id"],
                properties: {
                  source_media_id: {
                    type: "string",
                    minLength: 1,
                    maxLength: 300,
                    pattern: "^[A-Za-z0-9_./:-]+$",
                  },
                },
              }
            : {}),
        },
      })),
      queue: {
        ...flowQueue.manifest.queue!,
        timingVersions: [...flowQueue.manifest.queue!.timingVersions, "1.4.0"],
      },
    },
    originalSubmission: {
      namespace: (d) => "-flow-" + d.kind,
      validate(d, phase) {
        if (
          phase === "before-packs" &&
          d.h3?.mode === "frames" &&
          d.asset_packs.length
        )
          fail("首尾帧模式请在槽位中直接选择图片");
        if (phase !== "before-retry") return;
        if (d.h3) fail("当前模型不支持 H3 输入模式");
        if (models[d.model]?.kind !== d.kind || !strip(d.prompt))
          fail("Flow 模型与生成类型不匹配");
      },
      plan(d) {
        const spec = models[d.model];
        if (new Set(d.refs).size !== d.refs.length) fail("参考图片不能重复");
        if (d.refs.length < spec.min_refs || d.refs.length > spec.max_refs)
          fail(
            spec.max_refs
              ? `这个 Flow 模型需要 ${spec.min_refs}–${spec.max_refs} 张参考图片`
              : "这个 Flow 模型不接收参考图片，请移除参考图或选择图生视频模型",
          );
        return {
          namespace: "-flow-" + d.kind,
          refs: d.refs,
          roles: ["ref"],
          missing: { status: 404, message: "内容不存在或无权访问" },
          parentKind: d.kind,
          ...(d.flow_source_job ? { source: d.flow_source_job } : {}),
          referenceBytes: {
            max: 32 * 1024 * 1024,
            message: "本次 Flow 参考图总大小不能超过 32 MB",
          },
          admission: {
            models: Object.keys(models),
            owner: 20,
            message: "Flow 排队任务较多，请等待或取消部分任务",
          },
        };
      },
      async prepare(d, r) {
        const spec = models[d.model];
        if (spec.mode === "extend") {
          if (!d.flow_source_job)
            fail("请选择一条已完成的 Flow 视频作为续写来源");
          if (!r.source)
            throw new OriginalSubmissionError("内容不存在或无权访问", 404);
          if (
            r.source.state !== "completed" ||
            r.source.kind !== "video" ||
            !models[r.source.model] ||
            !r.source.metadata.flow_media_id
          )
            fail("续写来源必须是已完成并保留来源信息的 Flow 视频");
          if (r.source.view.ratio !== spec.ratio)
            fail("续写模型的画幅必须与来源视频一致");
        } else if (
          d.flow_source_job !== null &&
          d.flow_source_job !== undefined
        )
          fail("仅视频续写模型可以选择来源视频");
        originalParent(d, r.parent, d.kind);
        await r.admit();
        await r.capacity();
        return {
          params:
            spec.mode === "extend"
              ? { source_media_id: r.source!.metadata.flow_media_id }
              : {},
          references: r.references.map((a) => a.id),
          view: {
            ratio: spec.ratio,
            quality:
              ({ "2K": 2048, "4K": 4096 } as Record<string, number>)[
                spec.resolution
              ] || 0,
            seconds: spec.seconds,
            sampling_steps: 20,
            seed: 0,
            width: 0,
            height: 0,
            image_quality: "native",
            audio_settings: {},
            h3_inputs: {},
            ...(d.flow_source_job
              ? { actual: { flow_source_job: d.flow_source_job } }
              : {}),
          },
        };
      },
    },
    submit: (e) =>
      submitFlow(e, e.input.params.source_media_id as string | undefined, true),
  };
}
export const flowOriginal = createFlowOriginal();
