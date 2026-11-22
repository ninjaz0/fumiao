import { z } from "zod";
import { requireValue } from "./security.js";
import type { Sql } from "./db.js";
import { uuid5 } from "./uuid.js";
import { canvasBytes } from "@fumiao/original-api/canvas-values.js";
import {
  parseCanvasDocument,
  type CanvasDocument,
} from "@fumiao/original-api/canvas-draft.js";
const number = z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  time = z.number().int().safe();
const hex = z.string().regex(/^[a-f0-9]{32}$/),
  uid = z.string().regex(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);
const text = z.string().refine((value) => {
  try {
    canvasBytes(value);
    return true;
  } catch {
    return false;
  }
});
const plain = text.refine((value) => !value.includes("\0"));
const schemas = {
  canvas_projects: z
    .object({
      id: hex,
      title: text,
      owner: number,
      last_editor: number,
      created: time,
      updated: time,
      revision: number.max(2147483647),
      document: text,
      workspace: number,
    })
    .strict(),
  canvas_media_refs: z
    .object({ project: hex, node: plain, media: hex })
    .strict(),
  canvas_job_links: z
    .object({
      id: number,
      project: hex,
      node: plain,
      job: number.nullable(),
      owner: number,
      uid,
      inputs: text,
      created: time,
    })
    .strict(),
  canvas_run_batches: z
    .object({
      owner: number,
      uid,
      project: hex,
      node: plain,
      count: z.union([z.literal(1), z.literal(2)]),
      result: text,
    })
    .strict(),
  storyboard_exports: z
    .object({
      id: hex,
      original_order: number,
      uid,
      owner: number,
      workspace: number,
      project: hex.nullable(),
      revision: number.max(2147483647),
      snapshot: text,
      state: z.enum(["done", "failed", "cancelled"]),
      result: hex.nullable(),
      subtitles: text,
      error: text,
      created: time,
      updated: time,
    })
    .strict(),
  storyboard_export_refs: z.object({ export: hex, media: hex }).strict(),
};
export const canvasCollections = new Set(Object.keys(schemas));
type Rows = { [K in keyof typeof schemas]: z.infer<(typeof schemas)[K]>[] };
function json(value: string, label: string, opaque = false): any {
  try {
    // Input snapshots are checked for shape and stored verbatim. Only JSON
    // used for relationships must fit in the platform's public integer range.
    if (opaque) return JSON.parse(value);
    const reviver = (_key: string, part: any, context: any) => {
      // Relations use JS public integers. Refuse silent rounding before copying data.
      if (
        typeof part === "number" &&
        /^-?\d+$/.test(context?.source ?? "") &&
        !Number.isSafeInteger(part)
      )
        throw new Error("Unsafe integer");
      return part;
    };
    return JSON.parse(value, reviver as any);
  } catch {
    requireValue(false, 400, "旧画布 JSON 无效：" + label);
  }
}
export function validateCanvasImport(
  tables: Record<string, Record<string, any>[]>,
  version?: number,
) {
  requireValue(
    version === undefined || version === 1,
    400,
    "旧画布导出版本无效",
  );
  const present = [...canvasCollections].some(
    (name) => (tables[name]?.length ?? 0) > 0,
  );
  requireValue(
    !present || version === 1,
    400,
    "导出文件缺少完整画布历史，请重新导出",
  );
  if (version === 1)
    requireValue(
      [...canvasCollections].every((name) => Array.isArray(tables[name])),
      400,
      "导出文件缺少完整画布表，请重新导出",
    );
  const rows = Object.fromEntries(
    Object.entries(schemas).map(([name, schema]) => {
      const result = z.array(schema).safeParse(tables[name] ?? []);
      requireValue(result.success, 400, "旧画布记录无效：" + name);
      return [name, result.data];
    }),
  ) as Rows;
  const index = <T>(
    items: T[],
    key: (v: T) => string | number,
    label: string,
  ) => {
    const map = new Map(items.map((r) => [key(r), r]));
    requireValue(map.size === items.length, 400, "旧画布编号重复：" + label);
    return map;
  };
  const projects = index(rows.canvas_projects, (r) => r.id, "project"),
    links = index(rows.canvas_job_links, (r) => r.id, "link"),
    exports = index(rows.storyboard_exports, (r) => r.id, "export");
  const pair = (...v: unknown[]) => JSON.stringify(v);
  const linkRequests = index(
    rows.canvas_job_links,
    (r) => pair(r.owner, r.uid),
    "link uid",
  );
  index(
    rows.canvas_media_refs,
    (r) => pair(r.project, r.node, r.media),
    "media ref",
  );
  index(rows.canvas_run_batches, (r) => pair(r.owner, r.uid), "batch uid");
  index(rows.storyboard_exports, (r) => pair(r.owner, r.uid), "export uid");
  index(rows.storyboard_exports, (r) => r.original_order, "export order");
  index(
    rows.storyboard_export_refs,
    (r) => pair(r.export, r.media),
    "export ref",
  );
  const users = new Set((tables.users ?? []).map((r) => r.id)),
    spaces = new Map((tables.workspaces ?? []).map((r) => [r.id, r])),
    media = new Map((tables.media ?? []).map((r) => [r.id, r])),
    jobs = new Map((tables.jobs ?? []).map((r) => [r.id, r])),
    packs = new Map((tables.asset_packs ?? []).map((r) => [r.id, r])),
    charges = new Map((tables.credit_charges ?? []).map((r) => [r.job, r]));
  const owner = (user: number, workspace: number) =>
    requireValue(
      users.has(user) &&
        spaces.has(workspace) &&
        (spaces.get(workspace)!.kind !== "personal" ||
          spaces.get(workspace)!.owner === user),
      400,
      "旧画布归属无效",
    );
  const project = (key: string) => {
    const p = projects.get(key);
    requireValue(p, 400, "旧画布关联不存在");
    return p;
  };
  const asset = (key: string, workspace: number) => {
    const m = media.get(key);
    requireValue(m && m.workspace === workspace, 400, "旧画布素材关联无效");
    return m;
  };
  const documents = new Map<string, CanvasDocument>();
  const packRefs = new Map<string, string[]>();
  for (const p of rows.canvas_projects) {
    owner(p.owner, p.workspace);
    requireValue(users.has(p.last_editor), 400, "旧画布编辑者不存在");
    let doc: CanvasDocument;
    try {
      doc = parseCanvasDocument(json(p.document, "document"));
    } catch {
      requireValue(false, 400, "旧画布文档无效");
    }
    requireValue(
      new Set(doc.nodes.map((n) => n.id)).size === doc.nodes.length,
      400,
      "旧画布节点编号重复",
    );
    const selected = new Set<string>();
    for (const node of doc.nodes) {
      for (const key of [
        node.media_id,
        ...node.params.h3_refs,
        node.params.h3?.first_frame,
        node.params.h3?.last_frame,
      ])
        if (key && media.has(key)) asset(key, p.workspace);
      for (const id of [
        node.active_job,
        node.narration_job,
        node.narration_pending,
        node.params.flow_source_job,
      ])
        if (id !== null && jobs.has(id))
          requireValue(
            jobs.get(id)!.workspace === p.workspace,
            400,
            "旧画布节点任务跨工作区",
          );
      for (const pack of node.asset_packs) {
        requireValue(
          packs.get(pack.id)?.workspace === p.workspace,
          400,
          "旧画布素材包关联无效",
        );
        selected.add(pack.id);
      }
    }
    documents.set(p.id, doc);
    packRefs.set(p.id, [...selected]);
  }
  for (const r of rows.canvas_media_refs)
    asset(r.media, project(r.project).workspace);
  for (const l of links.values()) {
    const p = project(l.project);
    owner(l.owner, p.workspace);
    if (l.job !== null)
      requireValue(
        jobs.get(l.job)?.workspace === p.workspace,
        400,
        "旧画布任务链接无效",
      );
    const input = json(l.inputs, "inputs", true);
    requireValue(
      input && typeof input === "object" && !Array.isArray(input),
      400,
      "旧画布任务输入无效",
    );
  }
  for (const b of rows.canvas_run_batches) {
    const p = project(b.project);
    owner(b.owner, p.workspace);
    const result = z
      .object({ ids: z.array(number), count: z.number(), credits: number })
      .strict()
      .safeParse(json(b.result, "batch"));
    requireValue(
      result.success &&
        result.data.count === b.count &&
        result.data.ids.length === b.count &&
        new Set(result.data.ids).size === b.count,
      400,
      "旧画布批次结果无效",
    );
    let total = 0;
    for (const [i, id] of result.data.ids.entries()) {
      const link = linkRequests.get(
          pair(b.owner, uuid5(b.uid, `candidate:${i}`)),
        ),
        charge = charges.get(id);
      requireValue(
        link &&
          link.project === b.project &&
          link.node === b.node &&
          (link.job === id || (link.job === null && !jobs.has(id))),
        400,
        "旧画布批次任务关联无效",
      );
      requireValue(
        charge &&
          charge.owner === b.owner &&
          charge.workspace === p.workspace &&
          Number.isSafeInteger(charge.amount) &&
          charge.amount > 0 &&
          ["spent", "refunded"].includes(charge.state),
        400,
        "旧画布批次计费无效",
      );
      total += charge.amount;
    }
    requireValue(total === result.data.credits, 400, "旧画布批次费用不一致");
  }
  for (const e of exports.values()) {
    owner(e.owner, e.workspace);
    if (e.project !== null)
      requireValue(
        project(e.project).workspace === e.workspace,
        400,
        "旧画布合成跨工作区",
      );
    if (e.result !== null)
      requireValue(
        asset(e.result, e.workspace).kind === "video",
        400,
        "旧画布合成结果无效",
      );
    const shots = json(e.snapshot, "export snapshot");
    requireValue(Array.isArray(shots), 400, "旧画布合成快照无效");
    // Completed composition inputs may already have been deleted. Preserve the
    // historical snapshot rather than turning it into live resource references.
    for (const shot of shots)
      requireValue(
        shot && typeof shot === "object" && !Array.isArray(shot),
        400,
        "旧画布镜头快照无效",
      );
  }
  for (const r of rows.storyboard_export_refs) {
    const e = exports.get(r.export);
    requireValue(e, 400, "旧画布合成引用无效");
    asset(r.media, e.workspace);
  }
  return { rows, documents, packRefs };
}
type CanvasImport = ReturnType<typeof validateCanvasImport>;
type Id = (kind: string, value: unknown) => string;
export async function importCanvasProjects(
  sql: Sql,
  data: CanvasImport,
  id: Id,
) {
  for (const p of data.rows.canvas_projects) {
    const key = id("canvas", p.id);
    await sql.query(
      "INSERT INTO documents(id,public_id,workspace_id,owner_id,kind,title,body,revision,updated_at) VALUES($1,$2,$3,$4,'canvas','','{\"originalCanvas\":1}',$5,to_timestamp($6))",
      [
        key,
        p.id,
        id("workspace", p.workspace),
        id("user", p.owner),
        p.revision,
        p.updated,
      ],
    );
    await sql.query(
      "INSERT INTO canvas_documents(project_id,title,document,created,updated,last_editor) VALUES($1,$2,$3,$4,$5,$6)",
      [
        key,
        canvasBytes(p.title),
        canvasBytes(p.document),
        p.created,
        p.updated,
        id("user", p.last_editor),
      ],
    );
    for (const node of data.documents.get(p.id)!.nodes)
      await sql.query(
        "INSERT INTO canvas_nodes(project_id,node) VALUES($1,$2)",
        [key, node.id],
      );
  }
}
export async function importCanvasRelations(
  sql: Sql,
  source: string,
  data: CanvasImport,
  id: Id,
) {
  for (const [key, packs] of data.packRefs)
    for (const pack of packs)
      await sql.query(
        "INSERT INTO document_pack_refs(document_id,pack_id) VALUES($1,$2)",
        [id("canvas", key), id("pack", pack)],
      );
  for (const r of data.rows.canvas_media_refs) {
    await sql.query(
      "INSERT INTO canvas_media_refs(project_id,node,asset_id) VALUES($1,$2,$3)",
      [id("canvas", r.project), r.node, id("asset", r.media)],
    );
    await sql.query(
      "INSERT INTO document_assets(document_id,asset_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [id("canvas", r.project), id("asset", r.media)],
    );
  }
  for (const l of data.rows.canvas_job_links)
    await sql.query(
      "INSERT INTO canvas_job_links(id,project_id,node,job_id,owner_id,uid,inputs,created) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        l.id,
        id("canvas", l.project),
        l.node,
        l.job === null ? null : id("job", l.job),
        id("user", l.owner),
        l.uid,
        canvasBytes(l.inputs),
        l.created,
      ],
    );
  for (const b of data.rows.canvas_run_batches)
    await sql.query(
      "INSERT INTO canvas_run_batches(owner_id,uid,project_id,node,count,result) VALUES($1,$2,$3,$4,$5,$6)",
      [
        id("user", b.owner),
        b.uid,
        id("canvas", b.project),
        b.node,
        b.count,
        canvasBytes(b.result),
      ],
    );
  for (const e of data.rows.storyboard_exports)
    await sql.query(
      `INSERT INTO storyboard_exports(id,public_id,ordinal,uid,owner_id,workspace_id,project_id,revision,snapshot,state,result_id,subtitles,error,created,updated)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        id("storyboard-export", e.id),
        e.id,
        e.original_order,
        e.uid,
        id("user", e.owner),
        id("workspace", e.workspace),
        e.project === null ? null : id("canvas", e.project),
        e.revision,
        canvasBytes(e.snapshot),
        e.state,
        e.result === null ? null : id("asset", e.result),
        canvasBytes(e.subtitles),
        canvasBytes(e.error),
        e.created,
        e.updated,
      ],
    );
  for (const r of data.rows.storyboard_export_refs)
    await sql.query(
      "INSERT INTO storyboard_export_refs(export_id,asset_id) VALUES($1,$2)",
      [id("storyboard-export", r.export), id("asset", r.media)],
    );
  for (const [table, column] of [
    ["canvas_job_links", "id"],
    ["storyboard_exports", "ordinal"],
  ])
    await sql.query(
      `SELECT setval(pg_get_serial_sequence('${table}','${column}'),GREATEST(COALESCE((SELECT max(${column}) FROM ${table}),0),1),EXISTS(SELECT 1 FROM ${table}))`,
    );
  const projectSpaces = new Map(
      data.rows.canvas_projects.map((p) => [p.id, p.workspace]),
    ),
    exportSpaces = new Map(
      data.rows.storyboard_exports.map((e) => [e.id, e.workspace]),
    );
  for (const [collection, records] of Object.entries(data.rows))
    for (const [index, row] of records.entries()) {
      const record = row as Record<string, any>,
        workspace =
          record.workspace ??
          projectSpaces.get(record.project) ??
          exportSpaces.get(record.export);
      await sql.query(
        "INSERT INTO legacy_canvas_records(source,collection,legacy_id,workspace_id,payload) VALUES($1,$2,$3,$4,$5)",
        [
          source,
          collection,
          String(
            record.id ??
              (record.uid ? JSON.stringify([record.owner, record.uid]) : index),
          ),
          id("workspace", workspace),
          canvasBytes(JSON.stringify(record)),
        ],
      );
    }
}
