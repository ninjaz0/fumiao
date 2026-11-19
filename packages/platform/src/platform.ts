import { hasStudioPackages } from "./studio-plugin-profile.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { one, type Database, type Sql } from "./db.js";
import {
  requireValue,
  hash,
  secret,
  passwordRecord,
  verifyPassword,
  Vault,
} from "./security.js";
import {
  PluginRegistry,
  validator,
  canonical,
  connectionModels,
} from "./plugins.js";
import { StudioCatalog } from "./catalog.js";
import { inspectMedia } from "./media.js";
import type { Storage } from "./storage.js";
import { capacity } from "./capacity.js";
import { ReferencePacks } from "./packs.js";
import { JobTiming } from "./timing.js";
import { acceptTask } from "./accept.js";
import { prepareSubmission } from "./prepare-input.js";
import type { TimingReport } from "../../plugin-sdk/src/timing.js";
export type Actor = {
  id: string;
  name: string;
  nickname: string;
  role: string;
};
export const uuid = z.string().uuid();
const credentials = z.object({
  name: z.string().trim().min(1).max(40),
  password: z.string().min(12).max(200),
});
const submission = z.object({
  modelId: uuid,
  priceRevision: z.number().int().positive().optional(),
  key: uuid,
  prompt: z.string().trim().min(1).max(12000),
  params: z.record(z.string(), z.unknown()).default({}),
  references: z.array(uuid).max(12).default([]),
  referencePacks: z
    .array(z.object({ id: uuid, revision: z.number().int().min(1) }))
    .max(9)
    .default([]),
});
export class Platform {
  constructor(
    public db: Database,
    public vault: Vault,
    public registry: PluginRegistry,
    public storage: Storage,
  ) {}
  admin(user: Actor) {
    requireValue(user.role === "admin", 403, "需要管理员权限");
  }
  async workspace(sql: Sql, user: Actor, id: string) {
    uuid.parse(id);
    const row = await one(
      sql,
      `SELECT w.* FROM workspaces w WHERE w.id=$1 AND
      ((w.kind='personal' AND w.owner_id=$2) OR (w.kind='team' AND ($3='admin' OR EXISTS(SELECT 1 FROM members m WHERE m.workspace_id=w.id AND m.user_id=$2))))`,
      [id, user.id, user.role],
    );
    requireValue(row, 404, "工作区不存在或无访问权限");
    return row;
  }
  async audit(sql: Sql, user: Actor, action: string, resource: string) {
    await sql.query(
      "INSERT INTO audit_events(actor_id,action,resource) VALUES($1,$2,$3)",
      [user.id, action, resource],
    );
  }
  async createUser(
    sql: Sql,
    name: string,
    nickname: string,
    password: string,
    role: string,
  ) {
    const id = randomUUID(),
      wid = randomUUID();
    await sql.query(
      "INSERT INTO users(id,name,nickname,password,role) VALUES($1,$2,$3,$4,$5)",
      [id, name, nickname, await passwordRecord(password), role],
    );
    await sql.query(
      "INSERT INTO workspaces(id,name,owner_id,kind) VALUES($1,$2,$3,'personal')",
      [wid, nickname + "的空间", id],
    );
    await sql.query("INSERT INTO wallets(workspace_id) VALUES($1)", [wid]);
    await sql.query("UPDATE users SET default_workspace=$2 WHERE id=$1", [
      id,
      wid,
    ]);
    return { id, workspaceId: wid, name, nickname, role };
  }
  async bootstrap(value: unknown) {
    const input = credentials
      .extend({ nickname: z.string().min(1).max(40) })
      .parse(value);
    return this.db.transaction(async (sql) => {
      await sql.query("SELECT pg_advisory_xact_lock(2489732)");
      requireValue(
        !(await one(sql, "SELECT id FROM users WHERE role='admin' LIMIT 1")),
        409,
        "管理员已初始化",
      );
      return this.createUser(
        sql,
        input.name,
        input.nickname,
        input.password,
        "admin",
      );
    });
  }
  async register(value: unknown) {
    const input = credentials
      .extend({
        nickname: z.string().min(1).max(40),
        code: z.string().min(1).max(128),
      })
      .parse(value);
    return this.db.transaction(async (sql) => {
      const invitation = await one(
        sql,
        "SELECT * FROM invites WHERE code_hash=ANY($1::text[]) AND enabled=true AND (expires_at IS NULL OR expires_at>now()) FOR UPDATE",
        [[hash(input.code.trim()), hash(input.code.trim().toUpperCase())]],
      );
      requireValue(
        invitation && invitation.role === "member",
        400,
        "邀请码无效",
      );
      const user = await this.createUser(
        sql,
        input.name,
        input.nickname,
        input.password,
        "member",
      );
      if (invitation.workspace_id) {
        await sql.query(
          "INSERT INTO members(workspace_id,user_id) VALUES($1,$2)",
          [invitation.workspace_id, user.id],
        );
        await sql.query("UPDATE users SET default_workspace=$2 WHERE id=$1", [
          user.id,
          invitation.workspace_id,
        ]);
      }
      const amount = invitation.grant_credits ? Number(invitation.credits) : 0;
      if (amount)
        await this.credit(
          sql,
          user.workspaceId,
          amount,
          `registration:${user.id}`,
          "grant",
          {
            actorId: invitation.created_by,
            note: "注册赠送 · " + invitation.name,
            uid:
              "registration:" +
              Number(
                (
                  await one(sql, "SELECT public_id FROM users WHERE id=$1", [
                    user.id,
                  ])
                ).public_id,
              ),
          },
        );
      await sql.query(
        "INSERT INTO registration_redemptions(user_id,invitation_id,credits,workspace_id) VALUES($1,$2,$3,$4)",
        [user.id, invitation.id, amount, invitation.workspace_id],
      );
      await sql.query("UPDATE invites SET uses=uses+1 WHERE id=$1", [
        invitation.id,
      ]);
      return { id: user.id };
    });
  }
  async login(value: unknown, peer: string) {
    const input = z
      .object({
        name: z.string().min(1).max(40),
        password: z.string().min(1).max(200),
      })
      .parse(value);
    const key = hash(peer + ":" + input.name.toLowerCase());
    const attempt = await one(
      this.db,
      `INSERT INTO login_attempts(key,attempts,expires_at) VALUES($1,1,now()+interval '5 minutes')
      ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_attempts.expires_at<now() THEN 1 ELSE login_attempts.attempts+1 END,
      expires_at=CASE WHEN login_attempts.expires_at<now() THEN now()+interval '5 minutes' ELSE login_attempts.expires_at END RETURNING attempts`,
      [key],
    );
    requireValue(attempt.attempts <= 10, 429, "登录尝试过多，请稍后再试");
    const user = await one(
      this.db,
      "SELECT * FROM users WHERE translate(name,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')=translate($1,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz') AND active=true AND deleted_at IS NULL",
      [input.name],
    );
    requireValue(
      user && (await verifyPassword(input.password, user.password)),
      401,
      "用户名或密码错误",
    );
    const upgraded = user.password.startsWith("legacy-scrypt:")
      ? await passwordRecord(input.password)
      : user.password;
    return this.db.transaction(async (sql) => {
      const current = await one(
        sql,
        "SELECT * FROM users WHERE id=$1 FOR UPDATE",
        [user.id],
      );
      requireValue(
        current?.active &&
          !current.deleted_at &&
          current.password === user.password,
        401,
        "用户名或密码错误",
      );
      if (upgraded !== user.password)
        await sql.query("UPDATE users SET password=$2 WHERE id=$1", [
          user.id,
          upgraded,
        ]);
      const token = secret();
      await sql.query(
        "INSERT INTO sessions(token,user_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
        [hash(token), user.id],
      );
      await sql.query("DELETE FROM login_attempts WHERE key=$1", [key]);
      return token;
    });
  }
  async actor(token: string): Promise<Actor> {
    requireValue(token && token.length <= 200, 401, "请先登录");
    const user = await one(
      this.db,
      "SELECT u.id,u.name,u.nickname,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=$1 AND s.expires_at>now() AND u.active=true AND u.deleted_at IS NULL",
      [hash(token)],
    );
    requireValue(user, 401, "登录已失效");
    return user as Actor;
  }
  async logout(token: string) {
    await this.db.query("DELETE FROM sessions WHERE token=$1", [hash(token)]);
  }
  async workspaces(user: Actor) {
    return (
      await this.db.query(
        `SELECT DISTINCT w.* FROM workspaces w LEFT JOIN members m ON m.workspace_id=w.id
      WHERE (w.kind='personal' AND w.owner_id=$1) OR (w.kind='team' AND (m.user_id=$1 OR $2='admin')) ORDER BY w.created_at`,
        [user.id, user.role],
      )
    ).rows;
  }
  async createWorkspace(user: Actor, value: unknown) {
    this.admin(user);
    const input = z
      .object({
        name: z.string().trim().min(1).max(80),
        members: z.array(uuid).max(1000).default([]),
      })
      .parse(value);
    return this.db.transaction(async (sql) => {
      const id = randomUUID();
      await sql.query(
        "INSERT INTO workspaces(id,name,owner_id,kind) VALUES($1,$2,$3,'team')",
        [id, input.name, user.id],
      );
      await sql.query("INSERT INTO wallets(workspace_id) VALUES($1)", [id]);
      for (const uid of new Set(input.members))
        await sql.query(
          "INSERT INTO members(workspace_id,user_id) VALUES($1,$2)",
          [id, uid],
        );
      await this.audit(sql, user, "workspace.create", id);
      return { id };
    });
  }
  async updateWorkspace(user: Actor, wid: string, value: unknown) {
    this.admin(user);
    const input = z
      .object({
        name: z.string().trim().min(1).max(80),
        members: z.array(uuid).max(1000),
      })
      .parse(value);
    return this.db.transaction(async (sql) => {
      const workspace = await this.workspace(sql, user, wid);
      requireValue(workspace.kind === "team", 400, "此操作适用于团队空间");
      await sql.query(
        "UPDATE workspaces SET name=$2,revision=revision+1 WHERE id=$1",
        [wid, input.name],
      );
      await sql.query("DELETE FROM members WHERE workspace_id=$1", [wid]);
      for (const uid of new Set(input.members))
        await sql.query(
          "INSERT INTO members(workspace_id,user_id) VALUES($1,$2)",
          [wid, uid],
        );
      await this.audit(sql, user, "workspace.update", wid);
    });
  }
  async createInvite(user: Actor, value: unknown) {
    this.admin(user);
    const input = z
      .object({
        name: z.string().min(1).max(80),
        workspaceId: uuid.optional(),
        credits: z.number().int().min(0).max(1000000).default(0),
        expiresAt: z.iso.datetime().optional(),
      })
      .parse(value);
    const id = randomUUID(),
      code = secret().toUpperCase();
    if (input.workspaceId) {
      const w = await this.workspace(this.db, user, input.workspaceId);
      requireValue(w.kind === "team", 400, "邀请码只能关联团队空间");
    }
    await this.db.query(
      "INSERT INTO invites(id,code_hash,name,workspace_id,credits,expires_at,code_secret,created_by,grant_credits) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        id,
        hash(code),
        input.name,
        input.workspaceId || null,
        input.credits,
        input.expiresAt || null,
        this.vault.seal({ code }),
        user.id,
        input.credits > 0,
      ],
    );
    return { id, code };
  }
  async credit(
    sql: Sql,
    wid: string,
    amount: number,
    key: string,
    action: string,
    context: {
      actorId?: string | null;
      jobId?: string;
      note?: string;
      uid?: string;
    } = {},
  ) {
    await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "credit:" + (context.uid ? "uid:" + context.uid : key),
    ]);
    const matches = (
      await sql.query("SELECT * FROM ledger WHERE key=$1 OR original_uid=$2", [
        key,
        context.uid ?? null,
      ])
    ).rows;
    requireValue(matches.length <= 1, 409, "积分操作幂等键已被使用");
    const prior = matches[0];
    if (prior) {
      requireValue(
        prior.workspace_id === wid &&
          Number(prior.amount) === amount &&
          prior.action === action &&
          // Earlier Advanced rows have no actor/note snapshots. Keep their existing
          // retry contract; do not invent historical metadata during a retry.
          (prior.balance_snapshot === null ||
            (prior.actor_id === (context.actorId ?? null) &&
              prior.job_id === (context.jobId ?? null) &&
              prior.note === (context.note ?? "") &&
              prior.original_uid === (context.uid ?? null))),
        409,
        "积分操作幂等键已被使用",
      );
      return;
    }
    const wallet = await one(
      sql,
      "UPDATE wallets SET balance=balance+$2 WHERE workspace_id=$1 AND balance+$2>=held RETURNING balance,held",
      [wid, amount],
    );
    requireValue(wallet, 409, "可用积分不足");
    await sql.query(
      `INSERT INTO ledger(id,workspace_id,key,action,amount,actor_id,note,original_uid,balance_snapshot,held_snapshot,job_id,original_job_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,(SELECT public_id FROM jobs WHERE id=$11))`,
      [
        randomUUID(),
        wid,
        key,
        action,
        amount,
        context.actorId ?? null,
        context.note ?? "",
        context.uid ?? null,
        wallet.balance,
        wallet.held,
        context.jobId ?? null,
      ],
    );
  }

  async adjustCredits(user: Actor, wid: string, value: unknown) {
    this.admin(user);
    uuid.parse(wid);
    const input = z
      .object({
        amount: z.number().int().min(-100000000).max(100000000),
        key: uuid,
      })
      .parse(value);
    await this.db.transaction(async (sql) => {
      await this.credit(
        sql,
        wid,
        input.amount,
        `adjust:${wid}:${input.key}`,
        "adjust",
        { actorId: user.id, uid: input.key },
      );
      await this.audit(sql, user, "credits.adjust", wid);
    });
  }
  async wallet(user: Actor, wid: string) {
    await this.workspace(this.db, user, wid);
    return one(this.db, "SELECT * FROM wallets WHERE workspace_id=$1", [wid]);
  }
  async ledger(user: Actor, wid: string) {
    await this.workspace(this.db, user, wid);
    return (
      await this.db.query(
        "SELECT * FROM ledger WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 100",
        [wid],
      )
    ).rows;
  }
  async connections(user: Actor) {
    this.admin(user);
    return (
      await this.db.query(
        "SELECT id,name,plugin_id,plugin_version,revision,enabled,concurrency FROM connections WHERE NOT removed AND NOT fmworker_resource_driver ORDER BY name",
      )
    ).rows;
  }
  async studioConnections(user: Actor) {
    this.admin(user);
    const rows = (
      await this.db.query<{
        id: string;
        name: string;
        plugin_id: string;
        plugin_version: string;
        revision: number;
        enabled: boolean;
        concurrency: number;
        config: string;
        fields: Record<string, { writeOnly?: boolean }>;
      }>(`SELECT c.id,c.name,c.plugin_id,c.plugin_version,c.revision,c.enabled,c.concurrency,c.config,
      v.manifest->'configSchema'->'properties' AS fields FROM connections c JOIN plugin_versions v ON (v.id,v.version)=(c.plugin_id,c.plugin_version)
      WHERE NOT c.removed AND NOT c.fmworker_resource_driver ORDER BY c.name`)
    ).rows;
    return rows.map(({ config, fields, ...row }) => {
      const saved = this.vault.open(config);
      // Only expressly public service fields may be returned to a browser.
      const values = Object.fromEntries(
        ["baseUrl", "publicUrl", "artifactOrigins"]
          .filter(
            (k) =>
              fields?.[k] && !fields[k].writeOnly && saved[k] !== undefined,
          )
          .map((k) => [k, saved[k]]),
      );
      return { ...row, values, configuredFields: Object.keys(saved) };
    });
  }
  async createConnection(user: Actor, value: unknown, studio = false) {
    this.admin(user);
    const input = z
      .object({
        name: z.string().min(1).max(80),
        pluginId: z.string(),
        version: z.string(),
        config: z.record(z.string(), z.unknown()),
        concurrency: z.number().int().min(1).max(100).default(1),
      })
      .parse(value);
    return this.db.transaction((sql) =>
      this.createConnectionOn(sql, user, input, studio),
    );
  }
  /** Shared transactional creation for versioned original settings adapters. */
  async createConnectionOn(
    sql: Sql,
    user: Actor,
    input: {
      name: string;
      pluginId: string;
      version: string;
      config: Record<string, unknown>;
      concurrency: number;
    },
    studio = false,
  ) {
    this.admin(user);
    if (studio)
      await sql.query(
        "SELECT pg_advisory_xact_lock(hashtext('studio-catalog'))",
      );
    const plugin = await this.registry.resolve(
      sql,
      input.pluginId,
      input.version,
    );
    requireValue(!plugin.retired, 400, "此插件版本已退役");
    if (plugin.manifest.chat)
      await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "original-chat-settings",
      ]);
    requireValue(
      validator.validate(plugin.manifest.configSchema, input.config),
      400,
      "连接配置不符合插件要求",
    );
    const managed =
      studio &&
      (await hasStudioPackages(sql)) &&
      (await one(
        sql,
        "SELECT installed,removing FROM studio_packages WHERE id=$1",
        [input.pluginId],
      ));
    requireValue(
      !managed || (managed.installed && !managed.removing),
      409,
      "请先导入插件",
    );
    if (
      studio &&
      ((plugin.originalState &&
        (!managed ||
          plugin.manifest.mode === "pull" ||
          plugin.manifest.originalImageSettings)) ||
        plugin.manifest.chat)
    ) {
      await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        "studio-connection:" + input.pluginId,
      ]);
      const { rows } = await sql.query(
        "SELECT config FROM connections WHERE plugin_id=$1 AND plugin_version=$2 AND NOT removed AND NOT fmworker_resource_driver",
        [input.pluginId, input.version],
      );
      const conflict = plugin.manifest.chat
        ? rows.some(
            (row) =>
              plugin.chatProvider!(this.vault.open(row.config)) ===
              plugin.chatProvider!(input.config),
          )
        : rows.length > 0;
      requireValue(!conflict, 409, "已有该提供方连接，请编辑现有连接");
    }
    const id = randomUUID();
    await sql.query(
      "INSERT INTO connections(id,name,plugin_id,plugin_version,config,concurrency) VALUES($1,$2,$3,$4,$5,$6)",
      [
        id,
        input.name,
        input.pluginId,
        input.version,
        this.vault.seal(input.config),
        input.concurrency,
      ],
    );
    for (const model of connectionModels(plugin, input.config)) {
      if (model.studio) {
        const active = await one(
          sql,
          "SELECT plugin_version FROM studio_catalog WHERE id=$1 AND plugin_id=$2 FOR SHARE",
          [model.id, input.pluginId],
        );
        requireValue(
          active?.plugin_version === input.version ||
            (managed &&
              (await one(
                sql,
                "SELECT 1 FROM studio_shared_models WHERE model_id=$1 AND plugin_id=$2",
                [model.id, input.pluginId],
              ))),
          409,
          "连接版本与模型目录不一致，请先激活插件目录",
        );
      }
      await sql.query(
        "INSERT INTO models(id,connection_id,provider_model,label,kind,schema,enabled,catalog_id) VALUES($1,$2,$3,$4,$5,$6,false,$7)",
        [
          randomUUID(),
          id,
          model.id,
          model.label,
          model.kind,
          JSON.stringify(model.inputSchema),
          model.studio ? model.id : null,
        ],
      );
    }
    if (managed && plugin.manifest.mode === "request") {
      await sql.query("UPDATE connections SET enabled=true WHERE id=$1", [id]);
      await sql.query(
        "INSERT INTO studio_model_service(model_id,connection_id) SELECT catalog_id,connection_id FROM models WHERE connection_id=$1 AND catalog_id IS NOT NULL ON CONFLICT DO NOTHING",
        [id],
      );
    }
    await this.audit(sql, user, "connection.create", id);
    return { id };
  }
  async updateConnection(user: Actor, id: string, value: unknown) {
    this.admin(user);
    uuid.parse(id);
    const input = z
      .object({
        revision: z.number().int().positive(),
        enabled: z.boolean(),
        preserveCredentials: z.boolean().optional(),
        config: z.record(z.string(), z.unknown()).optional(),
        concurrency: z.number().int().min(1).max(100),
      })
      .parse(value);
    const row = await one(this.db, "SELECT * FROM connections WHERE id=$1", [
      id,
    ]);
    requireValue(
      row && !row.removed && !row.fmworker_resource_driver,
      404,
      "连接不存在",
    );
    const plugin = await this.registry.resolve(
      this.db,
      row.plugin_id,
      row.plugin_version,
    );
    if (input.config && input.preserveCredentials) {
      const saved = this.vault.open(row.config);
      const fields = plugin.manifest.configSchema.properties as
        Record<string, { writeOnly?: boolean }> | undefined;
      const retained = Object.keys(saved).filter(
        (k) => !Object.hasOwn(input.config!, k),
      );
      if (
        input.config.baseUrl &&
        saved.baseUrl &&
        retained.some(
          (k) =>
            fields?.[k]?.writeOnly ||
            !["baseUrl", "publicUrl", "artifactOrigins"].includes(k),
        )
      )
        requireValue(
          new URL(String(input.config.baseUrl)).origin ===
            new URL(String(saved.baseUrl)).origin,
          400,
          "切换服务地址时请重新填写密钥",
        );
      input.config = { ...saved, ...input.config };
    }
    if (input.config)
      requireValue(
        validator.validate(plugin.manifest.configSchema, input.config),
        400,
        "连接配置无效",
      );
    if (input.config && plugin.manifest.chat)
      requireValue(
        plugin.chatProvider!(input.config) ===
          plugin.chatProvider!(this.vault.open(row.config)),
        400,
        "请为不同的对话服务新建连接",
      );
    const result = await one(
      this.db,
      "UPDATE connections SET enabled=$2,config=$3,concurrency=$4,revision=revision+1 WHERE id=$1 AND revision=$5 RETURNING revision",
      [
        id,
        input.enabled,
        input.config ? this.vault.seal(input.config) : row.config,
        input.concurrency,
        input.revision,
      ],
    );
    requireValue(result, 409, "连接配置已更新，请刷新");
    return result;
  }
  async connectionHealth(user: Actor, id: string) {
    this.admin(user);
    uuid.parse(id);
    const row = await one(
      this.db,
      "SELECT * FROM connections WHERE id=$1 AND NOT removed AND NOT fmworker_resource_driver",
      [id],
    );
    requireValue(row, 404, "连接不存在");
    const plugin = await this.registry.resolve(
      this.db,
      row.plugin_id,
      row.plugin_version,
    );
    if (plugin.manifest.mode === "pull")
      return {
        ready: !!(await one(
          this.db,
          `SELECT id FROM gpu_nodes n WHERE connection_id=$1 AND enabled AND NOT archived
          AND last_seen>now()-interval '1 minute'
          AND NOT EXISTS (SELECT 1 FROM fmworker_resources r WHERE r.node_id=n.id)`,
          [id],
        )),
      };
    if (
      plugin.inspectService &&
      (await hasStudioPackages(this.db)) &&
      (await one(
        this.db,
        "SELECT id FROM studio_packages WHERE installed AND id=$1",
        [row.plugin_id],
      ))
    ) {
      const report = await plugin.inspectService(
        this.vault.open(row.config),
        AbortSignal.timeout(10000),
      );
      return {
        ...report,
        available:
          report.models &&
          plugin.manifest.models
            .filter((m) =>
              report.models!.includes(
                String(m.studio?.descriptor.upstream ?? m.id),
              ),
            )
            .map((m) => m.id),
      };
    }
    return {
      ready: await plugin.health(
        this.vault.open(row.config),
        AbortSignal.timeout(10000),
      ),
    };
  }
  async models(user: Actor, wid: string) {
    await this.workspace(this.db, user, wid);
    return (
      await this.db.query(
        `SELECT m.*,c.name AS provider,c.plugin_id FROM models m JOIN connections c ON c.id=m.connection_id
      LEFT JOIN model_permissions p ON p.model_id=m.id AND p.workspace_id=$1
      WHERE c.enabled=true AND studio_plugin_accepts(c.plugin_id) AND studio_service_selected(m.catalog_id,c.id) AND (m.catalog_id IS NOT NULL OR m.enabled=true) AND COALESCE(p.enabled,true)=true AND studio_model_allowed(m.catalog_id,$1) ORDER BY c.name,m.label`,
        [wid],
      )
    ).rows;
  }
  async setModel(user: Actor, id: string, value: unknown) {
    this.admin(user);
    uuid.parse(id);
    const input = z
      .object({
        enabled: z.boolean(),
        price: z.number().int().min(1).max(1000000),
      })
      .parse(value);
    const model = await one(
      this.db,
      "SELECT catalog_id FROM models WHERE id=$1",
      [id],
    );
    requireValue(model, 404, "模型不存在");
    requireValue(
      !model.catalog_id,
      409,
      "此模型使用目录分档定价，请通过模型设置与价格设置修改",
    );
    requireValue(
      await one(
        this.db,
        "UPDATE models SET enabled=$2,price=$3 WHERE id=$1 RETURNING id",
        [id, input.enabled, input.price],
      ),
      404,
      "模型不存在",
    );
  }
  async submit(user: Actor, wid: string, value: unknown) {
    // JSON Schema defaults must not mutate nested caller input or its next idempotent retry.
    const requested = structuredClone(submission.parse(value));
    const fingerprint = hash(
      canonical({
        modelId: requested.modelId,
        prompt: requested.prompt,
        params: requested.params,
        references: requested.references,
        ...(requested.referencePacks.length
          ? { referencePacks: requested.referencePacks }
          : {}),
      }),
    );
    return this.db.transaction(async (sql) => {
      let input = requested;
      await this.workspace(sql, user, wid);
      await sql.query(
        "SELECT workspace_id FROM wallets WHERE workspace_id=$1 FOR UPDATE",
        [wid],
      );
      const previous = await one(
        sql,
        "SELECT id,request_hash FROM jobs WHERE owner_id=$1 AND workspace_id=$2 AND idempotency_key=$3",
        [user.id, wid, input.key],
      );
      if (previous) {
        requireValue(
          previous.request_hash === fingerprint,
          409,
          "幂等键已用于另一请求",
        );
        return { id: previous.id };
      }
      const expanded = input.referencePacks.length
        ? await new ReferencePacks(this.db).expand(
            sql,
            user,
            wid,
            input.prompt,
            input.references,
            input.referencePacks,
          )
        : undefined;
      if (expanded)
        input = {
          ...input,
          prompt: expanded.prompt,
          references: expanded.references,
        };
      const model = await one(
        sql,
        `SELECT m.*,c.plugin_id,c.plugin_version,c.config,v.manifest AS plugin_manifest FROM models m JOIN connections c ON c.id=m.connection_id
        JOIN plugin_versions v ON v.id=c.plugin_id AND v.version=c.plugin_version
        LEFT JOIN model_permissions p ON p.model_id=m.id AND p.workspace_id=$2 WHERE m.id=$1 AND c.enabled=true AND (m.catalog_id IS NOT NULL OR m.enabled=true) AND COALESCE(p.enabled,true)=true`,
        [input.modelId, wid],
      );
      const queued = await one(
        sql,
        "SELECT count(*) AS n FROM jobs WHERE workspace_id=$1 AND state IN ('queued','dispatching','running','finalizing','uncertain')",
        [wid],
      );
      requireValue(
        Number(queued.n) < 200,
        429,
        "当前工作区任务过多，请等待完成后重试",
      );
      requireValue(
        model && (model.catalog_id || model.price),
        400,
        "模型未开放或未定价",
      );
      requireValue(
        validator.validate(model.schema, input.params),
        400,
        "模型参数无效",
      );
      if (model.plugin_manifest.inputPreparation) {
        const prepared = await prepareSubmission(this, sql, model, input, wid);
        input = { ...input, ...prepared };
      } else {
        requireValue(
          new Set(input.references).size === input.references.length,
          400,
          "参考素材重复",
        );
        const policy = model.schema["x-references"] || {};
        requireValue(
          input.references.length >= (policy.min || 0) &&
            input.references.length <= (policy.max ?? 12),
          400,
          "参考素材数量不符合模型要求",
        );
        for (const id of input.references) {
          const asset = await one(
            sql,
            "SELECT id,mime FROM assets WHERE id=$1 AND workspace_id=$2 AND state='ready' FOR KEY SHARE",
            [id, wid],
          );
          requireValue(asset, 404, "参考素材不可访问");
          requireValue(
            !policy.types || policy.types.includes(asset.mime.split("/")[0]),
            400,
            "参考素材类型不符合模型要求",
          );
        }
      }
      const quote = model.catalog_id
        ? await new StudioCatalog(this.db).quote(
            sql,
            model,
            wid,
            input.params,
            input.priceRevision,
          )
        : { amount: Number(model.price), key: null, revision: null };
      return acceptTask(
        this,
        sql,
        user,
        wid,
        model,
        input,
        fingerprint,
        quote,
        expanded?.snapshots || [],
      );
    });
  }
  async jobs(user: Actor, wid: string) {
    await this.workspace(this.db, user, wid);
    return (
      await this.db.query(
        "SELECT id,model_id,provider_model,kind,input,state,price,error,result,created_at,updated_at,cancel_requested FROM jobs WHERE workspace_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100",
        [wid],
      )
    ).rows;
  }
  async settle(
    sql: Sql,
    job: any,
    state: "completed" | "failed" | "cancelled",
    result?: unknown,
    error?: string,
    timing?: TimingReport["timing"],
    options: { preserveTiming?: boolean } = {},
  ) {
    if (["completed", "failed", "cancelled"].includes(job.state)) return;
    if (!options.preserveTiming)
      await new JobTiming(this).end(
        sql,
        job,
        state === "completed" ? "done" : state,
        Date.now() / 1000,
        timing,
      );
    const settledWallet = await one(
      sql,
      "UPDATE wallets SET held=held-$2,balance=balance-$3 WHERE workspace_id=$1 RETURNING balance,held",
      [job.workspace_id, job.price, state === "completed" ? job.price : 0],
    );
    await sql.query(
      "INSERT INTO ledger(id,workspace_id,job_id,key,action,amount,actor_id,balance_snapshot,held_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        randomUUID(),
        job.workspace_id,
        job.id,
        "settle:" + job.id,
        state === "completed" ? "spend" : "refund",
        job.price,
        job.owner_id,
        settledWallet.balance,
        settledWallet.held,
      ],
    );
    await sql.query(
      "UPDATE jobs SET state=$2,result=$3,error=$4,request_note=NULL,request_retry_at=NULL,receipt=NULL,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1",
      [job.id, state, result ? JSON.stringify(result) : null, error || null],
    );
    await sql.query("INSERT INTO job_events(job_id,state) VALUES($1,$2)", [
      job.id,
      state,
    ]);
  }
  async cancel(user: Actor, id: string) {
    uuid.parse(id);
    return this.db.transaction(async (sql) => {
      const job = await one(sql, "SELECT * FROM jobs WHERE id=$1 FOR UPDATE", [
        id,
      ]);
      requireValue(job && !job.deleted_at, 404, "任务不存在");
      await this.workspace(sql, user, job.workspace_id);
      requireValue(
        job.owner_id === user.id || user.role === "admin",
        403,
        "只能取消自己的任务",
      );
      if (job.state === "queued") await this.settle(sql, job, "cancelled");
      else if (!["completed", "failed", "cancelled"].includes(job.state))
        await sql.query("UPDATE jobs SET cancel_requested=true WHERE id=$1", [
          id,
        ]);
      return { state: job.state === "queued" ? "cancelled" : job.state };
    });
  }
  async assets(user: Actor, wid: string) {
    await this.workspace(this.db, user, wid);
    return (
      await this.db.query(
        "SELECT * FROM assets WHERE workspace_id=$1 AND state='ready' ORDER BY created_at DESC LIMIT 200",
        [wid],
      )
    ).rows;
  }
  async favorites(user: Actor, wid: string) {
    await this.workspace(this.db, user, wid);
    return (
      await this.db.query(
        `SELECT DISTINCT COALESCE(f.asset_id,r.asset_id) AS asset_id FROM favorites f
      LEFT JOIN jobs j ON j.id=f.job_id AND j.deleted_at IS NULL
      LEFT JOIN job_assets r ON r.job_id=j.id AND r.role='output'
      JOIN assets a ON a.id=COALESCE(f.asset_id,r.asset_id)
      WHERE f.user_id=$1 AND a.workspace_id=$2`,
        [user.id, wid],
      )
    ).rows;
  }
  async favorite(user: Actor, id: string, enabled: boolean) {
    uuid.parse(id);
    return this.db.transaction(async (sql) => {
      await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "favorites:" + user.id,
      ]);
      // Match batch deletion's lock order: jobs before assets.
      const job = await one(
        sql,
        `SELECT j.* FROM jobs j JOIN job_assets r ON r.job_id=j.id
        WHERE r.asset_id=$1 AND r.role='output' AND j.deleted_at IS NULL ORDER BY j.public_id LIMIT 1 FOR KEY SHARE OF j`,
        [id],
      );
      const asset = await one(
        sql,
        "SELECT * FROM assets WHERE id=$1 FOR KEY SHARE",
        [id],
      );
      requireValue(asset, 404, "素材不存在");
      await this.workspace(sql, user, asset.workspace_id);
      if (enabled) {
        if (job)
          requireValue(
            job.state === "completed",
            409,
            "只有已完成的作品可以收藏",
          );
        await sql.query(
          `INSERT INTO favorites(user_id,${job ? "job_id" : "asset_id"}) VALUES($1,$2) ON CONFLICT DO NOTHING`,
          [user.id, job?.id || id],
        );
      } else
        await sql.query(
          "DELETE FROM favorites WHERE user_id=$1 AND (asset_id=$2 OR job_id=$3)",
          [user.id, id, job?.id || null],
        );
      return { ok: true };
    });
  }
  async upload(user: Actor, wid: string, data: Uint8Array, mime: string) {
    await this.workspace(this.db, user, wid);
    requireValue(
      data.length > 0 && data.length <= 64 * 1024 * 1024,
      413,
      "文件大小超出限制",
    );
    requireValue(
      /^(image\/(png|jpeg|webp|gif|avif)|video\/mp4|audio\/(wav|mpeg|x-wav))$/.test(
        mime,
      ),
      400,
      "不支持的媒体类型",
    );
    const metadata = await inspectMedia(
      Buffer.from(data),
      mime.startsWith("image/")
        ? "image"
        : mime.startsWith("video/")
          ? "video"
          : "audio",
    );
    mime = metadata.mime;
    const id = randomUUID();
    await capacity(this.db, this.storage, data.length);
    try {
      await this.storage.put(id, data, mime);
      await this.db.query(
        "INSERT INTO assets(id,workspace_id,owner_id,object_key,mime,size,state,metadata,original_kind) VALUES($1,$2,$3,$4,$5,$6,'ready',$7,$8)",
        [
          id,
          wid,
          user.id,
          id,
          mime,
          data.length,
          JSON.stringify(metadata),
          mime.startsWith("video/")
            ? "ref_video"
            : mime.startsWith("audio/")
              ? "ref_audio"
              : "ref",
        ],
      );
    } catch (error) {
      await this.storage.remove(id);
      throw error;
    }
    return { id };
  }
  async asset(user: Actor, id: string) {
    uuid.parse(id);
    const asset = await one(
      this.db,
      "SELECT * FROM assets WHERE id=$1 AND state='ready'",
      [id],
    );
    requireValue(asset, 404, "素材不存在");
    await this.workspace(this.db, user, asset.workspace_id);
    return asset;
  }
  async media(user: Actor, id: string) {
    const asset = await this.asset(user, id);
    return { asset, bytes: await this.storage.read(asset.object_key) };
  }
  async deleteAsset(user: Actor, id: string) {
    uuid.parse(id);
    const key = await this.db.transaction(async (sql) => {
      const asset = await one(
        sql,
        "SELECT * FROM assets WHERE id=$1 FOR UPDATE",
        [id],
      );
      requireValue(asset, 404, "素材不存在");
      await this.workspace(sql, user, asset.workspace_id);
      requireValue(
        asset.owner_id === user.id || user.role === "admin",
        403,
        "只能删除自己的素材",
      );
      requireValue(
        !(await one(
          sql,
          "SELECT job_id FROM job_assets WHERE asset_id=$1 LIMIT 1",
          [id],
        )) &&
          !(await one(
            sql,
            "SELECT document_id FROM document_assets WHERE asset_id=$1 LIMIT 1",
            [id],
          )),
        409,
        "素材仍被任务或文档引用",
      );
      await sql.query("DELETE FROM favorites WHERE asset_id=$1", [id]);
      await sql.query("DELETE FROM assets WHERE id=$1", [id]);
      return asset.object_key;
    });
    await this.storage.remove(key);
  }
  async documents(user: Actor, wid: string, kind: string) {
    await this.workspace(this.db, user, wid);
    z.enum(["canvas", "pack", "chat"]).parse(kind);
    const { rows } = await this.db.query(
      "SELECT * FROM documents d WHERE workspace_id=$1 AND kind=$2 AND deleted=false AND NOT EXISTS(SELECT 1 FROM canvas_documents c WHERE c.project_id=d.id) ORDER BY updated_at DESC LIMIT 200",
      [wid, kind],
    );
    return rows.map(({ pack_text, ...row }) => {
      if (!pack_text) return row;
      const { name, description } = pack_text;
      return { ...row, title: name, body: { ...row.body, description } };
    });
  }
  async saveDocument(user: Actor, wid: string, value: unknown) {
    const input = z
      .object({
        id: uuid,
        kind: z.enum(["canvas", "pack", "chat"]),
        title: z.string().min(1).max(100),
        revision: z.number().int().min(0),
        body: z.record(z.string(), z.unknown()),
        assets: z.array(uuid).max(600).default([]),
      })
      .parse(value);
    requireValue(
      JSON.stringify(input.body).length <= 2 * 1024 * 1024,
      413,
      "文档过大",
    );
    return this.db.transaction(async (sql) => {
      await this.workspace(sql, user, wid);
      await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        input.id,
      ]);
      const old = await one(
        sql,
        "SELECT * FROM documents WHERE id=$1 FOR UPDATE",
        [input.id],
      );
      if (old)
        requireValue(
          old.workspace_id === wid &&
            old.kind === input.kind &&
            old.revision === input.revision &&
            !old.deleted,
          409,
          "文档版本冲突",
        );
      else requireValue(input.revision === 0, 409, "文档版本冲突");
      requireValue(
        !(await one(
          sql,
          "SELECT project_id FROM canvas_documents WHERE project_id=$1",
          [input.id],
        )),
        409,
        "原画布请通过原协议接口操作",
      );
      if (input.kind === "pack") {
        const body = z
          .object({
            purpose: z
              .enum(["subject", "outfit", "scene", "style", "product"])
              .default("subject"),
            description: z.string().max(2000).default(""),
          })
          .parse(input.body);
        z.string().min(1).max(60).parse(input.title);
        z.array(uuid).min(1).max(9).parse(input.assets);
        const pack = await new ReferencePacks(this.db).save(
          sql,
          user,
          wid,
          {
            name: input.title,
            ...body,
            media: input.assets,
            expected_revision: old ? input.revision : null,
          },
          old ? input.id : undefined,
          false,
          input.id,
          false,
        );
        return { id: pack.id, revision: pack.revision };
      }
      for (const id of input.assets)
        requireValue(
          await one(
            sql,
            "SELECT id FROM assets WHERE id=$1 AND workspace_id=$2 AND state='ready' FOR KEY SHARE",
            [id, wid],
          ),
          404,
          "文档引用素材不可访问",
        );
      await sql.query(
        `INSERT INTO documents(id,workspace_id,owner_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,body=EXCLUDED.body,revision=documents.revision+1,updated_at=now()`,
        [
          input.id,
          wid,
          user.id,
          input.kind,
          input.title,
          JSON.stringify(input.body),
        ],
      );
      await sql.query("DELETE FROM document_assets WHERE document_id=$1", [
        input.id,
      ]);
      for (const aid of new Set(input.assets))
        await sql.query(
          "INSERT INTO document_assets(document_id,asset_id) VALUES($1,$2)",
          [input.id, aid],
        );
      if (input.kind === "canvas")
        await new ReferencePacks(this.db).syncCanvas(
          sql,
          user,
          wid,
          input.id,
          input.body,
        );
      return { id: input.id, revision: input.revision + 1 };
    });
  }
  async deleteDocument(user: Actor, id: string) {
    uuid.parse(id);
    return this.db.transaction(async (sql) => {
      const doc = await one(
        sql,
        "SELECT * FROM documents WHERE id=$1 AND NOT deleted FOR UPDATE",
        [id],
      );
      requireValue(doc, 404, "文档不存在");
      await this.workspace(sql, user, doc.workspace_id);
      requireValue(
        !(await one(
          sql,
          "SELECT project_id FROM canvas_documents WHERE project_id=$1",
          [id],
        )),
        409,
        "原画布请通过原协议接口操作",
      );
      if (doc.kind === "pack")
        return new ReferencePacks(this.db).remove(
          sql,
          user,
          id,
          doc.workspace_id,
          false,
        );
      requireValue(
        doc.owner_id === user.id || user.role === "admin",
        403,
        "没有删除权限",
      );
      await sql.query("UPDATE documents SET deleted=true WHERE id=$1", [id]);
      await sql.query("DELETE FROM document_pack_refs WHERE document_id=$1", [
        id,
      ]);
      await sql.query("DELETE FROM document_assets WHERE document_id=$1", [id]);
      return { ok: true };
    });
  }
}
