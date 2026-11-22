import type { Platform, Actor } from "@fumiao/platform/platform.js";
import { one, type Sql } from "@fumiao/platform/db.js";
import { requireValue } from "@fumiao/platform/security.js";
import { StudioCatalog } from "@fumiao/platform/catalog.js";
import { stateProviderFieldsSchema } from "@fumiao/plugin-sdk/index.js";
import { parseBody } from "./validation.js";
export class OriginalImageSettings {
  constructor(readonly p: Platform) {}
  private async resolve(sql: Sql, namespace: string) {
    const rows = (
      await sql.query(
        `SELECT DISTINCT v.id,v.version FROM studio_catalog c JOIN plugin_versions v ON v.id=c.plugin_id AND v.version=c.plugin_version
      WHERE v.manifest->'originalImageSettings'->>'namespace'=$1`,
        [namespace],
      )
    ).rows;
    requireValue(rows.length === 1, 503, "原图片设置插件尚未完整启用");
    const plugin = await this.p.registry.resolve(
      sql,
      rows[0].id,
      rows[0].version,
    );
    requireValue(
      plugin.originalState && plugin.checkOriginalSettings,
      503,
      "原图片设置适配器尚未安装",
    );
    return plugin;
  }
  async parse(namespace: string, value: unknown) {
    const plugin = await this.resolve(this.p.db, namespace);
    return parseBody(value, {
      enabled: { kind: "boolean", strict: false },
      default_model: {
        kind: "literal",
        values: [plugin.manifest.originalImageSettings!.defaultModel],
      },
    });
  }
  private async connection(sql: Sql, id: string, version: string) {
    const rows = (
      await sql.query(
        "SELECT * FROM connections WHERE plugin_id=$1 AND plugin_version=$2 ORDER BY id",
        [id, version],
      )
    ).rows;
    requireValue(rows.length <= 1, 503, "原状态提供方连接存在歧义");
    return rows[0];
  }
  async save(actor: Actor, namespace: string, value: unknown) {
    const input = await this.parse(namespace, value);
    this.p.admin(actor);
    return this.p.db.transaction(async (sql) => {
      const global = await one(sql, "SELECT * FROM studio_policy FOR UPDATE"),
        plugin = await this.resolve(sql, namespace),
        catalog = await new StudioCatalog(this.p.db).catalog(sql),
        flags = { ...global.flags };
      for (const model of plugin.manifest.originalImageSettings!
        .controlledModels) {
        requireValue(
          Object.hasOwn(catalog, model),
          503,
          "原图片设置模型尚未完整启用",
        );
        flags[model] = input.enabled;
      }
      for (const [id, spec] of Object.entries(catalog))
        if (spec.hidden) flags[id] = false;
      const enabled = Object.entries(catalog).some(
        ([id, spec]) => spec.kind === "image" && flags[id],
      );
      await sql.query("UPDATE studio_policy SET flags=$1,revision=revision+1", [
        JSON.stringify(flags),
      ]);
      await sql.query("UPDATE original_state_settings SET image_enabled=$1", [
        enabled,
      ]);
      const connection = await this.connection(
          sql,
          plugin.manifest.id,
          plugin.manifest.version,
        ),
        result = plugin.originalState!.configuration({
          catalog,
          stamp: Date.now() / 1000,
          imageEnabled: enabled,
          connection: connection
            ? {
                configured: plugin.originalState!.configured(
                  this.p.vault.open(connection.config),
                ),
                enabled: connection.enabled,
                health: {},
              }
            : undefined,
        });
      await this.p.audit(sql, actor, "studio.image-settings", namespace);
      return stateProviderFieldsSchema.shape.images.parse(result.images);
    });
  }
  async check(actor: Actor, namespace: string, signal: AbortSignal) {
    this.p.admin(actor);
    const { plugin, config } = await this.p.db.transaction(async (sql) => {
      const plugin = await this.resolve(sql, namespace),
        connection = await this.connection(
          sql,
          plugin.manifest.id,
          plugin.manifest.version,
        );
      return {
        plugin,
        config: connection ? this.p.vault.open(connection.config) : {},
      };
    });
    await plugin.checkOriginalSettings!(config, signal);
    return {
      ok: true,
      model: plugin.manifest.originalImageSettings!.defaultModel,
    };
  }
}
