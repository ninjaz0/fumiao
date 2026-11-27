import { validateCanvasDefinitions } from "@fumiao/platform/canvas-node-plugins.js";
import { randomUUID } from "node:crypto";
import type { Actor, Platform } from "@fumiao/platform/platform.js";
import { one, type Sql } from "@fumiao/platform/db.js";
import { requireValue } from "@fumiao/platform/security.js";
import { CanvasModels } from "@fumiao/platform/canvas-models.js";
import { StudioCatalog } from "@fumiao/platform/catalog.js";
import { ReferencePacks } from "@fumiao/platform/packs.js";
import { createTailFrameAsset } from "@fumiao/platform/tail-frame.js";
import { cropGridCell } from "@fumiao/platform/grid-crop.js";
import { pythonStrip } from "@fumiao/plugin-sdk/python-values.js";
import { directorScriptConflict, type DirectorProduction } from "@fumiao/web-compat/director.js";
import { OriginalIdentity } from "./identity.js";
import { archiveEntry, OriginalLibrary } from "./library.js";
import { parseBody } from "./validation.js";
import {
  canvasGridCropFields,
  canvasNewFields,
  canvasExactRevisionFields,
  parseCanvasDocument,
  parseCanvasSave,
  type CanvasDocument,
  type CanvasNode,
} from "./canvas-draft.js";
import {
  canvasBytes,
  canvasText,
  canvasDocumentBytes,
  canvasDocumentJson,
  canvasVoiceIds,
} from "./canvas-values.js";
import {
  validateCanvasDocument,
  type CanvasValidationResources,
} from "./canvas-validation.js";
import { canvasTemplates } from "./canvas-templates.js";
export const canvasConflict =
  "画布已被其他成员修改。你的修改已保留，请重新载入或下载本地副本。";
const selectProject = `SELECT d.*,c.title AS original_title,c.document,c.created,c.updated,c.last_editor,c.archived_at,c.archive_change_id,
  w.public_id AS workspace_number,u.public_id AS owner_number,e.public_id AS editor_number
  FROM documents d JOIN workspaces w ON w.id=d.workspace_id JOIN users u ON u.id=d.owner_id
  LEFT JOIN canvas_documents c ON c.project_id=d.id LEFT JOIN users e ON e.id=c.last_editor`;
const selectNodeJob = `SELECT j.state,a.public_id AS result FROM canvas_job_links l
  JOIN jobs j ON j.id=l.job_id AND j.deleted_at IS NULL
  LEFT JOIN LATERAL (SELECT a.public_id FROM job_assets r JOIN assets a ON a.id=r.asset_id
    WHERE r.job_id=j.id AND r.role='output' ORDER BY a.created_at,a.public_id LIMIT 1) a ON true`;
export async function canvasNodeMedia(
  sql: Sql,
  project: string,
  node: CanvasNode,
  adoptedOnly = false,
  fixedInput = false,
  lock = fixedInput,
): Promise<string | null> {
  if (node.use_media) return node.media_id;
  if (adoptedOnly && !node.active_job) return null;
  const row = await one(
    sql,
    `${selectNodeJob}
    WHERE l.project_id=$1 AND l.node=$2 ${node.active_job ? "AND j.public_id=$3" : "ORDER BY l.id DESC LIMIT 1"}
    ${adoptedOnly ? "AND j.kind='video' AND j.workspace_id=(SELECT workspace_id FROM documents WHERE id=$1) FOR SHARE OF j" : ""}
    ${fixedInput && node.active_job ? `AND j.state='completed'
      AND j.workspace_id=(SELECT workspace_id FROM documents WHERE id=$1)
      ${lock ? "FOR SHARE OF j" : ""}` : ""}`,
    [project, node.id, ...(node.active_job ? [node.active_job] : [])],
  );
  if (!row) return adoptedOnly || (fixedInput && node.active_job) ? null : node.media_id;
  return row.state === "completed" && row.result ? row.result : null;
}
type ShotVideo = {
  id: string;
  public_id: string;
  workspace_id: string;
  mime: string;
  size: string | number;
};

function canManageCanvas(ownerId: string, user: Actor) {
  return ownerId === user.id || user.role === "admin";
}

