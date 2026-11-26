import { createHash, randomUUID } from "node:crypto";
import type { Actor, Platform } from "@fumiao/platform/platform.js";
import { one, type Sql } from "@fumiao/platform/db.js";
import { DomainError, requireValue } from "@fumiao/platform/security.js";
import { pythonStrip } from "@fumiao/plugin-sdk/python-values.js";
import { OriginalIdentity } from "./identity.js";
import { OriginalCanvases } from "./canvases.js";
import { parseCanvasSave } from "./canvas-draft.js";
import { parseBody } from "./validation.js";
import {
  MAX_SCRIPT_BYTES,
  SCRIPT_DOC_KINDS as docKinds,
  scriptCreateFields,
  scriptReplaceFields,
  scriptSearchFields,
  scriptSuiteFields,
  scriptUpdateFields,
} from "./script-fields.js";

const MAX_DOCS_PER_WORKSPACE = 500;
const MAX_SEARCH_MATCHES = 500;

export function computeScriptDescendantsSignature(
  entries: ReadonlyArray<{ id: string; revision: number }>,
): string {
  const canonical = entries
    .map((e) => `${e.id}:${Number(e.revision)}`)
    .sort()
    .join(",");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export type ScriptDocKind =
  | "outline"
  | "script"
  | "assets"
  | "shotlist"
  | "notes";

export type ScriptEntryType = "file" | "directory";

export type ScriptDocumentSummary = {
  id: string;
  path: string;
  name: string;
  parent_path: string;
  entry_type: ScriptEntryType;
  doc_kind: ScriptDocKind;
  canvas_id: string | null;
  series_id: string | null;
  revision: number;
  char_count: number;
  line_count: number;
  preview: string;
  updated: number;
  can_delete: boolean;
};

export type ScriptDocumentDetail = ScriptDocumentSummary & {
  body_md: string;
};

export type ScriptSearchMatch = {
  start: number;
  end: number;
  line: number;
  column: number;
  before: string;
  text: string;
  after: string;
};

export {
  scriptCreateFields,
  scriptReplaceFields,
  scriptSearchFields,
  scriptSuiteFields,
  scriptUpdateFields,
};

export function normalizeScriptPath(
  raw: string,
  entryType: ScriptEntryType,
): string {
  requireValue(!raw.includes("\0"), 400, "路径不能包含空字符");
  const trimmed = raw.trim().replaceAll("\\", "/");
  requireValue(
    trimmed.length > 0 && !trimmed.startsWith("/") && !trimmed.endsWith("/"),
    400,
    "请输入有效的工作区相对路径",
  );
  const parts = trimmed.split("/");
  requireValue(parts.length <= 6, 400, "目录层级最多支持 6 层");
  const normalizedParts = parts.map((segment) => {
    const clean = segment.trim();
    requireValue(
      clean.length > 0 &&
        clean.length <= 120 &&
        clean !== "." &&
        clean !== ".." &&
        !/[<>:"|?*\x00-\x1f]/.test(clean) &&
        !/[. ]$/.test(clean) &&
        !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean),
      400,
      `路径片段「${segment}」不是有效名称`,
    );
    return clean;
  });
  let joined = normalizedParts.join("/");
  if (entryType === "file" && !/\.(md|markdown|txt)$/i.test(joined)) {
    joined += ".md";
  }
  requireValue(joined.length <= 240, 400, "路径长度不能超过 240 个字符");
  return joined;
}

function splitParent(path: string): { parent: string; name: string } {
  const idx = path.lastIndexOf("/");
  if (idx < 0) return { parent: "", name: path };
  return { parent: path.slice(0, idx), name: path.slice(idx + 1) };
}

export function buildScriptTemplate(
  kind: ScriptDocKind,
  projectTitle = "未命名短剧",
): string {
  if (kind === "outline") {
    return `# 《${projectTitle}》· 01 事件图谱与故事骨架

- **规格**：9:16 竖屏 / 电影感叙事 / 单集约 90–120 秒
- **核心钩子**：前 3 秒抛出高反差悬念，每 15 秒一次信息反转。

## 人物关系与核心动机

- **林墨（男主）**：冷静敏锐，试图在倒计时结束前找出隐藏的真相。
- **苏晚（女主）**：手握关键线索，表面克制但暗藏秘密。

## 分集骨架总览

1. **EP01 觉醒**：封闭空间初醒，发现规则与倒计时座钟。
2. **EP02 试探**：首轮博弈，关键道具暴露矛盾。
3. **EP03 破局**：反转揭晓，引出下一幕悬念。
`;
  }
  if (kind === "assets") {
    return `# 《${projectTitle}》· 03 资产清单与一致性提示词

## 角色资产（Character Turnarounds）

- **CH01 林墨**：26岁青年男性，利落黑发，深灰连帽卫衣外搭暗色风衣，眼神冷静锐利，写实电影光影，三视图一致。
- **CH02 苏晚**：24岁青年女性，微卷长发，米白针织衫配深色长裙，神情克制警觉，柔和侧逆光，三视图一致。

## 场景资产（Scene Environments）

- **SC01 封闭密室（夜/内）**：灰白斑驳方格墙面，中央老旧实木圆桌，顶悬钨丝灯摇晃投下暖黄光圈，空气悬浮微尘。

## 关键道具（Props）

- **PR01 黄铜座钟**：复古雕花黄铜外壳，玻璃表盘裂纹，指针停在 11:55。
`;
  }
  if (kind === "shotlist") {
    return `# 《${projectTitle}》· 04 导演简报与分镜片段表

| 镜号 | 场次 | 景别/运镜 | 时长 | 画面提示词摘要 | 台词/旁白 |
| --- | --- | --- | --- | --- | --- |
| 01 | S01 | 特写 / 缓推 | 5s | 顶悬钨丝灯忽明忽暗，黄铜座钟指针颤动，林墨在圆桌旁猛然睁眼 | （钟摆低沉回响） |
| 02 | S01 | 中近景 / 过肩 | 5s | 林墨按住空荡口袋看向对面，苏晚隔着圆桌凝视他，暖光勾勒侧脸 | 苏晚：你也发现口袋空了吗？ |
| 03 | S01 | 全景 / 俯拍微拉 | 10s | 密室圆桌全貌，两人对峙，顶灯骤闪照亮墙角暗门轮廓 | 林墨：倒计时只剩五分钟，先找出口。 |
`;
  }
  return `# 《${projectTitle}》· 02 分集剧本 EP01

- **画幅与时长**：9:16 竖屏 · 约 20 秒样片段
- **出场资产**：@林墨、@苏晚、@封闭密室、@黄铜座钟

---

## EP01 倒计时五分钟

### S01 封闭密室 夜 内

人物：林墨、苏晚

△老旧钨丝灯被黑色电线吊在密室正中，光忽明忽暗，空气里全是浮尘。中央斑驳实木圆桌上摆着一座裂纹黄铜座钟，指针停在 11:55。林墨猛然睁开眼，抬手按了一下外套口袋，空的。

苏晚：别找了，进来之前所有人的手机都被清空了。

△林墨抬头看向圆桌对面的苏晚，目光落在她身侧半开的旧怀表盒上，镜头缓慢推进至特写。

林墨：座钟还在走——离十二点只剩五分钟，门锁机关一定在屋里。

### S02 密室暗门 夜 内

人物：林墨、苏晚

△顶灯骤然闪烁两下，林墨起身绕过圆桌走向北侧斑驳石墙，手指抚过墙砖缝隙，一道暗门轮廓在冷暖交错光影中浮现。

苏晚：等等，墙上的刻痕和表盘数字是一样的！
`;
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findLiteralMatches(
  text: string,
  needle: string,
  caseSensitive: boolean,
  limit: number,
): { matches: ScriptSearchMatch[]; truncated: boolean } {
  if (!needle) return { matches: [], truncated: false };

  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) lineStarts.push(i + 1);
  }

  const locateLine = (offset: number) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (lineStarts[mid] <= offset) low = mid + 1;
      else high = mid - 1;
    }
    const lineIdx = Math.max(0, high);
    const lineStart = lineStarts[lineIdx];
    let lineEnd = text.indexOf("\n", lineStart);
    if (lineEnd < 0) lineEnd = text.length;
    if (lineEnd > lineStart && text.charCodeAt(lineEnd - 1) === 13) lineEnd--;
    return {
      line: lineIdx + 1,
      column: offset - lineStart + 1,
      lineStart,
      lineEnd,
    };
  };

  const re = new RegExp(escapeRegExp(needle), caseSensitive ? "g" : "gi");
  const matches: ScriptSearchMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    if (matches.length >= limit) {
      return { matches, truncated: true };
    }
    const found = m.index;
    const end = found + m[0].length;
    const loc = locateLine(found);
    const snippetStart = Math.max(loc.lineStart, found - 36);
    const snippetEnd = Math.min(loc.lineEnd, end + 48);
    matches.push({
      start: found,
      end,
      line: loc.line,
      column: loc.column,
      before:
        (snippetStart > loc.lineStart ? "…" : "") +
        text.slice(snippetStart, found),
      text: text.slice(found, end),
      after:
        text.slice(end, snippetEnd) + (snippetEnd < loc.lineEnd ? "…" : ""),
    });
  }
  return { matches, truncated: false };
}

