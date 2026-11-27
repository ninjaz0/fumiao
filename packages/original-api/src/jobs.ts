import type { Actor, Platform } from "@fumiao/platform/platform.js";
import { one } from "@fumiao/platform/db.js";
import { requireValue } from "@fumiao/platform/security.js";
import { OriginalIdentity } from "./identity.js";
import { OriginalLibrary } from "./library.js";
import { OriginalMedia } from "./media.js";

/** Original job controls use public numbers, but one PostgreSQL task and ledger. */
export class OriginalJobs {
  constructor(private p: Platform) {}

  async cancel(user: Actor, id: number, selected?: string) {
    return this.p.db.transaction(async (sql) => {
      // Match original lookup/permission order, and serialize against worker claim.
      const job = await one(
        sql,
        "SELECT * FROM jobs WHERE public_id=$1 AND deleted_at IS NULL FOR UPDATE",
        [id],
      );
      requireValue(job, 404, "任务不存在");
      const workspace = await new OriginalIdentity(this.p).activeWorkspace(
        sql,
        user,
        selected,
      );
      await new OriginalLibrary(this.p).access(
        sql,
        user,
        { kind: "job", row: job },
        workspace.id,
      );
      requireValue(
        user.role === "admin" || job.owner_id === user.id,
        403,
        "只能管理自己的版本",
      );
      requireValue(job.state === "queued", 409, "只能撤回尚未开始的任务");
      await this.p.settle(sql, job, "cancelled");
      return { ok: true };
    });
  }

  async remove(user: Actor, id: number, selected?: string) {
    const objects = await this.p.db.transaction(async (sql) => {
      const job = await one(
        sql,
        "SELECT * FROM jobs WHERE public_id=$1 AND deleted_at IS NULL FOR UPDATE",
        [id],
      );
      requireValue(job, 404, "任务不存在");
      const workspace = await new OriginalIdentity(this.p).activeWorkspace(
        sql,
        user,
        selected,
      );
      await new OriginalLibrary(this.p).access(
        sql,
        user,
        { kind: "job", row: job },
        workspace.id,
      );
      requireValue(
        user.role === "admin" || job.owner_id === user.id,
        403,
        "只能管理自己的版本",
      );
      requireValue(
        ["completed", "failed", "cancelled"].includes(job.state),
        409,
        "请先撤回排队任务或等待运行结束",
      );
      const assets = (
        await sql.query(
          "SELECT a.* FROM assets a JOIN job_assets r ON r.asset_id=a.id WHERE r.job_id=$1 AND r.role='output' ORDER BY a.id FOR UPDATE OF a",
          [job.id],
        )
      ).rows;
      for (const asset of assets) {
        await new OriginalMedia(this.p).protect(sql, asset.id);
        requireValue(
          !(await one(
            sql,
            "SELECT j.id FROM jobs j JOIN job_assets r ON r.job_id=j.id WHERE r.asset_id=$1 AND j.deleted_at IS NULL AND (r.role='input' OR j.id<>$2) LIMIT 1",
            [asset.id, job.id],
          )),
          409,
          "仍有作品或任务引用这张图片，请先删除相关版本",
        );
      }
      const ids = assets.map((a) => a.id);
      // Retain immutable accounting and accepted request identity, hide the original record.
      await sql.query(
        "UPDATE jobs SET deleted_at=clock_timestamp() WHERE id=$1",
        [job.id],
      );
      await sql.query(
        "DELETE FROM favorites WHERE job_id=$1 OR asset_id=ANY($2::uuid[])",
        [job.id, ids],
      );
      await sql.query("DELETE FROM job_assets WHERE job_id=$1", [job.id]);
      await sql.query(
        "DELETE FROM document_assets WHERE asset_id=ANY($1::uuid[])",
        [ids],
      );
      if (job.source_kind === "builtin" && ids.length) {
        // Persist cleanup before dropping the last reference to private bytes.
        await sql.query(
          `INSERT INTO model_access_staging(job_id,output_index,asset_id,object_key)
          SELECT $1,(metadata->>'outputIndex')::integer,id,object_key FROM assets WHERE id=ANY($2::uuid[])`,
          [job.id, ids],
        );
      }
      await sql.query("DELETE FROM assets WHERE id=ANY($1::uuid[])", [ids]);
      return {
        keys: assets.map((a) => a.object_key as string),
        tracked: job.source_kind === "builtin",
      };
    });
    for (const key of objects.keys) {
      try {
        await this.p.storage.remove(key);
      } catch (error) {
        if (!objects.tracked) throw error;
        continue;
      }
      if (objects.tracked)
        await this.p.db.query(
          "DELETE FROM model_access_staging WHERE object_key=$1",
          [key],
        );
    }
    return { ok: true };
  }
}
