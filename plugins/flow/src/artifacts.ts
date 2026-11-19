import { flowDownload } from "./download.js";
import {
  inspectProviderMedia,
  ProviderMediaError,
} from "../../muse/src/artifacts.js";
import {
  ArtifactValidationError,
  type ProviderPlugin,
} from "../../../packages/plugin-sdk/src/index.js";
export const flowArtifacts: ProviderPlugin = {
  ...flowDownload,
  manifest: {
    ...flowDownload.manifest,
    version: "1.8.0",
    artifactValidation: { version: 2 },
    queue: {
      ...flowDownload.manifest.queue!,
      timingVersions: [...flowDownload.manifest.queue!.timingVersions, "1.8.0"],
    },
  },
  originalState: {
    ...flowDownload.originalState!,
    project(job) {
      const result = flowDownload.originalState!.project(job);
      if (result.actual && !job.usage.flow_media_id)
        delete result.actual.flow_media_id;
      return result;
    },
  },
  async validateArtifact(job, bytes, _receipt, signal) {
    try {
      return { metadata: await inspectProviderMedia(bytes, job.kind, signal) };
    } catch (error) {
      if (error instanceof ArtifactValidationError && error.status === 503)
        throw error;
      throw new ArtifactValidationError(
        job.recovering
          ? "Flow 成品保存失败，请从后台检查生成结果"
          : error instanceof ProviderMediaError && error.kind !== "image-decode"
            ? error.kind === "image-format"
              ? "Flow 返回的图片格式或尺寸无效"
              : "Flow 返回的视频无法验证或方向异常"
            : "Flow 生成或保存失败，请从后台检查结果后重试",
      );
    }
  },
};
