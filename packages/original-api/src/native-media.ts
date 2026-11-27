import { randomUUID } from "node:crypto";
import { pythonStrip } from "@fumiao/plugin-sdk/python-text.js";
import type { OriginalDraft } from "@fumiao/plugin-sdk/index.js";
import { acceptTask, type AcceptTaskMeta } from "@fumiao/platform/accept.js";
import { creditUnits, formatCredits } from "@fumiao/platform/credit-amount.js";
import { one, type Sql } from "@fumiao/platform/db.js";
import { resolveConnectionRevision } from "@fumiao/platform/model-access/connections.js";
import {
  routeScopeAllows,
  type FrozenModelRoute,
} from "@fumiao/platform/model-access/publication.js";
import type { Platform } from "@fumiao/platform/platform.js";
import { prepareImageParameters } from "@fumiao/platform/prepare-input.js";
import { requireValue } from "@fumiao/platform/security.js";
import type { OriginalActor } from "./identity.js";
import { OriginalLibrary } from "./library.js";

export async function prepareNativeMedia(
  p: Platform,
  sql: Sql,
  user: OriginalActor,
  workspace: string,
  route: FrozenModelRoute,
  draft: { kind: string; params?: Record<string, unknown>; refs: string[] },
  admission = false,
) {
  requireValue(
    route.executorVersion === 1 &&
      route.purpose === draft.kind &&
      route.price.kind === "image" &&
      (route.protocol === "openai-images" ||
        route.protocol === "openrouter-images"),
    409,
    "线路不支持该生成请求",
  );
  await p.workspace(sql, user, workspace);
  if (admission) {
    requireValue(
      await one(
        sql,
        "SELECT id FROM connections WHERE id=$1 AND enabled AND NOT removed FOR SHARE",
        [route.connectionId],
      ),
      409,
      "当前线路已停止接单",
    );
    await sql.query("SELECT id FROM workspaces WHERE id=$1 FOR SHARE", [
      workspace,
    ]);
  }
  const model = await one(
    sql,
    `SELECT m.id FROM models m WHERE m.id=$1 AND studio_model_allowed($2,$3)
    AND NOT EXISTS(SELECT 1 FROM model_permissions mp WHERE mp.model_id=m.id AND mp.workspace_id=$3 AND NOT mp.enabled)`,
    [route.modelId, route.catalogId, workspace],
  );
  requireValue(model, 403, "当前空间未开放该模型");
  const client = await resolveConnectionRevision(
    sql,
    p,
    route.connectionRevisionId,
  );
  requireValue(
    routeScopeAllows(client.scope, route.protocol, route.upstreamId) &&
      (!draft.refs.length ||
        route.protocol !== "openai-images" ||
        client.scope.endpoints.includes("images/edits")),
    403,
    "凭据未授权此模型或用途",
  );
  const { params, count } = prepareImageParameters(
    route,
    draft.params ?? {},
    draft.refs.length,
  );
  requireValue(
    new Set(draft.refs).size === draft.refs.length,
    400,
    "请勿重复引用图片",
  );
  const assets = (
    await sql.query(
      `SELECT * FROM assets WHERE workspace_id=$1 AND public_id=ANY($2::text[]) AND state='ready' ORDER BY id ${admission ? "FOR KEY SHARE" : ""}`,
      [workspace, draft.refs],
    )
  ).rows;
  const references: string[] = [];
  let bytes = 0;
  for (const ref of draft.refs) {
    const asset = assets.find((a) => a.public_id === ref);
    requireValue(
      asset && asset.mime.startsWith("image/"),
      404,
      "参考图片不存在或无权访问",
    );
    references.push(asset.id);
    bytes += Number(asset.size);
  }
  requireValue(bytes <= 64 * 1024 * 1024, 413, "参考图片合计超过 64 MB");
  return {
    params,
    references,
    amount: formatCredits(creditUnits(route.price.unit) * BigInt(count)),
  };
}

export async function acceptNativeMedia(
  p: Platform,
  sql: Sql,
  user: OriginalActor,
  workspace: string,
  route: FrozenModelRoute,
  draft: OriginalDraft,
  uid: string,
  fingerprint: string,
  revision: number,
  snapshots: unknown[],
  meta?: AcceptTaskMeta,
) {
  const prepared = await prepareNativeMedia(
    p,
    sql,
    user,
    workspace,
    route,
    draft,
    true,
  );
  requireValue(pythonStrip(draft.prompt), 400, "请输入提示词");
  if (meta?.projectId) {
    const project = await one(
      sql,
      "SELECT workspace_id FROM documents WHERE id=$1 AND kind='canvas' AND NOT deleted FOR SHARE",
      [meta.projectId],
    );
    requireValue(project, 404, "画布不存在或已删除");
    await new OriginalLibrary(p).access(
      sql,
      user,
      { kind: "asset", row: project },
      workspace,
    );
  }
  const queued = await one(
    sql,
    "SELECT count(*) AS n FROM jobs WHERE workspace_id=$1 AND state IN ('queued','dispatching','running','finalizing','uncertain')",
    [workspace],
  );
  requireValue(Number(queued.n) < 200, 429, "当前工作区任务过多");
  const input = {
    modelId: route.modelId,
    key: randomUUID(),
    prompt: pythonStrip(draft.prompt),
    params: prepared.params,
    references: prepared.references,
  };
  const accepted = await acceptTask(
    p,
    sql,
    user,
    workspace,
    {
      id: route.modelId,
      connection_id: route.connectionId,
      catalog_id: route.catalogId,
      provider_model: route.upstreamId,
      kind: route.purpose,
    },
    input,
    fingerprint,
    { amount: prepared.amount, key: null, revision },
    snapshots,
    { ...meta, executionKey: meta?.executionKey ?? uid },
    route,
  );
  const view = {
    params: prepared.params,
    refs: draft.refs,
    ratio: draft.ratio,
    quality: null,
    seconds: null,
    sampling_steps: null,
    seed: null,
    width: null,
    height: null,
    image_quality: draft.params?.quality ?? null,
    audio_settings: {},
    h3_inputs: {},
    actual: {},
  };
  const row = await one(
    sql,
    "UPDATE jobs SET original_uid=$2,studio_client_uid=$3,original_parent=$4,original_view=$5 WHERE id=$1 RETURNING public_id",
    [accepted.id, uid, draft.uid, draft.parent, JSON.stringify(view)],
  );
  await sql.query(
    "INSERT INTO model_access_job_uids(uid,job_id) VALUES($1,$2)",
    [uid, accepted.id],
  );
  return { id: Number(row.public_id) };
}
