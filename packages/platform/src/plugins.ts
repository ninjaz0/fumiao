import { sandboxRequest } from "./sandbox-request.js";
import type { chatHttp } from "@fumiao/plugin-sdk/chat-transport.js";
import { sandboxChat } from "./sandbox-chat.js";
import { nodeStudioPlugin } from "./node-studio-policy.js";
import { portablePlugin } from "./portable-plugin.js";
import {
  archivedAdapterVersions,
  hasArchivedAdapter,
  archivedPackage,
} from "./distribution/legacy-releases.js";
import { packageContributions } from "@fumiao/plugin-sdk/contributions.js";
import type { PairedAgentProtocol } from "@fumiao/plugin-sdk/paired-agent.js";
import { validator } from "./schema.js";
export { validator } from "./schema.js";
import { registerStudioModels } from "./catalog.js";
import { remotePlugin } from "@fumiao/plugin-remote/index.js";
import { validOriginalRemoteModels } from "@fumiao/plugin-remote/original.js";
import {
  manifestSchema,
  ProviderError,
  type ProviderPlugin,
  type Manifest,
} from "@fumiao/plugin-sdk/index.js";
import type { Database, Sql } from "./db.js";
import { one } from "./db.js";
import { DomainError, requireValue } from "./security.js";
import {
  studioPluginProfile,
  hasStudioPackages,
} from "./studio-plugin-profile.js";

import { OriginalNodes as NodeManagement } from "./node-management.js";
import { OriginalPairedAgent as Agent } from "./node-agent.js";

// Explicit imports are host-owned compatibility code. Installed files and database
// fields cannot select a module path. Current packages use the sandbox or a remote.
type LegacyStudio = readonly [ProviderPlugin, ProviderPlugin, string];
type LegacyReleases = {
  releases: readonly ProviderPlugin[];
  studio?: LegacyStudio;
};
const legacyProviders = new Map<string, () => Promise<LegacyReleases>>([
  ["muse", () => import("@fumiao/plugin-muse/legacy-releases.js")],
  ["flow", () => import("@fumiao/plugin-flow/legacy-releases.js")],
  ["gpu", () => import("@fumiao/plugin-gpu/legacy-releases.js")],
  [
    "compatible-images",
    () => import("@fumiao/plugin-images/legacy-releases.js"),
  ],
  ["compatible-chat", () => import("@fumiao/plugin-chat/legacy-releases.js")],
  [
    "storyboard-export",
    async () => {
      const [{ storyboard }, { storyboardHistory }] = await Promise.all([
        import("./composition/legacy-provider.js"),
        import("./composition/history.js"),
      ]);
      return { releases: [storyboard, storyboardHistory] };
    },
  ],
  [
    "original-storyboard",
    async () => {
      const { storyboardHistory } = await import("./composition/history.js");
      return { releases: [storyboardHistory] };
    },
  ],
]);

