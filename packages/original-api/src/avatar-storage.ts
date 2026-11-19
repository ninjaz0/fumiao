import type { Platform } from "../../platform/src/platform.js";
import { one } from "../../platform/src/db.js";
/** Imported profiles may share an avatar; only the last reference may remove it. */
export async function discardAvatar(p: Platform, value: string) {
  if (!/^upload:[0-9a-f]{32}$/.test(value)) return;
  const object = await p.db.transaction(async (sql) => {
    const row = await one(
      sql,
      "SELECT object_key FROM avatar_objects WHERE public_id=$1 FOR UPDATE",
      [value.slice(7)],
    );
    if (
      !row ||
      (await one(sql, "SELECT id FROM users WHERE avatar=$1 LIMIT 1", [value]))
    )
      return;
    await sql.query("DELETE FROM avatar_objects WHERE public_id=$1", [
      value.slice(7),
    ]);
    return row.object_key;
  });
  if (object) await p.storage.remove(object);
}
