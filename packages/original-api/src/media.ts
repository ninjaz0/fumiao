import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { Request, Response } from "express";
import type { Platform, Actor } from "@fumiao/platform/platform.js";
import { one, type Sql } from "@fumiao/platform/db.js";
import { requireValue } from "@fumiao/platform/security.js";
import { originalUI } from "@fumiao/web-compat/ui.js";
import { OriginalIdentity, avatars } from "./identity.js";
import { modifiedSeconds } from "@fumiao/platform/storage.js";
import {
  collectDerivativeObjectKeys,
  getReadyDerivative,
  type DerivativeVariant,
} from "@fumiao/platform/derivatives.js";
import { sendFile } from "./files.js";
const extension: Record<string, string> = {
  "audio/wav": ".wav",
  "audio/mpeg": ".mp3",
  "audio/flac": ".flac",
  "audio/ogg": ".ogg",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "application/zip": ".zip",
  "application/xml": ".fcpxml",
};
function safeDownloadFilename(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const cleaned = raw.replace(/[\r\n\0"/\\]/g, "").trim();
  return cleaned && cleaned.length <= 120 ? cleaned : undefined;
}
export class OriginalMedia {
  private identity: OriginalIdentity;
  constructor(readonly p: Platform) {
    this.identity = new OriginalIdentity(p);
  }
  async resource(sql: Sql, user: Actor, key: string, workspace?: string) {
    const asset = await one(
      sql,
      `SELECT a.* FROM assets a JOIN workspaces w ON w.id=a.workspace_id
    WHERE a.public_id=$1 AND a.state='ready' AND ($4::uuid IS NULL OR w.id=$4)
    AND ((w.kind='personal' AND w.owner_id=$2) OR (w.kind='team' AND ($3='admin' OR EXISTS(SELECT 1 FROM members m WHERE m.workspace_id=w.id AND m.user_id=$2))))`,
      [key, user.id, user.role, workspace || null],
    );
    if (asset) return asset;
    // F022: Read-only access to assets explicitly attached to an active global AssetPack.
    // Never loosens isolation for ordinary private or workspace-scoped media.
    if (!workspace) {
      const globalAsset = await one(
        sql,
        `SELECT a.* FROM assets a
         WHERE a.public_id=$1 AND a.state='ready'
         AND EXISTS (
           SELECT 1 FROM document_assets da
           JOIN documents d ON d.id=da.document_id
           JOIN asset_pack_meta m ON m.pack_id=d.id
           WHERE da.asset_id=a.id AND d.kind='pack' AND NOT d.deleted AND m.scope='global'
         )`,
        [key],
      );
      if (globalAsset) return globalAsset;
    }
    requireValue(false, 404, "内容不存在或无权访问");
    return asset;
  }
  async serve(
    user: Actor,
    key: string,
    download: boolean,
    req: Request,
    res: Response,
    variant?: DerivativeVariant,
  ) {
    const asset = await this.resource(this.p.db, user, key);
    let objectKey: string = asset.object_key;
    let mime: string = asset.mime;
    if (variant && !download) {
      const deriv = await getReadyDerivative(this.p.db, asset.id, variant);
      if (deriv) {
        objectKey = deriv.object_key;
        mime = deriv.mime;
      }
    }
    const filename = download
      ? (safeDownloadFilename(asset.metadata?.filename) ??
        "弗淼-" + key.slice(0, 8) + (extension[mime] || ""))
      : undefined;
    // Keep embedded S3 media on its stable same-origin URL across refreshes.
    // Explicit downloads and API clients still receive a short-lived signed URL.
    const embedded = ["image", "audio", "video"].includes(
      req.get("Sec-Fetch-Dest") ?? "",
    );
    res.vary("Cookie");
    if (this.p.storage.downloadUrl) res.vary("Sec-Fetch-Dest");
    if (this.p.storage.downloadUrl && (download || !embedded)) {
      res.status(307).setHeader(
        "Location",
        await this.p.storage.downloadUrl(objectKey, {
          mime,
          filename,
        }),
      );
      res.setHeader("Content-Length", "0");
      res.end();
      return;
    }
    const info = await this.p.storage.stat(objectKey);
    await sendFile(
      req,
      res,
      {
        revalidate: !download,
        size: info.size,
        mime,
        modified: asset.object_modified,
        open: (start, end) =>
          this.p.storage.stream(objectKey, start, end),
      },
      filename,
    );
  }
  async builtin(filename: string, req: Request, res: Response) {
    requireValue(
      avatars.some((a) => a + ".svg" === filename),
      404,
      "头像不存在",
    );
    const ui = originalUI(),
      data = await ui.file("avatars/" + filename);
    const path = join(ui.root, "baseline/production/static/avatars", filename);
    const info = await stat(path, { bigint: true });
    return sendFile(req, res, {
      size: data.length,
      mime: "image/svg+xml",
      modified: modifiedSeconds(info.mtimeNs),
      open: async (start = 0, end = data.length - 1) =>
        Readable.from([data.subarray(start, end + 1)]),
    });
  }
  async avatar(filename: string, req: Request, res: Response) {
    requireValue(/^[0-9a-f]{32}\.webp$/.test(filename), 404, "头像不存在");
    const key = filename.slice(0, -5);
    requireValue(
      await one(
        this.p.db,
        "SELECT id FROM users WHERE avatar=$1 AND deleted_at IS NULL LIMIT 1",
        ["upload:" + key],
      ),
      404,
      "头像不存在",
    );
    const file = await one(
      this.p.db,
      "SELECT * FROM avatar_objects WHERE public_id=$1",
      [key],
    );
    requireValue(file, 503, "头像文件尚未完成迁移");
    const info = await this.p.storage.stat(file.object_key);
    return sendFile(req, res, {
      size: info.size,
      mime: "image/webp",
      modified: file.modified,
      open: (start, end) => this.p.storage.stream(file.object_key, start, end),
    });
  }
  async protect(sql: Sql, id: string) {
    requireValue(
      !(await one(
        sql,
        `SELECT 1 FROM storyboard_export_refs r JOIN storyboard_exports e ON e.id=r.export_id WHERE r.asset_id=$1 AND e.state IN ('queued','running') LIMIT 1`,
        [id],
      )),
      409,
      "素材正在合成中，请稍后重试",
    );
    // Live document references share the same authority used by canvas and asset packs.
    const kinds = (
      await sql.query(
        "SELECT DISTINCT d.kind FROM document_assets r JOIN documents d ON d.id=r.document_id WHERE r.asset_id=$1 AND d.deleted=false",
        [id],
      )
    ).rows.map((r) => r.kind);
    requireValue(
      !kinds.includes("pack"),
      409,
      "素材正在素材包中使用，请先从素材包移除",
    );
    requireValue(
      !kinds.includes("canvas") &&
        !(await one(
          sql,
          `SELECT 1 FROM canvas_job_links l
        JOIN canvas_nodes n ON n.project_id=l.project_id AND (n.node=l.node OR 'voice:'||n.node=l.node)
        JOIN jobs j ON j.id=l.job_id AND j.deleted_at IS NULL
        JOIN job_assets r ON r.job_id=j.id AND r.role='output' WHERE r.asset_id=$1 LIMIT 1`,
          [id],
        )),
      409,
      "素材正在画布中使用，请先从相关画布移除",
    );
    requireValue(!kinds.length, 409, "素材仍被文档引用");
  }
  async remove(user: Actor, key: string, selected?: string) {
    const object = await this.p.db.transaction(async (sql) => {
      const candidate = await one(
        sql,
        "SELECT * FROM assets WHERE public_id=$1 AND original_kind IN ('ref','ref_video','ref_audio') FOR UPDATE",
        [key],
      );
      requireValue(candidate, 404, "素材不存在");
      const workspace = await this.identity.activeWorkspace(
        sql,
        user,
        selected,
      );
      const asset = await this.resource(sql, user, key, workspace.id);
      requireValue(
        asset.owner_id === user.id || user.role === "admin",
        403,
        "只能删除自己的素材",
      );
      await this.protect(sql, asset.id);
      requireValue(
        !(await one(
          sql,
          "SELECT job_id FROM job_assets WHERE asset_id=$1 AND role='input' LIMIT 1",
          [asset.id],
        )),
        409,
        "仍有作品或任务引用这张图，请先删除相关版本",
      );
      requireValue(
        !(await one(
          sql,
          "SELECT job_id FROM job_assets WHERE asset_id=$1 AND role='output' LIMIT 1",
          [asset.id],
        )),
        409,
        "请从生成记录中删除这张图片",
      );
      const derivObjects = await collectDerivativeObjectKeys(sql, [asset.id]);
      await sql.query("DELETE FROM document_assets WHERE asset_id=$1", [
        asset.id,
      ]);
      await sql.query("DELETE FROM favorites WHERE asset_id=$1", [asset.id]);
      await sql.query("DELETE FROM assets WHERE id=$1", [asset.id]);
      return [asset.object_key as string, ...derivObjects];
    });
    for (const key of object) await this.p.storage.remove(key).catch(() => {});
    return { ok: true };
  }
}