export class PluginRegistry {
  private builtins = new Map<string, ProviderPlugin>();
  private protocols = new Map<string, PairedAgentProtocol>();
  async nodeExtension(sql: Sql, pluginId?: string) {
    if (await hasStudioPackages(sql)) {
      const row = await one(
        sql,
        `SELECT r.package->'settingsPage' AS "settingsPage", r.package->'contributes' AS contributes
         FROM studio_packages p JOIN studio_package_releases r USING(id,version)
         WHERE p.installed AND p.id=$1`,
        [pluginId ?? "gpu"],
      );
      if (row && packageContributions(row).hostCapabilities.includes("nodes"))
        return { NodeManagement, Agent };
      requireValue(
        (await studioPluginProfile(sql)) !== "explicit",
        404,
        "尚未安装节点插件",
      );
    }
    requireValue(pluginId === undefined, 404, "尚未安装节点插件");
    return { NodeManagement, Agent };
  }
  private custom: boolean;
  constructor(
    plugins?: ProviderPlugin[],
    protocols: readonly PairedAgentProtocol[] = [],
    private readonly providerTransport?: typeof chatHttp,
  ) {
    this.custom = !!plugins;
    for (const plugin of plugins ?? []) this.remember(plugin);
    for (const p of protocols) this.protocols.set(p.provider, p);
  }
  chatAdapter(manifest: Manifest) {
    return sandboxChat(manifest, this.providerTransport);
  }
  requestAdapter(manifest: Manifest, source: string) {
    return sandboxRequest(manifest, source, this.providerTransport);
  }
  async unifiedAdapter(
    manifest: Manifest,
    source: string,
  ): Promise<ProviderPlugin> {
    const [chat, media] = await Promise.all([
      this.chatAdapter(manifest),
      this.requestAdapter(manifest, source),
    ]);
    return {
      ...media,
      modelForm: (m) =>
        m.kind === "chat"
          ? chat.modelForm!(m)
          : media.modelForm!(m),
      chatStream: chat.chatStream,
      chatTitle: chat.chatTitle,
      chatProbe: chat.chatProbe,
      chatProvider: chat.chatProvider,
      chatConfigured: chat.chatConfigured,
      chatConfigure: chat.chatConfigure,
    };
  }
  registerBuiltin(p: ProviderPlugin) {
    this.remember(p);
  }
  private remember(p: ProviderPlugin) {
    this.builtins.set(p.manifest.id + "@" + p.manifest.version, p);
  }
  private async historical(id?: string) {
    const loaders = id
      ? [legacyProviders.get(id)].filter((v) => v !== undefined)
      : [...legacyProviders.values()];
    const history = await Promise.all(loaders.map((load) => load()));
    if (!this.custom)
      for (const { releases } of history)
        for (const p of releases)
          if (!this.builtins.has(p.manifest.id + "@" + p.manifest.version))
            this.remember(p);
    return history.flatMap((h) => (h.studio ? [h.studio] : []));
  }
  async pairedAgent(sql: Sql, provider: string, version: string) {
    await this.resolve(sql, provider, version);
    if (provider === "gpu" && !this.protocols.has(provider)) {
      const { gpuPairedAgent } =
        await import("@fumiao/plugin-gpu/paired-agent.js");
      this.protocols.set(provider, gpuPairedAgent);
    }
    return this.protocols.get(provider);
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
        `SELECT p.id,p.version,r.package,v.version AS adapter_version,v.manifest,v.endpoint FROM studio_packages p JOIN studio_package_releases r USING(id,version)
      JOIN plugin_versions v ON v.id=p.id AND v.version=r.package->>'adapterVersion'
      WHERE p.installed AND NOT (r.package ?| array['remote','adapterModule','manifest','legacyArchive','extensionOnly'])
      AND (NOT (r.package ? 'restored') OR (v.id || '@' || v.version)=ANY($1::text[]))`,
        [archivedAdapterVersions],
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
      } else if (hasArchivedAdapter(row.id)) {
        const packaged = await archivedPackage(row.id, row.adapter_version);
        if (packaged) {
          const adapter = await this.resolve(sql, row.id, row.adapter_version);
          await this.installOn(sql, adapter.manifest, undefined, false);
          release = packaged;
        }
      }
      if (release.restored) {
        const old = await this.resolve(sql, row.id, row.adapter_version);
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
    const studioReleases = await this.historical();
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
    const studioReleases = await this.historical();
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
    studioProgram?: string,
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
    const legacy = portable && legacyProviders.get(manifest.id);
    if (legacy) {
      const history = await legacy();
      requireValue(
        !history.releases.some((p) => p.manifest.version === manifest.version),
        409,
        "适配器版本已存在",
      );
    }
    const unified =
      Boolean(manifest.chat?.sandbox) &&
      Boolean(studioProgram) &&
      manifest.originalSubmission?.version === 5;
    const sandbox =
      unified && portable && !endpoint
        ? await this.unifiedAdapter(manifest, studioProgram!)
        : manifest.chat?.sandbox && portable && !endpoint
          ? await this.chatAdapter(manifest)
          : studioProgram && portable && !endpoint && manifest.originalSubmission?.version === 5
            ? await this.requestAdapter(manifest, studioProgram)
            : studioProgram && portable && manifest.mode === "pull" && manifest.originalSubmission?.version === 4
              ? await nodeStudioPlugin(manifest, studioProgram)
              : undefined;
    requireValue(
      ![4, 5].includes(manifest.originalSubmission?.version ?? 0) || sandbox,
      400,
      "插件缺少工作台策略",
    );
    requireValue(
      !sandbox || !this.builtins.has(manifest.id + "@" + manifest.version),
      409,
      "适配器版本已存在",
    );
    const local =
      sandbox ?? this.builtins.get(`${manifest.id}@${manifest.version}`);
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
          (!manifest.chat.sandbox ||
            (sandbox &&
              (unified
                ? manifest.models.some((m) => m.kind === "chat")
                : !manifest.originalSubmission &&
                  manifest.models.every((m) => m.kind === "chat")))) &&
          local?.chatStream &&
          local.chatTitle &&
          local.chatProbe &&
          local.chatProvider &&
          local.chatConfigured &&
          local.chatConfigure,
        400,
        "对话流需要已安装的对话适配器",
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
    if (!sandbox && (manifest.originalSubmission?.version ?? 0) >= 2) {
      requireValue(
        (portable || (endpoint && validRemoteEndpoint(endpoint))) &&
          (manifest.mode === "request" ||
            (portable && manifest.originalSubmission?.version === 3)) &&
          !hasArchivedAdapter(manifest.id) &&
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
    if (manifest.artifactValidation?.version === 3) {
      requireValue(
        portable &&
          !endpoint &&
          manifest.mode === "request" &&
          (unified
            ? manifest.models.some(
                (m) =>
                  m.kind === "image" ||
                  m.kind === "video" ||
                  m.kind === "audio",
              )
            : manifest.models.every(
                (m) =>
                  m.kind === "image" ||
                  m.kind === "video" ||
                  m.kind === "audio",
              )),
        400,
        "宿主成品验收需要沙箱图片、视频或音频提供方",
      );
    } else if (manifest.artifactValidation)
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
        !endpoint && local?.importReference,
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
      const adapter = local;
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
      if (row.manifest.chat?.sandbox && row.manifest.originalSubmission?.version === 5) {
        const release = await one(
          db,
          "SELECT package->>'studioProgram' AS source FROM studio_package_releases WHERE id=$1 AND package->>'adapterVersion'=$2 AND package ? 'studioProgram' LIMIT 1",
          [id, version],
        );
        requireValue(release, 503, "缺少冻结的工作台程序");
        return this.unifiedAdapter(
          manifestSchema.parse(row.manifest),
          release.source,
        );
      }
      if (row.manifest.chat?.sandbox)
        return this.chatAdapter(manifestSchema.parse(row.manifest));
      if ([4, 5].includes(row.manifest.originalSubmission?.version)) {
        const release = await one(
          db,
          "SELECT package->>'studioProgram' AS source FROM studio_package_releases WHERE id=$1 AND package->>'adapterVersion'=$2 AND package ? 'studioProgram' LIMIT 1",
          [id, version],
        );
        requireValue(release, 503, "缺少冻结的工作台程序");
        return row.manifest.originalSubmission.version === 5
          ? this.requestAdapter(row.manifest, release.source)
          : nodeStudioPlugin(row.manifest, release.source);
      }
      if ((row.manifest.originalSubmission?.version ?? 0) >= 2)
        return portablePlugin(row.manifest);
      if (id === "edge-tts" && version === "1.0.0") {
        const { edgeTtsPlugin } = await import("./tts/edge-plugin.js");
        return edgeTtsPlugin;
      }
      await this.historical(id);
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