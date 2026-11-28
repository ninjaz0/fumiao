import { pythonStrip } from "@fumiao/plugin-sdk/python-text.js";
import type { OriginalTask } from "@fumiao/plugin-sdk/index.js";
import { one, type Sql } from "@fumiao/platform/db.js";
import { packPurposes, type PackSelection } from "@fumiao/platform/packs.js";
import { ordinaryFlowSource } from "@fumiao/platform/retired-jobs.js";
import { requireValue } from "@fumiao/platform/security.js";

/** The caller must be authorized for the workspace before reading generation inputs. */
export async function originalTask(
  sql: Sql,
  workspaceId: string,
  id: number,
  continuation = false,
  lock = false,
) {
  const row = await one(
    sql,
    `SELECT j.*,(${ordinaryFlowSource}) AS ordinary_origin FROM jobs j
     WHERE j.public_id=$1 AND j.workspace_id=$2 AND j.deleted_at IS NULL
     ${lock ? `AND j.state='completed' AND j.kind='video' AND j.plugin_id='flow'
       AND (${ordinaryFlowSource}) FOR SHARE OF j` : ""}`,
    [id, workspaceId],
  );
  if (!row) return;
  const metadata = { ...row.original_view.actual, ...row.result?.usage };
  if (continuation && !row.ordinary_origin) delete metadata.flow_media_id;
  const task: OriginalTask = {
    id: Number(row.public_id),
    model: row.provider_model,
    kind: row.kind,
    state: row.state,
    params: row.input.params,
    view: { ...row.input.params, ...row.original_view },
    metadata,
  };
  return { row, task };
}

export async function originalFlowSource(
  sql: Sql,
  workspaceId: string,
  id: number,
  lock = false,
  nowaitAssets = false,
) {
  const source = await originalTask(sql, workspaceId, id, true, lock);
  if (!source) return;
  const output = await one(
    sql,
    `SELECT a.id,a.public_id,a.workspace_id,a.state,a.original_kind,a.mime
       FROM job_assets r JOIN assets a ON a.id=r.asset_id
      WHERE r.job_id=$1 AND r.role='output'
      ORDER BY a.created_at,a.public_id LIMIT 1
      ${lock ? `FOR SHARE OF a${nowaitAssets ? " NOWAIT" : ""}` : ""}`,
    [source.row.id],
  );
  const media = output?.workspace_id === workspaceId && output.state === "ready" &&
    output.original_kind === "video" && output.mime?.startsWith("video/")
    ? { id: String(output.public_id), mime: String(output.mime) }
    : undefined;
  return { ...source, media };
}

/** Public canvas media and pack IDs. Paid admission locks the chosen pack versions. */
export async function expandOriginalPacks(
  sql: Sql,
  workspaceId: string,
  input: { prompt: string; refs: string[]; asset_packs: PackSelection[] },
  lock = false,
) {
  const refs = [...input.refs];
  const texts: { id: string; text: string }[] = [];
  const snapshots: {
    id: string;
    revision: number;
    name: string;
    purpose: string;
    description: string;
    media: string[];
  }[] = [];
  if (!input.asset_packs.length) return { refs, prompt: input.prompt, texts, snapshots };

  const ids = input.asset_packs.map(({ id }) => id);
  requireValue(new Set(ids).size === ids.length, 400, "请勿重复引用素材包");
  const { rows } = await sql.query<{
    id: string;
    title: string;
    revision: number;
    body: { purpose?: string; description?: string };
    pack_text: { name: string; description: string } | null;
    media: (string | null)[];
  }>(
    `SELECT d.public_id AS id, d.title, d.revision, d.body, d.pack_text,
        ARRAY(SELECT a.public_id FROM jsonb_array_elements_text(COALESCE(NULLIF(d.body->'assets','null'::jsonb),'[]'))
          WITH ORDINALITY AS s(id, position)
          LEFT JOIN assets a ON a.id=s.id::uuid AND a.state='ready' AND a.workspace_id=d.workspace_id
          ORDER BY s.position) AS media
      FROM documents d
      WHERE d.public_id=ANY($1::text[]) AND d.workspace_id=$2 AND d.kind='pack' AND NOT d.deleted
      ORDER BY d.id ${lock ? "FOR SHARE OF d" : ""}`,
    [ids, workspaceId],
  );
  const byId = new Map(rows.map((pack) => [pack.id, pack]));
  for (const { id, revision } of input.asset_packs) {
    const pack = byId.get(id);
    requireValue(pack, 404, `素材包 ${id.slice(0, 6)} 已删除或不可访问`);
    const { name, description } = pack.pack_text ?? {
      name: pack.title,
      description: pack.body.description ?? "",
    };
    requireValue(Number(pack.revision) === revision, 409, `素材包“${name}”已更新，请重新选择后生成`);
    const media = pack.media.filter((id): id is string => Boolean(id));
    requireValue(media.length === pack.media.length, 409, `素材包“${name}”缺少可用图片`);
    for (const mediaId of media) if (!refs.includes(mediaId)) refs.push(mediaId);
    const purpose = pack.body.purpose || "subject";
    const indexes = media.map((mediaId) => `<Picture ${refs.indexOf(mediaId) + 1}>`).join(", ");
    texts.push({ id, text: `${name}（${packPurposes[purpose as keyof typeof packPurposes]}，${indexes}）：${description}` });
    snapshots.push({ id, revision, name, purpose, description, media });
  }
  const prompt = [pythonStrip(input.prompt), ...texts.map(({ text }) => text)].join("\n\n");
  requireValue(
    refs.length <= 9 && [...prompt].length <= 12000,
    400,
    "参考图片合计最多 9 张，提示词和素材说明合计最多 12000 字",
  );
  return { refs, prompt, texts, snapshots };
}
