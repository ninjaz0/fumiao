import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Manifest } from "@fumiao/plugin-sdk/index.js";
import { publicAddress } from "./plugin-host.js";
import { validator } from "./schema.js";

export type AddressPause = "non-public" | "unresolved";
export const usesPublicConnection = (manifest: Manifest) =>
  !!manifest.chat?.sandbox || manifest.originalSubmission?.version === 5;
export function connectionBase(
  manifest: Manifest,
  config: Record<string, unknown>,
) {
  const provider = manifest.chat?.providers.find(
    (p) => p.id === config.provider,
  );
  return URL.parse(String(config.baseUrl || provider?.defaultConfig.baseUrl));
}

// Classify old settings without sending a key or issuing an HTTP request.
// The HTTP transport independently validates the actual socket destination.
export async function addressPause(
  manifest: Manifest,
  config: Record<string, unknown>,
): Promise<AddressPause | null> {
  if (!usesPublicConnection(manifest)) return null;
  const url = connectionBase(manifest, config);
  if (
    !url ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return "non-public";
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  )
    return "non-public";
  if (isIP(hostname)) return publicAddress(hostname) ? null : "non-public";
  let timer: NodeJS.Timeout | undefined;
  try {
    const ips = await Promise.race([
      lookup(hostname, { all: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Lookup timeout")), 3000);
      }),
    ]);
    if (!ips.length) return "unresolved";
    return ips.every((ip) => publicAddress(ip.address)) ? null : "non-public";
  } catch {
    return "unresolved";
  } finally {
    clearTimeout(timer);
  }
}

export function validSavedConfig(
  manifest: Manifest,
  config: Record<string, unknown>,
  pause: AddressPause | null,
) {
  const hasAddress = typeof config.baseUrl === "string";
  if (validator.validate(manifest.configSchema, config)) return true;
  // Grandfather only the obsolete address on this paused row. Other schema
  // changes and missing required credentials must still be addressed normally.
  const errors = validator.errors ?? [];
  return (
    !!pause &&
    hasAddress &&
    errors.length > 0 &&
    errors.every((e) => e.instancePath === "/baseUrl")
  );
}