export class OriginalScriptDocuments {
  readonly identity: OriginalIdentity;
  readonly canvases: OriginalCanvases;

  constructor(readonly p: Platform) {
    this.identity = new OriginalIdentity(p);
    this.canvases = new OriginalCanvases(p);
  }

  private async resolveWorkspace(sql: Sql, user: Actor, selected?: string) {
    const workspace = await this.identity.activeWorkspace(sql, user, selected);
    requireValue(
      !user.tokenWorkspaceId || workspace.id === user.tokenWorkspaceId,
      403,
      "API Token 无权跨工作区访问剧本文档",
    );
    return workspace;
  }

  private async resolveCanvasUuid(
    sql: Sql,
    workspaceId: string,
    canvasPublicId: string | null | undefined,
  ): Promise<string | null> {
    if (!canvasPublicId) return null;
    const row = await one(
      sql,
      "SELECT id FROM documents WHERE public_id=$1 AND workspace_id=$2 AND kind='canvas' AND NOT deleted",
      [canvasPublicId, workspaceId],
    );
    requireValue(row, 404, "关联的画布不存在或不属于当前工作区");
    return String(row.id);
  }

  private async resolveSeriesUuid(
    sql: Sql,
    workspaceId: string,
    seriesPublicId: string | null | undefined,
  ): Promise<string | null> {
    if (!seriesPublicId) return null;
    const row = await one(
      sql,
      "SELECT id FROM series WHERE public_id=$1 AND workspace_id=$2 AND NOT deleted",
      [seriesPublicId, workspaceId],
    );
    requireValue(row, 404, "关联的剧集不存在或不属于当前工作区");
    return String(row.id);
  }

