import type { OriginalNodes } from "../../../original-api/src/nodes.js";
import type { OriginalPairedAgent } from "../../../original-api/src/paired-agent.js";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import type { ProviderPlugin } from "../../../plugin-sdk/src/index.js";
import type { PairedAgentProtocol } from "../../../plugin-sdk/src/paired-agent.js";
import { requireValue } from "../security.js";

// The release build pins the exact reviewed native SDK bindings. Imported third-party
// JavaScript can only run in the capability-free QuickJS runtime.
const approved: Record<string, string> = JSON.parse(
  readFileSync(new URL("./official-adapters.json", import.meta.url), "utf8"),
);
export const reservedAdapterId = (id: string) =>
  Object.keys(approved).some((key) => key.split("@")[0] === id);
export type OfficialAdapter = {
  adapter: ProviderPlugin;
  protocol?: PairedAgentProtocol;
  NodeManagement?: typeof OriginalNodes;
  Agent?: typeof OriginalPairedAgent;
};
export async function officialAdapter(
  id: string,
  version: string,
  encoded: string,
): Promise<OfficialAdapter> {
  const bytes = Buffer.from(encoded, "base64");
  requireValue(
    createHash("sha256").update(bytes).digest("hex") ===
      approved[id + "@" + version],
    400,
    "无法验证插件的原生适配器",
  );
  const source = gunzipSync(bytes, { maxOutputLength: 8 * 1024 * 1024 })
    .toString("utf8")
    .replace(/"fumiao:(packages\/[\w/-]+)\.js"/g, (_, path) =>
      JSON.stringify(
        new URL("../../../../" + path + ".ts", import.meta.url).href,
      ),
    );
  const module = (await import(
    "data:text/javascript;base64," + Buffer.from(source).toString("base64")
  )) as OfficialAdapter;
  requireValue(
    module.adapter.manifest.id === id &&
      module.adapter.manifest.version === version,
    400,
    "适配器身份不一致",
  );
  return module;
}
