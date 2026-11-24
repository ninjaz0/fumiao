import {
  addressPause,
  connectionBase,
  usesPublicConnection,
  validSavedConfig,
  type AddressPause,
} from "./connection-address.js";
import { nodeStudioPlugin } from "./node-studio-policy.js";
import { packageFile, type PackageFile } from "@fumiao/plugin-sdk/package-file.js";
export { packageFile, releaseVersion, sourceURL, type PackageFile } from "@fumiao/plugin-sdk/package-file.js";
import { verifyPackageSignature, type PackageSignature } from "@fumiao/plugin-sdk/package-signing.js";
import { pinnedPublisher, publisherReview, authorizePublisher } from "./package-publisher.js";
import { createHash } from "node:crypto";
import { nodePoolHooks } from "@fumiao/plugin-sdk/node-pools.js";
import { purgePluginData } from "./plugin-host.js";
import { portablePlugin } from "./portable-plugin.js";
import {
  manifestSchema,
  type ProviderPlugin,
  type Manifest,
} from "@fumiao/plugin-sdk/index.js";
import {
  contributionProblems,
  contributedPages,
  packageContributions,
  settingsScopes,
  type PageAction,
  type PageScope,
  type ResolvedContributions,
} from "@fumiao/plugin-sdk/contributions.js";
import { PluginSettingsStore } from "./plugin-settings.js";
import { remotePlugin } from "@fumiao/plugin-remote/index.js";
import { loadProgram } from "./plugin-program.js";
import { z } from "zod";
import { Ajv } from "ajv";
import { StudioCatalog } from "./catalog.js";
import { one, type Sql } from "./db.js";
import {
  canonical,
  connectionModels,
  validator,
  type PluginRegistry,
} from "./plugins.js";
import type { Platform, Actor } from "./platform.js";
import { DomainError, requireValue } from "./security.js";
import {
  type InstalledSettingsPage,
  type PluginSettingsPage,
} from "@fumiao/plugin-sdk/settings-pages.js";

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

export const upgradeFields = z
  .record(z.string().uuid(), z.record(z.string().max(120), z.unknown()))
  .default({});
export function parsePackageFile(value: unknown): PackageFile {
  if (
    value &&
    typeof value === "object" &&
    (Object.hasOwn(value, "adapterModule") ||
      Object.hasOwn(value, "legacyArchive"))
  )
    throw new DomainError(400, "旧版原生插件已停止导入，请选择新版沙箱插件包");
  if (value && typeof value === "object" && Object.hasOwn(value, "signature")) {
    try {
      verifyPackageSignature(value as Record<string, unknown>);
    } catch {
      throw new DomainError(400, "插件包签名校验失败");
    }
  }
  const result = packageFile.safeParse(value);
  if (!result.success) {
    const problem = result.error.issues.find(
      (issue) => issue.code === "custom" && issue.path.length === 0,
    );
    throw new DomainError(400, problem?.message ?? "插件包格式无效");
  }
  return result.data;
}

