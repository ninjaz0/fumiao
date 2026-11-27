import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { one, type Sql } from "../db.js";
import type { Actor, Platform } from "../platform.js";
import { requireValue } from "../security.js";
import {
  originalModelSnapshots,
  resolveConnectionRevision,
  type CredentialScope,
  type DraftRow,
  type Protocol,
} from "./connections.js";
import type { Purpose } from "./discovery.js";

import type { PublishedPrice } from "./published-routes.js";
export {
  resolvePublishedRoute,
  type PublishedPrice,
} from "./published-routes.js";
export interface FrozenModelRoute {
  catalogId: string;
  modelId: string;
  connectionId: string;
  routeRevisionId: string;
  connectionRevisionId: string;
  upstreamId: string;
  purpose: Purpose;
  protocol: Protocol;
  executorVersion: 1;
  capabilities: DraftRow["selection"]["parameters"];
  priceRevisionId: string;
  price: PublishedPrice;
}

const label = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[^\u0000-\u001f\u007f]+$/);
const selected = z
  .object({
    draft_id: z.uuid(),
    draft_revision: z.number().int().positive(),
    action: z.enum(["create", "standby", "activate"]),
    catalog_id: z.string().min(1).max(512).optional(),
    expected_revision: z.number().int().nonnegative().optional(),
    label: label.optional(),
    replace_price: z.boolean().optional(),
  })
  .strict()
  .refine((item) =>
    item.action === "create"
      ? item.catalog_id === undefined &&
        item.expected_revision === undefined &&
        item.replace_price === undefined
      : !!item.catalog_id &&
        item.expected_revision !== undefined &&
        (item.action === "activate" || !item.replace_price) &&
        item.label === undefined,
  );
const activateRoute = z
  .object({
    action: z.literal("activate"),
    catalog_id: z.string().min(1).max(512),
    expected_revision: z.number().int().positive(),
    route_revision_id: z.uuid(),
  })
  .strict();
const request = z
  .object({
    uid: z.uuid(),
    items: z
      .array(z.union([selected, activateRoute]))
      .min(1)
      .max(256),
  })
  .strict();

async function requireAdoptable(
  sql: Sql,
  draft: DraftRow,
  catalog: Record<string, any>,
) {
  const source = await one(
    sql,
    `SELECT reuse.*,c.revision,c.plugin_id,(c.enabled AND studio_plugin_accepts(c.plugin_id)) AS enabled,c.removed FROM model_access_reused_connections reuse
    JOIN connections c ON c.id=reuse.original_id WHERE reuse.connection_id=$1 FOR SHARE OF c`,
    [draft.connection_id],
  );
  requireValue(
    source &&
      !source.removed &&
      source.enabled &&
      source.revision === source.original_revision &&
      draft.upstream_id === catalog.id &&
      catalog.plugin_id === source.plugin_id &&
      source.original_models[catalog.id],
    409,
    "原连接、模型或修订已变化，请重新复用连接",
  );
  const snapshots = await originalModelSnapshots(
    sql,
    [catalog.id],
    catalog.plugin_id,
  );
  requireValue(
    isDeepStrictEqual(
      snapshots[catalog.id],
      source.original_models[catalog.id],
    ),
    409,
    "原模型或售价已更新",
  );
}

function routeScopeAllows(
  scope: CredentialScope,
  protocol: Protocol,
  upstream: string,
) {
  const endpoint = {
    "openai-chat": "chat/completions",
    "openai-images": "images/generations",
    "openrouter-images": "images",
    "new-api-videos": "videos",
    "openrouter-videos": "videos",
  } as const;
  return (
    scope.endpoints.includes(endpoint[protocol]) &&
    (scope.upstream_ids === null || scope.upstream_ids.includes(upstream))
  );
}

