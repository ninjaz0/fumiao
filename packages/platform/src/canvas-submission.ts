import type { CanvasSubmissionRule } from "@fumiao/plugin-sdk/index.js";
import type { Sql } from "./db.js";
import { requireValue } from "./security.js";
import { listedStudioCatalog } from "./studio-plugin-profile.js";

export class CanvasSubmissionModels {
  constructor(readonly rules: Map<string, CanvasSubmissionRule>) {}
  static async read(sql: Sql, options?: { strict?: boolean }) {
    const strict = options?.strict ?? true;
    const rows = (
      await sql.query(`SELECT c.id,c.descriptor->>'kind' AS kind,v.manifest->'canvasSubmission' AS policy
      FROM ${await listedStudioCatalog(sql, "models")} c JOIN plugin_versions v ON v.id=c.plugin_id AND v.version=c.plugin_version
      WHERE COALESCE(v.manifest->'originalSubmission'->>'version','') NOT IN ('2','3') AND c.descriptor->>'kind' IN ('image','video','audio') ORDER BY c.position,c.id`)
    ).rows;
    const rules = new Map<string, CanvasSubmissionRule>();
    for (const r of rows) {
      const rule = r.policy?.models?.find(
        (m: CanvasSubmissionRule) => m.model === r.id && m.kind === r.kind,
      );
      if (!rule) {
        if (strict) requireValue(rule, 503, "原画布生成插件尚未完整启用");
        continue;
      }
      rules.set(r.id, rule);
    }
    return new CanvasSubmissionModels(rules);
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
  resolveAudio(preferredModel?: string) {
    if (preferredModel) {
      const explicit = this.rules.get(preferredModel);
      if (explicit && explicit.kind === "audio") return explicit.model;
    }
    const defaults = [...this.rules.values()].filter(
      (r) => r.kind === "audio" && r.defaultForKind,
    );
    if (defaults.length === 1) return defaults[0].model;
    const edge = this.rules.get("edge-tts");
    if (edge && edge.kind === "audio") return edge.model;
    const anyAudio = [...this.rules.values()].find((r) => r.kind === "audio");
    requireValue(anyAudio, 503, "音频配音服务尚未配置");
    return anyAudio.model;
  }
}
