import { hasStudioPackages } from "./studio-plugin-profile.js";
import { randomUUID } from "node:crypto";
import type { Platform, Actor } from "./platform.js";
import { one, type Sql } from "./db.js";
import { requireValue } from "./security.js";
import { capacity, JOB_RESERVE } from "./capacity.js";

/** Caller authorizes and validates the complete frozen input in this transaction. */
export async function acceptTask(
  p: Platform,
  sql: Sql,
  user: Actor,
  wid: string,
  model: any,
  input: {
    key: string;
    prompt: string;
    params: Record<string, any>;
    references: string[];
    [key: string]: any;
  },
  fingerprint: string,
  quote: { amount: number; key: string | null; revision: number | null },
  snapshots: unknown[] = [],
) {
  const installation =
    (await hasStudioPackages(sql)) &&
    (await one(
      sql,
      "SELECT installed,enabled,version FROM studio_packages WHERE id=$1 FOR SHARE",
      [model.plugin_id],
    ));
  requireValue(
    !installation || (installation.installed && installation.enabled),
    409,
    "插件已停用",
  );
  // The generic submission path also serves directly managed connections.
  // Serialize the final admission against address edits and package upgrades.
  const service = await one(
    sql,
    `SELECT c.enabled,c.plugin_version,c.config,to_jsonb(c)->>'sandbox_address_pause' AS pause
     FROM connections c WHERE id=$1 FOR SHARE`,
    [model.connection_id],
  );
  requireValue(
    !service?.pause,
    409,
    "此连接已暂停接收新任务，请联系管理员更新服务地址",
  );
  requireValue(
    service?.enabled &&
      service.plugin_version === model.plugin_version &&
      service.config === model.config,
    409,
    "服务配置已更新，请重试",
  );
  requireValue(
    !installation ||
      (
        await one(sql, "SELECT studio_service_selected($1,$2) AS ok", [
          model.catalog_id,
          model.connection_id,
        ])
      ).ok,
    409,
    "模型服务已切换",
  );
  const heldWallet = await one(
    sql,
    "UPDATE wallets SET held=held+$2 WHERE workspace_id=$1 AND balance-held>=$2 RETURNING balance,held",
    [wid, quote.amount],
  );
  requireValue(
    heldWallet,
    model.catalog_id ? 409 : 402,
    model.catalog_id
      ? `当前空间积分不足，需要 ${quote.amount} 积分`
      : "可用积分不足",
  );
  const id = randomUUID();
  if (model.kind !== "chat") await capacity(sql, p.storage, JOB_RESERVE);
  await sql.query(
    `INSERT INTO jobs(id,workspace_id,owner_id,model_id,connection_id,plugin_id,plugin_version,config_snapshot,provider_model,kind,input,idempotency_key,request_hash,price,catalog_id,price_key,price_revision,state,reference_packs)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'queued',$18)`,
    [
      id,
      wid,
      user.id,
      model.id,
      model.connection_id,
      model.plugin_id,
      model.plugin_version,
      model.config,
      model.provider_model,
      model.kind,
      JSON.stringify(input),
      input.key,
      fingerprint,
      quote.amount,
      model.catalog_id,
      quote.key,
      quote.revision,
      JSON.stringify(snapshots),
    ],
  );
  if (installation)
    await sql.query("UPDATE jobs SET package_version=$2 WHERE id=$1", [
      id,
      installation.version,
    ]);
  await sql.query(
    "INSERT INTO ledger(id,workspace_id,job_id,key,action,amount,actor_id,balance_snapshot,held_snapshot) VALUES($1,$2,$3,$4,'hold',$5,$6,$7,$8)",
    [
      randomUUID(),
      wid,
      id,
      "hold:" + id,
      quote.amount,
      user.id,
      heldWallet.balance,
      heldWallet.held,
    ],
  );
  for (const aid of new Set(input.references))
    await sql.query(
      "INSERT INTO job_assets(job_id,asset_id,role) VALUES($1,$2,'input')",
      [id, aid],
    );
  await sql.query("INSERT INTO job_events(job_id,state) VALUES($1,'queued')", [
    id,
  ]);
  await sql.query("INSERT INTO outbox(job_id) VALUES($1)", [id]);
  return { id };
}
