import type { Platform } from "./platform.js";
import {
  adoptedModels,
  studioPluginProfile,
  listedStudioCatalog,
} from "./studio-plugin-profile.js";
import { one, type Sql } from "./db.js";
import { requireValue } from "./security.js";
import { validSavedConfig } from "./connection-address.js";
import { hasStudioPackages } from "./studio-plugin-profile.js";
import type { ProviderPlugin, ChatPolicy } from "@fumiao/plugin-sdk/index.js";
export type ChatConnection = {
  plugin: ProviderPlugin;
  provider: ChatPolicy["providers"][number];
  row?: Record<string, any>;
  storedConfig: Record<string, unknown>;
  config: Record<string, unknown>;
  configured: boolean;
  borrowedFrom?: string;
};
// Older Studio accounts share the image connection's credential with this exact
// provider and these two endpoints. Sandbox manifests cannot create such grants.
function inheritedKey(
  plugin: ProviderPlugin,
  provider: ChatConnection["provider"],
  config: Record<string, unknown>,
  managed: boolean,
) {
  const defaultUrl = provider.defaultConfig.baseUrl;
  const target = URL.parse(String(config.baseUrl || defaultUrl));
  if (plugin.manifest.chat?.sandbox) {
    if (target) target.pathname = target.pathname.replace(/\/+$/, "") + "/";
    if (
      plugin.manifest.id !== "compatible-chat" ||
      provider.id !== "openai" ||
      defaultUrl !== "https://api.openai.com/v1/" ||
      target?.href !== defaultUrl ||
      provider.models.length !== 1 ||
      provider.models[0] !== "gpt-4.1"
    )
      return;
    return {
      model: "gpt-image-2.6-sunburst",
      field: "apiKey",
      endpoints: {
        probe: new URL("models", target).href,
        reply: new URL("chat/completions", target).href,
      },
    };
  }
  if (
    provider.credentialFallback &&
    (!managed ||
      (typeof defaultUrl === "string" &&
        target?.origin === new URL(defaultUrl).origin))
  )
    return { ...provider.credentialFallback, endpoints: undefined };
}
/** Read the live catalog's donor and run its currently active adapter's predicate.
 * This lookup is independent of public ownership of the borrowing chat model.
 */
export async function chatCredentialDonor(
  sql: Sql,
  access: Pick<Platform, "vault" | "registry">,
  grant: { model: string; field: string },
  options: { lock?: boolean; expectedId?: string } = {},
) {
  const live = (await hasStudioPackages(sql)) ? " AND NOT c.removed" : "";
  const candidates = await sql.query(
    `SELECT c.* FROM studio_catalog model JOIN connections c
    ON (c.plugin_id,c.plugin_version)=(model.plugin_id,model.plugin_version)
    WHERE model.id=$1` +
      live +
      " ORDER BY c.id" +
      (options.lock ? " FOR SHARE OF c" : ""),
    [grant.model],
  );
  requireValue(
    candidates.rows.length <= 1,
    options.expectedId ? 403 : 503,
    "原对话备用凭据连接存在歧义",
  );
  const donor = candidates.rows[0];
  if (
    !donor ||
    (options.expectedId &&
      (donor.id !== options.expectedId || donor.sandbox_address_pause))
  )
    return;
  const plugin = await access.registry.resolve(
    sql,
    donor.plugin_id,
    donor.plugin_version,
  );
  const config = access.vault.open(donor.config);
  if (
    plugin.originalState?.configured(config) &&
    typeof config[grant.field] === "string"
  ) {
    return { id: String(donor.id), key: config[grant.field] as string };
  }
}

/** Resolve only the explicitly active catalog version. Credentials stay server-side;
 * inherited image credentials are applied in memory, never copied to another row. */
export class ChatProviders {
  constructor(readonly p: Platform) {}
  async read(sql: Sql, lock = false): Promise<Map<string, ChatConnection>> {
    const versions = (
      await sql.query(`SELECT DISTINCT v.id,v.version FROM ${await listedStudioCatalog(sql)} c
      JOIN plugin_versions v ON v.id=c.plugin_id AND v.version=c.plugin_version
      WHERE v.manifest->'chat' IS NOT NULL ORDER BY v.id,v.version`)
    ).rows;
    const result = new Map<string, ChatConnection>();
    if (
      !versions.length &&
      ((await studioPluginProfile(sql)) ||
        (await one(
          sql,
          "SELECT 1 FROM studio_catalog WHERE plugin_id IS NULL AND descriptor->>'kind'='chat' LIMIT 1",
        )))
    )
      return result;
    requireValue(versions.length, 503, "原对话插件尚未完整启用");
    const packaged = await hasStudioPackages(sql);
    const liveConnections = packaged ? " AND NOT removed" : "";
    for (const v of versions) {
      const managed =
        packaged &&
        (await one(
          sql,
          "SELECT installed,removing FROM studio_packages WHERE id=$1",
          [v.id],
        ));
      if (managed && (!managed.installed || managed.removing)) continue;
      const plugin = await this.p.registry.resolve(sql, v.id, v.version);
      const rows = (
        await sql.query(
          "SELECT * FROM connections WHERE plugin_id=$1 AND plugin_version=$2" +
            liveConnections +
            " ORDER BY id" +
            (lock ? " FOR SHARE" : ""),
          [v.id, v.version],
        )
      ).rows;
      const configs = rows.map((row) => ({
        row,
        config: this.p.vault.open(row.config),
      }));
      requireValue(
        configs.every((c) =>
          validSavedConfig(
            plugin.manifest,
            c.config,
            c.row.sandbox_address_pause ?? null,
          ),
        ),
        503,
        "原对话连接配置无效",
      );
      const adopted = await adoptedModels(sql, v.id);
      for (const definition of plugin.manifest.chat!.providers) {
        const provider = {
          ...definition,
          models: definition.models.filter((id) => !adopted.has(id)),
        };
        if (!provider.models.length) continue;
        requireValue(!result.has(provider.id), 503, "原对话提供方连接存在歧义");
        const active = (
          await sql.query(
            "SELECT id FROM studio_catalog WHERE plugin_id=$1 AND plugin_version=$2 AND id=ANY($3::text[])",
            [v.id, v.version, provider.models],
          )
        ).rows;
        requireValue(
          active.length === provider.models.length,
          503,
          "原对话模型尚未完整启用",
        );
        const matches = configs.filter(
          (c) => plugin.chatProvider!(c.config) === provider.id,
        );
        requireValue(matches.length <= 1, 503, "原对话提供方连接存在歧义");
        const storedConfig = matches[0]?.config ?? {
          ...provider.defaultConfig,
        };
        let config = { ...storedConfig };
        // An imported service may use a custom host. Only inherit a credential
        // for the provider's declared destination on managed installations.
        let borrowedFrom: string | undefined;
        const fallback = inheritedKey(plugin, definition, config, !!managed);
        if (!plugin.chatConfigured!(config) && fallback) {
          const donor = await chatCredentialDonor(sql, this.p, fallback, {
            lock,
          });
          if (donor) {
            borrowedFrom = donor.id;
            config = plugin.chatConfigure!(config, donor.key);
            if (fallback.endpoints)
              config.inheritedChatEndpoints = fallback.endpoints;
          }
        }
        result.set(provider.id, {
          plugin,
          provider,
          row: matches[0]?.row,
          storedConfig,
          borrowedFrom,
          config,
          configured:
            !matches[0]?.row.sandbox_address_pause &&
            plugin.chatConfigured!(config),
        });
      }
    }
    return result;
  }
}
