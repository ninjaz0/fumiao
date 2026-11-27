import type {
  CanvasSubmissionRule,
  ProviderPlugin,
} from "@fumiao/plugin-sdk/index.js";
import {
  isBgmMusicModel,
  pickSpeechAudioModel,
} from "@fumiao/plugin-sdk/speech-routing.js";
import { one, type Sql } from "./db.js";
import { validator } from "./plugins.js";
import { requireValue } from "./security.js";
import { hasStudioPackages, listedStudioCatalog } from "./studio-plugin-profile.js";

export interface ReadCanvasSubmissionOptions {
  strict?: boolean;
  workspaceId?: string | null;
  vault?: { open(value: string): Record<string, unknown> };
  registry?: {
    resolve(sql: Sql, id: string, version: string): Promise<ProviderPlugin>;
  };
}

export class CanvasSubmissionModels {
  constructor(
    readonly rules: Map<string, CanvasSubmissionRule>,
    readonly enabledConnections: ReadonlySet<string> = new Set(),
    private readonly speechModelIds: ReadonlySet<string> = new Set(
      [...rules.values()]
        .filter((r) => r.kind === "audio" && !isBgmMusicModel(r.model))
        .map((r) => r.model),
    ),
    private readonly policyAllowedSpeechDefaults: ReadonlySet<string> = new Set(
      [...rules.values()]
        .filter(
          (r) =>
            r.kind === "audio" && r.defaultForKind && !isBgmMusicModel(r.model),
        )
        .map((r) => r.model),
    ),
  ) {}

  static async read(sql: Sql, options?: ReadCanvasSubmissionOptions) {
    const strict = options?.strict ?? true;
    const workspaceId = options?.workspaceId ?? null;
    const hasPackages = await hasStudioPackages(sql);
    const listedCatalog = await listedStudioCatalog(sql, "models");
    const rows = (
      await sql.query(`SELECT c.id,
                              c.plugin_id,
                              c.plugin_version,
                              c.descriptor,
                              c.descriptor->>'kind' AS kind,
                              v.manifest->'canvasSubmission' AS policy,
                              v.manifest AS manifest,
                              ${hasPackages ? "studio_plugin_accepts(c.plugin_id) AND " : ""}studio_model_allowed(c.id, $1::uuid) AS policy_allowed
                         FROM ${listedCatalog} c
                         JOIN plugin_versions v ON v.id=c.plugin_id AND v.version=c.plugin_version
                        WHERE (COALESCE(v.manifest->'originalSubmission'->>'version','') NOT IN ('2','3') OR c.descriptor->>'kind'='audio')
                          AND c.descriptor->>'kind' IN ('image','video','audio')
                        ORDER BY c.position,c.id`, [workspaceId])
    ).rows;

    const rules = new Map<string, CanvasSubmissionRule>();
    const speechModelIds = new Set<string>();
    const policyAllowedSpeechDefaults = new Set<string>();
    const manifestByCatalogId = new Map<string, any>();
    const pluginRefByCatalogId = new Map<
      string,
      { pluginId: string; pluginVersion: string; kind: string }
    >();

    for (const r of rows) {
      let rule = r.policy?.models?.find(
        (m: CanvasSubmissionRule) => m.model === r.id && m.kind === r.kind,
      );
      if (!rule && r.kind === "audio") {
        // Commercial/local/portable audio plugins (including v2/v3 without canvasSubmission) can be selected on canvas directly.
        rule = { model: r.id, kind: "audio", defaultForKind: false };
      }
      if (!rule) {
        if (strict) requireValue(rule, 503, "原画布生成插件尚未完整启用");
        continue;
      }
      rules.set(r.id, rule);
      manifestByCatalogId.set(r.id, r.manifest);
      pluginRefByCatalogId.set(r.id, {
        pluginId: String(r.plugin_id),
        pluginVersion: String(r.plugin_version),
        kind: String(r.kind),
      });
      if (r.kind === "audio" && !isBgmMusicModel(r.id, r.descriptor)) {
        speechModelIds.add(r.id);
        if (rule.defaultForKind && r.policy_allowed) {
          policyAllowedSpeechDefaults.add(r.id);
        }
      }
    }

    const pkgFilter = hasPackages
      ? "AND studio_plugin_accepts(sc.plugin_id) AND studio_plugin_accepts(c.plugin_id) AND studio_service_selected(m.catalog_id, c.id)"
      : "";
    const connRows = (
      await sql.query(
        `SELECT sc.id AS catalog_id,
                c.config AS config
           FROM ${listedCatalog} sc
           JOIN models m ON m.catalog_id = sc.id
           JOIN connections c ON c.id = m.connection_id
                             AND c.plugin_id = sc.plugin_id
                             AND c.plugin_version = sc.plugin_version
           LEFT JOIN model_permissions p
                  ON p.model_id = m.id
                 AND $1::uuid IS NOT NULL
                 AND p.workspace_id = $1::uuid
          WHERE m.catalog_id IS NOT NULL
            AND (m.catalog_id IS NOT NULL OR m.enabled)
            AND c.enabled = TRUE
            AND NOT c.removed
            AND COALESCE(p.enabled, TRUE) = TRUE
            ${pkgFilter}
            AND studio_model_allowed(sc.id, $1::uuid)
          ORDER BY c.id`,
        [workspaceId],
      )
    ).rows;

    const byCatalogId = new Map<string, string[]>();
    for (const row of connRows) {
      const cid = String(row.catalog_id);
      let list = byCatalogId.get(cid);
      if (!list) {
        list = [];
        byCatalogId.set(cid, list);
      }
      list.push(String(row.config ?? ""));
    }

    const enabledConnections = new Set<string>();
    const pluginCache = new Map<string, ProviderPlugin>();
    let cachedImageEnabled: boolean | undefined;

    for (const [cid, configs] of byCatalogId) {
      if (configs.length !== 1) continue;
      const manifest = manifestByCatalogId.get(cid);
      const pluginRef = pluginRefByCatalogId.get(cid);
      const isSpeech = speechModelIds.has(cid);
      if (options?.vault) {
        if (isSpeech) {
          let opened: Record<string, unknown>;
          try {
            opened = options.vault.open(configs[0]);
          } catch {
            continue;
          }
          if (
            (manifest?.originalSubmission?.version ?? 0) >= 2 &&
            manifest?.configSchema &&
            !validator.validate(manifest.configSchema, opened)
          ) {
            continue;
          }
          if (manifest?.requestLifecycle?.requireConfigured) {
            if (manifest.originalState && options.registry && pluginRef) {
              const cacheKey = `${pluginRef.pluginId}@${pluginRef.pluginVersion}`;
              let plugin = pluginCache.get(cacheKey);
              if (!plugin) {
                plugin = await options.registry.resolve(
                  sql,
                  pluginRef.pluginId,
                  pluginRef.pluginVersion,
                );
                pluginCache.set(cacheKey, plugin);
              }
              if (!plugin.originalState?.configured(opened)) continue;
              if (manifest.originalState.requiresImageEnabled) {
                if (cachedImageEnabled === undefined) {
                  const settingsRow = await one(
                    sql,
                    "SELECT image_enabled FROM original_state_settings",
                  );
                  cachedImageEnabled = Boolean(settingsRow?.image_enabled);
                }
                if (!cachedImageEnabled) continue;
              }
            } else if (!opened.baseUrl || !opened.apiKey) {
              continue;
            }
          }
        } else if (
          manifest?.originalSubmission?.version >= 2 &&
          manifest?.configSchema
        ) {
          try {
            const opened = options.vault.open(configs[0]);
            if (!validator.validate(manifest.configSchema, opened)) continue;
          } catch {
            continue;
          }
        }
      }
      enabledConnections.add(cid);
    }

    return new CanvasSubmissionModels(
      rules,
      enabledConnections,
      speechModelIds,
      policyAllowedSpeechDefaults,
    );
  }

