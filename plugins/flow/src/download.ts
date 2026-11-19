import { flowState } from "./state.js";
import {
  ArtifactDownloadError,
  fetchArtifact,
  splitArtifactUrl,
  type ProviderPlugin,
} from "../../../packages/plugin-sdk/src/index.js";

export function flowArtifactSource(
  url: string,
  config: Record<string, unknown>,
) {
  const base = String(config.baseUrl).replace(/\/+$/, ""),
    publicUrl = String(
      config.publicUrl || "https://backend.nvmes.com/flow",
    ).replace(/\/+$/, ""),
    parsed = splitArtifactUrl(url);
  for (const origin of [
    base,
    publicUrl,
    splitArtifactUrl(base).path
      ? base
      : base + splitArtifactUrl(publicUrl).path,
  ]) {
    const allowed = splitArtifactUrl(origin),
      prefix = allowed.path.replace(/\/+$/, "") + "/tmp/";
    if (parsed.netloc !== allowed.netloc || !parsed.path.startsWith(prefix))
      continue;
    const name = parsed.path.slice(prefix.length);
    if (
      !/^[A-Za-z0-9_.-]{1,200}$/.test(name) ||
      name.includes("..") ||
      parsed.query ||
      parsed.fragment
    )
      throw new ArtifactDownloadError("Flow 返回的缓存地址无效", "failed");
    return {
      url: base + "/tmp/" + name,
      headers: { Authorization: "Bearer " + config.apiKey },
    };
  }
  // Check the literal hostname before WHATWG URL decoding or slash normalization.
  const at = parsed.netloc.lastIndexOf("@"),
    credentials = at < 0 ? "" : parsed.netloc.slice(0, at),
    authority = parsed.netloc.slice(at + 1),
    colon = authority.lastIndexOf(":"),
    hostname = (
      colon < 0 ? authority : authority.slice(0, colon)
    ).toLowerCase(),
    port = colon < 0 ? "" : authority.slice(colon + 1);
  if (parsed.scheme !== "https" || credentials.replace(":", ""))
    throw new ArtifactDownloadError("Flow 返回的媒体地址不受支持", "failed");
  if (port && (!/^\d+$/.test(port) || Number(port) > 65535))
    throw new Error("Invalid port");
  if (
    (port && Number(port) !== 443) ||
    !(
      hostname === "storage.googleapis.com" ||
      hostname === "flow-content.google" ||
      hostname.endsWith(".googleusercontent.com")
    )
  )
    throw new ArtifactDownloadError("Flow 返回的媒体地址不受支持", "failed");
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