/** Original canvas authority. All mutations share document locks and PostgreSQL relations. */
export class OriginalCanvases {
  readonly identity: OriginalIdentity;
  readonly library: OriginalLibrary;
  readonly packs: ReferencePacks;
  constructor(
    readonly p: Platform,
    readonly clock = () => Date.now() / 1000,
  ) {
    this.identity = new OriginalIdentity(p);
    this.library = new OriginalLibrary(p);
    this.packs = new ReferencePacks(p.db);
  }
  async project(sql: Sql, user: Actor, key: string, lock = false) {
    // SQLite accepts NUL in lookup strings. PostgreSQL text parameters do not.
    requireValue(!key.includes("\0"), 404, "画布不存在或已删除");
    if (lock) {
      // Lock the parent in a separate statement. A joined bytea row must be read
      // from a new snapshot after any concurrent parent update finishes.
      const locked = await one(
        sql,
        "SELECT id FROM documents WHERE public_id=$1 AND kind='canvas' AND NOT deleted FOR UPDATE",
        [key],
      );
      requireValue(locked, 404, "画布不存在或已删除");
    }
    const row = await one(
      sql,
      selectProject +
        " WHERE d.public_id=$1 AND d.kind='canvas' AND NOT d.deleted",
      [key],
    );
    requireValue(row, 404, "画布不存在或已删除");
    // Source project access does not depend on the currently selected workspace.
    await this.library.access(
      sql,
      user,
      { kind: "asset", row },
      row.workspace_id,
    );
    requireValue(row.document, 503, "原画布文档尚未完成迁移");
    return row;
  }
  private workspace(sql: Sql, user: Actor, selected?: string) {
    if (selected === undefined) return this.identity.activeWorkspace(sql, user);
    // Python int accepts Unicode decimal digits and single underscores between digits.
    const value = selected
      .replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "")
      .replace(/\p{Decimal_Number}/gu, (digit) => {
        const point = digit.codePointAt(0)!;
        let zero = point;
        while (/\p{Decimal_Number}/u.test(String.fromCodePoint(zero - 1)))
          zero--;
        return String((point - zero) % 10);
      });
    requireValue(/^[+-]?\d(?:_?\d)*$/.test(value), 400, "工作区标识无效");
    const digits = value.replaceAll("_", "");
    requireValue(
      digits.replace(/^[+-]/, "").length <= 4300,
      400,
      "工作区标识无效",
    );
    const id = BigInt(digits);
    requireValue(
      id >= -(2n ** 63n) && id < 2n ** 63n,
      500,
      "工作区标识超出范围",
    );
    return this.identity.requireWorkspace(sql, user, id);
  }
  publicProject(row: any, user: Actor) {
    return {
      id: row.public_id,
      title: canvasText(row.original_title),
      owner: Number(row.owner_number),
      created: Number(row.created),
      updated: Number(row.updated),
      archived_at: row.archived_at === null ? null : Number(row.archived_at),
      revision: row.revision,
      last_editor: Number(row.editor_number),
      workspace: Number(row.workspace_number),
      document: canvasDocumentJson(row.document),
      can_delete: canManageCanvas(row.owner_id, user),
    };
  }
  async get(user: Actor, key: string) {
    return this.p.db.transaction(async (sql) => {
      await sql.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      return this.publicProject(await this.project(sql, user, key), user);
    });
  }
  private async limit(sql: Sql, wid: string) {
    await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "canvas-space:" + wid,
    ]);
    const row = await one(
      sql,
      "SELECT count(*) AS count FROM canvas_documents c JOIN documents d ON d.id=c.project_id WHERE d.workspace_id=$1",
      [wid],
    );
    requireValue(
      Number(row.count) < 200,
      409,
      "画布数量已达 200，请先整理旧画布",
    );
  }
  private async insert(
    sql: Sql,
    user: Actor,
    wid: string,
    title: string,
    document: CanvasDocument,
  ) {
    const id = randomUUID(),
      key = randomUUID().replaceAll("-", ""),
      created = Math.floor(this.clock()),
      updated = Math.floor(this.clock());
    // The prototype gets only a marker; it cannot read or overwrite the raw authority.
    await sql.query(
      `INSERT INTO documents(id,public_id,workspace_id,owner_id,kind,title,body,updated_at)
      VALUES($1,$2,$3,$4,'canvas','','{"originalCanvas":1}',to_timestamp($5))`,
      [id, key, wid, user.id, updated],
    );
    await sql.query(
      "INSERT INTO canvas_documents(project_id,title,document,created,updated,last_editor) VALUES($1,$2,$3,$4,$5,$6)",
      [
        id,
        canvasBytes(title),
        canvasDocumentBytes(document),
        created,
        updated,
        user.id,
      ],
    );
    return this.project(sql, user, key, true);
  }
  async nodes(sql: Sql, id: string, document: CanvasDocument) {
    await sql.query("DELETE FROM canvas_nodes WHERE project_id=$1", [id]);
    if (document.nodes.length)
      await sql.query(
        "INSERT INTO canvas_nodes(project_id,node) SELECT $1,unnest($2::text[])",
        [id, document.nodes.map((node) => node.id)],
      );
  }
  async createBoundCanvas(
    sql: Sql,
    user: Actor,
    wid: string,
    title: string,
    document: CanvasDocument,
  ) {
    await this.limit(sql, wid);
    const row = await this.insert(sql, user, wid, title, document);
    await this.nodes(sql, row.id, document);
    return row;
  }
  async importProject(
    sql: Sql,
    user: Actor,
    workspace: string,
    title: string,
    raw: unknown,
  ) {
    await this.limit(sql, workspace);
    const document = parseCanvasDocument(raw);
    const row = await this.insert(sql, user, workspace, title, document);
    await this.references(sql, user, row, document, null);
    await this.nodes(sql, row.id, document);
    return { id: String(row.public_id), title };
  }
  async create(user: Actor, value: unknown, selected?: string) {
    const body = parseBody(value, canvasNewFields, true),
      template = body.template ? canvasTemplates[body.template] : undefined;
    const title =
      template && !Object.hasOwn(value as object, "title")
        ? template[0]
        : pythonStrip(body.title);
    requireValue(title, 400, "请输入画布名称");
    return this.p.db.transaction(async (sql) => {
      const workspace = await this.workspace(sql, user, selected);
      await this.limit(sql, workspace.id);
      const raw: any = {};
      if (template) {
        raw.nodes = [
          { id: "reference", type: "image", title: "共用参考图", x: 0, y: 0 },
        ];
        raw.edges = [];
        raw.shots = [];
        const model = (
          await CanvasModels.read(sql, { allowIncomplete: true })
        ).template(
          await new StudioCatalog(this.p.db).effective(sql, workspace.id),
        );
        for (const [i, [name, text]] of template[2].entries()) {
          const index = i + 1,
            label = String(index).padStart(2, "0");
          raw.nodes.push(
            {
              id: `script-${index}`,
              type: "text",
              title: `${label} · ${name}提示词`,
              x: index * 400,
              y: 0,
              text,
            },
            {
              id: `shot-${index}`,
              type: "video",
              title: `${label} · ${name}`,
              x: index * 400,
              y: 330,
              params: { ratio: body.ratio, model },
            },
          );
          raw.edges.push({
            id: `prompt-${index}`,
            source: `script-${index}`,
            target: `shot-${index}`,
          });
          raw.shots.push(`shot-${index}`);
        }
      }
      const document = parseCanvasDocument(raw);
      const row = await this.insert(sql, user, workspace.id, title, document);
      await this.nodes(sql, row.id, document);
      return this.publicProject(row, user);
    });
  }
  mediaForNode = canvasNodeMedia;
  private async listCoverJobs(
    sql: Sql,
    pending: { project: string; node: CanvasNode }[],
  ) {
    const media = new Map<CanvasNode, string | null>();
    if (!pending.length) return media;
    const { rows } = await sql.query<{
      position: string;
      state: string;
      result: string | null;
    }>(
      `SELECT n.position,j.state,j.result
      FROM unnest($1::uuid[], $2::text[], $3::bigint[]) WITH ORDINALITY
        AS n(project_id,node,active_job,position)
      CROSS JOIN LATERAL (
        ${selectNodeJob}
        WHERE l.project_id=n.project_id AND l.node=n.node
          AND (n.active_job IS NULL OR j.public_id=n.active_job)
        ORDER BY l.id DESC LIMIT 1
      ) j`,
      [
        pending.map(({ project }) => project),
        pending.map(({ node }) => node.id),
        pending.map(({ node }) => node.active_job),
      ],
    );
    for (const { position, state, result } of rows)
      media.set(
        pending[Number(position) - 1].node,
        state === "completed" ? result : null,
      );
    return media;
  }
  async videoForShot(
    sql: Sql,
    project: string,
    node: CanvasNode,
    adoptedOnly = false,
  ) {
    const key = await this.mediaForNode(sql, project, node, adoptedOnly);
    const { rows } = await sql.query<ShotVideo>(
      "SELECT id,public_id,workspace_id,mime,size FROM assets WHERE public_id=$1 AND original_kind='video' AND state='ready' FOR SHARE",
      [key],
    );
    return rows[0];
  }
  private async lockShotVideos(sql: Sql, project: string, shots: CanvasNode[]) {
    await sql.query("SAVEPOINT shot_videos");
    let rows: (ShotVideo & { position: number })[];
    try {
      ({ rows } = await sql.query<ShotVideo & { position: number }>(
        `SELECT n.position::int,a.id,a.public_id,a.workspace_id,a.mime,a.size
        FROM unnest($2::text[],$3::bigint[],$4::text[],$5::boolean[])
          WITH ORDINALITY AS n(node,active_job,media_id,use_media,position)
        LEFT JOIN LATERAL (
          ${selectNodeJob}
          WHERE NOT n.use_media AND l.project_id=$1 AND l.node=n.node
            AND (n.active_job IS NULL OR j.public_id=n.active_job)
          ORDER BY l.id DESC LIMIT 1
        ) j ON true
        JOIN assets a ON a.public_id=CASE
          WHEN n.use_media OR j.state IS NULL THEN n.media_id
          WHEN j.state='completed' THEN j.result
        END AND a.original_kind='video' AND a.state='ready'
        ORDER BY n.position FOR SHARE OF a NOWAIT`,
        [
          project,
          shots.map((node) => node.id),
          shots.map((node) => (node.use_media ? null : node.active_job)),
          shots.map((node) => node.media_id),
          shots.map((node) => node.use_media),
        ],
      ));
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "55P03"))
        throw error;
      // A later asset must not block a request that fails on an earlier shot.
      await sql.query("ROLLBACK TO SAVEPOINT shot_videos");
      await sql.query("RELEASE SAVEPOINT shot_videos");
      return undefined;
    }
    await sql.query("RELEASE SAVEPOINT shot_videos");
    return new Map(rows.map((row) => [row.position - 1, row]));
  }
  async downloadShots(user: Actor, key: string, value: unknown) {
    const body = parseBody(value, canvasExactRevisionFields, true);
    return this.p.db.transaction(async (sql) => {
      const project = await this.project(sql, user, key, true);
      requireValue(
        project.revision === body.expected_revision,
        409,
        canvasConflict,
      );
      const document = parseCanvasDocument(
        canvasDocumentJson(project.document),
      );
      requireValue(document.shots?.length, 400, "请先添加镜头");
      const nodes = new Map(document.nodes.map((node) => [node.id, node]));
      const shots = document.shots.map((id) => nodes.get(id)!);
      // Legacy job IDs outside the safe integer range must be looked up in shot order.
      const canBatch =
        shots.length > 1 &&
        shots.every(
          (shot) =>
            shot &&
            (shot.use_media ||
              shot.active_job === null ||
              Number.isSafeInteger(shot.active_job)),
        );
      const videos = canBatch
        ? await this.lockShotVideos(sql, project.id, shots)
        : undefined;
      const access = videos
        ? this.library.bulkAccess(sql, user, project.workspace_id)
        : (item: { kind: "asset"; row: ShotVideo }) =>
            this.library.access(sql, user, item, project.workspace_id);
      const manifest = [];
      for (const [index, shot] of shots.entries()) {
        const media = videos
          ? videos.get(index)
          : await this.videoForShot(sql, project.id, shot);
        const number = String(index + 1);
        requireValue(
          media,
          409,
          `镜头 ${number.padStart(2, "0")} 还没有可导出的视频`,
        );
        await access({ kind: "asset", row: media });
        manifest.push(archiveEntry(media, `镜头-${number.padStart(3, "0")}`));
      }
      return this.library.archiveTicket(sql, user, manifest);
    });
  }
  async list(user: Actor, selected?: string, archived = false) {
    return this.p.db.transaction(async (sql) => {
      await sql.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      const workspace = await this.workspace(sql, user, selected);
      const rows = (
        await sql.query(
          selectProject +
            ` WHERE d.workspace_id=$1 AND d.kind='canvas' AND NOT d.deleted AND c.project_id IS NOT NULL
              AND (c.archived_at IS NOT NULL) = $2
              ORDER BY ${archived ? "c.archived_at" : "c.updated"} DESC,d.public_id DESC LIMIT 200`,
          [workspace.id, archived],
        )
      ).rows;
      const pending: { project: string; node: CanvasNode }[] = [];
      const canvases = rows.map((row) => {
        const doc = parseCanvasDocument(canvasDocumentJson(row.document));
        const nodes = [];
        let pinned = 0;
        for (const node of doc.nodes) {
          if (node.type !== "image" && node.type !== "video") continue;
          nodes.push(node);
          if (node.use_media) {
            if (node.media_id && ++pinned === 4) break;
          } else if (
            node.active_job === null ||
            Number.isSafeInteger(node.active_job)
          )
            pending.push({ project: row.id, node });
        }
        return { row, count: doc.nodes.length, nodes };
      });
      const media = await this.listCoverJobs(sql, pending);
      const projects = [];
      for (const { row, count, nodes } of canvases) {
        const covers = [];
        for (const node of nodes) {
          const matched = media.get(node);
          // Legacy imports may store job numbers outside the native ID range.
          const key =
            !node.use_media &&
            node.active_job !== null &&
            !Number.isSafeInteger(node.active_job)
              ? await this.mediaForNode(sql, row.id, node)
              : matched === undefined
                ? node.media_id
                : matched;
          if (key) covers.push({ id: key, type: node.type });
          if (covers.length === 4) break;
        }
        const { document: _, ...project } = this.publicProject(row, user);
        projects.push({ ...project, count, covers });
      }
      return {
        projects,
        templates: Object.entries(canvasTemplates).map(
          ([id, [title, description, scenes]]) => ({
            id,
            title,
            description,
            shots: scenes.length,
          }),
        ),
      };
    });
  }
  private async lockResources(sql: Sql, document: CanvasDocument) {
    const jobs = [
      ...new Set(
        document.nodes
          .flatMap((n) => [n.active_job, n.narration_job, n.narration_pending])
          .filter((id): id is number => id !== null),
      ),
    ];
    // Lock job rows before assets, as settlement and deletion do. Canonical order
    // avoids deadlocks between canvases referencing the same resource set.
    if (jobs.length)
      await sql.query(
        "SELECT id FROM jobs WHERE public_id=ANY($1::bigint[]) ORDER BY id FOR SHARE",
        [jobs],
      );
    const keys = [
      ...new Set(
        document.nodes
          .flatMap((n) => [
            n.media_id,
            ...(n.extension?.definition.outputs.flatMap((p) =>
              p.kind !== "text" && n.extension?.result
                ? [n.extension.result[p.id]]
                : [],
            ) ?? []),
            ...n.params.h3_refs,
            n.params.h3?.first_frame,
            n.params.h3?.last_frame,
          ])
          .filter((id): id is string => !!id),
      ),
    ];
    await sql.query(
      `SELECT id FROM assets WHERE public_id=ANY($1::text[]) OR id IN (SELECT r.asset_id FROM job_assets r JOIN jobs j ON j.id=r.job_id WHERE j.public_id=ANY($2::bigint[]) AND r.role='output') ORDER BY id FOR SHARE`,
      [keys, jobs],
    );
    const packs = [
      ...new Set(document.nodes.flatMap((n) => n.asset_packs.map((p) => p.id))),
    ];
    await sql.query(
      "SELECT id FROM documents WHERE public_id=ANY($1::text[]) AND kind='pack' ORDER BY id FOR SHARE",
      [packs],
    );
  }
  private resources(
    sql: Sql,
    user: Actor,
    row: any,
  ): CanvasValidationResources {
    const authorize = (r: any) =>
      this.library.access(
        sql,
        user,
        { kind: "asset", row: r },
        row.workspace_id,
      );
    return {
      media: async (key) => {
        const r = await one(
          sql,
          "SELECT * FROM assets WHERE public_id=$1 AND state='ready'",
          [key],
        );
        return r
          ? {
              kind: r.original_kind,
              mime: r.mime,
              authorize: () => authorize(r),
            }
          : undefined;
      },
      pack: async (key) => {
        await this.packs.get(sql, user, key, row.workspace_id);
      },
      voice: async (node, key) => {
        const voice = await one(
          sql,
          `SELECT j.* FROM canvas_job_links l JOIN jobs j ON j.id=l.job_id
        WHERE l.project_id=$1 AND l.node=$2 AND j.public_id=$3 AND j.kind='audio' AND j.deleted_at IS NULL`,
          [row.id, node, key],
        );
        if (!voice) return undefined;
        const result = await this.library.result(sql, voice);
        return {
          result: result?.public_id ?? null,
          authorize: () => authorize(voice),
        };
      },
      active: async (node, key, kind) =>
        !!(await one(
          sql,
          `SELECT 1 FROM canvas_job_links l JOIN jobs j ON j.id=l.job_id
        WHERE l.project_id=$1 AND l.node=$2 AND j.public_id=$3 AND j.kind=$4 AND j.state='completed' AND j.deleted_at IS NULL
        AND EXISTS(SELECT 1 FROM job_assets r WHERE r.job_id=j.id AND r.role='output')`,
          [row.id, node, key, kind],
        )),
    };
  }
  directorScript(sql: Sql, workspaceId: string, key: string, lock = true) {
    return one(
      sql,
      `SELECT workspace_id, revision FROM workspace_script_documents
       WHERE public_id=$1 AND workspace_id=$2 AND entry_type='file' AND NOT deleted ${lock ? "FOR SHARE" : ""}`,
      [key, workspaceId],
    );
  }
  async references(
    sql: Sql,
    user: Actor,
    row: any,
    document: CanvasDocument,
    previousDirector: DirectorProduction | null = canvasDocumentJson(row.document).director ?? null,
    expectedScriptRevision?: number,
  ) {
    await validateCanvasDefinitions(
      sql,
      document.nodes.flatMap((n) =>
        n.extension ? [n.extension.definition] : [],
      ),
    );
    await this.lockResources(sql, document);
    const refs = await validateCanvasDocument(
      document,
      await CanvasModels.read(sql, { allowIncomplete: true }),
      this.resources(sql, user, row),
      previousDirector ?? undefined,
    );
    const director = document.director;
    if (expectedScriptRevision !== undefined) {
      requireValue(director?.script_revision === expectedScriptRevision, 400, "本集剧本版本与同步预览不一致");
    }
    if (
      director &&
      (expectedScriptRevision !== undefined || director.script_id !== previousDirector?.script_id ||
        director.script_revision !== previousDirector.script_revision)
    ) {
      const script = await this.directorScript(
        sql,
        row.workspace_id,
        director.script_id,
      );
      requireValue(script, 404, "主剧本文档不存在或无权访问");
      await this.library.access(
        sql,
        user,
        { kind: "asset", row: script },
        row.workspace_id,
      );
      if (expectedScriptRevision !== undefined) {
        requireValue(director.script_revision === script.revision, 409, directorScriptConflict);
      }
      requireValue(
        director.script_revision <= script.revision,
        409,
        "主剧本文档版本不存在",
      );
    }
    await sql.query("DELETE FROM canvas_media_refs WHERE project_id=$1", [
      row.id,
    ]);
    await sql.query("DELETE FROM document_assets WHERE document_id=$1", [
      row.id,
    ]);
    if (refs.length) {
      // Keep the original uniqueness failure for duplicate cross-role references.
      await sql.query(
        `WITH inserted_refs AS (
           INSERT INTO canvas_media_refs(project_id,node,asset_id)
           SELECT $1,r.node,a.id
           FROM unnest($2::text[],$3::text[]) WITH ORDINALITY AS r(node,media,ordinal)
           LEFT JOIN assets a ON a.public_id=r.media
           ORDER BY r.ordinal
           RETURNING asset_id
         )
         INSERT INTO document_assets(document_id,asset_id)
         SELECT DISTINCT $1,asset_id FROM inserted_refs
         ON CONFLICT DO NOTHING`,
        [row.id, refs.map((ref) => ref.node), refs.map((ref) => ref.media)],
      );
    }
    await this.packs.syncCanvas(sql, user, row.workspace_id, row.id, document);
  }
  async save(user: Actor, key: string, value: unknown) {
    const body = parseCanvasSave(value),
      title = pythonStrip(body.title);
    requireValue(title, 400, "请输入画布名称");
    return this.p.db.transaction(async (sql) => {
      const row = await this.project(sql, user, key, true);
      requireValue(
        row.revision === body.expected_revision,
        409,
        canvasConflict,
      );
      return this.saveLocked(sql, user, row, title, body.document, body.expected_script_revision);
    });
  }
  async saveLocked(
    sql: Sql,
    user: Actor,
    row: Record<string, any>,
    title: string,
    document: CanvasDocument,
    expectedScriptRevision?: number,
  ) {
    await this.references(sql, user, row, document, undefined, expectedScriptRevision);
    const stamp = Math.floor(this.clock());
    await sql.query(
      "UPDATE canvas_documents SET title=$2,document=$3,updated=$4,last_editor=$5 WHERE project_id=$1",
      [
        row.id,
        canvasBytes(title),
        canvasDocumentBytes(document),
        stamp,
        user.id,
      ],
    );
    await sql.query(
      "UPDATE documents SET revision=revision+1,updated_at=to_timestamp($2) WHERE id=$1",
      [row.id, stamp],
    );
    await this.nodes(sql, row.id, document);
    return {
      revision: row.revision + 1,
      updated: Math.floor(this.clock()),
      title,
      document,
    };
  }
  async duplicate(user: Actor, key: string) {
    return this.p.db.transaction(async (sql) => {
      const original = await this.project(sql, user, key, true);
      await this.limit(sql, original.workspace_id);
      await sql.query(
        "SELECT j.id FROM jobs j WHERE j.id IN (SELECT job_id FROM canvas_job_links WHERE project_id=$1) ORDER BY j.id FOR SHARE",
        [original.id],
      );
      const document = parseCanvasDocument(
        canvasDocumentJson(original.document),
      );
      const director = document.director;
      const episodeMembers = new Set(director?.shot_ids);
      if (director) {
        const script = await this.directorScript(
          sql,
          original.workspace_id,
          director.script_id,
        );
        if (!script || director.script_revision > script.revision) {
          delete document.director;
        } else {
          delete director.order_basis;
          if (director.shots) {
            director.shots = director.shots.map(({ node_id, source }) => ({
              node_id,
              ...(source ? { source } : {}),
            }));
          }
        }
      }
      for (const node of document.nodes)
        if (node.type === "image" || node.type === "video") {
          const inEpisode = episodeMembers.has(node.id);
          node.media_id = inEpisode
            ? ((await this.videoForShot(sql, original.id, node, true))?.public_id ?? null)
            : await this.mediaForNode(sql, original.id, node);
          node.active_job = null;
          node.use_media = !inEpisode || Boolean(node.media_id);
        }
      const row = await this.insert(
        sql,
        user,
        original.workspace_id,
        [...canvasText(original.original_title)].slice(0, 75).join("") +
          " 副本",
        document,
      );
      for (const node of document.nodes)
        for (const id of canvasVoiceIds(
          node.narration_job,
          node.narration_pending,
        )) {
          const link = await one(
            sql,
            `SELECT l.* FROM canvas_job_links l JOIN jobs j ON j.id=l.job_id
          WHERE l.project_id=$1 AND l.node=$2 AND j.public_id=$3 AND j.deleted_at IS NULL ORDER BY l.id LIMIT 1`,
            [original.id, "voice:" + node.id, id],
          );
          if (link)
            await sql.query(
              "INSERT INTO canvas_job_links(project_id,node,job_id,owner_id,uid,inputs,created) VALUES($1,$2,$3,$4,$5,$6,$7)",
              [
                row.id,
                "voice:" + node.id,
                link.job_id,
                user.id,
                randomUUID(),
                link.inputs,
                Math.floor(this.clock()),
              ],
            );
        }
      await this.references(sql, user, row, document, null);
      await this.nodes(sql, row.id, document);
      return this.publicProject(row, user);
    });
  }
  async setArchived(
    user: Actor,
    key: string,
    archived: boolean,
    expectedChange?: string,
  ) {
    return this.p.db.transaction(async (sql) => {
      const row = await this.project(sql, user, key, true);
      requireValue(
        canManageCanvas(row.owner_id, user),
        403,
        "只有创建者或管理员可以归档或恢复画布",
      );
      requireValue(
        expectedChange === undefined || expectedChange === row.archive_change_id,
        409,
        "归档状态已发生变化，无法撤销此操作",
      );
      const previous = row.archived_at === null ? null : Number(row.archived_at);
      if (archived === (previous !== null))
        return { archived_at: previous, undo_token: null };
      const next = archived ? Math.floor(this.clock()) : null;
      // Both directions rotate the change ID, including restorations to NULL.
      const changeId = randomUUID();
      await sql.query(
        "UPDATE canvas_documents SET archived_at=$2, archive_change_id=$3 WHERE project_id=$1",
        [row.id, next, changeId],
      );
      return {
        archived_at: next,
        undo_token: expectedChange === undefined ? changeId : null,
      };
    });
  }

  async extractTailFrame(user: Actor, key: string, nodeId: string) {
    return this.p.db.transaction(async (sql) => {
      const row = await this.project(sql, user, key);
      const doc = parseCanvasDocument(canvasDocumentJson(row.document));
      const node = doc.nodes.find((n) => n.id === nodeId && n.type === "video");
      requireValue(node, 404, "未找到对应的视频节点");
      const video = await this.videoForShot(sql, row.id, node);
      requireValue(video, 409, "该视频节点尚未生成完成");
      await this.library.access(
        sql,
        user,
        { kind: "asset", row: video },
        row.workspace_id,
      );
      const stored = await one(
        sql,
        "SELECT id,public_id,object_key FROM assets WHERE id=$1 AND state='ready'",
        [video.id],
      );
      requireValue(stored, 404, "视频文件不存在");
      const tail = await createTailFrameAsset(
        this.p,
        sql,
        user.id,
        row.workspace_id,
        {
          id: String(stored.id),
          public_id: String(stored.public_id),
          object_key: String(stored.object_key),
        },
        AbortSignal.timeout(45_000),
      );
      return {
        asset_id: tail.public_id,
        width: tail.width,
        height: tail.height,
        source_video: video.public_id as string,
      };
    });
  }
  /** F019: Crop a single cell from a 2x2 or 3x3 grid preview image node into a ready ref asset. */
  async gridCrop(user: Actor, key: string, nodeId: string, value: unknown) {
    const body = parseBody(value, canvasGridCropFields, true) as {
      rows: 2 | 3;
      cols: 2 | 3;
      row: number;
      col: number;
    };
    const source = await this.p.db.transaction(async (sql) => {
      const project = await this.project(sql, user, key);
      const doc = parseCanvasDocument(canvasDocumentJson(project.document));
      const node = doc.nodes.find((n) => n.id === nodeId);
      requireValue(
        node && (node.type === "image" || node.type === "video"),
        404,
        "未找到对应的画面节点",
      );
      const mediaKey = await this.mediaForNode(sql, project.id, node);
      requireValue(mediaKey, 409, "该节点尚未生成图片");
      const asset = await one(
        sql,
        "SELECT id, public_id, object_key, mime, workspace_id FROM assets WHERE public_id=$1 AND state='ready'",
        [mediaKey],
      );
      requireValue(asset, 404, "源图片不存在");
      await this.library.access(
        sql,
        user,
        { kind: "asset", row: asset },
        project.workspace_id,
      );
      return {
        sourceAssetId: String(asset.id),
        sourcePublicId: String(asset.public_id),
        sourceObjectKey: String(asset.object_key),
        sourceMime: String(asset.mime),
        workspaceId: String(project.workspace_id),
      };
    });
    const cropped = await cropGridCell(this.p, {
      ...source,
      ownerId: user.id,
      rows: body.rows,
      cols: body.cols,
      row: body.row,
      col: body.col,
    });
    return {
      asset_id: cropped.public_id,
      mime: cropped.mime,
      width: cropped.width,
      height: cropped.height,
      size: cropped.size,
      rows: cropped.rows,
      cols: cropped.cols,
      row: cropped.row,
      col: cropped.col,
    };
  }
  async remove(user: Actor, key: string) {
    return this.p.db.transaction(async (sql) => {
      const row = await this.project(sql, user, key, true);
      requireValue(
        canManageCanvas(row.owner_id, user),
        403,
        "只有创建者或管理员可以删除画布",
      );
      await sql.query(
        "DELETE FROM storyboard_exports WHERE project_id=$1 AND state!='done'",
        [row.id],
      );
      await sql.query("DELETE FROM document_assets WHERE document_id=$1", [
        row.id,
      ]);
      await sql.query("DELETE FROM documents WHERE id=$1", [row.id]);
      return { ok: true };
    });
  }
}