async function inspectPackage(file: PackageFile, registry: PluginRegistry) {
  const manifest: Manifest = file.extensionOnly
    ? {
        id: file.id,
        label: file.label,
        version: file.adapterVersion,
        mode: "request",
        contractVersion: 1,
        models: [],
        configSchema: {},
      }
    : manifestSchema.parse(file.manifest ?? file.remote?.manifest);
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
  for (const [hook, declarations] of [
    ["create", contributions.paymentMethods],
    ["verify", contributions.paymentMethods],
    ["callback", contributions.paymentMethods],
    ["plan", contributions.importers],
    [
      "plan",
      (contributions.exporters ?? []).filter((e) => e.outputKind !== "project"),
    ],
    [
      "export",
      (contributions.exporters ?? []).filter((e) => e.outputKind === "project"),
    ],
    ["view", contributions.pages],
    ["run", contributions.canvasNodes],
    ["run", contributions.chatTools],
    ["handle", contributions.events],
    ["run", contributions.actions],
  ] as const) {
    for (const { program } of declarations ?? []) {
      try {
        const inspect = await loadProgram(
          `({check() { return typeof (${program}\n)[${JSON.stringify(hook)}] === "function"; }})`,
        );
        requireValue(inspect("check"), 400, "缺少扩展程序入口");
      } catch {
        throw new DomainError(400, "扩展程序入口无效：" + hook);
      }
    }
  }
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
  if (manifest.artifactValidation?.version === 3)
    requireValue(
      file.manifest && contributions.hostCapabilities.includes("media"),
      400,
      "宿主成品验收需要 media 能力",
    );
  if (manifest.chat?.sandbox || (file.manifest?.chat && !file.program)) {
    const sandbox = manifest.chat?.sandbox;
    requireValue(
      file.manifest &&
        sandbox &&
        !file.program &&
        !file.studioProgram &&
        !manifest.originalSubmission &&
        manifest.mode === "request" &&
        manifest.models.length &&
        manifest.models.every((m) => m.kind === "chat") &&
        contributions.hostCapabilities.includes("secrets") &&
        contributions.http &&
        canonical([...sandbox.origins].sort()) ===
          canonical([...contributions.http.origins].sort()),
      400,
      "沙箱对话需要声明 HTTP 目标和连接密钥注入",
    );
  }
  const studio = manifest.originalSubmission?.version === 4;
  const request = manifest.originalSubmission?.version === 5;
  if (manifest.originalSubmission?.version === 5)
    requireValue(
      (manifest.originalSubmission.artifactOrigins ?? []).every(origin =>
        contributions.http?.origins.includes(origin) &&
        /^https:\/\/(?:\*\.)?(?:[a-z0-9-]+\.)+[a-z0-9-]+$/.test(origin)),
      400, "成品域名必须声明为获准的 HTTPS 源",
    );
  if (request || contributions.http?.connection)
    requireValue(
      request &&
        file.manifest &&
        !file.program &&
        !file.nodeClient &&
        !manifest.chat &&
        manifest.mode === "request" &&
        manifest.artifactDownload &&
        manifest.artifactValidation?.version === 3 &&
        manifest.requestLifecycle &&
        contributions.http?.connection &&
        contributions.hostCapabilities.includes("secrets"),
      400,
      "请求工作台需要服务地址、密钥注入和媒体验收能力",
    );
  requireValue(
    (studio || request) === !!file.studioProgram &&
      (!studio ||
        (contributions.nodePools &&
          (!manifest.referenceImports ||
            contributions.hostCapabilities.includes("media")))),
    400,
    "节点工作台策略需要节点池声明和所用宿主能力",
  );
  if (contributions.nodePools) {
    requireValue(
      file.manifest &&
        file.nodeClient &&
        file.program &&
        (manifest.originalSubmission?.version === 3 || studio),
      400,
      "节点池需要独立清单、节点程序和客户端",
    );
    const describe = await loadProgram(`({ hooks() {
      const program = (${file.program}\n);
      return Object.keys(program).map(name => typeof program[name] === "function" ? name : null);
    } })`);
    const hooks = describe("hooks") as unknown[];
    requireValue(
      nodePoolHooks.every((hook) => hooks.includes(hook)) &&
        hooks.length === nodePoolHooks.length,
      400,
      "节点池必须实现五项策略",
    );
    const bytes = Buffer.from(file.nodeClient["agent.tgz"], "base64");
    const checksum = Buffer.from(file.nodeClient["agent.tgz.sha256"], "base64")
      .toString("utf8")
      .trim();
    requireValue(
      bytes.length &&
        /^([0-9a-f]{64})(?:[ \t]+\*?agent\.tgz)?$/.exec(checksum)?.[1] ===
          createHash("sha256").update(bytes).digest("hex") &&
        Buffer.from(file.nodeClient["install.sh"], "base64").length,
      400,
      "节点安装文件或摘要无效",
    );
  } else if (file.manifest && manifest.mode === "pull") {
    throw new DomainError(400, "pull 插件须声明节点池");
  } else if (contributions.hostCapabilities.includes("nodes"))
    throw new DomainError(400, "节点管理需要节点池声明");
  if (file.nodeClient)
    requireValue(
      manifest.mode === "pull" && file.program,
      400,
      "节点客户端需要节点程序",
    );
  const adapter = file.extensionOnly
    ? undefined
    : file.remote
      ? remotePlugin(manifest, file.remote.endpoint)
      : manifest.chat?.sandbox
        ? await registry.chatAdapter(manifest)
        : request && file.studioProgram
          ? await registry.requestAdapter(manifest, file.studioProgram)
          : file.studioProgram
            ? await nodeStudioPlugin(manifest, file.studioProgram)
            : portablePlugin(manifest);
  return { adapter, manifest, contributions };
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
  for (const m of next.paymentMethods ?? []) {
    const paths = [m.checkoutPath, m.createPath, m.queryPath]
      .filter(Boolean)
      .join("、");
    const priorMethod = prior?.paymentMethods?.find((old) => old.id === m.id);
    lines.push(
      added(
        "充值渠道 · " + m.title + " · 收款网关 " + paths + " · " + m.signature,
        !priorMethod || canonical(priorMethod) !== canonical(m),
      ),
    );
  }
  for (const item of next.importers ?? []) {
    const audience = item.audience === "admin" ? "管理员" : "工作区成员";
    lines.push(
      added(
        "导入器 · " +
          item.title +
          " · " +
          (item.target === "assets" ? "写入素材" : "新建画布") +
          "（" +
          audience +
          "）",
        !prior?.importers?.some(
          (i) =>
            i.id === item.id &&
            i.target === item.target &&
            i.audience === item.audience,
        ),
      ),
    );
  }
  for (const t of next.chatTools ?? [])
    lines.push(added("对话工具 · " + t.title + (t.audience === "admin" ? "（管理员）" : "（工作区成员）"), !prior?.chatTools?.some(old => old.id === t.id && old.audience === t.audience)));
  for (const n of next.canvasNodes ?? [])
    lines.push(added("工作区画布节点 · " + n.title, !prior?.canvasNodes?.some(old => old.id === n.id)));
  for (const e of next.exporters ?? [])
    lines.push(added("画布导出器 · " + e.title, !prior?.exporters?.some(old => old.id === e.id)));
  for (const event of next.events ?? [])
    lines.push(
      added(
        "所有工作区的事件订阅 · " + event.type,
        !prior?.events?.some((e) => e.type === event.type),
      ),
    );
  for (const a of next.actions ?? [])
    lines.push(
      added(
        (a.target === "asset" ? "素材" : "任务") +
          "菜单 · " +
          a.title +
          " · " +
          (a.audience === "member" ? "工作区成员" : "管理员"),
        !prior?.actions?.some(
          (old) =>
            old.id === a.id &&
            old.target === a.target &&
            old.audience === a.audience,
        ),
      ),
    );
  if (next.nodePools)
    lines.push(added("节点池 · 接入、派发和成片验收", !prior?.nodePools));
  const priorPages = prior ? contributedPages(prior) : [];
  for (const page of contributedPages(next)) {
    const old = priorPages.find(p => p.id === page.id && p.placement === page.placement);
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
        (page.placement === "studio" ? "工作台页面「" : "设置页「") +
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
  if (next.hostCapabilities.includes("media"))
    lines.push(
      "宿主能力：" +
        added(
          "读取工作区私有素材、转码、拼接和抽帧",
          !prior?.hostCapabilities.includes("media"),
        ),
    );
  if (next.hostCapabilities.includes("secrets"))
    lines.push(
      "宿主能力：" +
        added(
          "对管理员配置的服务地址注入连接密钥",
          !prior?.hostCapabilities.includes("secrets"),
        ),
    );
  if (next.http?.connection)
    lines.push(
      added("访问管理员配置的公网 HTTPS 服务", !prior?.http?.connection),
    );
  if (next.http?.origins.length)
    lines.push(
      "宿主能力：访问外部服务 " +
        next.http.origins
          .map((origin) =>
            added(origin, !prior?.http?.origins.includes(origin)),
          )
          .join("、"),
    );
  if (next.hostCapabilities.includes("data"))
    lines.push(
      "宿主能力：" +
        added(
          "保存插件数据（全站与工作区）",
          !prior?.hostCapabilities.includes("data"),
        ),
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
    const pinned = await pinnedPublisher(this.p.db, f.id);
    if (!f.signature) authorizePublisher(pinned, undefined);
    const { manifest: m, contributions } = await inspectPackage(
      f,
      this.p.registry,
    );
    const prior = await one(
      this.p.db,
      `SELECT r.package,coalesce(v.manifest,'{"models":[]}'::jsonb) AS manifest FROM studio_packages p JOIN studio_package_releases r USING(id,version)
      LEFT JOIN plugin_versions v ON v.id=p.id AND v.version=r.package->>'adapterVersion' WHERE p.id=$1 AND p.installed`,
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
      changes.push(
        prior &&
          !!prior.package.contributes?.nodePools !== !!contributions.nodePools
          ? "节点协议变更，须先排空任务并使用新接入命令重新安装实例"
          : "包含新的节点安装文件，已有机器保持原版本",
      );
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
      publisher: publisherReview(pinned, f.signature),
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
    adapter: ProviderPlugin | undefined,
    supplements: z.infer<typeof upgradeFields>,
    revision: number | undefined,
    rollback: boolean,
  ) {
    const current = await one(
      this.p.db,
      `SELECT p.*,r.package->'remote'->>'endpoint' AS endpoint,v.manifest AS old_manifest
        FROM studio_packages p JOIN studio_package_releases r USING(id,version)
        LEFT JOIN plugin_versions v ON v.id=p.id AND v.version=r.package->>'adapterVersion'
        WHERE installed AND p.id=$1`,
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
    if (!adapter) {
      requireValue(!services.length, 409, "独立扩展不能使用模型连接");
      return [];
    }
    const inspected: {
      id: string;
      revision: number;
      pause: AddressPause | null;
    }[] = [];
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
      const pause = await addressPause(adapter.manifest, config);
      requireValue(
        validSavedConfig(adapter.manifest, config, pause),
        409,
        "现有配置缺少新版要求的字段",
      );
      if (usesPublicConnection(adapter.manifest) && previous.apiKey) {
        const savedOrigin =
          current.old_manifest &&
          connectionBase(current.old_manifest, previous)?.origin;
        requireValue(
          (savedOrigin &&
            savedOrigin === connectionBase(adapter.manifest, config)?.origin) ||
            (pause && previous.baseUrl && previous.baseUrl === config.baseUrl),
          409,
          "不能向新的服务地址转发已有密钥",
        );
      }
      if (adapter.manifest.mode === "request" && !pause)
        requireValue(
          await adapter.health(config, AbortSignal.timeout(10000)),
          409,
          "新版本使用现有配置未通过连接检查",
        );
      inspected.push({ id: s.id, revision: s.revision, pause });
    }
    return inspected;
  }
  private async manifest(sql: Sql, file: PackageFile) {
    if (file.manifest) {
      const m = manifestSchema.parse(file.manifest);
      requireValue(
        m.id === file.id &&
          m.version === file.adapterVersion &&
          (m.originalSubmission?.version === 3 ||
            m.originalSubmission?.version === 4 ||
            m.originalSubmission?.version === 5 ||
            !!m.chat?.sandbox) &&
          (m.mode === "request" || !!file.contributes?.nodePools),
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
        file.studioProgram,
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
    throw new DomainError(400, "插件文件缺少执行清单");
  }
  async install(
    actor: Actor,
    value: unknown,
    revision?: number,
    rollback = false,
    supplements: z.infer<typeof upgradeFields> = {},
    confirmPublisher?: string,
  ) {
    this.p.admin(actor);
    const original = structuredClone(value);
    const file = parsePackageFile(original);
    // Preserve the signed JSON before schema defaults are applied, including for offline rollback.
    const releaseFile = file.signature ? original : file;
    authorizePublisher(
      await pinnedPublisher(this.p.db, file.id), file.signature, confirmPublisher,
    );
    const {
      adapter,
      manifest: inspected,
      contributions,
    } = await inspectPackage(file, this.p.registry);
    const probed = await this.probe(
      file,
      adapter,
      supplements,
      revision,
      rollback,
    );
    const serviceChecks = new Map(probed.map((s) => [s.id, s]));
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
      authorizePublisher(
        await pinnedPublisher(sql, file.id), file.signature, confirmPublisher,
      );
      requireValue(!current?.removing, 409, "插件正在移除");
      const release = await one(
        sql,
        "SELECT package FROM studio_package_releases WHERE id=$1 AND version=$2",
        [file.id, file.version],
      );
      requireValue(
        !release || canonical(release.package) === canonical(releaseFile),
        409,
        "同一版本的插件文件不能更改",
      );
      if (file.extensionOnly && !current)
        requireValue(
          !(await one(sql, "SELECT 1 FROM plugin_versions WHERE id=$1", [
            file.id,
          ])),
          409,
          "扩展标识已由模型提供方使用",
        );
      if (current) {
        const previous = await one(
          sql,
          "SELECT package FROM studio_package_releases WHERE id=$1 AND version=$2",
          [file.id, current.version],
        );
        requireValue(
          !!previous?.package.extensionOnly === !!file.extensionOnly,
          409,
          "不能改变插件的执行类型",
        );
      }
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
      if (current?.installed && file.nodeClient) {
        const prior = await one(
          sql,
          "SELECT package FROM studio_package_releases WHERE id=$1 AND version=$2",
          [file.id, current.version],
        );
        if (
          !!prior?.package.contributes?.nodePools !== !!contributions.nodePools
        ) {
          const pending = await one(
            sql,
            "SELECT 1 FROM jobs WHERE plugin_id=$1 AND state NOT IN ('completed','cancelled','failed') LIMIT 1",
            [file.id],
          );
          requireValue(!pending, 409, "请先排空在途任务，再切换节点协议");
          // Fence concurrent enrollments before taking the snapshot of nodes to revoke.
          await sql.query(
            "UPDATE node_pairings p SET expires_at=least(expires_at,clock_timestamp()) FROM connections c WHERE c.id=p.connection_id AND c.plugin_id=$1 AND NOT c.fmworker_resource_driver",
            [file.id],
          );
          await sql.query(
            "UPDATE nodes n SET archived=true,enabled=false,control='removed' FROM connections c WHERE c.id=n.connection_id AND c.plugin_id=$1 AND NOT c.fmworker_resource_driver",
            [file.id],
          );
        }
      }
      if (file.program && !contributions.nodePools) {
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
      if (
        file.manifest &&
        !inspected.chat?.sandbox &&
        inspected.originalSubmission?.version !== 5 &&
        !contributions.nodePools
      ) {
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
      for (const m of inspected.models.filter((m) => m.studio)) {
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
      const manifest = file.extensionOnly
        ? inspected
        : await this.manifest(sql, file);
      if (!file.extensionOnly)
        await new StudioCatalog(this.p.db).activate(sql, manifest, true);
      if (!release)
        await sql.query(
          "INSERT INTO studio_package_releases VALUES($1,$2,$3)",
          [file.id, file.version, JSON.stringify(releaseFile)],
        );
      const services = (
        await sql.query<{
          id: string;
          config: string;
          revision: number;
          plugin_version: string;
          sandbox_address_pause?: AddressPause | null;
        }>(
          "SELECT * FROM connections WHERE plugin_id=$1 AND NOT removed AND NOT fmworker_resource_driver FOR UPDATE",
          [file.id],
        )
      ).rows;
      if (current?.installed)
        requireValue(
          services.length === serviceChecks.size &&
            services.every(
              (s) => serviceChecks.get(s.id)?.revision === s.revision,
            ),
          409,
          "服务配置已更新，请重新检查",
        );
      for (const service of services) {
        const pause = serviceChecks.get(service.id)?.pause ?? null;
        requireValue(
          !pause || Object.hasOwn(service, "sandbox_address_pause"),
          503,
          "请先执行连接准入迁移",
        );
        if (service.plugin_version === file.adapterVersion) {
          if ((service.sandbox_address_pause ?? null) !== pause)
            await sql.query(
              "UPDATE connections SET sandbox_address_pause=$2,revision=revision+1 WHERE id=$1",
              [service.id, pause],
            );
          continue;
        }
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
          validSavedConfig(manifest, config, pause),
          409,
          "现有服务设置与新版不兼容",
        );
        const adapter = await this.p.registry.resolve(
          sql,
          file.id,
          file.adapterVersion,
        );
        const writePause = Object.hasOwn(service, "sandbox_address_pause");
        await sql.query(
          "UPDATE connections SET plugin_version=$2,config=$3,revision=revision+1" +
            (writePause ? ",sandbox_address_pause=$4" : "") +
            " WHERE id=$1",
          [
            service.id,
            file.adapterVersion,
            this.p.vault.seal(config),
            ...(writePause ? [pause] : []),
          ],
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
    const rows = (
      await this.p.db
        .query(`SELECT p.id,p.version,(SELECT prior.version FROM studio_package_releases prior
            WHERE prior.id=p.id AND prior.version=p.previous_version AND prior.package ?| array['manifest','remote','extensionOnly']) AS "previousVersion",p.enabled,p.removing,p.revision,
      r.package->'signature' AS publisher_signature,
      (SELECT prior.package->'signature' FROM studio_package_releases prior WHERE prior.id=p.id AND prior.version=p.previous_version) AS previous_signature,
      p.update_url AS "updateUrl",p.update_auth IS NOT NULL AS "hasUpdateToken",p.checked_at AS "checkedAt",p.update_info AS "updateInfo",
      r.package->>'label' AS label, r.package->>'adapterVersion' AS "adapterVersion",coalesce(v.manifest->'configSchema','{}'::jsonb) AS "configSchema",
      ARRAY(SELECT jsonb_build_object('id',m->>'id','title',m->>'title') FROM jsonb_array_elements(r.package->'contributes'->'paymentMethods') m) AS "paymentMethods",
      CASE WHEN r.package ? 'extensionOnly' THEN 'extension' ELSE v.manifest->>'mode' END AS mode,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',c.id,'label',COALESCE(c.display_label,c.descriptor->>'label'),'kind',c.descriptor->>'kind','enabled',COALESCE((g.flags->>c.id)::boolean,false), 'service',s.connection_id,'services',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name) ORDER BY x.name,x.id),'[]'::jsonb) FROM connections x JOIN models m ON m.connection_id=x.id JOIN studio_packages t ON t.id=x.plugin_id AND t.installed AND NOT t.removing WHERE m.catalog_id=c.id AND x.enabled AND NOT x.removed)) ORDER BY c.position,c.id),'[]'::jsonb)
        FROM studio_catalog c CROSS JOIN studio_policy g LEFT JOIN studio_model_service s ON s.model_id=c.id WHERE (c.plugin_id=p.id OR EXISTS(SELECT 1 FROM studio_shared_models e WHERE e.model_id=c.id AND e.plugin_id=p.id)) AND NOT c.hidden) AS choices, ARRAY(SELECT m->>'label' FROM jsonb_array_elements(v.manifest->'models') m WHERE m ? 'studio' AND COALESCE((m->>'hidden')::boolean,false)=false) AS models
      FROM studio_packages p JOIN studio_package_releases r USING(id,version)
      LEFT JOIN plugin_versions v ON v.id=p.id AND v.version=r.package->>'adapterVersion' WHERE p.installed AND (v.id IS NOT NULL OR r.package ? 'extensionOnly') ORDER BY label,p.id`)
    ).rows;
    for (const row of rows) {
      const current = (row.publisher_signature as PackageSignature | null) ?? undefined;
      const prior = (row.previous_signature as PackageSignature | null) ?? undefined;
      row.publisher = publisherReview(undefined, current);
      row.rollbackPublisher = row.previousVersion ? publisherReview(current, prior) : null;
      delete row.publisher_signature;
      delete row.previous_signature;
    }
    const providers = rows.filter(row=>row.paymentMethods.length);
    if (providers.length) {
      const channels = (await this.p.db.query(
        "SELECT method,enabled,plugin_id FROM payment_channels WHERE plugin_id=ANY($1::text[])",
        [providers.map(row=>row.id)],
      )).rows;
      for (const row of providers) {
        row.paymentMethods=row.paymentMethods.map((method:{id:string;title:string})=>{
          const channel=channels.find(c=>c.plugin_id===row.id && c.method===method.id);
          return {...method,configured:!!channel,enabled:channel?.enabled??false};
        });
      }
    }
    return rows;
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
      if (
        action === "enable" &&
        !(await one(
          sql,
          "SELECT 1 FROM studio_package_releases WHERE id=$1 AND version=$2 AND package ? 'extensionOnly'",
          [id, row.version],
        ))
      )
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
    await purgePluginData(sql, id);
    await sql.query("DELETE FROM studio_action_receipts WHERE plugin_id=$1", [
      id,
    ]);
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
