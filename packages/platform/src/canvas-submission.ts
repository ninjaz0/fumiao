import type { CanvasSubmissionRule } from "../../plugin-sdk/src/index.js";
import type { Sql } from "./db.js";
import { requireValue } from "./security.js";
export class CanvasSubmissionModels {
  constructor(readonly rules: Map<string, CanvasSubmissionRule>) {}
  static async read(sql: Sql) {
    const rows = (
      await sql.query(`SELECT c.id,c.descriptor->>'kind' AS kind,v.manifest->'canvasSubmission' AS policy
      FROM studio_catalog c JOIN plugin_versions v ON v.id=c.plugin_id AND v.version=c.plugin_version
      WHERE c.descriptor->>'kind' IN ('image','video','audio') ORDER BY c.position,c.id`)
    ).rows;
    const rules = new Map<string, CanvasSubmissionRule>();
    for (const r of rows) {
      const rule = r.policy?.models.find(
        (m: CanvasSubmissionRule) => m.model === r.id && m.kind === r.kind,
      );
      requireValue(rule, 503, "原画布生成插件尚未完整启用");
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
}
