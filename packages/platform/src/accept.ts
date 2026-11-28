import type { FrozenModelRoute } from "./model-access/publication.js";
import { hasStudioPackages } from "./studio-plugin-profile.js";
import { randomUUID } from "node:crypto";
import type { Platform, Actor } from "./platform.js";
import { one, type Sql } from "./db.js";
import { requireValue } from "./security.js";
import { capacity, JOB_RESERVE } from "./capacity.js";
import { checkAndRecordBudget } from "./budgets.js";
import {
  enforceAgentPolicyInTx,
  recordAgentProposalExecution,
} from "./agent-policy.js";

export type AcceptTaskMeta = {
  projectId?: string | null;
  nodeId?: string | null;
  executionKey?: string | null;
  tailParentJobId?: string | null;
};

async function checkPlugin(sql: Sql, model: any) {
  const installation =
    (await hasStudioPackages(sql)) &&
    (await one(
      sql,
      `SELECT p.installed,p.enabled,p.version,r.package->>'adapterVersion' AS adapter_version
        FROM studio_packages p JOIN studio_package_releases r USING(id,version) WHERE p.id=$1 FOR SHARE OF p`,
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
      service.config === model.config &&
      (!installation || installation.adapter_version === model.plugin_version),
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
  return installation;
}

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
  quote: {
    amount: number | string;
    key: string | null;
    revision: number | null;
  },
  snapshots: unknown[] = [],
  meta?: AcceptTaskMeta,
  nativeRoute?: FrozenModelRoute,
) {
  const installation = nativeRoute ? null : await checkPlugin(sql, model);
  const projectId =
    meta?.projectId ??
    (typeof input.project_id === "string"
      ? input.project_id
      : typeof input.projectId === "string"
        ? input.projectId
        : null);
  const nodeId = meta?.nodeId ?? null;
  const executionKey = meta?.executionKey ?? input.key;
  // F031: Authoritative in-transaction Agent execution policy check BEFORE holding wallet funds.
  const verifiedProposal =
    user.tokenId || user.agentAction
      ? await enforceAgentPolicyInTx(sql, wid, {
          projectId,
          nodeId,
          amount: quote.amount,
          executionKey,
          approvedProposalId: user.agentAction?.approvedProposalId ?? null,
        })
      : null;
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
  // F015: Atomic 3-stage budget control while holding the workspace wallet lock.
  await checkAndRecordBudget(sql, {
    workspaceId: wid,
    projectId,
    amount: quote.amount,
  });
  const id = randomUUID();
  if (model.kind !== "chat") await capacity(sql, p.storage, JOB_RESERVE);
  await sql.query(
    `INSERT INTO jobs(id,workspace_id,owner_id,model_id,connection_id,plugin_id,plugin_version,config_snapshot,provider_model,kind,input,idempotency_key,request_hash,price,catalog_id,price_key,price_revision,state,reference_packs${nativeRoute ? ",source_kind,route_revision_id,price_revision_id,native_snapshot,meter" : ""})
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'queued',$18${nativeRoute ? ",'builtin',$19,$20,$21,$22" : ""})`,
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
      ...(nativeRoute
        ? [
            nativeRoute.routeRevisionId,
            nativeRoute.priceRevisionId,
            JSON.stringify(nativeRoute),
            nativeRoute.purpose === "image" ? "images" : "milliseconds",
          ]
        : []),
    ],
  );
  if (installation)
    await sql.query("UPDATE jobs SET package_version=$2 WHERE id=$1", [
      id,
      installation.version,
    ]);
  if (meta?.projectId) {
    const hasJobProjects = await one(
      sql,
      "SELECT to_regclass('job_projects') IS NOT NULL AS ok",
    );
    if (hasJobProjects?.ok) {
      await sql.query(
        "INSERT INTO job_projects(job_id, project_id) VALUES($1, $2) ON CONFLICT DO NOTHING",
        [id, meta.projectId],
      );
    }
  }
  await recordAgentProposalExecution(sql, verifiedProposal, id);
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