  private formatSummary(row: any, user: Actor): ScriptDocumentSummary {
    const path = String(row.path);
    const { parent, name } = splitParent(path);
    const body = String(row.body_md ?? "");
    const entryType = (
      row.entry_type === "directory" ? "directory" : "file"
    ) as ScriptEntryType;
    const lines =
      entryType === "directory"
        ? 0
        : body.length === 0
          ? 0
          : body.split("\n").length;
    const preview =
      entryType === "directory"
        ? ""
        : body
            .replace(/^#+\s*/gm, "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 100);
    return {
      id: String(row.public_id),
      path,
      name,
      parent_path: parent,
      entry_type: entryType,
      doc_kind: (docKinds.includes(row.doc_kind)
        ? row.doc_kind
        : "script") as ScriptDocKind,
      canvas_id: row.canvas_public_id ? String(row.canvas_public_id) : null,
      series_id: row.series_public_id ? String(row.series_public_id) : null,
      revision: Number(row.revision),
      char_count: [...body].length,
      line_count: lines,
      preview,
      updated: Math.floor(new Date(row.updated_at).getTime() / 1000),
      can_delete: row.owner_id === user.id || user.role === "admin",
    };
  }

  private formatDetail(row: any, user: Actor): ScriptDocumentDetail {
    return {
      ...this.formatSummary(row, user),
      body_md: String(row.body_md ?? ""),
    };
  }

  private sortItems<
    T extends { path: string; parent_path: string; entry_type: ScriptEntryType },
  >(items: T[]): T[] {
    return [...items].sort((a, b) => {
      if (a.parent_path === b.parent_path) {
        if (a.entry_type !== b.entry_type) {
          return a.entry_type === "directory" ? -1 : 1;
        }
        return a.path.localeCompare(b.path, "zh-CN", { numeric: true });
      }
      return a.path.localeCompare(b.path, "zh-CN", { numeric: true });
    });
  }

  private async countMissingParents(
    sql: Sql,
    workspaceId: string,
    filePath: string,
  ): Promise<number> {
    const segments = filePath.split("/").slice(0, -1);
    let current = "";
    let missing = 0;
    for (const seg of segments) {
      current = current ? `${current}/${seg}` : seg;
      const existing = await one(
        sql,
        `SELECT entry_type FROM workspace_script_documents
         WHERE workspace_id=$1 AND lower(path)=lower($2) AND NOT deleted`,
        [workspaceId, current],
      );
      if (existing) {
        requireValue(
          existing.entry_type === "directory",
          409,
          `父路径「${current}」已是文件，不能作为文件夹`,
        );
      } else {
        missing++;
      }
    }
    return missing;
  }

  private async ensureParentDirectories(
    sql: Sql,
    workspaceId: string,
    userId: string,
    filePath: string,
  ): Promise<string> {
    const parts = filePath.split("/");
    const leaf = parts.at(-1)!;
    const parentSegments = parts.slice(0, -1);
    let canonicalParent = "";
    for (const seg of parentSegments) {
      const candidate = canonicalParent ? `${canonicalParent}/${seg}` : seg;
      const existing = await one(
        sql,
        `SELECT id, path, entry_type FROM workspace_script_documents
         WHERE workspace_id=$1 AND lower(path)=lower($2) AND NOT deleted`,
        [workspaceId, candidate],
      );
      if (existing) {
        requireValue(
          existing.entry_type === "directory",
          409,
          `父路径「${candidate}」已是文件，不能作为文件夹`,
        );
        canonicalParent = String(existing.path);
        continue;
      }
      await sql.query(
        `INSERT INTO workspace_script_documents
          (id, public_id, workspace_id, owner_id, last_editor, path, entry_type, doc_kind, body_md)
         VALUES ($1, $2, $3, $4, $4, $5, 'directory', 'notes', '')`,
        [
          randomUUID(),
          randomUUID().replaceAll("-", ""),
          workspaceId,
          userId,
          candidate,
        ],
      );
      canonicalParent = candidate;
    }
    return canonicalParent ? `${canonicalParent}/${leaf}` : leaf;
  }

  private async queryByPublicId(
    sql: Sql,
    workspaceId: string,
    publicId: string,
    lock = false,
  ) {
    requireValue(!publicId.includes("\0"), 404, "剧本文档不存在或已删除");
    if (lock) {
      const locked = await one(
        sql,
        `SELECT id FROM workspace_script_documents
         WHERE workspace_id=$1 AND public_id=$2 AND NOT deleted FOR UPDATE`,
        [workspaceId, publicId],
      );
      requireValue(locked, 404, "剧本文档不存在或已删除");
    }
    const row = await one(
      sql,
      `SELECT d.*,
              c.public_id AS canvas_public_id,
              s.public_id AS series_public_id
         FROM workspace_script_documents d
         LEFT JOIN documents c ON c.id = d.canvas_project_id AND NOT c.deleted
         LEFT JOIN series s ON s.id = d.series_id AND NOT s.deleted
        WHERE d.workspace_id=$1 AND d.public_id=$2 AND NOT d.deleted`,
      [workspaceId, publicId],
    );
    requireValue(row, 404, "剧本文档不存在或已删除");
    return row;
  }

  async list(user: Actor, selected?: string) {
    return this.p.db.transaction(async (sql) => {
      await sql.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      const workspace = await this.resolveWorkspace(sql, user, selected);
      const { rows } = await sql.query(
        `SELECT d.*,
                c.public_id AS canvas_public_id,
                s.public_id AS series_public_id
           FROM workspace_script_documents d
           LEFT JOIN documents c ON c.id = d.canvas_project_id AND NOT c.deleted
           LEFT JOIN series s ON s.id = d.series_id AND NOT s.deleted
          WHERE d.workspace_id=$1 AND NOT d.deleted`,
        [workspace.id],
      );
      const items = this.sortItems(
        rows.map((row) => this.formatSummary(row, user)),
      );
      return { items };
    });
  }

  async get(user: Actor, key: string, selected?: string) {
    return this.p.db.transaction(async (sql) => {
      await sql.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      const workspace = await this.resolveWorkspace(sql, user, selected);
      const row = await this.queryByPublicId(sql, workspace.id, key);
      return this.formatDetail(row, user);
    });
  }

  async create(user: Actor, value: unknown, selected?: string) {
    const body = parseBody(value, scriptCreateFields, true) as {
      path: string;
      entry_type: ScriptEntryType;
      doc_kind: ScriptDocKind;
      body_md: string;
      template: "blank" | ScriptDocKind | null;
      canvas_id: string | null;
      series_id: string | null;
    };
    const path = normalizeScriptPath(body.path, body.entry_type);
    const rawBody =
      body.entry_type === "directory"
        ? ""
        : body.body_md ||
          (body.template && body.template !== "blank"
            ? buildScriptTemplate(
                body.template as ScriptDocKind,
                splitParent(path).name.replace(/\.(md|markdown|txt)$/i, ""),
              )
            : "");
    requireValue(!rawBody.includes("\0"), 400, "文档正文不能包含空字符");
    requireValue(
      Buffer.byteLength(rawBody, "utf8") <= MAX_SCRIPT_BYTES,
      400,
      "单个剧本文档不能超过 512 KiB",
    );

    return this.p.db.transaction(async (sql) => {
      const workspace = await this.resolveWorkspace(sql, user, selected);
      await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "script-docs:" + workspace.id,
      ]);
      const countRow = await one(
        sql,
        "SELECT count(*) AS count FROM workspace_script_documents WHERE workspace_id=$1 AND NOT deleted",
        [workspace.id],
      );
      const duplicate = await one(
        sql,
        `SELECT 1 FROM workspace_script_documents
         WHERE workspace_id=$1 AND lower(path)=lower($2) AND NOT deleted`,
        [workspace.id, path],
      );
      requireValue(!duplicate, 409, `同名文件或文件夹「${path}」已存在`);

      const missingParents = await this.countMissingParents(
        sql,
        workspace.id,
        path,
      );
      requireValue(
        Number(countRow.count) + missingParents + 1 <= MAX_DOCS_PER_WORKSPACE,
        409,
        `工作区剧本文档数量已达上限 (${MAX_DOCS_PER_WORKSPACE})`,
      );

      const canonicalPath = await this.ensureParentDirectories(
        sql,
        workspace.id,
        user.id,
        path,
      );
      const canvasUuid = await this.resolveCanvasUuid(
        sql,
        workspace.id,
        body.canvas_id,
      );
      const seriesUuid = await this.resolveSeriesUuid(
        sql,
        workspace.id,
        body.series_id,
      );

      const id = randomUUID();
      const publicId = randomUUID().replaceAll("-", "");
      const docKind: ScriptDocKind =
        body.entry_type === "directory"
          ? "notes"
          : body.template && body.template !== "blank"
            ? (body.template as ScriptDocKind)
            : body.doc_kind;

      await sql.query(
        `INSERT INTO workspace_script_documents
          (id, public_id, workspace_id, owner_id, last_editor, series_id, canvas_project_id, path, entry_type, doc_kind, body_md)
         VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $10)`,
        [
          id,
          publicId,
          workspace.id,
          user.id,
          seriesUuid,
          canvasUuid,
          canonicalPath,
          body.entry_type,
          docKind,
          rawBody,
        ],
      );
      const created = await this.queryByPublicId(sql, workspace.id, publicId);
      return this.formatDetail(created, user);
    });
  }

  async createSuite(user: Actor, value: unknown, selected?: string) {
    const body = parseBody(value, scriptSuiteFields, true) as {
      folder: string;
      project_title: string;
      canvas_id: string | null;
      series_id: string | null;
    };
    const projectTitle = pythonStrip(body.project_title) || "新短剧企划";
    const folder = body.folder.trim()
      ? normalizeScriptPath(body.folder, "directory")
      : "";
    const prefix = folder ? `${folder}/` : "";

    const specs: { file: string; kind: ScriptDocKind }[] = [
      { file: `${prefix}01_事件图谱与故事骨架.md`, kind: "outline" },
      { file: `${prefix}02_分集剧本_EP01.md`, kind: "script" },
      { file: `${prefix}03_资产清单与提示词.md`, kind: "assets" },
      { file: `${prefix}04_导演简报与片段表.md`, kind: "shotlist" },
    ];

    return this.p.db.transaction(async (sql) => {
      const workspace = await this.resolveWorkspace(sql, user, selected);
      await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "script-docs:" + workspace.id,
      ]);
      const canvasUuid = await this.resolveCanvasUuid(
        sql,
        workspace.id,
        body.canvas_id,
      );
      const seriesUuid = await this.resolveSeriesUuid(
        sql,
        workspace.id,
        body.series_id,
      );

      const countRow = await one(
        sql,
        "SELECT count(*) AS count FROM workspace_script_documents WHERE workspace_id=$1 AND NOT deleted",
        [workspace.id],
      );
      const missingFolderDirs = folder
        ? await this.countMissingParents(sql, workspace.id, `${folder}/placeholder.md`)
        : 0;
      let newFileCount = 0;
      for (const spec of specs) {
        const existingSpec = await one(
          sql,
          `SELECT entry_type FROM workspace_script_documents
           WHERE workspace_id=$1 AND lower(path)=lower($2) AND NOT deleted`,
          [workspace.id, spec.file],
        );
        if (existingSpec) {
          requireValue(
            existingSpec.entry_type === "file",
            409,
            `目标路径「${spec.file}」已被同名文件夹占用`,
          );
        } else {
          newFileCount++;
        }
      }
      requireValue(
        Number(countRow.count) + missingFolderDirs + newFileCount <=
          MAX_DOCS_PER_WORKSPACE,
        409,
        `工作区剧本文档数量已达上限 (${MAX_DOCS_PER_WORKSPACE})`,
      );

      const createdIds: string[] = [];
      let canonicalFolder = folder;
      if (folder) {
        const canonicalPlaceholder = await this.ensureParentDirectories(
          sql,
          workspace.id,
          user.id,
          `${folder}/placeholder.md`,
        );
        canonicalFolder = splitParent(canonicalPlaceholder).parent;
        const dirRow = await one(
          sql,
          `SELECT public_id, entry_type FROM workspace_script_documents
           WHERE workspace_id=$1 AND lower(path)=lower($2) AND NOT deleted`,
          [workspace.id, canonicalFolder],
        );
        if (dirRow) {
          requireValue(
            dirRow.entry_type === "directory",
            409,
            `父路径「${canonicalFolder}」已是文件，不能作为文件夹`,
          );
          createdIds.push(String(dirRow.public_id));
        }
      }
      const canonicalPrefix = canonicalFolder ? `${canonicalFolder}/` : "";

      for (const spec of specs) {
        const fileName = splitParent(spec.file).name;
        const targetFilePath = `${canonicalPrefix}${fileName}`;
        const exists = await one(
          sql,
          `SELECT public_id, entry_type FROM workspace_script_documents
           WHERE workspace_id=$1 AND lower(path)=lower($2) AND NOT deleted`,
          [workspace.id, targetFilePath],
        );
        if (exists) {
          requireValue(
            exists.entry_type === "file",
            409,
            `目标路径「${targetFilePath}」已被同名文件夹占用`,
          );
          createdIds.push(String(exists.public_id));
          continue;
        }
        const publicId = randomUUID().replaceAll("-", "");
        await sql.query(
          `INSERT INTO workspace_script_documents
            (id, public_id, workspace_id, owner_id, last_editor, series_id, canvas_project_id, path, entry_type, doc_kind, body_md)
           VALUES ($1, $2, $3, $4, $4, $5, $6, $7, 'file', $8, $9)`,
          [
            randomUUID(),
            publicId,
            workspace.id,
            user.id,
            seriesUuid,
            canvasUuid,
            targetFilePath,
            spec.kind,
            buildScriptTemplate(spec.kind, projectTitle),
          ],
        );
        createdIds.push(publicId);
      }

      const { rows } = await sql.query(
        `SELECT d.*,
                c.public_id AS canvas_public_id,
                s.public_id AS series_public_id
           FROM workspace_script_documents d
           LEFT JOIN documents c ON c.id = d.canvas_project_id AND NOT c.deleted
           LEFT JOIN series s ON s.id = d.series_id AND NOT s.deleted
          WHERE d.workspace_id=$1 AND d.public_id = ANY($2::text[]) AND NOT d.deleted`,
        [workspace.id, createdIds],
      );
      return {
        created: this.sortItems(
          rows.map((row) => this.formatSummary(row, user)),
        ),
      };
    });
  }

  async update(user: Actor, key: string, value: unknown, selected?: string) {
    const body = parseBody(value, scriptUpdateFields, true) as {
      expected_revision: number;
      path?: string;
      doc_kind?: ScriptDocKind;
      body_md?: string;
      canvas_id?: string | null;
      series_id?: string | null;
    };
    if (body.body_md !== undefined) {
      requireValue(!body.body_md.includes("\0"), 400, "文档正文不能包含空字符");
      requireValue(
        Buffer.byteLength(body.body_md, "utf8") <= MAX_SCRIPT_BYTES,
        400,
        "单个剧本文档不能超过 512 KiB",
      );
    }

    return this.p.db.transaction(async (sql) => {
      const workspace = await this.resolveWorkspace(sql, user, selected);
      await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "script-docs:" + workspace.id,
      ]);
      const row = await this.queryByPublicId(sql, workspace.id, key, true);
      requireValue(
        Number(row.revision) === Number(body.expected_revision),
        409,
        "剧本文档已被其他成员或标签页修改，请先处理保存冲突。你的本地草稿已保留。",
      );

      const entryType = row.entry_type as ScriptEntryType;
      const currentPath = String(row.path);
      const requestedPath =
        body.path !== undefined
          ? normalizeScriptPath(body.path, entryType)
          : currentPath;
      let nextPath = requestedPath;

      if (requestedPath !== currentPath) {
        if (entryType === "directory") {
          requireValue(
            !requestedPath.toLowerCase().startsWith(currentPath.toLowerCase() + "/"),
            400,
            "不能将文件夹移动到其自身子目录中",
          );
        }
        const conflict = await one(
          sql,
          `SELECT 1 FROM workspace_script_documents
           WHERE workspace_id=$1 AND lower(path)=lower($2) AND id<>$3 AND NOT deleted`,
          [workspace.id, requestedPath, row.id],
        );
        requireValue(!conflict, 409, `目标路径「${requestedPath}」已存在`);

        const missingParents = await this.countMissingParents(
          sql,
          workspace.id,
          requestedPath,
        );
        if (missingParents > 0) {
          const countRow = await one(
            sql,
            "SELECT count(*) AS count FROM workspace_script_documents WHERE workspace_id=$1 AND NOT deleted",
            [workspace.id],
          );
          requireValue(
            Number(countRow.count) + missingParents <= MAX_DOCS_PER_WORKSPACE,
            409,
            `工作区剧本文档数量已达上限 (${MAX_DOCS_PER_WORKSPACE})`,
          );
        }
        nextPath = await this.ensureParentDirectories(
          sql,
          workspace.id,
          user.id,
          requestedPath,
        );

        if (entryType === "directory" && nextPath !== currentPath) {
          const { rows: children } = await sql.query(
            `SELECT id, path FROM workspace_script_documents
             WHERE workspace_id=$1 AND NOT deleted AND lower(path) LIKE $2 FOR UPDATE`,
            [
              workspace.id,
              currentPath.toLowerCase().replace(/[%_\\]/g, "\\$&") + "/%",
            ],
          );
          for (const child of children) {
            const suffix = String(child.path).slice(currentPath.length);
            const relocated = nextPath + suffix;
            const childConflict = await one(
              sql,
              `SELECT 1 FROM workspace_script_documents
               WHERE workspace_id=$1 AND lower(path)=lower($2) AND id<>$3 AND NOT deleted`,
              [workspace.id, relocated, child.id],
            );
            requireValue(
              !childConflict,
              409,
              `子文件目标路径「${relocated}」已存在`,
            );
            await sql.query(
              `UPDATE workspace_script_documents
                  SET path=$2, revision=revision+1, last_editor=$3, updated_at=now()
                WHERE id=$1`,
              [child.id, relocated, user.id],
            );
          }
        }
      }

      const nextDocKind =
        entryType === "directory"
          ? "notes"
          : (body.doc_kind ?? (row.doc_kind as ScriptDocKind));
      const nextBody =
        entryType === "directory"
          ? ""
          : body.body_md !== undefined
            ? body.body_md
            : String(row.body_md ?? "");
      const nextCanvasUuid =
        body.canvas_id !== undefined
          ? await this.resolveCanvasUuid(sql, workspace.id, body.canvas_id)
          : row.canvas_project_id;
      const nextSeriesUuid =
        body.series_id !== undefined
          ? await this.resolveSeriesUuid(sql, workspace.id, body.series_id)
          : row.series_id;

      await sql.query(
        `UPDATE workspace_script_documents
            SET path=$2,
                doc_kind=$3,
                body_md=$4,
                canvas_project_id=$5,
                series_id=$6,
                last_editor=$7,
                revision=revision+1,
                updated_at=now()
          WHERE id=$1`,
        [
          row.id,
          nextPath,
          nextDocKind,
          nextBody,
          nextCanvasUuid,
          nextSeriesUuid,
          user.id,
        ],
      );

      const updated = await this.queryByPublicId(sql, workspace.id, key);
      return this.formatDetail(updated, user);
    });
  }

  async remove(
    user: Actor,
    key: string,
    recursive = false,
    selected?: string,
    guards?: {
      expectedRevision?: number;
      expectedDescendants?: number;
      expectedRevisionSum?: number;
      expectedDescendantSig?: string;
    },
  ) {
    return this.p.db.transaction(async (sql) => {
      const workspace = await this.resolveWorkspace(sql, user, selected);
      await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "script-docs:" + workspace.id,
      ]);
      const row = await this.queryByPublicId(sql, workspace.id, key, true);
      requireValue(
        row.owner_id === user.id || user.role === "admin",
        403,
        "只有文档创建者或管理员可以删除该条目",
      );
      if (
        guards?.expectedRevision !== undefined &&
        Number.isFinite(guards.expectedRevision)
      ) {
        requireValue(
          Number(row.revision) === Number(guards.expectedRevision),
          409,
          "该条目在确认删除期间已被修改，已中止删除以保护新内容",
        );
      }

      if (row.entry_type === "directory") {
        const prefixPattern =
          String(row.path).toLowerCase().replace(/[%_\\]/g, "\\$&") + "/%";
        const { rows: descendants } = await sql.query(
          `SELECT id, public_id, owner_id, revision FROM workspace_script_documents
           WHERE workspace_id=$1 AND NOT deleted AND lower(path) LIKE $2 FOR UPDATE`,
          [workspace.id, prefixPattern],
        );
        if (descendants.length > 0 && !recursive) {
          throw new DomainError(
            409,
            "文件夹非空，请先移出内容或确认连同子文件一并删除",
          );
        }
        if (
          user.role !== "admin" &&
          descendants.some((d) => String(d.owner_id) !== user.id)
        ) {
          throw new DomainError(
            403,
            "文件夹中包含其他成员创建的文档，只有对应创建者或管理员可删除",
          );
        }
        if (
          guards?.expectedDescendants !== undefined &&
          Number.isFinite(guards.expectedDescendants) &&
          descendants.length !== Number(guards.expectedDescendants)
        ) {
          throw new DomainError(
            409,
            "文件夹内条目在确认删除期间有新增或变动，已中止删除，请刷新后核对",
          );
        }
        if (
          guards?.expectedRevisionSum !== undefined &&
          Number.isFinite(guards.expectedRevisionSum)
        ) {
          const actualSum = descendants.reduce(
            (sum, d) => sum + Number(d.revision),
            0,
          );
          if (actualSum !== Number(guards.expectedRevisionSum)) {
            throw new DomainError(
              409,
              "文件夹内的子文档在确认删除期间已被更新，已中止删除以保护新内容",
            );
          }
        }
        if (
          typeof guards?.expectedDescendantSig === "string" &&
          guards.expectedDescendantSig.trim() !== ""
        ) {
          const actualSig = computeScriptDescendantsSignature(
            descendants.map((d) => ({
              id: String(d.public_id),
              revision: Number(d.revision),
            })),
          );
          if (actualSig !== guards.expectedDescendantSig.trim().toLowerCase()) {
            throw new DomainError(
              409,
              "文件夹内子文档集合或版本在确认删除期间已发生变化，已中止删除，请刷新后核对",
            );
          }
        }
        if (descendants.length > 0) {
          await sql.query(
            `UPDATE workspace_script_documents
                SET deleted=true, updated_at=now()
              WHERE id = ANY($1::uuid[])`,
            [descendants.map((d) => d.id)],
          );
        }
      }

      await sql.query(
        `UPDATE workspace_script_documents
            SET deleted=true, updated_at=now()
          WHERE id=$1`,
        [row.id],
      );
      return { ok: true };
    });
  }

  async search(user: Actor, value: unknown, selected?: string) {
    const body = parseBody(value, scriptSearchFields, true) as {
      query: string;
      case_sensitive: boolean;
    };
    const needle = body.query;
    requireValue(needle.length > 0, 400, "请输入查找内容");

    const scriptScan = await this.p.db.transaction(async (sql) => {
      await sql.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      const workspace = await this.resolveWorkspace(sql, user, selected);
      const { rows } = await sql.query(
        `SELECT public_id, path, doc_kind, revision, body_md
           FROM workspace_script_documents
          WHERE workspace_id=$1 AND NOT deleted AND entry_type='file'`,
        [workspace.id],
      );
      const sorted = [...rows].sort((a, b) =>
        String(a.path).localeCompare(String(b.path), "zh-CN", {
          numeric: true,
        }),
      );

      let remaining = MAX_SEARCH_MATCHES;
      let totalMatches = 0;
      let scannedFiles = 0;
      let scriptTruncated = false;
      const files: {
        id: string;
        path: string;
        doc_kind: string;
        revision: number;
        body_md: string;
        matches: ScriptSearchMatch[];
        truncated: boolean;
      }[] = [];

      for (const row of sorted) {
        scannedFiles++;
        const text = String(row.body_md ?? "");
        if (!text) continue;
        const { matches, truncated } = findLiteralMatches(
          text,
          needle,
          body.case_sensitive,
          Math.max(1, remaining),
        );
        if (!matches.length) continue;
        totalMatches += matches.length;
        remaining = Math.max(0, remaining - matches.length);
        const fileTrunc = truncated || remaining === 0;
        if (fileTrunc) scriptTruncated = true;
        files.push({
          id: String(row.public_id),
          path: String(row.path),
          doc_kind: String(row.doc_kind),
          revision: Number(row.revision),
          body_md: text,
          matches,
          truncated: fileTrunc,
        });
        if (remaining === 0) {
          if (scannedFiles < sorted.length) scriptTruncated = true;
          break;
        }
      }

      return {
        scanned_files: scannedFiles,
        total_files: sorted.length,
        total_matches: totalMatches,
        files,
        remaining,
        truncated: scriptTruncated,
      };
    });

    // Also scan all accessible canvases in the workspace (workspace cap is 200 canvases)
    const canvasList = await this.canvases.list(user, selected);
    let remainingNodeBudget = Math.max(200, scriptScan.remaining);
    let canvasMatchCount = 0;
    let scannedCanvases = 0;
    let canvasTruncated = canvasList.projects.length > 200;
    const canvases: {
      canvas_id: string;
      canvas_title: string;
      revision: number;
      nodes: {
        node_id: string;
        node_title: string;
        node_type: string;
        field: "text" | "prompt";
        current_text: string;
        matches: ScriptSearchMatch[];
        truncated: boolean;
      }[];
    }[] = [];

    for (const proj of canvasList.projects.slice(0, 200)) {
      if (remainingNodeBudget <= 0) {
        canvasTruncated = true;
        break;
      }
      scannedCanvases++;
      const detail = await this.canvases.get(user, proj.id).catch(() => null);
      if (!detail?.document?.nodes?.length) continue;
      const hitNodes: (typeof canvases)[number]["nodes"] = [];
      for (let nIdx = 0; nIdx < detail.document.nodes.length; nIdx++) {
        if (remainingNodeBudget <= 0) {
          canvasTruncated = true;
          break;
        }
        const node = detail.document.nodes[nIdx];
        const field: "text" | "prompt" =
          node.type === "text" || node.type === "sticky" ? "text" : "prompt";
        const currentText = String(
          field === "text" ? (node.text ?? "") : (node.prompt ?? ""),
        );
        if (!currentText) continue;
        const { matches, truncated } = findLiteralMatches(
          currentText,
          needle,
          body.case_sensitive,
          Math.min(200, remainingNodeBudget),
        );
        if (!matches.length) continue;
        canvasMatchCount += matches.length;
        remainingNodeBudget = Math.max(0, remainingNodeBudget - matches.length);
        const nodeTrunc =
          truncated ||
          (remainingNodeBudget === 0 &&
            (nIdx < detail.document.nodes.length - 1 ||
              scannedCanvases < Math.min(200, canvasList.projects.length)));
        if (nodeTrunc) canvasTruncated = true;
        hitNodes.push({
          node_id: String(node.id),
          node_title: String(node.title ?? ""),
          node_type: String(node.type),
          field,
          current_text: currentText,
          matches,
          truncated: truncated || nodeTrunc,
        });
      }
      if (hitNodes.length > 0) {
        canvases.push({
          canvas_id: detail.id,
          canvas_title: detail.title,
          revision: detail.revision,
          nodes: hitNodes,
        });
      }
    }

    return {
      scanned_files: scriptScan.scanned_files,
      total_files: scriptScan.total_files,
      scanned_canvases: scannedCanvases,
      total_canvases: canvasList.projects.length,
      total_matches: scriptScan.total_matches + canvasMatchCount,
      truncated: scriptScan.truncated || canvasTruncated,
      files: scriptScan.files,
      canvases,
    };
  }

  async replace(user: Actor, value: unknown, selected?: string) {
    const body = parseBody(value, scriptReplaceFields, true) as {
      replacements: {
        id: string;
        expected_revision: number;
        expected_text: string;
        next_text: string;
      }[];
      canvas_replacements: {
        canvas_id: string;
        expected_revision: number;
        nodes: {
          node_id: string;
          expected_text: string;
          next_text: string;
        }[];
      }[];
    };
    requireValue(
      body.replacements.length > 0 || body.canvas_replacements.length > 0,
      422,
      "至少需要一项待替换目标",
    );
    const workspace = await this.p.db.transaction((sql) =>
      this.resolveWorkspace(sql, user, selected),
    );

    const results: {
      id: string;
      saved: boolean;
      revision?: number;
      error?: string;
    }[] = [];

    for (const item of body.replacements) {
      if (
        item.next_text.includes("\0") ||
        Buffer.byteLength(item.next_text, "utf8") > MAX_SCRIPT_BYTES
      ) {
        results.push({
          id: item.id,
          saved: false,
          error: "替换后内容无效或超出 512 KiB 限制",
        });
        continue;
      }
      try {
        const saved = await this.p.db.transaction(async (sql) => {
          const txWorkspace = await this.resolveWorkspace(sql, user, selected);
          requireValue(
            String(txWorkspace.id) === String(workspace.id),
            403,
            "工作区成员权限已变更",
          );
          const row = await one(
            sql,
            `SELECT * FROM workspace_script_documents
             WHERE workspace_id=$1 AND public_id=$2 AND NOT deleted AND entry_type='file'
             FOR UPDATE`,
            [txWorkspace.id, item.id],
          );
          if (!row) {
            throw new DomainError(404, "文档已删除或无权访问");
          }
          if (
            Number(row.revision) !== Number(item.expected_revision) ||
            String(row.body_md ?? "") !== item.expected_text
          ) {
            throw new DomainError(
              409,
              "文档内容已变化，保留原文，请重新搜索后再替换",
            );
          }
          await sql.query(
            `UPDATE workspace_script_documents
                SET body_md=$2, last_editor=$3, revision=revision+1, updated_at=now()
              WHERE id=$1`,
            [row.id, item.next_text, user.id],
          );
          return Number(row.revision) + 1;
        });
        results.push({ id: item.id, saved: true, revision: saved });
      } catch (err) {
        results.push({
          id: item.id,
          saved: false,
          error: err instanceof Error ? err.message : "替换失败",
        });
      }
    }

    const canvas_results: {
      canvas_id: string;
      saved: boolean;
      revision?: number;
      error?: string;
    }[] = [];

    for (const cItem of body.canvas_replacements) {
      try {
        const savedRevision = await this.p.db.transaction(async (sql) => {
          const row = await this.canvases.project(
            sql,
            user,
            cItem.canvas_id,
            true,
          );
          if (String(row.workspace_id) !== String(workspace.id)) {
            throw new DomainError(404, "画布不存在或不属于当前工作区");
          }
          if (Number(row.revision) !== Number(cItem.expected_revision)) {
            throw new DomainError(
              409,
              "画布已被修改，保留原节点文字，请重新搜索后再替换",
            );
          }
          const current = this.canvases.publicProject(row, user);
          const byNodeId = new Map(cItem.nodes.map((n) => [n.node_id, n]));
          const nextNodes = current.document.nodes.map((node: any) => {
            const patch = byNodeId.get(node.id);
            if (!patch) return node;
            const field: "text" | "prompt" =
              node.type === "text" || node.type === "sticky"
                ? "text"
                : "prompt";
            const actual = String(node[field] ?? "");
            if (actual !== patch.expected_text) {
              throw new DomainError(
                409,
                `节点「${node.title || node.id}」文字已变化，保留原文`,
              );
            }
            if ([...patch.next_text].length > 12000) {
              throw new DomainError(
                422,
                `节点「${node.title || node.id}」替换后超出 12000 字上限，已保留原文`,
              );
            }
            return { ...node, [field]: patch.next_text };
          });
          const parsed = parseCanvasSave({
            title: current.title,
            expected_revision: cItem.expected_revision,
            document: { ...current.document, nodes: nextNodes },
          });
          const savedCanvas = await this.canvases.saveLocked(
            sql,
            user,
            row,
            pythonStrip(parsed.title) || current.title,
            parsed.document,
          );
          return savedCanvas.revision;
        });
        canvas_results.push({
          canvas_id: cItem.canvas_id,
          saved: true,
          revision: savedRevision,
        });
      } catch (err) {
        canvas_results.push({
          canvas_id: cItem.canvas_id,
          saved: false,
          error: err instanceof Error ? err.message : "画布节点替换失败",
        });
      }
    }

    return { results, canvas_results };
  }
}
