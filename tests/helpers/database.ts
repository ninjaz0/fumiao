/** Fresh in-memory PostgreSQL or a random schema, never the application's schema. */
import { PGlite } from "@electric-sql/pglite";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Postgres,
  migrate,
  type Database,
  type Sql,
} from "@fumiao/platform/db.js";
import { Platform } from "@fumiao/platform/platform.js";
import { Vault } from "@fumiao/platform/security.js";
import { PluginRegistry } from "@fumiao/platform/plugins.js";
import { DiskStorage } from "@fumiao/platform/storage.js";
export async function databaseFixture(throughMigration?: string) {
  const directory = await mkdtemp(join(tmpdir(), "fumiao-identity-"));
  let db: Database;
  if (process.env.TEST_DATABASE_URL) {
    const admin = new Postgres(process.env.TEST_DATABASE_URL),
      schema = "test_" + randomUUID().replaceAll("-", "");
    await admin.query("CREATE SCHEMA " + schema);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set("options", "-c search_path=" + schema);
    const instance = new Postgres(url.toString());
    db = {
      query: instance.query.bind(instance),
      transaction: instance.transaction.bind(instance),
      close: async () => {
        await instance.close();
        await admin.transaction(async (sql) => {
          await sql.query("SELECT pg_advisory_xact_lock(2489731)");
          await sql.query("DROP SCHEMA " + schema + " CASCADE");
        });
        await admin.close();
      },
    };
  } else {
    const pg = new PGlite();
    const wrap = (handle: any): Sql => ({
      query: async (sql, params = []) =>
        !params.length && sql.includes(";")
          ? (await handle.exec(sql)).at(-1) || { rows: [] }
          : handle.query(sql, params),
    });
    db = {
      ...wrap(pg),
      transaction: (fn) => pg.transaction((tx) => fn(wrap(tx))),
      close: () => pg.close(),
    };
  }
  const p = new Platform(
    db,
    new Vault(randomBytes(32).toString("base64")),
    new PluginRegistry(),
    new DiskStorage(directory),
  );
  try {
    if (throughMigration) {
      await db.transaction(async (sql) => {
        await sql.query("SELECT pg_advisory_xact_lock(2489731)");
        for (const name of (await readdir("migrations"))
          .filter((n) => n.endsWith(".sql") && n <= throughMigration)
          .sort()) {
          await sql.query(await readFile(`migrations/${name}`, "utf8"));
          await sql.query("INSERT INTO schema_migrations(version) VALUES($1)", [
            name,
          ]);
        }
      });
    } else await migrate(db);
  } catch (error) {
    await db.close();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    p,
    db,
    directory,
    async cleanup() {
      await db.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

// PostgreSQL returns different wire representations for bigint and scaled numeric.
export function financialRows(table: string, rows: Record<string, any>[]) {
  const fields: Record<string, string[]> = {
    jobs: ["price"],
    wallets: ["balance", "held"],
    ledger: ["amount", "balance_snapshot", "held_snapshot"],
  };
  return rows.map((row) => {
    const normalized = { ...row };
    for (const field of fields[table] ?? []) {
      if (row[field] != null)
        normalized[field] = String(row[field]).replace(/\.0+$/, "");
    }
    return normalized;
  });
}
