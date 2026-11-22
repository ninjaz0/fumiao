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
import catalog from "../models.json" with { type: "json" };
const models: Record<string, any> = catalog;
const fail = (message: string): never => {
  throw new OriginalSubmissionError(message);
};
export function submissionPolicy(
  strip: (value: string) => string,
): OriginalSubmission {
  return {
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
      } else if (d.flow_source_job !== null && d.flow_source_job !== undefined)
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
  };
}
export const estimatePolicy: OriginalEstimate = {
  async prepare(d, r) {
    if (models[d.model]?.kind !== d.kind)
      throw new OriginalSubmissionError("模型与生成类型不匹配");
    const refs = await r.references(d.refs);
    return {
      model: d.model,
      kind: d.kind as "image" | "video",
      references: refs.map((a) => a.id),
      params: {},
    };
  },
};
export const statePolicy: OriginalState = {
  configured: (c) => Boolean(c.baseUrl && c.apiKey),
  configuration: (c) => ({
    flow: {
      configured: c.connection?.configured ?? false,
      ready: Boolean(
        c.connection?.health.ready &&
        c.stamp - (c.connection.health.checked || 0) < 90,
      ),
      model_count: Object.keys(models).length,
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
          ...publicKeys(j.view.actual || {}, ["flow_source_job"]),
          ...publicKeys(j.usage, ["flow_media_id"]),
        },
      };
    return ["queued", "failed", "cancelled"].includes(j.state)
      ? {}
      : { note: "Flow 正在生成" };
  },
};
export function timingFeatures({ model, kind, input }: TimingContext) {
  const spec = models[model];
  if (!spec) throw new Error("Unknown Flow model");
  return {
    kind,
    model,
    executor: "flow-api",
    workflow: "flow2api-v1",
    width: 0,
    height: 0,
    native_ratio: String(spec.ratio),
    seconds: Number(spec.seconds),
    steps: 0,
    video_mode: String(spec.mode),
    quality: String(spec.resolution),
    refs: input.references.length,
    ref_pixels: input.references.reduce((n, r) => n + r.width * r.height, 0),
    hardware: "flow-api",
    profile: {},
    runtime_id: "",
    cold: null,
  };
}
