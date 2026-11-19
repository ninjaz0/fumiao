import { readFile } from "node:fs/promises";
import { portablePlugin } from "./portable-plugin.js";
import {
  approvedAdapterVersions,
  officialAdapter,
  reservedAdapterId,
  type OfficialAdapter,
} from "./distribution/official-adapter.js";
import {
  packageContributions,
  type LegacySettingsPage,
} from "../../plugin-sdk/src/contributions.js";
import type { PairedAgentProtocol } from "../../plugin-sdk/src/paired-agent.js";
import { validator } from "./schema.js";
export { validator } from "./schema.js";
import { registerStudioModels } from "./catalog.js";
import { remotePlugin } from "../../../plugins/remote/src/index.js";
import { validOriginalRemoteModels } from "../../../plugins/remote/src/original.js";
import {
  manifestSchema,
  ProviderError,
  type ProviderPlugin,
  type Manifest,
} from "../../plugin-sdk/src/index.js";
import type { Database, Sql } from "./db.js";
import { one } from "./db.js";
import { DomainError, requireValue } from "./security.js";
import {
  studioPluginProfile,
  hasStudioPackages,
} from "./studio-plugin-profile.js";

export class PluginRegistry {
  private builtins = new Map<string, ProviderPlugin>();
  private protocols = new Map<string, PairedAgentProtocol>();
  private extensions = new Map<string, OfficialAdapter>();
  async nodeExtension(sql: Sql, pluginId?: string) {
    if (await hasStudioPackages(sql)) {
      const candidates = await sql.query<{
        id: string;
        version: string;
        settingsPage: LegacySettingsPage | null;
        contributes: unknown;
      }>(
        `SELECT p.id,r.package->>'adapterVersion' AS version,r.package->'settingsPage' AS "settingsPage",
           r.package->'contributes' AS contributes FROM studio_packages p JOIN studio_package_releases r USING(id,version)
         WHERE p.installed AND ($1::text IS NULL OR p.id=$1)
           AND (r.package ? 'settingsPage' OR r.package->'contributes'->'hostCapabilities' ? 'nodes')
         ORDER BY p.id`,
        [pluginId ?? null],
      );
      const row = candidates.rows.find((candidate) =>
        packageContributions(candidate).hostCapabilities.includes("nodes"),
      );
      if (row) {
        if (!this.extensions.has(row.id + "@" + row.version)) {
          const module = await one(
            sql,
            "SELECT code FROM studio_adapter_modules WHERE id=$1 AND version=$2",
            [row.id, row.version],
          );
          requireValue(module, 503, "节点插件版本不可用");
          await this.registerModule(row.id, row.version, module.code);
        }
        const binding = this.extensions.get(row.id + "@" + row.version);
        requireValue(
          binding?.NodeManagement && binding.Agent,
          503,
          "节点服务不可用",
        );
        return { NodeManagement: binding.NodeManagement, Agent: binding.Agent };
      }
      requireValue(
        (await studioPluginProfile(sql)) !== "explicit",
        404,
        "尚未安装节点插件",
      );
    }
    requireValue(pluginId === undefined, 404, "尚未安装节点插件");
    const [{ OriginalNodes: NodeManagement }, { OriginalPairedAgent: Agent }] =
      await Promise.all([
        import("../../original-api/src/nodes.js"),
        import("../../original-api/src/paired-agent.js"),
      ]);
    return { NodeManagement, Agent };
  }
  private custom: boolean;
  constructor(
    plugins?: ProviderPlugin[],
    protocols: readonly PairedAgentProtocol[] = [],
  ) {
    this.custom = !!plugins;
    for (const plugin of plugins ?? []) this.remember(plugin);
    for (const p of protocols) this.protocols.set(p.provider, p);
  }
  private remember(p: ProviderPlugin) {
    this.builtins.set(p.manifest.id + "@" + p.manifest.version, p);
  }
  private async historical() {
    const history = await import("./historical-adapters.js");
    if (!this.custom)
      for (const p of history.historicalAdapters)
        if (!this.builtins.has(p.manifest.id + "@" + p.manifest.version))
          this.remember(p);
    if (!this.protocols.has("gpu"))
      this.protocols.set("gpu", history.gpuPairedAgent);
    return history;
  }
  async pairedAgent(sql: Sql, provider: string, version: string) {
    await this.resolve(sql, provider, version);
    const bundled = this.extensions.get(provider + "@" + version)?.protocol;
    if (bundled) return bundled;
    if (!this.protocols.has(provider)) await this.historical();
    return this.protocols.get(provider);
  }
  async registerModule(id: string, version: string, code: string) {
    const loaded = await officialAdapter(id, version, code);
    this.extensions.set(id + "@" + version, loaded);
    this.remember(loaded.adapter);
    return loaded.adapter;
  }
  async initializeStudio(db: Database, importing: boolean) {
    await db.transaction(async (sql) => {
      await sql.query(
        "SELECT pg_advisory_xact_lock(hashtext('studio-catalog'))",
      );
      if (await hasStudioPackages(sql))
        await this.restoreConfiguredPackages(sql);
      if (await studioPluginProfile(sql)) return;
      const existing = await one(
        sql,
        `SELECT EXISTS (SELECT 1 FROM studio_catalog)
        OR EXISTS (SELECT 1 FROM connections) AS present`,
      );
      const compatible = importing || existing.present;
      if (compatible) {
        await this.installBuiltinsOn(sql);
        await this.prepareOriginalStudio(sql);
      }
      await sql.query("INSERT INTO studio_plugin_profile(mode) VALUES($1)", [
        compatible ? "compatible" : "explicit",
      ]);
    });
  }
  private async restoreConfiguredPackages(sql: Sql) {
    // Migration 034 names only services that already existed. Hydrate those
    // releases without registering any extra provider, model or connection.
    const rows = (
      await sql.query(
        `SELECT p.id,p.version,r.package,v.manifest,v.endpoint FROM studio_packages p JOIN studio_package_releases r USING(id,version)
      JOIN plugin_versions v ON v.id=p.id AND v.version=r.package->>'adapterVersion'
      WHERE p.installed AND NOT (r.package ?| array['remote','adapterModule','manifest'])
      AND (NOT (r.package ? 'restored') OR (v.id || '@' || v.version)=ANY($1::text[]))`,
        [approvedAdapterVersions],
      )
    ).rows;
    for (const row of rows) {
      let release = { ...row.package, restored: true };
      if (row.endpoint) {
        release = {
          ...row.package,
          remote: { endpoint: row.endpoint, manifest: row.manifest },
        };
        await this.installOn(sql, row.manifest, row.endpoint, false);
      } else if (reservedAdapterId(row.id)) {
        const packaged = JSON.parse(
          await readFile(
            new URL(
              "../../../plugins/" + row.id + "/" + row.id + ".fmplugin.json",
              import.meta.url,
            ),
            "utf8",
          ),
        );
        if (packaged.adapterVersion === row.version) {
          const adapter = await this.registerModule(
            row.id,
            row.version,
            packaged.adapterModule,
          );
          await sql.query(
            "INSERT INTO studio_adapter_modules VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
            [row.id, row.version, packaged.adapterModule],
          );
          await this.installOn(sql, adapter.manifest, undefined, false);
          release = packaged;
        }
      }
      if (release.restored) {
        const old = await this.resolve(sql, row.id, row.version);
        await this.installOn(sql, old.manifest, undefined, false);
      }
      await sql.query(
        `INSERT INTO studio_package_releases(id,version,package) VALUES($1,$2,$3)
        ON CONFLICT(id,version) DO UPDATE SET package=excluded.package`,
        [row.id, release.version, JSON.stringify(release)],
      );
      await sql.query(
        "UPDATE studio_packages SET version=$2,update_url=COALESCE(update_url,$3) WHERE id=$1",
        [row.id, release.version, release.updateUrl ?? null],
      );
      await sql.query(
        `INSERT INTO studio_model_service(model_id,connection_id) SELECT DISTINCT ON (m.catalog_id) m.catalog_id,c.id FROM models m JOIN connections c ON c.id=m.connection_id
         WHERE m.catalog_id IS NOT NULL AND c.plugin_id=$1 AND c.enabled AND NOT c.fmworker_resource_driver ORDER BY m.catalog_id,c.id ON CONFLICT DO NOTHING`,
        [row.id],
      );
    }
  }
  async studioPackages() {
    const { studioReleases } = await this.historical();
    return studioReleases.map(([, plugin, label]) => ({
      manifest: plugin.manifest,
      label,
    }));
  }
  async installStudioPackage(sql: Sql, id: string, version: string) {
    const release = (await this.studioPackages()).find(
      (p) => p.manifest.id === id && p.manifest.version === version,
    );
    requireValue(release, 404, "工作台插件版本不存在");
    await sql.query("SELECT pg_advisory_xact_lock(hashtext('studio-catalog'))");
    return this.installOn(sql, release.manifest, undefined, true);
  }
  async installBuiltins(db: Database, originalStudio = false) {
    await db.transaction(async (sql) => {
      await this.installBuiltinsOn(sql);
      if (originalStudio) await this.prepareOriginalStudio(sql);
    });
  }
  async installBuiltinsOn(sql: Sql) {
    await this.historical();
    await sql.query("SELECT pg_advisory_xact_lock(hashtext('studio-catalog'))");
    const fresh = !(await one(sql, "SELECT id FROM studio_catalog LIMIT 1"));
    const formsReady = !!(
      await one(sql, "SELECT to_regclass('plugin_model_forms') AS table_name")
    )?.table_name;
    for (const plugin of this.builtins.values())
      await this.installOn(sql, plugin.manifest, undefined, !fresh, formsReady);
    // Backfill remote adapters that were installed before the UI contract existed.
    if (formsReady) {
      const missing =
        await sql.query(`SELECT v.manifest,v.endpoint FROM plugin_versions v
        LEFT JOIN plugin_model_forms f ON f.plugin_id=v.id AND f.plugin_version=v.version
        WHERE f.plugin_id IS NULL AND v.endpoint IS NOT NULL AND v.manifest->'originalSubmission'->>'version' IN ('2','3')
          AND NOT (v.manifest ? 'fmworkerResources')`);
      for (const row of missing.rows)
        await this.installOn(sql, row.manifest, row.endpoint, false);
    }
  }
  private async prepareOriginalStudio(sql: Sql) {
    // Move the original seed catalog to the supported adapters without
    // changing any user-visible metadata, amounts, policy or pricing revision.
    const { studioReleases } = await this.historical();
    for (const [seed, original] of studioReleases) {
      const from = seed.manifest,
        to = original.manifest;
      const studio = (manifest: Manifest) =>
        manifest.models.map(({ id, kind, hidden, studio }) => ({
          id,
          kind,
          hidden,
          studio,
        }));
      requireValue(
        from.id === to.id && canonical(studio(from)) === canonical(studio(to)),
        409,
        "Studio default adapter upgrade changes the public model catalog",
      );
      await sql.query(
        `UPDATE studio_catalog SET plugin_version=$3 WHERE plugin_id=$1 AND plugin_version=$2`,
        [from.id, from.version, to.version],
      );
    }
  }
  async install(db: Database, value: unknown, endpoint?: string) {
    return db.transaction(async (sql) => {
      await sql.query(
        "SELECT pg_advisory_xact_lock(hashtext('studio-catalog'))",
      );
      return this.installOn(sql, value, endpoint, true);
    });
  }
  async installOn(
    sql: Sql,
    value: unknown,
    endpoint: string | undefined,
    bump: boolean,
    formsReady = true,
    portable = false,
  ) {
    requireValue(
      !(
        value &&
        typeof value === "object" &&
        Object.hasOwn(value, "fmworkerResources")
      ),
      400,
      "fmWorker 资源能力已退役，无法安装此插件",
    );
    const manifest = manifestSchema.parse(value) as Manifest;
    const local = this.builtins.get(`${manifest.id}@${manifest.version}`);
    if (manifest.canvas) {
      const rules = manifest.canvas.models;
      requireValue(
        new Set(rules.map((r) => r.model)).size === rules.length &&
          rules.every((r) =>
            manifest.models.some(
              (m) => m.id === r.model && m.kind === r.kind && m.studio,
            ),
          ) &&
          ["image", "video"].every(
            (kind) =>
              rules.filter((r) => r.kind === kind && r.defaultForKind).length <=
              1,
          ) &&
          rules.every(
            (r) => r.templatePriority === undefined || r.kind === "video",
          ),
        400,
        "画布模型规则无效",
      );
    }
    if (manifest.canvasSubmission) {
      const rules = manifest.canvasSubmission.models;
      requireValue(
        new Set(rules.map((r) => r.model)).size === rules.length &&
          rules.every((r) =>
            manifest.models.some(
              (m) => m.id === r.model && m.kind === r.kind && m.studio,
            ),
          ) &&
          ["image", "video", "audio"].every(
            (kind) =>
              rules.filter((r) => r.kind === kind && r.defaultForKind).length <=
              1,
          ) &&
          rules.every(
            (r) =>
              (!r.nativeH3 && r.fixedSamplingSteps === undefined) ||
              r.kind === "video",
          ),
        400,
        "画布生成规则无效",
      );
    }
    if (manifest.chat) {
      requireValue(
        !endpoint &&
          manifest.mode === "request" &&
          local?.chatStream &&
          local.chatTitle &&
          local.chatProbe &&
          local.chatProvider &&
          local.chatConfigured &&
          local.chatConfigure,
        400,
        "对话流需要已安装的本地适配器",
      );
      const providers = manifest.chat.providers,
        models = providers.flatMap((p) => p.models);
      requireValue(
        new Set(providers.map((p) => p.id)).size === providers.length &&
          new Set(models).size === models.length &&
          models.every((id) =>
            manifest.models.some((m) => m.id === id && m.kind === "chat"),
          ),
        400,
        "对话提供方目录无效",
      );
    }
    if (manifest.originalImageSettings)
      requireValue(
        !endpoint &&
          local?.checkOriginalSettings &&
          local.originalState &&
          manifest.originalState?.fields.includes("images") &&
          manifest.models.some(
            (m) => m.id === manifest.originalImageSettings!.defaultModel,
          ),
        400,
        "原图片设置需要已安装的本地适配器",
      );
    if (manifest.requestLifecycle)
      requireValue(
        !endpoint &&
          manifest.mode === "request" &&
          local?.manifest.requestLifecycle,
        400,
        "请求生命周期需要已安装的本地适配器",
      );
    if (manifest.artifactDownload)
      requireValue(
        !endpoint && manifest.mode === "request" && local?.downloadArtifact,
        400,
        "产物下载契约需要已安装的本地适配器",
      );
    if (
      manifest.requestLifecycle?.version === 3 &&
      manifest.requestLifecycle.requireConfigured
    )
      requireValue(
        local?.originalState?.configured,
        400,
        "请求准入需要已安装的配置适配器",
      );
    if (manifest.originalState)
      requireValue(
        !endpoint &&
          local?.originalState &&
          manifest.queue &&
          (!manifest.originalState.recovery || manifest.mode === "pull") &&
          new Set(manifest.originalState.fields).size ===
            manifest.originalState.fields.length,
        400,
        "原状态契约需要已安装的本地适配器",
      );
    if (manifest.originalEstimate)
      requireValue(
        !endpoint &&
          local?.originalEstimate &&
          manifest.timing &&
          manifest.queue &&
          (!manifest.timing.hardware || local.originalEstimate.eligible),
        400,
        "原估时契约需要已安装的本地适配器",
      );
    if (manifest.originalSubmission?.version === 1)
      requireValue(
        !endpoint && local?.originalSubmission,
        400,
        "原提交契约需要已安装的本地适配器",
      );
    if ((manifest.originalSubmission?.version ?? 0) >= 2) {
      requireValue(
        (portable || (endpoint && validRemoteEndpoint(endpoint))) &&
          manifest.mode === "request" &&
          !reservedAdapterId(manifest.id) &&
          ![...this.builtins.values()].some(
            (p) => p.manifest.id === manifest.id,
          ) &&
          !manifest.canvasSubmission &&
          validOriginalRemoteModels(manifest),
        400,
        "远程工作台提交契约无效",
      );
    }
    if (manifest.inputPreparation)
      requireValue(
        !endpoint &&
          local?.referenceIds &&
          local?.prepareInput &&
          manifest.models.every((m) => m.preparedSchema),
        400,
        "输入冻结需要已安装的本地适配器和结果契约",
      );
    if (manifest.artifactValidation)
      requireValue(
        !endpoint &&
          local?.validateArtifact &&
          (manifest.artifactValidation.version === 1
            ? manifest.mode === "pull"
            : manifest.mode === "request"),
        400,
        manifest.artifactValidation.version === 1
          ? "成片验收需要已安装的本地 pull 适配器"
          : "成片验收需要已安装的本地 request 适配器",
      );
    if (manifest.referenceImports) {
      requireValue(
        !endpoint &&
          this.builtins.get(`${manifest.id}@${manifest.version}`)
            ?.importReference,
        400,
        "参考素材转换需要已安装的本地适配器",
      );
      requireValue(
        new Set(manifest.referenceImports.map((r) => r.id)).size ===
          manifest.referenceImports.length,
        400,
        "参考素材能力重复",
      );
    }
    if (manifest.queue) {
      const adapter = this.builtins.get(`${manifest.id}@${manifest.version}`);
      requireValue(
        !endpoint &&
          manifest.timing &&
          adapter?.timingFeatures &&
          adapter?.queuePlan,
        400,
        "队列能力需要已安装的本地计时和队列适配器",
      );
    }
    requireValue(
      new Set(manifest.models.map((m) => m.id)).size === manifest.models.length,
      400,
      "插件模型 ID 重复",
    );
    try {
      validator.compile(manifest.configSchema);
      for (const model of manifest.models) {
        validator.compile(model.inputSchema);
        if (model.preparedSchema) validator.compile(model.preparedSchema);
      }
    } catch (error) {
      if ((manifest.originalSubmission?.version ?? 0) >= 2)
        throw new DomainError(400, "远程工作台插件的 JSON Schema 无效");
      throw error;
    }
    if (endpoint)
      requireValue(
        manifest.mode === "request",
        400,
        "远程插件必须使用 request 模式",
      );
    if (endpoint)
      requireValue(/^https?:\/\//.test(endpoint), 400, "插件地址无效");
    const adapter =
      local ??
      (portable
        ? portablePlugin(manifest)
        : endpoint
          ? remotePlugin(manifest, endpoint)
          : undefined);
    let forms;
    try {
      forms = Object.fromEntries(
        manifest.models
          .filter((m) => m.studio && adapter?.modelForm)
          .map((m) => [
            m.id,
            {
              ...adapter!.modelForm!(m),
              canvas: !!manifest.canvasSubmission?.models.some(
                (r) => r.model === m.id,
              ),
            },
          ]),
      );
    } catch {
      throw new DomainError(400, "模型表单、参数组合或计费条件无效");
    }
    const existing = await one(
      sql,
      "SELECT * FROM plugin_versions WHERE id=$1 AND version=$2",
      [manifest.id, manifest.version],
    );
    if (existing) {
      requireValue(
        JSON.stringify(existing.manifest) ===
          JSON.stringify(JSON.parse(JSON.stringify(manifest))) ||
          canonical(existing.manifest) === canonical(manifest),
        409,
        "同一插件版本内容不可修改",
      );
      requireValue(
        (existing.endpoint || undefined) === endpoint,
        409,
        "同一插件版本的地址不可修改",
      );
    } else
      await sql.query(
        "INSERT INTO plugin_versions(id,version,manifest,endpoint) VALUES($1,$2,$3,$4)",
        [
          manifest.id,
          manifest.version,
          JSON.stringify(manifest),
          endpoint || null,
        ],
      );
    if (formsReady && Object.keys(forms).length) {
      const args = [manifest.id, manifest.version, JSON.stringify(forms)];
      const inserted = await sql.query(
        `INSERT INTO plugin_model_forms(plugin_id,plugin_version,forms) VALUES ($1,$2,$3)
         ON CONFLICT DO NOTHING RETURNING plugin_id`,
        args,
      );
      if (!inserted.rows.length)
        requireValue(
          await one(
            sql,
            "SELECT 1 FROM plugin_model_forms WHERE plugin_id=$1 AND plugin_version=$2 AND forms=$3::jsonb",
            args,
          ),
          409,
          "同一插件版本的模型表单不可修改",
        );
    }
    await registerStudioModels(sql, manifest, bump);
    return manifest;
  }
  async resolve(
    db: Sql,
    id: string,
    version: string,
  ): Promise<ProviderPlugin & { retired?: true }> {
    const plugin = this.builtins.get(`${id}@${version}`);
    if (plugin) return plugin;
    const row = await one(
      db,
      "SELECT * FROM plugin_versions WHERE id=$1 AND version=$2",
      [id, version],
    );
    if (
      row &&
      !row.endpoint &&
      !Object.hasOwn(row.manifest, "fmworkerResources")
    ) {
      if (await hasStudioPackages(db)) {
        const native = await one(
          db,
          "SELECT code FROM studio_adapter_modules WHERE id=$1 AND version=$2",
          [id, version],
        );
        if (native) return this.registerModule(id, version, native.code);
      }
      if ((row.manifest.originalSubmission?.version ?? 0) >= 2)
        return portablePlugin(row.manifest);
      await this.historical();
      const prior = this.builtins.get(id + "@" + version);
      if (prior) return prior;
    }
    if (row && Object.hasOwn(row.manifest, "fmworkerResources")) {
      // Keep the stored manifest immutable. Old references may read its metadata
      // without exposing the retired capability or loading an execution driver.
      const { fmworkerResources: _, ...manifest } = row.manifest;
      return {
        retired: true,
        manifest: manifestSchema.parse(manifest) as Manifest,
        health: async () => false,
        submit: async () => {
          throw new ProviderError("fmWorker 资源能力已退役", "rejected");
        },
      };
    }
    requireValue(row?.endpoint, 503, "插件版本不可用");
    return remotePlugin(row.manifest, row.endpoint);
  }

  async referenceImporter(db: Sql, id: string) {
    const versions = (
      await db.query(
        `SELECT DISTINCT v.id,v.version,v.manifest FROM studio_catalog c JOIN plugin_versions v ON v.id=c.plugin_id AND v.version=c.plugin_version WHERE v.manifest ? 'referenceImports' ${(await hasStudioPackages(db)) ? "AND studio_plugin_accepts(v.id)" : ""}`,
      )
    ).rows;
    const candidates = versions.flatMap((v) =>
      (v.manifest.referenceImports || [])
        .filter((r: any) => r.id === id)
        .map((capability: any) => ({ version: v, capability })),
    );
    requireValue(candidates.length === 1, 503, "参考素材接入尚未启用");
    const selected = candidates[0],
      plugin = await this.resolve(
        db,
        selected.version.id,
        selected.version.version,
      );
    requireValue(plugin.importReference, 503, "参考素材适配器不可用");
    return { plugin, capability: selected.capability };
  }
}
function validRemoteEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return (
      /^https?:\/\//.test(endpoint) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      !/\s/.test(endpoint)
    );
  } catch {
    return false;
  }
}
/** Provider-bound chat connections expose only their provider's declared models. */
export function connectionModels(
  plugin: ProviderPlugin,
  config: Record<string, unknown>,
) {
  const provider = plugin.manifest.chat?.providers.find(
    (p) => p.id === plugin.chatProvider?.(config),
  );
  requireValue(
    !plugin.manifest.chat || provider,
    400,
    "连接配置不符合插件要求",
  );
  return plugin.manifest.models.filter(
    (m) => !provider || provider.models.includes(m.id),
  );
}
export function canonical(value: any): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + canonical(value[key]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
