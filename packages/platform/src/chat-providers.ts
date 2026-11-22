import type { Platform } from "./platform.js";
import {
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
    if (!versions.length && (await studioPluginProfile(sql))) return result;
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
      for (const provider of plugin.manifest.chat!.providers) {
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
        const fallback = inheritedKey(plugin, provider, config, !!managed);
        if (!plugin.chatConfigured!(config) && fallback) {
          const model = await one(
            sql,
            "SELECT plugin_id,plugin_version FROM studio_catalog WHERE id=$1",
            [fallback.model],
          );
          if (model) {
            const candidates = (
              await sql.query(
                "SELECT config FROM connections WHERE plugin_id=$1 AND plugin_version=$2" +
                  liveConnections +
                  " ORDER BY id" +
                  (lock ? " FOR SHARE" : ""),
                [model.plugin_id, model.plugin_version],
              )
            ).rows;
            requireValue(
              candidates.length <= 1,
              503,
              "原对话备用凭据连接存在歧义",
            );
            if (candidates[0]) {
              const imagePlugin = await this.p.registry.resolve(
                  sql,
                  model.plugin_id,
                  model.plugin_version,
                ),
                value = this.p.vault.open(candidates[0].config);
              if (
                imagePlugin.originalState?.configured(value) &&
                typeof value[fallback.field] === "string"
              ) {
                config = plugin.chatConfigure!(
                  config,
                  value[fallback.field] as string,
                );
                if (fallback.endpoints)
                  config.inheritedChatEndpoints = fallback.endpoints;
              }
            }
          }
        }
        result.set(provider.id, {
          plugin,
          provider,
          row: matches[0]?.row,
          storedConfig,
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
