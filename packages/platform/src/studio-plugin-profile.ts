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
  if (!(await hasStudioPackages(sql))) return true;
  const adapter = await one(
    sql,
    `SELECT 1 FROM studio_catalog c JOIN plugin_versions v
    ON (v.id,v.version)=(c.plugin_id,c.plugin_version)
    LEFT JOIN studio_packages p ON p.id=c.plugin_id
    WHERE COALESCE(p.installed,true) AND v.manifest->>'mode'='pull' AND v.manifest->'originalState'->'fields' ? 'gpu_models' LIMIT 1`,
  );
  return Boolean(adapter) || !(await studioPluginProfile(sql));
}

/** Import and migration callers can operate before the package tables exist. */
export async function hasStudioPackages(sql: Sql) {
  return !!(await one(sql, "SELECT to_regclass('studio_packages') AS name"))
    .name;
}

/** Package and global catalog changes affect admission. A queued job keeps
 * its original model, while separate per-service workspace restrictions apply. */
export async function queuedModelPolicy(sql: Sql) {
  const current =
    "((m.catalog_id IS NOT NULL OR m.enabled) AND studio_model_allowed(COALESCE(j.catalog_id,m.catalog_id),j.workspace_id))";
  return (await hasStudioPackages(sql))
    ? "(j.package_version IS NOT NULL OR " + current + ")"
    : current;
}
