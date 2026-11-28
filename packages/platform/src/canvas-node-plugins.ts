import { isDeepStrictEqual } from "node:util";
import { requireValue } from "./security.js";
import type { CanvasNodeEntry } from "@fumiao/plugin-sdk/canvas-nodes.js";
import { packageContributions } from "@fumiao/plugin-sdk/contributions.js";
import type { Sql } from "./db.js";

export const retiredShotPromptPluginId = "example-shot-prompt";

export async function canvasNodeEntries(sql: Sql): Promise<CanvasNodeEntry[]> {
  const releases =
    await sql.query(`SELECT p.id,p.version,r.package->'contributes' AS contributes
    FROM studio_packages p JOIN studio_package_releases r USING(id,version)
    WHERE p.installed AND p.enabled AND NOT p.removing AND p.id <> $1
      AND r.package->'contributes' ? 'canvasNodes' ORDER BY p.id`, [retiredShotPromptPluginId]);
  return releases.rows.flatMap((pkg) =>
    (packageContributions(pkg).canvasNodes ?? []).map(
      ({ program: _, ...node }) => ({
        ...node,
        plugin: pkg.id as string,
        version: pkg.version as string,
      }),
    ),
  );
}

/** Retained releases supply the original ports even after uninstall or an incompatible upgrade. */
export async function validateCanvasDefinitions(
  sql: Sql,
  entries: CanvasNodeEntry[],
) {
  if (!entries.length) return;
  const releases = await sql.query(
    `SELECT r.id,r.version,r.package->'contributes' AS contributes FROM studio_package_releases r
     JOIN (SELECT DISTINCT * FROM unnest($1::text[],$2::text[]) AS keys(id,version)) k USING(id,version)`,
    [entries.map((e) => e.plugin), entries.map((e) => e.version)],
  );
  const known = new Map(
    releases.rows.flatMap((pkg) =>
      (packageContributions(pkg).canvasNodes ?? []).map(
        ({ program: _, ...node }) => {
          const def = { ...node, plugin: pkg.id, version: pkg.version };
          return [JSON.stringify([pkg.id, pkg.version, node.id]), def] as const;
        },
      ),
    ),
  );
  for (const entry of entries) {
    requireValue(
      isDeepStrictEqual(
        known.get(JSON.stringify([entry.plugin, entry.version, entry.id])),
        entry,
      ),
      400,
      "插件节点定义与发行版本不符",
    );
  }
}
