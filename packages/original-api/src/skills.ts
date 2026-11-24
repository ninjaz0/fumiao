import { randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import type { Actor, Platform } from "@fumiao/platform/platform.js";
import { one, type Sql } from "@fumiao/platform/db.js";
import { requireValue } from "@fumiao/platform/security.js";
import { pythonStrip } from "@fumiao/plugin-sdk/python-values.js";
import { OriginalIdentity } from "./identity.js";
import { parseBody } from "./validation.js";
import { skillCreateFields, skillUpdateFields } from "./wave4-fields.js";

const MAX_SKILL_BYTES = 64 * 1024;
const MAX_ZIP_BYTES = 256 * 1024;

export { skillCreateFields, skillUpdateFields };

export type ParsedSkill = {
  slug: string;
  name: string;
  description: string;
  frontmatter: Record<string, unknown>;
  body_md: string;
};

export type ActiveSkillSnapshot = {
  id: string;
  slug: string;
  name: string;
  revision: number;
  body_md: string;
};

function normalizeSlug(raw: string): string {
  const clean = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return clean || "skill-" + randomUUID().slice(0, 8);
}

function parseSimpleYaml(yamlBlock: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yamlBlock.split(/\r?\n/);
  let currentListKey: string | null = null;
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const listItem = line.match(/^\s*-\s+(.*)$/);
    if (listItem && currentListKey) {
      const arr = Array.isArray(result[currentListKey])
        ? (result[currentListKey] as string[])
        : [];
      arr.push(listItem[1].trim().replace(/^["']|["']$/g, ""));
      result[currentListKey] = arr;
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const val = kv[2].trim();
    currentListKey = null;
    if (!val) {
      result[key] = [];
      currentListKey = key;
    } else if (val.startsWith("[") && val.endsWith("]")) {
      result[key] = val
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else if (val === "true" || val === "false") {
      result[key] = val === "true";
    } else {
      result[key] = val.replace(/^["']|["']$/g, "");
    }
  }
  return result;
}

/** Parses standard SKILL.md (YAML frontmatter + Markdown body) with <= 64 KiB guard. */
export function parseSkillMarkdown(
  rawMd: string,
  fallbackSlug?: string,
): ParsedSkill {
  requireValue(!rawMd.includes("\0"), 400, "SKILL.md 不能包含空字符");
  const byteLen = Buffer.byteLength(rawMd, "utf8");
  requireValue(
    byteLen > 0 && byteLen <= MAX_SKILL_BYTES,
    400,
    "SKILL.md 内容不能为空且不能超过 64 KiB",
  );
  const normalized = rawMd.replace(/^\uFEFF/, "");
  let frontmatter: Record<string, unknown> = {};
  let body = normalized;
  const fmMatch = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (fmMatch) {
    frontmatter = parseSimpleYaml(fmMatch[1]);
    body = fmMatch[2];
  }
  const bodyMd = body.trim();
  requireValue(bodyMd.length > 0, 400, "SKILL.md 正文指令不能为空");
  const rawName =
    typeof frontmatter.name === "string" && frontmatter.name.trim()
      ? frontmatter.name.trim()
      : fallbackSlug || "未命名技能";
  const description =
    typeof frontmatter.description === "string"
      ? frontmatter.description.trim().slice(0, 400)
      : "";
  const slug = normalizeSlug(
    typeof frontmatter.slug === "string" && frontmatter.slug.trim()
      ? frontmatter.slug
      : fallbackSlug || rawName,
  );
  return {
    slug,
    name: rawName.slice(0, 80),
    description,
    frontmatter,
    body_md: bodyMd,
  };
}

/**
 * Pure Node ZIP extractor for SKILL.md packages:
 * strictly rejects path traversal, nested absolute paths, and > 256 KiB total payloads.
 */
export function extractSkillFromZip(zipBytes: Buffer): ParsedSkill {
  requireValue(
    zipBytes.length >= 22 && zipBytes.length <= MAX_ZIP_BYTES,
    400,
    "ZIP 技能包大小无效（最大 256 KiB）",
  );
  // Find End of Central Directory signature 0x06054b50
  let eocdOffset = -1;
  for (
    let i = zipBytes.length - 22;
    i >= Math.max(0, zipBytes.length - 65_557);
    i--
  ) {
    if (zipBytes.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  requireValue(eocdOffset >= 0, 400, "无效的 ZIP 技能包文件");
  const totalEntries = zipBytes.readUInt16LE(eocdOffset + 10);
  const cdOffset = zipBytes.readUInt32LE(eocdOffset + 16);
  requireValue(totalEntries > 0 && totalEntries <= 64, 400, "ZIP 条目数超出限制");

  let pos = cdOffset;
  let skillText: string | null = null;
  let fallbackSlug: string | undefined;
  let totalUncompressed = 0;

  for (let i = 0; i < totalEntries; i++) {
    requireValue(
      pos + 46 <= zipBytes.length && zipBytes.readUInt32LE(pos) === 0x02014b50,
      400,
      "ZIP 目录损坏",
    );
    const method = zipBytes.readUInt16LE(pos + 10);
    const compSize = zipBytes.readUInt32LE(pos + 20);
    const uncompSize = zipBytes.readUInt32LE(pos + 24);
    const nameLen = zipBytes.readUInt16LE(pos + 28);
    const extraLen = zipBytes.readUInt16LE(pos + 30);
    const commentLen = zipBytes.readUInt16LE(pos + 32);
    const localHeaderOffset = zipBytes.readUInt32LE(pos + 42);
    const entryName = zipBytes
      .subarray(pos + 46, pos + 46 + nameLen)
      .toString("utf8");
    pos += 46 + nameLen + extraLen + commentLen;

    // Security: strictly forbid path traversal or absolute paths on ANY entry in the archive!
    requireValue(
      !entryName.startsWith("/") &&
        !entryName.startsWith("\\") &&
        !entryName.includes("..") &&
        !entryName.includes("\0") &&
        !/^[A-Za-z]:/.test(entryName),
      400,
      "ZIP 技能包包含不安全的路径",
    );

    totalUncompressed += uncompSize;
    requireValue(
      totalUncompressed <= MAX_ZIP_BYTES,
      400,
      "ZIP 技能包解压体积超出 256 KiB 限制",
    );

    const normalizedPath = entryName.replace(/\\/g, "/");
    const parts = normalizedPath.split("/").filter(Boolean);
    const isSkillMd =
      parts.length >= 1 &&
      parts.length <= 2 &&
      parts[parts.length - 1].toLowerCase() === "skill.md";
    if (!isSkillMd) continue;

    requireValue(
      uncompSize <= MAX_SKILL_BYTES,
      400,
      "SKILL.md 文件体积不能超过 64 KiB",
    );
    requireValue(
      localHeaderOffset + 30 <= zipBytes.length &&
        zipBytes.readUInt32LE(localHeaderOffset) === 0x04034b50,
      400,
      "ZIP 本地文件头损坏",
    );
    const lNameLen = zipBytes.readUInt16LE(localHeaderOffset + 26);
    const lExtraLen = zipBytes.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + lNameLen + lExtraLen;
    const rawSlice = zipBytes.subarray(dataStart, dataStart + compSize);
    requireValue(rawSlice.length === compSize, 400, "ZIP 数据截断");

    let inflated: Buffer;
    if (method === 0) {
      inflated = rawSlice;
    } else if (method === 8) {
      inflated = inflateRawSync(rawSlice, { maxOutputLength: MAX_SKILL_BYTES });
    } else {
      requireValue(false, 400, "不支持的 ZIP 压缩算法");
      return null as never;
    }
    skillText = inflated.toString("utf8");
    if (parts.length === 2) fallbackSlug = parts[0];
  }

  requireValue(skillText !== null, 400, "ZIP 包中未找到 SKILL.md");
  return parseSkillMarkdown(skillText!, fallbackSlug);
}

const workspaceAccess = `((w.kind='personal' AND w.owner_id=$2) OR
  (w.kind='team' AND ($3='admin' OR EXISTS(SELECT 1 FROM members m WHERE m.workspace_id=w.id AND m.user_id=$2))))`;

export class OriginalSkills {
  readonly identity: OriginalIdentity;
  constructor(readonly p: Platform) {
    this.identity = new OriginalIdentity(p);
  }
  private format(row: any) {
    return {
      id: row.public_id as string,
      workspace: Number(row.workspace_number),
      slug: row.slug as string,
      name: row.name as string,
      description: row.description as string,
      frontmatter: row.frontmatter ?? {},
      body_md: row.body_md as string,
      enabled: Boolean(row.enabled),
      revision: Number(row.revision),
      updated: Math.floor(new Date(row.updated_at).getTime() / 1000),
    };
  }
  async list(user: Actor, selected?: string) {
    return this.p.db.transaction(async (sql) => {
      const workspace = await this.identity.activeWorkspace(
        sql,
        user,
        selected,
      );
      const { rows } = await sql.query(
        `SELECT s.*, w.public_id AS workspace_number
         FROM workspace_skills s JOIN workspaces w ON w.id=s.workspace_id
         WHERE s.workspace_id=$1
         ORDER BY s.enabled DESC, s.updated_at DESC`,
        [workspace.id],
      );
      return { skills: rows.map((r) => this.format(r)) };
    });
  }
  async create(user: Actor, value: unknown, selected?: string) {
    const body = parseBody(value, skillCreateFields, true) as {
      raw_md?: string;
      slug?: string;
      name?: string;
      description?: string;
      body_md?: string;
      enabled: boolean;
    };
    const parsed: ParsedSkill = body.raw_md
      ? parseSkillMarkdown(body.raw_md, body.slug)
      : {
          slug: normalizeSlug(body.slug || body.name || ""),
          name: pythonStrip(body.name || ""),
          description: pythonStrip(body.description || ""),
          frontmatter: {},
          body_md: pythonStrip(body.body_md || ""),
        };
    requireValue(parsed.name, 400, "请输入技能名称");
    requireValue(parsed.body_md, 400, "请输入技能指令正文");
    requireValue(
      Buffer.byteLength(parsed.body_md, "utf8") <= MAX_SKILL_BYTES,
      400,
      "技能正文不能超过 64 KiB",
    );

    return this.p.db.transaction(async (sql) => {
      const workspace = await this.identity.activeWorkspace(
        sql,
        user,
        selected,
      );
      const existing = await one(
        sql,
        "SELECT id FROM workspace_skills WHERE workspace_id=$1 AND slug=$2",
        [workspace.id, parsed.slug],
      );
      requireValue(!existing, 409, `技能标识「${parsed.slug}」已存在`);
      const id = randomUUID();
      const publicId = randomUUID().replaceAll("-", "");
      await sql.query(
        `INSERT INTO workspace_skills(id, public_id, workspace_id, owner_id, slug, name, description, frontmatter, body_md, enabled)
         VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          id,
          publicId,
          workspace.id,
          user.id,
          parsed.slug,
          parsed.name,
          parsed.description,
          JSON.stringify(parsed.frontmatter),
          parsed.body_md,
          body.enabled,
        ],
      );
      const row = await one(
        sql,
        `SELECT s.*, w.public_id AS workspace_number
         FROM workspace_skills s JOIN workspaces w ON w.id=s.workspace_id
         WHERE s.id=$1`,
        [id],
      );
      return this.format(row);
    });
  }
  async importZip(user: Actor, zipBytes: Buffer, selected?: string) {
    const parsed = extractSkillFromZip(zipBytes);
    return this.p.db.transaction(async (sql) => {
      const workspace = await this.identity.activeWorkspace(
        sql,
        user,
        selected,
      );
      const existing = await one(
        sql,
        "SELECT id, public_id FROM workspace_skills WHERE workspace_id=$1 AND slug=$2 FOR UPDATE",
        [workspace.id, parsed.slug],
      );
      let id: string;
      if (existing) {
        id = existing.id;
        await sql.query(
          `UPDATE workspace_skills
           SET name=$2, description=$3, frontmatter=$4, body_md=$5, revision=revision+1, updated_at=now()
           WHERE id=$1`,
          [
            id,
            parsed.name,
            parsed.description,
            JSON.stringify(parsed.frontmatter),
            parsed.body_md,
          ],
        );
      } else {
        id = randomUUID();
        const publicId = randomUUID().replaceAll("-", "");
        await sql.query(
          `INSERT INTO workspace_skills(id, public_id, workspace_id, owner_id, slug, name, description, frontmatter, body_md, enabled)
           VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, true)`,
          [
            id,
            publicId,
            workspace.id,
            user.id,
            parsed.slug,
            parsed.name,
            parsed.description,
            JSON.stringify(parsed.frontmatter),
            parsed.body_md,
          ],
        );
      }
      const row = await one(
        sql,
        `SELECT s.*, w.public_id AS workspace_number
         FROM workspace_skills s JOIN workspaces w ON w.id=s.workspace_id
         WHERE s.id=$1`,
        [id],
      );
      return this.format(row);
    });
  }
  async update(user: Actor, key: string, value: unknown) {
    const body = parseBody(value, skillUpdateFields, true) as {
      expected_revision: number;
      raw_md?: string;
      name?: string;
      description?: string;
      body_md?: string;
      enabled?: boolean;
    };
    return this.p.db.transaction(async (sql) => {
      const row = await one(
        sql,
        `SELECT s.*, w.public_id AS workspace_number
         FROM workspace_skills s JOIN workspaces w ON w.id=s.workspace_id
         WHERE s.public_id=$1 AND ${workspaceAccess} FOR UPDATE OF s`,
        [key, user.id, user.role],
      );
      requireValue(row, 404, "技能不存在或无权访问");
      requireValue(
        Number(row.revision) === Number(body.expected_revision),
        409,
        "技能已被修改，请刷新后重试",
      );
      let nextName = row.name as string;
      let nextDesc = row.description as string;
      let nextFm = row.frontmatter ?? {};
      let nextBody = row.body_md as string;
      if (body.raw_md !== undefined) {
        const parsed = parseSkillMarkdown(body.raw_md, row.slug);
        nextName = parsed.name;
        nextDesc = parsed.description;
        nextFm = parsed.frontmatter;
        nextBody = parsed.body_md;
      } else {
        if (body.name !== undefined) nextName = pythonStrip(body.name);
        if (body.description !== undefined)
          nextDesc = pythonStrip(body.description);
        if (body.body_md !== undefined) nextBody = pythonStrip(body.body_md);
      }
      requireValue(nextName && nextBody, 400, "技能名称与正文不能为空");
      const nextEnabled =
        body.enabled !== undefined ? body.enabled : Boolean(row.enabled);
      await sql.query(
        `UPDATE workspace_skills
         SET name=$2, description=$3, frontmatter=$4, body_md=$5, enabled=$6, revision=revision+1, updated_at=now()
         WHERE id=$1`,
        [
          row.id,
          nextName,
          nextDesc,
          JSON.stringify(nextFm),
          nextBody,
          nextEnabled,
        ],
      );
      const updated = await one(
        sql,
        `SELECT s.*, w.public_id AS workspace_number
         FROM workspace_skills s JOIN workspaces w ON w.id=s.workspace_id
         WHERE s.id=$1`,
        [row.id],
      );
      return this.format(updated);
    });
  }
  async remove(user: Actor, key: string) {
    return this.p.db.transaction(async (sql) => {
      const row = await one(
        sql,
        `SELECT s.id, s.owner_id
         FROM workspace_skills s JOIN workspaces w ON w.id=s.workspace_id
         WHERE s.public_id=$1 AND ${workspaceAccess} FOR UPDATE OF s`,
        [key, user.id, user.role],
      );
      requireValue(row, 404, "技能不存在或无权访问");
      requireValue(
        row.owner_id === user.id || user.role === "admin",
        403,
        "只有创建者或管理员可以删除技能",
      );
      await sql.query("DELETE FROM workspace_skills WHERE id=$1", [row.id]);
      return { ok: true };
    });
  }
}

export async function loadActiveWorkspaceSkills(
  sql: Sql,
  workspaceId: string,
): Promise<ActiveSkillSnapshot[]> {
  const exists = await one(
    sql,
    "SELECT to_regclass('workspace_skills') IS NOT NULL AS ok",
  );
  if (!exists?.ok) return [];
  const { rows } = await sql.query(
    `SELECT public_id, slug, name, revision, body_md
     FROM workspace_skills
     WHERE workspace_id=$1 AND enabled=true
     ORDER BY updated_at DESC
     LIMIT 8`,
    [workspaceId],
  );
  return rows.map((r) => ({
    id: r.public_id as string,
    slug: r.slug as string,
    name: r.name as string,
    revision: Number(r.revision),
    body_md: r.body_md as string,
  }));
}

export async function snapshotTurnSkills(
  sql: Sql,
  turnId: string,
  skills: ActiveSkillSnapshot[],
): Promise<void> {
  if (!skills.length) return;
  const exists = await one(
    sql,
    "SELECT to_regclass('chat_turn_skill_snapshots') IS NOT NULL AS ok",
  );
  if (!exists?.ok) return;
  await sql.query(
    `INSERT INTO chat_turn_skill_snapshots(turn_id, snapshots)
     VALUES($1, $2)
     ON CONFLICT (turn_id) DO NOTHING`,
    [turnId, JSON.stringify(skills)],
  );
}
