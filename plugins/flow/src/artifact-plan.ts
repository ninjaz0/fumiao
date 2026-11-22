import { splitArtifactUrl } from "@fumiao/plugin-sdk/artifact-url.js";
type Origin = { netloc: string; path: string };
export function flowDownloadPlan(url: string, base: Origin, alias: Origin) {
  const parsed = splitArtifactUrl(url);
  for (const origin of [
    base,
    alias,
    base.path ? base : { ...base, path: alias.path },
  ]) {
    const prefix = origin.path.replace(/\/+$/, "") + "/tmp/";
    if (parsed.netloc !== origin.netloc || !parsed.path.startsWith(prefix))
      continue;
    const name = parsed.path.slice(prefix.length);
    if (
      !/^[A-Za-z0-9_.-]{1,200}$/.test(name) ||
      name.includes("..") ||
      parsed.query ||
      parsed.fragment
    )
      return { error: "Flow 返回的缓存地址无效" } as const;
    return {
      path: "/tmp/" + name,
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
    return { error: "Flow 返回的媒体地址不受支持" } as const;
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
    return { error: "Flow 返回的媒体地址不受支持" } as const;
  return { external: url };
}
