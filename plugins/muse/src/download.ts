import { museState } from "./state.js";
import {
  ArtifactDownloadError,
  fetchArtifact,
  splitArtifactUrl,
  type ProviderPlugin,
} from "../../../packages/plugin-sdk/src/index.js";

export function museArtifactSource(
  url: string,
  config: Record<string, unknown>,
) {
  const base = String(config.baseUrl).replace(/\/+$/, ""),
    publicUrl = String(
      config.publicUrl || "https://backend.nvmes.com/muse",
    ).replace(/\/+$/, ""),
    parsed = splitArtifactUrl(url);
  if (!parsed.query && !parsed.fragment)
    for (const origin of [base, publicUrl, "https://muse.nvmes.com"]) {
      const allowed = splitArtifactUrl(origin),
        prefix = allowed.path.replace(/\/+$/, "") + "/v1/media/";
      if (parsed.netloc && parsed.netloc !== allowed.netloc) continue;
      if (!parsed.path.startsWith(prefix)) continue;
      const name = parsed.path.slice(prefix.length);
      if (/^[A-Za-z0-9_.-]{1,200}$/.test(name) && !name.includes(".."))
        return {
          url: base + "/v1/media/" + name,
          headers: { Authorization: "Bearer " + config.apiKey },
        };
    }
  throw new ArtifactDownloadError("Muse 返回了无效的成品地址", "failed");
}
export const museDownload: ProviderPlugin = {
  ...museState,
  manifest: {
    ...museState.manifest,
    version: "1.8.0",
    configSchema: {
      ...museState.manifest.configSchema,
      properties: {
        ...(museState.manifest.configSchema.properties as Record<
          string,
          unknown
        >),
        publicUrl: { type: "string", pattern: "^https?://" },
      },
    },
    queue: {
      ...museState.manifest.queue!,
      timingVersions: [...museState.manifest.queue!.timingVersions, "1.8.0"],
    },
    artifactDownload: { version: 1 },
  },
  async downloadArtifact(request, signal) {
    const source = museArtifactSource(request.url, request.config);
    try {
      return await fetchArtifact(source.url, source.headers, {
        signal,
        timeout: 45000,
        maxBytes: 64 * 1024 ** 2,
        oversized: "Muse 成品超过 64 MB，未保存",
      });
    } catch (error) {
      if (error instanceof ArtifactDownloadError) throw error;
      throw new ArtifactDownloadError("", "retry");
    }
  },
};
