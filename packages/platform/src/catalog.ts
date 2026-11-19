import type { Database, Sql } from "./db.js";
import { one } from "./db.js";
import { requireValue } from "./security.js";
import type { Manifest, StudioModel } from "../../plugin-sdk/src/index.js";
import { matcher } from "./schema.js";

/** Registers public UI and billing data only from immutable, versioned plugin manifests. */
export async function registerStudioModels(
  sql: Sql,
  manifest: Manifest,
  bump: boolean,
) {
  const specs = manifest.models.filter((m) => m.studio);
  if (!specs.length) return;
  await sql.query("SELECT * FROM studio_policy FOR UPDATE");
  const additions: Record<string, boolean> = Object.create(null);
  for (const model of specs) {
    const data = model.studio!;
    requireValue(
      data.descriptor.kind === model.kind,
      400,
      "插件目录模型类型不一致",
    );
    requireValue(
      new Set(data.prices.map((p) => p.tier)).size === data.prices.length,
      400,
      "插件计费档位重复",
    );
    for (const tier of data.prices) matcher.compile(tier.match);
    const existing = await one(
      sql,
      "SELECT plugin_id,plugin_version FROM studio_catalog WHERE id=$1",
      [model.id],
    );
    if (existing) {
      requireValue(
        existing.plugin_id === manifest.id,
        409,
        "公开模型编号已由其他插件注册",
      );
      continue;
    }
    const hidden = !!(model.hidden || data.descriptor.hidden);
    await sql.query(
      "INSERT INTO studio_catalog(id,plugin_id,plugin_version,descriptor,runtime,position,price_position,hidden) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        model.id,
        manifest.id,
        manifest.version,
        JSON.stringify(data.descriptor),
        JSON.stringify(data.runtime || {}),
        data.order,
        data.priceOrder,
        hidden,
      ],
    );
    for (const [index, tier] of data.prices.entries())
      await sql.query(
        "INSERT INTO studio_prices(key,model_id,tier,label,position,matcher,amount) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          model.id + "|" + tier.tier,
          model.id,
          tier.tier,
          tier.label,
          index,
          JSON.stringify(tier.match),
          tier.amount,
        ],
      );
    additions[model.id] = !hidden;
  }
  if (Object.keys(additions).length) {
    await sql.query(
      "UPDATE studio_policy SET flags=flags||$1::jsonb,revision=revision+$2,price_revision=price_revision+$2",
      [JSON.stringify(additions), bump ? 1 : 0],
    );
    await sql.query(
      "UPDATE studio_workspace_policy SET flags=$1::jsonb||flags,revision=revision+1",
      [JSON.stringify(additions)],
    );
  }
  // A family is a single control in the original UI, so its kind cannot be ambiguous.
  const all = (
      await sql.query("SELECT id,descriptor,hidden FROM studio_catalog")
    ).rows,
    groups = new Map<string, string>();
  for (const row of all.filter((r) => !r.hidden)) {
    const family = row.descriptor.family || row.id,
      kind = row.descriptor.kind;
    requireValue(
      !groups.has(family) || groups.get(family) === kind,
      400,
      "模型分组不能混用生成类型",
    );
    groups.set(family, kind);
  }
}
export class StudioCatalog {
  constructor(readonly db: Database) {}
  /** Explicit activation changes future submissions; accepted jobs keep immutable snapshots. */
  async activate(sql: Sql, manifest: Manifest) {
    await sql.query("SELECT pg_advisory_xact_lock(hashtext('studio-catalog'))");
    await sql.query("SELECT * FROM studio_policy FOR UPDATE");
    const existing = (
      await sql.query(
        "SELECT * FROM studio_catalog WHERE plugin_id=$1 FOR UPDATE",
        [manifest.id],
      )
    ).rows;
    const specs = manifest.models.filter((m) => m.studio);
    requireValue(
      existing.every((row) => specs.some((m) => m.id === row.id)),
      409,
      "目录升级必须保留已有模型编号；停用模型请标记隐藏",
    );
    if (
      existing.length &&
      existing.every((row) => row.plugin_version === manifest.version)
    )
      return;
    const disabled: Record<string, boolean> = Object.create(null);
    for (const model of specs) {
      const data = model.studio!,
        row = existing.find((r) => r.id === model.id);
      requireValue(
        row && row.descriptor.kind === model.kind,
        409,
        "目录升级不能改变已有模型的生成类型",
      );
      const hidden = !!(
        row.hidden_override ||
        model.hidden ||
        data.descriptor.hidden
      );
      await sql.query(
        "UPDATE studio_catalog SET plugin_version=$2,descriptor=$3,runtime=$4,position=$5,price_position=$6,hidden=$7 WHERE id=$1",
        [
          model.id,
          manifest.version,
          JSON.stringify(data.descriptor),
          JSON.stringify(data.runtime || {}),
          data.order,
          data.priceOrder,
          hidden,
        ],
      );
      for (const [position, tier] of data.prices.entries())
        await sql.query(
          "INSERT INTO studio_prices(key,model_id,tier,label,position,matcher,amount) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(key) DO UPDATE SET label=excluded.label,position=excluded.position,matcher=excluded.matcher",
          [
            model.id + "|" + tier.tier,
            model.id,
            tier.tier,
            tier.label,
            position,
            JSON.stringify(tier.match),
            tier.amount,
          ],
        );
      await sql.query(
        "DELETE FROM studio_prices WHERE model_id=$1 AND NOT(tier=ANY($2::text[]))",
        [model.id, data.prices.map((t) => t.tier)],
      );
      if (hidden) disabled[model.id] = false;
    }
    await sql.query(
      "UPDATE studio_policy SET flags=flags||$1::jsonb,revision=revision+1,price_revision=price_revision+1",
      [JSON.stringify(disabled)],
    );
    await sql.query(
      "UPDATE studio_workspace_policy SET flags=flags||$1::jsonb,revision=revision+1",
      [JSON.stringify(disabled)],
    );
    await registerStudioModels(sql, manifest, false);
  }
  async catalog(
    sql: Sql = this.db,
  ): Promise<Record<string, StudioModel["descriptor"] & { hidden: boolean }>> {
    const rows = (
      await sql.query("SELECT * FROM studio_catalog ORDER BY position,id")
    ).rows;
    return Object.fromEntries(
      rows.map((r) => [r.id, { ...r.descriptor, hidden: r.hidden }]),
    );
  }
  async groups(sql: Sql = this.db) {
    const groups: Record<
      string,
      { kind: string; label: string; models: string[] }
    > = Object.create(null);
    for (const [id, spec] of Object.entries(await this.catalog(sql))) {
      if (spec.hidden) continue;
      const key = spec.family || id;
      const group = (groups[key] ||= {
        kind: spec.kind,
        label: spec.family_label || spec.label,
        models: [],
      });
      group.models.push(id);
    }
    return { ...groups };
  }
  async runtime(mode: "request" | "pull", sql: Sql = this.db) {
    const rows = (
      await sql.query(
        "SELECT c.id,c.runtime FROM studio_catalog c JOIN plugin_versions v ON v.id=c.plugin_id AND v.version=c.plugin_version WHERE v.manifest->>'mode'=$1 AND c.runtime<>'{}'::jsonb ORDER BY c.position,c.id",
        [mode],
      )
    ).rows;
    return Object.fromEntries(rows.map((r) => [r.id, r.runtime]));
  }
  async policy(sql: Sql = this.db) {
    const row = await one(sql, "SELECT revision,flags FROM studio_policy");
    return { revision: row.revision, enabled: row.flags };
  }
  async teamPolicy(sql: Sql, wid: string) {
    const row = await one(
      sql,
      "SELECT revision,flags FROM studio_workspace_policy WHERE workspace_id=$1",
      [wid],
    );
    return row
      ? { revision: row.revision, enabled: row.flags }
      : {
          revision: 0,
          enabled: Object.fromEntries(
            Object.entries(await this.catalog(sql)).map(([id, spec]) => [
              id,
              !spec.hidden,
            ]),
          ),
        };
  }
  async effective(sql: Sql, wid: string) {
    return Object.fromEntries(
      (
        await sql.query(
          "SELECT id,studio_model_allowed(id,$1) AS enabled FROM studio_catalog ORDER BY position,id",
          [wid],
        )
      ).rows.map((r) => [r.id, r.enabled]),
    );
  }
  async prices(sql: Sql = this.db) {
    // A single statement keeps the amount list and revision in the same snapshot.
    const rows = (
      await sql.query(
        "SELECT p.*,c.descriptor,g.price_revision FROM studio_policy g LEFT JOIN studio_prices p ON true LEFT JOIN studio_catalog c ON c.id=p.model_id ORDER BY c.price_position,p.position,p.key",
      )
    ).rows;
    return {
      revision: rows[0].price_revision,
      items: rows
        .filter((r) => r.key !== null)
        .map((r) => ({
          key: r.key,
          model: r.model_id,
          kind: r.descriptor.kind,
          tier: r.tier,
          label: r.label,
          amount: r.amount === null ? null : Number(r.amount),
        })),
    };
  }
  async savePrices(
    sql: Sql,
    values: Record<string, number | null>,
    expected: number,
  ) {
    const global = await one(
      sql,
      "SELECT price_revision FROM studio_policy FOR UPDATE",
    );
    requireValue(
      global.price_revision === expected,
      409,
      "价格已更新，请刷新后重试",
    );
    const keys = (await sql.query("SELECT key FROM studio_prices")).rows.map(
      (r) => r.key,
    );
    requireValue(
      keys.length === Object.keys(values).length &&
        keys.every((key) => Object.hasOwn(values, key)),
      400,
      "定价档位不完整",
    );
    requireValue(
      Object.values(values).every(
        (v) =>
          v === null || (Number.isSafeInteger(v) && v >= 1 && v <= 1000000000),
      ),
      400,
      "价格需为正整数，留空表示尚未定价",
    );
    for (const key of keys)
      await sql.query("UPDATE studio_prices SET amount=$2 WHERE key=$1", [
        key,
        values[key],
      ]);
    await sql.query("UPDATE studio_policy SET price_revision=price_revision+1");
    return this.prices(sql);
  }
  async savePolicy(
    sql: Sql,
    input: {
      model: string;
      enabled: boolean;
      group: boolean;
      expected_revision: number;
      workspace: number | null;
    },
  ) {
    const global = await one(
      sql,
      input.workspace === null
        ? "SELECT * FROM studio_policy FOR UPDATE"
        : "SELECT * FROM studio_policy FOR SHARE",
    );
    const catalog = await this.catalog(sql);
    let members: string[];
    if (input.group) {
      members = (await this.groups(sql))[input.model]?.models || [];
      requireValue(members?.length, 400, "未知模型");
    } else {
      requireValue(Object.hasOwn(catalog, input.model), 400, "未知模型");
      requireValue(
        !(catalog[input.model].hidden && input.enabled),
        400,
        "该模型已隐藏",
      );
      members = [input.model];
    }
    // Lock order is global policy then workspace; submission takes compatible shared locks.
    let policy: { revision: number; enabled: Record<string, boolean> };
    if (input.workspace !== null) {
      const team = await one(
        sql,
        "SELECT id FROM workspaces WHERE public_id=$1 AND kind='team' FOR UPDATE",
        [input.workspace],
      );
      requireValue(team, 404, "团队不存在");
      const current = await this.teamPolicy(sql, team.id);
      requireValue(
        current.revision === input.expected_revision,
        409,
        "团队模型设置已更新，请刷新后重试",
      );
      for (const id of members) current.enabled[id] = input.enabled;
      current.revision++;
      await sql.query(
        "INSERT INTO studio_workspace_policy(workspace_id,flags,revision) VALUES($1,$2,$3) ON CONFLICT(workspace_id) DO UPDATE SET flags=excluded.flags,revision=excluded.revision",
        [team.id, JSON.stringify(current.enabled), current.revision],
      );
      policy = current;
    } else {
      requireValue(
        global.revision === input.expected_revision,
        409,
        "模型设置已更新，请刷新后重试",
      );
      const flags = { ...global.flags };
      for (const id of members) flags[id] = input.enabled;
      for (const [id, spec] of Object.entries(catalog))
        if (spec.hidden) flags[id] = false;
      await sql.query("UPDATE studio_policy SET flags=$1,revision=revision+1", [
        JSON.stringify(flags),
      ]);
      policy = { revision: global.revision + 1, enabled: flags };
    }
    const flags = input.workspace === null ? policy.enabled : global.flags;
    return {
      policy,
      image_enabled: Object.entries(catalog).some(
        ([id, spec]) => spec.kind === "image" && !spec.hidden && flags[id],
      ),
    };
  }
  async quote(
    sql: Sql,
    model: Record<string, any>,
    workspace: string,
    params: Record<string, unknown>,
    expected?: number | bigint,
  ) {
    const global = await one(
      sql,
      "SELECT price_revision FROM studio_policy FOR SHARE",
    );
    const catalog = await one(
      sql,
      "SELECT * FROM studio_catalog WHERE id=$1 FOR SHARE",
      [model.catalog_id],
    );
    requireValue(
      catalog &&
        catalog.plugin_id === model.plugin_id &&
        catalog.plugin_version === model.plugin_version,
      409,
      "连接版本与模型目录不一致，请升级连接",
    );
    await sql.query("SELECT id FROM workspaces WHERE id=$1 FOR SHARE", [
      workspace,
    ]);
    requireValue(
      (
        await one(sql, "SELECT studio_model_allowed($1,$2) AS allowed", [
          model.catalog_id,
          workspace,
        ])
      ).allowed,
      403,
      "当前空间未开放该模型，请选择其他模型",
    );
    requireValue(
      expected === undefined || expected === global.price_revision,
      409,
      "积分价格已更新，请确认新价格后重新提交",
    );
    const tiers = (
      await sql.query("SELECT * FROM studio_prices WHERE model_id=$1", [
        model.catalog_id,
      ])
    ).rows.filter((p) => matcher.validate(p.matcher, params));
    requireValue(tiers.length === 1, 400, "模型计费档位无效");
    requireValue(
      tiers[0].amount !== null,
      409,
      "这个档位尚未定价，请联系管理员",
    );
    return {
      amount: Number(tiers[0].amount),
      key: tiers[0].key,
      revision: global.price_revision,
    };
  }
}
