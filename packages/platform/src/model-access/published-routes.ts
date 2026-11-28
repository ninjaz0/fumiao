import { imageCapabilities } from "./image-formats.js";
import { videoCapabilities } from "./video-parameters.js";
import { creditUnits, formatCredits } from "../credit-amount.js";
import { one, type Sql } from "../db.js";
import { requireValue } from "../security.js";
import { hasModelAccess } from "../studio-plugin-profile.js";
import type { Directory, DirectoryStatus } from "./discovery.js";
import type { Protocol } from "./connections.js";
import type { FrozenModelRoute } from "./publication.js";

export type PublishedPrice =
  | {
      kind: "chat";
      input: string;
      output: string;
      cache_read: string | null;
      cache_write: string | null;
    }
  | { kind: "image" | "video"; unit: string };
export function publishedPrice(row: Record<string, any>): PublishedPrice {
  const decimal = (value: string) => formatCredits(creditUnits(value));
  if (row.purpose === "chat")
    return {
      kind: "chat",
      input: decimal(row.input),
      output: decimal(row.output),
      cache_read: row.cache_read === null ? null : decimal(row.cache_read),
      cache_write: row.cache_write === null ? null : decimal(row.cache_write),
    };
  return { kind: row.purpose, unit: decimal(row.unit) };
}
// All callers bind the workspace as $1 and select the exact route revision as r.
export const publishedRouteAccessSql = `studio_model_allowed(r.catalog_id,$1) AND NOT EXISTS (
  SELECT 1 FROM model_permissions mp WHERE mp.workspace_id=$1 AND mp.model_id=r.model_id AND NOT mp.enabled)`;

export async function requirePublishedRouteAccess(sql: Sql, route: FrozenModelRoute, workspace: string) {
  const allowed = await one(sql,
    `SELECT 1 FROM model_access_route_revisions r WHERE r.id=$2 AND ${publishedRouteAccessSql}`,
    [workspace, route.routeRevisionId]);
  requireValue(allowed, 403, "当前空间未开放该模型");
}
const routeSql = `SELECT p.revision,p.price_revision_id,r.*,s.unit,s.input,s.output,s.cache_read,s.cache_write,
  c.enabled AND NOT c.removed AS enabled FROM model_access_publications p
  JOIN model_access_route_revisions r ON r.catalog_id=p.catalog_id
  JOIN model_access_price_revisions s ON s.id=p.price_revision_id JOIN connections c ON c.id=r.connection_id`;

const activeRouteSql = routeSql + " WHERE r.id=p.route_revision_id";

export async function resolvePublishedRoute(
  sql: Sql,
  catalogId: string,
  trialRouteId?: string,
): Promise<FrozenModelRoute | null> {
  if (!(await hasModelAccess(sql))) return null;
  const row = trialRouteId
    ? await one(
        sql,
        routeSql +
          ` WHERE p.catalog_id=$1 AND r.id=$2 AND
          (r.id=p.route_revision_id OR NOT EXISTS (
            SELECT 1 FROM model_access_route_revisions newer
            WHERE newer.draft_id=r.draft_id AND newer.draft_revision>r.draft_revision
          )) FOR SHARE OF p,c`,
        [catalogId, trialRouteId],
      )
    : await one(sql, activeRouteSql + " AND p.catalog_id=$1", [catalogId]);
  if (!row) return null;
  requireValue(row.enabled, 409, "当前线路已停止接单");
  return {
    catalogId,
    modelId: row.model_id,
    connectionId: row.connection_id,
    routeRevisionId: row.id,
    connectionRevisionId: row.connection_revision_id,
    upstreamId: row.upstream_id,
    purpose: row.purpose,
    protocol: row.protocol,
    executorVersion: row.executor_version,
    capabilities:
      row.purpose === "video"
        ? videoCapabilities(row.protocol, row.capabilities)
        : row.purpose === "image" ? imageCapabilities(row.capabilities) : row.capabilities,
    priceRevisionId: row.price_revision_id,
    price: publishedPrice(row),
  };
}

export async function publicationView(sql: Sql) {
  const rows = await sql.query(
    `SELECT r.*,COALESCE(c.display_label,c.descriptor->>'label') AS label FROM (${activeRouteSql}) r JOIN studio_catalog c ON c.id=r.catalog_id ORDER BY c.position,c.id`,
  );
  const routes = await sql.query<{
    directory: {
      checked_at: string;
      directories: Partial<Record<Directory, DirectoryStatus>>;
    } | null;
    health: {
      state: string;
      at: string;
      missing_usage: number;
      last_missing_usage: string | null;
    } | null;
    route_revision_id: string;
    catalog_id: string;
    connection_id: string;
    connection_revision_id: string;
    model_id: string;
    draft_id: string;
    draft_revision: number;
    upstream_id: string;
    protocol: Protocol;
    capabilities: FrozenModelRoute["capabilities"];
    enabled: boolean;
  }>(`SELECT r.id AS route_revision_id,r.catalog_id,r.connection_id,r.connection_revision_id,r.model_id,
    r.draft_id,r.draft_revision,r.upstream_id,r.protocol,r.capabilities,c.enabled AND NOT c.removed AS enabled,
    CASE WHEN d.checked_at IS NOT NULL THEN jsonb_build_object('checked_at',d.checked_at,'directories',d.directories) END AS directory,
    CASE WHEN recent.state IS NOT NULL THEN jsonb_build_object('state',recent.state,'at',recent.at,
      'missing_usage',missing.count,'last_missing_usage',missing.at) END AS health
    FROM model_access_route_revisions r JOIN connections c ON c.id=r.connection_id
    LEFT JOIN model_access_discoveries d ON d.connection_revision_id=r.connection_revision_id
    LEFT JOIN LATERAL (
      (SELECT t.state,to_timestamp(t.finished) AS at FROM chat_turns t WHERE t.route_revision_id=r.id AND t.finished IS NOT NULL ORDER BY t.finished DESC LIMIT 1)
      UNION ALL
      (SELECT j.state,j.updated_at FROM jobs j WHERE j.route_revision_id=r.id AND j.state IN ('completed','failed','cancelled','uncertain') ORDER BY j.updated_at DESC LIMIT 1)
    ) recent ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS count,max(to_timestamp(t.finished)) AS at
      FROM chat_turns t JOIN chat_turn_bills b ON b.turn_id=t.id
      CROSS JOIN LATERAL jsonb_array_elements(b.bill->'calls') call
      WHERE t.route_revision_id=r.id AND t.finished IS NOT NULL AND call->'usage'='null'::jsonb
    ) missing ON true ORDER BY r.catalog_id,r.draft_id,r.draft_revision DESC`);
  const byCatalog = new Map<string, typeof routes.rows>();
  for (const route of routes.rows) {
    if (
      route.protocol === "new-api-videos" ||
      route.protocol === "openrouter-videos"
    )
      route.capabilities = videoCapabilities(
        route.protocol,
        route.capabilities,
      );
    else if (route.protocol === "openai-images" || route.protocol === "openrouter-images")
      route.capabilities = imageCapabilities(route.capabilities);
    const group = byCatalog.get(route.catalog_id);
    if (group) group.push(route);
    else byCatalog.set(route.catalog_id, [route]);
  }
  return rows.rows.map((row) => ({
    label: String(row.label),
    catalog_id: String(row.catalog_id),
    revision: Number(row.revision),
    price_revision_id: String(row.price_revision_id),
    route_revision_id: String(row.id),
    price: publishedPrice(row),
    routes: byCatalog.get(row.catalog_id) ?? [],
  }));
}
