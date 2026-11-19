import type { CanvasModelRule } from "../../plugin-sdk/src/index.js";
import {
  listedStudioCatalog,
  studioPluginProfile,
} from "./studio-plugin-profile.js";
import type { Sql } from "./db.js";
import { requireValue } from "./security.js";

/** Declarative rules from the active catalog only; never inspect credentials or call providers. */
export class CanvasModels {
  private defaults = new Map<string, CanvasModelRule>();
  private models = new Map<string, CanvasModelRule>();
  constructor(
    rules: CanvasModelRule[],
    private readonly partialCatalog = false,
    private readonly incomplete = new Map<string, string>(),
  ) {
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
      partialCatalog ||
        (this.defaults.has("image") && this.defaults.has("video")),
      503,
      "原画布插件尚未完整启用",
    );
  }
  static async read(sql: Sql, options?: { allowIncomplete?: boolean }) {
    const allowIncomplete = options?.allowIncomplete ?? false;
    const rows = (
      await sql.query(`SELECT c.id,c.descriptor->>'kind' AS kind,v.manifest->'canvas' AS policy, v.manifest->'originalSubmission'->>'version' AS submission
      FROM ${await listedStudioCatalog(sql, "models")} c JOIN plugin_versions v ON v.id=c.plugin_id AND v.version=c.plugin_version
      WHERE c.descriptor->>'kind' IN ('image','video') ORDER BY c.position,c.id`)
    ).rows;
    const rules: CanvasModelRule[] = [];
    const incomplete = new Map<string, string>();
    for (const r of rows) {
      const rule = r.policy?.models?.find(
        (m: CanvasModelRule) => m.model === r.id && m.kind === r.kind,
      );
      if (rule) {
        rules.push(rule as CanvasModelRule);
      } else if (r.submission === "2" || r.submission === "3") {
        rules.push({ model: r.id, kind: r.kind });
      } else if (allowIncomplete) {
        incomplete.set(r.id, r.kind);
      } else {
        requireValue(rule, 503, "原画布插件尚未完整启用");
      }
    }
    return new CanvasModels(
      rules,
      allowIncomplete || Boolean(await studioPluginProfile(sql)),
      incomplete,
    );
  }
  validate(
    kind: string,
    params: { model: string; ratio: string; seconds: number },
  ) {
    if (kind !== "image" && kind !== "video") return;
    if (params.model && this.incomplete.has(params.model)) {
      requireValue(
        this.incomplete.get(params.model) === kind,
        400,
        "节点模型与生成类型不匹配",
      );
      requireValue(false, 503, "原画布插件尚未完整启用");
    }
    const rule = params.model
      ? this.models.get(params.model)
      : this.defaults.get(kind);
    if (!rule && !params.model && this.partialCatalog) return;
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
