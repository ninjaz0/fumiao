import test from "node:test";
import assert from "node:assert/strict";
import { chatSettingsFixture } from "../helpers/chat-settings.js";
import { Platform } from "@fumiao/platform/platform.js";
import { Operations } from "@fumiao/platform/operations.js";
import { one } from "@fumiao/platform/db.js";

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test(
  "a chat upgrade waiting for installation leaves the chat settings lock available to the installer",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const f = await chatSettingsFixture();
    t.after(f.cleanup);
    const entered = signal(),
      finish = signal(),
      contending = signal();
    const installation = f.db.transaction(async (sql) => {
      await sql.query(
        "SELECT pg_advisory_xact_lock(hashtext('studio-catalog'))",
      );
      entered.resolve();
      await finish.promise;
      await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "original-chat-settings",
      ]);
    });
    await entered.promise;
    const platform = new Platform(
      {
        ...f.db,
        transaction: (fn) =>
          f.db.transaction((sql) =>
            fn({
              query<T extends Record<string, any>>(
                statement: string,
                params?: any[],
              ) {
                const result = sql.query<T>(statement, params);
                if (statement.includes("studio-catalog")) contending.resolve();
                return result;
              },
            }),
          ),
      },
      f.p.vault,
      f.p.registry,
      f.p.storage,
    );
    const id = f.ids.deepseek,
      row = await one(
        f.db,
        "SELECT revision,plugin_version FROM connections WHERE id=$1",
        [id],
      );
    const upgrade = new Operations(platform).upgrade(f.admin, id, {
      revision: row.revision,
      version: row.plugin_version,
      config: f.wire.config("deepseek-flash"),
    });
    try {
      await Promise.race([contending.promise, upgrade]);
    } finally {
      finish.resolve();
      await Promise.all([installation, upgrade]);
    }
    assert.equal(
      (await one(f.db, "SELECT revision FROM connections WHERE id=$1", [id]))
        .revision,
      row.revision + 1,
    );
  },
);