  default(kind: string) {
    const candidates = [...this.rules.values()].filter(
      (r) => r.kind === kind && r.defaultForKind,
    );
    requireValue(
      candidates.length === 1,
      503,
      "画布默认生成模型缺失或存在歧义",
    );
    return candidates[0].model;
  }

  availableSpeechModels(): string[] {
    return [...this.speechModelIds].filter((id) =>
      this.enabledConnections.has(id),
    );
  }

  speechDefaultModelIds(): string[] {
    return [...this.rules.values()]
      .filter((r) => this.speechModelIds.has(r.model) && r.defaultForKind)
      .map((r) => r.model);
  }

  isSpeechModel(modelId: string): boolean {
    return this.speechModelIds.has(modelId);
  }

  hasEnabledAudio(modelId: string): boolean {
    return (
      this.speechModelIds.has(modelId) && this.enabledConnections.has(modelId)
    );
  }

  resolveAudio(preferredModel?: string) {
    const defaultIds = this.speechDefaultModelIds();
    const chosen = pickSpeechAudioModel({
      preferredModel,
      availableSpeechIds: this.availableSpeechModels(),
      defaultModelIds: defaultIds,
    });
    if (chosen) return chosen;

    // Preserve legacy connection-level 503 error message when default audio model is policy-allowed without an active connection
    const allowedDefaults = defaultIds.filter((id) =>
      this.policyAllowedSpeechDefaults.has(id),
    );
    if (!preferredModel && allowedDefaults.length === 1) {
      return allowedDefaults[0];
    }
    requireValue(false, 503, "音频配音服务尚未配置");
    throw new Error("音频配音服务尚未配置");
  }
}
