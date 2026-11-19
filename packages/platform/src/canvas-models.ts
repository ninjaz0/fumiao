import type { CanvasModelRule } from "../../plugin-sdk/src/index.js";
import type { Sql } from "./db.js";
import { requireValue } from "./security.js";

/** Declarative rules from the active catalog only; never inspect credentials or call providers. */
export class CanvasModels {
  private defaults = new Map<string, CanvasModelRule>();
  private models = new Map<string, CanvasModelRule>();
  constructor(rules: CanvasModelRule[]) {
    for (const rule of rules) {
      requireValue(!this.models.has(rule.model), 503, "画布模型规则存在歧义");
      this.models.set(rule.model, rule);
      if (rule.defaultForKind) {
        requireValue(
          !this.defaults.has(rule.kind),
          503,
          "画布默认模型存在歧义",
        );
        this.defaults.set(rule.kind, rule);
      }
    }
    requireValue(
      this.defaults.has("image") && this.defaults.has("video"),
      503,
      "原画布插件尚未完整启用",
    );
  }
  static async read(sql: Sql) {
    const rows = (
      await sql.query(`SELECT c.id,c.descriptor->>'kind' AS kind,v.manifest->'canvas' AS policy
      FROM studio_catalog c JOIN plugin_versions v ON v.id=c.plugin_id AND v.version=c.plugin_version
      WHERE c.descriptor->>'kind' IN ('image','video') ORDER BY c.position,c.id`)
    ).rows;
    const rules = rows.map((r) => {
      const rule = r.policy?.models.find(
        (m: CanvasModelRule) => m.model === r.id && m.kind === r.kind,
      );
      requireValue(rule, 503, "原画布插件尚未完整启用");
      return rule as CanvasModelRule;
    });
    return new CanvasModels(rules);
  }
  validate(
    kind: string,
    params: { model: string; ratio: string; seconds: number },
  ) {
    if (kind !== "image" && kind !== "video") return;
    const rule = params.model
      ? this.models.get(params.model)
      : this.defaults.get(kind);
    requireValue(rule?.kind === kind, 400, "节点模型与生成类型不匹配");
    if (rule.ratios)
      requireValue(
        rule.ratios.values.includes(params.ratio),
        400,
        rule.ratios.error,
      );
    if (rule.durations)
      requireValue(
        rule.durations.values.includes(params.seconds),
        400,
        rule.durations.error,
      );
  }
  template(flags: Record<string, boolean>): string {
    return (
      [...this.models.values()]
        .filter(
          (r) =>
            r.templatePriority !== undefined &&
            Object.hasOwn(flags, r.model) &&
            flags[r.model],
        )
        .sort(
          (a, b) =>
            a.templatePriority! - b.templatePriority! ||
            a.model.localeCompare(b.model),
        )[0]?.model ?? ""
    );
  }
}
