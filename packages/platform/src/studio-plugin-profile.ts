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

/** Public model lists exclude removed packages and unconfigured seeds left by
 * legacy upgrades. Explicit catalogs contain only registered models. */
export async function listedStudioCatalog(
  sql: Sql,
  scope: "models" | "adapters" = "adapters",
) {
  if (!(await hasStudioPackages(sql))) return "studio_catalog";
  // A shared model can still be priced after its selected adapter is removed.
  // Adapter lookups must continue to exclude that adapter's configuration.
  const shared =
    scope === "models"
      ? ` OR EXISTS (
    SELECT 1 FROM studio_shared_models s
    JOIN studio_packages peer ON peer.id=s.plugin_id AND peer.installed
    JOIN studio_package_releases r ON (r.id,r.version)=(peer.id,peer.version)
    JOIN plugin_versions v ON v.id=peer.id AND v.version=r.package->>'adapterVersion'
    WHERE s.model_id=c.id AND v.manifest->'models' @> jsonb_build_array(jsonb_build_object('id',c.id))
  )`
      : "";
  return `(SELECT c.* FROM studio_catalog c
    LEFT JOIN studio_packages p ON p.id=c.plugin_id
    WHERE COALESCE(p.installed,
      NOT EXISTS (SELECT 1 FROM studio_plugin_profile WHERE mode='compatible')
      OR EXISTS (SELECT 1 FROM connections s WHERE s.plugin_id=c.plugin_id
        AND NOT s.removed AND NOT s.fmworker_resource_driver)
      OR EXISTS (SELECT 1 FROM plugin_versions v WHERE (v.id,v.version)=(c.plugin_id,c.plugin_version)
        AND v.endpoint IS NOT NULL))${shared})`;
}

export async function pairedPluginAvailable(sql: Sql) {
  if (!(await hasStudioPackages(sql))) return true;
  const adapter = await one(
    sql,
    `SELECT 1 FROM ${await listedStudioCatalog(sql)} c JOIN plugin_versions v
    ON (v.id,v.version)=(c.plugin_id,c.plugin_version)
    WHERE v.manifest->>'mode'='pull' AND v.manifest->'originalState'->'fields' ? 'gpu_models' LIMIT 1`,
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
