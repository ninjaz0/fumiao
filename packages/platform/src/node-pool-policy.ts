import { one, type Sql } from "./db.js";
import { loadProgram } from "./plugin-program.js";
import { requireValue } from "./security.js";

/** A node reports against its installed release. Job decisions always use
 * the immutable release recorded by accept, even during a package update. */
export async function nodePoolProgram(sql: Sql, id: string, version?: string) {
  const row = await one(
    sql,
    version === undefined
      ? `SELECT r.package->>'program' AS program FROM studio_packages p JOIN studio_package_releases r USING(id,version)
       WHERE p.id=$1 AND p.installed AND r.package->'contributes' ? 'nodePools'`
      : `SELECT package->>'program' AS program FROM studio_package_releases
       WHERE id=$1 AND version=$2 AND package->'contributes' ? 'nodePools'`,
    version === undefined ? [id] : [id, version],
  );
  requireValue(row?.program, 409, "节点池程序版本不可用");
  return loadProgram(row.program);
}
