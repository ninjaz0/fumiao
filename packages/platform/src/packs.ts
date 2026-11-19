import { randomUUID } from "node:crypto";
import type { Actor } from "./platform.js";
import { one, type Database, type Sql } from "./db.js";
import { requireValue } from "./security.js";
import { pythonStrip } from "../../plugin-sdk/src/python-text.js";

export const packPurposes = {
  subject: "人物外观",
  outfit: "服装",
  scene: "场景",
  style: "风格",
  product: "产品细节",
} as const;
export const packInUse = "素材包正在画布中使用，请先在相关节点移除引用";
export type PackDraft = {
  name: string;
  purpose: keyof typeof packPurposes;
  description: string;
  media: string[];
  expected_revision: number | null;
};
export type PackSelection = { id: string; revision: number };

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

function packText(row: {
  title: string;
  body: { description?: string };
  pack_text?: { name: string; description: string } | null;
}) {
  return (
    row.pack_text ?? {
      name: row.title,
      description: row.body.description ?? "",
    }
  );
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
  ) {
    const row = await one(
      sql,
      `SELECT d.*,w.public_id AS workspace_public,u.public_id AS owner_public
      FROM documents d JOIN workspaces w ON w.id=d.workspace_id JOIN users u ON u.id=d.owner_id
      WHERE ${publicKey ? "d.public_id" : "d.id::text"}=$1 AND d.kind='pack' AND NOT d.deleted
      AND ($4::uuid IS NULL OR w.id=$4) AND
      ((w.kind='personal' AND w.owner_id=$2) OR (w.kind='team' AND ($3='admin' OR EXISTS(SELECT 1 FROM members m WHERE m.workspace_id=w.id AND m.user_id=$2))))
      ${lock ? `FOR ${lock === "share" ? "SHARE" : "UPDATE"} OF d` : ""}`,
      [key, user.id, user.role, wid || null],
    );
    requireValue(row, 404, "内容不存在或无权访问");
    return row;
  }
  async view(sql: Sql, row: any) {
    const ids: string[] = row.body.assets || [],
      assets = (
        await sql.query(
          "SELECT id,public_id FROM assets WHERE id=ANY($1::uuid[])",
          [ids],
        )
      ).rows;
    const keys = new Map(assets.map((a) => [a.id, a.public_id]));
    requireValue(
      ids.every((id) => keys.has(id)),
      409,
      "素材包引用已失效",
    );
    const { name, description } = packText(row);
    return {
      id: row.public_id,
      workspace: Number(row.workspace_public),
      owner: Number(row.owner_public),
      name,
      purpose: row.body.purpose || "subject",
      description,
      revision: row.revision,
      updated: Math.floor(new Date(row.updated_at).getTime() / 1000),
      media: ids.map((id) => keys.get(id)),
    };
  }
  async list(user: Actor, wid: string) {
    return this.db.transaction(async (sql) => {
      await sql.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      const rows = (
        await sql.query(
          "SELECT public_id FROM documents WHERE workspace_id=$1 AND kind='pack' AND NOT deleted ORDER BY updated_at DESC,public_id",
          [wid],
        )
      ).rows;
      const packs = [];
      for (const row of rows)
        packs.push(
          await this.view(sql, await this.get(sql, user, row.public_id, wid)),
        );
      return { packs, purposes: packPurposes };
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
    if (row)
      requireValue(
        draft.expected_revision === row.revision,
        409,
        "素材包已被修改，请重新打开后编辑",
      );
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
    for (const asset of assets)
      await sql.query(
        "INSERT INTO document_assets(document_id,asset_id) VALUES($1,$2)",
        [id, asset],
      );
    return this.get(sql, user, id, wid, false);
  }
  async remove(
    sql: Sql,
    user: Actor,
    key: string,
    wid: string | undefined,
    publicKey = true,
  ) {
    const row = await this.get(sql, user, key, wid, publicKey, "update");
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
        await this.get(sql, user, pack.id, wid, false, "share"),
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
