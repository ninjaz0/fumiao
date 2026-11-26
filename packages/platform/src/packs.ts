import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor } from "./platform.js";
import { one, type Database, type Sql } from "./db.js";
import { requireValue } from "./security.js";
import { pythonStrip } from "@fumiao/plugin-sdk/python-text.js";

export const packVoiceProfileSchema = z
  .object({
    model: z.string().min(1).max(120).optional(),
    voice_id: z.string().min(1).max(120).optional(),
    instruction: z.string().max(300).optional(),
    emotion: z.string().max(40).optional(),
    rate: z.string().regex(/^[+-]?\d{1,3}%$/).optional(),
    pitch: z.string().regex(/^[+-]?\d{1,3}Hz$/).optional(),
    ref_audio_asset_id: z
      .string()
      .regex(/^[0-9a-f]{32}$/)
      .nullable()
      .optional(),
  })
  .strict();

export type PackVoiceProfile = z.infer<typeof packVoiceProfileSchema>;

export const packTurnaroundViewsSchema = z
  .object({
    front: z
      .string()
      .regex(/^[0-9a-f]{32}$/)
      .nullable()
      .optional(),
    side: z
      .string()
      .regex(/^[0-9a-f]{32}$/)
      .nullable()
      .optional(),
    back: z
      .string()
      .regex(/^[0-9a-f]{32}$/)
      .nullable()
      .optional(),
    sheet: z
      .string()
      .regex(/^[0-9a-f]{32}$/)
      .nullable()
      .optional(),
  })
  .strict();

export type PackTurnaroundViews = z.infer<typeof packTurnaroundViewsSchema>;

export type PackScope = "workspace" | "global";

export const packPurposes = {
  subject: "人物外观",
  outfit: "服装",
  scene: "场景",
  style: "风格",
  product: "产品细节",
} as const;
export const packInUse = "素材包正在画布中使用，请先在相关节点移除引用";
export const packLockedError = "素材包已锁定，请先解锁后再操作";
export type PackDraft = {
  name: string;
  purpose: keyof typeof packPurposes;
  description: string;
  media: string[];
  expected_revision: number | null;
  voice_profile?: PackVoiceProfile | null;
  turnaround_views?: PackTurnaroundViews | null;
  scope?: PackScope;
};
export type PackSelection = { id: string; revision: number };

const packWorkspaceAccess = `((w.kind='personal' AND w.owner_id=$2) OR
  (w.kind='team' AND ($3='admin' OR EXISTS(SELECT 1 FROM members m WHERE m.workspace_id=w.id AND m.user_id=$2))))`;

type PackViewRow = {
  public_id: string;
  workspace_public: string;
  owner_public: string;
  title: string;
  body: { assets?: string[]; description?: string; purpose?: string };
  pack_text?: { name: string; description: string } | null;
  voice_profile?: PackVoiceProfile | null;
  turnaround_views?: PackTurnaroundViews | null;
  locked?: boolean | null;
  scope?: PackScope | null;
  revision: number;
  updated_at: Date | string;
};

export function packStorage(name: string, description: string) {
  const titleHasNul = name.includes("\0");
  const descriptionHasNul = description.includes("\0");
  return {
    title: titleHasNul ? "" : name,
    description: descriptionHasNul ? "" : description,
    text:
      titleHasNul || descriptionHasNul
        ? JSON.stringify({ name, description })
        : null,
  };
}

async function packAssetKeys(sql: Sql, ids: string[]) {
  const keys = new Map<string, string>();
  if (ids.length) {
    const { rows } = await sql.query<{ id: string; public_id: string }>(
      "SELECT id,public_id FROM assets WHERE id=ANY($1::uuid[])",
      [ids],
    );
    for (const asset of rows) keys.set(asset.id, asset.public_id);
  }
  return keys;
}

