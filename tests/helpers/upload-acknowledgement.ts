import assert from "node:assert/strict";
import type { Database } from "../../packages/platform/src/db.js";

/** Inject the transport failure only once the upload is visible on a fresh connection. */
export async function loseUploadAcknowledgement<T>(
  db: Database,
  upload: () => Promise<T>,
  offline: boolean,
  table: "assets" | "avatar_objects" = "assets",
) {
  const query = db.query.bind(db);
  const transaction = db.transaction.bind(db);
  const count = async () =>
    (
      await query<{ total: number }>(
        "SELECT count(*)::int AS total FROM " + table,
      )
    ).rows[0].total;
  const before = await count();
  let injected = false;
  function checkConnection() {
    if (injected && offline) throw new Error("synthetic database unavailable");
  }
  async function afterWrite() {
    if (!injected && (await count()) > before) {
      injected = true;
      throw new Error("synthetic lost database acknowledgement");
    }
  }
  db.query = async <T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => {
    checkConnection();
    const result = await query<T>(sql, params);
    if (/^\s*INSERT\b/i.test(sql)) await afterWrite();
    return result;
  };
  db.transaction = async (run) => {
    checkConnection();
    const result = await transaction(run);
    await afterWrite();
    return result;
  };
  try {
    const result = await upload();
    assert.ok(injected, "the upload must commit before losing the reply");
    return result;
  } finally {
    db.query = query;
    db.transaction = transaction;
  }
}
