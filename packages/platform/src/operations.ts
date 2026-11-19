import { StudioCatalog } from "./catalog.js";
import { z } from "zod";
import { Platform, uuid, type Actor } from "./platform.js";
import { one } from "./db.js";
import { executableJob } from "./retired-jobs.js";
import { requireValue, passwordRecord } from "./security.js";
export class Operations {
  constructor(private p: Platform) {}
  async user(actor: Actor, id: string, value: unknown) {
    this.p.admin(actor);
    uuid.parse(id);
    const input = z
      .object({
        active: z.boolean(),
        nickname: z.string().min(1).max(40),
        password: z.string().min(12).max(200).optional(),
      })
      .parse(value);
    return this.p.db.transaction(async (sql) => {
      const user = await one(
        sql,
        "SELECT * FROM users WHERE id=$1 FOR UPDATE",
        [id],
      );
      requireValue(user, 404, "用户不存在");
      requireValue(
        input.active || user.role !== "admin",
        400,
        "管理员账户不能在此禁用",
      );
      await sql.query(
        "UPDATE users SET active=$2,nickname=$3,password=$4 WHERE id=$1",
        [
          id,
          input.active,
          input.nickname,
          input.password ? await passwordRecord(input.password) : user.password,
        ],
      );
      if (!input.active || input.password)
        await sql.query("DELETE FROM sessions WHERE user_id=$1", [id]);
      await this.p.audit(sql, actor, "user.update", id);
      return { ok: true };
    });
  }
  async resolve(actor: Actor, id: string, value: unknown) {
    this.p.admin(actor);
    uuid.parse(id);
    const input = z
      .object({
        action: z.enum(["refund", "resume"]),
        reason: z.string().min(5).max(500),
        remoteId: z.string().min(1).max(500).optional(),
      })
      .parse(value);
    return this.p.db.transaction(async (sql) => {
      const job = await one(
        sql,
        `SELECT j.*, (${executableJob}) AS executable FROM jobs j WHERE id=$1 FOR UPDATE OF j`,
        [id],
      );
      requireValue(
        job && job.state === "uncertain",
        409,
        "只允许核对未确认任务",
      );
      if (input.action === "refund")
        await this.p.settle(
          sql,
          job,
          "failed",
          undefined,
          "管理员核对：" + input.reason,
        );
      else {
        requireValue(job.executable, 409, "退役任务只能人工核对退款");
        const plugin = await this.p.registry.resolve(
          sql,
          job.plugin_id,
          job.plugin_version,
        );
        requireValue(
          plugin.inspect && input.remoteId,
          400,
          "需要支持查询的插件及上游任务编号",
        );
        await sql.query(
          "UPDATE jobs SET state='running',remote_id=$2,error=NULL,lease_token=NULL,lease_until=NULL WHERE id=$1",
          [id, input.remoteId],
        );
      }
      await sql.query(
        "INSERT INTO job_events(job_id,state,detail) VALUES($1,'reconciled',$2)",
        [
          id,
          JSON.stringify({
            action: input.action,
            reason: input.reason,
            actor: actor.id,
          }),
        ],
      );
      await this.p.audit(sql, actor, "job.reconcile", id);
      return { ok: true };
    });
  }
  async upgrade(actor: Actor, id: string, value: unknown) {
    this.p.admin(actor);
    uuid.parse(id);
    const input = z
      .object({
        revision: z.number().int().positive(),
        version: z.string(),
        activateCatalog: z.boolean().default(false),
        config: z.record(z.string(), z.unknown()),
      })
      .parse(value);
    const row = await one(this.p.db, "SELECT * FROM connections WHERE id=$1", [
      id,
    ]);
    requireValue(row && !row.fmworker_resource_driver, 404, "连接不存在");
    const plugin = await this.p.registry.resolve(
      this.p.db,
      row.plugin_id,
      input.version,
    );
    const previous = await this.p.registry.resolve(
      this.p.db,
      row.plugin_id,
      row.plugin_version,
    );
    requireValue(!plugin.retired, 400, "此插件版本已退役");
    if (previous.manifest.chat && plugin.manifest.chat)
      requireValue(
        previous.chatProvider!(this.p.vault.open(row.config)) ===
          plugin.chatProvider!(input.config),
        400,
        "请为不同的对话服务新建连接",
      );
    const { validator, connectionModels } = await import("./plugins.js");
    requireValue(
      validator.validate(plugin.manifest.configSchema, input.config),
      400,
      "插件配置无效",
    );
    return this.p.db.transaction(async (sql) => {
      if (previous.manifest.chat || plugin.manifest.chat)
        await sql.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          ["original-chat-settings"],
        );
      // Global catalog locks precede connection locks throughout submission and upgrades.
      await sql.query(
        "SELECT pg_advisory_xact_lock(hashtext('studio-catalog'))",
      );
      await sql.query("SELECT * FROM studio_policy FOR UPDATE");
      if (input.activateCatalog)
        await new StudioCatalog(this.p.db).activate(sql, plugin.manifest);
      for (const model of plugin.manifest.models.filter((m) => m.studio)) {
        const active = await one(
          sql,
          "SELECT plugin_version FROM studio_catalog WHERE id=$1 AND plugin_id=$2",
          [model.id, row.plugin_id],
        );
        requireValue(
          active?.plugin_version === input.version,
          409,
          "连接版本与模型目录不一致，请显式激活插件目录",
        );
      }
      const updated = await one(
        sql,
        "UPDATE connections SET plugin_version=$2,config=$3,revision=revision+1,enabled=false WHERE id=$1 AND revision=$4 RETURNING id",
        [id, input.version, this.p.vault.seal(input.config), input.revision],
      );
      requireValue(updated, 409, "连接版本已变化");
      await sql.query(
        "UPDATE models SET enabled=false,catalog_id=NULL WHERE connection_id=$1",
        [id],
      );
      for (const model of connectionModels(plugin, input.config))
        await sql.query(
          `INSERT INTO models(id,connection_id,provider_model,label,kind,schema,catalog_id) VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6)
        ON CONFLICT(connection_id,provider_model) DO UPDATE SET label=EXCLUDED.label,kind=EXCLUDED.kind,schema=EXCLUDED.schema,catalog_id=EXCLUDED.catalog_id`,
          [
            id,
            model.id,
            model.label,
            model.kind,
            JSON.stringify(model.inputSchema),
            model.studio ? model.id : null,
          ],
        );
      await this.p.audit(sql, actor, "connection.upgrade", id);
      return { ok: true };
    });
  }
}
