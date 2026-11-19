import { resolutions } from "./studio.js";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { imagesQueue } from "./queue.js";
import { submitImages } from "./index.js";
import {
  OriginalSubmissionError,
  originalParent,
  type ProviderPlugin,
} from "../../../packages/plugin-sdk/src/index.js";
const sizes: Record<string, number[]> = JSON.parse(
  readFileSync(new URL("../sizes.json", import.meta.url), "utf8"),
);
const fail = (message: string): never => {
  throw new OriginalSubmissionError(message);
};
export function createImagesOriginal(
  strip: (value: string) => string = (value) => value.trim(),
): ProviderPlugin {
  return {
    ...imagesQueue,
    manifest: {
      ...imagesQueue.manifest,
      version: "1.4.0",
      originalSubmission: { version: 1 },
      models: imagesQueue.manifest.models.map((m) => ({
        ...m,
        preparedSchema: {
          ...m.inputSchema,
          properties: {
            ...(m.inputSchema.properties as Record<string, unknown>),
            safety_identifier: { type: "string", pattern: "^[a-f0-9]{64}$" },
          },
        },
      })),
      queue: {
        ...imagesQueue.manifest.queue!,
        timingVersions: [
          ...imagesQueue.manifest.queue!.timingVersions,
          "1.4.0",
        ],
      },
    },
    originalSubmission: {
      namespace: () => "-image",
      validate(d, phase) {
        if (phase !== "before-retry") return;
        if (!resolutions.includes(d.resolution)) fail("该模型不支持这个分辨率");
        if (
          !strip(d.prompt) ||
          !Object.hasOwn(sizes, d.ratio) ||
          new Set(d.refs).size !== d.refs.length
        )
          fail("请检查提示词、画幅和参考图");
      },
      plan: (d) => ({
        namespace: "-image",
        refs: d.refs,
        roles: ["ref"],
        missing: { status: 404, message: "内容不存在或无权访问" },
        parentKind: "image",
        requireConfigured: "图片生成尚未开启，请联系管理员",
        admission: {
          models: [d.model],
          owner: 3,
          global: 20,
          message: "待生成图片较多，请等待当前任务完成",
        },
      }),
      async prepare(d, r) {
        originalParent(d, r.parent, "image");
        await r.admit();
        await r.capacity();
        const offset = d.resolution === "1K" ? 0 : 2,
          [width, height] = sizes[d.ratio].slice(offset, offset + 2);
        return {
          params: {
            size: width + "x" + height,
            quality: d.image_quality,
            safety_identifier: createHash("sha256")
              .update(`${r.owner.site}:${r.owner.id}`)
              .digest("hex"),
          },
          references: r.references.map((a) => a.id),
          view: {
            ratio: d.ratio,
            quality: offset ? 2048 : 1024,
            seconds: 0,
            sampling_steps: 20,
            seed: 0,
            width,
            height,
            image_quality: d.image_quality,
            audio_settings: {},
            h3_inputs: {},
          },
        };
      },
    },
    async submit(e) {
      await e.reportTiming?.({ job_phase: "generating" });
      return submitImages(
        {
          ...e,
          input: {
            ...e.input,
            prompt: e.input.prompt.replace(/<Picture (\d+)>/g, "参考图片$1"),
          },
        },
        e.input.params.safety_identifier as string | undefined,
      );
    },
  };
}
export const imagesOriginal = createImagesOriginal();
