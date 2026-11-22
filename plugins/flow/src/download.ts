import { flowDownloadPlan } from "./artifact-plan.js";
import { flowState } from "./state.js";
import {
  ArtifactDownloadError,
  fetchArtifact,
  splitArtifactUrl,
  type ProviderPlugin,
} from "@fumiao/plugin-sdk/index.js";

export function flowArtifactSource(
  url: string,
  config: Record<string, unknown>,
) {
  const base = String(config.baseUrl).replace(/\/+$/, ""),
    publicUrl = String(
      config.publicUrl || "https://backend.nvmes.com/flow",
    ).replace(/\/+$/, "");
  const plan = flowDownloadPlan(
    url,
    splitArtifactUrl(base),
    splitArtifactUrl(publicUrl),
  );
  if (plan.error) throw new ArtifactDownloadError(plan.error, "failed");
  if (plan.path)
    return {
      url: base + plan.path,
      headers: { Authorization: "Bearer " + config.apiKey },
    };
  return { url, headers: {} as Record<string, string> };
}
export const flowDownload: ProviderPlugin = {
  ...flowState,
  manifest: {
    ...flowState.manifest,
    version: "1.7.0",
    configSchema: {
      ...flowState.manifest.configSchema,
      properties: {
        ...(flowState.manifest.configSchema.properties as Record<
          string,
          unknown
        >),
        publicUrl: { type: "string", pattern: "^https?://" },
      },
    },
    queue: {
      ...flowState.manifest.queue!,
      timingVersions: [...flowState.manifest.queue!.timingVersions, "1.7.0"],
    },
    artifactDownload: { version: 1 },
  },
  async downloadArtifact(request, signal) {
    try {
      const source = flowArtifactSource(request.url, request.config);
      return await fetchArtifact(source.url, source.headers, {
        signal,
        timeout: 90000,
        maxBytes: 64 * 1024 ** 2,
        oversized: "Flow 成品超过 64 MB，未保存",
      });
    } catch (error) {
      if (error instanceof ArtifactDownloadError && !request.recovering)
        throw error;
      throw new ArtifactDownloadError(
        request.recovering
          ? "Flow 成品保存失败，请从后台检查生成结果"
          : "Flow 生成或保存失败，请从后台检查结果后重试",
        "failed",
      );
    }
  },
};
