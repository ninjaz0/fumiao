import { portablePlugin } from "./portable-plugin.js";
import { officialAdapter } from "./distribution/official-adapter.js";
import {
  manifestSchema,
  type ProviderPlugin,
} from "../../plugin-sdk/src/index.js";
import {
  contributesSchema,
  contributionProblems,
  packageContributions,
  settingsScopes,
  type PageAction,
  type PageScope,
  type ResolvedContributions,
} from "../../plugin-sdk/src/contributions.js";
import { PluginSettingsStore } from "./plugin-settings.js";
import { remotePlugin } from "../../../plugins/remote/src/index.js";
import { loadProgram } from "./plugin-program.js";
import { z } from "zod";
import { Ajv } from "ajv";
import { StudioCatalog } from "./catalog.js";
import { one, type Sql } from "./db.js";
import { canonical, connectionModels, validator } from "./plugins.js";
import type { Platform, Actor } from "./platform.js";
import { DomainError, requireValue } from "./security.js";
import {
  settingsPagesSchema,
  type InstalledSettingsPage,
  type PluginSettingsPage,
} from "../../plugin-sdk/src/settings-pages.js";

export async function installedSettingsPages(
  sql: Sql,
): Promise<InstalledSettingsPage[]> {
  const { rows } = await sql.query(`
    SELECT p.id, p.version, p.revision, p.removing, p.page_values AS saved,
           r.package->>'label' AS label, r.package->'settingsPages' AS pages
      FROM studio_packages p JOIN studio_package_releases r USING (id,version)
     WHERE p.installed AND r.package ? 'settingsPages' ORDER BY p.id`);
  return rows.flatMap((pkg) =>
    (pkg.pages as PluginSettingsPage[]).map((page) => ({
      ...page,
      plugin: pkg.id,
      label: pkg.label,
      version: pkg.version,
      revision: pkg.revision,
      removing: pkg.removing,
      values: Object.fromEntries(
        page.fields.map((field) => {
          const saved = pkg.saved?.[page.id]?.[field.id];
          return [
            field.id,
            field.options.includes(saved) ? saved : field.options[0],
          ];
        }),
      ),
    })),
  );
}

export const releaseVersion = z
  .string()
  .regex(/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/);
export const sourceURL = z
  .string()
  .max(2048)
  .url()
  .refine((value) => {
    const u = new URL(value);
    return (
      ["https:", "http:"].includes(u.protocol) &&
      !u.username &&
      !u.password &&
      !u.hash &&
      !u.search
    );
  });
