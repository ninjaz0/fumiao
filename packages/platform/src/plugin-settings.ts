import { loadProgram } from "./plugin-program.js";
import { one, type Sql } from "./db.js";
import { validator } from "./schema.js";
import { DomainError, requireValue } from "./security.js";
import type {
  SettingsDeclaration,
  SettingsScope,
  SettingsValue,
} from "../../plugin-sdk/src/contributions.js";

/*
 * Plugin-scoped, non-secret settings (contract v1). Rows live in
 * studio_plugin_settings; secrets stay in encrypted connection config.
 * All writes are schema-validated and revisioned. Callers own the
 * transaction and the permission check.
 */

const MAX_BYTES = 64 * 1024;

function validate(schema: Record<string, unknown>, values: unknown) {
  const data = structuredClone(values ?? {});
  const check = validator.compile(schema);
  if (!check(data)) return null;
  requireValue(
    JSON.stringify(data).length <= MAX_BYTES,
    400,
    "插件设置超过 64 KB",
  );
  return data as Record<string, unknown>;
}

export interface SettingsTarget {
  pluginId: string;
  scope: SettingsScope;
  /** Workspace uuid for `workspace` scope, null for `global`. */
  workspaceId: string | null;
}

function where(t: SettingsTarget) {
  requireValue(
    (t.scope === "global") === (t.workspaceId === null),
    500,
    "插件设置范围无效",
  );
  return t.scope === "global"
    ? { clause: "plugin_id=$1 AND scope='global'", params: [t.pluginId] }
    : {
        clause: "plugin_id=$1 AND scope='workspace' AND workspace_id=$2",
        params: [t.pluginId, t.workspaceId],
      };
}

export class PluginSettingsStore {
  /**
   * Current values, or schema defaults with revision 0 when never saved.
   * Returns null when the package declares no schema for this scope.
   */
  async read(
    sql: Sql,
    target: SettingsTarget,
    declaration: SettingsDeclaration | undefined,
  ): Promise<SettingsValue | null> {
    const schema = declaration?.[target.scope];
    if (!schema) return null;
    const w = where(target);
    const row = await one(
      sql,
      `SELECT "values",revision FROM studio_plugin_settings WHERE ${w.clause}`,
      w.params,
    );
    if (row) return { values: row.values, revision: row.revision };
    return { values: validate(schema, {}) ?? {}, revision: 0 };
  }

  /** Replaces the stored values. 409 when `revision` is stale. */
  async write(
    sql: Sql,
    target: SettingsTarget & {
      declaration: SettingsDeclaration | undefined;
      packageVersion: string;
      values: unknown;
      revision: number;
      actorId: string;
    },
  ): Promise<SettingsValue> {
    const schema = target.declaration?.[target.scope];
    requireValue(schema, 400, "插件未声明此范围的设置");
    const values = validate(schema, target.values);
    requireValue(values, 400, "插件设置不符合声明");
    const w = where(target);
    const current = await one(
      sql,
      `SELECT revision FROM studio_plugin_settings WHERE ${w.clause} FOR UPDATE`,
      w.params,
    );
    requireValue(
      (current?.revision ?? 0) === target.revision,
      409,
      "设置已被其他管理员更改，请刷新",
    );
    if (current) {
      const n = w.params.length;
      await sql.query(
        `UPDATE studio_plugin_settings SET "values"=$${n + 1},revision=revision+1,package_version=$${n + 2},updated_by=$${n + 3},updated_at=now() WHERE ${w.clause}`,
        [
          ...w.params,
          JSON.stringify(values),
          target.packageVersion,
          target.actorId,
        ],
      );
    } else
      await sql.query(
        `INSERT INTO studio_plugin_settings(plugin_id,scope,workspace_id,"values",package_version,updated_by) VALUES($1,$2,$3,$4,$5,$6)`,
        [
          target.pluginId,
          target.scope,
          target.workspaceId,
          JSON.stringify(values),
          target.packageVersion,
          target.actorId,
        ],
      );
    return { values, revision: target.revision + 1 };
  }

  /**
   * Upgrade (or rollback to an older release without saved previous values):
   * runs `declaration.migrate` when present, validates against the new
   * schema and keeps the old values for `restore`. Throws 400 so the caller's
   * transaction aborts the upgrade when existing values cannot be carried.
   */
  async migrate(
    sql: Sql,
    pluginId: string,
    from: string,
    to: string,
    declaration: SettingsDeclaration | undefined,
  ) {
    const rows = (
      await sql.query(
        `SELECT scope,workspace_id,"values" FROM studio_plugin_settings WHERE plugin_id=$1 FOR UPDATE`,
        [pluginId],
      )
    ).rows;
    if (!rows.length) return;
    const run = declaration?.migrate
      ? await loadProgram("({migrate:" + declaration.migrate + "\n})")
      : null;
    for (const row of rows) {
      const scope = row.scope as SettingsScope;
      const schema = declaration?.[scope];
      if (!schema) {
        // The new release no longer declares this scope; keep for rollback.
        await sql.query(
          `UPDATE studio_plugin_settings SET previous_values="values",previous_version=$2,package_version=$3 WHERE plugin_id=$1 AND scope=$4 AND workspace_id IS NOT DISTINCT FROM $5`,
          [pluginId, from, to, scope, row.workspace_id],
        );
        continue;
      }
      let next: unknown = row.values;
      if (run)
        try {
          next = await run("migrate", row.values, { scope, from, to });
        } catch {
          throw new DomainError(400, "插件设置迁移失败");
        }
      const values = validate(schema, next);
      requireValue(
        values,
        400,
        run
          ? "插件设置迁移结果不符合新版本声明"
          : "现有插件设置不符合新版本声明，新版本需要提供 settings.migrate",
      );
      await sql.query(
        `UPDATE studio_plugin_settings SET previous_values="values",previous_version=$2,"values"=$3,package_version=$4,revision=revision+1,updated_at=now() WHERE plugin_id=$1 AND scope=$5 AND workspace_id IS NOT DISTINCT FROM $6`,
        [pluginId, from, JSON.stringify(values), to, scope, row.workspace_id],
      );
    }
  }

  /**
   * Rollback to `version`: restores values saved by the upgrade away from it.
   * Returns false when nothing was saved (caller may then call `migrate`).
   */
  async restore(sql: Sql, pluginId: string, version: string) {
    const result = await sql.query(
      `UPDATE studio_plugin_settings SET "values"=previous_values,package_version=previous_version,previous_values=NULL,previous_version=NULL,revision=revision+1,updated_at=now()
       WHERE plugin_id=$1 AND previous_version=$2 RETURNING 1`,
      [pluginId, version],
    );
    return result.rows.length > 0;
  }

  /** Removal completed: settings do not survive a later reinstall. */
  async purge(sql: Sql, pluginId: string) {
    await sql.query("DELETE FROM studio_plugin_settings WHERE plugin_id=$1", [
      pluginId,
    ]);
  }
}