function packView(row: PackViewRow, keys: ReadonlyMap<string, string>) {
  const media = (row.body.assets || []).map((id) => {
    const key = keys.get(id);
    requireValue(key !== undefined, 409, "素材包引用已失效");
    return key;
  });
  const { name, description } = row.pack_text ?? {
    name: row.title,
    description: row.body.description ?? "",
  };
  const hasTurnaround =
    row.turnaround_views &&
    Object.values(row.turnaround_views).some((v) => Boolean(v));
  return {
    id: row.public_id,
    workspace: Number(row.workspace_public),
    owner: Number(row.owner_public),
    name,
    purpose: row.body.purpose || "subject",
    description,
    revision: row.revision,
    updated: Math.floor(new Date(row.updated_at).getTime() / 1000),
    media,
    ...(row.voice_profile ? { voice_profile: row.voice_profile } : {}),
    ...(hasTurnaround ? { turnaround_views: row.turnaround_views } : {}),
    ...(row.locked ? { locked: true } : {}),
    ...(row.scope === "global" ? { scope: "global" as const } : {}),
  };
}

/** Packs share document UUIDs and asset relations with the platform. Only the
 * original transport converts those IDs to the pinned public identifiers. */
export class ReferencePacks {
  constructor(readonly db: Database) {}
  async get(
    sql: Sql,
    user: Actor,
    key: string,
    wid: string | undefined,
    publicKey = true,
    lock: "share" | "update" | undefined = undefined,
    allowGlobalRead = false,
  ) {
    const row = await one(
      sql,
      `SELECT d.*,m.voice_profile,m.turnaround_views,COALESCE(m.locked,false) AS locked,COALESCE(m.scope,'workspace') AS scope,
              w.public_id AS workspace_public,u.public_id AS owner_public
      FROM documents d JOIN workspaces w ON w.id=d.workspace_id JOIN users u ON u.id=d.owner_id
      LEFT JOIN asset_pack_meta m ON m.pack_id=d.id
      WHERE ${publicKey ? "d.public_id" : "d.id::text"}=$1 AND d.kind='pack' AND NOT d.deleted
      AND (
        (($4::uuid IS NULL OR w.id=$4) AND ${packWorkspaceAccess})
        ${allowGlobalRead ? "OR COALESCE(m.scope,'workspace')='global'" : ""}
      )
      ${lock ? `FOR ${lock === "share" ? "SHARE" : "UPDATE"} OF d` : ""}`,
      [key, user.id, user.role, wid || null],
    );
    requireValue(row, 404, "内容不存在或无权访问");
    return row;
  }
  async view(sql: Sql, row: any) {
    return packView(row, await packAssetKeys(sql, row.body.assets || []));
  }
  async list(user: Actor, wid: string) {
    return this.db.transaction(async (sql) => {
      await sql.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      const { rows } = await sql.query<
        PackViewRow & { can_access: boolean; is_local: boolean }
      >(
        `SELECT d.public_id,d.title,d.body,d.pack_text,m.voice_profile,m.turnaround_views,
                COALESCE(m.locked,false) AS locked,COALESCE(m.scope,'workspace') AS scope,
                d.revision,d.updated_at,
                w.public_id AS workspace_public,u.public_id AS owner_public,
                (d.workspace_id=$1) AS is_local,
                (CASE WHEN d.workspace_id=$1 THEN ${packWorkspaceAccess} ELSE true END) AS can_access
        FROM documents d JOIN workspaces w ON w.id=d.workspace_id JOIN users u ON u.id=d.owner_id
        LEFT JOIN asset_pack_meta m ON m.pack_id=d.id
        WHERE (
          d.workspace_id=$1
          OR (
            COALESCE(m.scope,'workspace')='global'
            AND EXISTS (
              SELECT 1 FROM workspaces w2 WHERE w2.id=$1 AND (
                (w2.kind='personal' AND w2.owner_id=$2)
                OR (w2.kind='team' AND ($3='admin' OR EXISTS(SELECT 1 FROM members m2 WHERE m2.workspace_id=w2.id AND m2.user_id=$2)))
              )
            )
          )
        ) AND d.kind='pack' AND NOT d.deleted
        ORDER BY (COALESCE(m.scope,'workspace')='global') ASC, d.updated_at DESC, d.public_id`,
        [wid, user.id, user.role],
      );
      // Preserve the 404 for a nonempty workspace whose access was revoked.
      const localRow = rows.find((r) => r.is_local);
      if (localRow)
        requireValue(localRow.can_access, 404, "内容不存在或无权访问");
      const ids = [...new Set(rows.flatMap((row) => row.body.assets || []))];
      const keys = await packAssetKeys(sql, ids);
      return {
        packs: rows.map((row) => packView(row, keys)),
        purposes: packPurposes,
      };
    });
  }
  async validate(sql: Sql, draft: PackDraft, wid: string, publicMedia = true) {
    requireValue(pythonStrip(draft.name), 400, "请输入素材包名称");
    requireValue(
      new Set(draft.media).size === draft.media.length,
      400,
      "素材包中不能重复添加图片",
    );
    const rows = (
      await sql.query(
        `SELECT id,public_id FROM assets WHERE ${publicMedia ? "public_id" : "id::text"}=ANY($1::text[])
      AND workspace_id=$2 AND original_kind='ref' AND state='ready' ORDER BY id FOR KEY SHARE`,
        [draft.media, wid],
      )
    ).rows;
    const ids = new Map(
      rows.map((a) => [publicMedia ? a.public_id : a.id, a.id]),
    );
    requireValue(
      draft.media.every((id) => ids.has(id)),
      404,
      "内容不存在或无权访问",
    );
    return draft.media.map((id) => ids.get(id)!);
  }
  async save(
    sql: Sql,
    user: Actor,
    wid: string,
    draft: PackDraft,
    existing?: string,
    publicKey = true,
    newId?: string,
    publicMedia = true,
  ) {
    const row = existing
      ? await this.get(sql, user, existing, wid, publicKey, "update")
      : undefined;
    if (row) {
      requireValue(!row.locked, 409, packLockedError);
      requireValue(
        row.scope !== "global" || user.role === "admin",
        403,
        "仅管理员可编辑全局素材包",
      );
      requireValue(
        draft.expected_revision === row.revision,
        409,
        "素材包已被修改，请重新打开后编辑",
      );
    }
    if (draft.scope !== undefined && draft.scope === "global") {
      requireValue(user.role === "admin", 403, "仅管理员可发布全局素材包");
    }
    const assets = await this.validate(sql, draft, wid, publicMedia);
    if (!row) {
      await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "pack-workspace:" + wid,
      ]);
      const count = await one(
        sql,
        "SELECT count(*) AS n FROM documents WHERE workspace_id=$1 AND kind='pack' AND NOT deleted",
        [wid],
      );
      requireValue(Number(count.n) < 200, 409, "素材包已达 200 个，请先整理");
    }
    requireValue(
      !/[\uD800-\uDFFF]/u.test(draft.name) &&
        !/[\uD800-\uDFFF]/u.test(draft.description),
      400,
      "素材包名称和描述必须是有效的 Unicode 字符串",
    );
    let resolvedTurnaround: PackTurnaroundViews | null | undefined = undefined;
    const turnaroundAssetUuids: string[] = [];
    if (draft.turnaround_views !== undefined) {
      if (draft.turnaround_views === null) {
        resolvedTurnaround = null;
      } else {
        const parsed = packTurnaroundViewsSchema.safeParse(
          draft.turnaround_views,
        );
        requireValue(parsed.success, 400, "三视图配置无效");
        resolvedTurnaround = parsed.data;
        const pubIds = [
          ...new Set(
            Object.values(parsed.data).filter((v): v is string => Boolean(v)),
          ),
        ];
        if (pubIds.length) {
          const tRows = (
            await sql.query<{ id: string; public_id: string }>(
              `SELECT id,public_id FROM assets WHERE public_id=ANY($1::text[])
               AND workspace_id=$2 AND original_kind='ref' AND state='ready' ORDER BY id FOR KEY SHARE`,
              [pubIds, wid],
            )
          ).rows;
          requireValue(
            tRows.length === pubIds.length,
            404,
            "三视图图片不存在或无权访问",
          );
          for (const r of tRows) turnaroundAssetUuids.push(r.id);
        }
      }
    }
    const id = row?.id || newId || randomUUID(),
      stored = packStorage(
        pythonStrip(draft.name),
        pythonStrip(draft.description),
      ),
      body = {
        purpose: draft.purpose,
        description: stored.description,
        assets,
      };
    if (row)
      await sql.query(
        "UPDATE documents SET title=$2,body=$3,pack_text=$4,revision=revision+1,updated_at=date_trunc('second',clock_timestamp()) WHERE id=$1",
        [id, stored.title, JSON.stringify(body), stored.text],
      );
    else
      await sql.query(
        "INSERT INTO documents(id,workspace_id,owner_id,kind,title,body,pack_text,updated_at) VALUES($1,$2,$3,'pack',$4,$5,$6,date_trunc('second',clock_timestamp()))",
        [id, wid, user.id, stored.title, JSON.stringify(body), stored.text],
      );
    await sql.query("DELETE FROM document_assets WHERE document_id=$1", [id]);
    const allLinkedAssets = [...new Set([...assets, ...turnaroundAssetUuids])];
    for (const asset of allLinkedAssets)
      await sql.query(
        "INSERT INTO document_assets(document_id,asset_id) VALUES($1,$2)",
        [id, asset],
      );
    if (draft.voice_profile !== undefined) {
      if (draft.voice_profile === null) {
        await sql.query(
          "UPDATE asset_pack_meta SET voice_profile=NULL WHERE pack_id=$1",
          [id],
        );
      } else {
        const parsedVoice = packVoiceProfileSchema.safeParse(
          draft.voice_profile,
        );
        requireValue(parsedVoice.success, 400, "角色声线配置无效");
        const vp = parsedVoice.data;
        if (vp.ref_audio_asset_id) {
          const refAudio = await one(
            sql,
            "SELECT id FROM assets WHERE public_id=$1 AND workspace_id=$2 AND original_kind IN ('audio','ref_audio') AND state='ready'",
            [vp.ref_audio_asset_id, wid],
          );
          requireValue(refAudio, 404, "参考音频不存在或无权访问");
        }
        await sql.query(
          `INSERT INTO asset_pack_meta(pack_id,voice_profile) VALUES($1,$2)
           ON CONFLICT (pack_id) DO UPDATE SET voice_profile=excluded.voice_profile`,
          [id, JSON.stringify(vp)],
        );
      }
    }
    if (resolvedTurnaround !== undefined) {
      await sql.query(
        `INSERT INTO asset_pack_meta(pack_id,turnaround_views) VALUES($1,$2)
         ON CONFLICT (pack_id) DO UPDATE SET turnaround_views=excluded.turnaround_views`,
        [id, JSON.stringify(resolvedTurnaround ?? {})],
      );
    }
    if (draft.scope !== undefined) {
      await sql.query(
        `INSERT INTO asset_pack_meta(pack_id,scope) VALUES($1,$2)
         ON CONFLICT (pack_id) DO UPDATE SET scope=excluded.scope`,
        [id, draft.scope],
      );
    }
    return this.get(sql, user, id, wid, false);
  }
  async setLock(
    sql: Sql,
    user: Actor,
    key: string,
    wid: string | undefined,
    locked: boolean,
    publicKey = true,
  ) {
    const row = await this.get(sql, user, key, wid, publicKey, "update");
    requireValue(
      row.owner_id === user.id || user.role === "admin",
      403,
      "只有创建者或管理员可以锁定或解锁素材包",
    );
    requireValue(
      row.scope !== "global" || user.role === "admin",
      403,
      "仅管理员可操作全局素材包",
    );
    await sql.query(
      `INSERT INTO asset_pack_meta(pack_id, locked, locked_by, locked_at)
       VALUES($1, $2, $3, $4)
       ON CONFLICT (pack_id) DO UPDATE SET
         locked = excluded.locked,
         locked_by = excluded.locked_by,
         locked_at = excluded.locked_at`,
      [row.id, locked, locked ? user.id : null, locked ? new Date() : null],
    );
    await sql.query(
      "UPDATE documents SET revision=revision+1, updated_at=date_trunc('second',clock_timestamp()) WHERE id=$1",
      [row.id],
    );
    return this.get(sql, user, row.id, wid, false);
  }
  async setScope(
    sql: Sql,
    user: Actor,
    key: string,
    wid: string | undefined,
    scope: PackScope,
    publicKey = true,
  ) {
    requireValue(user.role === "admin", 403, "仅管理员可修改素材包作用域");
    const row = await this.get(sql, user, key, wid, publicKey, "update");
    requireValue(!row.locked, 409, packLockedError);
    await sql.query(
      `INSERT INTO asset_pack_meta(pack_id, scope)
       VALUES($1, $2)
       ON CONFLICT (pack_id) DO UPDATE SET scope = excluded.scope`,
      [row.id, scope],
    );
    await sql.query(
      "UPDATE documents SET revision=revision+1, updated_at=date_trunc('second',clock_timestamp()) WHERE id=$1",
      [row.id],
    );
    return this.get(sql, user, row.id, wid, false);
  }
  async attachTurnaroundViews(
    sql: Sql,
    user: Actor,
    key: string,
    wid: string,
    views: PackTurnaroundViews,
  ) {
    const row = await this.get(sql, user, key, wid, true, "update");
    requireValue(!row.locked, 409, packLockedError);
    const parsed = packTurnaroundViewsSchema.safeParse(views);
    requireValue(parsed.success, 400, "三视图配置无效");
    const merged: PackTurnaroundViews = {
      ...(row.turnaround_views ?? {}),
      ...parsed.data,
    };
    const pubIds = [
      ...new Set(
        Object.values(merged).filter((v): v is string => Boolean(v)),
      ),
    ];
    const assetUuids: string[] = [];
    if (pubIds.length) {
      const tRows = (
        await sql.query<{ id: string; public_id: string }>(
          `SELECT id,public_id FROM assets WHERE public_id=ANY($1::text[])
           AND workspace_id=$2 AND original_kind='ref' AND state='ready' ORDER BY id FOR KEY SHARE`,
          [pubIds, row.workspace_id],
        )
      ).rows;
      requireValue(
        tRows.length === pubIds.length,
        404,
        "三视图图片不存在或无权访问",
      );
      for (const r of tRows) assetUuids.push(r.id);
    }
    const existingAssets: string[] = Array.isArray(row.body?.assets)
      ? [...row.body.assets]
      : [];
    for (const uuid of assetUuids) {
      if (!existingAssets.includes(uuid) && existingAssets.length < 9) {
        existingAssets.push(uuid);
      }
    }
    const nextBody = { ...(row.body || {}), assets: existingAssets };
    await sql.query(
      "UPDATE documents SET body=$2, revision=revision+1, updated_at=date_trunc('second',clock_timestamp()) WHERE id=$1",
      [row.id, JSON.stringify(nextBody)],
    );
    await sql.query(
      `INSERT INTO asset_pack_meta(pack_id, turnaround_views)
       VALUES($1, $2)
       ON CONFLICT (pack_id) DO UPDATE SET turnaround_views=excluded.turnaround_views`,
      [row.id, JSON.stringify(merged)],
    );
    await sql.query("DELETE FROM document_assets WHERE document_id=$1", [
      row.id,
    ]);
    for (const asset of new Set([...existingAssets, ...assetUuids])) {
      await sql.query(
        "INSERT INTO document_assets(document_id,asset_id) VALUES($1,$2)",
        [row.id, asset],
      );
    }
    return this.get(sql, user, row.id, wid, false);
  }
  async remove(
    sql: Sql,
    user: Actor,
    key: string,
    wid: string | undefined,
    publicKey = true,
  ) {
    const row = await this.get(sql, user, key, wid, publicKey, "update");
    requireValue(!row.locked, 409, packLockedError);
    requireValue(
      row.owner_id === user.id || user.role === "admin",
      403,
      "只有创建者或管理员可以删除素材包",
    );
    requireValue(
      !(await one(
        sql,
        "SELECT r.document_id FROM document_pack_refs r JOIN documents d ON d.id=r.document_id WHERE r.pack_id=$1 AND NOT d.deleted LIMIT 1",
        [row.id],
      )),
      409,
      packInUse,
    );
    await sql.query("UPDATE documents SET deleted=true WHERE id=$1", [row.id]);
    await sql.query("DELETE FROM document_assets WHERE document_id=$1", [
      row.id,
    ]);
    return { ok: true };
  }
  async syncCanvas(
    sql: Sql,
    user: Actor,
    wid: string,
    document: string,
    body: any,
  ) {
    const keys = new Set<string>();
    for (const node of body.nodes || [])
      for (const selected of node.asset_packs || []) keys.add(selected.id);
    const packs = [];
    for (const key of [...keys].sort()) {
      requireValue(typeof key === "string", 400, "素材包引用无效");
      const row = await this.get(
        sql,
        user,
        key,
        wid,
        /^[a-f0-9]{32}$/.test(key),
        "share",
        true,
      );
      packs.push(row.id);
    }
    await sql.query("DELETE FROM document_pack_refs WHERE document_id=$1", [
      document,
    ]);
    for (const pack of packs)
      await sql.query(
        "INSERT INTO document_pack_refs(document_id,pack_id) VALUES($1,$2)",
        [document, pack],
      );
  }
  async expand(
    sql: Sql,
    user: Actor,
    wid: string,
    prompt: string,
    references: string[],
    selected: PackSelection[],
  ) {
    requireValue(
      new Set(selected.map((p) => p.id)).size === selected.length,
      400,
      "请勿重复引用素材包",
    );
    const refs = [...references],
      prompts = [prompt.trim()],
      snapshots = [];
    // Deterministic lock order; prompt/media order remains the user's selection.
    const rows = new Map<string, any>();
    for (const pack of [...selected].sort((a, b) => a.id.localeCompare(b.id)))
      rows.set(
        pack.id,
        await this.get(sql, user, pack.id, wid, false, "share", true),
      );
    for (const selectedPack of selected) {
      const row = rows.get(selectedPack.id),
        pack = await this.view(sql, row);
      requireValue(
        pack.revision === selectedPack.revision,
        409,
        `素材包“${pack.name}”已更新，请重新选择后生成`,
      );
      for (const id of row.body.assets) if (!refs.includes(id)) refs.push(id);
      const indexes = row.body.assets
        .map((id: string) => `<Picture ${refs.indexOf(id) + 1}>`)
        .join(", ");
      prompts.push(
        `${pack.name}（${packPurposes[pack.purpose as keyof typeof packPurposes]}，${indexes}）：${pack.description}`,
      );
      snapshots.push({
        id: pack.id,
        revision: pack.revision,
        name: pack.name,
        purpose: pack.purpose,
        description: pack.description,
        media: pack.media,
      });
    }
    const expanded = prompts.join("\n\n");
    requireValue(
      refs.length <= 9 && [...expanded].length <= 12000,
      400,
      "参考图片合计最多 9 张，提示词和素材说明合计最多 12000 字",
    );
    return { prompt: expanded, references: refs, snapshots };
  }
}
