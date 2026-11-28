import test from "node:test";
import assert from "node:assert/strict";
import { OriginalState } from "@fumiao/original-api/state.js";
import { stateJobsFixture } from "../helpers/state-jobs.js";
import type { Sql } from "@fumiao/platform/db.js";

test(
  "state job reads exclude foreign history but preserve global queue positions",
  {
    skip: !process.env.TEST_DATABASE_URL && "requires real PostgreSQL",
  },
  async () => {
    const f = await stateJobsFixture();
    try {
      await f.job(1, "completed", true);
      await f.job(2, "failed", true);
      await f.job(3, "cancelled", true);
      await f.job(4, "queued", true);
      const deleted = await f.job(5, "cancelled", true);
      await f.db.query("UPDATE jobs SET deleted_at=now() WHERE id=$1", [
        deleted.id,
      ]);
      await f.job(6);
      await f.job(7, "completed");
      const reads: { query: string; rows: Record<string, any>[] }[] = [];
      const transaction = f.db.transaction.bind(f.db);
      f.db.transaction = (fn) =>
        transaction((sql) =>
          fn({
            query: async (query, params) => {
              const result = await sql.query(query, params);
              if (/WHERE j\.workspace_id=\$1/.test(query) && /AS remote_studio/.test(query))
                reads.push({ query, rows: result.rows });
              return result;
            },
          } as Sql),
        );
      const state = await new OriginalState(f.p).read(f.admin);
      assert.deepEqual(
        state.jobs.map((j: any) => [j.id, j.ahead]),
        [
          [7, undefined],
          [6, 1],
        ],
      );
      assert.equal(reads.length, 1);
      assert.doesNotMatch(reads[0].query, /j\.\*|j\.receipt\b/);
      assert(reads[0].rows.every((row) => !("receipt" in row)));
      assert.equal(
        reads[0].rows.length,
        2,
        "full job projection must not fetch foreign history or queued jobs",
      );
      assert(reads[0].rows.every((j) => j.workspace_id === f.workspace.id));
      await f.db.query(
        "UPDATE jobs SET state='cancelled',deleted_at=now() WHERE workspace_id=$1",
        [f.workspace.id],
      );
      assert.deepEqual((await new OriginalState(f.p).read(f.admin)).jobs, []);
      await f.db.query(
        "UPDATE jobs SET provider_model='missing-model' WHERE public_id=4",
      );
      await assert.rejects(new OriginalState(f.p).read(f.admin), {
        status: 503,
      });
    } finally {
      await f.cleanup();
    }
  },
);
