import { readFile } from "node:fs/promises";

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
  const {
    format,
    label,
    version: packageVersion,
    adapterVersion,
    updateUrl,
    settingsPage,
    nodeClient,
    program,
  } = JSON.parse(
    await readFile(
      new URL("../../../../plugins/" + file, import.meta.url),
      "utf8",
    ),
  );
  // Only recover distribution metadata for sites provisioned before migration 034.
  // Resolution of a frozen job uses its stored adapter version.
  return {
    format,
    id,
    label,
    version: packageVersion,
    adapterVersion,
    updateUrl,
    settingsPage,
    nodeClient,
    program,
    legacyArchive: true,
  };
}
