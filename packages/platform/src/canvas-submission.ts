import type { CanvasSubmissionRule } from "@fumiao/plugin-sdk/index.js";
import type { Sql } from "./db.js";
import { requireValue } from "./security.js";
import { hasStudioPackages, listedStudioCatalog } from "./studio-plugin-profile.js";

export class CanvasSubmissionModels {
  constructor(
    readonly rules: Map<string, CanvasSubmissionRule>,
    readonly enabledConnections: ReadonlySet<string> = new Set(),
  ) {}
  static async read(sql: Sql, options?: { strict?: boolean }) {
    const strict = options?.strict ?? true;
    const rows = (
      await sql.query(`SELECT c.id,c.descriptor->>'kind' AS kind,v.manifest->'canvasSubmission' AS policy
      FROM ${await listedStudioCatalog(sql, "models")} c JOIN plugin_versions v ON v.id=c.plugin_id AND v.version=c.plugin_version
      WHERE (COALESCE(v.manifest->'originalSubmission'->>'version','') NOT IN ('2','3') OR c.descriptor->>'kind'='audio')
        AND c.descriptor->>'kind' IN ('image','video','audio')
      ORDER BY c.position,c.id`)
    ).rows;
    const rules = new Map<string, CanvasSubmissionRule>();
    for (const r of rows) {
      let rule = r.policy?.models?.find(
        (m: CanvasSubmissionRule) => m.model === r.id && m.kind === r.kind,
      );
      if (!rule && r.kind === "audio") {
        // Commercial/local audio plugins (e.g. OpenAI TTS / Piper / CosyVoice) can be selected on canvas directly.
        rule = { model: r.id, kind: "audio", defaultForKind: false };
      }
      if (!rule) {
        if (strict) requireValue(rule, 503, "原画布生成插件尚未完整启用");
        continue;
      }
      rules.set(r.id, rule);
    }
    const pkgFilter = (await hasStudioPackages(sql))
      ? "AND studio_plugin_accepts(c.plugin_id) AND studio_service_selected(m.catalog_id, c.id)"
      : "";
    const connRows = (
      await sql.query(
        `SELECT DISTINCT m.catalog_id
           FROM models m
           JOIN connections c ON c.id = m.connection_id
          WHERE m.catalog_id IS NOT NULL
            AND c.enabled = TRUE
            AND NOT c.removed
            ${pkgFilter}`,
      )
    ).rows;
    const enabledConnections = new Set<string>(
      connRows.map((r) => String(r.catalog_id)),
    );
    return new CanvasSubmissionModels(rules, enabledConnections);
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
  hasEnabledAudio(modelId: string): boolean {
    const rule = this.rules.get(modelId);
    return Boolean(rule && rule.kind === "audio" && this.enabledConnections.has(modelId));
  }
  resolveAudio(preferredModel?: string) {
    if (preferredModel) {
      const explicit = this.rules.get(preferredModel);
      if (explicit && explicit.kind === "audio") return explicit.model;
    }
    const defaults = [...this.rules.values()].filter(
      (r) => r.kind === "audio" && r.defaultForKind,
    );
    const activeDefaults = defaults.filter((r) =>
      this.enabledConnections.has(r.model),
    );
    if (activeDefaults.length === 1) return activeDefaults[0].model;
    const edge = this.rules.get("edge-tts");
    if (edge && edge.kind === "audio" && this.enabledConnections.has("edge-tts")) {
      return edge.model;
    }
    const anyActiveAudio = [...this.rules.values()].find(
      (r) => r.kind === "audio" && this.enabledConnections.has(r.model),
    );
    if (anyActiveAudio) return anyActiveAudio.model;
    // Preserve exact default/audio error behavior if catalog entry exists without an active connection
    if (defaults.length === 1) return defaults[0].model;
    requireValue(false, 503, "音频配音服务尚未配置");
    throw new Error("音频配音服务尚未配置");
  }
}
