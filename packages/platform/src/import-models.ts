import type { Sql } from "./db.js";
import { one } from "./db.js";
import { requireValue } from "./security.js";
/** Restore only non-secret original settings, atomically with identity and financial data. */
export async function importModelSettings(
  sql: Sql,
  tables: Record<string, Record<string, any>[]>,
  workspace: (n: number) => string,
) {
  const settings = Object.fromEntries(
    (tables.model_settings || []).map((row) => {
      requireValue(
        ["model_policy", "hidden_model_ids", "credit_price_revision"].includes(
          row.key,
        ),
        400,
        "迁移设置不在允许列表",
      );
      return [row.key, JSON.parse(row.value)];
    }),
  );
  requireValue(
    settings.model_policy &&
      Number.isSafeInteger(settings.model_policy.revision) &&
      settings.model_policy.revision >= 1 &&
      Number.isSafeInteger(settings.credit_price_revision) &&
      settings.credit_price_revision >= 1,
    400,
    "导出文件缺少模型策略或价格修订，请重新导出",
  );
  const catalog = (await sql.query("SELECT id,descriptor FROM studio_catalog"))
    .rows;
  const validFlags = (flags: unknown) =>
    !!flags &&
    typeof flags === "object" &&
    !Array.isArray(flags) &&
    Object.keys(flags).length === catalog.length &&
    catalog.every((r) => typeof (flags as any)[r.id] === "boolean");
  requireValue(
    validFlags(settings.model_policy.enabled),
    400,
    "旧模型策略与插件目录不一致",
  );
  const hidden = settings.hidden_model_ids || [];
  requireValue(
    Array.isArray(hidden) && hidden.every((id) => typeof id === "string"),
    400,
    "旧隐藏模型设置无效",
  );
  for (const row of catalog)
    await sql.query(
      "UPDATE studio_catalog SET hidden_override=$2,hidden=hidden OR $2 WHERE id=$1",
      [row.id, hidden.includes(row.id)],
    );
  await sql.query(
    "UPDATE studio_policy SET flags=$1,revision=$2,price_revision=$3",
    [
      JSON.stringify(settings.model_policy.enabled),
      settings.model_policy.revision,
      settings.credit_price_revision,
    ],
  );
  for (const row of tables.workspace_model_policy || []) {
    const flags = JSON.parse(row.flags);
    requireValue(
      validFlags(flags) &&
        Number.isSafeInteger(row.revision) &&
        row.revision >= 1,
      400,
      "旧团队模型策略无效",
    );
    requireValue(
      await one(sql, "SELECT id FROM workspaces WHERE id=$1 AND kind='team'", [
        workspace(row.workspace),
      ]),
      400,
      "旧模型策略所属团队不存在",
    );
    await sql.query(
      "INSERT INTO studio_workspace_policy(workspace_id,flags,revision) VALUES($1,$2,$3)",
      [workspace(row.workspace), JSON.stringify(flags), row.revision],
    );
  }
  const prices = tables.credit_prices || [],
    keys = (await sql.query("SELECT key FROM studio_prices")).rows.map(
      (r) => r.key,
    );
  requireValue(
    new Set(prices.map((p) => p.key)).size === keys.length &&
      prices.length === keys.length &&
      keys.every((k) => prices.some((p) => p.key === k)),
    400,
    "旧定价档位与插件目录不一致",
  );
  for (const price of prices) {
    requireValue(
      price.amount === null ||
        (Number.isSafeInteger(price.amount) &&
          price.amount >= 1 &&
          price.amount <= 1000000000),
      400,
      "旧价格数值无效",
    );
    await sql.query("UPDATE studio_prices SET amount=$2 WHERE key=$1", [
      price.key,
      price.amount,
    ]);
  }
}