async function publishOne(
  p: Platform,
  sql: Sql,
  catalogId: string,
  item: z.infer<typeof selected>,
) {
  // Draft saves lock their connection first. Keep the same order while publishing.
  const conn = await one(
    sql,
    `SELECT c.revision,c.enabled,c.removed,r.id,r.credential_scope FROM connections c
    JOIN model_access_connection_revisions r ON r.connection_id=c.id AND r.revision=c.revision
    JOIN model_access_drafts d ON d.connection_id=c.id WHERE d.id=$1 FOR SHARE OF c`,
    [item.draft_id],
  );
  const draft = (
    await sql.query<DraftRow>(
      `SELECT * FROM model_access_drafts WHERE id=$1 FOR SHARE`,
      [item.draft_id],
    )
  ).rows[0];
  requireValue(
    draft && draft.revision === item.draft_revision,
    409,
    "草稿修订已更新",
  );
  requireValue(
    conn &&
      conn.enabled &&
      !conn.removed &&
      conn.revision === draft.connection_revision,
    409,
    "连接已更新或停止接单",
  );
  const { purpose, protocol, parameters, missing, price, chat_prices } =
    draft.selection;
  const existing = await one(
    sql,
    "SELECT * FROM model_access_publications WHERE catalog_id=$1 FOR UPDATE",
    [catalogId],
  );
  const catalog = await one(
    sql,
    "SELECT * FROM studio_catalog WHERE id=$1 FOR UPDATE",
    [catalogId],
  );
  requireValue(
    item.action === "create" ? !catalog : !!catalog,
    409,
    "公开模型已变化",
  );
  requireValue(
    item.action === "create" ||
      item.expected_revision === (existing?.revision ?? 0),
    409,
    "公开模型修订已更新",
  );
  const newPrice = !existing || !!item.replace_price;
  requireValue(
    purpose &&
      protocol &&
      (!catalog || catalog.descriptor.kind === purpose) &&
      missing.every((reason) => reason === "price" && !newPrice),
    400,
    "请先补齐用途、调用格式、售价及有界参数",
  );
  requireValue(
    routeScopeAllows(conn.credential_scope, protocol, draft.upstream_id),
    403,
    "凭据未授权此模型或用途",
  );
  // Checks revocation on the original grant without contacting the gateway.
  await resolveConnectionRevision(sql, p.vault, conn.id);
  if (!catalog) {
    const name = item.label ?? draft.upstream_id;
    await sql.query(
      `INSERT INTO studio_catalog(id,source_kind,descriptor,position,price_position)
      VALUES($1,'builtin',$2,COALESCE((SELECT max(position)+1 FROM studio_catalog),1),COALESCE((SELECT max(price_position)+1 FROM studio_catalog),1))`,
      [catalogId, JSON.stringify({ kind: purpose, label: name })],
    );
    const flags = JSON.stringify({ [catalogId]: true });
    await sql.query(
      "UPDATE studio_policy SET flags=flags||$1::jsonb,revision=revision+1",
      [flags],
    );
    await sql.query(
      "UPDATE studio_workspace_policy SET flags=$1::jsonb||flags,revision=revision+1",
      [flags],
    );
  } else if (!existing) {
    requireValue(
      item.action === "activate" && catalog.source_kind === "plugin",
      409,
      "请选择接管原模型",
    );
    await requireAdoptable(sql, draft, catalog);
    await sql.query(
      `UPDATE studio_catalog SET adopted_from_plugin=plugin_id,plugin_id=NULL,plugin_version=NULL,source_kind='builtin' WHERE id=$1`,
      [catalogId],
    );
    await sql.query("DELETE FROM studio_model_service WHERE model_id=$1", [
      catalogId,
    ]);
    await sql.query(
      `UPDATE models SET catalog_id=NULL,enabled=false WHERE catalog_id=$1`,
      [catalogId],
    );
  }
  const model = await one(
    sql,
    `INSERT INTO models(id,connection_id,provider_model,label,kind,schema,enabled,catalog_id)
    VALUES(gen_random_uuid(),$1,$2,$3,$4,'{"type":"object"}',true,$5) ON CONFLICT(connection_id,provider_model)
    DO UPDATE SET label=models.label WHERE models.kind=excluded.kind AND models.catalog_id=excluded.catalog_id RETURNING id`,
    [
      draft.connection_id,
      draft.upstream_id,
      item.label ?? draft.upstream_id,
      purpose,
      catalogId,
    ],
  );
  requireValue(model, 409, "上游模型已关联其他公开模型或用途");
  let route = await one(
    sql,
    "SELECT id FROM model_access_route_revisions WHERE draft_id=$1 AND draft_revision=$2 AND catalog_id=$3",
    [draft.id, draft.revision, catalogId],
  );
  if (!route)
    route = await one(
      sql,
      `INSERT INTO model_access_route_revisions
    (id,catalog_id,model_id,connection_id,upstream_id,connection_revision_id,draft_id,draft_revision,purpose,protocol,executor_version,capabilities)
    VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10) RETURNING id`,
      [
        catalogId,
        model.id,
        draft.connection_id,
        draft.upstream_id,
        conn.id,
        draft.id,
        draft.revision,
        purpose,
        protocol,
        JSON.stringify(parameters),
      ],
    );
  const revision = (existing?.revision ?? 0) + 1;
  let priceId = existing?.price_revision_id;
  if (newPrice) {
    priceId = randomUUID();
    await sql.query(
      `INSERT INTO model_access_price_revisions(id,catalog_id,purpose,unit,input,output,cache_read,cache_write)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        priceId,
        catalogId,
        purpose,
        purpose === "chat" ? null : price,
        purpose === "chat" ? chat_prices!.input : null,
        purpose === "chat" ? chat_prices!.output : null,
        purpose === "chat" ? (chat_prices!.cache_read ?? null) : null,
        purpose === "chat" ? (chat_prices!.cache_write ?? null) : null,
      ],
    );
  }
  const routeId =
    item.action === "standby" ? existing!.route_revision_id : route.id;
  await sql.query(
    `INSERT INTO model_access_publications(catalog_id,revision,purpose,route_revision_id,price_revision_id)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(catalog_id) DO UPDATE SET revision=excluded.revision,
    route_revision_id=excluded.route_revision_id,price_revision_id=excluded.price_revision_id`,
    [catalogId, revision, purpose, routeId, priceId],
  );
  return {
    catalog_id: catalogId,
    revision,
    route_revision_id: String(routeId),
    price_revision_id: String(priceId),
  };
}

/** Select a previously published, immutable candidate, independent of any later draft edits. */
async function activateExisting(
  p: Platform,
  sql: Sql,
  item: z.infer<typeof activateRoute>,
) {
  const row = await one(
    sql,
    `SELECT pub.revision,pub.price_revision_id,r.connection_revision_id,
    c.enabled AND NOT c.removed AS enabled FROM model_access_publications pub
    JOIN model_access_route_revisions r ON r.catalog_id=pub.catalog_id AND r.id=$2
    JOIN connections c ON c.id=r.connection_id
    WHERE pub.catalog_id=$1 FOR UPDATE OF pub FOR SHARE OF c`,
    [item.catalog_id, item.route_revision_id],
  );
  requireValue(
    row && row.revision === item.expected_revision && row.enabled,
    409,
    "线路已停止接单或公开模型修订已更新",
  );
  await resolveConnectionRevision(sql, p.vault, row.connection_revision_id);
  await sql.query(
    "UPDATE model_access_publications SET revision=revision+1,route_revision_id=$2 WHERE catalog_id=$1",
    [item.catalog_id, item.route_revision_id],
  );
  return {
    catalog_id: item.catalog_id,
    revision: item.expected_revision + 1,
    route_revision_id: item.route_revision_id,
    price_revision_id: String(row.price_revision_id),
  };
}

export async function publishModels(p: Platform, actor: Actor, value: unknown) {
  p.admin(actor);
  const parsed = request.safeParse(value);
  requireValue(parsed.success, 400, "上架参数无效");
  const input = parsed.data;
  const choices = input.items.map((item, index) => ({
    item,
    id: item.catalog_id ?? "model-" + randomUUID(),
    index,
  }));
  requireValue(
    new Set(choices.map((c) => c.id)).size === choices.length &&
      new Set(
        choices.map((c) =>
          "draft_id" in c.item ? c.item.draft_id : c.item.route_revision_id,
        ),
      ).size === choices.length,
    400,
    "不能重复勾选模型",
  );
  return p.db.transaction(async (sql) => {
    requireValue(
      await one(
        sql,
        "SELECT 1 FROM users WHERE id=$1 AND role='admin' AND active AND deleted_at IS NULL FOR SHARE",
        [actor.id],
      ),
      403,
      "需要管理员权限",
    );
    await sql.query("SELECT pg_advisory_xact_lock(hashtext('studio-catalog'))");
    await sql.query("SELECT price_revision FROM studio_policy FOR UPDATE");
    const replay = await one(
      sql,
      "SELECT result,actor_id=$2 AND request=$3::jsonb AS matches FROM model_access_publication_receipts WHERE uid=$1",
      [input.uid, actor.id, JSON.stringify(input)],
    );
    if (replay) {
      requireValue(replay.matches, 409, "请求编号已用于其他操作");
      return replay.result as {
        items: Awaited<ReturnType<typeof publishOne>>[];
      };
    }
    const items: Awaited<ReturnType<typeof publishOne>>[] = [];
    for (const choice of choices.sort((a, b) => a.id.localeCompare(b.id)))
      items[choice.index] =
        "route_revision_id" in choice.item
          ? await activateExisting(p, sql, choice.item)
          : await publishOne(p, sql, choice.id, choice.item);
    if (input.items.some((item) => item.action !== "standby"))
      await sql.query(
        "UPDATE studio_policy SET price_revision=price_revision+1",
      );
    const result = { items };
    await sql.query(
      "INSERT INTO model_access_publication_receipts VALUES($1,$2,$3,$4)",
      [input.uid, actor.id, JSON.stringify(input), JSON.stringify(result)],
    );
    await p.audit(sql, actor, "model-access.publish", input.uid);
    return result;
  });
}
