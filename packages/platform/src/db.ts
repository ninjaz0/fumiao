import pg from "pg";
import { readFile, readdir } from "node:fs/promises";
export interface Sql {
  query<T extends Record<string, any> = Record<string, any>>(
    sql: string,
    params?: any[],
  ): Promise<{ rows: T[] }>;
}
export interface Database extends Sql {
  transaction<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export class Postgres implements Database {
  pool: pg.Pool;
  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url, max: 15 });
  }
  async query<T extends Record<string, any> = Record<string, any>>(
    sql: string,
    params: any[] = [],
  ) {
    return this.pool.query<T>(sql, params);
  }
  async transaction<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async close() {
    await this.pool.end();
  }
}
export async function one(sql: Sql, statement: string, params: any[] = []) {
  return (await sql.query(statement, params)).rows[0];
}
/** Only a confirmed abort is safe to compensate after losing a COMMIT reply. */
export async function transactionCommitted(
  db: Sql,
  xid: string,
  error: unknown,
) {
  const {
    rows: [transaction],
  } = await db.query<{ status: string | null }>(
    "SELECT pg_xact_status($1::xid8) AS status",
    [xid],
  );
  if (transaction.status === "committed") return true;
  if (transaction.status === "aborted") return false;
  throw error;
}

export async function migrate(db: Database) {
  await db.transaction(async (sql) => {
    await sql.query("SELECT pg_advisory_xact_lock(2489731)");
    await sql.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const file of (await readdir("migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      if (
        await one(
          sql,
          "SELECT version FROM schema_migrations WHERE version=$1",
          [file],
        )
      )
        continue;
      await sql.query(await readFile(`migrations/${file}`, "utf8"));
      await sql.query("INSERT INTO schema_migrations(version) VALUES($1)", [
        file,
      ]);
    }
  });
}
