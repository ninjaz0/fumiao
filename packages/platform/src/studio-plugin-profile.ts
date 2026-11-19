import { one, type Sql } from "./db.js";

export async function studioPluginProfile(
  sql: Sql,
): Promise<"explicit" | "compatible" | undefined> {
  // A rolling upgrade can serve an older database before migration 033 commits.
  const schema = await one(
    sql,
    "SELECT to_regclass('studio_plugin_profile') AS profile",
  );
  if (!schema.profile) return undefined;
  return (
    await one(sql, "SELECT mode FROM studio_plugin_profile WHERE singleton")
  )?.mode;
}

export async function pairedPluginAvailable(sql: Sql) {
  const adapter = await one(
    sql,
    `SELECT 1 FROM studio_catalog c JOIN plugin_versions v
    ON (v.id,v.version)=(c.plugin_id,c.plugin_version)
    WHERE v.manifest->>'mode'='pull' AND v.manifest->'originalState'->'fields' ? 'gpu_models' LIMIT 1`,
  );
  return Boolean(adapter) || (await studioPluginProfile(sql)) !== "explicit";
}