export const packageFile = z
  .object({
    format: z.literal(1),
    id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
    label: z.string().trim().min(1).max(80),
    version: releaseVersion,
    adapterVersion: releaseVersion,
    manifest: z.record(z.string(), z.unknown()).optional(),
    equivalentModels: z.array(z.string().min(1).max(180)).max(500).optional(),
    adapterModule: z
      .string()
      .max(1024 * 1024)
      .optional(),
    updateUrl: sourceURL.optional(),
    nodeClient: z
      .object({
        "install.sh": z.string().max(128 * 1024),
        "agent.tgz": z.string().max(1024 * 1024),
        "agent.tgz.sha256": z.string().max(512),
      })
      .strict()
      .optional(),
    program: z
      .string()
      .min(1)
      .max(256 * 1024)
      .optional(),
    contributes: contributesSchema.optional(),
    settingsPages: settingsPagesSchema.optional(),
    settingsPage: z
      .object({
        title: z.string().min(1).max(60),
        render: z
          .string()
          .min(1)
          .max(64 * 1024),
      })
      .strict()
      .optional(),
    remote: z
      .object({
        endpoint: sourceURL,
        manifest: z.record(z.string(), z.unknown()),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (f) =>
      [f.manifest, f.adapterModule, f.remote].filter(Boolean).length === 1 &&
      (!f.manifest || !!f.program),
    "插件必须声明一种执行方式",
  )
  .refine(
    (file) =>
      file?.settingsPage === undefined || file?.contributes === undefined,
    {
      message: "contributes 与旧版 settingsPage 不能同时声明",
      when: () => true,
    },
  );
export const upgradeFields = z
  .record(z.string().uuid(), z.record(z.string().max(120), z.unknown()))
  .default({});
export type PackageFile = z.infer<typeof packageFile>;
export function parsePackageFile(value: unknown): PackageFile {
  const result = packageFile.safeParse(value);
  if (!result.success) {
    const problem = result.error.issues.find(
      (issue) => issue.code === "custom" && issue.path.length === 0,
    );
    throw new DomainError(400, problem?.message ?? "插件包格式无效");
  }
  return result.data;
}

async function inspectPackage(file: PackageFile) {
  const binding = file.adapterModule
    ? await officialAdapter(file.id, file.adapterVersion, file.adapterModule)
    : undefined;
  const manifest =
    binding?.adapter.manifest ??
    manifestSchema.parse(file.manifest ?? file.remote?.manifest);
  requireValue(
    manifest.id === file.id && manifest.version === file.adapterVersion,
    400,
    "插件标识或版本不一致",
  );
  const contributions = packageContributions(file);
  const problems = contributionProblems(contributions, {
    mode: manifest.mode,
    hasProgram: !!file.program,
  });
  requireValue(!problems.length, 400, problems.join("；"));
  if (contributions.settings) {
    // Check schemas before activation, including scopes which have no stored rows.
    // Previewing a release must not register its schema IDs in the shared validator.
    const check = new Ajv({
      strict: false,
      useDefaults: true,
      addUsedSchema: false,
    });
    for (const scope of settingsScopes) {
      const schema = contributions.settings[scope];
      if (!schema) continue;
      let compiled;
      try {
        compiled = check.compile(schema);
      } catch {
        throw new DomainError(
          400,
          settingsLabels[scope] + "设置的 JSON Schema 无效",
        );
      }
      requireValue(
        !("$async" in compiled),
        400,
        "插件设置仅支持同步 JSON Schema",
      );
    }
  }
  if (contributions.hostCapabilities.includes("nodes"))
    requireValue(
      binding?.NodeManagement,
      400,
      "节点能力需要适配器导出 NodeManagement",
    );
  if (file.nodeClient)
    requireValue(
      manifest.mode === "pull" && file.program,
      400,
      "节点客户端需要节点程序",
    );
  const adapter =
    binding?.adapter ??
    (file.remote
      ? remotePlugin(manifest, file.remote.endpoint)
      : portablePlugin(manifest));
  return { adapter, contributions };
}

const scopeLabels: Record<PageScope, string> = {
  plugin: "插件信息",
  models: "插件模型",
  services: "服务连接",
  jobs: "任务记录",
  settings: "插件设置",
  nodes: "节点状态",
};
const settingsLabels = { global: "全站", workspace: "工作区" };
const operationLabels = {
  "nodes.suggestName": "建议节点名称",
  "nodes.pair": "配对节点",
  "nodes.drain": "排空节点",
  "nodes.stop": "停止节点",
  "nodes.resume": "恢复节点",
  "nodes.remove": "移除节点",
};
function actionLabel(action: PageAction) {
  if (action.kind === "host") return operationLabels[action.operation];
  if (action.kind === "settings")
    return "保存" + settingsLabels[action.scope] + "设置";
  return "运行页面程序（可写已声明的设置）";
}

function permissionSummary(
  next: ResolvedContributions,
  prior?: ResolvedContributions,
) {
  const added = (label: string, isNew: boolean) =>
    label + (prior && isNew ? "（新增）" : "");
  const lines: string[] = [];
  for (const page of next.settingsPages) {
    const old = prior?.settingsPages.find((p) => p.id === page.id);
    const broaderAudience =
      old?.audience === "admin" && page.audience === "member";
    const broaderVisibility =
      old?.visibleWhen === "enabled" && page.visibleWhen === "installed";
    const reads = page.scopes.map((scope) =>
      added(scopeLabels[scope], !old?.scopes.includes(scope)),
    );
    const actions = page.actions.map((action) =>
      added(
        action.id + " · " + actionLabel(action),
        !old?.actions.some((a) => canonical(a) === canonical(action)),
      ),
    );
    lines.push(
      [
        "设置页「" +
          page.title +
          "」(" +
          page.id +
          ")" +
          (prior && !old ? "（新增）" : ""),
        "受众：" +
          (page.audience === "admin" ? "管理员" : "成员") +
          (broaderAudience ? "（扩大）" : ""),
        (page.visibleWhen === "enabled" ? "启用时可见" : "安装后可见") +
          (broaderVisibility ? "（扩大）" : ""),
        "读取：" + (reads.join("、") || "无"),
        "操作：" + (actions.join("、") || "无"),
      ].join("；"),
    );
  }
  if (next.hostCapabilities.includes("nodes"))
    lines.push(
      "宿主能力：" +
        added("节点管理", !prior?.hostCapabilities.includes("nodes")),
    );
  const settings = settingsScopes.filter((scope) => next.settings?.[scope]);
  if (settings.length)
    lines.push(
      "设置范围：" +
        settings
          .map((scope) =>
            added(settingsLabels[scope], !prior?.settings?.[scope]),
          )
          .join("、"),
    );
  return lines.length ? ["扩展权限", ...lines] : ["扩展权限：无"];
}

export function newer(a: string, b: string) {
  const x = a.split(".").map(Number),
    y = b.split(".").map(Number);
  return (x[0] - y[0] || x[1] - y[1] || x[2] - y[2]) > 0;
}

export class StudioPackages {
  private readonly settings = new PluginSettingsStore();
  constructor(readonly p: Platform) {}
  async savePage(
    actor: Actor,
    id: string,
    pageId: string,
    revision: number,
    values: Record<string, string>,
  ) {
    this.p.admin(actor);
    return this.p.db.transaction(async (sql) => {
      const pkg = await one(
        sql,
        `SELECT p.revision, p.removing, r.package->'settingsPages' AS pages
        FROM studio_packages p JOIN studio_package_releases r USING(id,version)
        WHERE p.id=$1 AND p.installed FOR UPDATE OF p`,
        [id],
      );
      const page = (pkg?.pages as PluginSettingsPage[] | undefined)?.find(
        (p) => p.id === pageId,
      );
      requireValue(pkg && page, 404, "此设置页已移除");
      requireValue(
        !pkg.removing && pkg.revision === revision,
        409,
        "插件设置已变化，请重新载入",
      );
      requireValue(
        Object.keys(values).length === page.fields.length &&
          page.fields.every(
            (f) =>
              Object.hasOwn(values, f.id) && f.options.includes(values[f.id]),
          ),
        400,
        "设置项或选项无效",
      );
      await sql.query(
        `UPDATE studio_packages SET page_values=jsonb_set(page_values, ARRAY[$2::text], $3::jsonb),
        revision=revision+1 WHERE id=$1`,
        [id, pageId, JSON.stringify(values)],
      );
      await this.p.audit(sql, actor, "plugin.settings", id + "/" + pageId);
      return { revision: revision + 1 };
    });
  }
  async preview(actor: Actor, value: unknown) {
    this.p.admin(actor);
    const f = parsePackageFile(value);
    const { adapter, contributions } = await inspectPackage(f);
    const m = adapter.manifest;
    const prior = await one(
      this.p.db,
      `SELECT r.package,v.manifest FROM studio_packages p JOIN studio_package_releases r USING(id,version)
      JOIN plugin_versions v ON v.id=p.id AND v.version=r.package->>'adapterVersion' WHERE p.id=$1 AND p.installed`,
      [f.id],
    );
    const changes: string[] = [];
    if (prior) {
      for (const model of m.models) {
        const other = prior.manifest.models.find(
          (s: { id: string }) => s.id === model.id,
        );
        if (!other) changes.push("新增模型：" + model.label);
        else if (canonical(other) !== canonical(model))
          changes.push("模型参数或档位变化：" + model.label);
      }
      for (const model of prior.manifest.models)
        if (!m.models.some((x) => x.id === model.id))
          changes.push("移除模型：" + model.label);
    }
    for (const page of f.settingsPages ?? [])
      if (
        !prior?.package.settingsPages?.some(
          (old: PluginSettingsPage) => old.id === page.id,
        )
      )
        changes.push("新增管理员设置：" + page.title);
    if (f.equivalentModels?.length)
      changes.push("共用模型：" + f.equivalentModels.join("、"));
    if (f.program && !prior?.package.program) changes.push("新增隔离后台程序");
    if (
      f.nodeClient &&
      canonical(f.nodeClient) !== canonical(prior?.package.nodeClient)
    )
      changes.push("包含新的 GPU 节点安装文件，已有机器保持原版本");
    const required = (m.configSchema.required ?? []) as string[];
    const services = prior
      ? (
          await this.p.db.query(
            "SELECT id,name,config FROM connections WHERE plugin_id=$1 AND NOT removed AND NOT fmworker_resource_driver",
            [f.id],
          )
        ).rows
      : [];
    const missing = services
      .map((service) => {
        const saved = this.p.vault.open(service.config);
        return {
          id: service.id,
          name: service.name,
          fields: required
            .filter((k) => !Object.hasOwn(saved, k))
            .map((key) => ({
              key,
              ...(m.configSchema.properties as Record<string, object>)[key],
            })),
        };
      })
      .filter((s) => s.fields.length);
    return {
      id: f.id,
      version: f.version,
      label: f.label,
      models: m.models.filter((m) => m.studio && !m.hidden).map((m) => m.label),
      missing,
      endpoint: f.remote?.endpoint,
      fields: Object.keys(m.configSchema.properties || {}),
      // Existing Studio clients use this flag for the legacy GPU panel hint.
      nodes: !!f.settingsPage,
      changes: [
        ...changes,
        ...permissionSummary(
          contributions,
          prior && packageContributions(prior.package),
        ),
      ],
    };
  }
  private async upgradeConfig(
    sql: Sql,
    service: { id: string; config: string },
    file: PackageFile,
    schema: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ) {
    const saved = await one(
      sql,
      "SELECT config FROM studio_service_versions WHERE connection_id=$1 AND version=$2",
      [service.id, file.adapterVersion],
    );
    const merged = {
      ...(saved ? this.p.vault.open(saved.config) : {}),
      ...this.p.vault.open(service.config),
      ...extra,
    };
    return schema.additionalProperties === false
      ? Object.fromEntries(
          Object.entries(merged).filter(([key]) =>
            Object.hasOwn(schema.properties ?? {}, key),
          ),
        )
      : merged;
  }
  private async probe(
    file: PackageFile,
    adapter: ProviderPlugin,
    supplements: z.infer<typeof upgradeFields>,
    revision: number | undefined,
    rollback: boolean,
  ) {
    const current = await one(
      this.p.db,
      "SELECT p.*,r.package->'remote'->>'endpoint' AS endpoint FROM studio_packages p JOIN studio_package_releases r USING(id,version) WHERE installed AND p.id=$1",
      [file.id],
    );
    if (!current || current.version === file.version) return [];
    requireValue(
      current.revision === revision &&
        !current.removing &&
        (rollback
          ? current.previous_version === file.version
          : newer(file.version, current.version)),
      409,
      "请重新确认插件更新",
    );
    // Establish the destination before exposing a saved credential to any probe.
    requireValue(
      Boolean(current.endpoint) === Boolean(file.remote) &&
        (!file.remote ||
          new URL(current.endpoint).origin ===
            new URL(file.remote.endpoint).origin),
      409,
      "不能向新的服务地址转发已有密钥",
    );
    const services = (
      await this.p.db.query<{ id: string; config: string; revision: number }>(
        "SELECT id,config,revision FROM connections WHERE plugin_id=$1 AND NOT removed AND NOT fmworker_resource_driver",
        [file.id],
      )
    ).rows;
    for (const s of services) {
      const previous = this.p.vault.open(s.config),
        extra = supplements[s.id] ?? {};
      requireValue(
        Object.keys(extra).every(
          (k) =>
            !Object.hasOwn(previous, k) &&
            (
              adapter.manifest.configSchema.required as string[] | undefined
            )?.includes(k),
        ),
        400,
        "只能在升级时补充缺少的必填字段",
      );
      const config = await this.upgradeConfig(
        this.p.db,
        s,
        file,
        adapter.manifest.configSchema,
        extra,
      );
      requireValue(
        validator.validate(adapter.manifest.configSchema, config),
        409,
        "现有配置缺少新版要求的字段",
      );
      if (adapter.manifest.mode === "request")
        requireValue(
          await adapter.health(config, AbortSignal.timeout(10000)),
          409,
          "新版本使用现有配置未通过连接检查",
        );
    }
    return services.map((s) => [s.id, s.revision]);
  }
  private async manifest(sql: Sql, file: PackageFile) {
    if (file.manifest) {
      const m = manifestSchema.parse(file.manifest);
      requireValue(
        m.id === file.id &&
          m.version === file.adapterVersion &&
          m.originalSubmission?.version === 3 &&
          m.mode === "request",
        400,
        "独立服务插件清单无效",
      );
      return this.p.registry.installOn(
        sql,
        file.manifest,
        undefined,
        true,
        true,
        true,
      );
    }
    if (file.remote) {
      const { manifest, endpoint } = file.remote;
      requireValue(
        manifest.id === file.id && manifest.version === file.adapterVersion,
        400,
        "插件标识或版本不一致",
      );
      requireValue(
        (manifest.originalSubmission as { version?: number })?.version === 2 ||
          (manifest.originalSubmission as { version?: number })?.version === 3,
        400,
        "缺少工作台提交契约",
      );
      return this.p.registry.installOn(sql, manifest, endpoint, true);
    }
    // Only reviewed local runtime contracts can implement privileged operations.
    requireValue(file.adapterModule, 400, "插件文件缺少适配器");
    const adapter = await this.p.registry.registerModule(
      file.id,
      file.adapterVersion,
      file.adapterModule,
    );
    await sql.query(
      "INSERT INTO studio_adapter_modules(id,version,code) VALUES($1,$2,$3) ON CONFLICT(id,version) DO NOTHING",
      [file.id, file.adapterVersion, file.adapterModule],
    );
    requireValue(
      adapter.manifest.models.some((m) => m.studio),
      400,
      "插件未提供工作台模型",
    );
    const existing = await one(
      sql,
      "SELECT endpoint FROM plugin_versions WHERE id=$1 AND version=$2",
      [file.id, file.adapterVersion],
    );
    requireValue(!existing?.endpoint, 400, "远程插件须提供完整清单");
    return this.p.registry.installOn(sql, adapter.manifest, undefined, true);
  }
  async install(
    actor: Actor,
    value: unknown,
    revision?: number,
    rollback = false,
    supplements: z.infer<typeof upgradeFields> = {},
  ) {
    this.p.admin(actor);
    const file = parsePackageFile(value);
    const { adapter, contributions } = await inspectPackage(file);
    const probed = await this.probe(
      file,
      adapter,
      supplements,
      revision,
      rollback,
    );
    return this.p.db.transaction(async (sql) => {
      await sql.query(
        "SELECT pg_advisory_xact_lock(hashtext('studio-catalog'))",
      );
      await sql.query("SELECT * FROM studio_policy FOR UPDATE");
      const current = await one(
        sql,
        "SELECT * FROM studio_packages WHERE id=$1 FOR UPDATE",
        [file.id],
      );
      requireValue(!current?.removing, 409, "插件正在移除");
      const release = await one(
        sql,
        "SELECT package FROM studio_package_releases WHERE id=$1 AND version=$2",
        [file.id, file.version],
      );
      requireValue(
        !release || canonical(release.package) === canonical(file),
        409,
        "同一版本的插件文件不能更改",
      );
      if (current?.installed && current.version === file.version)
        return { id: file.id, version: file.version };
      requireValue(
        !current?.installed || current.revision === revision,
        409,
        "请重新确认插件更新",
      );
      if (current?.installed)
        requireValue(
          rollback
            ? current.previous_version === file.version
            : newer(file.version, current.version),
          409,
          "插件版本不符合更新条件",
        );
      if (file.program) {
        const invoke = await loadProgram(file.program);
        const hooks = invoke("describe") as string[];
        requireValue(
          hooks.length > 0 &&
            hooks.every((h) =>
              ["request", "result", "eligible", "plan"].includes(h),
            ),
          400,
          "插件程序声明了未知操作",
        );
      }
      if (file.manifest) {
        const hooks = (await loadProgram(file.program!))(
          "describe",
        ) as string[];
        requireValue(
          hooks.includes("request") && hooks.includes("result"),
          400,
          "独立服务插件需要请求和结果映射",
        );
      }
      const before = (
        await sql.query("SELECT id FROM studio_catalog WHERE plugin_id=$1", [
          file.id,
        ])
      ).rows;
      for (const m of adapter.manifest.models.filter((m) => m.studio)) {
        const peers = await sql.query(
          `SELECT v.id,v.manifest FROM studio_catalog c JOIN plugin_versions v ON (v.id,v.version)=(c.plugin_id,c.plugin_version) WHERE c.id=$1 AND c.plugin_id<>$2
          UNION SELECT p.id,v.manifest FROM studio_shared_models s JOIN studio_packages p ON p.id=s.plugin_id AND p.installed JOIN studio_package_releases r ON (r.id,r.version)=(p.id,p.version)
          JOIN plugin_versions v ON v.id=p.id AND v.version=r.package->>'adapterVersion' WHERE s.model_id=$1 AND p.id<>$2`,
          [m.id, file.id],
        );
        for (const peer of peers.rows) {
          const prior = manifestSchema
            .parse(peer.manifest)
            .models.find((x) => x.id === m.id);
          const tiers = (model: typeof m) =>
            model.studio?.prices.map(({ tier, match }) => ({ tier, match }));
          requireValue(
            prior &&
              canonical([prior.kind, prior.inputSchema, tiers(prior)]) ===
                canonical([m.kind, m.inputSchema, tiers(m)]),
            409,
            "同一公开模型的参数和计价档位必须一致",
          );
          requireValue(
            file.equivalentModels?.includes(m.id) ||
              (await one(
                sql,
                "SELECT 1 FROM studio_shared_models WHERE model_id=$1 AND plugin_id=$2",
                [m.id, file.id],
              )),
            409,
            "公开模型编号重复，请声明模型等价关系或使用独立编号",
          );
          await sql.query(
            "INSERT INTO studio_shared_models VALUES($1,$2),($1,$3) ON CONFLICT DO NOTHING",
            [m.id, file.id, peer.id],
          );
        }
      }
      const manifest = await this.manifest(sql, file);
      await new StudioCatalog(this.p.db).activate(sql, manifest, true);
      if (!release)
        await sql.query(
          "INSERT INTO studio_package_releases VALUES($1,$2,$3)",
          [file.id, file.version, JSON.stringify(file)],
        );
      const services = (
        await sql.query<{
          id: string;
          config: string;
          revision: number;
          plugin_version: string;
        }>(
          "SELECT * FROM connections WHERE plugin_id=$1 AND NOT removed AND NOT fmworker_resource_driver FOR UPDATE",
          [file.id],
        )
      ).rows;
      if (current?.installed)
        requireValue(
          services.length === probed.length &&
            services.every((s) =>
              probed.some(
                ([id, revision]) => s.id === id && s.revision === revision,
              ),
            ),
          409,
          "服务配置已更新，请重新检查",
        );
      for (const service of services) {
        if (service.plugin_version === file.adapterVersion) continue;
        const config = await this.upgradeConfig(
          sql,
          service,
          file,
          manifest.configSchema,
          supplements[service.id],
        );
        await sql.query(
          "INSERT INTO studio_service_versions VALUES($1,$2,$3) ON CONFLICT(connection_id,version) DO UPDATE SET config=excluded.config",
          [service.id, service.plugin_version, service.config],
        );
        requireValue(
          validator.validate(manifest.configSchema, config),
          409,
          "现有服务设置与新版不兼容",
        );
        const adapter = await this.p.registry.resolve(
          sql,
          file.id,
          file.adapterVersion,
        );
        await sql.query(
          "UPDATE connections SET plugin_version=$2,config=$3,revision=revision+1 WHERE id=$1",
          [service.id, file.adapterVersion, this.p.vault.seal(config)],
        );
        await sql.query(
          "UPDATE models SET catalog_id=NULL,enabled=false WHERE connection_id=$1",
          [service.id],
        );
        for (const m of connectionModels(adapter, config))
          await sql.query(
            `INSERT INTO models(id,connection_id,provider_model,label,kind,schema,catalog_id) VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6)
            ON CONFLICT(connection_id,provider_model) DO UPDATE SET label=excluded.label,kind=excluded.kind,schema=excluded.schema,catalog_id=excluded.catalog_id`,
            [
              service.id,
              m.id,
              m.label,
              m.kind,
              JSON.stringify(m.inputSchema),
              m.studio ? m.id : null,
            ],
          );
      }
      if (current?.installed) {
        // Rollback first restores snapshots taken by the upgrade away from this
        // version; migrate then carries rows still validated by the current one.
        if (rollback) await this.settings.restore(sql, file.id, file.version);
        await this.settings.migrate(
          sql,
          file.id,
          current.version,
          file.version,
          contributions.settings,
        );
        const added = Object.fromEntries(
          manifest.models
            .filter((m) => m.studio && !before.some((r) => r.id === m.id))
            .map((m) => [m.id, false]),
        );
        await sql.query(
          "UPDATE studio_policy SET flags=flags||$1::jsonb,revision=revision+1",
          [JSON.stringify(added)],
        );
      }
      await sql.query(
        `INSERT INTO studio_packages(id,version,update_url) VALUES($1,$2,$3)
        ON CONFLICT(id) DO UPDATE SET previous_version=CASE WHEN studio_packages.installed THEN studio_packages.version END,
        update_url=CASE WHEN studio_packages.installed THEN studio_packages.update_url ELSE excluded.update_url END,version=excluded.version,installed=true,revision=studio_packages.revision+1,update_info=NULL,checked_at=NULL`,
        [file.id, file.version, file.updateUrl ?? null],
      );
      if (manifest.mode === "pull" && !services.length) {
        const c = await this.p.createConnectionOn(
          sql,
          actor,
          {
            name: file.label,
            pluginId: file.id,
            version: file.adapterVersion,
            config: {},
            concurrency: 1,
          },
          true,
        );
        await sql.query("UPDATE connections SET enabled=true WHERE id=$1", [
          c.id,
        ]);
      }
      await this.p.audit(sql, actor, "plugin.install", file.id);
      return { id: file.id, version: file.version };
    });
  }
  async list(actor: Actor) {
    this.p.admin(actor);
    return (
      await this.p.db
        .query(`SELECT p.id,p.version,p.previous_version AS "previousVersion",p.enabled,p.removing,p.revision,
      p.update_url AS "updateUrl",p.update_auth IS NOT NULL AS "hasUpdateToken",p.checked_at AS "checkedAt",p.update_info AS "updateInfo",
      r.package->>'label' AS label, v.version AS "adapterVersion",v.manifest->'configSchema' AS "configSchema",
      v.manifest->>'mode' AS mode,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',c.id,'label',COALESCE(c.display_label,c.descriptor->>'label'),'kind',c.descriptor->>'kind','enabled',COALESCE((g.flags->>c.id)::boolean,false), 'service',s.connection_id,'services',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name) ORDER BY x.name,x.id),'[]'::jsonb) FROM connections x JOIN models m ON m.connection_id=x.id JOIN studio_packages t ON t.id=x.plugin_id AND t.installed AND NOT t.removing WHERE m.catalog_id=c.id AND x.enabled AND NOT x.removed)) ORDER BY c.position,c.id),'[]'::jsonb)
        FROM studio_catalog c CROSS JOIN studio_policy g LEFT JOIN studio_model_service s ON s.model_id=c.id WHERE (c.plugin_id=p.id OR EXISTS(SELECT 1 FROM studio_shared_models e WHERE e.model_id=c.id AND e.plugin_id=p.id)) AND NOT c.hidden) AS choices, ARRAY(SELECT m->>'label' FROM jsonb_array_elements(v.manifest->'models') m WHERE m ? 'studio' AND COALESCE((m->>'hidden')::boolean,false)=false) AS models
      FROM studio_packages p JOIN studio_package_releases r USING(id,version)
      JOIN plugin_versions v ON v.id=p.id AND v.version=r.package->>'adapterVersion' WHERE p.installed ORDER BY label,p.id`)
    ).rows;
  }
  async change(
    actor: Actor,
    id: string,
    revision: number,
    action: "enable" | "disable" | "remove",
  ) {
    this.p.admin(actor);
    return this.p.db.transaction(async (sql) => {
      await sql.query(
        "SELECT pg_advisory_xact_lock(hashtext('studio-catalog'))",
      );
      await sql.query("SELECT * FROM studio_policy FOR UPDATE");
      const row = await one(
        sql,
        "SELECT * FROM studio_packages WHERE installed AND id=$1 FOR UPDATE",
        [id],
      );
      requireValue(row && row.revision === revision, 409, "插件已更改，请刷新");
      requireValue(!row.removing, 409, "插件正在移除");
      if (action === "enable")
        requireValue(
          await one(
            sql,
            "SELECT id FROM connections WHERE plugin_id=$1 AND enabled AND NOT removed AND NOT fmworker_resource_driver",
            [id],
          ),
          409,
          "请先配置服务",
        );
      await sql.query(
        "UPDATE studio_packages SET enabled=$2,removing=$3,revision=revision+1 WHERE id=$1",
        [id, action === "enable", action === "remove"],
      );
      if (action === "remove") await this.finishRemoval(sql, id);
      await this.p.audit(sql, actor, "plugin." + action, id);
      return { ok: true };
    });
  }
  private async finishRemoval(sql: Sql, id: string) {
    if (
      await one(
        sql,
        `SELECT 1 FROM jobs WHERE plugin_id=$1 AND state NOT IN ('completed','failed','cancelled')
         UNION ALL SELECT 1 FROM chat_turns WHERE plugin_id=$1 AND state='running' LIMIT 1`,
        [id],
      )
    )
      return;
    await this.settings.purge(sql, id);
    await sql.query(
      "DELETE FROM studio_model_service WHERE connection_id IN (SELECT id FROM connections WHERE plugin_id=$1)",
      [id],
    );
    await sql.query(
      "DELETE FROM studio_service_versions WHERE connection_id IN (SELECT id FROM connections WHERE plugin_id=$1)",
      [id],
    );
    await sql.query(
      "DELETE FROM gpu_pairings WHERE connection_id IN (SELECT id FROM connections WHERE plugin_id=$1)",
      [id],
    );
    await sql.query(
      "UPDATE gpu_nodes SET enabled=false,control='removed' WHERE connection_id IN (SELECT id FROM connections WHERE plugin_id=$1)",
      [id],
    );
    await sql.query(
      "UPDATE connections SET config=$2,enabled=false,removed=true,revision=revision+1 WHERE plugin_id=$1 AND NOT removed",
      [id, this.p.vault.seal({})],
    );
    await sql.query(
      "UPDATE studio_packages SET installed=false,removing=false,page_values='{}',previous_version=NULL,update_url=NULL,update_auth=NULL,update_info=NULL WHERE id=$1",
      [id],
    );
  }
  async finishRemovals() {
    await this.p.db.transaction(async (sql) => {
      const pending = await sql.query(
        "SELECT id FROM studio_packages WHERE removing FOR UPDATE SKIP LOCKED",
      );
      for (const row of pending.rows) await this.finishRemoval(sql, row.id);
    });
  }
}
