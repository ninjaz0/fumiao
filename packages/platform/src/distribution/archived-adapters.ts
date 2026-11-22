import { readFile } from "node:fs/promises";
import { requireValue } from "../security.js";

// Read-only release identities used to restore old databases and drain accepted
// jobs. A package can never supply code to the host's module loader.
const archives = new Map([
  ["flow@1.12.0", "flow/package/legacy-1.0.0.fmplugin.json"],
  ["muse@1.13.0", "muse/package/legacy-1.0.0.fmplugin.json"],
  ["gpu@1.11.0", "gpu/package/legacy-1.0.0.fmplugin.json"],
  [
    "compatible-chat@1.2.0",
    "compatible-chat/package/legacy-1.2.1.fmplugin.json",
  ],
]);
export const archivedAdapterVersions = [...archives.keys()];
export const hasArchivedAdapter = (id: string) =>
  archivedAdapterVersions.some((key) => key.split("@")[0] === id);

export async function archivedPackage(id: string, version: string) {
  const file = archives.get(id + "@" + version);
  if (!file) return undefined;
  return JSON.parse(
    await readFile(
      new URL("../../../../plugins/" + file, import.meta.url),
      "utf8",
    ),
  );
}

export async function archivedAdapter(
  id: string,
  version: string,
  encoded: string,
) {
  const release = await archivedPackage(id, version);
  requireValue(
    release &&
      Buffer.from(release.adapterModule, "base64").equals(
        Buffer.from(encoded, "base64"),
      ),
    400,
    "无法验证插件的原生适配器",
  );
  const history = await import("../historical-adapters.js");
  const adapter = history.studioReleases.find(
    ([, p]) => p.manifest.id === id && p.manifest.version === version,
  )?.[1];
  requireValue(adapter, 503, "历史适配器不可用");
  return {
    adapter,
    protocol: id === "gpu" ? history.gpuPairedAgent : undefined,
  };
}
